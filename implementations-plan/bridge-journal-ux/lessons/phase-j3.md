# J3 — honest errors + leg-aware card narration (lessons)

Gate 2026-07-20: faucet 488 (describe-failure 5 + bridge-steps persisted-failure 6 + card
per-leg-link/honest-phase 2) · vue-tsc 0 · lint 0 · build green.

- **The post-reload activeKey bug (audit-confirmed) is fixed at the source**: the rail's
  fact-bounded zone now falls back to `FAILED_LEG_TO_KEY[rec.failedLeg]` when the runtime step is
  gone — a reloaded approve-death anchors FAILED on APPROVE, not DEPOSIT. Guarded with a
  `keys.includes` fallback so a variant-inconsistent leg can never blank the rail (indexOf -1).
- **Persisted failure surfaces post-reload via `describeDepositFailure`**, threaded into
  buildPhases as `persistedNote`; RUNTIME attention still wins (live note over persisted) so
  there's no double-narration during an active failure.
- **Honest copy is a pure table** (leg × outcome → headline/consequence/tone): approve/seal/sign
  deaths say "no funds moved"; unknown-outcome hedges + "check wallet activity" + "do NOT re-send";
  recoverable points at CLAIM. Every cell pinned.
- **Per-leg approval link** added before the deposit link.
- **SCOPE NOTE**: the interactive affordances (RESUME button, redo, the paste-hash input +
  its engine receipt-identity validator) are DEFERRED to J4/J5 with the resume runners — they
  need the origin-lock + validateResume wiring + a real engine handler, so grouping them with the
  runner keeps each phase's gate self-contained. J3 is the narration-truth layer only. The plan's
  J3 bullet listed those affordances; recording the deviation here per lessons discipline.
