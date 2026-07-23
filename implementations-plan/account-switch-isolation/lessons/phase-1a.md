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

## Codex Phase-1a audit REJECT → fixed (2 blockers). audit-codex-p1a.md.
BLOCKER 1 (multi-account misbinding, real leak): queued-journal used dapp.accounts[0], so a session-[A,B]
send from B bound B's task to A's journal. FIX (b) at root: queued-journal.ts `extractSendFrom(message)`
derives the record's accountAddress from the actual send `from` (message.args[1].from, dispatcher rules) —
explicit+authorized from → that account; NO_FROM/omitted → accounts[0]; from outside session → not queued.
FIX (a) defense-in-depth: claim-helper refuses a claim whose defined accountAddress != the send's account +
creates a fresh correctly-scoped record. Fixes both journal-card AND cid-enrichment leak.
BLOCKER 2 (publication fail-open): added strict `journalInActiveScopeStrict` (profile+network+account all
present+equal) for the isFeedEligible dApp gate; switch-reset watcher + snapshot guards now key on the
COMPOSITE scope. Lenient display `journalRecordInScope` left as-is (legacy-row leniency, display-only).
Deferred (non-blocking, enrichment-only): resnapshotJournal stale-snapshot reschedule guard.
Tests +11 (queued-journal 4, claim-helper 3, strict-scope 4); full suite 3505; typecheck:all 0; lint 0.

## Codex re-audit r2 → fixed 2 remaining gaps (r3 pending). audit-codex-p1a-r2.md.
GAP1 NO_FROM default mismatch: dispatcher (dispatcher.ts:1349-1385) resolves NO_FROM as
allAccounts.find(a=>session.has(a.address)) in INDEX-SORTED WALLET order, not session order. queued-journal
now mirrors that (walletAccounts.find over session intersection); no-wallet-in-session → skip. GAP2 profile
TOCTOU: claim-helper now validates the FULL composite scope (account+network+profile), refuses + DELETES the
mis-scoped record + creates fresh on any mismatch; execution-lane threads getActiveProfile()?.id at claim time.
+10 tests; full suite 3509; typecheck:all 0; lint 0.

## Codex re-audit r3 → fixed 2 concurrency issues (r4 pending). audit-codex-p1a-r3.md.
FIX1 resurrection race: deleteOperation + setOperationMeta now acquire the transitionLock → a concurrent
locked mutator either completes before the delete or finds nothing (every locked writer refuses to recreate
a missing row). claim-helper supersede-delete stays best-effort but resurrection is now structurally impossible.
FIX2 fence-profile TOCTOU: ExecutionFence.profileId (captured at authorize) threaded through
dapp-send-executor→execution-lane→claim-helper; removed the claim-time getActiveProfile re-read. Attack
(queue P1 → fence P2 → switch back P1 → claim) now REFUSES (record P1 vs captured fence P2). +7 tests; 3516 green.
