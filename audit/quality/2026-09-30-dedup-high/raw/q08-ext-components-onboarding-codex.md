# q08-ext-components-onboarding — codex

Scope read:

- `CLAUDE.md`, `implementations-plan/lessons.md`, the supplied `_outer.md` and `extension-shared-ui.md` maps, production clone report, and both prior quality reports.
- Production source across `apps/extension/src/components/`: flat components, `Popup/`, `JsonViewer/`, `passkey/`, local `ui/`, and the general, import, activity, capabilities, and send composites. Reviewed scripts/templates and relevant styles.
- `apps/extension/src/onboarding/`, `setup/`, `shims/`, and `design/tokens.ts`.
- Design counterparts: `packages/design/src/ui/{Input,Checkbox,RowAction,Popover,FieldWarning,SectionLabel,Tag,Badge}.vue` and `composite/{AddressDisplay,EmojiGrid}.vue`.
- Adjacent consumers: popup import, authentication, change-password, new-profile credentials, activity cards, and the empty-state sections of `TokensView.vue` and `RecentActivityView.vue`.
- Relevant import-flow/helper code, string utilities, config defaults, component-discovery configuration, `ListStatusMessage.test.ts`, and `sanitize-parity.test.ts`.

Read-only static inspection; no files changed. History counts below are **total / since 2026-06-01**, using path history without rename following.

## q08-ext-components-onboarding-X-1: New-password field pairs are implemented four times

**Title:** Four copies of the new-password and confirmation control.

**Smell name:** Duplicate Code — Fowler. The repeated unit includes behavior and markup, not merely similar field styling.

**Maintenance impact:** Structural; four consumer files across profile creation, recovery-phrase import, backup import, and password changes. History: `ImportSecretForm.vue` **6/6**, `ImportFullBackupForm.vue` **5/5**, `NewProfileCredentials.vue` **1/1**, `change-password.vue` **6/6**. Confidence: **high**.

**Concrete evidence:** Each implementation binds two password fields to one visibility state, applies the same length cap, renders the same eye-button suffix on the first field, and places a lock-icon hint below it:

- `apps/extension/src/components/composite/import/ImportSecretForm.vue:66-108`
- `apps/extension/src/components/composite/import/ImportFullBackupForm.vue:130-173`
- `apps/extension/src/popup/components/modules/settings/new-profile/NewProfileCredentials.vue:18-59`
- `apps/extension/src/popup/pages/settings/security/change-password.vue:158-202`

The shared password-validation helper already exists; the duplicated part is the field-pair presentation and visibility behavior. Labels, test IDs, autocomplete attributes, autofocus, and hint ownership differ.

**Why it harms future change:** Changing the confirmation-field behavior, hint placement, or visibility-button interaction requires four coordinated edits. The differences are interleaved with the common control, making a wholesale copy unsafe and a partial update easy.

**Smallest safe refactoring:** Extract Component into `apps/extension/src/components/composite/general/NewPasswordFields.vue`. Accept the two models, hint, field attributes/test IDs, and optionally a controlled visibility model. Preserve change-password’s shared visibility state with its current-password field. Keep validation and service calls with their existing owners; L3 must not import the L4 credentials component.

**What disappears:** Three extra implementations of the roughly 40-line field pair, plus redundant visibility/hint styles where no remaining local field needs them.

**Instances:** `apps/extension/src/components/composite/import/ImportSecretForm.vue:66`; `apps/extension/src/components/composite/import/ImportFullBackupForm.vue:130`; `apps/extension/src/popup/components/modules/settings/new-profile/NewProfileCredentials.vue:18`; `apps/extension/src/popup/pages/settings/security/change-password.vue:158`.

## q08-ext-components-onboarding-X-2: Import action policy remains duplicated between shells

**Title:** Shared import flow, independently maintained action predicates.

**Smell name:** Duplicate Code / Switch Statements — Fowler. Both shells independently interpret the same backup-selection and restore-state fields to choose the available actions.

**Maintenance impact:** Structural; two page templates and a keyboard-action helper. History: onboarding import **12/12**, popup import **12/12**, `import-helpers.ts` **3/3**. The existing shared flow has **11/11** commits. Confidence: **high**.

**Concrete evidence:**

