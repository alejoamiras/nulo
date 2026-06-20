# Design-system externalization — ROUND 2 (L2 holdouts + cleanup)

**Status:** APPROVED 2026-06-19 (deep blueprint complete — 3 plans → consolidation → contradiction-check
+ double audit → revision → final fresh-context codex pass → conditions folded → user approval).
**Approval terms:** A1 = gate on "no NEW smoke failures" (base-branch flake reproduced first); A2 =
keep `AppButton` live this round (retire round 3); `/harden` skipped (presentational, no new trust
boundary); A3 = all faucet-visual change deferred to the single revertible P7 (faucet frozen P1–P6).
**Arc:** continues `implementations-plan/design-system-externalization/` (round 1 shipped PRs
#102–#114). **Scope source:** `implementations-plan/design-system-externalization/round-2-backlog.md`.
**Audit verdicts (all folded):** codex contradiction-check `reject` → addressed; hostile subagent
`conditional approve` → addressed/recorded; final fresh-context codex `conditional approve` → 3
conditions folded (D-APPBTN, D-F1, D-SEAM). See Decision ledger + `audit-codex.md` / `audit-fable.md`.

## Summary

Externalize the 9 deferred L2 ui primitives from `packages/extension/src/components/ui/` into
`@nulo/design`, keeping the package presentational-only and dependency-pure (no `@nulo/*`,
`chrome.*`, app utils, or vue-router). Reconcile the two faucet-shared duplicates (Button, Spinner)
onto one canonical each — which is a **deliberate visual restyle of the faucet** to the extension's
brutalist primitives (see "Faucet visual consequences"). Close the deferred tooling. **7 stacked PRs**
(all faucet-visual change isolated to the final, revertible PR7).

## Locked decisions (user clarifying answers — do NOT re-litigate)

1. **Scope = "Components + cleanup"** — 9 holdouts + composables + tooling/cleanup. Pre-existing
   visual-quirk FIXES (`--gray-15`, `dark` color name) stay bug-pinned, OUT.
2. **Router seam = "Stay router-free"** — `@nulo/design` takes NO vue-router dep.
3. **Visual gate = "Snapshots + human + parity guard"** — style-snapshots + human "no deltas" on BOTH
   apps + the new faucet `base.css` parity guard. NO image-screenshot infra.
4. **Faucet reconciliation = "Components, defer toast"** — faucet migrates its 10 `AppButton` tags →
   `Button`, dedups to the reconciled `Spinner`. Faucet `AppToastRegion` + own `useToast` STAY. The
   extension's `ToastManager` still externalizes (extension-only).

Inherited round-1 locks: ONE package, internal layer dirs; self-contained scoped styles; extension
API canonical on duplicates; playground/landing/bridge-* out.

## Faucet visual consequences — ISOLATED to a final revertible phase (user decision)

"Extension API is canonical; faucet adapts" (lock 4) means two **intended, visible** faucet changes —
NOT like-for-like swaps:

- **Buttons restyle.** The faucet's `AppButton` (`--btn-primary-bg`, `--txt-inverse`, 12/18 padding,
  normal case) becomes the extension's brutalist `Button` (`--nulo-accent`, `#0a0908`,
  `font-headline`, **UPPERCASE**, weight 700). 9 of the 10 faucet buttons use the default `primary`
  variant → they all visibly restyle to uppercase/accent.
- **Spinner speed changes.** The faucet Spinner goes from 0.75s smooth single-rotate to the
  extension's 4s "material" multi-rotate. Color is preserved (see F6).

**User decision (deferral for easy rollback):** ALL faucet-visual change is isolated into the SINGLE
final phase **P7 — Faucet cutover** (one PR). The faucet is held **visually frozen** through P1–P6:

- **Button:** the faucet keeps using `AppButton` (its current look — AppButton stays live anyway for
  DripButton) and is migrated to `Button` ONLY in P7.
