# q05-popup-modules — codex

Scope read:

- Production `.vue`, `.ts` and CSS files under `apps/extension/src/popup/components/modules/**`, plus `apps/extension/src/popup/components/Navigation.vue`.
- Relevant regression tests in `modules/general/{BalanceView,TokensView,RecentActivityView}.test.ts`.
- Clone counterparts: `popup/components/popups/SelectFpcPopup.vue`, `popup/pages/settings/connected-apps/index.vue`, `popup/pages/settings/advanced/account-state/notes/index.vue` (rendering/styles), and `popup/windows/capabilities/AccountSelectRow.vue` (rendering/styles).
- Supporting source: `src/utils/activity-rows.ts`, `src/composables/{useScopedTokens,runFence}.ts`, `src/components/ui/{RowTarget,Settings/SettingItem}.vue`, `src/components/composite/ListStatusMessage.vue`, `src/wallet/services/config/client.ts`, and `packages/extension-messaging/src/background/client.ts`.
- Relevant `CLAUDE.md` conventions, curated lessons, supplied repository maps, production clone leads, both prior quality reports, prior consolidated instances, and complexity-baseline entries.

Reviewed `dev` at `910a4def`. History counts below are **all commits / commits since 2026-06-01**, using the current paths without rename following. No files modified; tests inspected, not executed.

## q05-popup-modules-X-1: Balance snapshot recovery is implemented twice

**Title:** Duplicated balance snapshot and recovery protocol.

**Smell name:** **Duplicate Code → Shotgun Surgery** (Fowler).

**Maintenance impact:** **Structural**; two production components and their regression suites. Change counts: `TokensView.vue` **12/12**, `BalanceView.vue` **17/17**; both last changed on 2026-09-30. Confidence: **high**.

**Concrete evidence:** Both components independently maintain scoped balance rows, invalidate snapshots overtaken by events, reject superseded responses, distinguish unavailable data from an empty list, retry once after two seconds, and resnapshot after reconnect:

- `apps/extension/src/popup/components/modules/general/TokensView.vue:184-225,256-305,343-388`
- `apps/extension/src/popup/components/modules/general/BalanceView.vue:177-188,231-309,334-345`

The correspondence includes `fetchDirty`, a fetch generation, `loading/loaded/unavailable`, `BALANCES_RETRY_MS = 2_000`, first-connect suppression, and recursive refetch when an event overtakes a snapshot. Existing tests independently exercise the same event-versus-snapshot and reconnect scenarios in `BalanceView.test.ts:324-380` and `TokensView.test.ts:497-545`.

**Why it harms future change:** Changing reconnect handling, retry policy or snapshot precedence requires reproducing the same change in both views. A partial fix makes the hero aggregate and holdings list disagree about the same account’s balances. This is duplicated synchronization policy, beyond the documented convention of parent-owned clients.

**Smallest safe refactoring:** **Extract Composable** into `apps/extension/src/composables/useScopedTokenBalances.ts`. Receive the parent-owned client and scope getter; own row synchronization, generation invalidation, retry state and listener disposal. Keep task-derived flags, pinned ordering, seed placeholders and hero timing in their current components. Preserve the list’s scope invalidation before its task-loading await.

**What disappears:** One duplicate fetch/retry implementation, one duplicate balance-event/reconnect handler family, and the second copy of synchronization state and timer cleanup. Client construction and disconnection remain parent-owned.

**Instances:**

- `apps/extension/src/popup/components/modules/general/TokensView.vue:184,218,260,268,280,346,377`
- `apps/extension/src/popup/components/modules/general/BalanceView.vue:179,183,231,254,262,268,294,334`

## q05-popup-modules-X-2: Home and History duplicate activity-row dispatch

**Title:** Two renderers maintain the same activity-row contract.

**Smell name:** **Duplicate Code**, with duplicated **Switch Statements** expressed as Vue conditional branches (Fowler).

**Maintenance impact:** **Structural**; two L4 components serving Home/token activity and History. Change counts: `RecentActivityView.vue` **20/20**, `TransactionsList.vue` **8/8**; both last changed on 2026-09-30. Confidence: **high**.

**Concrete evidence:** Both renderers dispatch the same `tx | incoming | journal` union to the same three components, construct the same detail routes, derive incoming presentation through `buildIncomingCardProps`, and gate terminal rendering through `buildJournalTerminalCardProps`:

- `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:240-242,394-403,852-865`
- `apps/extension/src/popup/components/modules/activity/TransactionsList.vue:44-51,62-75`

The duplicated logic is the mapping from an activity row to its card, presentation props and navigation destination. Their surrounding responsibilities differ: preview budgeting and in-flight cards versus date grouping. The preview additionally supplies a journal `id` attribute and suppresses arrival animation in token mode.

**Why it harms future change:** Changing a card’s navigation or presentation contract requires editing both dispatch ladders and their adapters. A receipt-card prop change can reach History while leaving Home unchanged despite both surfaces displaying the same record.

