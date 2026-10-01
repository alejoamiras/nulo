# Arc 3 — call sites: codex review loop

Branch `log-safety/03-call-sites`. Session `01a0450c-eb51-7bb0-9fc8-bf5c3836e1f5`,
`CODEX_DIR=/home/homelab/.cache/tmp/codex-czE3FCls`. **Six rounds** — the longest of the stack.

**Convergence quote (round 6):** *"Converged. Nothing material remains outstanding on this branch."*

## The through-line: three rounds of moving a leak instead of closing it

This branch's story is one mistake made three times at increasing subtlety. Each fix looked
complete and each was one layer short.

**Round 1 → 2: the cap that bounded instead of sanitizing.** The dApp-facing error fall-through
scrubbed URLs and capped the message at 200 chars. Codex: *"A cap bounds exposure; it does not
sanitize it"* — `new Error("private note: <secret>")` crossed verbatim. Replaced with a CONSTANT.
Every error a dApp is meant to act on is classified with a `walletErrorCode`, so an unclassified
one has no defined meaning to the caller and a constant loses nothing legitimate.

**Round 2 → 3: the "fix" that changed nothing.** `EntityStorage` logged a 200-char payload preview;
I removed the preview and thought it done. But V8 quotes an excerpt of the offending input INSIDE
`err.message` (`Unexpected token 'S', "SECRET…" is not valid JSON`), so interpolating the error
re-introduced exactly what the preview had leaked. Fixed categories now, no error text at all. The
key was identifying too — an account row is keyed by its address — so it is reduced to root + id
length.

**Rounds 3 → 5: substituting one page-controlled value for another.** I replaced dApp origins with
`requestId`/`sessionId`. Codex found the premise was wrong: **the page supplies `requestId`, and
upstream reuses it verbatim as `sessionId`**, with `content-script-validator.ts` accepting
`sessionId: z.string().optional()` — no shape constraint. So the substitution relocated the leak.

I then wrote a UUID-shape check and called it a vouch. Codex again: **"UUID shape is not
provenance"** — a valid v4 UUID carries ~122 attacker-chosen bits, and a secret can be spread
across requests. The fix that finally held echoes nothing page-supplied: each external id maps to a
locally-minted `ext-N` token.

**Round 5 → 6: the bound that forged correlation.** On overflow I cleared the table AND rewound the
counter — so a hostile page could mint 513 ids to force an eviction and have its next session reuse
`ext-1`, reading as an unrelated earlier session in lines still in the buffer. Clear the table;
never rewind the counter.

## Other findings applied

| Finding | Round | Note |
|---|---|---|
| Private return values at Error (`view-executor`, `batched-view-simulation`) | pre-review | arity + expected types only |
| Contact PII, browsing history, balances | 1–2 | `useContactImportExport`, `useFullBackupImport`, `tab-lifecycle` |
| Origin sweep incomplete — twice | 2, 3 | final `grep -rE '\$\{[^}]*\borigin\b[^}]*\}'` over both trees returns 0 |
| `message.type` is unvalidated wire input | 5 | `describeWireMethod` + `Object.hasOwn`, so `toString`/`constructor` cannot pose as methods |
| The constant swallowed actionable guidance | 3 | **my reasoning was factually wrong** — see below |
| The 4900 comment claimed a mechanism it lacks | 5 | reworded |

**Where I asserted something false.** Justifying the constant fall-through I wrote that "all
actionable errors are classified". Codex found `background.ts:772` deliberately produced "Session
no longer valid — reconnect", which the constant then swallowed. Classified as
`SESSION_INVALID_ERROR` (EIP-1193 4900) rather than accepting the regression. Codex then corrected
the follow-up comment too: the SDK wraps envelopes in `new Error(JSON.stringify(error))`, so a
generic library never sees `err.code` — the following `terminateSession()` drives reconnection. The
code carries the meaning; the teardown carries the behavior.

## Tests that could not fail

Three separate times a test agreed with the implementation it was meant to pin:

- the bound test asserted only that a token matched `^ext-\d+$` — it would have passed with **no
  bound at all**;
- `tab-lifecycle.test.ts` asserted the raw session id appeared, which is the thing now forbidden;
- (arc 2's lesson recurring) absence assertions that hold vacuously.

Each was replaced with one that fails against the prior implementation.

## Deferred, with agreement

`useFullBackupImport.ts:507/1021` log failed restore ROWS. Those are allowlisted on
`log-safety/04-restore-errors` directly above. Codex accepted the split as *"reasonable only if
that branch is guaranteed to ship with this one"* — it is, because the stack merges as a unit via
`gh stack merge`, never branch-by-branch.

## Durable lesson

**"I removed the obvious carrier" is not the same as "the value cannot get out."** Three times the
value found another route: an error's own message, a neighbouring id field, the id's format. The
useful question is not *did I delete the interpolation* but *what is the complete set of values
this line can still emit, and who chooses them* — and the answer is usually "more than I listed,
and sometimes the attacker."
