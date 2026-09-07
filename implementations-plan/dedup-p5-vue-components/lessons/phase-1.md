# Lessons — dedup-p5-vue-components

Base: `worktree-dedup-p4-vue-shells` (PR #569). Scope: ledger ids N1 N2 N3 N4 N5 N7 N8 L2 L5 K3 K8 M1 M5 M6 I5.

## Phase 0 — blueprint mid under the ledger README's pre-answers

- Recon per the pre-answer: the ledger + `reports/` re-checked by hand on this tree, no sweep agent. Drift found:
  `OperationCard`'s twin branches sit at 390-409 / 422-441 now; the N3 inline copies are three different shapes,
  not one; `passwordHint` already uses P2's helper, so M5 is the section chrome and the toggle button only.
- Skipped on contact (reasons in `plan.md` § Decision ledger): N5, M6, N3's sender site, K3's action-row extraction,
  N8's `trimAddress` swap.

## Dual audit

Codex (`audit-codex.md`) and Fable (`audit-fable.md`) both landed on conditional-approve and both asked for a hybrid.
Agreed: skip N1 (three sites carry side effects, six tear down on hide or never) and M5's toggle (a 4-of-7 adoption);
keep N2 with the `v-if`/`v-else-if` branches intact inside their Transitions; L2 reads `props.token`; M1 imports
`getMethodLabel` directly and keeps `formatScope`/`fnLabel` in the component. Split: N4 (codex skip, fable keep) →
skipped; N7 (codex skip, fable keep) → kept with the reject/latch cases; I5 (codex: CSF indexing breaks on a factory)
→ skipped. Full ledger in `plan.md`.

## Skipped ids

- **N1**, **N4**, **N5**, **M6**, **I5**, **M5's toggle**, **N3's sender site**, **K3's action-row extraction**,
  **N8's `trimAddress`** — reasons in `plan.md` § Decision ledger.

## Final codex pass

`/codex high`, fresh session `01a07cf7-270d-7041-ae3d-f177d02bd136` (`audit-codex-final.md`): *conditional approve*, agrees
with both disputed calls; four conditions adopted — K3's merged branch keyed by `op.kind` (AddressDisplay resolves on
mount), rendered L2 parity cases, tighter N3/M1/N7/N8 test contracts (the FPC harnesses could not see a missing
error note), and `FieldWarning` homed in `@nulo/design/ui` per the L0–L6 table. Fable's "drop the panel's sanitizer
import" was wrong (`:314` still uses it) — kept.
