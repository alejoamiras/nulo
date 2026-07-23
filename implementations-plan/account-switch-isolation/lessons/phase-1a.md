# Phase 1a — atomic task↔journal correlation (re-enable dApp progress cards, scoped)

## Protocol
Preallocated `correlationId` (128-bit hex) minted at the START of a feed-eligible ROOT op, threaded to BOTH
the in-memory task and the durable journal record (journal cid = the durable anchor; task = enrichment).
- **Transfer (task→journal):** both ids in `transfer-executor.ts` → set at creation, no window.
- **dApp send (`execution/service.ts` executeOperations):** cid stamped on the root `ExecuteOperationContent`
  task; `DappSendExecutor` reads `parentTask.correlationId` and stamps the journal the instant its id is known
  (after `beginJournal`/`claimOrCreateJournal`, before first `markJournal`) via the new idempotent
  `OperationJournalService.setOperationCorrelation` (first-write-wins, takes transitionLock, emits Updated).
- **Durable field:** `OperationRecord.correlationId?` (+ Task/WrappedTask/NewOperationInput.correlationId?),
  ALL optional + Zod `.optional()` → legacy rows/tasks parse unchanged, no migration (pre-production).

## Publication gate (RecentActivityView.vue) — the fail-closed re-enable
`isExecutingTask` split into a capture gate (`isRawExecutingCandidate`→`rawExecutingTask`) + a reactive
publication gate: `executingTask` is now a COMPUTED that publishes a dApp task ONLY when its cid resolves to a
NON-terminal journal in the ACTIVE scope (`journalRecordInScope` = account+network). Reactive → publishes the
moment the journal arrives (even after the task event); un-publishes synchronously on switch (journalOps
sync-cleared). UI transfers stay senderAddress-scoped. `isMatchingTask` cid-exact when both carry it.
SW-restart: durable journal cid renders the card via `renderedInFlightOps` on its own (no task = no leak).
Scope narrowing: only root feed tasks get a cid; Step/BalanceUpdate/subtasks exempt.

## Verification: 3494 tests (+21), typecheck:all 0, 19 files lint-clean.

## Flagged for the codex audit (subagent-reported uncertainties)
1. Behavioral narrowing: non-send ExecuteOperation tasks (register_sender/contract/token) no longer render a
   progress card (no dapp_execute journal → fail-closed). Safer (they carry no account); register_token still
   surfaces via its token_import journal. Confirm acceptable.
2. Stamp-after-create is best-effort (swallows errors) → lost stamp = permanently fail-closed (no leak, but no
   subtask enrichment for that op).
3. Single-slot rawExecutingTask under concurrent same-account dApp ops (pre-existing single-executingTask limit;
   both journal CARDS still render; cid-exact isMatchingTask targets the right one).
4. setOperationCorrelation allowed on terminal records (cid orthogonal to FSM; no stage change).
5. Reactive-computed forward references (executingTask computed forward-refs isFeedEligible/journalOps —
   hoisted fn decl + lazy computed; validated by the component test).
6. Correctness independent of task/journal event ordering (reactive gate re-evaluates on journalOps change).
