# Per-stage import envelopes — measurement campaign (Phases 2–3)

> **Status: CAMPAIGN COMPLETE 2026-08-18** — 10/10 solo runs attempt-1 green
> (5 per proving mode, alternated), zero exit-86, zero retries, `apps/**`
> tree frozen throughout; **30/30 imports recorded, zero non-success, zero
> trace-lost**. Digest tool: a ~60-line node script over the per-fork JSONL
> records (grouping by mode × scenario × stage; P50/max/n).

## Protocol (as executed)

- ≥5 solo runs per proving mode of
  `tests/e2e/network/backup-restore-integrity.test.ts` +
  `tests/e2e/network/profile-reimport-matrix.test.ts`, **modes alternated**
  run-by-run (never all of one mode first), `NULO_E2E_RETRY=0`,
  `NULO_E2E_STAGE_LOG=1`, per-fork attributed JSONL records, tmux, nothing
  else local, `apps/**` tree frozen across the whole campaign.
- Every import yields one record `{runId, file, test, importOrdinal,
  retryEnv, mode, trajectory, unobservedStages, outcome, rightCensored}`;
  a page death yields an explicit `trace-lost` tombstone.

## Caveats (committed WITH the table — read before using any number)

1. **Solo-local baseline, NOT a CI tail estimate.** The 300s lapses that
   motivated this work were load-dependent CI-shard events
   (flake-ledger: two content runs, two arcs). These envelopes characterize
   the healthy solo path; no deadline derives from their maxima — and per
   the classification outcome, no e2e deadline ships at all.
2. **Scenarios are stratified, never pooled.** The three workloads measure
   different things: integrity = real funded backup (deliberately tampered
   slices included — their filtering cost is part of the real flow);
   matrix-first = synthetic backup with NO account-state slice (⇒
   `chain-sync` structurally SKIPPED); matrix-reimport = same-lifetime
   tombstone-collision re-import (correlated with matrix-first inside one
   browser lifetime). "Valid named workloads, not independent samples."
3. **Unobserved ≠ zero-duration.** A stage Vue coalesced into a neighboring
   render (or a branch skipped) appears in `unobservedStages`, never as a
   0ms row. The MutationObserver catches all RENDERED transitions; only
   same-render coalescing hides one.
4. **The `finished→success` seam is measured separately** (last `finished`
   entry → the success-hash observation): it contains the post-composable
   activation/recovery leg (`completeImportWithRecovery`, ≤30s product
   budget) + routing.
5. **Sample sizes support means/medians, not tails.** 5 runs/mode ⇒ 5
   integrity + 5 matrix-first + 5 matrix-reimport imports per mode.
   Acceptable ONLY because nothing gates on these numbers.

## Results — proverless (15 imports)

| Stage | integrity P50/max (n=) | matrix-first P50/max (n=) | matrix-reimport P50/max (n=) |
|---|---|---|---|
| `restoring:profile` | 127ms / 135ms (n=5) | 125ms / 152ms (n=5) | 122ms / 126ms (n=5) |
| `restoring:networks` | 5ms / 6ms (n=5) | 3ms / 4ms (n=5) | 2ms / 3ms (n=5) |
| `restoring:tokens` | 1ms / 2ms (n=5) | 1ms / 4ms (n=5) | 1ms / 1ms (n=5) |
| `restoring:services` | 7ms / 8ms (n=5) | 1ms / 2ms (n=5) | 1ms / 1ms (n=5) |
| `finalizing` | 412ms / 418ms (n=5) | 163ms / 194ms (n=5) | 144ms / 147ms (n=5) |
| `chain-sync` | 13.7s / 14.1s (n=5) | — (skipped) | — (skipped) |
| `finished` (= seam) | 192ms / 214ms (n=5) | 112ms / 115ms (n=5) | 134ms / 137ms (n=5) |

## Results — prover-ON (15 imports)

| Stage | integrity P50/max (n=) | matrix-first P50/max (n=) | matrix-reimport P50/max (n=) |
|---|---|---|---|
| `restoring:profile` | 126ms / 128ms (n=5) | 127ms / 135ms (n=5) | 123ms / 130ms (n=5) |
| `restoring:networks` | 5ms / 6ms (n=5) | 3ms / 3ms (n=5) | 2ms / 3ms (n=5) |
| `restoring:tokens` | 2ms / 2ms (n=5) | 1ms / 1ms (n=5) | 1ms / 1ms (n=5) |
| `restoring:services` | 7ms / 9ms (n=5) | 1ms / 1ms (n=5) | 1ms / 1ms (n=5) |
| `finalizing` | 399ms / 409ms (n=5) | 165ms / 173ms (n=5) | 145ms / 150ms (n=5) |
| `chain-sync` | 13.7s / 14.2s (n=5) | — (skipped) | — (skipped) |
| `finished` (= seam) | 195ms / 203ms (n=5) | 110ms / 111ms (n=5) | 133ms / 135ms (n=5) |

## Unobserved-stage counts (identical in both modes)

- `restoring:account-state`: unobserved in **30/30** imports — it never
  renders (Vue coalesces the near-instant slice check into the neighboring
  transition; exactly recon's prediction).
- `chain-sync`: unobserved in all 20 matrix imports — **branch-skipped**
  (the synthetic backup carries no account-state slice), not coalesced.
  The 10 integrity imports all observe it.

## finished→success seam

The `finished` row above IS the seam (last `finished` entry → success-hash
observation): 110–214ms across all 30 imports. The bounded 30s
activation-recovery leg never engaged on a healthy solo run.

## Findings

1. **Total healthy path (solo-local)**: integrity ≈ 14.5s; matrix ≈ 0.3–0.5s
   per import. The 300s ceiling is ~20× the slowest healthy scenario here.
2. **`chain-sync` dominates and is the only macroscopic stage** — measured
   13.7–14.2s against its 45s absolute product budget (~3.2× headroom).
   Every other stage is sub-second.
3. **Proving-mode symmetry**: per-stage numbers are statistically identical
   across modes (deltas within run-to-run noise). Local sandbox proving
   economics hide under chain waits on these flows — this symmetry is NOT
   evidence about CI/testnet proving cost (caveat 1 applies).
4. **Variance is tight** (max/P50 ≈ 1.0–1.2 everywhere) — the healthy solo
   path is highly deterministic; the historical 300s lapses (load-dependent
   CI shards) live in a different regime entirely, which is precisely why
   no deadline derives from these numbers.

## Classification outcome (Phase 4)

Pre-registered per the audited plan (all three audit legs, convergent): the
settled rule — "early-fail ONLY where a product-owned deadline exists" —
yields NO qualifying stage. `chain-sync` (the sole product-owned budget,
45s absolute) degrades-and-continues by design and cannot produce a
terminal; its regression already reds the unchanged 300s with a
chain-sync-shaped trajectory. The measurement below either corroborates the
stage picture or surfaces product-budget CANDIDATES (written as owner asks
only). The 300s ceiling is unchanged either way.
