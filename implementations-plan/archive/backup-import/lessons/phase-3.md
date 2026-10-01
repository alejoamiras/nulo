# Phase 3 · Retry the networks that did not restore (B3, recommended O1 (B))

P2's commit, the base option (A) is captured at: `e6380efc`.

## Red first (base `e6380efc`)

From `apps/extension`:

- `bun --bun vitest run src/composables/useFullBackupImport.test.ts -t "Retry the networks"`: exit 1,
  7 failed (81 skipped by the filter). Every case fails on the missing members:
  `TypeError: undefined is not an object (evaluating 'c.canRetryAccountState.value')` and
  `c.retryAccountState is not a function`. The fake-clock cases got through the first run on the
  base (the stalled network's deadline row was written) before failing there, so the harness drives
  the real tail.
- `bun --bun vitest run src/onboarding/pages/import.test.ts src/popup/pages/import-helpers.test.ts`:
  exit 1, 2 failed and 10 passed. Onboarding: `Unable to get
  [data-testid="import-full-backup-retry-btn"]`. The popup's Enter helper: `expected 'continue' to
  be null` (Enter continued past the errors screen while a Retry ran).

## Change

- `full-backup-restore.ts`: `restoreAccountStateStage` resolves with an `AccountStateRetryContext`
  (the seeded networks, the retryable networks' normalized items, and the outcome rows the run
  wrote) when a network is left retryable. `retryAccountStateStage` replays those items on fresh
  `AccountStateServiceClient` and `NetworkServiceClient` connections, closed when it settles, and
  swaps only the retried networks' outcome rows for its own. `RestoreIo.recordRestoreErrors` now
  returns the rows it appended, which is how the stage knows its outcome rows.
- `useFullBackupImport.ts`: `canRetryAccountState`, `isRetryingAccountState`, `retryAccountState`
  and `dispose`. The replacement is one assignment of the log (the emptied key deleted), with
  identity compared on raw rows: the log is deep-reactive, so rows read back are proxies. A
  violation row naming the same network, and the reseed stage's dropped-row records under the
  same key, are never touched. A clean Retry completes through the same isolated
  `completeAfterRestore` as a clean restore. A reset, a new import and `dispose` drop the context;
  a Retry that settles afterwards writes nothing and completes nothing.
- `useProfileImportFlow.ts` passes the three members through and its `dispose` drops a running
  Retry. Both pages render Retry (`import-full-backup-retry-btn`, outline, above Continue); while
  it runs it reads `Retrying…` (popup) or `Retrying...` with the spinner (onboarding), and Retry,
  Continue and View Errors are disabled. The popup's Enter shortcut no longer continues while a
  Retry runs.
- The record kind is an inline union again, so the tail adds nothing to the auto-import
  declarations; the build adds only `retryAccountStateStage` and `AccountStateRetryContext`.
- The onboarding page test wraps the real composable and stubs only the three Retry members:
  reaching a retryable state for real takes a whole restore, which the composable suite owns.

## Gate

- `bun --bun vitest run src/composables/ src/wallet/services/account-state/ src/onboarding/pages/import.test.ts`
  (from `apps/extension`): exit 0, 45 files, 740 passed, 0 skipped. Also
  `src/popup/pages/import-helpers.test.ts`: 7 passed. The Retry block ran six times in a row
  green (7 of 7 each).
- `bun run lint`: exit 0 (the same 29 pre-existing warnings; complexity-baseline check OK; no
  complexity finding).
- `bun run typecheck:all`: exit 0, every workspace.
- `bun run build`: exit 0. `apps/extension/src/types/` changes only by `retryAccountStateStage`
  and `AccountStateRetryContext` (`auto-imports.d.ts` and `.eslintrc-auto-import.json`);
  `components.d.ts` unchanged.
