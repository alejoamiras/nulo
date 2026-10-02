# q07-popup-pages — codex

Scope read:

- `CLAUDE.md`, `implementations-plan/lessons.md`, supplied repo maps and production clone leads.
- Prior reports: `audit/quality/2026-08-16-extension-mid/report.md` and `audit/quality/2026-08-14-dedup-mid/report.md`.
- `apps/extension/src/popup/pages/**`: production scripts throughout; targeted templates and styles, including settings lists, security/export flows, and transaction/receipt/journal details.
- Production `apps/extension/src/popup/*.ts`, `utils/**`, and `constants/**`.
- Comparison targets: `NewContactPopup.vue`, `EditContactPopup.vue`, `ImportContactsPopup.vue`, `ContactRow.vue`, `AuthwitCard.vue`, `SecretCountdownClose.vue`, `SecretUnlockSection.vue`, `useEntityCrud.ts`, `syncedRef.js`, and `packages/design/src/ui/RowAction.vue`.
- Targeted lifecycle evidence: `popup/app.vue`, `useProfileCreateFlow.ts`, `useProfileBootstrap.ts`, account/network clients, messaging client implementations, and the connected-app/profile-activation tests.
- Auto-import configuration and generated declarations.

Reviewed `dev` at `910a4def`. Read-only inspection; no files changed or tests executed. History counts below are commits touching the current path, without following renames. Total counts and counts since `2026-06-01` were identical for every listed file. Removal estimates are approximate.

## q07-popup-pages-X-1: Keyed list updates remain copied beside the shared CRUD implementation

**Title:** Keyed list updates remain copied beside the shared CRUD implementation. **RECURRING (prior: 2026-08-16 Q-07, UI list-update portion).**

**Smell name:** Duplicate Code → Shotgun Surgery, Fowler. **Confidence: high.**

**Maintenance impact:** Structural. Five consumer files plus the existing composable. Commit counts: Send **19**; NewContact **8**; EditContact **9**; ImportContacts **6**; connected-app list **4**; `useEntityCrud` **2**.

**Concrete evidence:** These consumers independently implement additions, replacement-or-append updates keyed by `id`, and removal by `id`:

- `apps/extension/src/popup/pages/send.vue:192-209`
- `apps/extension/src/popup/components/popups/NewContactPopup.vue:31-49`
- `apps/extension/src/popup/components/popups/EditContactPopup.vue:33-62`
- `apps/extension/src/popup/components/popups/ImportContactsPopup.vue:30-48`
- `apps/extension/src/popup/pages/settings/connected-apps/index.vue:44-73`

The corresponding reusable update/delete implementation already exists at `apps/extension/src/composables/useEntityCrud.ts:119-140`. EditContact additionally refreshes the active draft; connected-apps preserves logo metadata. Those are genuine extensions around the repeated list operation.

**Why it harms future change:** Changing how an updated entity replaces its cached predecessor requires synchronized edits across five consumers and the shared implementation. Existing divergence demonstrates the maintenance burden: the composable handles repeated additions idempotently, while the handwritten consumers append unconditionally.

**Smallest safe refactoring:** **Extract Function** for keyed upsert/removal into `apps/extension/src/utils/entity-list.ts`, consumed by the composable and these owners. Preserve EditContact’s draft-refresh branch, connected-app logo handling, and each owner’s fetch/subscription timing. A wholesale replacement with `useEntityCrud` would change initial-fetch behavior and is unnecessary.

**What disappears:** Five local search/replace-or-append/delete implementations become helper calls; approximately **35–50 duplicated lines** disappear. Fetch orchestration and specialized event effects remain.

**Instances:** `apps/extension/src/popup/pages/send.vue:196`; `apps/extension/src/popup/components/popups/NewContactPopup.vue:36`; `apps/extension/src/popup/components/popups/EditContactPopup.vue:38`; `apps/extension/src/popup/components/popups/ImportContactsPopup.vue:35`; `apps/extension/src/popup/pages/settings/connected-apps/index.vue:54`; shared counterpart `apps/extension/src/composables/useEntityCrud.ts:119`.

