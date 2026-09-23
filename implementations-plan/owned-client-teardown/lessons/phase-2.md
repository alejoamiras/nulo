# Phase 2 — one logger per document

## What changed

- `logger/client.ts`: the class is module-private and takes the context per call;
  `documentLogger(context?)` returns a context-bound `ILogger` view over one shared client;
  `_resetDocumentLoggerForTests()`.
- 20 service-client constructors → `documentLogger()`; `console-forwarding.ts` → `void`, context
  typed `"popup" | "onboarding"`; `offscreen/index.ts` → `documentLogger("offscreen")` for the console
  and `documentLogger()` for the PXE runtime; `logger/service.ts` header comment.
- `tests/vitest.setup.ts`: the silent-logger `vi.mock`; `logger/client.test.ts` rebuilt on a
  `chrome.runtime.connect` capture that answers every request (positive Error/Note assertions kept,
  now observed after `jsonSanitize`); `console-forwarding.test.ts` mocks `documentLogger`; the proof
  test gained S3 (held line rejected on a remote close, one replacement port) and S4 (four tags on
  one port; the reset opens a new one).
- `ARCHITECTURE.md` §3: one sentence.

## Proof test after the fix

`bun run test src/wallet/services/logger/client.ports.test.ts src/wallet/services/logger/client.test.ts src/wallet/logger/console-forwarding.test.ts`
→ 3 files, 12 tests passed. S1 and S2 now hold `{ live: 1, opened: 1, localDisconnects: 0 }` with the
same port object under every line and every request answered.

## Gate

- `bun run typecheck:all` — every workspace exit 0.
- `bun run test:all` — exit 0 (extension: 502 files, 6120 passed / 4 skipped / 7 todo; every other
  workspace green).
- `bun run lint` — exit 0. `bun run build` — exit 0.
- `git grep -n "new LoggerServiceClient(" -- apps packages` → only
  `apps/extension/src/wallet/services/logger/client.ts:48` (the module's own construction).
- Sourcemap chunk check (`vite build -c vite.chrome.config.mts --sourcemap`, then the map counter
  from plan.md): `assets/client-CsZOB1Mu.js.map`, `maps=1`. That chunk is a shared common chunk
  (the extension-messaging base classes, `wallet/logger/store.ts` + `utils.ts`, `logger/spec.ts`,
  `logger/client.ts`) which the service-worker entry (`assets/index.ts-*.js`) also imports for the
  base classes — no service-worker file imports the logger client module (grep), and the module's
  top level is a class declaration and a `let`, so loading the chunk opens nothing. The module is
  emitted exactly once, which is what I1 needed.

## Notes

- Returning the request promise from the view (D30) is what let S3 await the rejection directly;
  TypeScript accepts a returned promise against `ILogger.log`'s `void`.
- The setup-file mock spreads `importOriginal`, so `DocumentLogContext` and the reset stay
  importable in tests that don't unmock.
