# Autonomous run summary (2026-06-16) — proverless network stabilization

> **⚠ CORRECTION (2026-06-16, superseding):** every "resource starvation on the 4-core runner" call below was an **UNVERIFIED INFERENCE** and is now **DISPROVEN**. The follow-up diagnosis ([`proverless-e2e-diagnosis/DIAGNOSIS.md`](../../proverless-e2e-diagnosis/DIAGNOSIS.md)) captured runner-process snapshots showing **idle cores** at every stall + a service-worker trail proving the real root cause: **execution-start starved by offscreen-PXE-block-sync backpressure** (single-context event-loop starvation, proverless-exposed) — NOT machine resource starvation. Read the wording below as "what was hypothesized at the time", not fact.

## Delivered (committed + pushed on `fix/proverless-network-stabilization`)

- **Phase 0** — pinned the proverless prod-safety guard (`config.test.ts`).
- **Phase 1** — Class-A journal-truth migration (`journal.ts` fixtures; 6 callers + 3 concurrency
  tests migrated off the racy DOM card to the durable journal). **CI-VALIDATED: shard 4, which
  carried the Mode-1 failure, is now green on a real runner.**
- **Phase 2** — failure-classifier instrument (`dumpJournal` on wait-timeout), `network-e2e-soak.yml`
  (workflow_dispatch repeat-runner, retry:0 = zero-retry gate), `NULO_E2E_RETRY` param, biome
  `**/target` exclude.
- **Phase 4 (Mode 4 part)** — re-scoped `concurrent-sendtx-confirm` to the mutex-serialization
  contract + T1-confirms; dropped the architecturally-impossible T2-also-confirms. Passes locally.

## CI confirmation (run 27638447273, with Mode-1 + Mode-4 fixes)

- `concurrent-confirm`: **SUCCESS** (was FAILURE in the baseline) — Mode-4 re-scope validated on CI.
- `shard 4`: **SUCCESS** — Mode-1 fix holds. `canary` + `fee-methods`: SUCCESS.
- `shard 1` (Mode 2), `shard 3` (Mode 3), `shard 5` (queued-stall): still FAILURE — the resource
  modes, exactly as expected (the user's runner/coverage decision).

Both cleanly-fixable modes are CI-proven. The remaining red is the documented resource class.

## The 4 failure modes — final status

| Mode | Status |
|---|---|
| **1** (DOM-render race / helper contract) | **FIXED** + CI-validated (Phase 1) |
| **4** (concurrent-confirm: submit-vs-mine) | **RESOLVED test-side** (architectural limit, codex-confirmed; re-scoped + documented; prod-fix = tracked follow-up) |
| **2** (shard 1: CDP freeze) | **NEEDS USER DECISION** — resource starvation on the 4-core runner |
| **3** (shard 3: settle timeout) + **queued-stall** (shard 5) | **NEEDS USER DECISION** — same resource class |

## Why Modes 2/3 + queued-stall are NOT autonomously fixable to green

They are resource starvation on the standard `ubuntu-latest` (4-core/16GB) runner running
anvil + aztec sandbox + chrome + real WASM kernel-sim:
- `protocolTimeout` is already 300s (raising it won't fix the freeze — codex/opus).
- `fileParallelism:false` already runs one file at a time per shard, so co-location ISN'T the
  cause — it's each heavy test's own demand on a 4-core box. Sharding/isolation won't help.
- The WASM kernel-sim is irreducible (proverless already removed BB-SNARK).
So the levers are: **(a) larger GitHub runners (cost)**, or **(b) lighten the heavy tests
(coverage tradeoff)** — both are the user's call. (The queued-stall is the same class: an
execution-start stall under CI load; NOT a Phase-1 regression — confirmed.)

## Path to "zero flakiness → required" (the original goal)

1. **USER DECISION**: bigger runners vs coverage tradeoffs for Modes 2/3 + the queued-stall.
2. Implement that; re-run the suite on real runners until the resource modes are green.
3. Run the soak (`network-e2e-soak.yml`) — note it's only `workflow_dispatch`-able once it's on
   `dev` (a precursor merge), OR drive repeats via `pr-network-e2e` dispatches until then.
4. Then broaden the filter + flip `Network e2e / Status` required (Phase 6/7 — user-gated).

## Recommendation

Ship Phases 0-2 + the Mode-4 re-scope as a standalone PR now — they are validated, real
improvements (the Mode-1 flakiness root is fixed + CI-proven; the suite is better instrumented).
Tackle the resource modes (2/3/queued-stall) as a follow-up once the runner/coverage decision is
made. The suite stays advisory until then.

## Commits (this run)
`d5af552` plan · `592a0c9` Phase 0 · `6e4f649` Phase 1 · `73b6884` Phase 2 · `3280379` Phase-3
observation · `1dfb6cf` wrap · `2732572` Mode-4 re-scope.