**Smallest safe refactoring:** **Extract Component** into `apps/extension/src/popup/components/modules/activity/ActivityRow.vue`. Centralize the three-way dispatch, route construction and existing presentation-helper calls. Pass the token data, fiat lookup and already-decided arrival flag from the caller; preserve the preview’s journal attribute. Keep grouping, filtering, budgets and in-flight rendering in the parents. This belongs at **L4**, because it renders the existing L4 `TransactionCard`.

**What disappears:** One redundant three-branch renderer and duplicate card-prop/route assembly. The existing card components and pure display helpers remain.

**Instances:**

- `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:240,399,852`
- `apps/extension/src/popup/components/modules/activity/TransactionsList.vue:44,49,62`

## q05-popup-modules-X-3: Contact and connected-app rows duplicate a complete visual shell

**Title:** Duplicated settings identity-row presentation.

**Smell name:** **Duplicate Code → Shotgun Surgery** (Fowler).

**Maintenance impact:** **Structural**; two settings surfaces. Change counts: `ContactRow.vue` **2/2**, connected-apps `index.vue` **4/4**; both last changed on 2026-09-28. Confidence: **high**.

**Concrete evidence:**

- `apps/extension/src/popup/components/modules/settings/contacts/ContactRow.vue:22-57,62-100,122-148`
- `apps/extension/src/popup/pages/settings/connected-apps/index.vue:133-164,176-214,232-258`

Both implement a stretched `RowTarget`, leading identity image, two-line text and trailing actions. Their 39-line row blocks duplicate padding, hover/active surfaces, keyboard-focus treatment, inset separator and last-row behavior. Another 27-line block duplicates title/subtitle typography and truncation.

This is a complete shared row presentation, not an incidental flex declaration. The existing `RowTarget` centralizes activation but deliberately leaves these surrounding styles to callers.

**Why it harms future change:** Adjusting settings-row density, focus treatment or long-label behavior requires coordinated edits in both files. The same interaction contract is embedded alongside unrelated contact actions and session actions.

**Smallest safe refactoring:** **Extract Component** into an L3 `apps/extension/src/components/composite/IdentityListRow.vue`, with slots for target, leading visual, title, subtitle and actions. Preserve the existing `RowTarget` and action wiring, including the contact sender chip’s activation behavior. The shared component needs no stores or services.

**What disappears:** One redundant 39-line row-style block and 27-line text-style block—66 existing lines before abstraction overhead—plus duplicated row layout markup. Contact-specific chips and session-specific actions remain local.

**Instances:**

- `apps/extension/src/popup/components/modules/settings/contacts/ContactRow.vue:22,62,122`
- `apps/extension/src/popup/pages/settings/connected-apps/index.vue:133,176,232`

## q05-popup-modules-X-4: Authwit and note cards duplicate their record presentation

**Title:** Duplicated inspectable-record card and field grid.

**Smell name:** **Duplicate Code → Shotgun Surgery** (Fowler).

**Maintenance impact:** **Structural**; two account-state surfaces. Change counts: `AuthwitCard.vue` **2/2**, notes `index.vue` **5/5**; both last changed on 2026-09-28. Confidence: **high**.

**Concrete evidence:**

- `apps/extension/src/popup/components/modules/settings/authwits/AuthwitCard.vue:19-60,65-121,129-168`
- `apps/extension/src/popup/pages/settings/advanced/account-state/notes/index.vue:218-250,261-321,354-392`

Both implement a clickable record card with `RowTarget`, a truncated uppercase heading, and a two-column monospace key/value grid. They repeat the same focus/hover behavior and the exact two-line wrapping policy for long values.

The shared CSS includes a 22-line header/title block, a 28-line grid/key/value block, and a nine-line wrapping block. Notes add a contract-colored border and diagnostic content; authwits add a revoke action. Those differences do not explain the copied field-display contract.

**Why it harms future change:** A change to address/hash wrapping, field widths or keyboard-focus presentation must be reproduced across both card implementations. Fixing a narrow-window rendering problem in one does not propagate to the other.

**Smallest safe refactoring:** **Extract Component** for a presentational L3 `RecordCardFrame.vue`, with header, trailing-action and body slots. Extract the shared field-grid styles into an adjacent `record-card.module.css` consumed by both bodies. Leave authwit-kind branching, note preparation, contract accents and error handling in their current owners.

**What disappears:** One duplicate header/title block, key/value grid block and wrapping block—59 existing lines—plus repeated card interaction rules and frame markup. No domain-specific branches need merging.

**Instances:**

- `apps/extension/src/popup/components/modules/settings/authwits/AuthwitCard.vue:19,65,100,129,160`
- `apps/extension/src/popup/pages/settings/advanced/account-state/notes/index.vue:218,261,300,354,384`

## Non-findings considered

