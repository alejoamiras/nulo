# refresh-balances-disconnect — the balance warm-up cancelled its own RPCs

Follow-up to the codex loop on #446 (r7 Low, out of that PR's scope): pre-existing on dev,
`apps/extension/src/utils/core.ts` `refreshBalances()` fired `refreshTokenBalance()` calls
without awaiting them and then called `tokenBalanceService.disconnect()` on the next line.
Tearing the port down rejects the client's own pending requests — the refresh outcome was
lost (surfacing only as unhandled rejections), and delivery of the un-sent ones depended on
transport readiness timing. A second defect on the same lines: a thrown `getTokenBalances()`
skipped the disconnect entirely, leaking the connected client.

## Fix

`try/finally` around the body (disconnect always runs), refreshes collected and
`Promise.allSettled`-awaited before the disconnect, per-refresh rejections logged. The
ignored `_minutes` parameter and the hardcoded 30-minute staleness threshold are PRE-EXISTING
behavior, deliberately preserved (bug-pin rule; changing the threshold is a product call).

## Tests

Three pins in `apps/extension/src/utils/core.test.ts`, each red against the old code:
disconnect not called while a refresh is in flight (+ fresh rows skipped); throw path still
disconnects; one rejected refresh is logged without cutting the rest short.

## Codex loop (gpt-5.6-sol xhigh, 2 rounds)

r1 HOLDS-with-concerns (one Low: the settle-all pin was satisfiable by a fail-fast
`Promise.all` shape — adopted verbatim) → r2 **APPROVE**. Transcripts: `audit-codex-r{1,2}.md`.
r1 also independently verified the caller surface (auth.vue fire-and-forget only) and the
client contract (disconnect synchronously rejects pending requests).
