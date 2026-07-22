# Phase 6 — Policy docs + skill routing + provenance-drift fixes

## What shipped (several items landed early, inside Phases 4–5, where they were load-bearing)

- **CLAUDE.md — "Account-address freeze (production invariant)"**: the freeze surface map, the
  one-regime-per-major append-only rule, never-bump-with-the-line, the mandatory prover-ON canary
  (red = HOLD the line, per Ask A2), the V5/V6 separate-extension strategy exactly per Ask A1
  (separate extension ID + listing, coexisting; V5 backups restore only under V5; V6 recovery =
  seed import deriving V6-regime accounts), and the mismatch-is-a-handled-state rule.
- **aztec-update skill**: "frozen account surface (never bumped)" block + the canary as a
  MANDATORY named step in Phase 1 and in Branch A delivery; rotation framed as the conscious
  new-major act, mirroring the PrivateFPC conscious-re-pin spirit.
- **UPDATE.md**: coupling-point 7 (the whole frozen surface + the canary as bump gate); fixed the
  stale "Current line: 5.0.0" header → 5.0.1.
- **Provenance-drift fixes**: regime-b reference project description + `derive-vectors.ts` prose
  (three sites) + the KAT header comment now say 5.0.1, matching the actual pins/digests.
- **implementations-plan/index.md**: entry flipped to IMPLEMENTED with the outcome summary.

## Lessons

- Doc edits that a later phase's code depends on (skill gate text, UPDATE.md coupling entry) are
  better landed WITH that phase's commit than batched at the end — the Phase 4 commit carries the
  skill/UPDATE.md edits so the canary and its procedure bind in one reviewable unit.

## Validation gate

`bun run lint && bun run typecheck:all` — 0 / 0 (transcript). Docs staged for human read at PR
review.
