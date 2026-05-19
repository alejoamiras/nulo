# M6 — Vue design system + component library (post-triple-audit)

> **Status**: draft v3, post final Codex xhigh review of v2. Awaiting user approval.
>
> **Replaces**: A11 (`implementations-plan/A11/plan.md`). A11.1 pilot (`humanizeOperationKind` extract, commit `3a701df`) is on master and folds into Phase 7b.
>
> **Renamed from A12**: identifier `A12` was found by Claude audit to collide with `AUDIT.md:102` (@ts-ignore masking type errors). The arc is the natural continuation of M1-M4's TypeScript boundary work into the Vue layer, so it lands in the M-series as M6.

## Why this exists

A11 was symptom-only: two popups are big, decompose them. The root cause is broader:

- 22 raw `<button :class="$style.cta">` in pages — `Button.vue` is bypassed because it doesn't fit the brutalist redesign
- 23 explicit `variant="brutalist"` Input usages — dual-variant smell
- **4 native `<input>`** still bypass the Input primitive (`auth.vue:179`, `send.vue:458`, `AmountCard.vue:79`, `capabilities/index.vue:452`)
- 14 New/Edit popup files = **6 matched pairs + 2 unpaired** (pairs: Account, Contact, Endpoint, Fpc, Network, Token; unpaired: `NewSenderPopup`, `EditProfilePopup`) — ~250 lines each, no `EntityForm` abstraction
- 3 export pages (`key.vue` 644, `full.vue` 597, `seed.vue` 577) — `key.vue` + `seed.vue` share a "reveal secret + copy" pattern; `full.vue` is a backup pipeline (different)
- **0 Vue component unit tests, 0 visual sandbox** — manual smoke is the only fidelity gate
- `PopupCard.vue` (in `src/components/Popup/`) violates the L2 layer rule: uses `ConfigServiceClient` directly with connect/disconnect lifecycle
- 6 of 19 `popup/components/modules/` SFCs are pure presentational (verified — no transitive service/store imports) and should be L3, not L4. (Round-3 audit ruled out 2 false positives: `WarningView` uses `useExternalLink()` which transitively pulls Pinia via `configClient.ts`; `TransactionsList` imports the service-bound `TransactionCard`.)
- 145 unique `data-testid` values across 490 e2e selectors — high regression risk during decomposition

M6 fixes that. It does to Vue what M1-M4 did to TypeScript: unify primitives, codify boundaries, add tests, add tooling. Decomposition lands at the **end** — after the toolbox is built.

## Scope

