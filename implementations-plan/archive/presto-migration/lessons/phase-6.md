# Phase 6 — status client, UI-state mapper, custom element (2026-09-15)

Arc 2 starts here, on `presto-migration/ux` (stacked on `worktree-presto-migration` via `gh stack init --base dev worktree-presto-migration` + `gh stack add presto-migration/ux`; `gh stack` 0.1.0 has no `--adopt` flag — existing branches are adopted by name).

## What landed

- `apps/extension/src/utils/presto-ui-state.ts` — `uiStateFromStatus` (kind = `stateFromStatus`, so the banner and the card agree; `unconfirmed` → the `offline` pitch; `info` carries the detailed-body facts and is empty on the minimal body), `copyFor(state, last?, surface?)` (Presto's `STRINGS` titles + Nulo's numbered steps; the denied overlay from `LastProveOutcome.denial`; `surface: "settings"` selects the compact permission-blocked copy and drops the runtime/connection from the connected line, which the Details rows carry), `rowDescriptionFor` (the settings index row), `detailRowsFor` (the Details rows, `—` on the minimal body). Copy carries a `tone` (`pending | go | accent | warn | off`) so the card's colour is decided in one place.
- `apps/extension/src/composables/usePrestoStatus.ts` — C1 shape over the arc-1 `getPrestoClient()`: injected client, `state` / `bannerStatus` / `detect({ forceRefresh })` / `dispose()`; a generation counter drops a late result after a newer probe or after `dispose()` (`PrestoClient` has no abort); a throwing probe becomes Presto's `error` state rather than a stuck `detecting`.
- `apps/extension/src/components/PrestoStatusCard.vue` — the status card both shells render (flat in `src/components/`, cross-shell); `compact` for settings; `data-status` / `data-diagnosis` on the testid root for the e2e.
- `vite.config.ts` — `isCustomElement: (tag) => tag.startsWith("presto-")`; the generated `auto-imports.d.ts` / `components.d.ts` / `.eslintrc-auto-import.json` picked up the new composable and component on the build.

## Deviations from the plan text

- `PrestoUiState` has an `idle` arm (before the first probe) in addition to `detecting`; both render "Looking…".
- `copyFor` takes a `surface` argument: the approved artboards use different permission-blocked copy and a shorter connected line on the settings page, and one function with a switch beats two copies.

## Gate

| layer | command | result |
|---|---|---|
| unit | `presto-ui-state.test.ts` + `usePrestoStatus.test.ts` + `PrestoStatusCard.test.ts` | 59/59 |
| unit (all workspaces) | `bun run test` | 480 files passed, 2 skipped; 5864 tests passed |
| typecheck | `bun run typecheck:all` | exit 0 (after typing the card test's factory) |
| lint | `bun run lint` | exit 0 |
| build | `cd apps/extension && bun run build` | `BUILD_EXIT=0` |
