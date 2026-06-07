# Round 1 audit response

Consolidates findings from `audit-codex.md` (Reject) + `audit-opus.md` (Approve-with-changes). Documents adopted / rejected / surfaced-to-user for each item. Plan.md edits applied in same pass.

## Critical findings

### C1. Ref-counted eviction unsafe under Lock force-release (codex C1, related: opus M3)

**Codex**: A timed-out holder can resume later, call `leave()` on the old lock object, then decrement/delete a newer lock instance recreated under the same key. Map corruption.

**Adopted, with stronger fix**: **drop eviction entirely.** The Map grows with lifetime-distinct contracts (realistic: hundreds). Each entry is one Lock instance + key string (~hundreds of bytes). At 1000 contracts: ~100KB. Acceptable. The complexity cost of safe eviction (Lock.isIdle() upstream OR entry-token approach OR generation-counter on the Map) exceeds the memory benefit. Plan §Phase 0 updated to remove ref-count + eviction.

Drop tests LR6 (lock-map eviction).

### C2. clearProfile/Chain second-pass sweep racy and unbounded (opus C1, codex H3)

**Both audits flagged**: a third scan can land between the second snapshot and second `acquireManyTriples`. Loop-until-empty is not bounded under realistic poll cadence.

**Adopted**: replace 2-pass sweep with a `isWiping` semaphore (a single boolean field). `scanContract`'s per-note critical section returns early if `isWiping === true`. `clearProfile / clearChain` set `isWiping = true`, await any in-flight critical sections to drain (one-shot await on the per-triple locks they need), wipe sequentially, set `isWiping = false`. No `acquireManyTriples` needed — no scan can enter a critical section while wiping. Plan §Phase 6 + Phase 4 updated.

Side effect: `acquireManyTriples` helper is no longer needed for clearProfile/Chain. May still be useful for `onTransactionAdded` (multi-contract per hash) but I'll drop it from the helper set since simpler sequential per-contract locking suffices there too.

## High findings

### H1. onAccountDeleted not covered by lock (codex H2, opus H3)

**Both flagged**: account-deletion can race with in-flight scans that persist rows for the deleted account.

**Adopted**: add Phase 3.5 — migrate `onAccountDeleted` to wipe records for the deleted account inside per-triple locks (one lock per contract the account had records in). Plan §Phase 3.5 added.

### H2. Per-iteration getRecord re-check IS still required (opus H2)

**Opus**: external-Map fixture pattern in tests would resurrect deleted rows.

**Adopted**: keep the per-iteration `repo.getRecord` re-check in `setTrustAllow`'s records loop. Cost is one repo read per record (cheap). Plan §Phase 1 updated.

### H3. Phase 6 changes emit semantics (codex H3)

**Codex**: Current `clearProfile/clearChain` emits NOTHING; consolidated plan adds `onIncomingTrustChanged → unknown` emits per triple. Violates byte-identical surface claim.

**Adopted**: revert the new emits. `clearProfile/clearChain` stay silent (no `onIncomingTrustChanged` per triple). Consumers that need to react to bulk wipes can re-read state on the existing `onProfileDeleted` / chain-purge signals. Plan §Phase 6 updated.

### H4. Notification-flooding churn (codex H3)

**Codex**: rapid `register_token → revoke → register_token` loop reprompts; current dedup is per-pending-cycle only.

**Surfaced to user as Ask**: this is a UX-level threat (dApp behavior) not a refactor concern. Adding throttling/debounce is product scope. Plan §Section 3 documents the threat + defers mitigation. Open Question added.

### H5. scanContract outgoing/inflight tx snapshot stale (codex M1, escalated to High)

**Codex**: `outgoingTxHashes` + `inflightTxHashes` are snapshotted before the per-note loop. `onTransactionAdded` running mid-scan invalidates them; later notes can be persisted that should be tx-deduped.

**Adopted**: re-read `outgoingTxHashes` + `inflightTxHashes` inside each per-note critical section. Cost: one TransactionService call + one OperationJournal call per note. Mitigation: cache per-CS via Map keyed by `(account, snapshot-version)` — pull `current` snapshot once per per-note iteration. Plan §Phase 4 updated.

### H6. replayPendingPrompts tokens snapshot races (opus M1, escalated)

**Opus**: outer `tokens = getTokensRaw` snapshot is taken before per-row lock; if `onTokenDeleted` runs between outer snapshot and per-row CS, the snapshot still includes the deleted token → emit Pending for deleted contract.

**Adopted**: re-read `tokens` inside the per-row lock (alongside the existing live `getTrust` re-read). Plan §Phase 2 updated.

### H7. Async subscriber throw → popup misreads as success (opus H4)

