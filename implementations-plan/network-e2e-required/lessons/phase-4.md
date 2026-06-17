# Phase 4 — Fix F1's measured cause

F1 turned out to be TWO stacked bugs in the public-authwit revoke path. Both are
security-relevant (a revoked authorization staying spendable).

## Bug 1 — swapped storage-slot constants (the static root cause)
`auth-registry.ts` had `APPROVED_ACTIONS_SLOT=1` / `REJECT_ALL_SLOT=2`, but the
upstream `AuthRegistry` `#[storage]` declares `reject_all` first (slot 1) then
`approved_actions` (slot 2). Swapped → `isAuthwitConsumable` read a meaningless
slot → `waitForOnChainState`'s revoke check passed on the first poll → the
revoke was never actually awaited. **Fix:** swap the constants (verified against
the noir-contracts artifact source). + `waitForOnChainState` now THROWS on
timeout (never report an unverifiable security mutation as success). Regression:
`auth-registry.test.ts` pins the read slots (BB-free, 3/3). See lessons/phase-3.md.

**Result after bug-1 fix:** authwit-lifecycle PASSED for the first time ever
(soak 27718294303 iter 1) but was still ~flaky (iter 2 failed at the same
`expected 'ok' to be 'error'`). So bug 1 was necessary but not sufficient.

## Bug 2 — PXE/node barrier mismatch (the residual race)
Codex consult `019e...` (`/tmp/codex-f1-race.md`; verdict verified against the
repo). Cause: `revokeAuthwits` confirms the revoke via a raw `AztecNode`
`getPublicStorageAt("latest")` read, but the dApp CONSUME builds/simulates/proves
through the **offscreen PXE**, which can lag the node by a block
(`execution/helpers/block-header-anchor.ts` documents the skew). So after a
confirmed revoke, a fast consume anchored PRE-revoke state, `node.sendTx`
accepted the stale-proved tx, and the playground reported `ok` because its
`NO_WAIT` returns at SUBMIT, not receipt. The assertion was observing "submitted
against stale PXE state", not "executed after revoke".

**Fix (codex-recommended, root-cause):** after the node `latest` check, also
wait until the offscreen PXE (the consume's view) has synced PAST the mutation
tx's receipt block — `waitForPxeSyncedPastTx(node, network, txHash)`: fetch
`node.getTxReceipt(txHash).blockNumber`, then poll
`pxe.getSyncedBlockHeader(networkInfoFrom(network)).getBlockNumber() >= target`.
Applied to BOTH `revokeAuthwits` and `setRegistryEnabled` (the registry-toggle
step 3 has the same skew). Reuses the existing PXE RPC (`getSyncedBlockHeader`,
spec.ts:64) — no new waiter primitive. Throws on a 120s timeout (loud, not
silent).

My own prior hypothesis (message_hash divergence) was WRONG — codex disproved it
both times. Hash path is consistent (step 1 consume passing proves it).

## Fix files (this branch, ed5b49a)
- `src/wallet/utils/auth-registry.ts` — slot swap.
- `src/wallet/services/auth-registry/service.ts` — `waitForOnChainState` throws;
  new `waitForPxeSyncedPastTx`; called in revoke + toggle paths; +PxeServiceClient.
- `src/wallet/utils/auth-registry.test.ts` — slot regression (3/3).

## Local gates (green)
lint 0 · typecheck 0 · auth-registry util test 3/3.

## Validation gate (CI)
authwit-lifecycle 10/10 retry=0 proverless soak — run 27719585565 (re-soak with
the PXE barrier). **← record 10/10 here, then mark Phase 4 done.**
_pending re-soak_

LESSONS_FILE=implementations-plan/network-e2e-required/lessons/phase-4.md

## Bug 3 (round 3) — empty authwit list at revoke step (codex consult 019e... #3)
After bug-1+2 fixes, authwit-lifecycle flipped to failing 4/4 at the REVOKE step:
`clickByTestId("authwits-revoke-all")` times out because the list is empty
(`:disabled="!authwits.length"`). codex (`/tmp/codex-f1-syncdelete.md`) could NOT
find a sync trigger on the popup/switchAccount/navigateToSettings path — so it
cannot prove what empties the list, but by elimination it is `syncAuthwit`'s
bucket-B prune: with the now-correct slots, a freshly-granted authwit that isn't
yet node/PXE-visible reads `approved_actions=0` → `syncAuthwit` deletes it
(service.ts:281). Recommended fix: (a) `syncAuthwit` must NOT delete on a bare
`!isConsumable` read (can't tell revoked/consumed from not-yet-visible); (b) in
`revokeAuthwits`, after positive confirmation, delete the exact revoked ids
directly (the only context that KNOWS they're gone). **Capture re-armed
(afc4e32) + 3× soak running to confirm storage-empty (bucket B) vs page-issue
before implementing.**
