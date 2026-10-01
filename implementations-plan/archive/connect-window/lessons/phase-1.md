# Phase 1 · The window port can navigate

## Red first (unfixed code, the base's tree for these files)

- `bun --bun vitest run src/core/adapters/chrome-browser-api.test.ts` (from `apps/extension`):
  exit 1, 2 failed / 11 passed. Both new cases: `TypeError: windows.navigate is not a function`.
- `bun --bun vitest run src/testing/fake-browser-api.test.ts` (from `packages/wallet-core`): exit 1,
  1 failed / 10 passed: `api.windows.navigate is not a function`.

## Build

- `WindowPort.navigate(windowId, url)`, TSDoc as § Key interfaces.
- `ChromeWindowsAdapter.navigate`: `chrome.tabs.query({ windowId })`, then `chrome.tabs.update` on
  the first tab; no tab rejects with a fixed `Error("window has no tab")`. The header's note 4
  now names the two tabs calls as permission-free (Inference 1; P6 is the proof on both engines).
- `FakeWindowsAdapter.navigate` records `{ windowId, url }` in `navigates` and rejects for an id it
  does not hold, like `update`; `reset()` clears it. `fakeSdkPorts` gains an inert `navigate`.

## Gate

- `bun --bun vitest run src/core/adapters/chrome-browser-api.test.ts`: exit 0, 13 passed.
- `bun --bun vitest run src/testing/fake-browser-api.test.ts` (wallet-core): exit 0, 11 passed.
- `bun run typecheck:all`: exit 0 (every workspace).
- `bun run lint`: exit 0 (29 warnings, 3 infos, all pre-existing; complexity-baseline check OK).
