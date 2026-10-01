# Phase 3 — the card reads vocabulary → decode → raw (retrofit log)

Commits `ec297815` (code) and `8c00f9ae` (CLAUDE.md rule).

## What landed

- `call-surface.ts` / `display-calls.ts` (pure, tested): the precedence, the raw-row cap (32), the
  token-aware `amountLabel`, `callName` preferring the ABI name once decoded.
- `CallArguments.vue`: one block for the three hosts; raw toggle closed by default; `title` carries
  the full field; "+N more in the JSON view" past the cap.
- `OperationCard.vue` / `index.vue`: decode + token loading at init; discovered authwits decoded as
  fee estimates / previews settle; "Show details" on each discovered authorization.
- Tests rewritten to wire-shaped args (`OperationCard.fallback/discovered/createAuthwit`,
  `index.test.ts` mocks `decodeCallsForDisplay` + `getTokens`).

## Gotchas

- `OperationCard.selfpay.test.ts`'s fixture has no `network`; the card reads `op.network?.chainId`.
- A `WireCall` is not a `CallLike`; `callSurface` casts at the boundary rather than widening the
  vocabulary's type.
- The Bash tool rejected a heredoc holding a literal BEL; `call-surface.test.ts` builds hostile
  characters with `String.fromCharCode`.

## Gate

Targeted vitest 15 files / 112 tests green; `bun run audit:vue` (typecheck:all → test → lint →
build) `EXIT=0` on `ec297815` + `8c00f9ae` (log in the session scratchpad, not committed).
