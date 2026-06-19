# Round 2 — implementation wrap-up

**All 7 phases implemented + machine-green.** Two stacked branches pushed to `origin`:

- **`chore/design-r2-holdouts`** — P1–P6 (all extension/package work; the faucet stays visually FROZEN).
- **`chore/design-r2-faucet-cutover`** (off the above) — P7, the single faucet-visual cutover. Kept
  SEPARATE so its dev squash-commit is **independently revertible** (the whole point of the deferral —
  revert PR-B alone to roll the faucet back to its pre-round-2 look, leaving the extension work intact).

## What shipped, by phase

| Phase | What | Gate |
|------|------|------|
| P1 | Guardrails: storybook rolldown fix (array→clean-object alias) + glob widen; biome `ui`-layer rule; `boundary.test` tripwire (no vue-router / v-html); resolver-inventory test; faucet `base.css` rule-presence parity guard | typecheck/lint/design/extension/faucet/builds/storybook ✓ |
| P2 | Spinner reconciled to a superset (extension 4s + package `role=status` a11y, default `currentColor`); Banner + LoadingState externalized; faucet frozen on a temporary `SpinnerLegacy` | + smoke ✓ |
| P3 | `toast` composable → package (singleton) + `ToastManagerBase`; extension `.js` re-export shims; `ToastManager` local wrapper | ✓ |
| P4 | Router-free `Button` base (closed `tag:button\|a`, no arbitrary component) + extension wrapper preserving RouterLink-SPA; `SubPageHeaderBase` + wrapper | + smoke ✓ |
| P5 | `useOutside` → package (+ Dropdown shim); `Tooltip` + `Popover` (teleportTo prop) | + smoke ✓ |
| P6 | `Input` → package (`lang=ts` port) + internal `sanitizeString` copy; renders the package `Tooltip` | + smoke ✓ |
| P7 | **Faucet cutover** (un-freeze): 10 AppButton→Button, Spinner→canonical, delete `SpinnerLegacy`, drop orphaned fonts, docs sweep | machine ✓; **network e2e + human sign-off PENDING** |

Final tallies: `typecheck:all` 0 · design tests 247 · extension 2391 · faucet 343 · lint 0 · ext+faucet
builds + storybook all built. Smoke: only the recurring pre-existing `ctx.browser` cross-file flake
(different file each run; passes on isolated retry; round-2 touched no e2e files).

## Notable decisions (beyond the plan)

- **`subtype="int"` BUG PIN:** Input emits `parseInt` of the RAW text (12 from "12a3"), not the cleaned
  digits — verbatim-preserved + pinned (the test caught my wrong initial expectation).
- **a11y additions when reconciling (the round's pattern):** the canonical Spinner keeps `role="status"`
  (the extension's lacked it); the canonical Button gained `aria-busy` on loading (AppButton had it, the
  extension Button didn't — would've regressed the faucet's busy-state a11y). Both ARIA-only, both apps benefit.
- **`toast.d.ts` kept (overriding the final-codex "delete it"):** the extension's `allowJs` is off, so
  the `.js` shim's 55 importers need the sibling `.d.ts` for types — re-exported from the package.
- **Round-1 cleanup debt found:** round 1 left its migrated local SFCs (`core/Flex.vue`, …) in place;
  the dir-scan still picks them, so its committed `components.d.ts` is aspirational. Out of round-2 scope.

## Remaining before merge (need you / CI)

1. **Both-app human visual sign-off** (the round's locked gate): extension = "no deltas" (chrome +
   firefox, light+dark, key screens + tooltip/popover/toast/button); faucet = the **intentional
   restyle** looks right (buttons now brutalist/UPPERCASE, spinner now 4s).
2. **Network e2e** (`bun run e2e:agent` or CI `Network e2e`) — orthogonal to the faucet cutover but the
   round's final-phase gate.
3. **Open the 2 PRs** into `dev` (squash): PR-A `chore/design-r2-holdouts` (P1–P6), then PR-B
   `chore/design-r2-faucet-cutover` (P7). Merge A before B.
4. **Post-impl review** (loop step 7, fires once P7 is ✓): `/code-review max --fix` + a codex post-impl
   audit on the 82-file diff.

## Round-3 backlog (deferred)

Faucet toast-region unification (`AppToastRegion`/faucet `useToast`); retire the `AppButton` alias +
migrate `DripButton` off it; the pre-existing visual-quirk fixes (`--gray-15`, the `dark` color name).