**Opus**: if a Vue subscriber throws inside `setTrustAllow`'s critical section, the rejected Promise unwraps as `undefined`, and the popup's `ok !== false` check incorrectly treats it as success.

**Surfaced as pre-existing bug + Open Question**: not introduced by this refactor. Adding `await ... catch` in the popup wrapper is a separate fix. Plan §Section 3 documents.

## Medium findings

### M1. setTrustState public IPC exposure (codex M2, opus M4)

**Both flagged**: `setTrustState` is on the public `Methods` interface; any IPC caller can write arbitrary `state` including `blocked` directly. Bypasses FSM constraint.

**Surfaced to user as Ask** — this requires explicit decision (user pre-locked the 4-state FSM but did not explicitly require enforcement at the API boundary). Recommended action: remove `setTrustState` from public `Methods` (no client.ts proxy); make it `private`. The only callers are internal `setTrustAllow/Reject` and tests. Tests use `as never as { ... }` cast access already; can continue. Plan §Section 4 Asks updated.

### M2. acquireManyTriples deadlock-by-starvation (opus M2)

**Opus**: bulk wipe can hold many locks for tens of seconds under poll cadence.

**Obsoleted by C2 fix**: the `isWiping` semaphore replaces `acquireManyTriples`. No multi-lock-hold.

### M3. F7 EventHandler.invoke wording (codex M3)

**Codex**: F7 says "sync-fires-async"; actually synchronous, just ignores returned promises. The relevant property is that subscriber throws are swallowed (per-subscriber try/catch in EventHandler).

**Adopted**: F7 reworded.

### M4. State-machine permissive (codex M2, also tied to M1)

**Adopted via M1**: removing `setTrustState` from public IPC mitigates the public-API permissiveness. Internal callers (`setTrustAllow/Reject`) always pass valid transitions.

## Low findings

### L1. SW restart mid-CS (opus L1)

**Adopted**: documented as residual in §Section 3. Storage inconsistency (pending trust + no records) recovers on next service init via scan re-emit.

### L2. Lock primitive has no tests (codex L1)

**Adopted**: add a Phase -1 to write `wallet-core/utils/lock.test.ts` covering FIFO ordering, force-release, double-leave, finally-release after thrown work. Pin Lock behavior BEFORE making the refactor depend on it.

### L3. 60+ tests claim is stale (opus L3)

**Adopted**: plan reworded to "all 60+ scenario tests" → "all existing scenario tests".

### L4. Phase 4 doesn't document first-note-only pending emit (opus H1, downgraded)

**Adopted**: Phase 4 description updated to note the trust emit happens only on first note's locked section in a poll.

## Adopted vs rejected summary

**Adopted (12)**: C1 (drop eviction), C2 (isWiping semaphore), H1 (onAccountDeleted Phase 3.5), H2 (keep getRecord re-check), H3 (no new emits), H5 (tx-hash re-check per note), H6 (token re-read in replay), M3 (F7 reword), L1 (document residual), L2 (Lock tests), L3 (test count reword), L4 (Phase 4 doc).

**Surfaced as Ask (3)**: H4 (churn mitigation), H7 (async subscriber throw popup misread), M1 (setTrustState IPC removal).

**Rejected**: none — all findings either adopted or escalated as user decisions.

## Plan.md changes summary

- §Phase 0: drop refCount + eviction. Add `isWiping: boolean` field. Add a comment on growth bound (~hundreds of entries lifetime).
- §Phase 1: keep per-iteration getRecord re-check in setTrustAllow.
- §Phase 2: re-read `tokens` inside per-row lock.
- §Phase 3: clarify scheduler teardown vs row mutations ordering.
- §Phase 3.5 (NEW): onAccountDeleted migration.
- §Phase 4: re-read outgoing/inflight tx snapshots inside each per-note CS. Add doc on first-note-only pending emit. Drop `isStale` references via lock; replace with `isWiping` check.
- §Phase 5: simplify — sequential per-contract locking (drop `acquireManyTriples` reference).
- §Phase 6: replace 2-pass sweep with `isWiping` semaphore. No new emits.
- §Phase -1 (NEW): wallet-core Lock primitive tests.
- §Section 3: add cross-profile threat analysis explicit. Document churn-flooding threat + defer mitigation. Document SW-restart residual. Document async-subscriber-throw residual.
- §Section 4: reword F7. Add Asks for setTrustState IPC removal + churn-flooding mitigation + async-subscriber-throw popup fix.
- §Section 8 risks: drop "Lock map leak" row (no eviction). Add "isWiping starvation" row + mitigation (await in-flight CS, then sequential wipe).
- §Section 9 OQs: add churn-flooding, setTrustState IPC, async-subscriber-throw.
