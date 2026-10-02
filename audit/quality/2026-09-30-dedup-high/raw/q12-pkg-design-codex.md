# q12-pkg-design — codex

Scope read:

- `CLAUDE.md`, `biome.json`, the supplied repo maps, production clone leads, and both prior quality reports.
- `packages/design/src/{core,ui,composite,composables}/`; token contract, generator/renderers, base stylesheet, exports, and theme helpers. Generated `tokens.ts`, generated utility rules, fonts, and icon data excluded.
- Relevant design tests: sanitizer, boundary, Skeleton, Popover, and snackbar behavior.
- Extension components: local UI wrappers, DropdownRoot, AddressDisplay, ScopeAddress, ScopeClassId, EmojiGrid, AmountCard, Settings fields, capability rows/table, barrier/identity frames, PasskeyCeremonyDialog, and log toolbar/lifecycle excerpts.
- Extension popup styling: fee readouts, received-detail shimmer, glossary, and shared window shell; broader component/popup CSS reference searches.
- Component resolver, route configuration, generated component declarations, PopupManager registration, composable shims, sanitizer implementation/parity test, and immediate sanitizer consumers.
- Git history for finding locations.

Read-only static audit at `dev`, commit `910a4def`. No files changed or tests executed. History counts below are **all-time / since 2026-06-01**, without rename following.

## q12-pkg-design-X-1: Loading placeholders bypass the shared Skeleton

**Title:** Four implementations of the loading shimmer.

**Smell name:** Duplicate Code → Shotgun Surgery (Fowler). **Confidence: high.**

**Maintenance impact:** Structural. Four implementation files and two additional consuming components across the design package and extension. Commit counts: Skeleton **1/1**, AmountCard **6/6**, fee stylesheet **2/2**, FeeCostReadout **5/5**, FeeMethodRow **4/4**, received page **5/5**; **13/13 distinct commits** across these files.

**Concrete evidence:** Each implementation animates a three-stop gradient across a `200% 100%` background, moving its position from `200%` to `-200%`.

- Canonical component: `packages/design/src/ui/Skeleton.vue:23-52`.
- Exact gradient/timing copy, with different dimensions: `apps/extension/src/components/composite/send/AmountCard.vue:558-574`; rendered at `:428`.
- Exact gradient/timing copy: `apps/extension/src/popup/components/modules/send/fee-shared.module.css:30-46`; consumed by `FeeCostReadout.vue:27,78-80` and `FeeMethodRow.vue:29,38,55-57` in that directory.
- Same animation mechanism with different colors and timing: `apps/extension/src/popup/pages/received/[id].vue:488-516`; rendered at `:305`.

The shared component already accepts dimensions and forwards test IDs. Its reduced-motion handling is also duplicated in the received page, while the Send copies omit it.

**Why it harms future change:** Updating the loading animation or its motion treatment requires finding three extension implementations after changing the canonical component. Existing differences are interleaved with the shared mechanism, making intentional variation difficult to distinguish from drift.

**Smallest safe refactoring:** Replace Inline Code with Component Use. Adopt `packages/design/src/ui/Skeleton.vue` for the Send copies. Parameterize its palette/timing through narrowly scoped CSS custom properties before migrating the received page. Preserve dimensions, existing visual values, and test IDs; account explicitly for the differing reduced-motion behavior.

**What disappears:** Three duplicate stylesheet implementations, including three keyframe definitions—approximately 60 lines before retaining variant parameters—and the fee components’ redundant CSS composition rules.

**Instances:** `packages/design/src/ui/Skeleton.vue:23`; `apps/extension/src/components/composite/send/AmountCard.vue:428,558`; `apps/extension/src/popup/components/modules/send/fee-shared.module.css:30`; `apps/extension/src/popup/components/modules/send/FeeCostReadout.vue:27,78`; `apps/extension/src/popup/components/modules/send/FeeMethodRow.vue:29,38,55`; `apps/extension/src/popup/pages/received/[id].vue:305,488`.

## q12-pkg-design-X-2: Three components independently define the same themed hairline

**Title:** The soft-divider palette has three owners.

**Smell name:** Duplicate Code → Shotgun Surgery (Fowler): changing one shared theme-dependent color requires editing three unrelated components. **Confidence: high.**

**Maintenance impact:** Structural, confined to styling. Three consumers plus the design token owner. Commit counts: DetailsTable **2/2**, PermissionRow **2/2**, glossary **1/1**; canonical `base.css` **7/7**.

**Concrete evidence:** All three define the identical policy: dark/default divider `rgba(74, 70, 63, 0.2)`, overridden in light mode by `rgba(124, 116, 104, 0.2)`.

- `apps/extension/src/components/composite/capabilities/DetailsTable.vue:135-145` defines a local `--hairline-soft`, used at `:171,184,260`.
- `apps/extension/src/components/composite/capabilities/PermissionRow.vue:80-86` repeats the pair directly on its border.
- `apps/extension/src/popup/pages/settings/glossary.vue:54-65` repeats the pair on another border.

