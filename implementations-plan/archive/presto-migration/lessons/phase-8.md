# Phase 8 — settings Proving page + index row (2026-09-15)

## What landed

- `apps/extension/src/popup/pages/settings/proving.vue` — `SettingsPageShell "Proving"`; the compact `PrestoStatusCard` (`copyFor(state, lastProve, "settings")`, so a remembered denial overlays `available` with "Presto declined Nulo earlier" and the wait-and-resend step); a Details `ItemsContainer` (Presto / Aztec runtime / Connection rows from `detailRowsFor`, `—` on the minimal body, `Blocked` when the browser blocked local access) except when `offline`, where a "Get Presto" external `SettingItem` row takes its place; the explainer line. The page owns an `ExecutionServiceClient`, reads `getLastProveOutcome()` before mount (a rejection leaves the overlay off) and disconnects on unmount. Plain JS `<script setup>` like every other settings page: `SettingItem`'s `#right` slot carries no slot types, so a TS page cannot use it (vue-tsc `TS2339`).
- `settings/index.vue` — the App group gains the `Proving` row (`materialIcon="speed"`, `data-testid="setting-nav-proving"`, `data-status` = the UI state kind) with a live description from `rowDescriptionFor` (`Presto · connected`, `Presto · approval needed`, `In browser · Presto not detected`, …). It shares the page's `getPrestoClient()` (10 s cache) with the proving page.
- `tests/e2e/settings-proving.test.ts` — two smoke cases: Presto available → the `available` card, retry present, no Get Presto row; nothing listening → the index row's `data-status="offline"`, the `offline` card and the Get Presto row.
- `tests/e2e/onboarding-tab.test.ts` — the unused `afterEach` / `beforeEach` imports dropped (a pre-existing lint warning).
- `tests/e2e/fixtures/extension.ts` — `isPrestoProbeNoise`: the console collectors no longer count Chrome's `Failed to load resource: net::ERR_CONNECTION_REFUSED` for the two Presto health URLs. Only those two URLs are exempt; a refused RPC or asset still fails the assertion.

## Debugging log

- **First full smoke: 6 files red on `consoleErrors`, 4 timeouts in `accounts.test.ts`.** Every settings open now probes Presto, and every smoke runner refuses both loopback ports, which Chrome reports as a console *error* — so every test that asserts an empty `consoleErrors` after visiting settings went red at once. The timeouts were downstream of the same failures (retry side-effects), not their own bug: the targeted rerun of `accounts`, `navigation` and `settings-proving` after the fixture filter passed 3/3 files with no timeout. Alternatives rejected: intercepting the probes in every settings test (N call sites for one browser behaviour), or asserting `consoleErrors` loosely in the new test only (would leave every other settings test red).

## Deviations from the plan text

- The Details rows are `SettingItem raw` with the value in `#right` (the repo's pattern for informational rows, e.g. the network popups), not `SettingValue`.

## Gate

| layer | command | result |
|---|---|---|
| lint | `bun run lint` | exit 0 |
| typecheck | `bun run typecheck:all` | exit 0 |
| build (armed) | `VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run build` | exit 0 |
| smoke (page) | `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e -- tests/e2e/settings-proving.test.ts` | 2/2 (plus `accounts` + `navigation` in the same targeted rerun: 3 files passed) |
| smoke (full, armed) | `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` | 32 files passed, 1 skipped, exit 0 |
| pre-PR | `bun run audit:vue` | exit 0 — typecheck:all ∥ test (479 files, 5854 passed, 2 skipped, 7 todo) ∥ lint, then build |

## Owner-only (pending)

The Mac denial check — deny Presto's prompt at a send → Settings → Proving shows "Presto declined Nulo earlier" with the wait-and-resend steps; wait 30 s, send again, choose Allow → the denial clears; screenshots — needs the tray app on the owner's Mac. The denied overlay itself is unit-covered (`presto-ui-state.test.ts`: "available + a remembered denial").
