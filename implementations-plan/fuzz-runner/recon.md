# fuzz-runner — recon (round 3, plan 2)

One file, one test: `apps/extension/src/stores/balances.store.fuzz.test.ts` (416 lines). Both
directives are inside `runTape` (score 103) — the inner `checkInvariants` (29) is nested in it.

## Reuse map

| capability | found | verdict |
|---|---|---|
| a fuzz "world" (per-run mocks + pending calls + fences + model sets) | built inline in `runTape` lines 125–207; nothing shared with the example-based `balances.store.test.ts` (searched `src/stores/` for `pending`, `callMeta`, `PendingCall`, `settle(`) | **extract in place** (`createFuzzWorld`, `installRpcMocks`) — test-local, not a fixture |
| op interpretation over `n % 100` ranges | inline `if/else if` ladder 250–315 | **extract** one function per arm; the dispatch stays one flat ladder |
| invariant oracle (A provenance, B coherence) | inline `checkInvariants` 209–247 | **extract** by slice (`assertGasInvariants`, `assertFpcInvariants`) with verbatim messages |
| drain + probes C1–C5 | inline 318–411 | **extract** in order, verbatim |
| seed control | none — `fc.assert(..., { numRuns })` only; failures print seed/path | **build** `NULO_FUZZ_SEED` (validated int32) |
| trace for equivalence | none | **build** `NULO_FUZZ_TRACE` recorder (no-op unless set) |

## Constraints found

- Synchronous arms fall straight through to `await flush()`; nothing may add a microtask between an arm and that flush (codex condition — `applyOp` returns `Promise<void> | undefined`).
- Mock executors run synchronously at call time: `nextCallId++` → `totalCalls++` → fence snapshot → `callMeta.set` → `pending.push`; the store is constructed AFTER the mocks are installed.
- The ensure arm's model hook must stay on the original `ensure` promise chain (a relay or an await would change when the hook observes the slice).
- fast-check's `seed` is numeric; the property callback never sees the seed, so per-run traces are keyed by a tape digest.
