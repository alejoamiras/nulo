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

### Bug 3 RESOLVED — it was a TEST account-targeting bug, NOT bucket B
The capture (run 27720888158) REFUTED bucket B: at the revoke step the storage
had BOTH authwits present under ownerA `0x15bb`, but the page showed
`emptyState:true` / revoke-all `aria-disabled:true`. The accounts dump:
`0x22ec`="Account"(chainId 0), `0x15bb`="Second"(chainId 0), `0x11d1`="Account"
(chainId 4138294185). The granter ownerA=accountAddresses[0]=`0x15bb` is named
"Second" this run, but `settingsAction` hardcoded `switchAccount("Account")` →
viewed the wrong account → `getAuthwits` returned [] → empty page. The dApp
exposure order (accountAddresses) ≠ wallet creation/naming order, so ownerA's
NAME varies per run (Phase-3 it was "Account" → matched; this run "Second" →
mismatch). FIX: `switchAccountByAddress(walletPopup, ownerA)` (+ data-account-address
on the AccountsPopup item). My app fixes (slot swap + PXE barrier) were correct
and necessary — they removed the consume-race mode that previously masked this
test bug. Validation: re-soak 27721713670 (10/10).

### Bug 2 (PXE barrier) was WRONG — removed (codex consult #4)
codex read the upstream PXE source: `getSyncedBlockHeader()` is PASSIVE (returns
the stored header; never drives sync — `@aztec/pxe block_synchronizer.ts:138`
sync is user-driven). So `waitForPxeSyncedPastTx`'s poll could never advance →
120s timeout per mutation → 344s total → CDP `Runtime.callFunctionOn timed out`
(the revoke RPC never resolved, popup overlay never left). CRITICAL CORRECTION:
the dApp consume's `simulateTx`/`proveTx` ALREADY forces a PXE sync before
execution (`@aztec/pxe pxe.ts:747,937`), so there is no PXE-lag race at the
consume seam — the barrier solved the wrong seam with the wrong primitive.
`block-header-anchor.ts` is the fast view path only, not the send/consume path.
FIX: remove `waitForPxeSyncedPastTx` + its deps; keep the raw-node
`waitForOnChainState` (throws on timeout). If a residual consume-race remains,
the correct primitive is exposing `pxe.debug.sync()` as a real `sync(network)`
RPC and calling it once — NOT a passive poll. Re-soak to test whether
slot-fix + waitForOnChainState + the consume's own self-sync is deterministic.

