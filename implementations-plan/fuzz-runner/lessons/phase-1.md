# fuzz-runner — lessons (phase 1)

Round-3 plan 2. One codex session (fresh; blueprint audit → PR review).

## Consults

| Turn | Who | Ask | Verdict | Folded |
|---|---|---|---|---|
| 1 | codex | blueprint audit | conditional approve | (a) `applyOp` must not be `async` — a resolved-promise await before `flush()` is a microtask checkpoint the sync arms never had; return the timer promise only for that arm; (b) setup order verbatim (mocks installed before `useBalancesStore()`); (c) mock bodies stay ordinary functions with the executor order intact, no destructured scalars, `pending` never replaced; (d) release-arm order and the ensure hook on the ORIGINAL promise chain, never awaited; (e) drain + post-drain invariants + probes verbatim, C3 quirks kept, C4 before C5; (f) seed parsed only when defined, validated (blank/non-finite/non-integer/out of int32 → throw), `0` valid; (g) pass-only fixed-seed runs are not an equivalence proof — a canonical per-run trace digest (ops, RPC issue + settlement order, post-flush entry snapshots, pending ids, counters, fences, drain/probe checkpoints) compared byte-for-byte pre/post; (h) codex's own position was REFACTOR: the grammar alone could be ACCEPT, but world + oracle + drain + five stateful probes in one function is a merit case; name the gas oracle `assertGasInvariants` (it checks coherence and display isolation too); `scopeKey`/`flush` stay free |

| 2 | codex | PR review (both commits, read-only) | approve | all seven conditions verified at their lines; the per-probe microtask hops are acceptable — each boundary follows an awaited drain or a completed silence probe, and any RPC issued in a hop would record an `issue` event before the next checkpoint and change the digest; the trace is strong behavioral evidence, not a formal proof (failing tapes never reach `finish`, the snapshot is a projection) — recorded as such; keep both harnesses; doc nit folded: "inert" → the unset recorder is a no-op whose payloads are still built (timing-preserving, not literally inert) |

## Decision ledger

- **Refactor vs ACCEPT**: refactor. Both positions agree the merit is in separating world
  construction, the oracle, the drain and the probes — not in the op grammar.
- **Proof**: trace digests (commit 1 instruments the monolith, the refactor moves the
  instrumentation verbatim), not pass-only seeds.

## Lessons

(filled as the PR lands)
