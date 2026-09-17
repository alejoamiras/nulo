# Post-implementation — codex fix loop

`code_review: off` — `/code-review` was not run. Codex (`high`, read-only, under tmux, told not to run
tests, builds or any vitest config) reviewed the whole diff from `771c2a16`.

## Round 1 — `approve with fixes`

| id | severity | verdict | what |
|---|---|---|---|
| R1 | Medium, material | **accepted** | `connect()` rethrew anything that was not `RpcConnectError`, so it could reject — against G3 and the README. The Phase 1 deviation's rationale was wrong: `EventHandler.invoke` already swallows a throwing subscriber, so the only throwers left are the logger and `addListener`, and a floating `connect()` turned those into unhandled rejections. Restored the plan's bare `catch`; one regression test (a logger that throws on `"Connected"`). |
| R2 | Low | **accepted** | `PortRegistry.remoteClose` fired `onDisconnect` on an already-closed port (twice on a repeat, and at the end that had closed locally — Chrome does neither). Early return on `closed`; the contract test asserts both. |
| R3 | Nit | **accepted** | The offscreen `onunhandledrejection` comment still named the document logger as the main source of the cascade; containment made that false. Cut to three lines. |

Sound per codex (not re-litigated): failed opens reject before any pending entry or timer; a failed
replacement open keeps the in-flight `"Client disconnected"` rejection; state is `Connected` before the
lifecycle callbacks, so a re-entrant `connect()` cannot double-open; containment preserves the rejection
for awaiters and the test can fail; error text carries only the service name and Chrome's diagnostic;
no sticky failure state; the `./testing` export has no production import path; README matches.

Gate after the fixes: messaging `bun run test` 13 files / 229 passed, `tsc` exit 0, `bun run lint` exit 0.
