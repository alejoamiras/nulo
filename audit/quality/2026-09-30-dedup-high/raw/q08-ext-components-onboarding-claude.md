# q08-ext-components-onboarding — claude

Scope read: `apps/extension/src/components/ui/Settings/{SettingField,SettingValue,SettingItem}.vue`, `components/composite/{ListStatusMessage,AsyncListStatus,SecretUnlockSection,SecretCountdownClose,CollapsingHeroLayout(global section css)}.vue`, `components/composite/import/{ImportSecretForm,ImportFullBackupForm,import-shared.module.css}`, `components/Divider.vue`, `components/composite/general/EmojiGrid.vue`, `components/AddressDisplay.vue` (head), `onboarding/pages/{create,import}.vue`, `onboarding/components/{OnboardingProfileNameField,StepIndicator}.vue`; cross-boundary (handoff/duplicate counterparts): `popup/pages/import.vue`, `popup/components/modules/settings/new-profile/NewProfileMethodTabs.vue`, `popup/pages/{auth,profile/new}.vue`, `popup/pages/settings/security/{change-password,reset,export/full}.vue`, `popup/components/modules/general/{TokensView,RecentActivityView}.vue` + `list-empty.module.css`; `packages/design/src/ui/{Button,SectionLabel,RowAction}.vue`, `packages/design/src/composite/{EmojiGrid,AddressDisplay}.vue`. Dead-code sweep over every `.vue/.ts/.js` in `components/**` + `onboarding/**` (script scanning all non-test src for name references). `setup/`, `shims/`, `design/` skimmed via repo map (placeholder / re-export; nothing to report).

## q08-ext-components-onboarding-C-1: Import-profile page body and 35-name flow destructure copied between onboarding and popup

- **Smell:** Duplicate Code (with Long Parameter List / Data Clumps on the 35-name destructure; Shotgun Surgery on change).
- **Maintenance impact:** structural. Blast radius 2 pages + 3 L3 forms. Change frequency: the two pages have 15 commits since 2026-06-01, the import composite dir 8.
- **Evidence:** `onboarding/pages/import.vue:65-102` and `popup/pages/import.vue:97-134` destructure the identical 35 identifiers from `useProfileImportFlow` (same order). The template wiring is the same: `ImportMethodPicker` + `ImportFullBackupForm` (same 14 props/3 v-models/3 listeners) + `ImportSecretForm` (same 7 bindings) at `onboarding/pages/import.vue:136-176` vs `popup/pages/import.vue:196-237`. The CTA ladder (decrypt / restore / retry / continue / view-errors / seed / back, each with the same `v-if` predicates and `:disabled` expressions, e.g. `!isAllowedToImportBackup || restoreStatus === 'failed' || restoreStatus === 'progress'`) is repeated at `onboarding/pages/import.vue:184-256` vs `popup/pages/import.vue:246-330`. Only labels, testids, `v-snack-footer` vs `#bottom` slot, and the popup's "Finishing import" branch differ. `useProfileImportFlow` already holds the logic, so what remains duplicated is pure wiring.
- **Why it harms future change:** adding a restore state (e.g. a new `restoreStatus` value, or a new form prop on `ImportFullBackupForm`) needs identical edits in both pages plus the predicate ladder; a miss yields a shell-specific bug (popup works, onboarding shows no button). Note the popup-only "Finishing import" branch is already a drift.
- **Smallest safe refactoring:** Extract Component `ImportFlowBody.vue` in `components/composite/import/` taking the flow object as one prop (`flow`) and rendering picker + two forms; optionally Extract Component `ImportFlowActions.vue` with a `labels`/`testids` prop map and a `#extra` slot for the popup's finishing button. The pages keep shell concerns only (layout, `completeImport`, error-log surface). Preserve every `data-testid` via props.
- **What disappears:** ~40 lines of identical template per page, the 35-line destructure in both (pages pass `flow` whole), ~70 lines of CTA ladder.
- **Instances:** `onboarding/pages/import.vue:65-102,136-176,184-256`; `popup/pages/import.vue:97-134,196-237,246-330`.

## q08-ext-components-onboarding-C-2: Password/Passkey roving tablist implemented twice (logic + markup)

