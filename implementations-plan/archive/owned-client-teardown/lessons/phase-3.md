# Phase 3 — outer account clients (A3 = fold in)

## Red first (2026-09-17)

`bun run --cwd apps/extension test src/popup/pages/auth.test.ts src/popup/pages/profile/new-profile-helpers.test.ts src/composables/useFullBackupImport.test.ts`
before the fixes: 4 failed / 97 passed — exactly the four new cases.

- `new-profile-helpers.test.ts` › keeps an account client the wallet already holds…:
  `expected "vi.fn()" to not be called at all, but actually been called 1 times` (the constructor).
- `auth.test.ts` › a successful unlock keeps the account client…: same assertion, same cause.
- `useFullBackupImport.test.ts` › is closed again only after reconcileImportedAccounts resolves:
  `expected "vi.fn()" to be called 2 times, but got 1 times`.
- `useFullBackupImport.test.ts` › …when reconcileImportedAccounts rejects: same.

One harness fix on the way: the import file's `beforeEach` never reset `reconcileImportedAccounts`,
so a pending/rejected mock from a new case leaked into the file's later cases. It now resets to
`mockResolvedValue([])` with the other account-client mocks.

## Fixes

- `popup/pages/auth.vue`, `popup/pages/profile/new-profile-helpers.ts`: `managers.account ??= new
  AccountServiceClient()`, each with a one-sentence comment on why the existing client is kept
  rather than disconnected (the network-switch handler may hold it across awaits).
- `composables/useFullBackupImport.ts`: `reconcileImportedAccounts` runs in `try … finally {
  accountService.disconnect() }`; the NOTE that admitted the reconnect is replaced.

## Gate

- The four files (`auth`, `new-profile-helpers`, `useFullBackupImport`, `useFullBackupImport.stages`):
  4 files, 126 passed.
- `bun run typecheck:all`: 15 workspaces exit 0. `bun run lint`: exit 0 (30 warnings, all
  pre-existing — the same count as the Phase 2 run).
