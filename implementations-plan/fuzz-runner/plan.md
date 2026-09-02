# fuzz-runner — round 3, plan 2 (BL/E, 1 PR)

Scope row: [complexity-residue-round-3/scope.md](../complexity-residue-round-3/scope.md) §2.
Two `noExcessiveCognitiveComplexity` directives in `apps/extension/src/stores/balances.store.fuzz.test.ts`:
`runTape` (103) and its inner `checkInvariants` (29). Manifest 43 → 41. `eli5_mode: none`;
recon: self-read ([recon.md](recon.md)); code-review: codex (one session, blueprint audit folded
below → PR review).

## What the file is

A fast-check property (`fc.array(fc.nat)`, 40–120 ops, `numRuns` from `NULO_FUZZ_RUNS`) that drives
the REAL balances store with a random operation tape and asserts machine-wide invariants after
every step. `runTape` builds a per-run world inline (fresh Pinia, three RPC mocks whose promises
are parked in `pending` with a `callMeta` side table, per-profile `fences`, `subs`, the
`expectGasRecovery` model set, `txHandler` captured from the transaction-client mock, `totalCalls`),
interprets seven op kinds by ranges of `n % 100`, drains to quiescence, then runs five probes
(C1 owed recoveries, C2 post-drain silence, C3 stranded-forced peek, C4 release silence, C5 armed
retry dies with its lease). `checkInvariants` walks `store.entries` for provenance (A) and
coherence (B).

## Shape (refactor on merit — the world, the oracle, the drain and the probes become inspectable)

- `createFuzzWorld()` → a plain object holding what the closures capture today: `pending`,
  `callMeta`, `fences`, `subs`, `expectGasRecovery`, `txHandler` (a slot), `calls` (the
  `totalCalls` counter) and `nextCallId` as fields, the `trace` recorder, and — created LAST, after
  `installRpcMocks(world)` — `store`. The three mock bodies are ordinary functions closing over
  `world` (same objects, same executor order: `world.nextCallId++` → `world.calls++` → fence
  snapshot → `callMeta.set` → `pending.push`); mutable scalars are always read as `world.<field>`.
- Helpers over `world`: `retryCoves(world, scope, leg)`, `liveSubs(world)`,
  `lastOfProfile(world, profileId, releasing)`; `scopeKey` and `flush` stay free functions.
- `applyOp(world, n): Promise<void> | undefined` — the seven-way ladder on `op = n % 100` with the
  SAME ranges and `p1`/`p2` derivations; arms `opSubscribe`, `opRelease`, `opEnsure`,
  `opTxSettled`, `opFence`, `opSettle` are synchronous and return nothing; only the timer arm
  returns `vi.advanceTimersByTimeAsync(TIMER_STEPS[p1])`. The loop: `const p = applyOp(world, n);
  if (p) await p; await flush(); assertWorldInvariants(world); trace step`.
- `assertWorldInvariants(world)` = `assertGasInvariants(world, key, entry, profileId,
  accountAddress)` + `assertFpcInvariants(world, key, entry, profileId)`; messages verbatim.
- `drainToQuiescence(world)` (both loops, the wedged assertion, the post-drain invariants, the
  no-`fetching` checks), then `assertOwedRecoveries`, `assertPostDrainSilence`,
  `assertStrandedForcedProbe`, `assertReleaseSilence`, `assertArmedRetryDiesWithLease` — verbatim,
  in order.
- `runTape(tape)` = create → tape loop → drain → probes → `trace.finish(tape)`. The `fc.assert`
  wrapper, the `finally` timer/tx-handler cleanup, `TIMER_STEPS`, `SCOPES`, and the module mocks
  are untouched.

## Codex blueprint conditions (folded)

- **`applyOp` is NOT async.** Today a synchronous arm proceeds straight to `await flush()`; an
  `await applyOp(...)` — even of an already-resolved promise — would insert a microtask checkpoint
  in which RPC continuations could run before `flush()`. Only the timer arm's promise is awaited.
