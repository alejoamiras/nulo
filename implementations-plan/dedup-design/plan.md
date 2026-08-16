# Plan — dedup-design (Arc 5 of audit 2026-08-14-dedup-mid)

**Tier**: `/blueprint light` · **Branch**: `worktree-dedup-design` → PR into `dev`
**Scope**: Q-12 (Button.vue CTA typography triplication), Q-15 (Tooltip.vue parallel cross-axis switches) — both single-file, cross-model-convergent, in `packages/design`.
**Approval**: standing authorization via the owner's `/goal`. ELI5 omitted.
**Process note (documented deviation)**: with both refactorings fully specified by the consolidated findings and the plan space trivial (two one-file extractions), the codex xhigh pass reviews PLAN + COMPLETE DIFF in one session (adversarial asks unchanged) instead of two separate sessions. If codex rejects the design itself, the change is reverted and redone per its verdict — nothing merges before convergence, so the gate strength is preserved.

## Facts (from consolidated Q-12/Q-15, re-verified against source in this worktree)
1. `Button.vue:302-312/326-336/347-357` (now ~301-360): `.cta`, `.cta_outline`, `.cta_destructive` each declare the identical 7 properties (width/font-family/font-weight/font-size/letter-spacing/text-transform/padding); genuinely variant-specific: background/color/fill/border + hover/active blocks. `border` is NOT shared (none/1px/none).
2. `Tooltip.vue:66-141`: the `center/start/end` cross-axis switch is byte-identical between top↔bottom (computes x from left/right/width) and between left↔right (computes y from top/bottom/height); only the main-axis offset (±8px) differs per side.
3. Zero visual delta required: same computed styles, same geometry.

## Changes
- **Q-12**: one comma-joined shared rule (`.wrapper.cta, .wrapper.cta_outline, .wrapper.cta_destructive`) carrying the 7 declarations, placed before the variant blocks; each variant keeps only colors/border. (Comma-join over a new class: no template/consumer changes, no new class name in the public surface.)
- **Q-15**: `crossAxisOffset(start, end, triggerSize, tooltipSize)` extracted in `<script setup>`, switching on `props.position`; each side computes its main-axis offset inline and calls the helper once for the cross axis. Algebraically identical per case.

## Gates
`bun run --cwd packages/design test` · `bun run audit:vue` · `bun run --cwd apps/extension build-storybook` (design visuals touched). No e2e (no extension behavior surface).

## Security
None — CSS grouping + pure-geometry extraction; no trust boundary.
