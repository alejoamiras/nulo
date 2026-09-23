# Phase 1 — `WindowManager.cancel` carries an `Error`; Reject reaches the dApp as 4001

Date: 2026-09-05 · branch `worktree-dapp-popup-cancel-focus`

## What shipped
- `window-manager.ts`: `cancel(handleId, reason: string | Error)`; the handle's `reject` is typed
  `unknown` and `_settle` forwards the value untouched. String callers unchanged.
- `dapp-interaction/service.ts`: `rejectInteraction` wraps its reason in `UserRejectedError`.
- `wallet-sdk/error-envelope.ts`: `UserRejectedError` → `{ code: 4001, data: { walletErrorCode: "USER_REJECTED" } }`.
- Tests: window-manager (Error instance round-trips + `windows.remove`), envelope (`USER_REJECTED`),
  dapp-interaction (`rejectInteraction` hands the manager a `UserRejectedError`), wallet-bridge
  dispatcher (capability-reject fixture throws the typed instance; the dispatcher rethrows the SAME
  instance while still persisting the rejection).

## Validation gate (as run)
- `bun run --cwd apps/extension test src/wallet/services/window-manager src/wallet/services/wallet-sdk/error-envelope.test.ts src/wallet/services/dapp-interaction` → 4 files, 62 tests, exit 0.
- `bun run --cwd packages/wallet-bridge test` → 9 files, 241 tests, exit 0.
- `bun run --cwd apps/extension typecheck` (vue-tsc) → exit 0; `bun run --cwd packages/wallet-bridge typecheck` → exit 0.
- `bun run lint` (root biome + complexity baseline) → exit 0 (30 pre-existing warnings, none in the touched files).

## Lesson
- Root `bun run typecheck` (`vue-tsc --project apps/extension/tsconfig.json`) exits 127 in a fresh
  worktree: `vue-tsc` is not a root devDependency and the isolated linker does not hoist it to the root
  `.bin`. The equivalent, and what CI's `typecheck:all` fans out to, is `bun run --cwd apps/extension typecheck`.
  Every gate in this plan uses the `--cwd` form from here on. Worth a root-script fix in a separate PR,
  not this one.
