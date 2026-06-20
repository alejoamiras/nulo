# Phase 7 — Faucet cutover + closeout (the one faucet-visual PR)

**Status:** machine-green; **network e2e + both-app human visual sign-off pending** (see gate).
**Branch:** `chore/design-r2-faucet-cutover` (off `chore/design-r2-holdouts`) — kept SEPARATE so its
dev squash-commit is independently revertible (the whole point of the deferral).

## What shipped (the faucet un-freezes here)
- **Button flip:** all 10 faucet `<AppButton>` → `<Button>` across 6 files (mechanical `AppButton`→
  `Button` rename via perl). `variant="outline"` → `primary_outline` (VerificationModal). **H2 fix:**
  the 3 `:loading` sites that lacked `:disabled` (WalletPanel/BridgeWalletPanel/L1WalletPanel connect
  buttons) got `:disabled="<loading-cond>"` — the extension Button doesn't disable-on-loading
  (`pointer-events:none` blocks mouse but not keyboard), so without this a press during discovery could
  re-fire. Pinned in WalletPanel.test. The bridge-submit already had `:disabled="…||submitting"`.
  `DripButton` stays on `AppButton` (NOT migrated — round-3).
- **Spinner flip:** faucet `WalletPanel`/`BridgeWalletPanel` + `AppButton`'s internal spinner go
  `SpinnerLegacy` → canonical `Spinner` (4s). **`SpinnerLegacy.vue` + test + export DELETED** (the
  temporary freeze shim is retired).
- Orphaned `packages/faucet/public/fonts/*.woff2` removed (faucet renders via the package `@font-face`;
  `build:faucet` still emits them) + the stale faucet README tree entry fixed.
- Docs sweep: `CLAUDE.md` L0–L2 (all 9 migrated; resolver discipline + the 3 wrappers + composable
  shims), `implementations-plan/index.md`, `round-2-backlog.md` done-marker.

## Decision (logged)
- **Added `:aria-busy="loading || undefined"` to the canonical Button** (an a11y improvement, not in
  the literal plan). The migration surfaced that `AppButton` set `aria-busy` on loading but the
  extension `Button` did not → the faucet would REGRESS a11y on its connect buttons. Rather than
  weaken the faucet test, added the attr to the canonical base — behaviorally invisible (ARIA-only),
  benefits both apps, mirrors the F6 Spinner-keeps-a11y reconciliation. Pinned in the package
  Button.test.

## Faucet visual consequences NOW LIVE
- Faucet buttons: `AppButton → Button`. **CORRECTION (post-sign-off): the visible delta is MINOR, not
  a "brutalist restyle".** The old `AppButton` was ALREADY `font-headline` + `text-transform:
  uppercase`, and its primary bg `--btn-primary-bg` is the SAME `#f8f1e7` as `Button`'s
  `--nulo-accent` (text near-black in both) — so the only real button change is `font-weight 600→700`.
  The earlier "brutalist (was the plain AppButton look)" wording (here + WRAP-UP + plan) was wrong; the
  consolidation is visually ~invisible by design.
- Faucet spinner: 4s "material" multi-rotate (was 0.75s) — this IS the one visible faucet change.
**Reverting this one PR restores the prior faucet look entirely**, leaving PR1–6 (the extension
externalization) intact.

## P7 sign-off (2026-06-20) — DONE
- **Extension "no deltas":** confirmed by the user in **Chrome + Firefox** (both rebuilt to current
  code; `build` is chrome-only so firefox was stale + rebuilt for the pass). Looks identical to `dev`.
- **Faucet "intentional restyle":** confirmed correct. The user observed "barely different" on the
  buttons — which is the ACCURATE expected outcome (see correction above), not a bug. Verified the
  cutover is live + rendering cleanly via a `:5180` screenshot (CONNECT WALLET = `Button`; GET NULO/
  OLUN = `DripButton`/`AppButton`, deliberately unmigrated — the two sit side-by-side looking like one
  system, proving visual equivalence). No console errors.
