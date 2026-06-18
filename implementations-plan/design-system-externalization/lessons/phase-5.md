# Phase 5 — Cleanup, docs, full e2e, round-2 backlog

Branch: `feat/design-system-p5-cleanup` (stacked on `feat/design-system-p4-l2`). MILESTONE / final.

## Done (machine)
- **Docs**: CLAUDE.md "Extension component model (L0–L6)" now documents the L0–L2 → `@nulo/design`
  split + the resolver + the base.css/tokens relocation. `round-2-backlog.md` written (the deferred
  set with concrete reasons: router/state holdouts, Spinner + dependents, host-coupled
  Tooltip/Popover/Input, faucet dedup, the pre-broken storybook/rolldown alias, orphaned faucet fonts,
  story-relocation, bug-pinned quirks). `@nulo/design/README.md` already current from Phase 1.
- **`bun run audit:vue` green** (typecheck:all → test → lint → build): extension 2368 + design 136
  tests (count shifted vs Phase 1's 2398 because the 9 component tests relocated WITH their components
  — coverage preserved, not lost). lint 0 / 1101 files. build 0.

## Post-impl (during visual sign-off)

### Codex post-impl audit — no blocking, no High
Verdict: no blocking pixel-diff regression. Findings folded in (design now 138 tests, was 136):
- **Medium — Checkbox `disabled` didn't gate the toggle** (`5d1513e`): `@click`/`@keydown.enter`
  now no-op when `disabled`; added a behavioral test. Behavior-only — renders identically.
- **Medium — base.css not machine-pinned** (`5ebe089`): added `base.css.test.ts` (sha256 pin).
  Closes the exact gap that let the faucet regression below ship without a failing test.
- Lows deferred to round-2: Flex's preserved invalid align combos (`between`/`around`/`evenly`
  on `align-items`); the resolver↔`index.ts` dual inventory (typecheck already fails when a
  template uses a name the package doesn't export).

### Faucet look-same regression — caught at the visual gate (`a3ee4df`)
The base/theme/font takeover swapped the faucet's dark-only PACKAGE base.css for the extension's
LEANER base. User caught it instantly: **the bridge rendered light/white**. A rule-by-rule diff
of `dev` vs new base.css found FIVE dropped faucet-relevant globals:
1. `html,body { background; color; min-height }` — the white-bg (primary symptom)
2. `button { background:none; color:inherit; cursor:pointer }` — raw buttons → gray browser chrome
3. `button:disabled { cursor:not-allowed }`
4. `input { color:inherit }` — bridge-form input text color
5. `a/button:focus-visible { outline }` — keyboard focus rings

All restored faucet-locally in `packages/faucet/src/app.css` (imported after base.css in main.ts).
NOT added to the shared base.css: the port is a faithful flatten of the extension's `_base.scss`
(verified same lean `button` rule, no focus-visible/disabled there) → extension stays
pixel-identical. Page background is a host concern. Dark token VALUES verified byte-identical
old-vs-new (`--app-bg #0a0908`, `--txt-primary #f5f0e6`). Additive side effect: faucet now
inherits the extension's dark `*::-webkit-scrollbar` styling (cosmetic; flagged to user).

**LESSON**: a "verbatim port of the EXTENSION's base" is NOT a superset of the FAUCET's old
package base. Unifying onto the extension's base drops any global unique to the faucet's prior
base. No machine check caught it (token drift tests passed — values were identical; the gap was
*missing rules*, not wrong values) — the human visual gate did. Vindicates the SUPERVISED model
for Phase 2. The new base.css pin guards the file going forward, but a faucet-side render check
(or a faucet base.css parity test) is the real round-2 follow-up.

## Pending (require the user / heavy / CI)
- **Human visual sign-off (Phase 2 + Phase 5)** — the supervised gates. Load
  `packages/extension/dist/{chrome,firefox}` + the faucet; verify light/dark + nav/no-nav + key
  screens render identically. NOT self-certifiable.
- **Network e2e (`bun run e2e:agent`, ~25 min)** — deferred to CI: the `pr-network-e2e` workflow now
  watches `packages/design/**` (patched in Phase 1) and runs on the PRs. The design changes are
  CSS/component-only (no network/transaction-logic impact), and the accelerator-server is a Linux
  x86_64 binary (CI), so local macOS runs aren't the right venue. CI is the gate.
- **`/code-review max --fix` + codex post-impl audit** — the post-implementation review passes; best
  run with the user able to review their output across the 5-PR stack.

## Cleanup deferred to round-2 (low-risk, noted in round-2-backlog.md)
- Faucet `public/fonts/` orphaned (base.css now uses package-bundled fonts) — kept this round to
  avoid any look-same risk; remove in round 2 after the user confirms faucet fonts render.
- Storybook rolldown-alias fix (pre-broken, independent of this work).