✅ **In**:
- Discovery + canonical design-system audit (with explicit decisions on Button/Input variant naming up-front)
- Vue component test infra (`@vue/test-utils` + `@pinia/testing`, reusing existing **jsdom**)
- Visual sandbox (originally **Histoire** with hard decision gate; **Histoire failed the gate against this repo's Vite 7.3.2 — switched to Storybook 10.3.5 per the planned fallback in Phase 2.** Build clean in 4s. Mentions of "Histoire" elsewhere in this plan should be read as "Storybook" unless explicitly tagged historical.)
- Automated visual regression (**Lost Pixel** against built Storybook stories) — originally mandatory from Phase 2; **deferred at Phase 2 then formally skipped post-Phase 9** per the retrospective in `STATUS.md`.
- Foundation primitive unification (Button, Input, Toggle, Checkbox, Dropdown, etc.) including `PopupCard` refactor
- Composite library (`FormPopup`, `EntityForm<T>`, `SecretRevealCard`, `InputWithButton`)
- Composable extraction layer (`useFormState`, `useEntityCrud<T>`, `useFeeEstimation`, `useDappPayload`)
- Decomposition of every 1000+ line file using the new toolbox
- Layer enforcement via `biome` `noRestrictedImports`
- Re-classification of `popup/components/modules/**` (8 modules → L3, 11 stay L4)
- Documentation (CLAUDE.md + `implementations-plan/M6/conventions.md`) + STATUS.md re-engageable tracker

❌ **Out**:
- New features
- Functional bug fixes (track separately if discovered mid-arc)
- Behavioral / visual changes (visual fidelity = zero deltas, except where audit explicitly decides to consolidate dual variants)
- TS migration of existing JS SFCs
- Service-layer refactors
- Routing changes
- Brand redesign
- **`ConfirmDialog` promise-API rewrite** (deferred to a follow-up — `cacheStore.confirm` callback pattern is working; this would be quality-of-life only)

## Goals (success criteria)

| Goal | Target |
|---|---|
| Single source of truth for primitives | Every `components/ui/` SFC has Histoire story + ≥5 unit tests |
| Eliminate raw cta buttons | 0 `<button class.*cta` in `popup/**`. (Goal does NOT extend to all 55 raw `<button>` repo-wide — icon/close/chip buttons can stay raw; only the cta-styled ones migrate.) |
| Eliminate raw `<input>` | 0 native `<input>` outside `components/ui/Input.vue` |
| Resolve dual-variant Input | Single `<Input>` API; `variant="brutalist"` either default or removed (decision made in Phase 0) |
| Component test coverage | 100% primitives (L0-L2), 100% composites (L3) — prop/event/slot contract |
| Big-file rule | Pages: target ≤500, **hard cap ≤600**. Windows + components: hard cap ≤400 |
| Visual sandbox | All primitives + composites surfaced in Histoire (or Storybook fallback) |
| Visual regression | Lost Pixel CI gate per sub-PR from Phase 4 onward |
| Quality gates | Typecheck + lint + unit + components + stories-build + visual-regression + e2e green per sub-PR |
| testid stability | 0 testid drift during decomposition (verified per sub-PR) |
| Documented conventions | `CLAUDE.md` + `implementations-plan/M6/conventions.md` |

## Inventory baseline (verified 2026-04-28)

Top offenders (Phase 7 targets):

| File | Lines | Phase 7 ID |
|---|---|---|
| `popup/pages/import.vue` | 1188 | 7c |
| `popup/windows/execute/index.vue` | 1088 | 7b |
| `popup/windows/capabilities/index.vue` | 966 | 7a |
| `popup/pages/tx/[id].vue` | 892 | 7d |
| `components/JsonViewer/LogsViewer.vue` | 811 | 7j |
| `popup/pages/send.vue` | 753 | 7e |
| `popup/components/modules/send/FeeSettingsCard.vue` | 721 | 7i |
| `popup/pages/settings/security/export/key.vue` | 644 | 7g |
| `popup/pages/settings/security/export/full.vue` | 597 | 7m (separate, not SecretRevealCard) |
| `popup/pages/settings/security/export/seed.vue` | 577 | 7g |
| `popup/components/popups/NewTokenPopup/CandidatesForm.vue` | 514 | 7k |
| `popup/pages/auth.vue` | 492 | 7f |
| `popup/pages/settings/contacts/index.vue` | 491 | 7h |
| `popup/pages/settings/advanced/account-state/authwits/index.vue` | 484 | 7h |
| `popup/pages/settings/connected-apps/[id].vue` | 475 | 7h |
| `popup/pages/settings/fpcs/index.vue` | 465 | 7h |
| `popup/pages/profile/new.vue` | 463 | 7h |
| `popup/windows/discover/index.vue` | 448 | 7l |

Counts (master `edbe2a3`):
- 38 SFCs in `src/components/` (4 core + 23 ui + 11 flat — Claude verified)
- 52 SFCs in `popup/components/` (19 modules + 32 popups + Navigation — Claude verified)
- 38 pages in `popup/pages/`
- 9 windows in `popup/windows/`
- 127 of 137 SFCs use `<style module>` — single styling discipline ✓
- **22** raw `<button class="cta">` (incl. `cta_outline`, `cta_red` flavors)
- 23 explicit `variant="brutalist"` Input usages
- **4 native `<input>`** outside primitives
- **14 New/Edit popup files = 6 matched pairs + 2 unpaired** — pairs: Account, Contact, Endpoint, Fpc, Network, Token; unpaired: `NewSenderPopup`, `EditProfilePopup`
- 9 composables (5 .ts + 4 .js — JS-vs-TS inconsistency)
- 0 Vue component unit tests
- 145 unique `data-testid` values across 490 e2e selectors

Pure modules to re-classify L4 → L3 in Phase 5 (round-3 verified — transitively pure; all have ZERO direct or transitive service/store imports):
1. `popup/components/modules/activity/TransactionAwaitingCard.vue`
2. `popup/components/modules/capabilities/CapabilityDetailPanel.vue`
3. `popup/components/modules/general/EmojiGrid.vue`
4. `popup/components/modules/send/AmountCard.vue`
5. `popup/components/modules/send/FeeJuiceCard.vue`
6. `popup/components/modules/send/SendTypesCard.vue`

Modules NOT promoted (transitive dependency on stores/services found in round-3 audit; remain L4 unless refactored):
- `popup/components/modules/activity/TransactionsList.vue` — imports `TransactionCard` (store/service-bound)
- `popup/components/modules/general/WarningView.vue` — uses `useExternalLink()` which pulls Pinia via `configClient.ts`

Layer-rule violation to fix in Phase 4:
- `src/components/Popup/PopupCard.vue` — uses `ConfigServiceClient` with connect/disconnect. Fix: extract `useFullscreenPopupSetting` composable; PopupCard becomes pure.

## Hard rules

1. **Auto-import covers `src/components/`** (incl. future `composite/` subdir) and `src/composables/` (top-level only — NOT subdirs). For Phase 6 service hooks, either flatten under `src/composables/` or add `src/composables/services/` to `dirs` in `vite.config.ts:125` during Phase 1. Outside `src/components/`, every extracted SFC requires explicit `import` in its parent.
2. **CSS isolation.** Local styles move WHOLESALE into the extracted SFC. Never pass parent `$style.x` to a child. Per sub-PR: confirm no class leaks into other regions.
3. **Service-client lifecycle stays in the parent** for orchestration pages and windows. Composables receive a connected client OR a "do-the-thing" function. They never `connect()`/`disconnect()`. Parent owns `onMounted`/`onUnmounted` ordering. **Pages and popup windows ARE allowed to instantiate service clients directly** (orchestration role); only L0-L3 are forbidden.
4. **Cleanup order preserved verbatim**: `service.disconnect()` → timer-clear → `window.removeEventListener("beforeunload", reject)`. Composables expose `dispose()`; parent calls in the existing slot.
5. **No "wrapper" components that just relocate a switch** (the A11 OpCard.vue dispatcher anti-pattern).
6. **testid preservation**: every extraction preserves all `data-testid` attributes verbatim. No invented testids during structural moves. Per sub-PR: diff testids before/after; halt if any drift.
7. **Granular stop rule** (round-3 calibrated):
   - typecheck/lint failure: fix and retry once
   - unit/component test failure: retry once after fix; halt the sub-PR if it reproduces
   - e2e or manual smoke 2× consecutive failures: halt the arc, post audit-and-iterate
   - visual regression diff: **threshold = 0 globally**; per-story masks/threshold overrides allowed only when a specific flaky region is documented in `conventions.md`. Any unmasked diff halts the sub-PR.
   - build failure: halt immediately
8. **Pre-existing bugs preserved verbatim** (carry from A11.1 lesson): no silent fixes during structural refactors. Document via test pin if behaviorally surprising.

## Architecture

### Layer model L0-L6

```
[L0] design tokens     src/design/tokens.ts (NEW)
                       Pure typed reflection of CSS vars. No imports beyond types.

[L1] core primitives   src/components/core/   (existing)
                       Flex, Icon, MaterialIcon, Text. Pure. No chrome.*.

[L2] ui primitives     src/components/ui/     (existing)
                       Button, Input, Toggle, ... Pure. No service/store/service-bound composable.
                       Future relocations: PopupCard moves here once de-coupled from Config.

[L3] composites        src/components/composite/  (NEW)
                       FormPopup, EntityForm, SecretRevealCard, InputWithButton, ...
                       Plus 6 modules promoted from L4 (TransactionAwaitingCard, ...).
                       May import L0-L2. No service/store.

[L4] feature modules   src/popup/components/modules/  (existing, reduced to 13 SFCs after promotions)
                       BalanceView, FeeSettingsCard, TokenCard, GasBalanceCard, ...
                       Service-bound. May import L0-L3.

[L5] popups + windows  src/popup/components/popups/, src/popup/windows/  (existing)
                       Orchestration. May import L0-L4. May own service-client lifecycle.

[L6] pages             src/popup/pages/  (existing)
                       Orchestration. May import L0-L4 + popups. May own service-client lifecycle.
```

Enforced via biome `noRestrictedImports` in Phase 8 — extending the existing M3.7 pattern (`biome.json:208`).

### Composables layer

```
[C0] pure utilities    src/composables/                 (existing)
                       useTicker, useExternalImage, useExternalLink, ...

[C1] service hooks     src/composables/  (flat) OR src/composables/services/  (subdir; requires vite.config.ts dirs update)
                       useFormState, useEntityCrud<T>, useFeeEstimation, useDappInteractionPayload, ...

[C2] page composables  Inline if used once; extract if reused.
```

## Phases (sequential — fan out within each)

### Phase 0 — Discovery + audit + decisions (~3-4 hr; **no code changes**)

**Entry**:
- M6 plan approved (2026-04-28).
- Brutalist redesign confirmed merged to master — drops `Input variant="default"` cleanly with no compatibility window.

**Work**:
1. **Inventory via bash one-shot** (NOT a typed script — saves 2-3 hours):
   ```bash
   find packages/extension/src -name '*.vue' | while read f; do
     lines=$(wc -l < "$f")
     has_module=$(grep -q '<style module>' "$f" && echo yes || echo no)
     has_cta=$(grep -q '\$style\.cta\|class="cta"' "$f" && echo yes || echo no)
     imports=$(grep -c '^import' "$f")
     # layer classification: simplified
     layer=$(case "$f" in
       */components/core/*) echo L1;;
       */components/ui/*) echo L2;;
       */components/composite/*) echo L3;;
       */popup/components/modules/*) echo L?;;  # mixed; hand-classify
       */popup/components/popups/*|*/popup/windows/*) echo L5;;
       */popup/pages/*) echo L6;;
       *) echo flat;;
     esac)
     echo "| $f | $lines | $layer | $imports | $has_module | $has_cta |"
   done > implementations-plan/M6/inventory.md
   ```
2. **Hand-audit** the inventory:
   - Every `cta`-styled button → tag for Phase 4a.
   - Every `variant="brutalist"` Input call → tag for Phase 4b decision.
   - Every native `<input>` → tag for Phase 4b migration.
   - Every NewX/EditX popup pair → tag for Phase 5b `EntityForm`.
   - `key.vue` + `seed.vue` → tag for Phase 5c `SecretRevealCard`. NOT `full.vue`.
   - 6 pure modules → tag for Phase 5 re-classification (L4 → L3).
3. **Write `implementations-plan/M6/audit.md`**:
   - Foundation primitive state (Button + Input + Toggle + ...).
   - Duplication clusters.
   - Decomposition targets, prioritized.
4. **Write `implementations-plan/M6/decisions.md`** — pre-approved by user 2026-04-28:
   - **Button variants** (proposal — final naming nailed in Phase 0): `primary` / `secondary` / `outline` / `ghost` / `cta` × `small` / `medium` / `large`. The 22 raw cta sites map: `cta` → `<Button variant="cta">` (12 sites), `cta + cta_outline` → outline-cta (6 sites — back/close/cancel), `cta + cta_red` → destructive-cta (1 site — reset profile).
   - **Input variant**: drop `variant="default"` entirely. Brutalist is the only path (redesign already merged to master). All 23 explicit `variant="brutalist"` callers drop the prop.
   - **PopupCard refactor**: composable extraction (`useFullscreenPopupSetting()` lives in `src/composables/`; PopupCard becomes pure and stays in L2). NOT a layer demotion. Sets the precedent for "separate visual contract from data source".
5. **Write `implementations-plan/M6/conventions.md`**:
   - CSS module naming (snake_case underscored)
   - Layer rules (L0-L6 above)
   - Test conventions: `*.test.ts` colocated with `*.vue`; story `*.story.vue` colocated
   - Composable conventions: parent owns lifecycle, composable exposes `dispose()`
   - Pinia testing: snippet for `createTestingPinia()`
   - testid preservation: rule + sub-PR check
6. **Write `implementations-plan/M6/STATUS.md`** — re-engageable tracker (format below).

**Exit gate**:
- 5 markdown docs reviewed (one-screen summary delivered to user).
- User-approved decisions in `decisions.md`.
- `brutalist-redesign` coordination confirmed.
- No code changes.

---

### Phase 1 — Vue component test infrastructure (~3-4 hr)

**Entry**: Phase 0 docs approved.

**Work**:
1. Add devDeps:
   - `@vue/test-utils` (Vue 3 component test API)
   - `@pinia/testing` (mock store consumers — `BalanceView.vue` uses 3 stores; required for L4 tests)
   - **NOT `happy-dom`** — reuse existing jsdom (`vitest.config.ts:42`)
2. **OPTIONAL** (round-3 audit): a separate `vitest.components.config.ts` is NOT mandatory. Existing `packages/extension/vitest.config.ts:40-65` already runs `src/**/*.test.ts` in jsdom — Vue component tests can live next to their SFCs and use the existing config. Only create a separate config if `bun run test` becomes too slow (defer optimization).
3. Add `bun run test:components` script (alias for `vitest run` filtered to component tests).
4. **Update `packages/extension/vite.config.ts:125` `unplugin-auto-import` `dirs`** if Phase 6 puts hooks in `src/composables/services/`. Decide in Phase 0 (flat vs subdir).
5. Pilot: write `components/ui/Button.test.ts` covering ≥5 cases:
   - Type/variant prop reactivity
   - Click event emission
   - Disabled state
   - Slot rendering
   - Loading state (Spinner appears)
   - Plus: `link` vs `button` rendering choice (Button.vue uses `:is="link ? RouterLink : 'button'"`)
6. Update CLAUDE.md with the new test layer.

**Exit gate**:
- `bun run test:components` runs and passes (1 file, ≥5 cases).
- `bun run typecheck:all` clean.
- One example pinned in `conventions.md`.
- `bun run build` clean.

---

### Phase 2 — Visual sandbox (Storybook 10) (~4-5 hr)

**Entry**: Phase 1 done.

**Round-3 audit said Histoire 0.17.x is the default with Storybook 10 as fallback. In execution, Histoire failed the hard decision gate** — both `0.17.17` and `1.0.0-beta.1` are incompatible with this repo's Vite 7.3.2 (resolveRollupOptions error on 1.0-beta; CommonJS-vs-ESM `import.meta` error on 0.17). **Switched to Storybook 10.3.5 per the planned fallback.** Build clean in 4s (well under the 30s gate).

**Lost Pixel (automated visual regression) deferred** out of Phase 2 per user concern that automated visual diff tools tend to be too noisy. Manual eyeball + e2e + component tests remain the primary fidelity gates. Re-evaluate after Phase 4 when ~5 stable primitive stories exist; if visual drift becomes hard to spot manually, install Lost Pixel then.

**Work**:
1. Add devDeps:
   - `storybook` (10.x line)
   - `@storybook/vue3-vite`
   - ~~`lost-pixel`~~ (deferred, see above)
2. Add `.storybook/main.ts`, `.storybook/preview.ts`, `bun run storybook` (dev), `bun run build-storybook` (CI). Add `storybook-static/` to `.gitignore`.
3. **Story sandbox bootstrap** — `.storybook/preview.ts` installs:
   - Global styles: `import "@/assets/styles/_base.scss"` and `import "@/popup/index.scss"` (these define every CSS var the primitives consume — `_base.scss:11-69`, `index.scss:1-19`)
   - Pinia: `app.use(createPinia())` via Storybook's `setup()` hook
   - Teleport roots `#popup` `#tooltip` `#dropdown` `#popover` `#toast` (required by Tooltip, DropdownRoot, Popover, ToastManager, Popup)
   - chrome.runtime stub mirroring `tests/vitest.setup.ts:88-113` (Storybook doesn't auto-stub it)
4. Pilot: `components/ui/Button.stories.ts` (Storybook CSF format) — full variant matrix.
5. **Hard decision gate** at end of pilot:
   - Does `bun run build-storybook` complete in <30s? ✅ (4s)
   - Does HMR work with auto-imported components? (verify in `bun run storybook` dev mode)
   - Does `<style module>` render correctly in stories? (verify in dev mode)
   - Do teleport-using primitives render correctly? (verify after Phase 4 lands more stories)
6. ~~Lost Pixel wired~~ — deferred (see top of phase). When eventually installed:
   ```ts
   // lost-pixel.config.ts (FUTURE)
   export const config = {
     storybookShots: { storybookUrl: './storybook-static' },
     imagePathBaseline: './.lost-pixel/baseline',
     threshold: 0,
   }
   ```
7. Update `conventions.md` with Storybook 10 story conventions + the preview setup contract.

**Exit gate**:
- `bun run build-storybook` clean (output at `storybook-static/`).
- One example `Button.stories.ts` renders all Button variants.
- Hard decision gate: Storybook 10 build < 30s ✅
- ~~Lost Pixel~~ deferred — re-evaluate post-Phase 4.

---

### Phase 3 — Design tokens (~2 hr)

**Entry**: Phase 2 done.

**Work**:
1. Read every CSS var in `src/assets/styles/_base.scss` (lines 11-69 carry the brutalist palette/spacing/typography) and `src/popup/index.scss` (popup shell). (Round-3 audit corrected v2: source paths are SCSS, not `src/styles/`.)
2. Extract to `src/design/tokens.ts` — typed exports for color names, spacing scale, typography scale, motion scale.
3. One Histoire story per category (Colors, Spacing, Typography, Motion).
4. **No CSS rewrites** — tokens.ts is a typed reflection of existing CSS vars.

**Exit gate**:
- tokens.ts compiles + typecheck clean.
- Histoire renders 4 token panels.
- Lost Pixel: zero visual diff (we didn't change anything).

---

### Phase 4 — Foundation primitives unification (~7-9 hr; multi-PR)

**Entry**: Phase 3 done. **`decisions.md` finalized** (Button + Input variant naming approved).

**Sub-PRs (decisions already made; no mid-arc blocking)**:

**4a — Button unification**
- Apply variant decision from `decisions.md`. Likely path: rename `type` prop → `variant`; add brutalist CTA shape as a variant.
- Update `Button.vue`.
- `Button.story.vue` — full variant matrix.
- `Button.test.ts` — ≥10 cases.
- Migrate 22 raw `<button class="cta*">` sites.
- **64 callers of existing `type=` prop also migrated** (Claude flagged the rename surface).

**4b — Input unification**
- Apply variant decision from `decisions.md`.
- Add `Input.story.vue` + `Input.test.ts` (≥10 cases).
- Migrate 23 `variant="brutalist"` callers.
- **Migrate 2 simple native `<input>` sites**: `AmountCard.vue:79`, `capabilities/index.vue:452`.
- The other 2 native inputs (`auth.vue:179` password+toggle, `send.vue:458` recipient+suggestions) **defer to the InputWithButton sub-PR (5b)** — they need the composite, not the bare Input. (Round-3 audit caught this hidden dependency.)

**4c — PopupCard refactor (NEW from audit)**
- Extract `useFullscreenPopupSetting` composable in `src/composables/`.
- `PopupCard.vue` becomes pure (no ConfigServiceClient).
- Move from `src/components/Popup/` to `src/components/ui/Popup/` (or stay flat with note).
- Story + tests.

**4d — Other primitives** (in batches by domain similarity, NOT one-per-PR; round-3 reordered):
- **Layout batch**: Spinner, Badge, Banner, **LoadingState** (moved from composite-ish)
- **Form batch**: Toggle, Checkbox
- **Overlay batch**: Popover, Tooltip, **Dropdown** (DropdownRoot/Trigger/Item/Title/Divider — moved from composite-ish; teleport-using like Popover/Tooltip)
- **Settings family**: SectionLabel, SubPageHeader, Settings/* (ItemsContainer, SettingField, SettingItem, SettingValue)
- **Toast/Popup batch (NEW from round-3)**: `ToastManager.vue`, `Popup/PopupHeader.vue` — both in `components/ui/`, missed in v2's "every primitive" goal

Each batch: one sub-PR with stories + tests + audit-driven inconsistency fixes.

**Exit gate per sub-PR**:
- Story renders.
- Unit tests pass (≥5 each).
- Lost Pixel diff = 0 (or explicitly approved).
- Typecheck + lint + build clean.
- E2E smoke (`tests/e2e/registration.test.ts`, `tests/e2e/accounts.test.ts`) passes.
- testid stability: 0 drift.
- **Selector-contract gate**: e2e fixtures still locate elements.

---

### Phase 5 — Composite library + module re-classification (~7-9 hr; multi-PR)

**Entry**: Phase 4 done (or 4a-4b done if a composite needs only Button + Input).

**Sub-PRs** (re-ordered per round-3 audit; `useFormState` interleaves from Phase 6):

**5a — `FormPopup`** (header + body + footer + save/cancel slot)
- Replaces boilerplate at the top of every NewX/EditX popup (~50 lines × 14 popups ≈ ~700 lines saved on the shell).
- Story: minimal, with-error, loading.
- Migrate `NewContactPopup.vue` first as proof; then 5 more popups in same PR.

**5b — `InputWithButton`** (moved up from 5e — round-3: required before raw `<input>` migration in auth/send)
- Composite for input + adornment patterns: password+toggle, recipient+suggestion popover, paste/scan/clear.
- Story matrix.
- **Migrates the 2 deferred native `<input>` sites**: `auth.vue:179` (password + visibility toggle), `send.vue:458` (recipient + suggestion popover).
- This completes the 4 native-input migration started in 4b.

**5c — Re-classify pure modules to L3** (round-3 audit corrected list — 6 modules, not 8)
- Move 6 transitively-pure modules from `popup/components/modules/` to `src/components/composite/`:
  1. `TransactionAwaitingCard.vue` → `composite/activity/`
  2. `CapabilityDetailPanel.vue` → `composite/capabilities/`
  3. `EmojiGrid.vue` → `composite/general/`
  4. `AmountCard.vue` → `composite/send/`
  5. `FeeJuiceCard.vue` → `composite/send/`
  6. `SendTypesCard.vue` → `composite/send/`
- **NOT promoted** (transitive store/service deps): `TransactionsList`, `WarningView` — stay L4 unless refactored.
- Update import paths in all callers via explicit `import` rewrites (round-3: existing callers like `send.vue:11-14` and `execute/index.vue:3-4` use explicit imports — auto-import does NOT transparently handle path changes for already-imported components).
- Add stories + tests for each (≥5 cases each).

**INTERLUDE: 6d — `useFormState` ships here** (audit-driven re-order)
- Controlled inputs + validation rules + dirty tracking.
- Tests ≥10 cases.
- Migrate `NewContactPopup` to use it.

**5d — `EntityForm<T>`** for NewX/EditX twins
- Built ON TOP of `useFormState`.
- Single-source field definitions; same form renders for new + edit.
- **Round-3 audit clarified**: there are 6 matched pairs, not 7. Migration scope:
  - **In M6 scope**: `NewContactPopup` + `EditContactPopup` → `ContactForm` (proof migration)
  - **In M6 scope (sub-PRs in 5d-bis)**: Account pair, Endpoint pair, Fpc pair, Network pair, Token pair (5 follow-up sub-PRs, each ~150 lines saved)
  - **Out of M6 scope**: unpaired `NewSenderPopup` + `EditProfilePopup` migrations (separate cleanup; track in `STATUS.md` as known follow-ups)
- Estimated savings: ~150 lines × 6 pairs = ~900 lines.

**5e — `SecretRevealCard`** — `key.vue` + `seed.vue` ONLY (NOT `full.vue`)
- Reveal-on-click, copy.
- Migrate one export page first; lines saved across 2 pages: ~250.
- `full.vue` decomposes separately in 7m.

**~~5f — ConfirmDialog upgrade~~** ❌ **DEFERRED** out of M6 per round-2 audit (scope creep; current `cacheStore.confirm.callback` pattern works).

**Exit gate per composite**: same as Phase 4 sub-PR + Lost Pixel gate.

---

### Phase 6 — Composables extraction (~3-4 hr; remainder after `useFormState` shipped in Phase 5)

**Entry**: Phase 1 done (test infra). `useFormState` (6d) already shipped in Phase 5.

**Sub-PRs**:

**6a — `useEntityCrud<T>`** — generic entity CRUD: subscribe `onAdded`/`onUpdated`/`onDeleted`, expose reactive list.
- ~14 popup consumers (paired NewX/EditX use the same service); ~100 lines saved per consumer.
- Tests ≥10 cases.
- Used by `EntityForm<T>` (5c) for the underlying data layer.

**6b — `useFeeEstimation`** — per-op fee estimation with debounce + dispose.
- Replaces inline pattern in execute window + send page (was A11.3 in old plan).
- **Required BEFORE Phase 7b (execute) and 7e (send)** decompositions.

**6c — `useDappInteractionPayload`** — load + decode dApp interaction payload.
- Used by execute, capabilities, discover, verify, json windows.
- **Required BEFORE Phase 7a (capabilities) and 7b (execute)** decompositions.

**Exit gate per composable**:
- Tests ≥10 cases each.
- Types explicit (no `any`).
- Callers no longer import service clients directly.
- `bun run audit:vue` clean.

---

### Phase 7 — Page/popup decomposition (~10-14 hr; multi-PR)

**Entry**: Phases 4-6 done (composables required for windows).

Order of attack (composable-driven dependencies first; round-3 reordered for parallelism):

| Sub-PR | Target | Current | Goal | Required composables | Notes |
|---|---|---|---|---|---|
| 7g | export pages (`key.vue` + `seed.vue`) | 644+577 | ≤ 250 each | (consumes `SecretRevealCard` from 5e) | **Moved earlier** — depends only on 5e, not Phase 6 |
| 7j | `LogsViewer.vue` | 811 | ≤ 400 | — | **Independent of Phase 6**; can pull earlier under scheduling pressure |
| 7a | `capabilities/index.vue` | 966 | ≤ 400 | useDappInteractionPayload | |
| 7b | `execute/index.vue` | 1088 | ≤ 400 | useDappInteractionPayload, useFeeEstimation | |
| 7l | `discover/index.vue` | 448 | ≤ 350 | useDappInteractionPayload | **Parallelizable with 7a/7b** once 6c lands |
| 7c | `import.vue` | 1188 | ≤ 600 (hard cap) | useFormState, useEntityCrud | |
| 7d | `tx/[id].vue` | 892 | ≤ 500 | (depends on what's there) | |
| 7e | `send.vue` | 753 | ≤ 500 | useFeeEstimation, useFormState | **Verify 7i (FeeSettingsCard) lands first** since send.vue consumes it |
| 7f | `auth.vue` | 492 | ≤ 350 | useFormState | (raw input migrated in 5b InputWithButton) |
| 7h | settings/contacts, connected-apps/[id], fpcs, profile/new, authwits | 491+475+465+463+484 | ≤ 350 each | useEntityCrud | |
| 7i | `FeeSettingsCard.vue` | 721 | ≤ 400 | (extract `FeeMethodRow` + `FeeCostReadout`) | **Land before 7e** |
| 7k | `NewTokenPopup/CandidatesForm.vue` | 514 | ≤ 350 | useFormState | |
| 7m | `full.vue` (export backup) | 597 | ≤ 400 | (separate decomposition; not SecretRevealCard) | |

For each sub-PR:
- Use Histoire to confirm before/after visual fidelity (Lost Pixel diff = 0 or approved).
- Run relevant e2e: dApp window decompositions trigger network suite; pages trigger registration/accounts/transfers.
- testid preservation diff verified.
- Pre-existing bugs preserved verbatim (lesson from A11.1).

---

### Phase 8 — Layer enforcement (~2-3 hr)

**Entry**: Phase 7 done.

**Work**:
1. Add `biome.json` `noRestrictedImports` overrides:
   - `src/components/composite/**` cannot import service clients, stores, or service-bound composables.
   - **L4 modules** (the 13 remaining `popup/components/modules/**`) cannot import L5/L6.
   - **NOT** a blanket service-import ban for L5/L6 — pages and windows legitimately own service lifecycles (audit confirmed).
2. Run lint; fix any violations.

**Exit gate**: lint clean.

---

### Phase 9 — Documentation + automation (~2 hr)

**Entry**: Phase 8 done.

**Work**:
1. Update CLAUDE.md project section:
   - Layer model L0-L6
   - Component test conventions
   - Story conventions
   - Composable conventions (when to extract vs pure helper)
   - testid preservation rule
2. Update `implementations-plan/M6/conventions.md` with final decisions.
3. Add `bun run audit:vue` script:
   ```
   bun run typecheck:all &&
   bun run test:components &&
   bun run story:build &&
   bun run lost-pixel &&
   bun run lint &&
   bun run build &&
   bun run test:e2e tests/e2e/registration.test.ts
   ```

**Exit gate**: docs reviewed; `bun run audit:vue` exits 0.

---

### Phase 10 — Final verification + visual regression sweep (~2-3 hr)

**Entry**: Phase 9 done.

**Work**:
1. Full e2e suite (`bun run test:e2e:all`) green.
2. **Manual smoke matrix** (provided as checklist in PR description):
   - Connect dApp → execute popup
   - Connect dApp → capabilities popup (rerequest path included)
   - Send sponsored
   - Send Fee Juice (public + private)
   - Reset profile
   - Change password
   - Add contact + edit contact + delete contact
   - Add token + edit token + delete token
   - Settings → walk every section
   - Export seed / key / full
3. Storybook sweep (`bun run build-storybook`): every primitive + composite renders, every variant visible.
4. ~~**Final Lost Pixel run**~~: **skipped** per the retrospective in `STATUS.md` (audited by codex + Opus 4.7; both agreed manual eyeball + 1212-test suite caught everything in phases 4-9).
5. Audit: any regressions, line targets missed, debt accumulated.
6. Mark M6 done in `AUDIT.md` and `implementations-plan/M6/STATUS.md`.

**Exit gate**:
- Full e2e suite green.
- Manual smoke matrix all green.
- Lost Pixel: 0 unexpected diffs.
- All line targets met (or risk-#4-style explanations for any miss).
- `STATUS.md` 100% checked.

## Quality gates (per sub-PR)

| Gate | What | When | Stop policy |
|---|---|---|---|
| typecheck | `bun run typecheck:all` | always | retry once |
| lint | `bun run lint` | always | retry once |
| build | `bun run build` | always | halt immediately |
| component tests | `bun run test:components` | per primitive/composite/composable change | halt sub-PR |
| stories build | `bun run story:build` | per primitive/composite change | halt sub-PR |
| visual regression | `bun run lost-pixel` | per Phase 4-7 sub-PR | halt sub-PR |
| unit tests | `bun run test` | per composable/helper change | halt sub-PR |
| e2e smoke | `tests/e2e/registration.test.ts`, `tests/e2e/accounts.test.ts` | per Phase 7 sub-PR | 2× halt arc |
| e2e network | relevant `tests/e2e/network/*.test.ts` | per dApp window decomposition | 2× halt arc |
| testid drift check | diff testid set before/after | per sub-PR | halt sub-PR |
| manual QA | scenario in PR description | per Phase 7 sub-PR + final | 2× halt arc |

## Tracker (re-engageability)

`implementations-plan/M6/STATUS.md` carries (rich format per audit):

```
# M6 — Status

## Current state (round-3 audit added these fields)
- Branch: <e.g. m6/phase-4a-button>
- Base SHA: <e.g. edbe2a3>
- Worktree scope: <files currently dirty / intended write scope>
- Last verified gates (at HEAD <sha>):
  - [x] typecheck:all
  - [x] lint
  - [x] build
  - [x] test:components
  - [x] story:build
  - [ ] lost-pixel  ← currently failing on Button.story.vue:hover state
  - [x] e2e:registration
- Last failing command + error signature: <e.g. `bun run lost-pixel` → "Button.story.vue:hover state diff = 0.4%"; baseline at .lost-pixel/baseline/Button-hover.png>
- Visual-regression baseline reference: <commit SHA the baseline was captured from>
- Blocking decisions: none
- Next unchecked task: 4a complete the Button hover state baseline (re-capture or mask)
- Last manual smoke: 2026-04-29 — registration + dApp execute popup, all green
- Last commit: <sha>: <subject>

## Phase 0 — Discovery (DONE)
- [x] inventory.md
- [x] audit.md
- [x] decisions.md (signed off by user 2026-04-28)
- [x] conventions.md
- [x] STATUS.md (this file)

## Phase 1 — Vue test infra (DONE)
- [x] @vue/test-utils + @pinia/testing installed (jsdom reused; existing vitest.config.ts kept)
- [x] bun run test:components script
- [x] Button.test.ts pilot (5 cases)
- [x] CLAUDE.md updated
- [x] vite.config.ts dirs updated for src/composables/services/ (if used)

## Phase 2 — Histoire + Lost Pixel (DONE)
- [x] histoire installed (pinned to 0.17.x)
- [x] histoire.config.ts + histoire.setup.ts (global styles + Pinia + teleport roots + chrome stub)
- [x] bun run story works
- [x] bun run story:build clean (15s)
- [x] Button.story.vue pilot
- [x] lost-pixel installed with histoireShots config
- [x] Initial baseline captured (threshold = 0)
- [x] Hard decision gate passed (Histoire kept)

## Phase 3 — Tokens (DONE)
- [x] src/design/tokens.ts (from src/assets/styles/_base.scss + src/popup/index.scss)
- [x] tokens story rendered (4 panels)

## Phase 4 — Primitives (IN PROGRESS)
- [x] 4a — Button (variant rename + 22 cta sites + 64 type= callers)
- [ ] 4b — Input (variant decision + 23 brutalist + 2 simple native [AmountCard, capabilities])
- [ ] 4c — PopupCard refactor (useFullscreenPopupSetting)
- [ ] 4d — batches (Layout incl. LoadingState / Form / Overlay incl. Dropdown / Settings / Toast+PopupHeader)

## Phase 5 — Composites (PENDING)
- [ ] 5a — FormPopup
- [ ] 5b — InputWithButton (migrates auth.vue + send.vue raw inputs)
- [ ] 5c — Re-classify 6 pure modules to L3
- [ ] 5d — EntityForm<T> (Contact pair migration; +5 follow-up sub-PRs for Account/Endpoint/Fpc/Network/Token)
  - [ ] interlude: 6d useFormState
  - [ ] 5d-i Contact pair
  - [ ] 5d-ii Account pair
  - [ ] 5d-iii Endpoint pair
  - [ ] 5d-iv Fpc pair
  - [ ] 5d-v Network pair
  - [ ] 5d-vi Token pair
- [ ] 5e — SecretRevealCard (key + seed migration)

## Phase 6 — Composables remainder (PENDING)
- [ ] 6a — useEntityCrud<T>
- [ ] 6b — useFeeEstimation
- [ ] 6c — useDappInteractionPayload

## Phase 7 — Decomposition (PENDING)
(... etc; see plan.md for full list)
```

A future cold-start agent reads STATUS.md, sees:
- Branch + base SHA → checkout instantly
- Last green gates → know what's already verified
- Next unchecked → know what to do
- Blocking decisions → know who to ask

## Estimated time

| Phase | v1 | v2 | v3 (post round-3 audit) |
|---|---|---|---|
| 0 — Discovery + decisions | 3-4 | 3-4 | 3-4 |
| 1 — Test infra | 3-4 | 3-4 | 3-4 |
| 2 — Histoire + Lost Pixel | 3-4 | 5-6 | **6-8** (added bootstrap setup + teleport roots + chrome stub) |
| 3 — Tokens | 2 | 2 | 2 |
| 4 — Primitives | 6-8 | 7-9 | **8-10** (added ToastManager + PopupHeader + reordered batches) |
| 5 — Composites + re-classify | 6-8 | 7-9 | **10-13** (added 5 follow-up EntityForm migrations) |
| 6 — Composables (remainder) | 4-5 | 3-4 | 3-4 |
| 7 — Decomposition | 8-12 | 10-14 | **12-16** (parallelizable but more sub-PRs explicit) |
| 8 — Layer enforcement | 2-3 | 2-3 | 2-3 |
| 9 — Docs | 2 | 2 | 2 |
| 10 — Final verification | 2-3 | 2-3 | 3-4 (added Lost Pixel sweep) |
| **Total** | **41-55 hr** | **45-65 hr** | **54-73 hr** |

Round-3 audit estimated 60-85h with all popup migrations in scope; 70-95h if including the unpaired Sender/Profile cleanup. v3 keeps Sender/Profile out of M6 scope (tracked as known follow-up in STATUS.md), landing at 54-73h.

## Risks (post-audit, expanded)

| Risk | Severity | Mitigation |
|---|---|---|
| **e2e selector breakage** during primitive migration | **H** | Hard rule #6 (testid preservation), per-sub-PR diff, selector-contract gate before Phase 4 |
| Visual fidelity loss | H | Lost Pixel automated diff per sub-PR (Phase 2 onward); manual smoke matrix in Phase 10 |
| Time cost (54-73 hr) | H | Phases independent; STATUS.md tracker enables pause/resume |
| **Histoire/Lost Pixel + bun tooling gotchas** (round-3) | M | Vitest officially supports bun; Histoire/Lost Pixel docs don't mention bun. Pilot in Phase 2; if blocker, switch to Storybook 10 |
| **Service-worker context leakage in stories/tests** (round-3) | M | Vitest stubs `chrome.runtime` at `tests/vitest.setup.ts:88-113`; Histoire bootstrap MUST add equivalent stub. Service-bound stories deferred until stub lands |
| Histoire maintenance status (last release April 2024) | M | Hard decision gate Phase 2; Storybook 10 fallback ready |
| **CSS specificity battles** during multi-PR extractions | M | Hard rule #2 (full block transfer per PR; no partial moves); manual smoke per sub-PR |
| Existing tests break mid-arc | M | E2E smoke per Phase 7 sub-PR + `audit:vue` script |
| Premature abstraction (composite not actually reused) | M | Phase 0 audit drives extracts from REAL duplication; never speculative |
| **Decision deadlock mid-arc** | M | Decisions absorbed in Phase 0 `decisions.md`, signed off before Phase 4 |
| Concurrent agent contention on e2e ports | L | `feedback_e2e_isolation` memory; check `lsof -ti:5174` per run |
| Library rule misalignment with Aztec churn | L | tokens.ts forward-only; Histoire offline; no Aztec coupling |

## Decisions (pre-approved by user 2026-04-28)

- [x] **Plan scope** — M6 replaces A11; broader. APPROVED.
- [x] **Histoire** as visual sandbox with Storybook 10 fallback. APPROVED.
- [x] **Phase ordering** — dependency-aware (`5b InputWithButton` early, `useFormState` interleaves Phase 5). APPROVED.
- [x] **Time budget** — 54-73 hours over multiple sessions, no rush. APPROVED.
- [x] **Phase 0 decisions**:
  - Button variants per proposal above (final names nailed in Phase 0)
  - Input variant: drop `default`; brutalist is the only path
  - PopupCard: composable extraction (stays in L2)
- [x] **`SecretRevealCard` scope** — `key.vue` + `seed.vue` only; `full.vue` decomposes separately in Phase 7m. APPROVED.
- [x] **`ConfirmDialog` deferred** out of M6, tracked as good follow-up in STATUS.md.
- [x] **EntityForm rollout** — 6 paired migrations IN scope; 2 unpaired (Sender, Profile) out of scope, tracked as STATUS.md follow-up.
- [x] **Brutalist redesign** already merged to master; coordination concern resolved.

## Known follow-ups (out of M6 scope, tracked for later)

- `ConfirmDialog` promise-API upgrade (the current `cacheStore.confirm.callback` pattern works; promise-based ergonomics is a quality-of-life win — defer)
- `NewSenderPopup` decomposition (no Edit counterpart, doesn't fit `EntityForm`)
- `EditProfilePopup` decomposition (no New counterpart, doesn't fit `EntityForm`)

## Audit history

### Round 1 — Codex xhigh + Claude general-purpose (parallel)
v1 → v2 changes driven by both audits:
- Module re-classification scope (Claude listed 8; Codex listed 3) — v2 used Claude's list
- Verified counts (14 popup files, 22 cta refs, 4 native inputs, 127 of 137 with module CSS)
- `PopupCard` L2 violation (Claude-only finding) → Phase 4c
- `type` prop rename 64 callers (Claude-only) → Phase 4a
- A12 → M5 rename (Claude flagged `AUDIT.md:102` collision) — later renamed to M6 per user

### Round 2 — Codex xhigh on v2 (final)
v2 → v3 changes driven by single Codex audit:
- **Popup-pair count corrected**: 14 files = 6 pairs + 2 unpaired (was "7 pairs")
- **L3 promotion list reduced from 8 → 6**: `WarningView` uses `useExternalLink()` which transitively pulls Pinia; `TransactionsList` imports the service-bound `TransactionCard`
- **Phase 2 bootstrap added**: `histoire.setup.ts` MUST install global SCSS + Pinia + teleport roots + chrome stub
- **Lost Pixel config explicit**: `histoireUrl: './.histoire/dist'`, threshold = 0
- **5b InputWithButton moved before 4b's complex raw input migration**: `auth.vue` password+toggle and `send.vue` recipient+suggestions need the composite, not bare Input
- **4d batches reordered**: Dropdown → overlay (with Popover/Tooltip), LoadingState → layout
- **4d additions**: `ToastManager.vue` and `Popup/PopupHeader.vue` (missed in v2's "every primitive" goal)
- **CSS source paths corrected**: `src/assets/styles/_base.scss` + `src/popup/index.scss` (not `src/styles/`)
- **Naming consistency**: `useDappInteractionPayload` (drop `useDappPayload` shorthand)
- **Goal scope clarified**: "0 cta-styled `<button>`" — not "everything uses `<Button>`" (55 raw icon/close/chip buttons remain valid)
- **Time estimate adjusted**: 45-65 → 54-73 (with the 5 follow-up EntityForm sub-PRs explicitly scheduled)
- **STATUS.md fields added**: worktree scope, last failing command + error signature, baseline reference
- **Stop rule calibrated**: visual diff threshold = 0 globally; per-story masks documented; unit/component test failure retries once before halt
- **Phase 7 ordering**: 7g (exports) and 7j (LogsViewer) moved earlier; 7l (discover) parallelizable with 7a/7b once 6c lands
- **Drop "vitest.components.config.ts mandatory"**: existing config already runs `src/**/*.test.ts` in jsdom
- **Drop "auto-import handles new paths transparently"**: existing callers use explicit imports, so re-classification path changes still require import rewrites

## Lessons absorbed from A11.1 pilot

A11.1 extracted a 29-line pure helper from `execute/index.vue`, added 7 unit tests including the pre-existing-bug pin, kept the bug verbatim. Confirms:
- Pure-helper extraction is the lowest-risk pattern.
- Pre-existing bugs MUST be preserved verbatim (with documented pin) during structural refactors.
- `wc -l` line target is a guardrail, not a goal — A11.1 reduced execute by 8 lines while adding test coverage.

M6 carries this forward as Hard Rule #8: every extraction documents and pins existing behavior. No silent fixes.

---

**End of plan v3. Awaiting user approval.**