## q07-popup-pages-X-2: Appearance and Advanced duplicate configuration binding

**Title:** Appearance and Advanced duplicate configuration binding.

**Smell name:** Duplicate Code, Fowler. **Confidence: high.**

**Maintenance impact:** Structural, bounded to two settings pages and their configuration-binding contract. Commit counts: Appearance **9**, Advanced **6**.

**Concrete evidence:**

- `apps/extension/src/popup/pages/settings/appearance.vue:105-118,137-162`
- `apps/extension/src/popup/pages/settings/advanced/index.vue:108-121,140-157`

Both independently implement: reject unknown/unchanged keys; await `setValue`; apply the returned choice; show the same failure toast; consume `onUpdate` into a keyed ref map; hydrate that map from `getProps`; finish loading.

Their distinct behavior sits inside `applySetting`: opening the side panel versus updating dependent developer settings and explorer feedback.

**Why it harms future change:** A change to configuration-write handling, loading failures, or event-versus-snapshot ordering must be implemented twice. Each copy interleaves that shared mechanism with page-specific effects, making it harder to establish whether a change affects synchronization or product behavior.

**Smallest safe refactoring:** **Extract Composable** into `apps/extension/src/composables/useConfigSettings.ts`. Accept the parent-owned client, keyed refs, error callback, and explicit change callback. Preserve hydration’s current distinction from live changes: initial hydration must not open the side panel or run developer-setting cascades.

**What disappears:** One duplicated setter/event/hydration implementation, approximately **30–40 lines** after wiring. The two page-specific effect handlers remain.

**Instances:** `apps/extension/src/popup/pages/settings/appearance.vue:105`; `apps/extension/src/popup/pages/settings/advanced/index.vue:108`.

## q07-popup-pages-X-3: Detail-page extraction leaves shared transfer visuals duplicated

**Title:** Detail-page extraction leaves shared transfer visuals duplicated.

**Smell name:** Duplicate Code → Shotgun Surgery, Fowler. **Confidence: high.**

**Maintenance impact:** Structural within three activity-detail pages and their existing shared stylesheet. Commit counts: transaction detail **8**, received detail **5**, journal detail **8**, shared stylesheet **1**.

**Concrete evidence:**

- Explorer-link interaction: `apps/extension/src/popup/pages/tx/[id].vue:387-416` and `apps/extension/src/popup/pages/received/[id].vue:366-392`.
- Transfer/category chip: `apps/extension/src/popup/pages/tx/[id].vue:446-459`, `apps/extension/src/popup/pages/received/[id].vue:406-419`, and `apps/extension/src/popup/pages/journal/[id].vue:349-362`.
- Address-card interaction and label: `apps/extension/src/popup/pages/tx/[id].vue:461-484` and `apps/extension/src/popup/pages/received/[id].vue:421-452`.

These implement the same explorer affordance, transfer-kind chip, and From/To card appearance. The receipt’s non-clickable sender override is a legitimate difference. Amount typography and detail-box styles already share `apps/extension/src/popup/pages/detail-page.module.css:1-66`.

**Why it harms future change:** Restyling the transfer-kind chip requires three edits; adjusting explorer hover treatment or From/To cards requires two. The receipt page explicitly describes itself as the transaction page’s layout mirror, so these copies represent one visual contract.

**Smallest safe refactoring:** **Extract shared style rules**—the stylesheet equivalent of Extract Function—into the existing `detail-page.module.css`, using the established `composes` convention. Keep receipt-only `card_static` behavior and page-specific data/loading logic local.

**What disappears:** Approximately **60–70 net duplicated CSS lines**, replaced by composition declarations. No loading or privacy branches need consolidation.

