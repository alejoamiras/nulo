# Phase 1 — Class A: session-scoped journal assertions

**Scope (precise):** migrate the stage-**observation** assertions off the racy DOM
(`tx-awaiting-card[data-stage]` / the old `waitForSendTxActiveStage`) onto the durable journal.
This is the Class-A root fix. It does NOT cover the settle layer (`waitForPgResult`) — those
flakes are Mode 3/4 (Phase 4).

## Delivered

- New `tests/e2e/fixtures/journal.ts`: `readDappExecuteRecords`, `countInFlight`,
  `waitForInFlight` (minActive/minQueued/**minInFlight**), `waitForDappExecuteStagesPresent`,
  `waitForDappExecuteWorked`. The journal record is the source of truth; the card is a lagging
  projection.
- Removed `waitForSendTxActiveStage` (racy DOM poll) from `popups.ts`; cleaned all comment refs.
- 5 single-tx callers → `waitForDappExecuteWorked` (tolerates the proverless fast-path
  `succeeded`; never satisfied by `failed`/`cancelled`).
- Mode 1 (`concurrent-sendtx-approve`): DOM-card read → `countInFlight` (>=1 active + >=1 queued).
- `concurrent-sendtx` → `waitForInFlight({minInFlight:2, minQueued:1})`; `concurrent-sendtx-confirm`
  → `waitForDappExecuteStagesPresent(["proving","queued"])`. One robust card cross-check kept as
  secondary UI coverage in `concurrent-sendtx`.

## Bug caught by the flake-loop (over-tightening)

First `concurrent-sendtx` migration used `{minActive:1, minQueued:1}` — timed out. The REJECT
variant never approves T1, so pre-reject **both** records are `queued` (the queued->pending claim
happens at execution start, not popup-open) — zero active. Fixed by adding `minInFlight` (active+
queued) and using `{minInFlight:2, minQueued:1}`. The approval variant keeps `minActive:1` because
its T1 is held at `proving` by the gate. Observe-first caught this before CI.

## Validation (proverless, local)

- `bun run lint` + `bun run typecheck` exit 0. (NB: `typecheck` only covers `src/**`, NOT
  `tests/e2e/**` — gap to close in Phase 2.)
- `concurrent-sendtx-approve` (Mode-1 poster child): **6/6 green** — proves journal-counting
  replaced the DOM race.
- `concurrent-sendtx`: migrated assertion validated (reaches the settle); 2/3 — the 1 fail is the
  **r2 reject-settle** (`waitForPgResult`, 30s, UNCHANGED code) = Mode 3.
- `concurrent-sendtx-confirm`: migrated assertion validated (reaches `:101-102`); settle hangs =
  Mode 4 (T2 `duplicate siloed nullifier`). See `lessons/mode-4-local-repro.md`.
- single-tx `tx-sendTx-feePayer` + `multi-account-from`: **green in a clean env** (the mechanical
  swap). sponsoredFpc/multicall/default are the identical swap — covered by the Phase-5 soak.

## Deferred (NOT Phase 1)

- **Mode 3** (`concurrent-sendtx` r2 reject-settle 30s timeout, in unchanged `waitForPgResult`) → Phase 4.
- **Mode 4** (`concurrent-sendtx-confirm` T2 hang) → Phase 4 (local repro captured).
- **Env-degradation**: leaked Vite servers degrade the Mac over a long flake-loop → false
  pre-mint failures. `pkill -f "nulo-2/node_modules/.bin/vite"` between runs as the workaround;
  proper teardown fix → Phase 2. See `lessons/iteration-hygiene.md`.

## Commits

`ea20677` (migration + minInFlight fix). Single-tx re-validation green post-cleanup.