- **Prior 2026-08-14 Q-06 and Q-09, cited cluster instances:** `BalanceView` now delegates copying to `copyWithToast`; `TokenImportRow` delegates shortening to `trimAddress`. Those prior instances are fixed.
- **GasBalanceCard versus FeeSettingsCard:** both use the shared balance store; live display with optimistic deduction and committed fee-selection snapshots have materially different requirements. No wholesale state-machine merge recommended.
- **Recent versus full activity builders:** their journal filtering, token scoping and incoming-profile handling differ. Replacing `buildRecentActivityRows` wholesale with `buildActivityRows` would change behavior; finding X-2 concerns rendering after those decisions.
- **RecipientField versus SelectFpcPopup:** the reported clone is title/subtitle overflow styling. Autocomplete interaction and a popup picker do not establish a shared component contract.
- **AccountSelectRow and SettingItem versus ContactRow:** partial typography and separator overlap does not justify replacing selection/rename or settings-navigation behavior with the contact/session shell.
- **Shared fee styles and transaction disclosures:** `fee-shared.module.css` and `tx-shared.module.css` already centralize the main repeated structures. Small residual typography blocks were not promoted.
- **Large SFCs, client lifecycle and `dispose()`:** size and the documented lifecycle convention alone are not findings. No accepted complexity directive was re-flagged.
- **Navigation:** a short data-driven tab list; no substantive duplicated policy found.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:740-780` — unmount while `scopedTokens.reload()` is pending. Cleanup disconnects the clients, but the resumed mount callback still calls `configService.connect()` and `incomingTransferService.connect()` at lines 749 and 754. `useScopedTokens.reload()` settles after disposal/rejection, and `ServiceClient.connect()` permits reopening a disconnected client (`packages/extension-messaging/src/background/client.ts:50-89`). The reopened ports have no remaining component cleanup. Confidence: **high**, source-confirmed; not reproduced at runtime.

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

- **q05-popup-modules-C-1 — Partially agree.** The two main balance state machines duplicate substantial logic. However, `apps/extension/src/popup/components/popups/SelectTokenPopup.vue:111-137` has show/hide fencing without dirty-event replay or timed retries. Sharing its entire protocol requires preserving those differences. The claimed removal arithmetic also overstates net savings.

- **q05-popup-modules-C-2 — Partially agree.** Transaction filtering and row construction are duplicated, but incoming filtering is **not identical**: `apps/extension/src/popup/components/modules/general/recent-activity-rows.ts:73` checks profile ownership; `apps/extension/src/utils/activity-rows.ts:104-121` does not. Reusing the latter with only token prefiltering would remove an existing guard. Extract shared construction while retaining explicit filtering policies.

- **q05-popup-modules-C-3 — Partially agree.** Shared journal presentation fields warrant extraction, but the proposed direct binding is not behavior-preserving: `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:378-381` supplies a symbol independently of amount, whereas `apps/extension/src/utils/journal-state.ts:380-382` gates both together. Preserve this difference explicitly; synthesizing journal records for legacy tasks is not the smallest necessary refactoring.

- **q05-popup-modules-C-4 — Partially agree.** The ContactRow/connected-apps duplicate is strong. The report lists four files, not five plus SettingItem, and broadens the shared contract too far: `apps/extension/src/popup/windows/capabilities/AccountSelectRow.vue:114-165` uses different spacing, omits the same outline/active treatment, and adds locked/disabled behavior. Extract the identical pair first; other consumers require deliberate variants.

- **q05-popup-modules-C-5 — Agree.** `apps/extension/src/popup/components/modules/settings/authwits/AuthwitCard.vue:129-168` and `apps/extension/src/popup/pages/settings/advanced/account-state/notes/index.vue:354-392` duplicate a meaningful key/value presentation contract. An L3 presentation component can retain notes-specific accents and error handling.

- **q05-popup-modules-C-6 — Partially agree.** Identity comparison duplication is concrete at `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:184-189,548-554,726-734`. Extract those predicates first. “Refused Bequest” lacks a convincing inheritance/interface mapping, and the claimed two accepted directives are absent from this SFC; `scripts/complexity-baseline/manifest.json:6` instead references its test file.

- **q05-popup-modules-C-7 — Disagree as an established quality finding.** Freshness, reconnection, and subscription cleanup already live in `apps/extension/src/composables/usePrices.ts:22-49,96-99`; changing them does not require 16 edits. `apps/extension/src/popup/app.vue:93` provides arrivals, not a reusable prices instance. Subscription counts principally support the excluded performance argument. The claimed documented dispose-before-disconnect rule also reverses `CLAUDE.md:339-343`.

Confidence: **high** on these source comparisons; **moderate** on extraction boundaries.

**2. What Claude missed that I found**

- **q05-popup-modules-X-2 — Retained, with impact narrowed to local.** `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:852-865` and `apps/extension/src/popup/components/modules/activity/TransactionsList.vue:62-75` duplicate the row-type → component/props/route mapping. Different wrappers and preceding in-flight cards do not eliminate that Duplicate Code. A shared L4 row renderer can preserve caller-controlled arrival state and journal attributes; a route helper alone leaves the repeated dispatch contract.

**3. What BOTH of you missed**

No additional verified quality findings. Claude’s proposed “new” profile-predicate item was already included in C-2; the late-connect lifecycle issue remains an incidental bug, not evidence by itself for another quality finding.