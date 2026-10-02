# Round 2 audit response

Round 2 audits in `audit-codex.md` (Reject) and `audit-opus.md` (Reject) converged on the same critical issues. User pivoted to a SIMPLER architecture in response: single global service Lock instead of per-triple Map.

## Architectural pivot

**Original choice (Round 1)**: `Map<triple, Lock>` per `(profileId, networkId, contract)`.
**New choice (Round 2)**: single `Lock` instance per service.

Trade-off: scans for different contracts now serialize on the same lock. Mitigation: PXE I/O is OUTSIDE the lock; locked critical sections are repo-bound (~1ms per op). Realistic worst case: 50 notes × 5ms = 250ms total lock-hold. Sub-second.

Inherent simplifications from the pivot:
- No Map → no eviction → no memory growth concern.
- No `isWiping` semaphore → no TOCTOU race.
- No drain pattern → no late-discovered-triple leak.
- No `acquireMany` → no multi-lock acquisition.
- `onAccountAdded` + multi-network `onAccountDeleted` covered trivially (same lock).
- `txDeleteInflight` removal becomes safe (global lock serializes same-hash events).

## Adopted / rejected per Round-2 finding

### Codex Round 2

| Finding | Resolution |
|---|---|
| C1. `isWiping` TOCTOU + isn't enforced by all writers | **Obsoleted** by architectural pivot. No isWiping. |
| C2. Drain only covers triples in `listTrust()` | **Obsoleted** by architectural pivot. No drain. |
| H1. Wipe reopens before scheduler teardown | **Adopted**. Plan §Phase 6 updated: lock held through `hydrateSchedulers()`. |
| H2. Phase 3.5 only wipes one resolved network | **Adopted**. Plan §Phase 3.5 updated: iterate all networks matching the chainId. |
| M1. `txDeleteInflight` removal regression (self-corrected) | **Adopted (corrected)**: global lock serializes same-hash events automatically; double-emit risk gone. Add multi-contract same-hash test. |
| M2. Per-note CS is no longer "repo-bound + sync" | **Adopted**. Plan §Section 4 inferences (I1) downgraded; performance characteristics updated. |
| M3. "No eviction" adversarial growth | **Obsoleted** by architectural pivot. One Lock instance, no growth. |
| L1. Over-anchored on plan framing | **Acknowledged**, addressed via this pivot. |
| L2. Plan internal inconsistency | **Adopted**. Plan rewritten clean. |

### Opus Round 2

| Finding | Resolution |
|---|---|
| C1. `isWiping` TOCTOU | **Obsoleted** by pivot. |
| C2. Drain leaks late-discovered triples | **Obsoleted** by pivot. |
| C3. `txDeleteInflight` cross-contract regression | **Obsoleted** by pivot (global lock serializes). |
| H1. `onAccountAdded` lock coverage missing | **Obsoleted** by pivot (same lock). |
| H2. `isWiping` plain bool destructure risk | **Obsoleted** by pivot. |
| M1. Anchoring on single-PR big-bang | **Acknowledged**; sticking with single PR since the architectural simplification reduces blast radius. |
| M2. Per-triple Map over global Lock | **ADOPTED — the architectural pivot.** |
| M3. Long-running memory growth | **Obsoleted** by pivot. |
| L1. Async-subscriber-throw popup misread | Deferred to follow-up PR (was already an Ask). |
| L2. LR1 test pin specifics | **Adopted**. Test description updated. |

## Plan.md rewrite

Replacing plan.md with the simplified single-Lock architecture. Phases shrink:
- Phase -1: Lock primitive tests (unchanged).
- Phase 0: scaffold `private readonly serviceLock = new Lock(...)` field + `withServiceLock<T>(fn)` helper. Drop Map, isWiping, refCount.
- Phase 1: `setTrustState/Allow/Reject` → wrap in `withServiceLock`. Split public-wrapper / private-locked. Keep per-iteration `getRecord` re-check.
- Phase 2: `replayPendingPrompts` → per-row `withServiceLock`. Re-read tokens + trust live inside.
- Phase 3: `onTokenDeleted` → wrap in `withServiceLock`. Lock held across scheduler teardown + records wipe + trust reset.
- Phase 3.5: `onAccountDeleted` → wrap in `withServiceLock`. Iterate ALL matching networks (not just one).
- Phase 4: `scanContract` → per-note `withServiceLock`. PXE outside lock. Inside: fresh tokens, trust, outgoing+inflight tx hash reads.
- Phase 5: `onTransactionAdded` → wrap in `withServiceLock`. Drop `txDeleteInflight`.
- Phase 6: `clearProfile / clearChain` → wrap in `withServiceLock`. Lock held across the whole wipe + `hydrateSchedulers()`. No isWiping, no drain, no 2-pass. Preserve emit semantics (no new emits).
- Phase 7: test rewrites. Drop LR5 (cross-triple parallelism — no longer guaranteed) and LR6 (no map eviction). Keep LR1-LR4, LR7-LR11.
- Phase 8: post-impl audit + fix loop.

Locked decisions amended:

1. Single-PR big-bang switch (unchanged).
2. **Single global service Lock** (was: Lock-per-triple Map). Using existing `wallet-core/utils/lock.ts`.
3. Current 4-state FSM preserved (unchanged).
4. Actor-only — repo stays last-write-wins (unchanged).

Asks remaining (from Round 1, still open):
- A1. Remove `setTrustState` from public IPC?
- A2. Defer churn-flooding mitigation?
- A3. Defer async-subscriber-throw popup fix?