- **Smell:** Duplicate Code (Vue close analog: composable/component-extraction opportunity).
- **Maintenance impact:** structural-local. Blast radius 2 files, one across the popup/onboarding layer ban. Change frequency: create/new pages 11 commits since 2026-06-01.
- **Evidence:** `onboarding/pages/create.vue:79-88` (`onMethodKeydown`, two template refs, `nextTick` focus) and `create.vue:115-145` (tablist with `role="tab"`, `aria-selected`, `:tabindex="active ? 0 : -1"`) duplicate `popup/components/modules/settings/new-profile/NewProfileMethodTabs.vue:16-55` line for line in behaviour (ArrowLeft/Right toggle, focus follow). Only testids, `aria-label`, and skin differ. The popup version lives at L4 (`popup/components/modules`), so onboarding cannot import it (layer ban), which is why it was re-implemented.
- **Why it harms future change:** CLAUDE.md "Keyboard & focus order" makes the roving pattern a hard rule; a fix (e.g. Home/End keys, a third method) must land twice, and the comment in the popup copy ("Was two positive tab stops") shows this has been fixed once already.
- **Smallest safe refactoring:** Move Function/Extract Composable `useRovingToggle(modelRef)` (returns `onKeydown`, `setRef`) into `src/composables/` (C0), or better an L3 `AuthMethodTabs.vue` in `components/composite/` with `testids` and a `variant` for the two skins. Popup `NewProfileMethodTabs` becomes a thin wrapper or is deleted.
- **What disappears:** ~35 lines (keydown handler, refs, tab markup) in one file, one of two implementations of a hard-rule keyboard pattern.
- **Instances:** `onboarding/pages/create.vue:79-88,115-145`; `popup/components/modules/settings/new-profile/NewProfileMethodTabs.vue:13-55`.

## q08-ext-components-onboarding-C-3: Error-shake keyframes + `.shake` class copy-pasted into 7 CSS modules

- **Smell:** Duplicate Code / Shotgun Surgery (one animation spec, 7 owners).
- **Maintenance impact:** local per file, structural in aggregate. Blast radius 7 files (2 in this cluster). Low churn, but each edit must be 7-way and some copies already differ.
- **Evidence:** identical six-step `@keyframes shakeInput` (`0 / -4px / 4px / -3px / 2px / 0`) at `components/composite/SecretUnlockSection.vue:65-72`, `onboarding/components/OnboardingProfileNameField.vue:45-52`, `popup/pages/auth.vue:439`, `popup/pages/import.vue:352`, `popup/pages/profile/new.vue:180`, `popup/pages/settings/security/change-password.vue:288`, `popup/pages/settings/security/export/full.vue:723`. `.shake { animation: shakeInput … }` follows each, at 0.3s in 4 files and 0.4s in 3 (already drifted). `NewSenderPopup.vue:175` has a `.shake` too. jscpd did not flag it (small per-file), but the same wrong-input feedback must look identical across onboarding, popup and unlock.
- **Why it harms future change:** a reduced-motion fix (`prefers-reduced-motion`), a duration/amplitude change, or fixing a timing inconsistency means touching 7-8 files; nobody can tell which duration is intended.
- **Smallest safe refactoring:** Extract one `.shake` + keyframes into `@nulo/design` `utilities.css` (or `base.css`) as a global `.nulo-shake`/`[data-shake]` utility with a `prefers-reduced-motion` guard, or a small `ShakeOnError` wrapper in `@nulo/design/ui`. Note `utilities.drift.test.ts` and `tokens.drift.test.ts` exist: utilities.css is a generated/pinned surface, so the addition must go through its token contract.
- **What disappears:** 7 x ~10 lines (~70) and 7 separate keyframe definitions; the 0.3 vs 0.4 ambiguity.
- **Instances:** the 7 sites above plus `popup/components/popups/NewSenderPopup.vue:158,175`.

## q08-ext-components-onboarding-C-4: Show/hide-password toggle button hand-rolled 8 times with its own CSS in 5 files