The package owns related theme border values in `packages/design/src/base.css:89-90,148-149,206-207`, but none represents this exact pair. Substituting the existing `--border` would change opacity.

**Why it harms future change:** Adjusting the shared divider contrast requires three synchronized theme edits. DetailsTable’s local variable makes its own uses consistent, but cannot propagate that adjustment to permission rows or the glossary.

**Smallest safe refactoring:** Extract Variable into a shared design token, defined once per theme in `packages/design/src/base.css` and named in `token-contract.ts`. Replace the three local policies with that token, preserving the exact current values.

**What disappears:** Two redundant copies of the palette pair and three component-level light-theme overrides. Border geometry remains local.

**Instances:** `apps/extension/src/components/composite/capabilities/DetailsTable.vue:137,144`; `apps/extension/src/components/composite/capabilities/PermissionRow.vue:81,85`; `apps/extension/src/popup/pages/settings/glossary.vue:60,64`.

## q12-pkg-design-X-3: Snackbar card markup is maintained twice

**Title:** Success and error snacks duplicate the same card behavior.

**Smell name:** Duplicate Code (Fowler). **Confidence: high.**

**Maintenance impact:** Local. One package component serving all extension snacks; **3/3 commits**.

**Concrete evidence:** `packages/design/src/ui/ToastManagerBase.vue:131-150` and `:162-184` repeat the card identity, four pointer/focus listeners, label/subtext rendering, and optional action button. Differences are the kind, icon, error class, and error-only close button.

The separate persistent `status` and `alert` regions are intentional and tested at `packages/design/src/ui/ToastManagerBase.test.ts:108-131`. They do not require duplicating the card inside each region.

**Why it harms future change:** A change to action rendering, pointer handling, or focus handling must be applied to both bodies. These bindings participate in shared pause/resume and stale-card protections, so partial edits create two versions of the same interaction contract.

**Smallest safe refactoring:** Extract Component into an internal L2 `ToastCard.vue` beside `ToastManagerBase.vue`. Parameterize the existing visual differences and retain the current region containers, transitions, ID-bound callbacks, and manager-owned lifecycle.

**What disappears:** One copy of the common card template and its four event bindings. The two persistent announcement regions remain.

**Instances:** `packages/design/src/ui/ToastManagerBase.vue:131-150`; `packages/design/src/ui/ToastManagerBase.vue:162-184`.

## q12-pkg-design-X-4: Eight exported components have no production consumers

**Title:** Retired design components remain in the private package API.

**Smell name:** Dead Code (Fowler). **Confidence: high.**

**Maintenance impact:** Local to the package, spanning eight component files and its barrel. Mostly dormant: Card, Tag, BalanceRow, DisclaimerTag, and EmojiGrid each have **1/1 commits**; Toast, AddressDisplay, and DripButton each **2/2**. The barrel has **11/11**.

**Concrete evidence:** Production reference searches across `apps`, `packages`, and `scripts`, excluding tests/stories/declarations, found:

- Card, Toast, BalanceRow, DisclaimerTag, and DripButton: only their barrel exports.
- Tag: its barrel export and references from the otherwise unused DisclaimerTag. The Aztec SDK’s unrelated `Tag` was excluded.
- Design AddressDisplay and EmojiGrid: only their barrel exports. Extension uses resolve to different local implementations.

Registration checks confirm these are not implicit consumers:

- `apps/extension/scripts/design-resolver.ts:10-31` registers none of these eight names.
- `apps/extension/vite.config.ts:138-142` scans extension-local component directories.
- `apps/extension/src/types/components.d.ts:16,41` resolves AddressDisplay and EmojiGrid to their local extension files.
- PopupManager’s explicit imports/render list contains none of these package components.
- `apps/extension/scripts/pages-options.ts:8-19` scans app route directories, not package components.
- No production namespace enumeration, dynamic design import, or global component registration was found.

`packages/design/package.json` marks the package private.

**Why it harms future change:** The barrel advertises unused alternatives alongside live primitives. Maintainers must investigate which AddressDisplay, EmojiGrid, or toast implementation is actually used before changing shared behavior, and package-wide changes continue to carry these unused implementations.

**Smallest safe refactoring:** Remove Dead Code: delete the eight components and their eight barrel exports, then remove tests dedicated solely to those components. Preserve the extension-local components and active ToastManagerBase.

**What disappears:** **337 component lines**, eight SFC files, and eight export statements.

**Instances:**

- `packages/design/src/ui/Card.vue:1-19`
- `packages/design/src/ui/Tag.vue:1-37`
- `packages/design/src/ui/Toast.vue:1-70`
- `packages/design/src/composite/AddressDisplay.vue:1-69`
- `packages/design/src/composite/BalanceRow.vue:1-55`
- `packages/design/src/composite/DisclaimerTag.vue:1-7`
- `packages/design/src/composite/DripButton.vue:1-34`
- `packages/design/src/composite/EmojiGrid.vue:1-46`
- `packages/design/src/index.ts:28,40-41,48-52`

