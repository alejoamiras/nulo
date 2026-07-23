reject (with blocking findings: queued-journal ownership is unverified; publication is not exact composite-scope)

### Leak

- **BLOCKER — deterministic multi-account misbinding.** Queued creation always assigns `dapp.accounts[0]` (`wallet/services/wallet-sdk/queued-journal.ts:100-155`), while dispatch correctly honors explicit `opts.from = B` (`packages/wallet-bridge/src/dispatcher.ts:642-680`). Claiming validates only stage—not account/network/profile/session (`execution/claim-helper.ts:89-125`)—then stamps the task CID (`dapp-send-executor.ts:207-219`). With session `[A,B]`, a send from B therefore binds B’s task to A’s journal, allowing B’s execution/enrichment under A. Require exact frozen-scope validation before claim/stamp, or derive the queued account using the dispatcher’s `from` rules.

- **BLOCKER — publication scope is incomplete/fail-open.** `journalRecordInScope` ignores `profileId` and accepts a missing journal or active `networkId` (`RecentActivityView.vue:285-295`). Snapshot and synchronous reset are account-only (`:595-603`, `:747-759`). Consequently profile switches with reused addresses, ambiguous legacy rows, and network transitions through `undefined` are not exact-scope isolated. Require present-and-equal profile, network, and account, and reset/capture the composite scope.

- Normal producers mint independent 128-bit CIDs, so accidental collision is negligible. No deterministic CID reuse was found outside the queued-record ownership problem.

### Atomicity

- Transfer’s task-before-journal window is safe because the task remains sender-scoped (`transfer-executor.ts:83-119`). Direct and queued dApp tasks remain unpublished until the stamped journal is observed.
- Queued claim performs `queued→pending` before stamping, so “before first journal transition” is not literally true, but this remains fail-closed.
- `setOperationCorrelation` correctly shares `transitionLock`, preserves first-write, and does not alter FSM/`terminalAt`; terminal stamping is safe (`operation-journal/service.ts:357-379`). Conflicts or swallowed stamp failures hide enrichment rather than publish unscoped content.
- `resnapshotJournal` can overwrite a newer correlation event with a stale snapshot because it has no event-dirty/reschedule guard (`RecentActivityView.vue:595-608`). This is an availability/enrichment loss, not a leak.

### Uncertainties

- **#1:** Security-safe, but a real product narrowing: non-send root `ExecuteOperation` cards remain hidden. It does not regress the merged Phase 1 baseline, but Phase 1a does not restore them.
- **#2/#4/#5:** Safe as described.
- **#3:** No leak; all journal cards remain, but single-slot capture loses enrichment under concurrency.
- **#6:** Ordinary task/journal event order is reactive and safe; the stale-snapshot caveat above makes the broader correctness claim overstated.

### Regression

- Phase 1’s store/composable/e2e code is untouched, and journal cards remain primary.
- Late foreign or concurrent CID-bearing task events can overwrite the single raw slot (`RecentActivityView.vue:626-689`), hiding active enrichment but not creating a card.
- `isMatchingTask` is CID-exact only when both sides have one; the legacy fallback can still false-clear another concurrent task (`recent-activity-handlers.ts:82-92`). No publication bypass results.
- Transfer, Step, BalanceUpdate, and subtasks retain their prior behavior.

### Schema

- `correlationId` is optional in both journal schemas (`operation-journal/spec.ts:220-272`), and the per-row codec still skips invalid rows independently (`operation-journal/service.ts:96-138`). Legacy journal rows parse. Tasks are in-memory and the optional property is backward-compatible.

### What’s solid

- Preallocation and threading are straightforward.
- Ordinary A→B account switching clears/unpublishes synchronously.
- Missing/failed correlation consistently fails closed.
- SW restart safely renders from the scoped durable journal without task enrichment.

Targeted tests could not execute in this read-only audit sandbox because Vitest could not create its `/tmp` directory; the worktree remained clean.