**Instances:** `apps/extension/src/popup/pages/tx/[id].vue:387,446,461`; `apps/extension/src/popup/pages/received/[id].vue:366,406,421`; `apps/extension/src/popup/pages/journal/[id].vue:349`.

## q07-popup-pages-X-4: Notes and authwits independently maintain the same record-card presentation

**Title:** Notes and authwits independently maintain the same record-card presentation.

**Smell name:** Duplicate Code, Fowler. **Confidence: high.**

**Maintenance impact:** Structural across a page and an L4 feature component. Commit counts: Notes **5**, AuthwitCard **2**.

**Concrete evidence:**

- `apps/extension/src/popup/pages/settings/advanced/account-state/notes/index.vue:261-321,354-392`
- `apps/extension/src/popup/components/modules/settings/authwits/AuthwitCard.vue:65-121,129-168`

Both define the same interactive bordered card, header/title typography, two-column key/value grid, ellipsis treatment, and two-line wrapping rule for long hexadecimal values. Live consumers are visible at Notes `:217-241` and AuthwitCard `:18-60`.

Notes adds a contract-colored border and render-error state; authwits adds a revoke action. Those differences do not explain duplicating the shared card and field presentation.

**Why it harms future change:** Adjusting long-address readability, label-column width, or keyboard-focus treatment requires changes in both implementations. The wrapping policy is even explained independently in comments on both sides.

**Smallest safe refactoring:** **Extract shared style rules** into an L3-owned `apps/extension/src/components/composite/record-card.module.css`. Keep note parsing, authwit-kind branches, service access, and specialized border/action rules in their existing owners. A service-free card shell can follow only if markup reuse justifies it.

**What disappears:** Approximately **70–85 duplicated CSS lines** after composition wrappers; no domain branches or files need removal.

**Instances:** `apps/extension/src/popup/pages/settings/advanced/account-state/notes/index.vue:261,300,354`; `apps/extension/src/popup/components/modules/settings/authwits/AuthwitCard.vue:65,100,129`.

## q07-popup-pages-X-5: Contact and connected-app rows duplicate their interaction contract

**Title:** Contact and connected-app rows duplicate their interaction contract.

**Smell name:** Duplicate Code, Fowler. **Confidence: high.**

**Maintenance impact:** Structural across two row implementations. Commit counts: ContactRow **2**, connected-app list **4**. Both were touched by the same row-interaction change, `a233062c`.

**Concrete evidence:**

- `apps/extension/src/popup/components/modules/settings/contacts/ContactRow.vue:62-100,122-148`
- `apps/extension/src/popup/pages/settings/connected-apps/index.vue:176-214,232-258`

The copies encode identical row padding, hover/active backgrounds, stretched-target keyboard-focus styling, inset separators, title typography, and subtitle truncation. Both templates use `RowTarget` under a leading visual, two-line text, and trailing actions: ContactRow `:22-58`; connected-app list `:132-165`.

**Why it harms future change:** A change to the shared row’s focus outline, separator inset, or truncation policy requires parallel edits despite both rows already using the same target primitive. The shared interaction change in history reached both independent stylesheets.

**Smallest safe refactoring:** **Extract shared style rules** into `apps/extension/src/components/composite/settings-row.module.css`. Preserve the existing direct-child `RowTarget` relationship. Keep avatar/logo styling, sender chips, and action-specific colors local.

**What disappears:** One duplicate row/title/subtitle style family: approximately **50–60 net CSS lines**.

**Instances:** `apps/extension/src/popup/components/modules/settings/contacts/ContactRow.vue:62,122`; `apps/extension/src/popup/pages/settings/connected-apps/index.vue:176,232`.

## q07-popup-pages-X-6: Five pages hand-build the same toolbar icon button

**Title:** Five pages hand-build the same toolbar icon button.

**Smell name:** Duplicate Code → Shotgun Surgery, Fowler. **Confidence: high.**