- **Spinner:** because the package `Spinner` must reconcile early (the extension's Button/Banner/
  LoadingState render it, and flip-flopping the *extension's* spinner would be worse), P2 preserves
  the old spinner as a temporary **`SpinnerLegacy`** export and points the faucet's 2 `<Spinner>` sites
  + `AppButton.vue`'s internal spinner at it. The faucet flips to the canonical `Spinner` and
  `SpinnerLegacy` is deleted ONLY in P7.

**Rollback property:** reverting the P7 PR restores the faucet's current button + spinner look
entirely, while the extension externalization (PR1–PR6) stays intact. The cost is a small, clearly
TEMPORARY `SpinnerLegacy` shim that lives only between P2 and P7. The faucet is otherwise untouched
visually until P7 (P1's parity guard + orphaned-fonts handling are non-visual / also in P7).

## Governing seam principle (the resolver discipline)

**Only add a name to `NULO_DESIGN_COMPONENTS` (`packages/extension/scripts/design-resolver.ts`) when
its extension-local SFC is DELETED.** Wrapper-backed names stay local (verified against
`components.d.ts`: local SFCs are dir-scan-registered and win their own bare tag; only deleted-file
names route to `@nulo/design`).

- **Wrapper-backed (stay local, NOT in resolver):** `Button`, `SubPageHeader`, `ToastManager`. Each
  keeps a thin extension SFC injecting the host concern (router / app shell) and rendering the package
  **base** under a NON-colliding local identifier (recursion guard — see F1/F2/F7).
- **Clean (local file deleted, ADDED to resolver):** `Spinner`, `Banner`, `LoadingState`, `Tooltip`,
  `Popover`, `Input`.
- **Guard:** a resolver-inventory test (P1, grown per phase) asserts `NULO_DESIGN_COMPONENTS` equals
  EXACTLY the explicit list of component names whose extension-local SFC was DELETED and must now
  resolve via `@nulo/design` (the deliberate migration set — NOT "all package exports without a
  wrapper": the package also exports names the extension keeps LOCAL + service-bound, e.g.
  `AddressDisplay`/`EmojiGrid`, which must never enter the resolver). It also asserts the wrapper-backed
  names (Button/SubPageHeader/ToastManager) are absent. So a bad remap can't slip past typecheck
  (which only catches missing exports).

## Consolidated fork resolutions (post-audit; provenance in the ledger)

- **F1 — Button.** Package base renders a CLOSED `tag: "button" | "a"` (default `"button"`; `"a"`
  takes `href`/`target` + auto `rel="noopener noreferrer"` on `target="_blank"`). **No polymorphic
  `as`/`is`/arbitrary-component** (wallet primitive security). The base is coherent (it CAN render a
  styled anchor with shared `$style`), so the wrapper is genuinely thin. **Export the base as `Button`**
  (the faucet imports it directly); the **extension wrapper imports it under a local alias
  `ButtonBase` and renders `<ButtonBase>` — NEVER a bare `<Button>`** (else the dir-scan resolves back
  to the wrapper → infinite recursion). The wrapper keeps the legacy `link` prop (still public via
  `Button.test.ts:59` + `Button.stories.ts:76`) and **preserves the current RouterLink (SPA)
  semantics**: when `link` is set the wrapper renders `<RouterLink :to="link" custom v-slot>` and
  feeds its `href` + `@click="navigate"` into `<ButtonBase tag="a">` (client-side nav intact, NOT a
  full-reload `href`). The base's plain `tag="a"`/`href` path is ONLY for explicit non-router anchors
  (with `rel` hygiene). `link` being production-dead is a *hypothesis* (literal grep; the P4 call-site
  attr check is CONFIRMATION, not the safety mechanism) — preserving RouterLink keeps any hidden
  `link` consumer working regardless.
- **F2 — SubPageHeader.** Package `SubPageHeaderBase` emits `@back` / takes `canGoBack` (no router, no
  hardcoded route). Extension `SubPageHeader.vue` stays a local wrapper (3 explicit page importers +
  bare tags) wiring `useRouter()` + the `history.length > 1 ? back : backTo ?? "/popup/general"`
  policy. Not in resolver.
- **F3 — Teleport + token contracts.** `Tooltip`/`Popover`/`ToastManager` take a `teleportTo` string
  prop defaulting to the current host root (`#tooltip`/`#popover`/`#toast`); package never auto-mounts.
  **Tooltip also depends on a `--base-width` CSS var** (`Tooltip.vue:244`) — the package must either
  define `--base-width` in its own scope or document it as a required host token (decide in P5; lean:
  document as host-provided, since it's the popup viewport width). README documents both contracts +
  that a missing root = broken teleport (not a no-op).
- **F4 — Composable home (CORRECTED).** Relocate `toast` + `outside` into
  `packages/design/src/composables/` (TS, ≥10 tests each), add `./composables/*` package exports. The
  extension shims **stay as `toast.js` / `outside.js`** (the suffix matters: 15 sites import
  `"@/composables/toast.js"` explicitly + `auto-imports.d.ts` hardcodes `'../composables/toast.js'`)
  and **re-export with EXPLICIT NAMED re-exports** (`export { useToast, TOAST_DURATION } from
  "@nulo/design/composables/toast"` — NOT `export *`, whose auto-import surfacing is unverified).
  Resolution reality: `useToast` = 55 explicit imports + 4 `vi.mock` + only 2 truly auto-imported, so
  the shim file's continued existence is what matters; auto-import surfacing is near-moot. Delete the
  stale `composables/toast.d.ts` (types now flow from the package). Preserves the module-scope
  singleton (a duplicate would split it — a latent toast bug).
- **F5 — `sanitizeString`.** Package-internal byte-identical copy
  (`packages/design/src/internal/sanitizeString.ts`) for Input ONLY, pinned by an equality test.
  Extension `utils/string.ts` STAYS (3 service-layer callers: `useContactImportExport`,
  `useFullBackupImport`, `contact/service`). Never repoint those into `@nulo/design`.
- **F6 — Spinner (CORRECTED default).** Replace the package Spinner in place with a compatibility
  superset: extension visual semantics (`size: string | number`, `color` with `--`→`var()`, 4s
  multi-rotate) **+ preserve the package's `label`/`role="status"`/`aria-label` a11y** + **default
  `color` to `currentColor`** (the OLD package default — keeps the faucet's 2 color-less sites + the
  1 extension color-less `size="14"` site visually stable on color; all other extension sites pass
  explicit `color`). The 4s speed change on the faucet is a KNOWN, signed-off regression (see Faucet
  visual consequences). Rewrite `Spinner.test.ts` to select the superset's actual class (the old test
  selects `.spinner`; the extension impl uses `$style.wrapper`). Spinner is an 11-site/10-file +
  faucet-×2 primitive-wide swap; reconcile FIRST (the extension adopts the superset immediately).
  **Faucet-freeze:** P2 also preserves the old spinner as a TEMPORARY `SpinnerLegacy` export and points
  the faucet's 2 `<Spinner>` sites + `AppButton.vue`'s internal spinner at it, so the faucet's spinner
  is visually unchanged until P7 flips it + deletes `SpinnerLegacy` (see Faucet visual consequences).
- **F7 — ToastManager.** Extract via a package `ToastManagerBase` (subpath; `teleportTo` default
  `#toast`; renders Flex/Icon, no Spinner dep) + the extension-local `<ToastManager>` wrapper
  (imports `ToastManagerBase`, never a bare `<ToastManager>`). NOT a second root-level toast export
  beside the faucet's `Toast.vue` (avoids the dual-root smell). Faucet `AppToastRegion` untouched.
- **F8 — Storybook (bounded).** Reproduce the `build-storybook` rolldown `ViteAlias StringExpected`
  FIRST; the likely cause is the array→object alias spread in `.storybook/main.ts` `viteFinal`
  (HYPOTHESIS — confirm before fixing). **Fallback:** if the fix is not a pure config normalization
  within P1's budget, descope `build-storybook` to a P1-only / known-broken follow-up rather than
  letting it gate the component PRs. Gate `build-storybook` on **P1 + P6 only** (advisory in between)
  so a fragile fix can't block all 7 PRs. **ADD** `../../design/src/**/*.stories.@(ts|vue)` to the
  glob. Story relocation is SPLIT: presentational/base stories move into the package; **wrapper/
  integration stories (Button `link`, SubPageHeader router/history, ToastManager shell) STAY in the
  extension** (moving them would drop behavior or misrepresent the package surface).
- **F9 — Parity guard.** A rule-presence CSS-contract test (faucet jsdom; `@nulo/design/base.css` is
  readable via the node_modules symlink): assert the 5 round-1-restored host element-global rules
  exist in `app.css` ∪ `base.css`. Comment that it assumes `app.css` imports AFTER `base.css`
  (`main.ts:3`) — presence, not cascade-effectiveness; the human gate covers ordering.
- **AppButton.** Stays a LIVE package component this round — `DripButton.vue` consumes it
  (`variant="outline"` + `:data-loading`, pinned by `DripButton.test.ts:48,53`; DripButton is live in
  faucet `TokenCard.vue:196`). **DripButton is NOT migrated off AppButton this round** (that would need
  `Button` to gain `data-loading` passthrough + re-pin DripButton's tests — out of scope). Only the
  faucet's 10 DIRECT `AppButton` tags migrate to `Button`. Round-3 retires AppButton + migrates
  DripButton together.

## Security & Adversarial Considerations

`@nulo/design` is becoming the entire primitive surface a wallet renders (addresses, amounts, tx
labels, links). Threat model for this round:

- **XSS via raw HTML.** Verified ZERO `v-html`/`innerHTML`/`domProps` across all 9 holdouts; text is
  escaped `{{ }}`/`<slot>`. **Primary control = API design** (no primitive accepts an HTML-string
  prop) + PR review. The `boundary.test.ts` raw-source ban on `v-html`/`innerHTML` is a cheap
  **belt-and-suspenders tripwire — NOT the primary control** (it misses render-function sinks, helper
  indirection, JSX `domProps`). Optionally add a vue-template lint rule if biome/oxc supports one.
- **`sanitizeString` is a bounded text normalizer, NOT an HTML/URL sanitizer** — right for profile/
  contact names, not a defense for `href`/markup. Byte-identical copy pinned by test (F5). **(BUG
  PIN)** the `\p{L}` class + exact allowed set.
- **No arbitrary-component injection on Button** — closed `tag: "button"|"a"` only (F1). `"a"` mode
  carries `rel="noopener noreferrer"` on `target="_blank"`. Never `v-bind` `tag`/`href` from chain/
  user data.
- **Teleport targets are host config, never user data.** `teleportTo` defaults to a constant.
- **Dependency-purity floor.** Peer-deps = `vue` only. P1 extends `boundary.test.ts` to ban
  `vue-router` (router purity is now locked) + assert import-graph purity (no `@nulo/*`, no new
  runtime deps). `minimumReleaseAge=604800` + frozen lockfile cover accidental adds. Source-shipped.
- **Resolver integrity.** Typecheck catches missing exports but NOT a malicious valid remap → the P1
  resolver-inventory test pins exact allowed mappings + wrapper-name exclusion.

## Phases (7 stacked PRs)

Fast layers (`bun run typecheck:all` + `bun run lint` + `bun run --cwd packages/design test` +
touched-package unit tests) gate EVERY phase. Builds gate runtime-changing phases. Smoke gates
extension-render phases. `build-storybook` gates P1 (the fix), P6, and P7 (advisory in between).
Network e2e + both-app human sign-off gate P7. Pre-existing FPC smoke flake → "no NEW smoke failures"
with base-branch reproduction recorded (Ask A1).

### P1 — Foundation / guardrails (no component moves) ✓ DONE

1. Reproduce + fix the Storybook rolldown break (F8); **fallback**: descope to known-broken follow-up
   if not a pure config fix within budget. ADD `../../design/src/**/*.stories.@(ts|vue)` to the glob.
2. Add the `packages/design/src/ui/**` biome block (ui→core/tokens OK; ui ⊄ composite).
3. Harden `boundary.test.ts`: ban `vue-router` + `v-html`/`innerHTML` in package source; keep the
   floor meta-test. Add the **resolver-inventory test** (exact mappings + wrapper exclusion).
4. Add the faucet parity guard (F9) + capture the baseline. (This is a TEST asserting the faucet's
   CURRENT global rules — non-visual; the orphaned-fonts removal + README fix are deferred to P7 to
   keep ALL faucet-touching changes in the revertible cutover.)

**Validation gate** — `bun run typecheck:all` · `bun run --cwd packages/design test` (boundary +
ui-layer + resolver-inventory green) · `bun run test` · `bun run test:faucet` (parity guard green) ·
`bun run lint` · `bun run build` · `bun run build:faucet` ·
`bun run --cwd packages/extension build-storybook` (exit 0, OR explicitly descoped). Pass: all exit 0.
Layers: typecheck · lint · unit · both builds · storybook.

### P2 — Spinner family (superset + Banner + LoadingState) ✓ DONE

1. Replace `packages/design/src/ui/Spinner.vue` with the superset (F6); rewrite `Spinner.test.ts`
   (≥5: size string+number, `--var`/raw/`currentColor` color, `role="status"`, correct class
   selector). Update `mount-all.test.ts` + the extension's consumption.
2. **Faucet-freeze:** preserve the OLD package spinner as a temporary `SpinnerLegacy.vue` (+ export);
   point `AppButton.vue`'s internal spinner + the faucet's 2 `<Spinner :size="18">` sites
   (`WalletPanel.vue:77`, `BridgeWalletPanel.vue:61`) at `SpinnerLegacy`. The faucet stays visually
   identical (deleted + flipped in P7).
3. Migrate `Banner` + `LoadingState` into `src/ui/` (scoped styles + tokens; explicit imports;
   colocated tests ≥5; preserve `LoadingState`'s `data-testid="loading-state"`). Resolver + index +
   mount-all; delete locals; relocate their (presentational) stories into the package.
4. Re-verify all 11 extension `<Spinner>` consumers compile; check the 1 color-less extension
   `size="14"` site under the `currentColor` default. **(BUG PIN)** `export/full.vue` passes
   `aria-hidden="true"` to a Spinner that now also carries `role="status"` (contradictory but harmless
   — pin, don't fix).

**Validation gate** — `bun run typecheck:all` · `bun run --cwd packages/design test` · `bun run test`
· `bun run test:faucet` · `bun run lint` · `bun run build` · `bun run build:faucet` ·
`bun run test:e2e`. Pass: all exit 0; no NEW smoke failures; **faucet build green with the faucet
visually UNCHANGED (frozen on `SpinnerLegacy`).** **+ human visual: extension Spinner-heavy screens
only (faucet is frozen — no faucet sign-off needed here).** Layers: typecheck · lint · unit · both
builds · smoke · human-visual (extension).

### P3 — Toast substrate (composable + ToastManagerBase + extension wrapper) ✓ DONE

1. Port `toast.js` → `packages/design/src/composables/toast.ts` (TS; ≥10 cases incl. timer-reset/
   close/dispose/singleton-identity). Extension `composables/toast.js` STAYS as a file, becomes an
   explicit-named re-export shim (F4). Delete `composables/toast.d.ts`; regen `auto-imports.d.ts`.
2. Add `ToastManagerBase` (package, subpath, `teleportTo` default `#toast`). Keep the extension-local
   `<ToastManager>` wrapper (imports `ToastManagerBase`). Relocate the presentational toast story;
   keep shell-integration coverage in extension unit tests.

**Validation gate** — `bun run typecheck:all` · `bun run --cwd packages/design test` (composable ≥10)
· `bun run test` (the 55 explicit + 2 auto + 4 mock `useToast` sites resolve — hard regression check)
· `bun run test:faucet` (faucet `useToast` untouched) · `bun run lint` · `bun run build`. Pass: all
exit 0; extension shells mount the local `<ToastManager>` unchanged. Layers: typecheck · lint · unit ·
build.

### P4 — Router seams (Button + SubPageHeader — EXTENSION ONLY; faucet flip deferred to P7) ✓ DONE

1. Package router-free `Button.vue` (F1; closed `tag`, anchor `rel` hygiene + RouterLink preservation,
   renders package Spinner+Icon). Test ≥5 (variants/sizes/wide/loading-shows-Spinner/icons/`tag="a"`
   rel + RouterLink-custom nav). Extension `Button.vue` = local wrapper importing `ButtonBase`, keeps
   `link` via RouterLink custom; NOT in resolver. **(BUG PIN)** `:disabled="!link && disabled ? true :
   null"`, `useCssModule()`. **Verify** all `<Button>` call sites for spread/forwarded attrs
   (confirmation only — the wrapper preserves RouterLink regardless).
2. Package `SubPageHeaderBase.vue` (F2; ≥5 tests). Extension `SubPageHeader.vue` stays local wrapper.

**The faucet is NOT touched in this phase** — it keeps `AppButton` (frozen look). The faucet
`AppButton→Button` migration + the H2 loading-disable fixes happen in P7.

**Validation gate** — `bun run typecheck:all` · `bun run --cwd packages/design test` · `bun run test`
· `bun run test:faucet` (faucet untouched — regression check) · `bun run lint` · `bun run build` ·
`bun run build:faucet` · `bun run test:e2e`. Pass: all exit 0; no NEW smoke failures; **faucet
unchanged.** Layers: typecheck · lint · unit · both builds · smoke.

### P5 — Host-DOM (useOutside + Tooltip + Popover) ✓ DONE

1. Port `outside.js` → `packages/design/src/composables/outside.ts` (TS, behavior verbatim incl.
   iPad `touchstart` + `data-outside` collision; ≥10 tests). Extension `composables/outside.js` STAYS
   as a file → explicit-named re-export shim (`DropdownRoot.vue` also consumes it).
2. `Tooltip` → `src/ui/` (`teleportTo` default `#tooltip`; resolve the `--base-width` contract per
   F3; ≥5 tests). `Popover` → `src/ui/` (`teleportTo` default `#popover`, package `useOutside`;
   ≥5 tests). **(BUG PIN)** Popover `removeOutside` is the no-op/`null` default until `nextTick`
   assigns it — closing before assignment throws; preserve + pin. Resolver + delete locals; relocate
   presentational stories. README: teleport-root + `--base-width` contracts + the 5 host roots.

**Validation gate** — `bun run typecheck:all` · `bun run --cwd packages/design test` (default +
override `teleportTo`) · `bun run test` (Dropdown still resolves `useOutside`) · `bun run lint` ·
`bun run build` · `bun run test:e2e` (tooltip/popover/dropdown; no teleport-resolution console
errors). Pass: all exit 0; no NEW smoke failures. Layers: typecheck · lint · unit · build · smoke.

### P6 — Input (EXTENSION ONLY) ✓ DONE

1. `Input` → `src/ui/` rendering the package `Tooltip`. **Full explicit-import set** (`ref`, `watch`,
   `computed`, `onMounted`, `nextTick` + `Tooltip`, `Icon`, `Text`, `Flex`). `sanitizeString` →
   internal copy (F5), byte-identity pin (adversarial inputs). mount-all case MUST pass the required
   `placeholder` + the Tooltip dep. Tests ≥5 pinning oddities (no-HTML sanitize, `subtype==="int"`
   coercion, `maxLength` warning, paste truncation, `clearable`, `defineExpose({inputEl,focus})`) —
   pin, don't fix. Resolver + delete local; relocate story.
2. Extension-side docs only (full doc sweep is in P7): note the externalized primitives where it
   unblocks P7. **Faucet untouched.**

**Validation gate** — `bun run typecheck:all` · `bun run --cwd packages/design test` · `bun run test`
· `bun run test:faucet` (faucet untouched) · `bun run lint` · `bun run build` · `bun run build:faucet`
· `bun run --cwd packages/extension build-storybook` · `bun run test:e2e`. Pass: all exit 0; no NEW
smoke failures; **faucet still frozen/unchanged.** Layers: typecheck · lint · unit · both builds ·
storybook · smoke.

### P7 — Faucet cutover + closeout (the ONE faucet-visual PR — fully revertible) ✓ DONE

This is the only phase that changes the faucet's look. Reverting this PR restores the faucet entirely
while leaving the extension externalization (PR1–PR6) intact.

1. **Button flip:** migrate the faucet's 10 `AppButton` tags (6 files) → `Button`
   (`outline`→`primary_outline`; preserve EVERY `data-testid`). **Per-site requirement (H2):** every
   faucet `:loading` site lacking `:disabled` MUST add `:disabled="loading"` (extension Button doesn't
   disable-on-loading; `pointer-events:none` blocks mouse but NOT keyboard → else a keyboard/double-
   submit regression). Add a test on the bridge-submit site. `DripButton` stays on `AppButton`.
2. **Spinner flip:** point the faucet's 2 `<Spinner>` sites + `AppButton.vue`'s internal spinner from
   `SpinnerLegacy` → the canonical `Spinner`; **delete `SpinnerLegacy.vue` + its export** (temporary
   shim retired). Faucet now on the 4s canonical spinner.
3. Remove orphaned `packages/faucet/public/fonts/` + fix the stale `packages/faucet/README.md` tree.
   Faucet parity guard re-verified.
4. Docs sweep: `CLAUDE.md` L0–L2 (holdouts empty; 3 wrappers + `.js` composable shims + dual-toast
   caveat + `--base-width`), `packages/design/README.md`, `ARCHITECTURE.md` if referenced,
   `implementations-plan/index.md` + mark `round-2-backlog.md` items done.

**Validation gate** — `bun run typecheck:all` · `bun run --cwd packages/design test` (no
`SpinnerLegacy` references remain) · `bun run test` · `bun run test:faucet` · `bun run lint` ·
`bun run build` · `bun run build:faucet` · `bun run --cwd packages/extension build-storybook` ·
`bun run audit:vue` · `bun run test:e2e` · `bun run e2e:agent`. Pass: all exit 0; network green;
**human sign-off on BOTH apps**: extension = **"no deltas"** (chrome+firefox, light+dark, key screens
+ tooltip/popover/toast/button); faucet = **intentional restyle looks correct** (buttons brutalist,
4s spinner, fonts render). **Do NOT mark ✓ without sign-off.** Layers: full stack.

**Sign-off (2026-06-20) — DONE.** Extension: confirmed **"no deltas"** in Chrome + Firefox (both
rebuilt to current code). Faucet: confirmed correct — **but the "buttons brutalist (was plain
AppButton)" framing above was WRONG.** Verified against the live faucet (`:5180` screenshot) + the
tokens: the old `AppButton` was ALREADY `font-headline` + `text-transform: uppercase`, and its
primary bg `--btn-primary-bg` is the SAME `#f8f1e7` as `Button`'s `--nulo-accent`, text near-black in
both — so the only real button delta is `font-weight 600→700`. The visible faucet change is the
**spinner (0.75s → 4s)**, not the buttons. The `AppButton→Button` consolidation is visually ~invisible
by design (a clean dedup, not a restyle). a11y semantics (`Spinner` `role="status"`, `Button`
`aria-busy`) **kept** per recommendation.

## PR / sequencing strategy

**Implementation note (autonomous run):** P1–P6 (all faucet-frozen extension/package work) land on one
integration branch `chore/design-r2-holdouts` with clean per-phase commits (granularity preserved in
history); **P7 (faucet cutover) gets its OWN branch/PR** so dev's squash-merge keeps it independently
revertible — that revertibility is the entire point of the deferral, so it MUST stay separate. The
"7 PRs" below is the original phase plan; the revertibility constraint only requires P7 isolated.

7 stacked PRs into `dev` (squash; PR title = Conventional Commit subject; signed): **PR1** guardrails ·
**PR2** Spinner family (faucet frozen on `SpinnerLegacy`) · **PR3** toast substrate · **PR4** router
seams (extension only) · **PR5** host-DOM · **PR6** Input (extension only) · **PR7** faucet cutover +
closeout. Dependency-forced: Spinner→Button (renders Spinner); toast→ToastManagerBase; useOutside+
Tooltip→Input. **All faucet-visual change is isolated to PR7** — PR1–PR6 leave the faucet visually
frozen, so the human gate signs the faucet off ONCE (at PR7), and **reverting PR7 alone rolls back the
entire faucet restyle**. Each PR is independently compile-green; `dev` is never broken for either app.

## Assumptions

### Facts (verified, file:line)
- Button `link` path is production-dead by literal grep (0 `link=`/`:link` attrs across both apps),
  BUT `link` is live public surface: `Button.test.ts:59`, `Button.stories.ts:34,76`. (Base anchor
  mode makes correctness independent of the dead-ness.)
- Faucet `AppButton`: **10 open tags / 6 files**; variants = `outline`(1) + `primary`(1) + default(8).
  AppButton primary ≠ extension Button primary visually (brutalist restyle). Faucet has 0 vue-router,
  0 unplugin resolver. `DripButton.vue:2,22` (package composite) imports `AppButton`.
- `useToast` (`composables/toast.js`, module-scope singleton): **55 explicit imports** (15 `.js`-
  suffixed) + **4 `vi.mock`** + **2 truly auto-imported** (`ScopeAddress`, `ScopeClassId`).
  `auto-imports.d.ts` hardcodes `'../composables/toast.js'` (×6) + `'../composables/outside.js'`.
  `composables/toast.d.ts` exists; `outside` has none. `useOutside` consumers: `Popover` +
  `Dropdown/DropdownRoot.vue`.
- `sanitizeString` (`utils/string.ts:16`) non-Input callers: `useContactImportExport`,
  `useFullBackupImport`, `wallet/services/contact/service` (service-layer → stays).
- `SubPageHeader` explicit importers: `popup/pages/{journal,tx,tokens}/[id].vue` (3) + bare tags;
  `SubPageHeader.vue:26,33-37` (router + `/popup/general`).
- Extension `<Spinner>`: 11 tags / 10 files; 10 pass explicit `color`, 1 (`size="14"`) does not.
  Package Spinner (`size:number`/`label`/`role=status`/`currentColor`/0.75s, test selects `.spinner`)
  vs extension Spinner (`size:string`/`color`/`--txt-inverse`/4s, `$style.wrapper`). Faucet
  `<Spinner :size="18"/>` ×2 (no color). `export/full.vue` passes `aria-hidden` to a Spinner.
- `Input.vue` uses `onMounted`(:111)/`nextTick`(:213) + bare `Tooltip`(:239)/Icon/Text/Flex;
  `placeholder` required. Tooltip reads `--base-width`(:244). Popover `removeOutside` null-default bug.
- Teleport roots `#popup`/`#tooltip`/`#dropdown`/`#popover`/`#toast` in `popup/app.vue` +
  `onboarding/app.vue`; faucet declares none.
- ZERO `v-html`/`innerHTML` in any holdout. Package `Toast.vue:22-24` sets `rel`, no href allowlist.
- biome floor for `packages/design/src/**` + `.../core/**`; no `ui/**` block. Package test infra:
  `mount-all`, `boundary` (floor meta-test), `tokens.parity`, `utilities.drift`, `base.css`. Exports
  lack `./composables/*`. `tsconfig` includes `src/**/*.ts`. Vite `8.0.11` (rolldown) +
  `@storybook/vue3-vite 10.3.5`. `faucet/src/app.css:5` restores 5 host rules, imported after base in
  `main.ts:3`. `@nulo/design/base.css` readable in faucet jsdom via node_modules symlink.

### Inferences (deduced — verify in-phase)
- Storybook cause = array→object alias spread in `viteFinal`. UNVERIFIED — reproduce-then-diagnose;
  fallback descope. The fix may need a deeper rolldown change.
- The faucet `<Spinner :size="18">` + button restyle are visually acceptable to the user. UNVERIFIED —
  human sign-off (these are deliberate restyles, see consequences).
- `link` production-dead — literal grep misses spread-bound/dynamic; P4 call-site attr check + the
  base anchor mode mitigate.
- AppButton↔Button map cleanly for the 10 tags — P4 reads each (variant + loading-disable per H2).
- explicit-named re-export shims preserve all `useToast`/`useOutside` resolution incl. the `.js`
  specifier + the dts — P3/P5 gate = the consumer `bun run test`.

### Asks (user decisions — at the gate, with recommendations)
- **A1 — Smoke gate policy.** Accept "no NEW smoke failures" with base-branch reproduction recorded
  (pre-existing FPC flake)? **Recommend: yes.**
- **A2 — `AppButton` alias timing.** Keep through round 2 (DripButton + faucet depend on it) vs delete
  after the flip? **Recommend: keep.**
- **A3 — Faucet restyle. RESOLVED (user, deferral):** the deliberate faucet restyle (buttons →
  brutalist/uppercase, spinner → 4s) is accepted BUT isolated into the single final phase **P7 —
  Faucet cutover** for easy rollback. The faucet is held visually frozen through P1–P6 (Button on
  `AppButton`; Spinner on a temporary `SpinnerLegacy`). Reverting PR7 alone restores the faucet's
  current look. See "Faucet visual consequences" + D-FAUCET-DEFER.

## Decision ledger

| ID | Decision | Source | Rejected / superseded |
|----|----------|--------|-----------------------|
| D-SEAM | Resolver only when local file deleted; wrappers stay local; inventory test pins the EXACT deleted-and-migrated name set (NOT all package exports — `AddressDisplay`/`EmojiGrid` stay local) | codex (rule) + opus (verified vs components.d.ts) + final-codex (inventory scope) | per-component special-casing; "all exports w/o wrapper" invariant (wrongly flags local service-bound dups) |
| D-F1 | Button base: closed `tag:button\|a` anchor (no `as` bag); export `Button`, wrapper aliases `ButtonBase` (recursion guard); wrapper keeps `link` AND **preserves RouterLink SPA semantics** (RouterLink custom → `tag="a"`), not a plain `href` | codex Critical (coherence) + opus C3 (recursion) + final-codex (RouterLink preservation) + main (wrapper) | Opus-planner: no wrapper, polymorphic `as` — REJECTED (footgun + recursion + drops live `link`). Main-draft: plain-button-only base / `link`→plain-`href` — REJECTED (incoherent + degrades SPA routing) |
| D-F2 | SubPageHeaderBase emits `@back`; local wrapper owns router | all 3 | vue-router peer-dep; emitting base in resolver (churn) |
| D-F3 | `teleportTo` default roots + `--base-width` host-token contract documented | all 3 + opus M2 | package auto-mount; silent `--base-width` |
| D-F4 | Composables→package; shim stays `.js` + EXPLICIT NAMED re-export; delete toast.d.ts | opus C1/C2 (suffix + real consumer model) + codex Med (named not `*`) | `export *` (unverified surfacing); `.ts` shim (breaks 15 `.js` imports + dts) |
| D-F5 | sanitizeString internal copy for Input; extension util stays | codex + opus (service callers) | move util into package |
| D-F6 | Spinner superset, default `currentColor`, keep a11y, reconcile first; 4s speed = signed-off | codex (superset) + opus H3 (currentColor default + class-selector) | `--txt-inverse` default (faucet color regression); verbatim overwrite (a11y loss) |
| D-F7 | ToastManagerBase + wrapper (not 2nd root export) | codex + opus (2/3) + locked scope | main-draft defer — REJECTED (contradicts "all 9"); 2nd root toast export (dual-root smell) |
| D-F8 | Reproduce-then-fix storybook; FALLBACK descope; gate P1+P6 only; ADD glob; SPLIT stories (base→pkg, wrapper→ext) | opus H4 (unbounded + glob + fallback) + codex H1 (story split) | gating every PR on a fragile fix; relocating wrapper stories |
| D-F9 | Rule-presence parity test + import-order note | all 3 + opus L1 | computed-bg smoke |
| D-APPBTN | AppButton stays LIVE (DripButton consumes it); only faucet's 10 DIRECT tags migrate; DripButton NOT migrated this round | codex + opus M4 + final-codex (contradiction fix) | delete now; "update DripButton off AppButton" this round — REJECTED (contradicts keeping AppButton; needs Button `data-loading` + test re-pin, out of scope) |
| D-SEC | boundary regex = belt-and-suspenders, NOT primary XSS control (API design + review is) | codex Med + opus M3 | overselling the regex as "highest-value guard" |
| D-PR | 7 stacked PRs; ALL faucet-visual change isolated to PR7 (faucet frozen through PR1–6) | synthesis + opus M5 + USER (deferral) | mega-PR; spreading faucet deltas across PR2+PR4 (harder to roll back) |
| D-FAUCET-DEFER | Defer ALL faucet-visual change to a single revertible final phase P7; freeze the faucet via temporary `SpinnerLegacy` + keep `AppButton` until P7 | USER | doing the faucet flip inline at P2/P4 (codex/opus default) — superseded for rollback safety; cost = a temporary SpinnerLegacy shim |

**Audit verdicts:** codex (contradiction-check + adversarial) = **reject** → 1 Critical (Button
coherence, D-F1), 2 High (story over-generalization D-F8, link/storybook-as-fact), 3 Medium (boundary
theatre D-SEC, stale micro bug-pin REMOVED, `export *` D-F4), 1 Low (resolver inventory D-SEAM) — ALL
addressed. Fresh hostile subagent = **conditional approve** → 3 Critical (C1 useToast model D-F4, C2
`.js` suffix D-F4, C3 ButtonBase recursion D-F1), 4 High (H1 faucet restyle framing, H2 loading
divergence, H3 Spinner default D-F6, H4 storybook bound D-F8), 5 Medium + 4 Low — ALL addressed or
recorded. **Final fresh-context codex pass = `conditional approve`** → 2 High + 1 Medium, ALL folded:
(1) AppButton/DripButton contradiction → DripButton stays on AppButton, AppButton stays live (D-APPBTN);
(2) `link` must preserve RouterLink SPA semantics, not plain `href` (D-F1); (3) resolver-inventory test
pinned to the deleted-and-migrated set, not all package exports (D-SEAM). Codex confirmed solid: D-F4
(`.js` shims + named re-exports + deleting `toast.d.ts` is safe — `ToastOptions` unreferenced), D-F8
(storybook P1/P6-gate acceptable as a tooling-only gap if P6 keeps it mandatory), and the 6-PR
sequence is independently shippable without stranding the other app.

**Round-3 debt (recorded):** faucet `AppToastRegion`/`useToast` toast unification; delete `AppButton`
+ resolve `DripButton`'s `variant=outline`/`data-loading` gap; pre-existing visual-quirk fixes
(`--gray-15`, `dark`); the smoke-fixture FPC flake.

## Seeds (FINAL — approved 2026-06-19)

Use exactly ONE per implementation session (they don't compose). **Recommended: `/goal`** (completion
is transcript-observable via the per-phase gates + ✓ markers in this file). Start the session in the
permission mode you intend (+ AFK authorization if applicable) so a loop/goal isn't stalled on prompts.

### /goal (recommended)

```
/goal All 7 phases marked ✓ in implementations-plan/design-system-externalization-round-2/plan.md (the per-phase headers in the file, not just chat), each ✓ backed by its phase's Validation gate (the exact commands + pass criteria written in plan.md) reported passing in the transcript; the faucet stays visually frozen through P1–P6 and ALL faucet-visual change lands only in P7; for each phase the agent has printed `LESSONS_FILE=implementations-plan/design-system-externalization-round-2/lessons/phase-N.md`; `/code-review max --fix` complete with findings applied + committed separately; codex post-impl audit (`/codex xhigh`) complete with high/critical findings addressed (incl. modularity/architecture); `bun run audit:vue` and `bun run lint` both report exit 0 in the transcript; P7 sign-off recorded in lessons (extension "no deltas" chrome+firefox + faucet intentional-restyle confirmed).
```

### /loop (fallback — fixed interval)

```
/loop 15m Drive implementations-plan/design-system-externalization-round-2 forward. Never idle waiting for my input. Each firing: (1) read plan.md + lessons/ (authoritative, not chat); `git status` + `git log --oneline -5`; if a PR exists, `gh pr view --json statusCheckRollup` (no --watch). (2) Waiting on CI is fine — confirm it's progressing; use the wait to review the diff / prep the next phase. (3) No task in hand? Take the next pending step from plan.md; after each edit run `bun run lint` + the touched-package tests; commit → push. Keep the faucet visually FROZEN until P7 (Button on AppButton; Spinner on SpinnerLegacy). (4) Stuck or facing a decision? `/codex xhigh` with full context, reach a defensible call, log it in lessons/phase-N.md. Never merge to main/release, never publish, never expand scope beyond plan.md. (5) Same step failed 5×? Stop, reassess with codex. (6) Phase green = its plan.md Validation gate passes (commands + criteria); paste the result, mark ✓ in plan.md, file lessons, print `LESSONS_FILE=...`, advance. (7) All 7 ✓? Run `/code-review max --fix` → commit → codex post-impl audit → address high/critical → write the wrap-up (what shipped, every contentious codex debate with ELI5 context, open items) and stop.
```
