---
plan: harden-dedupe / json-logger-close-guard (arc 19b of the program, split from dapp-windows)
tier: light
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/19b-json-logger-close-guard, stacked on hd/19-dapp-windows
---

# json-logger-close-guard: the json and logger windows close through the guarded helper

The json window (`apps/extension/src/popup/windows/json/index.vue:17-23`) and the logger window (`popup/windows/logger/index.vue:13-19`) close themselves when the active profile goes away, with an unguarded `chrome.windows.remove(window.id)`. Every other dApp window now closes through dapp-windows' `closeCurrentWindow()` (`utils/close-current-window.ts`), which removes only a window that has an id. The program plan pre-clears this guard as a route-2 fix and puts it in its own arc; dapp-windows split it out ("Split out", its section B table). It ships here, on top of that arc.

## Change

Both handlers keep their `if (!profile)` test, and its body becomes one call:

```js
function onActiveProfileChanged(profile) {
	if (!profile) closeCurrentWindow()
}
```

with `import { closeCurrentWindow } from "@/utils/close-current-window"` under each file's `/** Utils */` header (`utils/` is an auto-import root in the build, but the unit tests' auto-import covers only `vue` and `vue-router`, and the dApp windows import it explicitly). Nothing else in either file moves.

### Equivalence apart from the guard

| point | today (both windows) | after |
|---|---|---|
| guard | none: `remove(window.id)` always | `remove(window.id)` only when `window.id` is truthy |
| call shape | `chrome.windows.getCurrent(cb)` | `chrome.windows.getCurrent(undefined, cb)` |
| callback parameter | `window` | `window` (the helper's name) |
| `remove` argument | `window.id` | `window.id` |
| await or microtask before `getCurrent` | none: the handler runs synchronously from the profile event and calls `getCurrent` in the same segment | none: the handler calls the helper synchronously, which calls `getCurrent` synchronously; the helper is not `async` |
| `lastError` path (callback gets no window) | `window.id` throws a `TypeError` naming `window` on JSC and SpiderMonkey (V8: `reading 'id'`); `lastError` stays unchecked | the guard's `window.id` read throws the same `TypeError` from a binding of the same name; `lastError` stays unchecked |
| what reads the close | nothing: the result is ignored. `onClose` runs on `beforeunload`, which the browser fires on a real close either way | the same |

- **The call shape.** `getCurrent(cb)` and `getCurrent(undefined, cb)` are the same call in both browsers' extension bindings: `queryOptions` is optional, and an explicit `undefined` reads as absent. Verify and the approval hook shipped the two-argument form before dapp-windows. The screenshot surface also probes it on the real build of each browser (UI impact): both forms must answer the same window id with no `lastError`.
- **What the guard changes.** A window without an id: today `remove(undefined)` throws inside the callback (the bindings refuse the signature), and the window stays open; after, nothing is called, and the window stays open. `chrome.windows.Window.id` is optional only for windows the sessions API reports, so `getCurrent` from a window this page runs in always has one; the path is not realistic. An id of `0` would also skip `remove`; neither browser assigns window id `0`, and Chrome would refuse `remove(0)` anyway.
- **Not shared differently.** The alternative, an inline `if (window.id)` in each file, would keep a third and fourth copy of the helper's body, which is what dapp-windows removed.

## Security & Adversarial Considerations

- **Who triggers it.** The profile event comes from the background over the profile port; a dApp cannot reach either window's handler. The change only skips a `remove` that would throw; it never closes a window that stays open today, and it never keeps open a window that closes today on a realistic path.
- **Lock behaviour.** A lock or profile deletion still closes both windows: the json window stops showing a dApp's operations, and the logger stops showing logs, exactly as today.
- **Logging.** No log line changes. The one difference on the unrealistic path is that the bindings no longer report a thrown `TypeError`.

## Assumptions

**Facts** (read 2026-10-03 on `hd/19-dapp-windows` at `4a60ce05`):

1. The sites are as cited: json `index.vue:17-23`, logger `index.vue:13-19`; the helper is `utils/close-current-window.ts:2-6`, `getCurrent(undefined, (window) => { if (window.id) chrome.windows.remove(window.id) })`.
2. json registers the handler with `profileService.onActiveProfileChanged.add` (`:36`); logger with `await profileService.subscribeActiveProfile(...)` (`:37`), which also delivers the current state once on subscribe. Neither registration changes.
3. Neither window has a test file today (`ls popup/windows/json popup/windows/logger` lists only `index.vue`).
4. No other `getCurrent` callback form exists outside the helper (`grep -rn getCurrent src`); `onboarding/pages/done.vue:41` and `settings/appearance.vue:123` use the promise form and are out of scope.

**Inferences:** none the design relies on.

**Asks:** none.

## Phases

### Phase 1: red

Before writing, `ls` and `git status` each path. New `popup/windows/json/index.test.ts` and `popup/windows/logger/index.test.ts`, colocated. Each mounts the window with its profile client mocked (capturing the handler), its other clients mocked (json: `DappInteractionServiceClient` answering a wire-shaped payload, operations with `0x` + 64-hex fields; logger: a stub store), children stubbed, and `chrome.windows` stubbed with a `getCurrent` that calls its last argument, so both call shapes are served. Three rows per window:

1. **A window with an id.** A truthy profile calls nothing; then `undefined` calls `getCurrent` once inside the handler call, before any flush, and `remove` exactly once with that id (`[[7]]`).
2. **A window without an id.** `undefined` calls `getCurrent` once and `remove` never.
3. **The `lastError` path.** The callback receives no window: the handler throws exactly `TypeError("undefined is not an object (evaluating 'window.id')")`, the text the unit tests' engine (JSC, Bun) gives for today's expression, and `remove` is never called.

Row 2 fails on both current files (`remove(undefined)` is called); rows 1 and 3 pass. As in logsviewer-timer, the tests and the fix land as one `fix` commit, so no commit in the stack is red; the red run is recorded in Results and the lessons log.

**Mutants** (each applied alone to a scratch copy, the two test files run, the file restored by copy, never by a checkout):

| mutant | caught by |
|---|---|
| the helper's guard removed (today's unguarded body) | row 2, both windows |
| `remove(window.id + 1)` in the helper | row 1, both windows |
| `if (window?.id)` in the helper (swallows the `lastError` throw) | row 3, both windows |
| the helper's callback parameter renamed (`w`) | row 3, both windows (the engine text names the binding) |
| the `if (!profile)` test dropped, per window | row 1 (a truthy profile calls `getCurrent`) |
| the close deferred (`queueMicrotask(closeCurrentWindow)`), per window | rows 1 to 3 (not called inside the handler) |