- `apps/extension/src/onboarding/pages/import.vue:189-243` implements decrypt, restore, retry, continue, and view-errors branches; `:256-260` independently gates returning to method selection.
- `apps/extension/src/popup/pages/import.vue:240-305` repeats those branches; `:318` repeats the back-button gate.
- `apps/extension/src/popup/pages/import-helpers.ts:20-28` interprets the same encrypted/profile-type/restore-status combinations for keyboard dispatch.

The duplicated logic is: determine whether a backup needs decryption, can enter restoration, or has finished with recoverable errors, then restrict actions during restoration or retry. Labels, spinner presentation, keyboard handling, and the popup’s finishing indicator differ legitimately.

**Why it harms future change:** A change to retry/continue availability after partial restoration must be reconciled across both templates and the Enter-key path. Sharing the operation handlers does not synchronize these independently maintained predicates.

**Smallest safe refactoring:** Extract Function into `apps/extension/src/utils/full-backup-actions.ts` for the common action-state predicates, exposed reactively through `useProfileImportFlow`. Both templates and the keyboard helper should consume those results. Keep “visible” and “executable” distinct so extraction preserves existing keyboard and page-specific behavior.

**What disappears:** Repeated definitions of the decrypt, restorable-profile, finished-with-errors, and compound busy-state predicates. Shell-specific labels, layout, and event dispatch remain.

**Instances:** `apps/extension/src/onboarding/pages/import.vue:189`; `apps/extension/src/onboarding/pages/import.vue:256`; `apps/extension/src/popup/pages/import.vue:240`; `apps/extension/src/popup/pages/import.vue:318`; `apps/extension/src/popup/pages/import-helpers.ts:20`.

## q08-ext-components-onboarding-X-3: Activity cards still copy their title-chip contract

**Title:** Four implementations of the activity title separator and chip.

**Smell name:** Duplicate Code — Fowler. These styles encode the same visual component across transaction lifecycle states.

**Maintenance impact:** Structural within the activity-card family; four files. History: awaiting **4/4**, terminal **4/4**, incoming **6/6**, settled **4/4**. Confidence: **high**.

**Concrete evidence:**

- `apps/extension/src/components/composite/activity/TransactionAwaitingCard.vue:75-78,130-152`
- `apps/extension/src/components/composite/activity/TransactionTerminalCard.vue:50-53,84-105`
- `apps/extension/src/components/composite/activity/TransactionIncomingCard.vue:65-68,77-95`
- `apps/extension/src/popup/components/modules/activity/TransactionCard.vue:149-163,198-215`

All render the title separator and a small uppercase monospace chip with the same background, border, padding, and typography. Comments explicitly require awaiting, terminal, and settled appearances to match across the lifecycle.

The incoming chip’s green color and the settled card’s ability to render two independent labels are meaningful differences.

**Why it harms future change:** Adjusting chip typography or spacing requires four synchronized changes to prevent a transaction’s title treatment changing when its state changes. `TransactionCardLayout` centralizes the surrounding layout but leaves this shared fragment outside that ownership.

**Smallest safe refactoring:** Extract Module for the common styles into `apps/extension/src/components/composite/activity/activity-chip.module.css`, the stylesheet equivalent of Extract Function. Compose the shared separator/chip rules from all four consumers. Retain incoming color and existing shrink/wrapping differences locally.

**What disappears:** Three duplicate copies of the shared separator/chip declarations—roughly 45–55 CSS lines—without merging transaction-state logic or changing which labels appear.

**Instances:** `apps/extension/src/components/composite/activity/TransactionAwaitingCard.vue:75,132,141`; `apps/extension/src/components/composite/activity/TransactionTerminalCard.vue:50,87,94`; `apps/extension/src/components/composite/activity/TransactionIncomingCard.vue:65,77,84`; `apps/extension/src/popup/components/modules/activity/TransactionCard.vue:149,200,207`.

## q08-ext-components-onboarding-X-4: Empty-state extraction has two styling authorities

**Title:** The same empty-state card is maintained in a component and a stylesheet.

**Smell name:** Duplicate Code — Fowler. This is a shared dashed empty-state card, not generic flex-layout coincidence.

**Maintenance impact:** Local presentation duplication across four files and three rendering implementations. History: `ListStatusMessage.vue` **1/1**, `list-empty.module.css` **1/1**, `TokensView.vue` **12/12**, `RecentActivityView.vue` **20/20**. The definitions have low churn; their consuming surfaces are active. Confidence: **high**.

