# Codex plan + audit — design-system-externalization

**Provenance.** Codex CLI, `xhigh` reasoning, read-only sandbox. Session
`019ed741-8f77-7571-9ed3-2b386db14e26`. Captured faithfully below; absolute paths repo-relativized
per the committed-artifact path rule. This file accumulates: (1) codex's independent parallel plan,
(2) — later — its contradiction-check + audit-round + final-pass verdicts.

---

## Round 1 — independent plan (parallel-plan phase)

**Position.** Codex refused the brief's implicit assumption that every listed L2 file is
framework-pure, and caught three router/state seams the import-grep missed:
- `Button.vue:78` renders `:is="link ? RouterLink : 'button'"` → **router seam, holdout** (VERIFIED).
- `SubPageHeader.vue:26` `const router = useRouter()` + history policy → **holdout** (VERIFIED).
- `ToastManager.vue:3` is a `useToast()` state adapter → **holdout** (consistent with fable-slot).

It also widened the core-rewrite cost: `Flex`, `Icon`, `MaterialIcon`, AND `Text` all depend on
extension-global utilities or fonts, not just `Text`.

### Distinct findings (beyond main + fable-slot)

1. **Font-URL mismatch is a silent breakage** (VERIFIED, worse than stated): extension `@font-face`
   uses Vite-aliased `@/assets/fonts/...` for 5 fonts incl. Material Symbols + ClashDisplay
   (`_base.scss:187-223`); extension has no `public/fonts/`. Package `base.css:13` uses
   consumer-managed `/fonts/...` (works for the faucet, which has `public/fonts/`). Extension
   importing the package base verbatim → fonts 404. → **fonts must be package-bundled with
   package-relative URLs, or @font-face stays per-app.**
2. **`Tooltip.vue:244` uses `var(--base-width)`** (VERIFIED) — an extension-only layout var the
   package base drops. → the token contract must own the **full superset** (light+dark, layout
   vars `--base-width/--base-height/--nav-clearance`, JSON/log debug vars, `--purple`), not the
   dark subset.
3. **Auto-import obscures layer integrity**: template tags are resolved by `unplugin-vue-components`
   dir-scan (`vite.config.ts:174`) and **bypass biome `noRestrictedImports`** entirely. So the
   extension's advertised L0–L6 enforcement is weaker than it looks — a resolver flip needs a
   **paired template-tag audit**, not just lint.
4. **`chrome` ban has indirection gaps**: `biome.json:64` catches direct `chrome` but not
   `window.chrome`, `globalThis["chrome"]`, or `webextension-polyfill`. → add an explicit
   string-audit test over `packages/design/src`.

### Resolutions (codex positions)

- **(a) Tokens:** single source = `packages/design/src/tokens/contract.ts` (token names, scales,
  theme maps, the full superset). Generator emits `tokens.ts` + `base.css`. Extension STOPS owning
  duplicate var declarations — imports `@nulo/design/base.css` and keeps only a thin overlay.
  Anti-drift = a package test that regenerates in-memory and asserts byte-for-byte equality with
  checked-in outputs + a second test that no app entry re-declares a contract-owned `--token`.
  *"The only anti-drift answer I trust."*
- **(b) Styling:** `Text`/`Flex` → style-computed primitives (inline from shared scales, not
  `.fz--N`); `Icon`/`MaterialIcon` move with their assets/fonts. Flags the `--gray-15` ghost
  (`_text.scss:50`) as already-inconsistent.