- **Smell:** Duplicate Code; Input is missing a capability, so this is also Feature Envy on `Input`'s `#suffix` slot ("composable/component-extraction opportunity").
- **Maintenance impact:** structural. Blast radius 5 files; `components/composite/import` is actively edited (8 commits since 2026-06-01).
- **Evidence:** the same `<button type="button" tabindex="-1" :aria-label="x ? 'Show …' : 'Hide …'" @click="x = !x"><MaterialIcon :name="x ? 'visibility' : 'visibility_off'" :size="18" color="secondary"/></button>` plus a `.visibility_btn` CSS rule (`display:flex; align-items:center; justify-content:center; background:transparent; border:none; cursor:pointer; padding:4px 0 4px 8px`) at: `components/composite/import/ImportSecretForm.vue:41-55,77-91,145-153` (x2), `components/composite/import/ImportFullBackupForm.vue:112-126,140-154,189-197` (x2), `popup/components/modules/settings/new-profile/NewProfileCredentials.vue:31-42,80`, `popup/pages/auth.vue:265-276,392`, `popup/pages/settings/security/change-password.vue:130-141,172-183` (x2). The tabindex="-1" accepted trade-off is encoded 8 times, so changing it (CLAUDE.md flags it as owner-confirmed) is 8 edits. `@nulo/design` `Input.vue` has no `reveal`/password-toggle prop.
- **Why it harms future change:** adding a11y (e.g. `aria-pressed`), changing the icon size, or revisiting the WCAG tabindex tradeoff requires finding all sites; the local `isPasswordType` ref + label string is repeated per site.
- **Smallest safe refactoring:** Extract Component `PasswordVisibilityToggle.vue` (L3, `v-model:visible`, `subject` prop for "password"/"recovery phrase") or add an opt-in `revealable` prop to `@nulo/design` `Input.vue` that owns the toggle and state. Composite-level is the minimal change (no package API addition).
- **What disappears:** ~8 x 14 template lines + 5 CSS rules (~130 lines) and 7 boolean refs.
- **Instances:** the 8 sites above.

## q08-ext-components-onboarding-C-5: `SettingValue` is dead in production and is a 60-line twin of `SettingField` (and row chrome repeated in `SettingItem`)

- **Smell:** Dead Code + Duplicate Code (Speculative Generality: a component with zero prod consumers).
- **Maintenance impact:** local. Blast radius 3 files. `components/ui/Settings` has 4 commits since 2026-06-01.
- **Evidence:** `SettingValue.vue` has no `<SettingValue`/`<setting-value` in any `.vue` and no import anywhere outside `Settings.stories.ts:10,70-82`, `Settings.test.ts:14`, and the generated `types/components.d.ts:95`; no route/registry/DI references it (dynamic `component :is` not used for it: grep of `SettingValue|setting-value` across `src`, `tests`, `.storybook`, `scripts`). `SettingField` has exactly one consumer (`popup/pages/settings/profile/index.vue:20`). The two SFCs share an identical props block (`SettingField.vue:2-19` vs `SettingValue.vue:3-20`, jscpd 18 lines) and identical `.wrapper` CSS (hover/active/disabled/`::after` divider, `SettingField.vue:34-75` vs `SettingValue.vue:39-80`, jscpd 42 lines). The hairline divider (`left/right:16px; background: rgba(74,70,63,0.3)`) and hover/active surface is additionally hand-rolled in `SettingItem.vue:156-186` (20px inset) and outside the cluster at `popup/components/modules/settings/contacts/ContactRow.vue:62-102`, `popup/pages/settings/connected-apps/index.vue:176-216`, `popup/windows/capabilities/AccountSelectRow.vue`, all carrying the same 0.3-alpha literal.
- **Why it harms future change:** restyling the settings row (divider colour, hover surface) means editing 3 Settings components plus 3 list rows; the dead twin keeps tests/stories alive that need maintenance for no user.
- **Smallest safe refactoring:** Inline Function/Remove Dead Code: delete `SettingValue.vue` + its story/test cases and the `components.d.ts` line (regenerated). Then Extract shared row chrome (`composes` from one `setting-row.module.css` with `--row-inset` custom property) for `SettingField`, `SettingItem` and the popup list rows; or fold `SettingField` into `SettingItem`'s `raw`/slot mode.
- **What disappears:** `SettingValue.vue` (86 lines) + ~40 test/story lines; then ~40 lines of repeated wrapper CSS per row component.
- **Instances:** `components/ui/Settings/SettingValue.vue` (whole file), `SettingField.vue:34-75`, `SettingItem.vue:156-186`; out-of-cluster chrome copies listed above.

## q08-ext-components-onboarding-C-6: Empty-state block exists as a component (`ListStatusMessage`) and as a CSS module copy; two views bypass the component