**Concrete evidence:**

- `apps/extension/src/components/composite/ListStatusMessage.vue:19-22,29-57` owns the dashed card, uppercase headline, and monospace supporting text.
- `apps/extension/src/popup/components/modules/general/list-empty.module.css:1-27` independently defines the same visual contract.
- `apps/extension/src/popup/components/modules/general/TokensView.vue:475-486,556-566` renders its own card using that stylesheet.
- `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:873-876,947-957` does the same.

`ListStatusMessage` additionally gives supporting text full width and word wrapping. Tokens’ supporting text contains an interactive import button, whereas the composite currently accepts a string.

**Why it harms future change:** Updating empty-state padding, headline styling, or border treatment requires changing both definitions. Adopting the composite directly would also require accounting for the interactive supporting content and existing wrapping differences.

**Smallest safe refactoring:** Extract the common styles into `apps/extension/src/components/composite/list-empty.module.css`; make both L3 and L4 consumers compose them. Keep the composite’s extra supporting-text rules local. This respects import direction and avoids an unnecessary slot/API change.

**What disappears:** One independently maintained copy of the 27-line common rule set. The existing L4 stylesheet moves to the shared layer rather than gaining another copy.

**Instances:** `apps/extension/src/components/composite/ListStatusMessage.vue:19,29`; `apps/extension/src/popup/components/modules/general/list-empty.module.css:1`; `apps/extension/src/popup/components/modules/general/TokensView.vue:475,556`; `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:873,947`.

## Non-findings considered

