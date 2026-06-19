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

## Faucet visual consequences NOW LIVE (needs human sign-off)
- Faucet buttons: brutalist `--nulo-accent` UPPERCASE `font-headline` (was the plain AppButton look).
- Faucet spinner: 4s "material" multi-rotate (was 0.75s).
These are the intended "faucet adapts" restyle (lock 4). **Reverting this one PR restores the prior
faucet look entirely**, leaving PR1–6 (the extension externalization) intact.

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
