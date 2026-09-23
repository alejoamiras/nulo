# Phase 1 — Host the PXE page in a frame of the background page

## What shipped

The three Firefox branches of `apps/extension/src/wallet/utils/offscreen.ts` now create, probe and close an
`<iframe>` of the background page instead of a minimized window. The tracker is
`firefoxOffscreenFrame: { element, generation }`; `isLiveOffscreenSender` matches READY *and* PONG against the
live frame's `?instance=` generation on Firefox and reduces to the exact-URL check on Chrome. Deleted:
`OFFSCREEN_ADOPT_INSTANCE`, `isSupersededByAdopt`, the per-background-lifetime token, the window tracker and
the self-close listener in `src/offscreen/index.ts` (a frame cannot outlive the document that owns it). The
Firefox pass fence went with the window: appending a frame is synchronous, so there is no gap between the
create and the tracker assignment for a timed-out pass to race into. Chrome's branch is byte-identical.

Comments corrected to the live behaviour in `offscreen.ts`, `sender-auth.ts`, `manifest.firefox.config.ts` and
at the heartbeat in `runtime.ts` (on Firefox it is also what keeps the PXE host alive).

## Unit suite

`offscreen.test.ts`: the adopt suite is gone; the Firefox suite runs on the extension's real jsdom `document`,
one case per failure mode from the change map, plus the captured frame sender shape (`contextId`, `documentId`,
`envType`, `id`, `origin`, `url` — no `tab`, no `frameId`) on READY/PONG and the background-page shape on PING.

Two traps in that suite, worth knowing before touching it:

- `offscreenUrl()` memoizes the first `chrome.runtime.getURL` it sees, and the Chrome suite runs first in the
  file — so the Firefox cases derive their URL from `offscreenUrl()` (lazily, inside the tests: the setup
  stub's `getURL` is a bare `vi.fn()` returning `undefined`, and a collection-time call would memoize that and
  red the Chrome suite). Hardcoding `moz-extension://…` refused every frame sender.
- The single-flight gate is module state. A case that fails before its READY is delivered leaves
  `ensureInFlight` pending for 10 s of *real* time, and every later case in the file joins that stale pass and
  reports "no frame attached". The first failure is the only real one.

`document.body.innerHTML = ""` in `beforeEach` is what isolates cases: it detaches the previous case's frame,
which the tracker must notice on its own (`isConnected`) — the isolation is the behaviour under test, not a
reach into module state.

## Gate

| Command | Result |
|---|---|
| `bun run lint` | exit 0 (one formatting diagnostic on the new suite, fixed with `biome format --write`) |
| `bun run typecheck:all` | exit 0 — nothing else imported the deleted exports |
| `bun run --cwd apps/extension test -- src/wallet/utils/offscreen.test.ts src/wallet/services/pxe/client.test.ts` | 25 passed (2 files) |
| `bun run test:all` | exit 0 — every workspace green; extension 542 files / 6844 tests |
| `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts --retry=0` | exit 0 — 1 passed, spec 21.3 s (masked fixture still in place; the frame host serves the send) |
| `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts --retry=0` | exit 0 — 1 passed, spec 18.9 s |

Each e2e ran alone on the host, after `test:all` had finished. The `[aztec-node] Error: Address already in
use` line early in each sandbox boot precedes a healthy node start in both runs and comes from the sandbox
process, which no extension code reaches; it is not from this change.
