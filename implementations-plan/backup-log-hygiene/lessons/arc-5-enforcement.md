# Arc 5 — enforcement: codex review loop

Branch `log-safety/05-enforcement`. Session `01a04573-d614-71f2-9957-1db211d7ba34`,
`CODEX_DIR=/home/homelab/.cache/tmp/codex-SkroEuC8`. **Seven rounds** — the longest of the stack,
beating arc 3's six.

**Convergence quote (round 7):** *"Converged — no material issues remain within the declared
scope. … What remains is only the explicitly documented limitation class."*

## Why this branch took the longest

Arcs 0–4 fixed leaks. This one had to make a guarantee — and a guarantee that does not hold is
worse than none, because it licenses the belief that the class is closed. Every round found a shape
that passed both the scanner and biome while leaking in full. The suite grew from 11 tests to 46,
and essentially every one of the 35 added exists because a real bypass was demonstrated first.

## The bypass ledger

Each of these was green under the guard as shipped at the start of the round that found it:

| Round | Bypass | Why it passed |
|---|---|---|
| 1 | `this.logger.log(…)` | the opener regex knew `this.log*` and `logger.log`, not the receiver-agnostic form — which is the DOMINANT idiom in the packages |
| 1 | anything in `packages/**` | the scan root was `apps/extension/src`; `extension-messaging`, which logs whole RPC envelopes, was entirely unscanned |
| 1 | `console.warn("failed", password)` | only `${…}` was checked, and a bare string argument passes `trim()` untouched |
| 1 | `"key=" + masterKey` | same |
| 1 | a `)` in a comment inside a multi-line call | paren depth counted raw characters, closing the window before the payload |
| 2 | `network.rpcUrl` as an argument | the positional check required a bare identifier |
| 2 | `{ value: password }`, `[password]` | "pass an object" was the advice, but `trim()` redacts by KEY — the value slot is not protected |
| 2 | `dek`, `bearer`, `submittedEndpointUrl`, `claim-secret`, all proof material | the two denylists were "kept in sync" by a comment saying so |
| 2 | `` `${format({ ok: true }) + masterKey}` `` | interpolation depth was a counter, not a stack |
| 3 | `console.warn("failed", password, err)` | a comma read as object context; a middle argument looked like `{ a, password }` |
| 3 | `` `${foo // legacy default)` `` | comment handling sat below the interpolation branch and never ran inside `${…}` |
| 4 | `getLogger({…}).log(` | the window counted the whole opener line, so a paren belonging to the RECEIVER cancelled the call's own |
| 4 | `return /\)/`, `i++ / total` | regex-vs-division decided by punctuation alone — and both misreadings hurt, one closing the window early, the other blanking the payload |
| 5 | a call longer than 12 lines | the window cap truncated valid Biome-formatted calls |
| 5 | `throw /\)/`, `value! / total` | keyword and TypeScript postfix-`!` forms unmodelled |
| 6 | `log?.("warn", …)` | typed logging PORTS called bare — seven real emission points in the PXE layer |

## The turn that mattered: stop enumerating hazards

Rounds 1–2 added a hazard shape each time and stayed porous. Round 3's fix inverted the question:
inside a log call, **any** occurrence of a denied name is a hazard unless it is an object KEY (the
one shape `trim()` redacts) or an arity read (`.length` — the idiom the policy recommends in place
of the payload). One rule replaced four, and every later finding was about the LEXER — reading the
code correctly — rather than about a missed shape. Enumerating what is forbidden is unbounded;
enumerating what is permitted is not.

## Parity by import, not by promise

`SENSITIVE_IDENTIFIERS` carried a comment saying it was kept in sync with the runtime denylist. It
was not, by nine names. The fix was to delete the list and import `REDACTED_KEYS`/`URL_KEYS` from
`wallet/logger/utils.ts` (now exported), leaving only four names the runtime reduces by shape
rather than by key. Adding a denied key now extends the scanner in the same commit. **A comment
asserting two things agree is a bug report waiting to be filed.**

## A gate verified through a pipe is not verified

`bun run lint` was reported green in early rounds via `cmd 2>&1 | tail; echo $?` — which reports
`tail`'s status. A formatting error in a new test sat unnoticed until the exit code was captured
without a pipe. Same root as the standing `set -e` note; the habit is redirect to a file, capture
`$?`, then read the file.

## Where the guard deliberately stops

Aliasing (`const p = password`), destructuring, and true helper indirection (a callee that is not a
logger) are declared false-negatives in the file's own header. A bare `log?.()` port was NOT
accepted as indirection — the callee is typed and named as a logger and its argument is what gets
logged. The line is: does the value reach a logging emission point directly? Codex agreed the
remainder is only the documented class.

## Durable lesson

**An enforcement control has to be attacked before it is trusted, and its author is the worst
attacker.** Six of the seven rounds found a bypass that I had not thought of and would not have —
each time because I was checking the shapes I had in mind when I wrote the rule. The cheap
countermeasure is the one used here: after every fix, revert it in place and watch the new test go
red. A test that never failed proves nothing about the code, and neither does a guard that has
never been shot at.