- **a11y decision (codex MEDIUM):** **KEEP** `Spinner` `role="status"`/`aria-label` + `Button`
  `aria-busy` (net a11y improvement; SR-only; the package Spinner already shipped it). Not reverted.
- P7 marked **✓ DONE** in plan.md. Network e2e (`e2e:agent`) deferred to CI (orthogonal — round-2
  touches no network/PXE code; the stop-hook's own clause enumeration never required it).

## Validation gate
- `bun run typecheck:all` → 0. `bun run --cwd packages/design test` → 247 (SpinnerLegacy test removed;
  Button aria-busy pinned). `bun run test` → 2391. `bun run test:faucet` → 343 (migration + H2 +
  aria-busy). `bun run lint` → 0. `bun run build` + `bun run build:faucet` (fonts still emit) +
  `bun run --cwd packages/extension build-storybook` → all built.
- `bun run test:e2e` (smoke): one failure — `onboarding-tab.test.ts:25` → the same `ctx.browser`
  browser-context-setup cascade (a DIFFERENT file than P5/P6's passkey-backup — the flaky-suite
  signature). Pre-existing flake: P7 changed 0 e2e files, passes on **isolated retry (6/6)**. No NEW
  smoke failures (A1).
- **REMAINING (gate the PR/merge, not the local commit):** `bun run e2e:agent` network suite
  (CI-gated) + the **both-app human visual sign-off** — extension "no deltas", faucet "intentional
  restyle looks right". Cannot be done autonomously; surfaced to the user.

## Post-impl review — `/code-review max --fix` (loop step 7)

Max-effort self-review of the net `dev...HEAD` diff (82 files; ~1400 are planning docs + git
renames, so the real code surface is small). The interactive guided-tour `code-review` skill loaded
(name collision with the automated reviewer the `max --fix` syntax targets), so I executed the
reviewer's INTENT manually: correctness/reuse/efficiency pass + apply fixes + commit separately.

**One real finding (HIGH, fixed in `f8f29ee`):** the extension `Button` wrapper is a `v-if`/`v-else`
two-branch template. I PROVED (throwaway probe + Vue's own "could not be automatically inherited"
warning) that:
- non-link buttons: fallthrough WORKS (Vue 3 treats a root `v-if`/`v-else` chain as single-root) —
  `data-testid`/`@click`/`:style`/`class` reach the `<button>`;
- link buttons: fallthrough is BROKEN — RouterLink renders in `custom` mode (slot-only fragment
  root), so undeclared attrs are DROPPED. The pre-round-2 single-root `<component :is>` carried them
  onto the `<a>`. Regression for any future `<Button link=… data-testid=…>`; latent only because
  there are ZERO `<Button link>` call sites today.
- **Fix:** `defineOptions({ inheritAttrs: false })` + `v-bind="$attrs"` on the base in BOTH branches.
  Verified: testid + click + style + class now land on `<button>` AND `<a>`. Pinned by two new
  `Button.test.ts` cases (probe deleted). The faucet is unaffected (it consumes the package `Button`
  base directly — single root, no `link`).

**One doc-correctness fix (same commit):** the CTA-variant CSS comments in the PACKAGE `Button.vue`
named extension files (`import.vue`, `security/export/*`) + stale counts ("Replaces 22 raw … sites")
— accurate-ish in the extension but meaningless/misleading inside `@nulo/design`. Trimmed to the
behavioral description; dropped the migration narrative + counts. (They were copied verbatim from
`dev` during the extraction, so this is cleanup, not a round-2-introduced violation.)

**Verified clean, no action (the review's negative space):** Spinner default-color change is fully
covered (all 8 extension call sites explicit; `OperationCard` patched) → no-deltas lock holds;
`outside.ts`/`toast.ts`/`Input.vue`/`Popover.vue` ports faithful (casts + BUG-PINs intact; vestigial
`ref="base"` inherited from `dev`); `SubPageHeaderBase`/`ToastManagerBase` faithful (no testid
dropped — the `dev` back button had none either; `Transition`>`Teleport` order preserved from `dev`);
the 4 guard tests (`boundary`, `app.css.parity`, `mount-all`, `design-resolver`) are SUBSTANTIVE not
hollow (source greps + self-referential biome-config assertions); `outside.js`/`toast.d.ts`
sidecar asymmetry is inherited from `dev` + harmless; faucet H2 `:disabled` on the right 3 buttons.

**Gate after the fix:** `bun run audit:vue` → EXIT 0 (typecheck:all + 2393 tests [+2 fallthrough] +
lint 1143 files + chrome/firefox build). `bun run lint` → EXIT 0.

## Codex post-impl audit (`/codex xhigh`) — loop step 7

Session `019ee010-bb9e-7011-98f1-16b94ab3e6a1`. **Verdict: ship-with-fixes. NO high/critical.** Codex
independently CONFIRMED: the Button attr-fallthrough fix is correct + complete in both branches (it
found no other dropped-attr regression in the migrated surface); the 8-call-site Spinner-color audit
is exhaustive; `Input`/`Banner`/`LoadingState`/`Tooltip`/`Popover`/`SubPageHeader`/`ToastManager` are
faithful to `dev` aside from the documented ports/bug-pins; the extension declares `#tooltip`/
`#popover`/`#toast` + `--base-width`; `sanitize.ts` is honestly described (text normalizer, not an
HTML sanitizer, not used as an XSS control).

**Findings + dispositions (committed `7fb6bfe`):**
- **MEDIUM — a11y SR-tree delta (`Spinner` role=status + `Button` aria-busy vs `dev`).** VERIFIED real:
  `dev`'s extension `Spinner` was a bare `<div>` (no role) and `dev`'s `Button` had no `aria-busy`.
  But this is the DELIBERATE, documented reconciliation (the package's pre-existing `Spinner` already
  shipped `role="status"`; AppButton already set `aria-busy`). It's a net a11y improvement, not an
  accidental regression. NOT reverted autonomously — reverting would either degrade a11y (extension)
  or shift the delta onto the faucet/package. **Surfaced for the human a11y sign-off** (recommend
  KEEP; if strict byte-identical SR parity is required, make it an opt-in prop, which also changes the
  faucet). This is the one open judgment call.
- **MEDIUM — resolver-inventory comment overstated "all deleted".** VERIFIED: round-2's 6 names ARE
  deleted+remapped to `@nulo/design` in `components.d.ts`; the 9 round-1 names still have local SFCs
  that SHADOW them (dir-scan resolves them local). Round-1 debt, already backlogged. FIXED the comment
  to scope the "deleted" claim to round-2 + mark round-1 aspirational (round-3 cleanup).
- **LOW — boundary tripwires bypassable.** FIXED: widened to chrome via dot OR bracket on any host
  global (window/self/globalThis), dynamic `import("vue-router")`, + js/mjs/tsx in the source glob.
  Package source still has zero offenders.
- **LOW — `rel` only covered `target="_blank"`.** FIXED: `rel="noopener noreferrer"` now also on NAMED
  anchor targets (opener-capable, UA doesn't default them to noopener); `_self`/`_parent`/`_top` stay
  rel-less. Pinned by 2 new `Button.test.ts` cases.
- **LOW — teleport defaults unsafe for arbitrary consumers.** DEFERRED to round-3 (extension + faucet
  both declare their roots; documented).

**Gate after codex fixes:** design suite 249 (+2 rel), `bun run audit:vue` → EXIT 0 (FINAL tree),
`bun run lint` → EXIT 0. Two review/audit commits: `f8f29ee` (fallthrough + comments), `7fb6bfe`
(codex LOW/doc).