- **Prior clipboard duplication, 2026-08-14 Q-06:** inspected header, scope renderers, and JSON viewer now delegate clipboard writes to shared helpers; not re-reported.
- **Prior identity-strip duplication, 2026-08-14 Q-08:** `IdentityStrip.vue` now supplies the shared frame; inspected consumer references confirm adoption.
- **Prior header truncation, 2026-08-14 Q-09:** `Header.vue` now uses `trimAddress`; that occurrence is fixed.
- **Prior barrier/footer duplication, 2026-08-16 Q-11:** both barriers use `BarrierOverlay`; approval windows use `DappApprovalFooter`. Their separate storage-race guards are deliberate.
- **Prior sanitizer parity gap, 2026-08-16 Q-12:** `sanitize-parity.test.ts` now compares both real implementations; the earlier missing-enforcement finding is fixed.
- **SettingField versus SettingValue:** matching row CSS confirmed, but the production search found a `SettingField` consumer and only generated component typing for `SettingValue`. Not promoted as duplication between two active surfaces; no dead-code assertion based solely on missing imports.
- **Design-package overlap:** local `AddressDisplay` resolves names and toggles display, whereas the package component copies addresses. `DropdownRoot` owns menu focus/navigation absent from `Popover`. Matching names or partial structure do not establish interchangeable implementations.
- **Local Button/SubPageHeader/ToastManager wrappers:** documented host adapters delegating to package primitives.
- **SecretUnlockSection and other shake/error styles:** insufficient shared behavior beyond small animation/text rules to justify another finding. The import section’s separate gap declaration also documents a CSS-composition ordering constraint.
- **Accepted complexity and minor clones:** the CodeMirror theme’s accepted directive, tiny onboarding link styles, and isolated icon/CSS repetitions were not promoted.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/components/AddressDisplay.vue:68` — changing `address` from A to B on the same mounted instance leaves A’s displayed address/contact name: both are populated only in `onMounted`. **Confidence: high.**
- `apps/extension/src/components/JsonViewer/LogsViewer.vue:56` — with a 1,000-entry limit and all logs included, arrival 1,101 trims the array to 1,001 before the editor-pruning condition reads `filteredLogs`. That condition is false, so old editor entries remain and accumulate. **Confidence: high.**
- `apps/extension/src/components/JsonViewer/LogsViewer.vue:158` — if `clearLogs()` rejects, the removed `onLogAdded` subscription is never restored; subsequent live logs stop updating the viewer. **Confidence: high.**
- `apps/extension/src/components/JsonViewer/LogsViewer.vue:233` — mounting, unmounting, then selecting text leaves the old document listeners active; they retain component state and can restart its timeout after teardown. Cleanup at `:252-257` does not remove them. **Confidence: high.**
- `apps/extension/src/onboarding/app.vue:23` — with a saved light preference and a dark OS theme, onboarding initializes from the default `"system"` and applies it without reading persisted config, overriding the saved appearance and rewriting its paint hint. **Confidence: high.**

## Cross-rebuttal (codex on claude)

Confidence: **high** on the source observations below. IDs use the prefix `q08-ext-components-onboarding-`.

**1. Overconfident / wrong in Claude’s findings**

- **C-1 — Partially agree.** The duplicated form wiring and action predicates are real, but the destructures differ (`apps/extension/src/onboarding/pages/import.vue:66` includes `isImporting`); the popup’s finishing branch explicitly handles its listener-based bootstrap (`apps/extension/src/popup/pages/import.vue:264-267`), so calling that difference accidental drift is unsupported.
- **C-2 — Agree.** The same arrow-key toggle and deferred focus operation appear at `apps/extension/src/onboarding/pages/create.vue:80-86` and `apps/extension/src/popup/components/modules/settings/new-profile/NewProfileMethodTabs.vue:15-23`; shared behavior belongs below the popup boundary.
- **C-3 — Partially agree.** Seven identical keyframe definitions justify extraction; I withdraw my earlier blanket dismissal. However, `apps/extension/src/popup/components/popups/NewSenderPopup.vue:179-191` uses different steps/amplitudes, and differing durations alone do not establish accidental drift.
- **C-4 — Partially agree.** Duplicate Code fits; using Input’s public suffix slot does not establish Feature Envy. Extracting only the toggle cannot remove seven visibility refs: surrounding inputs still consume shared visibility, including confirmation at `apps/extension/src/components/composite/import/ImportSecretForm.vue:102`.
- **C-5 — Agree on dead `SettingValue`.** The reference sweep confirms only tests, stories and generated typing; `apps/extension/vite.config.ts:138-142` configures on-demand component resolution. The broader row extraction must preserve differences such as `SettingField`’s `:last-of-type` versus `SettingItem`’s `:last-child` (`apps/extension/src/components/ui/Settings/SettingField.vue:70`; `apps/extension/src/components/ui/Settings/SettingItem.vue:185`).
- **C-6 — Agree.** This matches X-4. A sub slot is viable, but migration must account for existing width/wrapping differences at `apps/extension/src/components/composite/ListStatusMessage.vue:51-56`. Sharing CSS also removes the duplicated styling authority; it does not inherently leave two.
- **C-7 — Partially agree.** Dead `Divider` is supported. The proposed EmojiGrid adapter is not behavior-preserving: the extension caps output at nine and uses 48px cells (`apps/extension/src/components/composite/general/EmojiGrid.vue:11,37`), whereas the package renders every supplied cell at 56px (`packages/design/src/composite/EmojiGrid.vue:17,37`).
- **C-8 — Partially agree.** CTA duplication and dead styles are valid, but the claimed white-hover drift is false: the later outline rule overrides it (`apps/extension/src/components/composite/SecretCountdownClose.vue:99-102`) and matches `packages/design/src/ui/Button.vue:341-344`. Button already provides relative positioning and a default slot (`:136`, `:123`).

**2. What Claude missed that I still stand by**

- **X-1:** Toggle extraction leaves duplicated confirmation-field wiring, length constraints and hint markup; compare `apps/extension/src/components/composite/import/ImportSecretForm.vue:66-108` with `apps/extension/src/popup/components/modules/settings/new-profile/NewProfileCredentials.vue:18-59`. The four-location field-pair finding remains distinct from C-4.
- **X-2:** C-1 omits the third policy implementation: keyboard action selection at `apps/extension/src/popup/pages/import-helpers.ts:20-28`.
- **X-3:** Four lifecycle cards duplicate the title-chip visual contract, including `apps/extension/src/components/composite/activity/TransactionAwaitingCard.vue:132-152` and `apps/extension/src/popup/components/modules/activity/TransactionCard.vue:200-215`. Three instances are inside the assigned cluster, contrary to Claude’s appended rebuttal.

**3. What both missed**

No additional confirmed finding. Claude’s appended Popover dead-code lead is contradicted by `apps/extension/src/components/JsonViewer/LogsToolbar.vue:36`. Different responsibilities and refresh behavior between two AddressDisplay components do not, by themselves, establish Divergent Change.