### Phase 2: the fix

The two edits above. `git diff --stat` against the parent shows the two `.vue` files and the two new test files.

**Validation gate:** the two test files, then the program gates (`bash` `gates.sh`: `lint`, `typecheck:all`, `test:all`, `test:ci-gating`, `audit:vue`). All exit 0; every mutant red.

## Post-implementation

Codex (GPT-6 Astra, xhigh) reviews the diff in the plan audit's session, with the program's no-over-engineering and comment-quality rules, until a round has no material finding; at 5 rounds, park the arc. Each round is logged in `implementations-plan/harden-dedupe/lessons/arc-19b-close-guard.md`.

## UI impact

None. No template, style or copy changes. The zero-diff harness runs batch `json-logger-close-guard`, base `4a60ce05` against this arc's code head, Chrome and Firefox, dark and light, then a `--stability` run:

| window | state |
|---|---|
| json (`#/windows/json`) | a wire-shaped operations payload from a stubbed `dapp-interaction` port, rendered in the viewer |
| logger (`#/windows/logger`) | the fixed log set from a stubbed `log-viewer` port (logsviewer-timer's fixture) |

Readiness, on both builds: each surface starts on Home, unlocked (the harness's `goHome`, re-asserted by the surface), so the windows' route guard (`popup/route-guard.ts:47`) does not redirect and the logger's subscribe-time profile delivery does not close it. The json surface sets `?requestId=hd-json` before the hash with `history.replaceState`, as the opener does (`execute/index.vue:573-575`), because a reload would drop the port stub. Each surface asserts its fixture text in the viewer (`transfer_in_private`, `hd-fixture-line-5`), the json host's `json-content` testid, that the stub was asked, and that the hash is still the window's route before the shot. No testid is added.

The json surface also runs the call-shape probe: in the extension page, `getCurrent(cb)` and `getCurrent(undefined, cb)` must report the same window id, each callback reading `lastError` itself and finding none, on both builds and both browsers. The close itself is not captured: in the harness it would close the capture window.

## Results

_Filled at the end of the build._

## Delivery

One arc, `hd/19b-json-logger-close-guard`, stacked on `hd/19-dapp-windows`. Code review: the Codex loop above.

## Decisions (delegated)

### Plan audit, Codex leg (GPT-6 Astra, xhigh, read-only): REVISE

Both findings adopted:

1. **The `lastError` path was claimed, not pinned.** An `if (window?.id)` mutant passed both original rows while swallowing today's `TypeError`. Adopted: row 3 pins the exact engine text and no removal, with the optional-chaining and parameter-rename mutants. Codex confirmed in Bun that both today's and the helper's expression report `evaluating 'window.id'`.
2. **The screenshot surfaces lacked host-readiness checks.** Adopted: a seeded profile (Home, unlocked) is asserted, `requestId` is set before the hash, the final route and fixture content are asserted before the shot, and the probe reads `lastError` inside each callback. No logger testid is needed: the fixture text in the viewer and the route identify the host.

### Route 2: the json and logger window close guard

_Filled at the end of the build, with the PR-body text._
