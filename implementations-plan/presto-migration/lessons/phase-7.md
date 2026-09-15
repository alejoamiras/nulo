# Phase 7 — onboarding `presto.vue` (2026-09-15)

## What landed

- `apps/extension/src/onboarding/pages/presto.vue` replaces `accelerator.vue` (route `/onboarding/presto`; `learn.vue` / `fees.vue` retargeted). `offline` renders the `<presto-banner variant="card" fonts="none">` pitch inside a wrapper that maps every `--pb-*` token onto Nulo's (`--app-bg`, `--nulo-surface`, `--nulo-accent`, `--txt-inverse`, the headline/body fonts), with "Installed it already? Test again" and the Skip link under it; every other state renders `PrestoStatusCard` with `copyFor`; Continue only on `available` / `downloading`, Skip on the settled warn states, nothing while detecting. The `available` card carries the line "Presto will ask you to allow Nulo the first time you send" (the prompt is at the first prove, not now).
- Banner wiring: `:status.prop="bannerStatus"` (the element renders nothing until `status` is set — no flash of the pitch for installed users); `presto-banner:retry` → `detect({ forceRefresh: true })` and `presto-banner:dismiss` → Skip, attached on a wrapper `<div>` that stays mounted (the banner itself is under `v-if`); `clearDismissal("presto:banner:card:offline")` on mount because a profile reset clears `chrome.storage`, not the page's localStorage; `theme` follows the `<html theme>` attribute app.vue resolves.
- The arc-1 shim is gone: `useAcceleratorStatus.ts` / `.test.ts` deleted; the generated `auto-imports.d.ts` / `.eslintrc-auto-import.json` regenerated on the build (one stale `const useAcceleratorStatus` declaration survived the regeneration and was removed by hand — the generator merges rather than rewrites that block).
- `reset.vue` comment names Presto.
- `tests/e2e/onboarding-tab.test.ts`: an `interceptHealth({ https, http })` helper answers both probes per scheme; the happy path settles on the pitch or a terminal card; cases: available → Continue (Skip absent); both refused → pitch visible, no card, Skip → `/done`; HTTPS refused + detailed HTTP body without `https_port` → `secure-connection-unavailable` with `data-diagnosis="https-disabled"` and 3 steps; HTTPS refused + minimal HTTP body → `data-diagnosis="presto-reachable"`; the split-handler skip pin now targets `/presto`.

## A4 / A8 measurement (eager static closure of the onboarding entry)

Both trees built with `vite build -c vite.chrome.config.mts --manifest --outDir dist/a4` (the CLI flag instead of a config flip; no sourcemap needed for a closure walk). The baseline is `origin/dev @ 323380f6` extracted with `git archive` into a scratch directory and installed with `bun install --frozen-lockfile --ignore-scripts` (the `prepare` hook needs a git dir). The walk follows the manifest's `imports` (static) from `src/onboarding/index.html`, ignores `dynamicImports`, and sums gzip sizes:

| build | files | raw | gzip |
|---|---|---|---|
| baseline `323380f6` | 60 | 1634.1 kB | 525.5 kB |
| P7 (`presto-migration/ux`) | 60 | 1634.3 kB | **525.6 kB** |

Delta **+0.1 kB gzip** — under the 60 kB budget by two orders of magnitude, because the page chunk (and with it `@alejoamiras/presto-banners` / `presto-core`) is a route-level dynamic import: the eager closure is identical chunk for chunk (`utils-DHSpaevO`, `aztec-address-DOOOXvOt`, …). The pre-existing eager weight is the `@aztec` surface (`utils` 188.9 kB gz, `aztec-address` 74.5 kB gz), unchanged by this plan.

## Gate

| layer | command | result |
|---|---|---|
| lint | `bun run lint` | exit 0 |
| typecheck | `bun run typecheck:all` (extension `vue-tsc`) | exit 0 |
| build | `cd apps/extension && bun run build` | `BUILD_EXIT=0` |
| smoke (page) | `bun run test:e2e -- tests/e2e/onboarding-tab.test.ts` | 9/9, `E2E_EXIT=0` |
| smoke (full, plain build) | `bun run test:e2e` | 29 files / 112 tests passed, 2 files skipped; 1 failed: `backup-migration.test.ts` "fixture-arming contract" — the harness contract that a repo build must be armed with `VITE_NULO_E2E_MIGRATION_FIXTURE=1` + `NULO_E2E_MIGRATION_FIXTURE=1` (unrelated to this plan) |
| smoke (backup-migration, armed build) | `VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run build` then `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e -- tests/e2e/backup-migration.test.ts` | 3/3, `E2E_EXIT=0` — with the plain run above, every smoke file is green on this tree |
| residue | `grep -rn "aztec-accelerator\|AcceleratorProver\|ACCELERATOR_\|useAcceleratorStatus\|onboarding-accelerator" packages apps --include=*.ts --include=*.vue --include=*.mts` | 0 hits |
| A4 | above | +0.1 kB gzip |
| manual | `send-to-mac apps/extension/dist/chrome` (the plain P7 build) | sent to the owner's MacBook via Taildrop |

## Owner-only (pending)

The Mac walk — load the unpacked build, walk the onboarding states with the real tray app (Presto quit → pitch; Encrypted Connection off → the encrypted-connection card; on → connected; approval prompt approved at the first send) — with screenshots and the observed `Origin` header from Presto's log, cannot be driven from this machine (`send-to-mac` is Taildrop-only by design). It stays an open item in the wrap-up until the owner records it here.
