# Phase 3 — `WindowPort` grows `update` + `getLastFocused`; `create` accepts `left/top`

Date: 2026-09-05 · branch `dapp-popup-cancel-focus/focus` (stack layer 2 on `worktree-dapp-popup-cancel-focus`)

## What shipped
- `packages/wallet-core/src/ports/window-port.ts`: `CreateWindowOptions.left/top` (signed desktop
  coordinates), `WindowBounds`, `UpdateWindowOptions { focused?, drawAttention?, state?: "normal" }`,
  `WindowPort.update(windowId, options)` (rejects on a closed id), `WindowPort.getLastFocused()` (never
  throws; `undefined` when none / lookup fails). Both new types exported from `ports/index.ts`.
- `ChromeWindowsAdapter`: `update` → `chrome.windows.update`; `getLastFocused` →
  `chrome.windows.getLastFocused({ windowTypes: ["normal"] })`, `undefined` on throw or when any of
  the four bounds is non-numeric.
- `FakeWindowsAdapter`: records `creates` and `updates`, settable `lastFocused`, `update` rejects on a
  non-live id; `reset()` clears all three.
- Tests: `fake-browser-api.test.ts` (records + closed-id rejection + `lastFocused` round-trip); NEW
  `apps/extension/src/core/adapters/chrome-browser-api.test.ts` driving `new RealChromeBrowserApi().windows`
  against a per-test `chrome.windows` stub: `windowTypes: ["normal"]` forwarded + bounds returned;
  rejecting lookup and partial bounds → `undefined`; `update` forwards id + options.

## Validation gate (as run)
- `bun run --cwd packages/wallet-core typecheck` → exit 0; `bun run --cwd packages/wallet-core test` → 20 files, 244 tests, exit 0.
- `bun run --cwd apps/extension typecheck` → exit 0. `bun run lint` → exit 0.
- `bun run --cwd apps/extension test src/core/adapters/chrome-browser-api.test.ts` → 3/3, exit 0 (codex r3 condition).

## Lesson
- The suite-wide `chrome` stub (`tests/vitest.setup.ts`) has no `windows` key, so an adapter test installs
  its own via `vi.stubGlobal("chrome", { ...globalThis.chrome, windows: {...} })` per test; the
  `beforeEach` in the setup file re-stubs the base object before each test, so no manual restore.
