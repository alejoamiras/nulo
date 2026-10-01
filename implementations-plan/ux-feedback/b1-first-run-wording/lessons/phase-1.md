# Phase 1 · Account names

- `DEFAULT_ACCOUNT_NAME` → `"Account 1"`; the New Account popup's loop moved unchanged into
  `nextAccountName` (`apps/extension/src/utils/account-name.ts`), whose test pins
  `nextAccountName([]) === DEFAULT_ACCOUNT_NAME` and exact-string matching (as before).
- Unit pins updated: `account/service.test.ts`, `popup/network-switch.test.ts` (×2),
  `useProfileBootstrap.test.ts` (mock).
- e2e: `FIRST_ACCOUNT_NAME` beside `exportAccountBody` in `tests/e2e/helpers/account-io.ts`; the 12
  callers use it (6 files, 2 of them network). Other `"Account"` literals checked and left: the
  synthetic backups in `import-drivers.ts` and `passkey-backup.test.ts` name their own restored
  account; `export/account.vue`'s fallback title is not the default name.

Gate:

- `bun run lint` → exit 0 (30 warnings, 5 infos, none in changed files).
- `bun run typecheck:all` → exit 0.
- `bun run test:all` → exit 0 (16 workspaces).
