# Arc 19b, json-logger-close-guard: lessons log

## Plan audit

- **Codex (GPT-6 Astra, xhigh, read-only) returned REVISE with two findings, both adopted** (the batch plan's Plan audit block):
  - **The `lastError` path was claimed, not pinned.** An `if (window?.id)` mutant passed the two planned rows while swallowing today's `TypeError`. A third row now pins the exact engine text, which also catches a renamed callback parameter.
  - **The screenshot surfaces gained readiness checks:** Home, unlocked, before each window; `requestId` set before the hash with `history.replaceState`, since a reload drops the port stub; the route and fixture text asserted before the shot; `lastError` read inside each probe callback.

## Build

- **Red, then green.** The new tests ran against the unchanged windows: row 2 (a window without an id) failed in both files with `remove(undefined)`, and rows 1 and 3 passed. With the fix, all six pass. Tests and fix landed together in `2f0ea1ec`, so no commit is red.
- **The unit-test stub serves both call shapes** (it calls its last argument), so the change from `getCurrent(cb)` to `getCurrent(undefined, cb)` is proven by the real-browser probe in the json surface, not by the unit tests.

## Mutation check

- **8 of 8 killed**, re-run after the round-1 test edits with the same result. Each mutant was applied alone to a scratch copy, the two test files were run, and the file was restored by copy:
  - in the helper: the guard removed, `remove(window.id + 1)`, `window?.id`, and the callback parameter renamed;
  - in each window: the `!profile` test dropped, and the close deferred by a microtask.

## Code review

- **Round 1 (Codex, resumed session): REVISE, two findings, both adopted in `a210edfe`.**
  - The test-file header comments narrated what the test names already say, so both were deleted.
  - `globalThis as any` with a suppression became `vi.stubGlobal("chrome", …)`.
- **Round 2: CONVERGED, no findings.**
- **`resume-codex.sh` takes a codex dir as its third argument, not a cwd.** Passing the worktree there wrote the session files (`codex_home`, `log.jsonl`, `model`, `session_id`, the response and the follow-up prompt) into the worktree root. They were moved out before any commit. Later rounds passed the run's own `CODEX_DIR`.