**Maintenance impact:** Local UI primitive duplicated across five pages. Commit counts: authwits **7**, connected-app list **4**, connected-app detail **7**, contacts **7**, token detail **5**.

**Concrete evidence:**

- `apps/extension/src/popup/pages/settings/advanced/account-state/authwits/index.vue:207-224`
- `apps/extension/src/popup/pages/settings/connected-apps/index.vue:298-315`
- `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:368-385`
- `apps/extension/src/popup/pages/settings/contacts/index.vue:205-222`
- `apps/extension/src/popup/pages/tokens/[id].vue:299-321`

All implement a 32×32 transparent icon button with the same accent-tinted hover background and transition. Token detail additionally defines disabled treatment and uses the class for both refresh and menu controls. These are repeated header controls, not unrelated flex-layout fragments.

**Why it harms future change:** Adjusting the toolbar hit area or interaction styling requires five stylesheet edits and six template call sites. Disabled behavior has already become a page-local extension.

**Smallest safe refactoring:** **Extract Component** as a service-free L2 toolbar button under `packages/design/src/ui/`, retaining the current dimensions and hover treatment and accepting a label, disabled state, and icon slot. Existing `packages/design/src/ui/RowAction.vue:23-58` is a **24×24 nested-row action** with different interaction styling; substituting it directly would change the UI.

**What disappears:** Five local `.icon_btn` implementations and repeated button wrappers; approximately **65–75 net CSS lines** after introducing one shared implementation.

**Instances:** `apps/extension/src/popup/pages/settings/advanced/account-state/authwits/index.vue:140,207`; `apps/extension/src/popup/pages/settings/connected-apps/index.vue:115,298`; `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:218,368`; `apps/extension/src/popup/pages/settings/contacts/index.vue:150,205`; `apps/extension/src/popup/pages/tokens/[id].vue:210,227,299`.

## Non-findings considered

