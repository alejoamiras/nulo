# Network test triage audit (opus 4.7)

## 1. Verdict

**Partially correct.** The categorization is defensible but underspecifies Cluster A's failure modes (a third hypothesis is more likely than A1/A2 alone), and Phase 0 is over-engineered.

## 2. Per-cluster review

**A — tokenReadyExtension cascade (11):** Plan's A1/A2 are real, but **a third hypothesis dominates**. `addToken` (`token/service.ts:107-153`) calls `fetchTokenMetadata` which does **3 sequential `simulate(node, pxe, account, …)` calls** for name/symbol/decimals (`token/service.ts:418-433`). Each goes through the PXE service guard's `withPxeRead` (`packages/aztec-runtime/src/pxe/service.ts:314-328`), which serializes against ALL other PXE reads/writes. `parseTokenInterface` itself does 2 reads + 1 conditional write (`registerContract`), and `onTokenAdded` then enqueues balance work for every account (`token-balance/service.ts:170-176`). Under sustained load the total wait can easily exceed the helper's 60s toast wait at `helpers.ts:361`. **Call this A3: PXE-guard serialization stall in `addToken`**, not just `parseTokenInterface`. Categorization stays (a) wallet bug, but the fix surface is broader than the plan implies. Agree with the plan that (b)/(c)/(d) are unlikely.

**B — feeJuiceImportedExtension (3):** Agree it's (d) niche/aztec sandbox. `setupPreFundedAccount` (`fixtures/aztec.ts:275+`) does five heavy on-chain steps (deploy, public FJ bridge+claim, PrivateFPC deploy, bridgeForMint, L2 claim) — LMDB write storms are very plausible. Plan's diagnostic (`rm -rf /tmp/nulo-aztec-*` between runs) is the right first probe. Note: the plan says "Phase 1 fails — script-side", but if Phase 1 succeeds, Phase 2's `importToken` at `extension.ts:538` is the same Cluster A code path — those failures should reclassify back to A, not B.

**C — contacts edit/migrate (2):** The plan's repudiation of the user's earlier "keep OLD is intentional" is **correct**. `EditContactPopup.vue:185-194` truth table is unambiguous: `1 1 1 → add(new), delete(old)`. The function name is `applySenderDelta`, comment line 252 says "migrates the registration", toast at line 263 says "sender migration incomplete on …". Wallet code clearly intends to migrate. So (a) real bug. **But C2 (cached `getSenders`) is dead on arrival** — `account-state/service.ts:52-62` reads PXE fresh, no cache layer. The chip in test 3 lives in `pages/settings/contacts/index.vue:80-91`, driven by `onSenderDeleted` event. The real C2 is "did `onSenderDeleted` fire on the contacts page after `applySenderDelta`'s `deleteSender` resolved?" — an event-propagation check, not a cache-staleness check. C1 (deleteSender throws) and C3 (cross-test leak) remain valid hypotheses. C3 is interesting because tests 1+2 each register `ADDR_SENDER`/`ADDR_PERSIST` which are different addresses from tests 3+4 — so cross-test leak is unlikely; the addresses are file-private constants at lines 14-19.

**D — contacts chip 10s timeout (1):** Agree (b)/(a) split is right. Bumping the timeout reveals which. But note: `addSender` at `account-state/service.ts:97-109` goes through `withPxeWrite` (`packages/aztec-runtime/src/pxe/service.ts:152-156`) — this is one of the SAME PXE-guard waits that delays Cluster A. If you fix A, D probably fixes itself too.

**E — data-registerSender 15s (1):** Agree. `aztec_registerSender` dispatch (`wallet-bridge/dispatcher.ts:635-641`) → wallet → `pxeService.registerSender` is the same PXE-write-queue path. Same root as A and D.

## 3. Things missed

- **PXE service guard serialization** (`packages/aztec-runtime/src/pxe/service.ts:314-345`) is the unifying mechanism for A, D, E and likely A3. The plan treats them as separate clusters; they share infrastructure. A single PXE-write-throughput investigation could resolve 13 of 18 failures.
- **`fetchTokenMetadata` does 3 simulate() calls** (`token/service.ts:418-433`). Plan only mentions PXE introspection in `parseTokenInterface`. `addToken` is the slower step on cold PXEs.
- **Test 2 in contacts-sender ("toggle OFF leaves sender registered") passes** while tests 3+4 fail. This is signal: the OFF branch (line 207 `shouldDeleteOld = … && !desiredIsSender.value`) works. The address-change branch (`addressChanged` term) is what's broken — narrows C1 vs C3.
- **`feeJuiceImportedExtension` has a built-in non-zero-FJ guard** (`extension.ts:524-532`) that runs BEFORE `importToken`. If Phase 1 succeeds but FJ doesn't materialize, this is where the fixture fails — looks like Cluster B, but is actually Phase 2 PXE-sync. Worth instrumenting separately.
- **`closeStuckPopup` in tests 3+4** (`contacts-sender.test.ts:151,205`) force-removes DOM. If the edit popup's `applySenderDelta` is still in-flight when `closeStuckPopup` strips the popup, the popup's lifecycle teardown (the watcher at line 283-318 that calls `accountStateService.disconnect()`) could race with the in-flight `deleteSender` request. Possible C4: aborted RPC mid-flight.

## 4. Phase 0 reduction

Plan has 5 separate runs (~65 min). Reduce to **3 runs**:

| Run | Tests | Probes | Time |
|---|---|---|---|
| 1 | `transfers > balance` (A) + `contacts-sender > test 1` (D) + `data-registerSender` (E) — single test runner, 3 tests | Probe inside `withPxeWrite`/`withPxeRead` to log queue-depth + per-call latency. Bump D+E timeouts to 60s. | 25 min |
| 2 | `fee-methods > public FJ` (B) — 3 reruns with `rm -rf /tmp/nulo-aztec-*` between | LMDB determinism check | 10 min |
| 3 | `contacts-sender > test 3` (C) | Console.log `applySenderDelta` branches + getSenders pre/post + onSenderDeleted fired/not | 15 min |

Run 1 collapses A, D, E into one diagnostic because they share the PXE-guard surface. **~50 min total**, single coherent dataset for the shared infrastructure.

## 5. What looks fine

- File path citations all verified (EditContactPopup line ranges, NewTokenPopup, fixture line ranges).
- 18-test count split (11 + 3 + 2 + 1 + 1) verified against the test files.
- The user's "keep OLD is intentional" claim is wrong; plan's pushback is well-founded.
- Anti-scope discipline (no retry-wrappers, no test infra changes) is right.
- Cluster B as (d) sandbox-side is correct.
- Open questions for the user are well-targeted.
