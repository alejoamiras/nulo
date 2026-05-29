# v3 implementation — phase notes

## Implementation ordering decision (deviates from plan phase NUMBERS)

Plan phases are logical groupings. Implementation ORDER is chosen for commit safety:

**Phase 0 (dead-hook fix + integration test) → Phase 2 (ExecutionMutex) → Phase 1 (move baton release to approval) → Phase 3 (cancel + heartbeat) → Phase 4 (e2e) → Phase 5 (QA/PR).**

Why mutex (P2) before baton-move (P1): moving the baton release to popup-approval turns ON execution concurrency. Without the mutex already present, that intermediate state is the "naive v3 = broken" row (T2 rejected on stale notes). Landing the mutex first means the baton-move transitions safe→safe, never through broken — even at per-commit granularity (bisect hygiene). Codex's "Phase 0 first" guidance is about the dead-hook baseline + integration test, which still goes first; only the P1/P2 relative order is swapped.

## Refined sequencing after reading the code

Confirmed during research: "fixing the dead hook" by making the after-build release fire would ITSELF land the broken intermediate (T2 builds/simulates against stale private notes while T1 proves, no mutex). So the wiring fix cannot be made safe before the mutex. Final order:

1. **Phase 2 (ExecutionMutex)** — pure abortable FIFO mutex + wire into both send paths; claim-after-acquire; pre-acquire controller; key (profileId, chainId). Inert while the baton still serializes at handler-completion (uncontended acquire) → all existing tests stay green. Riskiest piece → codex-audit before moving on.
2. **Phase 1+0 (release rewire + integration test)** — remove dead `onTxRequestFinalized`; add `onInteractionApproved` fired from approve/silent seams; wire `releaseFifo`; add the integration test (green + SAFE now that the mutex exists).
3. **Phase 3 (cancel + heartbeat).** 4. **Phase 4 (e2e).** 5. **Phase 5 (QA/PR).**

Heartbeat layering decision: the reaper (operation-journal layer) must NOT pull from the mutex (execution layer) — that's a layer violation. Instead the ExecutionService drives the heartbeat: it owns a `Set<jobId>` of records currently waiting/holding the mutex and a timer that calls a new lightweight `OperationJournalService.touchOperation(id)` (bumps `updatedAt`) on each. The mutex stays pure (key-based FIFO + abort), unaware of jobIds.

There is no `background.test.ts` today — the baton is only covered by `session-baton.test.ts` as an isolated primitive with manual `releaseFifo()` calls. That is exactly why the dead hook slipped through; Phase 1's integration test closes it.

## Phase 2 — ExecutionMutex

- **2a** (commit): pure `ExecutionMutex` primitive + 11 unit tests. Abort-correct FIFO chain; the subtle case (abort a middle waiter without stranding the successor or letting it jump the holder) is the abort→`prior.finally(release)` splice.
- **2b** (commit): wired into both send paths. `resolveExecutionMutexKey(networkId)` → `(profileId, chainId)` matching the PXE chainGuard. `acquire` before claim + any PXE work; `releaseSlot()` in the existing `finally`; claim moved after acquire (so a future waiter stays `queued`). Uncontended while the baton still serializes at handler-completion → behavior-neutral. Verified: typecheck ✓, 163 execution tests ✓, audit:vue ✓.
- Deferred to Phase 3 (they only matter once waiting can happen, i.e. after the baton moves): pre-acquire abort controller for cancel-during-wait, and the stage-agnostic heartbeat. Importing `ExecutionMutexAbortError` deferred too (unused until the abort-mapping lands) to avoid an unused-import lint error.

Key granularity decision: keyed `(profileId, chainId)` NOT `networkId`. If a profile ever holds two network rows for one chainId, keying by networkId would under-serialize vs the chainGuard (which keys by profileId+chainId). Paying one extra `getNetwork` lookup before acquire (metadata-only, non-PXE) buys exact-match correctness.