- **Smell:** Duplicate Code (a component and a stylesheet encoding the same visual), Alternative Classes with Different Interfaces.
- **Maintenance impact:** local-structural. Blast radius 4 files; `TokensView`/`RecentActivityView` are the home screen and churn heavily.
- **Evidence:** `components/composite/ListStatusMessage.vue:29-50` (`.empty`, `.empty_headline`, `.empty_sub`) equals `popup/components/modules/general/list-empty.module.css:1-22` (jscpd 22 lines): same dashed card, same 14px uppercase headline, same mono 11px sub. The 9 list pages adopt `<ListStatusMessage>`, but `TokensView.vue:474-486` and `RecentActivityView.vue:872-876` hand-write the same markup and `composes` the CSS module, so the fix path for a restyle is two places (component + module). Not a full swap: `TokensView`'s sub contains an inline `<button>` (slot needed) and `ListStatusMessage` lacks a `#sub` slot. The three detail pages (`journal/[id].vue:307`, `received/[id].vue:334`, `tx/[id].vue:351`) use a related but different `empty_headline` (margin-top:48px, from `detail-page.module.css:40`).
- **Why it harms future change:** a change to the empty-card visual (border, headline tracking) is applied to `ListStatusMessage` and `list-empty.module.css`, and someone will miss one; the component cannot absorb the two views until it gains a sub slot.
- **Smallest safe refactoring:** Add a `#sub` slot to `ListStatusMessage` (keeping the `sub` prop), switch `TokensView` and `RecentActivityView` to it, delete `list-empty.module.css`. Keep testids (TokensView's `tokens-empty-import-link` stays on the slotted button; ListStatusMessage forwards `testid`).
- **What disappears:** `list-empty.module.css` (22 lines), ~25 lines of markup/`composes` in two views.
- **Instances:** `components/composite/ListStatusMessage.vue:29-50`; `popup/components/modules/general/list-empty.module.css:1-22`; `TokensView.vue:474-486,556-566`; `RecentActivityView.vue:872-876,947-957`.

## q08-ext-components-onboarding-C-7: `Divider.vue` is dead; extension `EmojiGrid` duplicates a `@nulo/design` composite that nobody consumes

- **Smell:** Dead Code (Divider); Alternative Classes with Different Interfaces (+ Speculative Generality) for EmojiGrid.
- **Maintenance impact:** cosmetic-local; blast radius 2 components + 1 package export. Confidence: high for Divider, moderate for EmojiGrid (intent unknown).
- **Evidence:** `components/Divider.vue` (1 commit ever): no `<Divider` tag in `src`, `tests`, `.storybook`, no test file; only the generated `types/components.d.ts:34`. (`DropdownDivider` is a different component.) `EmojiGrid`: `packages/design/src/composite/EmojiGrid.vue` (props `cells: string[]`, `testId`, `cellTestId`; 3x3 grid, 56px cells) is exported at `packages/design/src/index.ts:52` with only its own test as consumer, while the wallet uses its own `components/composite/general/EmojiGrid.vue` (prop `emojis: string`, rows of 3, 48px cells) at `popup/windows/verify/index.vue:192` and `DappSessionVerification.vue:22`. `design-resolver.ts` doesn't list it, so the tag resolves to the local one. The same two-implementations situation exists for `AddressDisplay` but with different behaviour (design: copy button; extension: contact-name/store-aware), so that one is not flagged.
- **Why it harms future change:** a verification-grid redesign would edit the local copy while the package copy rots as unused public API (`boundary.test.ts`/`mount-all.test.ts` still pay to test it).
- **Smallest safe refactoring:** delete `Divider.vue`. For EmojiGrid, Move Function: either make the extension wrapper render the package grid (`cells = [...emojis]`) and drop the local markup, or delete the package export if the tools app will not use it (tools/landing/playground have no reference).
- **What disappears:** `Divider.vue` (25 lines); one of two 3x3 emoji-grid implementations (~35 lines + a test).
- **Instances:** `components/Divider.vue`; `components/composite/general/EmojiGrid.vue`; `packages/design/src/composite/EmojiGrid.vue`.

## q08-ext-components-onboarding-C-8: `SecretCountdownClose` re-implements the design `cta_outline` button, with drift

- **Smell:** Duplicate Code (re-implemented design primitive), not a convention: the two "keep raw button" reasons in the doc-comment concern only the progress overlay.
- **Maintenance impact:** local; 1 live copy in cluster, dead copies out of cluster. The 3 files have 15 commits since 2026-06-01.
- **Evidence:** `components/composite/SecretCountdownClose.vue:52-119` (`.cta` + `.cta_outline`: same width, headline font, 14px, 0.2em tracking, uppercase, 20px padding, `transparent` bg, `--nulo-outline` border, hover surface) mirrors `packages/design/src/ui/Button.vue:300-347` (`cta` typography contract + `cta_outline`). Drift already exists: `.cta:hover { background: #fff }` vs Button's `color-mix(in srgb, var(--nulo-accent), var(--txt-primary) 18%)`, and focus-outline differs. Out-of-cluster dead leftovers of the same CSS: `popup/pages/settings/security/change-password.vue:299-337` and `reset.vue:203-243` still define `.cta` (and `.cta_red`) though both pages render `<Button variant="cta"/"cta_destructive">` and never reference `$style.cta` (grep: no `$style.cta` in either file). (Overlaps the recurring dead-style theme of 2026-08-14 Q-11; flagged here as RECURRING (prior: 2026-08-14 Q-11), not re-derived.)
- **Why it harms future change:** a CTA restyle in `Button.vue` will silently skip this button, which sits on the recovery-phrase reveal screen where visual consistency matters.
- **Smallest safe refactoring:** use `<Button variant="cta_outline">` with the progress bar as default-slot content absolutely positioned (Button is `position:relative`? verify) or add a `progress` slot to the wrapper; Remove Dead Code for the two dead `.cta` blocks.
- **What disappears:** ~65 lines of CSS here, ~80 of dead CSS in change-password/reset.
- **Instances:** `components/composite/SecretCountdownClose.vue:52-119`; dead: `popup/pages/settings/security/change-password.vue:299-337`, `popup/pages/settings/security/reset.vue:203-243`.

## Non-findings considered

- Section-label CSS (11px/700/0.18em uppercase headline) repeated in ~12 places (`CollapsingHeroLayout.vue:235-250` globals `export_section*`, `import-shared.module.css`, `NewProfileMethodTabs.vue`, `change-password.vue`, `reset.vue`, `OnboardingProfileNameField.vue`, `create.vue`, `done.vue`, `PasskeyCeremonyDialog.vue`). Real but each is 4-7 lines and partial (some only set spacing/family on a `<Text>`); the 2026-08-14 audit already routed the "uppercase label" claim to cross-cutting. Mentioned here only as a lead: `import-shared.module.css` `.section`/`.section_last` are identical declarations (`.section_last` = `.section`), and global `.export_section_last` duplicates it in `CollapsingHeroLayout.vue`; fixing the identical pair is a 1-line `composes`.
- `ImportSecretForm.vue:10-50` hand-written `.section` (declared, not composed): comment at lines 122-124 documents why (Vite copies composed modules; gap override ordering). Deliberate.
- `SecretUnlockSection` vs popup `auth.vue` password-gate markup: similar but auth adds Enter handling, reveal toggle, rate-limiting; no 4-line-shared logic beyond the shake already reported.
- `SettingsPageShell`, `BarrierOverlay`, `DappApprovalFooter` already exist as the extractions recommended by the 08-16 Q-11 finding; fixed, skipped.
- `components/header-copy-address.ts` / clipboard hand-rolling (08-14 Q-06) not re-checked beyond cluster; `useSecretClipboardCopy` is in `composables/` (out of cluster).
- Local L2 wrappers (Button, SubPageHeader, ToastManager) and `.js` re-export shims: documented-deliberate.
- `StepIndicator`, `OnboardingExplainer`, `OnboardingPage`: onboarding-only, single use, no twin.
- `AddressDisplay` (extension) vs `@nulo/design` `AddressDisplay`: different responsibilities (store/contact-name aware vs plain copy chip); Alternative Classes but no shared logic to consolidate.
- `Popup/Popup.vue`/`PopupCard`/`ui/Popup` vs design `Popover`: Popover is an anchored tooltip-style; Popup is a modal stack with focus trap; no overlap found.
- `onboarding/pages/create.vue` vs `popup/pages/profile/new.vue`: logic already shared via `useProfileCreateFlow`; remaining template similarity is skin-specific except the tablist (C-2).
- `OnboardingProfileNameField` vs inline name field in `popup/pages/import.vue:175-199` and `profile/new.vue:100-`: ~20-line template, 3 copies (jscpd 15 lines). Real but borderline; subsumed by recommending C-3 + a shared `ProfileNameField` if the owner wants a fourth item.
- `JsonViewer.vue:138-174` self-clone (17 lines): two theme variants of the same rule; below threshold.
- `SettingItem` `Root` functional component: complex but single-purpose.

## Incidental bugs noticed (for the bugs run)

- `components/composite/SecretUnlockSection.vue:26` uses global class names (`export_section_last`, `export_section_label`) that are defined only by `:global(...)` rules inside `CollapsingHeroLayout.vue:235-250`. Counter-example: render `SecretUnlockSection` on any page not wrapped in `CollapsingHeroLayout` (e.g. a future or test mount, or a layout change) and the section loses flex/padding/label styles. No current broken page was confirmed; coupling risk more than bug.

## Cross-rebuttal (claude on codex)

### 1. Codex findings

- **X-1 (new-password field pair x4): partially agree.** The pair is real, and `NewProfileCredentials.vue:18-59` (not in my scope) is a genuine extra instance, since it carries the same `isPasswordType` toggle and eye button. The root cause, though, is the hand-rolled visibility toggle, which is my C-4 (8 sites). A `PasswordVisibilityToggle` fixes both, while a `NewPasswordFields` component would leave the other four toggle sites and the `.visibility_btn` CSS in place. Codex also concedes the testids, autocomplete, autofocus and hint ownership all differ per site, so the wrapper needs many pass-through props. Prefer the smaller toggle extraction, then fold in the field pair only if it still pays.
- **X-2 (import action predicates): agree, and it is the same root cause as my C-1.** The CTA ladder is at `onboarding/pages/import.vue:184-256` and `popup/pages/import.vue:246-330`. The `import-helpers.ts:20-28` Enter-key mirror is a good extra instance I did not cite. Codex's fix (shared predicates in `useProfileImportFlow`) is smaller and safer than my `ImportFlowActions` component. Its claim that keyboard behaviour must stay separate is correct, because `refuseRepeatEnter` is wired only in the popup. Codex missed the 35-name destructure and the identical picker/form template wiring, which are the bulk of C-1.
- **X-3 (activity title chip x4): agree, and I missed it.** `TransactionAwaitingCard.vue:132-152` and `TransactionCard.vue:200-215` have identical `.title_sep` and chip declarations (8px mono, same border/padding). The comments there say the copies must match. It falls outside my cluster's files, so I did not see it.
- **X-4 (empty-state card): agree on the duplication, disagree on the fix.** This is my C-6. Codex's shared CSS module keeps two authorities and three render paths. A `#sub` slot on `ListStatusMessage` removes `list-empty.module.css` entirely. Codex is right that the Tokens sub-text holds an interactive import button, which is why the slot is needed and a string prop will not do.
- **Non-finding on `SettingValue`: disagree.** Codex says it found only generated typing for it. Source shows imports only in `Settings.test.ts:14` and `Settings.stories.ts:10`, which are not production consumers. There are no `<SettingValue` template uses, so it is dead in production (C-5). Codex's caution about auto-import is fair, but the only registration is the generated `components.d.ts`.
- **Non-finding on shake/error styles: disagree.** The 7-module `@keyframes shake` copy (C-3) is the same literal keyframes, and only the `gap` ordering note applies to `SecretUnlockSection`. Identical keyframes are cheap to share even if the behaviour is small.

### 2. What Codex missed that I still stand by

- **C-2** (Password/Passkey roving tablist implemented twice, logic and markup).
- **C-3** (shake keyframes in 7 CSS modules).
- **C-5** (`SettingValue` dead in production).
- **C-7** (`Divider.vue` dead; extension `EmojiGrid` duplicating an unconsumed `@nulo/design` composite).
- **C-8** (`SecretCountdownClose` re-implements `cta_outline`, with drift).
- **C-1's destructure and template halves** (Codex covers only the predicates).

### 3. What both missed

- **Dead wrapper: `Popover` / `DropdownRoot` overlap.** Codex mentions `DropdownRoot` and `Popover` only in passing. A quick consumer count for the design `Popover` would show whether it is speculative generality. Low confidence, so check before promoting.
- **`AddressDisplay.vue:68` fetches the contact name and address only in `onMounted`** (Codex's bug note). A parallel `@nulo/design` `AddressDisplay` composite exists. The smell is Divergent Change: two components with the same name and different refresh semantics, which will drift further. Evidence: `components/AddressDisplay.vue:68` against `packages/design/src/composite/AddressDisplay.vue`.
