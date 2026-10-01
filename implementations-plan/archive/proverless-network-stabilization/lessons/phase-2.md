# Phase 2 — Instrument-first + soak workflow + retry parameterization

## Delivered

1. **Failure-classifier (instrument)** — `tests/e2e/fixtures/journal.ts`: `dumpJournal(page, label)`
   + an internal `awaitOrDump` wrapping the three journal waiters (`waitForInFlight`,
   `waitForDappExecuteStagesPresent`, `waitForDappExecuteWorked`). On a wait-timeout they now
   dump the current `dapp_execute` records to the console before re-throwing — so a CI failure
   shows the journal state at the hang ("T2 stuck at queued" vs "all terminalized but the dApp
   promise never settled") instead of a bare TimeoutError. If the journal READ itself throws (a
   frozen CDP channel), that is logged too — which **distinguishes a Mode-2 browser freeze from a
   journal-visible Mode-3/4 hang**. Test-only (no `src/**` change).
2. **Retry parameterization** — `vitest.e2e.network.config.ts`: `retry: process.env.NULO_E2E_RETRY
   ? Number(...) : 2`. Empty/unset → default 3 attempts; the soak passes `"0"`. (Bug caught + fixed
   in review: `Number("" ?? 2)` is 0, which would have silently stripped retry from the normal PR
   suite — the `? :` form treats empty as default.)
3. **Soak workflow** — `network-e2e-soak.yml` (`workflow_dispatch`): a dynamic `[1..repeats]`
   matrix at `max-parallel: 1` (sequential repeats on fresh runners) calling `_network-e2e.yml`
   with `retry: "0"` by default. `fail-fast:false` → pass-rate visible; any non-green iteration =
   a flake to fix (the "zero retries consumed" acceptance gate). Built in Phase 2 (NOT 5) so
   Phase 3's real-runner-soak gate has it (final-codex condition 1). `_network-e2e.yml` gained a
   `retry` input + `NULO_E2E_RETRY` env. actionlint-clean.
4. **biome `target/` exclude** (incidental) — `biome.json` `includes` now has `"!**/target"`.
   The bridge-aztec Noir artifacts (`packages/bridge-aztec/**/target/*.json`, intentionally
   committed, ~1.6 MiB) tripped biome's 1 MiB maxSize, reddening local `bun run lint` once built.
   Pre-existing (unchanged vs dev) + local-only (CI's lint job doesn't build them). The exclude is
   correct hygiene (generated artifacts shouldn't be linted) and unblocks the local lint gate.

## The 4 failure modes, classified (the instrument's purpose)

| Mode | Signature | Class | Owner |
|---|---|---|---|
| 1 | DOM-render race + unscoped helper accepting `succeeded` | A | **FIXED Phase 1** (journal-truth) |
| 2 | `ProtocolError: Runtime.callFunctionOn timed out` (CDP freeze) | B | Phase 3 (dumpJournal read FAILS on frozen channel → distinguishable) |
| 3 | `waitForPgResult` settle timeout (e.g. concurrent-sendtx r2 reject) | A/B | Phase 4 (settle layer) |
| 4 | T2 `duplicate siloed nullifier` → dApp promise hangs | A/B | Phase 4 (serialization; local repro in mode-4-local-repro.md) |

## De-scoped: the Vite-teardown leak

`global-setup`'s named `export teardown` is never invoked by vitest (a DEFAULT export uses its
RETURN value as teardown; the named one is ignored), so cleanup falls back to incomplete
`process.on("exit")` SIGTERM handlers → the playground Vite child (graceful close hangs) leaks one
`node .../vite` per run. **Two fix attempts failed** (unconditional group SIGKILL; `return teardown`
— neither made "Stopping playground" log or eliminated the leak; "close timed out" persists).
**De-scoped because LOW VALUE**: CI uses ephemeral runners (one playground per shard, discarded with
the runner; soak iterations are fresh runners) → near-zero CI impact. Local workaround:
`pkill -f "nulo-2/node_modules/.bin/vite"` between runs (see iteration-hygiene.md). Potential future
follow-up; not a zero-flakiness blocker. global-setup.ts reverted to dev original (no speculative infra in the PR).

## Deferred

- **e2e-typecheck gap**: `tsconfig.json` only includes `src/**`, so `bun run typecheck` does NOT
  cover `tests/e2e/**`. Fixture type errors rely on biome + the e2e run. A dedicated e2e tsconfig +
  `typecheck:e2e` script is a follow-up (risk: surfaces pre-existing e2e type debt — scope it then).

## Validation gate — lint + typecheck exit 0; `git diff src` zero (instrument is test-only); journal.ts e2e green.