- **Setup order verbatim**: `pending`/`callMeta`/`fences`/counters created and the three mocks
  installed BEFORE `useBalancesStore()` (the store's constructor issues no RPC today; not relying
  on that).
- **Mock bodies stay ordinary functions** (never `async`), executor order intact, no destructured
  scalars, `world.pending` never replaced (`splice`, as today).
- **Release arm order is semantic**: `wasLast` computed while the target is live → model
  `released = true` → real `release()` → shadow fence bump → recovery-debt removal. **`opEnsure`
  returns immediately**: the model hook is attached to the original `ensure` promise and the
  `.catch(() => {})` to that chain; nothing awaits it.
- **Drain verbatim**: the conditional 60-iteration settle-all loop, five 35 s advances, `splice(0)`
  snapshots, flush positions, the wedged assertion, the post-drain invariants, the no-`fetching`
  checks.
- **Probe quirks stay**: C3 checks entry existence before subscribing, holders/probes are absent
  from the modeled `subs`, `find(...).settle()` does not remove the peek from `pending`, holders
  release only after all probes; C4 precedes C5; C5 = arm → fail pending → flush → await the caught
  ensure → release → advance.
- Names: `assertGasInvariants` (coherence + provenance + display isolation), `assertFpcInvariants`.

## Equivalence (trace digests, pre/post)

1. **Commit 1 (harness only, lands BEFORE the refactor)**: `NULO_FUZZ_SEED` (parsed only when
   defined; blank, non-finite, non-integer or outside int32 → throw; `0` valid) →
   `fc.assert(..., { numRuns, seed })`; unset = today's random seed. `NULO_FUZZ_TRACE=<file>` →
   every completed run appends one JSON line `{ tape, digest }` where `digest` is the sha256 of a
   canonical event stream: per step the decoded op + `p1`/`p2`, every RPC issue (`id`, kind,
   account/chain, `fencesAtCall`) and settlement (`id`, ok, stale) in order, the post-flush snapshot
   of `store.entries` (status/stale/retryDebt/verified/display/fpc ids), `pending` ids, the counters
   and fences, the modeled subs and owed set; then checkpoints after the drain and after each
   probe. A no-op recorder otherwise, so the property's timing is untouched.
2. **Proof**: commit 1 vs the refactor commit, three seeds × `NULO_FUZZ_RUNS=120`: the trace files
   must be byte-identical (pass-only runs prove nothing — a dropped op or a suppressed call can
   keep every invariant). Then one deep run (`NULO_FUZZ_RUNS=500`) on the refactor.
3. Regen: exactly two removals, zero insertions.

Gates: `balances.store` unit + fuzz suites, `audit:vue`, `test:ci-gating`; e2e (scope.md §2):
account-balance-orphans · balance-row-reconciliation.

## Assumptions

Facts: both directives sit in one file at lines 123 and 208; fast-check `assert` accepts a numeric
`seed`; the mocks are `vi.hoisted` module-level `vi.fn()`s re-implemented per run; `txHandler` is
read from `txAdd.mock.calls.at(-1)` after every subscribe. Inference: moving the mock bodies to
functions that close over `world` does not change promise creation order or microtask timing
(each body runs at call time, creating the same `new Promise` then). Ask: none — the owner's
stance is in scope.md.

## Security & adversarial

Test-only. Risks: (1) a world field replacing a closure-captured `let` changes identity semantics
(`fences` is shared by reference today — one object per run); (2) an op arm moved out of the
`for` loses `await flush(); invariants` per step — they stay in the loop, not in the arms; (3) the
C3 holders/probes reference `SCOPES` and `store` — pass `world`; (4) the `.then` model hook must
stay attached to the SAME ensure promise (no relay); (5) the trace recorder must be no-op when
unset and must never await.