- **(c) Layer rules:** biome rules for `packages/design/src/core/**` + `ui/**` AND **require
  explicit script imports inside the package** (so biome can actually see them — unlike the
  extension's auto-import-bypassed model).
- **(d) Sequencing:** **5 PRs**; if you insist on moving `Button`/`SubPageHeader`/`ToastManager`
  that's a separate follow-up because it's a router/state seam, not a primitive extraction.
- **(e) Faucet:** keep `AppButton` as a compat alias over the canonical button **only if that
  button can be made router-free**; widen `Spinner` compatibly; keep `Toast` as the package's
  presentational API; don't collapse `Tag` into `Badge` (not equivalent).
- **(f) Storybook:** move primitive **stories** next to the package source, keep ONE Storybook host
  in the extension (expand globs). Note the extension preview imports extension SCSS + `chrome`
  stubs that package primitives shouldn't need.
- **(g) Mechanics:** **custom component resolver** for the consumer flip — NOT copy-then-delete
  (guarantees drift) and NOT wrapper shims (**break exposed refs** for `Input`/`Flex`, which use
  `defineExpose`). Resolver needs a paired template-tag audit.

### Sequencing (codex's 5-phase spine — key structural contribution)

1. **Seam scaffolding only** (add dep, core/ui exports, token contract generator + layer rules; no
   consumer switch).
2. **Canonical theme/base takeover** (replace package base with full generated superset incl.
   light/dark + layout + debug vars + Material Symbols + bundled fonts; switch extension entrypoints
   to package base; shrink extension `_base.scss` to overlay). ← isolates the highest-risk change.
3. **Core extraction** (`Flex`/`Text`/`Icon`/`MaterialIcon` → self-contained + local assets + tests).
4. **Pure L2 extraction** (Badge, Banner, BrutalistTitle, Checkbox, Input, LoadingState, Popover,
   SectionLabel, Spinner, Toggle, Tooltip; inline `sanitizeString` + `useOutside`; keep Button/
   SubPageHeader/ToastManager OUT).
5. **Consumer flip + duplicate reconciliation + full e2e** (resolver flip, faucet to canonical,
   delete extension copies, holdout adapters stay).

### Security (distinct)
- `@nulo/design` becomes a high-trust wallet surface; an attacker targets button states, tooltip/
  popover overlays, toast severity color, typography contrast — misleading users without touching
  wallet logic. Story + build + smoke/network-e2e coverage on typography/layout/font/icon are the
  highest-value defenses.
- chrome-indirection audit test; generated-artifact CI verification; package-owned fonts over
  consumer-synced `/fonts`.

### Asks (codex)
1. Strict round-1 beachhead deferring `Button`/`SubPageHeader`/`ToastManager`, or deliberately
   expand `@nulo/design` to include router/state seams?
2. Allow `@nulo/design` to bundle its own fonts + icon assets? (Recommends yes.)
3. Host `packages/design` stories in the extension Storybook for now, colocated in `packages/design`?

---

## Round 2 — contradiction-check + adversarial audit (resumed session)

**`VERDICT: reject`** — D1 not branch-safe as written; Phase 3 contradicts the deferred-Spinner
decision; the resolver plan ignores that moved package SFCs can't rely on extension-only
auto-imports, Storybook wiring, or teleport/root contracts.

Blocking findings (all verified + adopted into the revised plan):
1. **A1 presented as open but plan single-tracks conservative** → if it flips, Phases 1–4 are wrong.
   Adopted: commit conservative as time-boxed debt + exit criterion; ambitious = explicit re-plan.
2. **Phase 3 ⟂ deferred Spinner**: `Banner.vue:32` + `LoadingState.vue:10` render
   `<Spinner color="--txt-primary">`; package `Spinner` has no `color` prop + divergent animation.
   Adopted: defer Banner/LoadingState.
3. **Resolver only fixes the extension's tags, not the package's own compilation.** Moved SFCs ship
   as source compiled by the consumer; the faucet has no auto-import (`packages/faucet/vite.config.ts:36`).
   `Badge` uses bare `<Flex>`; `Popover` bare `ref/reactive/watch/nextTick`; `Input` bare
   `onMounted/nextTick`. Adopted: explicit-imports work + mount-and-fail-on-unresolved gate.
4. **Storybook parity under-specified** — host only auto-registers `../src/components`, no package
   resolver; `build-storybook` is not a faithful gate without mirroring it. Adopted.
5. **Tooltip/Popover depend on host contracts** (`teleport to #tooltip/#popover`,
   `--base-width`). Adopted: defer.
- **D1 pressure test:** regex parity not robust for `_base.scss`' overlapping `:root`/`[theme=…]`/
  `:root[data-has-nav]` scopes; "two sites pinned by a test" weaker than the schema-patch precedent
  (semantic CSS equivalence ≠ content-identity over 3 TS files); conservative is acceptable ONLY as
  explicitly time-boxed debt with an exit criterion.
- `useOutside` is NOT pure (DOM + UA-sniff + `div[data-outside]`, `outside.js:13,22`); `Icon` depends
  on global `.fill--*` (`_text.scss:78`) → not "as-is"; `build:faucet` does NOT prove value parity;
  Phase 3 lacks smoke e2e; `defineExpose` surfaces (`Flex.wrapper`, `Input.inputEl/focus`) unpinned.

## Round 3 — final fresh-context codex pass (conservative plan)

`VERDICT: approve` (after the revision adopting all 5 reject findings). All conditions verified
closed against the code; only residual = execution discipline.

## Round 4 — targeted review of the AMBITIOUS takeover (resumed; codex authored this design)

`VERDICT: reject` — the takeover lacks a machine-enforced pixel/global-CSS gate; the
`tokens.baseline` spec is too narrow and misses the `data-has-nav` state; the `_base.scss`→overlay
split is under-specified for an AFK run. Key findings (all code-verified):
1. A token-only baseline is blind to the live **non-token** CSS `_base.scss` owns and that the
   takeover moves: Material class (`_base.scss:226`), resets/body (`:242`), transitions (`:286`),
   utility globals (`:364`) — consumed app-wide (`MaterialIcon.vue`, `Popup.vue`, `DropdownRoot.vue`,
   `ToastManager.vue`, `popup/app.vue`, …). Smoke without screenshot/computed-style is not a pixel gate.
2. Baseline misses a non-theme dimension: `--nav-clearance` under `:root[data-has-nav="true"]`
   (`_base.scss:10`) drives padding across many pages → can regress while green. Reliable capture =
   headless `getComputedStyle(documentElement)` on the BUILT app for `{theme} × {data-has-nav}`.
3. Font bundling directionally right but proof weak: cross-workspace-dep URL rewriting unverified;
   MaterialIcon needs the global `.material-symbols-outlined` defaults too; ClashDisplay confirmed
   dead (keeping it is safe).
4. "Shrink `_base.scss` to near-empty" is too loose — it's mostly NOT tokens; a token baseline
   doesn't tell the implementer what must move vs stay → silent-green regression.
5. §2.7 ghost cleanup: `--nulo-error` is NOT globally dead (real fallback in
   `TransactionTerminalCard.vue:94`) → ghost cleanup must stay in component phases, not Phase 2.
6. Plan/code mismatch: `setup/index.ts` imports no base CSS today (`:5`) — adding it moves pixels.
