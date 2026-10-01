# Phase 3 — extension consumers

## What landed

- `apps/extension/tests/vitest.setup.ts`: `mockPort` and its maps are gone; `beforeEach` builds a
  `PortRegistry` and stubs `chrome.runtime.connect` with `connectStub`. `emitPortMessage` /
  `capturePortMessage` delegate; `emitPortDisconnect` is new (the old stub registered `onDisconnect`
  listeners into a `vi.fn` and could never fire one). The silent-logger comment lost the two reasons
  that no longer exist (the throw-on-second-port guard, the retry loop) and keeps the one that does.
- `client.ports.test.ts`: local `FakePort` / `PortRegistry` deleted (−96 lines); a `microtask`
  registry. The logger-specific `method === "log"` assertion the local `post()` carried moved into
  the test's `lines()` helper, since the shared fake validates envelope shape only.
- `logger/client.test.ts`: `captureWire`'s inline answering port replaced by a `microtask` registry;
  `sent` became a function over `registry.posted` (the inline version pushed into a captured array).
- The containment test keeps its throwing `chrome.runtime.connect` — the registry's `connectStub`
  always opens a port, so migrating it would stop exercising a failed open.

## G4 check

`git grep 'runtime.connect'` over every `*.test.ts`, `tests/*.ts` and `src/testing/*.ts`: the only
port implementations left are `port-registry.ts` and wallet-core's `FakeBrowserApi` (the injected
`RuntimePort` layer — out of scope by design). The `connect: vi.fn()` hits in component tests are
service-client mocks, not ports.

## Gate

`bun run lint` exit 0 · `bun run typecheck` exit 0 · `bun --cwd apps/extension test` 506 files
passed / 3 skipped, 6269 tests passed (6262 before + 4 client + 2 registry + 1 containment; this run
re-executes the messaging package's tests under the extension's `setupFiles`, so the harness's
import-installed hook still wins over the global stub).
