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
| P7 | **Faucet cutover** (un-freeze): 10 AppButton→Button, Spinner→canonical, delete `SpinnerLegacy`, drop orphaned fonts, docs sweep | ✓ DONE — sign-off 2026-06-20 (ext no-deltas chrome+firefox; faucet correct); network e2e via CI |

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

## Post-impl review + codex audit — DONE (loop step 7)

`/code-review max --fix` + `/codex xhigh` complete (full write-up in `lessons/phase-7.md`). Codex
verdict: **ship-with-fixes, no high/critical** — it independently confirmed the fallthrough fix, the
Spinner-color audit, and port fidelity. Two review/audit commits on `chore/design-r2-faucet-cutover`
(NOT yet pushed):

- `f8f29ee` — fix the extension Button wrapper's link-branch attr-fallthrough (dropped data-testid/
  @click/style/class on `<Button link=…>` via RouterLink's custom slot-only root; latent — zero call
  sites today, but a regression vs the pre-round-2 single-root contract + a testid-rule breach) +
  trim misplaced migration-narrative CSS comments now living inside `@nulo/design`. 2 new tests.
- `7fb6bfe` — codex LOW/doc: `rel` hygiene on named anchor targets (not just `_blank`); widened
  boundary tripwires (chrome dot/bracket on any host global + dynamic `import("vue-router")`);
  corrected the resolver-inventory comment (round-1 names are aspirational, not deleted).

Final tree green: `bun run audit:vue` EXIT 0 (2393 extension tests), design suite 249, `bun run lint`
EXIT 0, chrome+firefox builds OK. Both fix commits touch ONLY P1–P6 code (Button wrapper = P4;
boundary/resolver tests = P1) sitting on the P7 branch atop `d297782`; the fixed bug is latent so
merge order is functionally safe either way, but for a clean PR-A, cherry-pick them onto
`chore/design-r2-holdouts` before opening it.

## Sign-off — DONE (2026-06-20)

- **Both-app visual sign-off (the round's locked gate): PASSED.** Extension = **"no deltas"** in
  Chrome + Firefox (both rebuilt to current code). Faucet = correct.
- **CORRECTION to the faucet framing:** the "buttons now brutalist/UPPERCASE (was the plain AppButton
  look)" claim was WRONG. The old `AppButton` was ALREADY `font-headline` + uppercase, and its primary
  bg `--btn-primary-bg` == `Button`'s `--nulo-accent` (`#f8f1e7`), text near-black in both — so the
  only real button delta is `font-weight 600→700`. The one visible faucet change is the **spinner
  (0.75s → 4s)**. `AppButton→Button` is a visually ~invisible consolidation, not a restyle. (Verified
  against a live `:5180` screenshot + the tokens.)
- **a11y decision: KEEP** `Spinner` `role="status"` + `Button` `aria-busy` (per recommendation).

## Remaining before merge (need you / CI)

1. **Network e2e** (`bun run e2e:agent` or CI `Network e2e`) — orthogonal (round-2 touches no network
   code); rides on CI on the PR.
2. **Push + open the 2 PRs** into `dev` (squash): PR-A `chore/design-r2-holdouts` (P1–P6, plus the
   review fixes if cherry-picked), then PR-B `chore/design-r2-faucet-cutover` (P7). Merge A before B.
   The local commits (2 fixes + the docs/sign-off commits) are NOT pushed yet — awaiting your go.

## Round 3 — see `implementations-plan/design-system-externalization-round-3/`

**Toast: KEEP SEPARATE (round-3 decision — NOT unified).** The faucet `useToast` is a 4-deep queue
with links; the extension's is a single-transient singleton — different state models driven by
different host contexts (web viewport vs 360px popup). The faucet already shares the package's
presentational `Toast.vue` card; only the queue state + region layout differ, and those stay separate.
Round 3 also retires the `AppButton` alias (migrate `DripButton` → `Button`), drops the `dark` color
name (split: `tertiary` dots / `secondary` metadata), and deletes the 9 round-1 local SFC shadows so
the resolver finally takes effect.