- **Prior clipboard duplication, 2026-08-14 Q-06:** inspected pages now delegate to `copyWithToast`/`copyToClipboard`; seed export uses `useSecretClipboardCopy`. Not recurring here.
- **Prior address truncation duplication, 2026-08-14 Q-09:** inspected page instances use `trimAddress`, including deliberate separator arguments. Not re-reported.
- **Prior Enter-key duplication, 2026-08-16 Q-07:** inspected callers use `usePopupEntity`, `isPopupSubmitKey`, or the profile-create adapter; the recurring finding above concerns list updates only.
- **Detail-page client triples:** transaction, receipt, and journal pages have materially different record ownership, loading, deletion, and scope rules. A common loader is not justified merely because they instantiate Token/Config/Price clients.
- **Existing shared detail styles:** amount, timestamp, detail-box, and empty-state rules already compose `detail-page.module.css`; those portions of the clone leads are resolved.
- **`SecretCountdownClose` versus change-password CTA clone:** the change-password `.cta` block has no live reference; its template uses `<Button variant="cta">`. This is not a duplicated live countdown/button implementation.
- **`RowAction` versus toolbar buttons:** both sides were read; their dimensions, placement, and interaction contracts differ. The finding recommends preserving the toolbar variant, not blindly adopting RowAction.
- **`confirmationPolicies` in connected-app detail:** explicitly supplied through configured utility auto-imports; lack of a local import is not an undefined-symbol finding.
- **Boot/routing helpers and export flows:** distinct timing and state contracts explain their separation. No finding based solely on file count, comments, or size.
- **Generic short CSS clones, client lifecycle ownership, thin wrappers, and explicit `dispose()`:** excluded as boilerplate or documented conventions.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:113-144,209-211` — Open a session containing an account on a known chain, then navigate away: `fetchAccounts` opens a network client and an account client, but neither is disconnected; unmount disconnects only the dApp-session client. Repeated visits leave additional live ports. **Confidence: high.**
- `apps/extension/src/popup/pages/profile/new-profile-helpers.ts:25-27` — Profile creation succeeds, then activation bootstrap rejects while `isLogined` remains false: this loop ignores `bootstrapFailure` and has no timeout or disposal condition, so creation remains pending indefinitely. `useProfileCreateFlow.ts:103-104` keeps `isCreating` true until that promise resolves. **Confidence: high.**

## Cross-rebuttal (codex on claude)

Confidence: **high** on the source distinctions below.

**1. Overconfident / wrong in Claude’s findings**

- **q07-popup-pages-C-1 — Partially agree.** Shared detail styling is real, but “three copies of one screen” overstates it. Explorer inputs deliberately differ: active network in `apps/extension/src/popup/pages/tx/[id].vue:122-125`, record network in `apps/extension/src/popup/pages/received/[id].vue:125-128`. Both already delegate URL construction. Also, the supposedly byte-identical `.detail_link` differs at those files’ lines 419 and 478-486.

- **q07-popup-pages-C-2 — Agree.** The toolbar control warrants extraction, but the instance list misses its refresh-button use at `apps/extension/src/popup/pages/tokens/[id].vue:210-218`. Replacing only dropdown triggers would leave that page’s CSS necessary; extract a general toolbar icon button.

- **q07-popup-pages-C-3 — Partially agree.** Contact/connected-app rows share a concrete visual contract; the wider grouping conflates cards and rows. `apps/extension/src/popup/components/modules/settings/authwits/AuthwitCard.vue:65-98` uses a border, low-surface hover and high-surface active state; `apps/extension/src/popup/pages/settings/connected-apps/index.vue:176-214` uses an inset divider and high/highest states. The claimed 150–180-line removal is insufficiently supported.

- **q07-popup-pages-C-4 — Partially agree.** Toggle/shake duplication is real, but independently owned visibility state would change behavior: `apps/extension/src/popup/components/modules/settings/new-profile/NewProfileCredentials.vue:15,24,54` deliberately shares visibility between password and confirmation. The extracted input needs externally controllable visibility.

- **q07-popup-pages-C-5 — Partially agree.** Counter/download consolidation is defensible, including the proposed fence API extension. However, it cannot remove the obligation to check after each await: `apps/extension/src/popup/pages/settings/security/export/full.vue:344-349` still needs three checks. Replacing comparisons with closure calls does not eliminate that temporal coupling or those guard sites.

- **q07-popup-pages-C-6 — Agree.** The config-binding duplication supports extraction. Preserve the distinction between initial hydration and applying side effects: `apps/extension/src/popup/pages/settings/appearance.vue:149-158` assigns models directly, whereas lines 117-134 can open the side panel and close the window.

- **q07-popup-pages-C-7 — Partially agree.** Duplicate reducers exist; “Refused Bequest” does not fit without inheritance. Contrary to Claude’s appended rebuttal, replacing send’s fetch ownership requires behavioral adaptation: `apps/extension/src/popup/pages/send.vue:565-591` coordinates contacts with token/balance loading, query selection and propagated failures; `apps/extension/src/composables/useEntityCrud.ts:80-101,146` fetches independently and catches failures. Its `identity`/`accept` hooks do not resolve that difference. The asserted stale-import counterexample is unproven.

**2. What Claude missed that I found**

- **q07-popup-pages-X-4:** Retained, and Claude now acknowledges it. Beyond border/background boilerplate, `apps/extension/src/popup/pages/settings/advanced/account-state/notes/index.vue:354-392` and `apps/extension/src/popup/components/modules/settings/authwits/AuthwitCard.vue:129-168` duplicate the complete key/value grid, typography, truncation and two-line hexadecimal wrapping policy.

- **q07-popup-pages-X-1 — additional instance:** Logo preservation complicates wholesale composable adoption, but does not erase the keyed replacement/insertion/removal duplication at `apps/extension/src/popup/pages/settings/connected-apps/index.vue:58-72`. Narrow shared reducers can preserve those page-specific effects.

**3. What BOTH of us missed**

No additional finding confirmed in this light pass.