### Bug 4 (THE actual remaining cause) — assertion seam: submit-ack vs mined (codex #5)
The 5th re-soak still failed at `G2 consume → expected 'ok' to be 'error'` with
the barrier removed. codex #5: the playground consume uses `sendTx(...,
{wait:"NO_WAIT"})`; the dApp executor (`dapp-send-executor.ts:391`) resolves the
promise at SUBMIT, not mine (documented at `fixtures/aztec.ts:476`). So
`consume()` returned the SUBMIT-ack `res.status`, which is racy for a revoked
authwit (the node may or may not pre-validate at sendTx) — NOT the mined outcome.
The revoke was working all along (the slot fix fixed it); the test asserted at
the wrong seam, which is what produced the ~50% "consume-race" + sent me chasing
a phantom PXE race for 3 iterations. FIX: `consume()` now waits for the consume
tx to MINE (`waitForTxMined` — throws on `app_logic_reverted`/dropped) and returns
"ok"/"error" on the MINED outcome. `getPublicStorageAt("latest")` is a proposed-tip
(not proven) read, but that was NOT the failure — the seam was.
Net F1 fix set: slot constants (security) + waitForOnChainState (kept) +
switchAccountByAddress + mined-outcome consume assertion. NO PXE barrier.

### Bug 5 (THE finality root cause) — revoke confirmed at `latest`, not PROVEN (codex #6)
With the mined-outcome assertion (bug 4), the dump showed G2 consume MINES
SUCCESSFULLY despite the revoke — so the revoke is a genuine no-op on the grant
the consume uses. codex #6 verified it is NOT a hash mismatch (grantPublicAuthwit
routes one add_public_authwit; the SAME messageHash is stored via trackAuthwit
AND written via set_authorized AND recomputed by AuthRegistry.consume — identical
across grant/track/revoke/consume). It IS a FINALITY barrier bug: the sequencer
executes public functions against PROVEN state, but `waitForOnChainState` only
confirmed `getPublicStorageAt("latest")` (the PROPOSED tip). So a revoke visible
at `latest` but not yet PROVEN is invisible to the consume's sequencer execution.
FIX: replace the latest-based `waitForOnChainState` with `waitForTxProven` —
poll `node.getL2Tips().proven.block.number >= revokeReceipt.blockNumber` (throws
on timeout). Proven advances normally here (grants prove within the test's step
timing, which is why their consumes already worked). Applied to revoke + toggle.
This + bug-4 (mined-outcome assertion) together make revoke→consume deterministic.

### Bug 5 — DEFINITIVE on-chain finding + UNRESOLVED ANOMALY (codex #7 diagnostic)
The `[revoke-slot-check]` diagnostic (e0c3560) read, at the PROVEN block after
revoke, `approved_actions[storedAccount][storedHash]` for BOTH stored authwits:
both `= 0x000…0` (cleared). YET the G2 consume mines SUCCESSFULLY (status ok).

Code facts (codex #6/#7-verified): `computeCallMessageHash` (tx-request-builder
→ the stored/granted/revoked hash) calls the SAME upstream `computeAuthWitMessageHash`
(authwit-discoverer.ts:154) the consume path uses — same `caller=B`, `call=token
.transfer_public_to_public(args)`, `chainId`, `version`. So storedHash SHOULD ==
the consume's recomputed hash. storedAccount (= granter A, via trackAuthwit) ==
the consume's `on_behalf_of` (= A). AuthRegistry.consume reads
`approved_actions[A][hash]` unconditionally (no fallback).

**ANOMALY (unresolved):** the revoke provably zeroes the consume's exact slot at
the proven block, the consume reads that slot, yet it does not revert. This
violates the apparent logic and survived 9 fixes + 7 codex consults. Possible
deeper causes NOT pinned: (a) sequencer public-state snapshot differs from the
proven `getPublicStorageAt` read; (b) the consume's args encoding (grant uses
string args, consume BigInt) yields a different inner hash than the diagnostic's
storedHash despite the same function; (c) a sandbox/version semantic. Needs
interactive protocol debugging or Aztec-team input — beyond autonomous e2e iteration.

**Real, KEEP fixes from this arc (all codex-validated, lint/typecheck/unit green):**
swapped AuthRegistry slot constants (SECURITY — revoked authwits read as
unrevokable), `auth-registry.test.ts` slot regression, `switchAccountByAddress`
(+data-account-address), `waitForTxProven` (proven-finality barrier), mined-outcome
consume assertion. Diagnostic instrumentation ([revoke-slot-check],
[consume-result], dumpAuthwitMeasurement) is TEMPORARY — remove when resolved.

STATUS: Phase 4 BLOCKED on the anomaly. Decision required (see plan.md).
LESSONS_FILE=implementations-plan/network-e2e-required/lessons/phase-4.md

---

## Resumed (new-angle): read approved_actions AT the consume's execution block

Un-parked with an explicit "genuinely new approach, not another blind fix"
mandate. Every prior diagnostic read `approved_actions[A][storedHash]` at the
PROVEN tip (always 0). The one value never captured: that slot AT the consume's
OWN execution block. Crux from `waitForTxMined` (fixtures/aztec.ts:491) — it
returns at `status="success"` (the PROPOSED tip), so the consume executes against
the proposed block's state, which need not equal the proven tip.

Experiment (`327b8d1`, `[consume-vs-revoke]` log): capture the consume tx's block
(`lastConsumeBlock`), then read `approved_actions[A][storedHash]` at THAT block.

Decision tree:
- **slotAtConsumeBlock == 0 AND outcome == ok** → HASH DIVERGENCE. The consume
  read a slot the revoke cleared, yet didn't revert — impossible if it read THIS
  slot. So its recomputed hash ≠ storedHash; it read a different (still-granted)
  slot. Contradicts codex #6/#7 ("identical computation") → the static trace
  missed an input delta (prime suspect: grant passes STRING args `"1"`, consume
  passes `BigInt(1)` — inner-hash arg encoding). Fix: align grant/track hashing
  with the consume's encoding; pin with a unit test on the two hashes.
- **slotAtConsumeBlock != 0** → SNAPSHOT/ORDERING. The proven revoke is absent at
  the consume's execution block. If consumeBlock <= revoke's effective block →
  ordering race (consume sequenced onto a pre-revoke state-base); fix = barrier
  that waits for a proposed block strictly AFTER the revoke before submitting the
  consume. If consumeBlock > revoke block yet slot!=0 → genuine sequencer
  public-state-base-vs-proven-tip anomaly → precise Aztec-team question (with the
  exact block numbers + slot from this run).

RESULT (soak `bbexi2wj0`, 2 independent runs — DECISIVE):
- Run 1: revoke proven @ block 69, `storedHash` slot = 0. Consume executed @ block
  **75** (> 69); `slotAtConsumeBlock(75)` = **0**; outcome = **ok**.
- Run 2: revoke proven @ 119; consume @ block **126** (> 119); slot = **0**; ok.

The consume's OWN execution block is AFTER the proven revoke, `storedHash`'s slot
IS 0 at that block, yet the consume succeeds. This DEFINITIVELY rules out
snapshot/ordering (the slot is genuinely 0 at the consume's block) and proves the
consume's effective authorization ≠ `storedHash`.

Code map (all read this round): the dApp `grantPublicAuthwit` (dispatcher.ts:614)
emits ONE `add_public_authwit` action → `buildStandard` (tx-request-builder.ts:203)
computes `messageHash = computeCallMessageHash(content)` and passes the SAME value
to BOTH `trackAuthwit` (storedHash) AND `set_authorized` (grantHash). So
`storedHash == grantHash` by construction; G1 (grant→consume) proves
`grantHash == consumeHash`. `revokeAuthwits` (service.ts:122) clears `storedHash`.
At the code level all three hashes are equal — so a revoke that clears that slot
SHOULD block the consume. It doesn't. The only code-consistent escape: the consume
does NOT reach `AuthRegistry.consume` at all.

REFINED HYPOTHESIS: the e2e wallet holds BOTH the granter (A) and consumer (B)
(`dappConnectedExtensionWithFirstTwoAccountsCap`). The consume is sent `from: B`
with `authWitnesses: []` (playground authwit.ts:175), but the FROM-path executor
can auto-discover the transfer's authwit requirement and create A's PRIVATE witness
(the wallet has A's key), satisfying the token WITHOUT the public registry. If so,
F1 is a TEST-DESIGN flaw — public-registry revoke is unobservable when one wallet
owns granter+consumer — NOT a wallet revoke bug. The wallet's revoke is provably
correct (`[revoke-slot-check]` = 0 at the granted/revoked slot).

ARBITER: matrix soak `b5ayj11df` — `reject_all` (slot 1) is checked by
`AuthRegistry.consume` before the approval, so registry-DISABLE blocks the consume
IFF the consume actually calls `AuthRegistry.consume`. `[F1-MATRIX] disableBlocks`:
- false → consume bypasses the registry (auto-created private witness) → TEST-DESIGN
  flaw → fix = assert the on-chain slot state after revoke (already read by
  `[revoke-slot-check]`), OR isolate the consumer into a wallet that lacks A's key.
- true  → registry IS consulted yet revoke misses → deeper bug (then escalate to
  codex with the full matrix + this code map).
RESULT (matrix soak `b5ayj11df`) — `[F1-MATRIX] revokeBlocks=false disableBlocks=false
reenableOk=true`. DECISIVE: registry-DISABLE does NOT block the consume, so the
consume never calls `AuthRegistry.consume` (reject_all is its first gate). All three
consumes succeed regardless of registry state.

═══ VERDICT: F1 IS A TEST-DESIGN FLAW, NOT A WALLET BUG ═══
The consume (`sendTx {from: B}`, transfer_public_to_public(A,B,..)) runs the FROM-path
`discoverPrivateAuthwits` (dapp-send-executor.ts:340) which mints A's PRIVATE authwit —
the e2e wallet holds BOTH A (granter) and B (consumer) via
`dappConnectedExtensionWithFirstTwoAccountsCap`, so it can sign for A. That private
witness satisfies the token WITHOUT the public registry, making revoke/disable
unobservable through the consume outcome. The wallet's revoke + disable WRITES are
provably correct: `[revoke-slot-check]` = 0 (granted slot cleared on-chain),
`storedHash == grantHash` by construction (tx-request-builder.ts:203 single messageHash).
The slot-swap fix (already landed on dev, #101) was the real bug; this remaining
"anomaly" is the test asserting protocol enforcement the harness cannot isolate.

FIX (Phase 4): assert the WALLET's observable on-chain registry WRITES, not the
protocol's consume enforcement:
  - after grant   → approved_actions[A][hash] == 1 (isAuthwitConsumable true)
  - after revoke  → approved_actions[A][hash] == 0 (isAuthwitConsumable false)
  - after disable → isAuthRegistryEnabled(A) == false
  - after enable  → isAuthRegistryEnabled(A) == true
Keep G1 grant→consume as a "grant yields a consumable authwit" smoke. This tests
`revokeAuthwits` + `setRegistryEnabled` (the two zero-coverage flows) at the layer the
wallet OWNS. Codex consult pending to validate the verdict + fix shape.
