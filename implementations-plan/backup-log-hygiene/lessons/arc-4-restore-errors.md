# Arc 4 — restore errors: codex review loop

Branch `log-safety/04-restore-errors`. Session `01a04547-46f7-7681-a2fa-535bd8d3715d`,
`CODEX_DIR=/home/homelab/.cache/tmp/codex-51WXkxM5`. **Five rounds.**

**Convergence quote (round 5):** *"Converged — no material findings remain on this branch. …The
Round-4 cross-service value channel is closed."*

## What this branch defends

`useFullBackupImport` records the rows a restore rejected, and those records reach the "View
Errors" viewer — which offers a one-click copy of the whole log — and a `console.warn` the
hijacked console feeds into the log store. The rows are backup content, so they are
attacker-controlled: `restoreRows()` hands back the RAW row whenever validation fails, and backup
migration preserves properties nobody declared. A failed network row carries its `rpcUrl` (which
routinely embeds a provider API key), a failed imported-key row carries `encryptedSigningKey`, a
failed contact row carries a counterparty address and a user-chosen label.

## The through-line: three allowlists, each one weaker than it looked

**Round 1 → 2: an allowlist of NAMES.** Keep `id`/`profileId`/`networkId`/`chainId`/`key`, drop
everything else. Codex: the row is raw, so nothing stops it shipping
`chainId: { rpcUrl: "https://…/SECRET" }` — a name-only filter copies the object through intact.

**Round 2 → 3: names plus a length bound.** `boundedScalar` reduces non-scalars to their type and
replaces an over-long string with `[string:N]`. Better, but codex was right that *"a
name-and-length allowlist is still a name allowlist"*: a short string passes. So each field got its
EXPECTED TYPE — `chainId` numeric-only (a string one is dropped outright, not described, because
`chainId: "[object]"` still tells a reader the field was present), `key` only when the service is
config **and** the value is in `RESTORABLE_CONFIG_KEYS`.

**Round 3 → 4: the types were right, the SCOPE was global.** Codex reproduced a `token` result
emitting `networkId: "ATTACKER_SECRET_UNDER_64"` — a field a Token does not have, carried by a
crafted row, matching an allowlisted name, passing the type check, and emitted verbatim. The fix is
per-service: each service declares the fields its rows actually have (checked one by one against
each `spec.ts`), and a service absent from the map emits nothing but its ordinal and error.

## `RESTORABLE_CONFIG_KEYS` moved to the spec

The collector was trusting a comment that config keys are drawn from a fixed set. The set lived
module-private in `config/service.ts`, so the path that ENFORCES it and the path that RELIES on it
were two different facts that happened to agree. It now lives in `config/spec.ts` — one source,
imported by both. `spec.ts` is type-only, so the pure-helper header still holds.

## A test using a service name production never emits

The imported-keys test drove `collectRestoreErrors("imported-keys", …)`. The real slice name is
`IMPORTED_KEYS_SERVICE_NAME === "imported-account-keys"`. Under the global field list this was
invisible — every service got the same fields, so a wrong name behaved identically to a right one.
The per-service map made it fail immediately, which is the point: **fail-closed designs surface the
test fixtures that were never talking to production.** The test now imports the constant, and pins
that the `id` such a row carries is dropped (an `ImportedAccountKey` is keyed by address and has no
`id`).

## Verifying the negative tests could actually fail

Both tests codex asked for were run against the previous implementation before being trusted: the
lookup was reverted to the global list in place, the suite re-run, and all four new/changed tests
watched go red. (Arc 2 and arc 3 each shipped a test that agreed with the code it was meant to
pin; this is the cheap check that catches it.)

## A gate that was never green

`bun run lint` was reported green in earlier rounds via `cmd 2>&1 | tail; echo $?` — which reports
`tail`'s status, not the script's. The formatter error in the new test only surfaced once the exit
code was captured without a pipe. Same trap as the standing `set -e` note: **in this shell, a gate
verified through a pipe is not verified.** Redirect to a file, capture `$?`, then read the file.

## Durable lesson

**An allowlist is only as strong as the thing it is scoped to.** Names, then names+types, then
names+types+service — each round the filter was correct about what it checked and wrong about the
space it checked over. The question that generalizes: *for this exact caller, what is the set of
values this field can hold, and who picks them?* A field that is safe on one service is not safe
because it is called the same thing on another.