## Non-findings considered

- **Prior 2026-08-14 Q-12, CTA typography:** fixed by the shared selector at `packages/design/src/ui/Button.vue:304-314`.
- **Prior 2026-08-14 Q-15, tooltip positioning:** fixed by `crossAxis()` in `packages/design/src/ui/tooltip-placement.ts:18-29`.
- **Prior 2026-08-16 Q-12, unenforced sanitizer parity:** fixed by `apps/extension/src/utils/sanitize-parity.test.ts`, included by the extension’s test configuration. The two implementations remain, but the reported missing guard is resolved.
- **Prior identity-strip and overlay-shell duplication:** shared IdentityStrip, BarrierOverlay, DappApprovalFooter, and window-shell CSS now serve the cited consumers.
- **Button/SubPageHeader/ToastManager wrappers and toast/outside shims:** documented host boundaries and direct reuse, not independent implementations.
- **Design versus extension AddressDisplay:** different behavior—clipboard interaction versus contact/account-name resolution. The unused package component belongs in the dead-code finding, not a forced component merger.
- **Generated token/utility output:** excluded; the generator already derives utility classes from shared contract tables.
- **Generic layout and typography similarities:** repeated flex declarations or uppercase text alone do not establish a shared component contract.
- **Popover versus DropdownRoot:** different placement and focus-management contracts; insufficient evidence for a common overlay abstraction.

## Incidental bugs noticed (for the bugs run)

- `packages/design/src/ui/Popover.vue:76-85` — open a popover, then unmount its parent while `open` remains true: document scroll/keydown listeners are removed only by the close branch, with no unmount cleanup. Those listeners retain the disposed component’s callbacks. **Confidence: high.**

## Cross-rebuttal (codex on claude)

**Overconfident / wrong in Claude’s findings**

Confidence: **high** for the source checks below.

- **q12-pkg-design-C-1 — Partially agree.** The seven components are unused, but their source totals **291 lines**, not 337; 337 includes the omitted design EmojiGrid. None has an entry in `packages/design/src/mount-all.test.ts:30-53`. The “last real change 2026-06-21” claim is also wrong: history includes changes through 2026-08-13. Retain Dead Code; reject the additional AddressDisplay equivalence claim because the two components implement different interactions.

- **q12-pkg-design-C-2 — Partially agree.** The three identical theme-aware hairline recipes support extraction. The broader “same knob” claim conflates different roles and opacities: `Popup.vue:148` uses 0.8, `LegalAcceptanceSheet.vue:136` uses 0.82, and `BarrierOverlay.vue:31` uses 0.92; collapsing these requires a product decision. The incidental bug specifically naming DetailsTable and PermissionRow is contradicted by their light overrides at `DetailsTable.vue:143-145` and `PermissionRow.vue:84-86`. Literal dark-hue usage elsewhere alone does not establish incorrect rendering.

- **q12-pkg-design-C-3 — Agree, with a refactoring constraint.** `packages/design/src/base.css:72-123,194-241` repeats the dark values, and `theme-contrast.ts:33-36` overlays rather than compares them. Preserve explicit dark-selector behavior and cascade semantics when consolidating; simply deleting overrides in favor of inherited root values is not automatically equivalent.

- **q12-pkg-design-C-4 — Partially agree.** SettingField/SettingValue share a substantial shell. SettingItem meaningfully differs: interactivity is conditional (`SettingItem.vue:53-66,206-224`), padding varies (`:165,189-199`), and divider removal uses `:last-child` (`:185`). Extract common fragments, but the proposed shared wrapper plus inset parameter is insufficient to preserve these differences.

- **q12-pkg-design-C-5 — Partially agree.** The duplicated empty-state styling is real, but the proposed component substitution loses functionality: `TokensView.vue:478-483` embeds an actionable import button, whereas `ListStatusMessage.vue:19-24` accepts only text for the empty-state subline; its slot belongs to the other variant. Add a subline slot or share presentation styles before migrating. The stylesheet is **27 lines**, not 22.

**What Claude missed that I found**

- **q12-pkg-design-X-1:** Shared Skeleton is bypassed by AmountCard (`:558-574`), fee-shared CSS (`:30-46`), and received-detail CSS (`:488-516`), duplicating its gradient/keyframe mechanism; none of Claude’s non-findings rebuts this.
- **q12-pkg-design-X-3:** `packages/design/src/ui/ToastManagerBase.vue:131-150,162-184` duplicates card markup and pointer/focus/action bindings; extracting the card can preserve the deliberately separate announcement regions.
- **q12-pkg-design-X-4, additional instance:** `packages/design/src/composite/EmojiGrid.vue:1-46` is also unused. Extension consumers explicitly import their local EmojiGrid, and the design resolver does not register the package version.

**What BOTH of you missed**

No additional findings established during this light pass.