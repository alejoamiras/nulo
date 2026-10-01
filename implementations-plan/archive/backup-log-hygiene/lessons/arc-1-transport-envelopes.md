# Arc 1 — transport envelopes: codex review loop

Branch `log-safety/01-transport-envelopes`. Session `01a044d7-6b73-78b0-b9a4-4128a8a005d3`,
`CODEX_DIR=/home/homelab/.cache/tmp/codex-hKPcSoHm`. Three rounds; converged.

**Convergence quote (round 3):** *"No material findings remain. This branch has converged."*

## Round 1 — 4 findings

| # | Finding | Verdict |
|---|---|---|
| 1 | The "allowlisted" `method`/`event`/`from` strings were still echoed — and these paths process MALFORMED input, so a hostile sender can put a password in the method slot | **applied** — a string is echoed only when the caller vouches it is registered; otherwise `[unregistered:<len>]`. `BaseService` passes a bound `isRegisteredName` (`rpcMethods ∪ frameworkRpcMethods`) |
| 2 | Client-side `trim()` is unsound ON THIS BRANCH — trim here is the original walker, which destroys Errors into `{}` and EXPANDS typed arrays | **applied by moving it up** — the change was removed from this branch entirely and re-applied on the redactor branch, where trim can handle those shapes |
| 3 | A throwing getter in a hostile envelope propagates out of the summariser, killing the handler before it can send its clean error response | **applied** — both summarisers fail closed to `{ summaryFailed: true }` |
| 4 | `paramCount` read `.length` from an array, but the wire shape is `wrapParams`' `{n, 0, 1, …}` — so every real request reported `[object]`, and the test used a raw array that never occurs | **applied** — `describeArity()` reads a validated `n`; tests now build params with the real `wrapParams` |

Finding #4 is the instructive one: **the test was written against the shape I imagined rather than
the shape on the wire**, so it agreed with a broken implementation. Building fixtures with the real
`wrapParams` is what exposed it.

## Round 2 — 1 material finding

**Forged event names bypassed the whole collapse rule.** Both transport clients logged the event
name at the seam, BEFORE `handleEvent()` validated it, and `handleEvent()`'s unknown branch then
logged the raw name at Warn. So `{type: Event, event: SECRET}` still reached the store — the fix in
round 1 had closed the summariser while leaving a second, simpler path wide open.

The registration proof already existed (`reservedEventNames` + `handler instanceof EventHandler`),
so the log moved *behind* it: registered events keep their full name, unknown ones collapse. No
event-name set needed threading through the clients.

## Rejections

None. Every finding was applied, one of them by relocating the change to a different branch rather
than by editing it here.

## Durable lessons

- **A denylist-shaped mistake hides inside an allowlist.** Round 1's summariser rebuilt from
  "known-safe fields", but `method` is only safe when it IS a method — on the malformed path it is
  attacker text. "Allowlisted field" and "trustworthy value" are different claims.
- **Fix at the point where the property is proven, not where the data arrives.** The event log
  belonged after the registration check, not at the transport seam. Logging early is what made two
  separate leaks out of one value.
- **A fix can belong on a different branch.** Applying the client-side `trim()` here would have been
  a regression until the branch above landed; moving it up cost nothing and kept each branch sound
  on its own.
