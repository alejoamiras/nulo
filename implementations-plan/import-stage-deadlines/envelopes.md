# Per-stage import envelopes — measurement campaign (Phases 2–3)

> **Status: campaign IN FLIGHT** — table cells fill as runs complete; this
> scaffold + caveats are fixed up front so the numbers land into a frame the
> audits already approved.

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

## Results — proverless

| Stage | integrity P50/max (n=) | matrix-first P50/max (n=) | matrix-reimport P50/max (n=) |
|---|---|---|---|
| (pending campaign) | | | |

## Results — prover-ON

| Stage | integrity P50/max (n=) | matrix-first P50/max (n=) | matrix-reimport P50/max (n=) |
|---|---|---|---|
| (pending campaign) | | | |

## Unobserved-stage counts

(pending)

## finished→success seam

(pending)

## Classification outcome (Phase 4)

Pre-registered per the audited plan (all three audit legs, convergent): the
settled rule — "early-fail ONLY where a product-owned deadline exists" —
yields NO qualifying stage. `chain-sync` (the sole product-owned budget,
45s absolute) degrades-and-continues by design and cannot produce a
terminal; its regression already reds the unchanged 300s with a
chain-sync-shaped trajectory. The measurement below either corroborates the
stage picture or surfaces product-budget CANDIDATES (written as owner asks
only). The 300s ceiling is unchanged either way.
