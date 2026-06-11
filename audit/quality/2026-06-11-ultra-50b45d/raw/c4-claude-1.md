# C4 — popup UI duplication families — Claude instance 1

Scope audited against source on branch `feat/security-audit-remediation`. All paths repo-relative under `packages/extension/src/` unless noted. Line numbers verified by direct read.

## F1: Import/Create profile flows duplicated wholesale across popup and onboarding entrypoints

1. **Title:** Import/Create profile flows duplicated wholesale across popup and onboarding entrypoints, already diverging.
2. **Smell name:** Duplicate Code (Fowler), escalating into Divergent Change — the two copies are modified in lockstep (4 commits each since Jan) but drift in their error-shaping and bootstrap behavior.
3. **Impact bucket:** architectural (the popup/onboarding entrypoint split duplicated an entire user flow instead of sharing it). Blast radius: 4 page files, ~2,100 LOC combined. Change frequency: high — `popup/pages/import.vue`, `onboarding/pages/import.vue`, `popup/pages/profile/new.vue`, `onboarding/pages/create.vue` each have 4 commits since 2026-01; the map lists profile/new.vue and import.vue as 3-month hotspots.
4. **Evidence (import pair):** `popup/pages/import.vue` vs `onboarding/pages/import.vue` share near-verbatim:
   - error state + `fillError`/`clearError` (popup :92-100 / onboarding :62-72)
   - `handleCopyError` incl. the 1_500ms timeout (popup :102-110 / onboarding :74-82)
   - `handlePasswordInput`/`handleSecretInput` (popup :112-118 / onboarding :83-88)
   - `isAllowedToContinue` + 3 `isAllowedToImportBy*` computeds, **including the identical explanatory comment** (popup :120-138 / onboarding :90-108)
   - `handleImportSeed`/`PrivateKey`/`PublicKey`/`Passkey` (~100 lines; popup :167-276 / onboarding :134-234) — same latch, same `getProfiles→validateName` preamble, same `"Invalid secret length"` / `"Invalid password"` string-matching
   - `useFullBackupImport` wiring incl. the same F3 comment (popup :279-315 / onboarding :236-274)
   - the guarded `parsedBackupName` watch, verbatim comment included (popup :317-323 / onboarding :276-282)
   - `clearFormState`/`handleBack` (popup :327-340 / onboarding :284-297)
   - the 4-button full-backup CTA template block (popup :459-539 / onboarding :385-468)
   - `@keyframes shakeInput` + `.shake` (popup :656-667 / onboarding :528-539)

   **Evidence (create pair):** `popup/pages/profile/new.vue` vs `onboarding/pages/create.vue` share: `strengthHint`/`passwordStrengthHint` verbatim (:81-87 / :51-57), `isAllowedToContinue` (:72-79 / :61-66), `createPasskeyProfileViaModal` verbatim (:95-101 / :77-83), and the ~45-line `handleCreate`/`handleSubmit` latch + UserRejectedError + notification-payload error block (:104-151 / :85-128).

   **Drift already shipped:** popup import passes the raw error object as the title (`fillError("unknown", err)`, import.vue:179) while onboarding shapes it (`fillError("unknown", "Import failed", msg)`, onboarding import.vue:148). Onboarding handlers call `bootstrapActiveProfile` twice per import (once in each handler :145/:164/:187/:215, once again inside `completeImport` :121 — documented as "idempotent"). Popup create has a hand-rolled `while (!appStore.isLogined) await sleep(100)` + manual account wiring (profile/new.vue:153-170) where onboarding uses `useProfileBootstrap` (create.vue:130) — three different post-create bootstrap recipes for one concept.
5. **Why it harms future change:** every import-flow fix (a new error string from `profile/service.ts`, a new import method, a change to the name-validation contract) must be discovered and applied in two places that have no pinning between them. The error-shaping divergence shows this is already happening; the next `"Invalid secret length"` message change upstream silently breaks one copy's field-level error routing and not the other's.
6. **Smallest safe refactoring:** Extract Function → a `useImportProfileFlow` composable (C1, parameterized by `{ completeImport, showErrorLog }`) and a `useCreateProfileFlow` composable (parameterized by post-create bootstrap), following the existing `useFullBackupImport`/`useProfileNameField` precedent — those two composables prove the team already extracts shared flow logic here; the remaining script bodies are the un-extracted residue. Pages keep only shell + routing.
7. **What disappears:** ~350 duplicated script lines, the four-way bootstrap divergence, and the import-handler error-string matching duplicated 6×. New import methods become one-file changes.
8. **Instances:** popup/pages/import.vue:92-340,459-539,656-667; onboarding/pages/import.vue:62-297,385-468,528-539; popup/pages/profile/new.vue:72-151,385-396; onboarding/pages/create.vue:51-128,365-376.

## F2: RecentActivityView is a god component with a third, un-extracted card-props derivation and a duplicated 50-line template branch

1. **Title:** RecentActivityView re-derives awaiting-card props inline (twice) although the terminal-card equivalent was already extracted, and duplicates its full card-list template across two branches.
2. **Smell name:** Large Class (894 lines, 7 service clients) + Duplicate Code (internal: two template branches; cross-phase: awaiting-card props vs `buildJournalTerminalCardProps`).
3. **Impact bucket:** structural. Blast radius: 1 file, but it is the **top-3 change hotspot** (5 commits since Jan; map §8) and every activity-feed bug fix lands here. Change frequency: high.
4. **Evidence:**
   - **Template duplication:** `popup/components/modules/general/RecentActivityView.vue:704-766` (token mode) and `:767-817` (home mode) render the identical `TransactionAwaitingCard` v-for (12 identical bindings), identical orphan-fallback card, and identical 3-way row switch (`TransactionCard`/`TransactionIncomingCard`/`TransactionTerminalCard`). The only deltas: the fallback predicate (`isTokenAwaitingTx` vs `awaitingAccountTxs.length`) and the outer `v-if`.
   - **Props-derivation triplication:** `utils/journal-state.ts:324-352` (`buildJournalTerminalCardProps`) centralizes title/icon/originLabel/transferTypeLabel/amount derivation for the *terminal* phase — its own docstring says it exists because "the duplication risked drift between the home widget and the dedicated activity page." The *awaiting* phase re-implements exactly those derivations inline: `cardTitleFor`/`cardOriginLabelFor`/`cardIconFor`/`cardAmountFor`/`cardAmountSymbolFor`/`cardTransferTypeFor` (RecentActivityView.vue:345-400), each duplicating a line of the shared builder (e.g. `token?.symbol || "Transfer"`, the `transferType !== undefined` zero-guard with the same comment). A third re-implementation covers the orphan executingTask: `executingProgressTitle`/`executingOriginLabel`/`executingAmount`/`executingAmountSymbol` (:148-185).
   - **Merge duplication:** the row merge at :91-109 re-implements `utils/activity-rows.ts:42-76` (`buildActivityRows`) — same row shapes, same keys, same `blockTimestamp * 1000` sortKey rule **with the same "Path 2" comment** — differing only by the row-budget slice. `activity-rows.ts:11-14` claims it was "Extracted from the inline merges that previously lived in both `activity.vue` and `RecentActivityView.vue`", which is now false for the second file (stale doc + live duplicate).
5. **Why it harms future change:** the next lifecycle field (the `transferTypeLabel` chip is the precedent — grep shows it had to be added to the terminal builder AND the 6 awaiting fns AND both template branches) requires 4+ edit sites in 2 files; missing one produces the exact "field drifts between phases" regression the layout component was built to prevent. The dual template branch means every card-binding fix must be applied twice in the same file — and this file changes monthly.
6. **Smallest safe refactoring:** Extract Function — add `buildJournalAwaitingCardProps(op, ctx)` to `utils/journal-state.ts` beside the terminal builder (same ctx shape, pure, unit-testable per the established pattern); then Extract Method on the template — one `ActivityRowsList`-style sub-component or a computed fallback predicate so the two branches collapse into one.
7. **What disappears:** ~110 lines of RecentActivityView (6 prop fns + one template branch), the three-way derivation drift surface, and the stale-doc inline merge (route it through `buildActivityRows` with an optional budget/filter param).
8. **Instances:** popup/components/modules/general/RecentActivityView.vue:91-109, 148-185, 345-400, 704-766, 767-817; utils/journal-state.ts:324-352 (canonical builder); utils/activity-rows.ts:11-14 (stale extraction claim).

## F3: Activity-feed source wiring (incoming-transfers, config toggle, tokens index) copy-pasted between activity.vue and RecentActivityView

1. **Title:** The three "activity feed data sources" are wired by hand twice — verbatim — in the two activity surfaces.
2. **Smell name:** Duplicate Code; composable-extraction opportunity (Vue analog of Extract Class — the repo's own C1 convention exists precisely for this shape).
3. **Impact bucket:** structural. Blast radius: 2 files today (894 + 320 lines), 3 if any token-detail surface grows incoming rows. Change frequency: high — RecentActivityView 5 commits, activity.vue 3 commits since Jan; the incoming-transfer trust arc (memory: 6-cycle audit-fix) touched exactly this wiring repeatedly.
4. **Evidence:**
   - **Incoming-transfer block, verbatim ~30 lines:** `popup/pages/activity.vue:52-77` vs `popup/components/modules/general/RecentActivityView.vue:205-228` — identical `loadIncomingTransfers` guard + fetch, identical `onIncomingTransferAdded/Updated/Deleted` splice handlers keyed on `siloedNullifier`, identical 4 listener registrations incl. `onConnected.add(loadIncomingTransfers)`.
   - **Config toggle watcher, verbatim:** activity.vue:87-93 vs RecentActivityView.vue:235-241 — same `onConfigUpdate` keyed on `"incomingTransfersVisible"`, same explicit `configService.connect()` in onMounted with the same multi-line comment (activity.vue:172-179 / RAV:662-666).
   - **Tokens index + refresh-on-add:** activity.vue:38-44,147-156 vs RAV:128-144 — same `loadTokens` + `tokenService.onTokenAdded.add(loadTokens)`, the activity.vue copy even annotated "Same pattern as RecentActivityView." (:155).
   - `incomingCardProps` mapper duplicated: RAV:243-251 vs `popup/components/modules/activity/TransactionsList.vue:73-81`.
5. **Why it harms future change:** the comments in both files document the wiring's three landmines (no auto-connect, reconnect snapshot, toggle clearing) — every future consumer must rediscover and re-copy all three. The trust-state refactor flagged in project memory ("per-triple serialized critical section before adding new trust state transitions") will have to be applied at both sites or the surfaces will disagree about visible incoming rows.
6. **Smallest safe refactoring:** Extract Function → a `useIncomingTransfers(scope)` C1 composable (returns `{ records, reload, dispose }`, owns the event trio + config-toggle reload; parent owns connect/disconnect per the house composable contract) and a tiny `useTokenIndex()` for the id→token map. Both are mechanical lifts of already-identical code.
7. **What disappears:** ~70 duplicated lines across the two pages, the duplicated landmine comments, and the risk that the next incoming-transfer schema change (e.g. trust transitions) lands in one surface only.
8. **Instances:** popup/pages/activity.vue:38-44, 52-77, 87-93, 147-156, 172-179; popup/components/modules/general/RecentActivityView.vue:128-144, 205-228, 235-241, 243-251, 662-671; popup/components/modules/activity/TransactionsList.vue:73-81.

## F4: useEntityCrud exists but the hand-rolled added/updated/deleted event-trio is still copy-pasted in ~11 components

1. **Title:** Half-migrated abstraction — `useEntityCrud` covers 5 consumers while 11 components still hand-roll the same service-event splice trio with divergent edge-case behavior.
2. **Smell name:** Duplicate Code + Divergent Change (the same logical operation — "mirror a service collection into a ref" — has ~11 independently-rotting implementations; an analog of Fowler's "Incomplete Library Class" where the library is in-repo).
3. **Impact bucket:** structural. Blast radius: 11 files across popups/modules/pages. Change frequency: medium — the popups dir has 9 commits since Jan; each new service event shape change fans out.
4. **Evidence:** `composables/useEntityCrud.ts` (with stale-fetch seq guard, resync mode, identity override) is consumed by settings/{contacts,fpcs,tokens}/index.vue and account-state/{authwits,senders}/index.vue. Meanwhile the trio is hand-rolled in:
   - popup/components/popups/NewContactPopup.vue:30-47 and EditContactPopup.vue:32-74 (the Edit copy adds a special-case branch at :62-66)
   - NewFpcPopup.vue:83-93,105-108 and EditFpcPopup.vue:128-145,164-167 (the Edit copy adds close-on-delete)
   - SelectFpcPopup.vue:47-50,77-87; SelectTokenPopup.vue:26-37; SelectBalanceTypePopup.vue:45-65; SelectProfilePopup.vue:20-23,46-60
   - popup/components/modules/general/BalanceView.vue:150-169 (token-balance trio) and :105-148 (task trio)
   - RecentActivityView.vue:213-228 and popup/pages/activity.vue:61-77,106-126 (covered in F3)

   Divergences among the copies: on update-miss, NewContactPopup pushes (:42), NewFpcPopup ignores (:88), SelectBalanceTypePopup ignores (:56); none has useEntityCrud's stale-fetch protection. None is pinned by a test.
5. **Why it harms future change:** a change to service event semantics (e.g. re-emit on reconnect, which useEntityCrud explicitly handles at :88-93) behaves differently in each hand-rolled copy. Anyone fixing a list-staleness bug must audit 11 bespoke implementations and decide per-file whether the divergence is intentional — the duplicated copies have no marker distinguishing "deliberate edge case" from "drift".
6. **Smallest safe refactoring:** Replace Inline Code with Function Call — migrate the mechanical copies (Select* popups, BalanceView trios) to `useEntityCrud`, which already supports the needed `identity` and event-subset options. The Edit-popup special cases (close-on-delete, edit-target sync) fit as small wrappers around the composable's refs. Migrate file-by-file; behavior pins per the repo's bug-pin convention where a copy's quirk is load-bearing.
7. **What disappears:** ~150 lines of bespoke splice logic and the per-copy staleness/duplication bugs the composable was written to solve (seq-guarded fetch, add-as-update on re-emit).
8. **Instances:** as listed in field 4 — 11 hand-rolled sites vs 5 composable consumers.

## F5: FormPopup-family popups each re-implement Enter-to-submit, keydown listener lifecycle, and the processingError tooltip block

1. **Title:** 16 popups re-implement the same Enter-key submit wiring; 4 re-implement a ~30-line error-tooltip template that FormPopup should own.
2. **Smell name:** Duplicate Code + Feature Envy — every popup manipulates `document` keydown listeners and submit-on-Enter semantics that belong to `FormPopup` (which already owns the `@submit` contract); the `#aboveSubmit` error tooltip envies FormPopup's layout.
3. **Impact bucket:** structural. Blast radius: 16 popup files. Change frequency: medium (popups dir: 9 commits since Jan; every new entity popup copies the scaffold — `NewTokenPopup`, the newest, copied all of it).
4. **Evidence:**
   - **onKeydown handlers (16):** ChangeAuthwitsRegistryPopup.vue:110, EditAccountPopup.vue:74, EditEndpointPopup.vue:93, EditContactPopup.vue:348, EditNetworkPopup.vue:87, EditFpcPopup.vue:189, EditProfilePopup.vue:110, NewContactPopup.vue:181, NewAccountPopup.vue:84, NewFpcPopup.vue:121, NewSenderPopup.vue:95, NewEndpointPopup.vue:77, NewNetworkPopup.vue:113, NewTokenPopup.vue:296, RevokeAuthwitsPopup.vue:163 (+ PasskeyCeremonyDialog). Ten of them carry the identical `instanceof HTMLInputElement || instanceof HTMLTextAreaElement` double-fire guard; NewContactPopup.vue:182-187 has the canonical 6-line rationale comment, NewFpcPopup.vue:122 abbreviates it to "see NewContactPopup for rationale" — sync-by-comment. Each popup also duplicates the `document.addEventListener`/`removeEventListener` pair inside its show-watcher (16 × 2 call sites).
   - **processingError block (4):** the `{show,title,tooltip}` ref + the `#aboveSubmit` Tooltip/Icon/Text template are near-verbatim in NewContactPopup.vue:95-99,263-292; EditContactPopup.vue:143-147,434-463; NewFpcPopup.vue:58-62,178-207; EditFpcPopup.vue:99,274-295. Drift evidence: NewFpcPopup.vue:192 binds `processingError.type === 'warning'` but no code path ever sets a `type` field on that ref — a vestige copied from a variant shape (execute/index.vue's `UIError` has `type`), silently always-red.
5. **Why it harms future change:** changing submit-key behavior (e.g. ignoring Enter while a dropdown is open, or supporting Cmd+Enter) is a 16-file shotgun edit; the guard comment already had to be written twice. The error-tooltip drift shows copies decay independently — a visual redesign of form-error display is a 4-file template surgery plus the divergent `errorText` string variant (NewEndpointPopup.vue:28).
6. **Smallest safe refactoring:** Move Function — let `components/composite/FormPopup.vue` own a window keydown listener while `show` is true and emit its existing `submit` event on guarded Enter (popups already route Enter → the same handler as `@submit`). Then Extract Method on the error tooltip: an optional `error: {title, tooltip}` prop (or named slot default) on FormPopup.
7. **What disappears:** ~16 × 10 lines of listener lifecycle + guard logic, 4 × 30 lines of tooltip template, the dead `.type` binding, and the obligation to re-copy the double-fire guard into every future popup.
8. **Instances:** all locations in field 4; FormPopup.vue (target) at components/composite/FormPopup.vue.

## F6: Copy-paste dead-code families across the popup fleet

1. **Title:** Dead `displaceIdx` computeds (×8), a dead 57-line style block (×5), and assorted dead state/imports/emits, all traceable to scaffold copy-paste.
2. **Smell name:** Dead Code (Fowler, Dispensables) — with a contributing Alternative Classes with Different Interfaces note: the `displaceIdx` prop means "z-index basis" to `Popup` (raw `order`) but "stack displacement count" to `PopupCard` (`len - order`), which is why authors keep both expressions around and one goes dead.
3. **Impact bucket:** local per instance, but fleet-wide (15+ files) and self-replicating: every new popup is seeded from an existing one (NewTokenPopup, newest, repeats the patterns). Change frequency: popups dir 9 commits since Jan.
4. **Evidence (each verified by grep that the identifier has no other reference in its file; none of these names is auto-import-registered — auto-imports cover `src/utils|composables|stores|components` module exports, not SFC-local bindings):**
   - **Dead `displaceIdx` computeds ×8** — defined but the template binds `popupStore.popups.X?.order` directly to FormPopup: NewContactPopup.vue:19-21, EditContactPopup.vue:21-23, NewAccountPopup.vue:17, EditAccountPopup.vue:14-16, NewNetworkPopup.vue:15-17, EditNetworkPopup.vue:14-16, NewEndpointPopup.vue:17, EditEndpointPopup.vue:17. (In Popup+PopupCard popups the same computed IS used — the FormPopup conversions left the corpse behind.)
   - **Dead `.network`/`.icons`/`.item` style block ×5**, byte-identical ~57 lines, zero `$style.network|icons|item` template references: NewNetworkPopup.vue:181-238, EditNetworkPopup.vue:147-204, NewAccountPopup.vue:130-186, EditAccountPopup.vue:122-179, NewSenderPopup.vue:178-232.
   - **Dead shake animation:** EditContactPopup.vue:485-503 (`.shake` + keyframes; no `$style.shake` in template).
   - **Dead `.token` style:** SelectTokenPopup.vue:104-121, SelectProfilePopup.vue:148-165 (both templates use SettingItem rows).
   - **Dead emit declarations:** `"onSelectToken"` declared but never emitted — SelectTokenPopup.vue:13, SelectProfilePopup.vue:15.
   - **BalanceView.vue:** unused `import { DateTime } from "luxon"` (:8), unused `BalanceDisplayOptionsMap` (:74-78), dead `.hover_red` style (:394-404), write-only `isCopied` ref (:80-88). **SplittedBalancesView.vue:** write-only `isCopied` (:38-48).
   - **RecentActivityView.vue:23:** `journalTerminalDisplay` imported, never referenced.
   - **Commented-out template block:** SelectNetworksPopup.vue:88-110 (23 lines of dead "Add network" UI).
5. **Why it harms future change:** the dead blocks are what gets copied into the next popup (5 independent copies of the style block prove the propagation). Readers must reverse-engineer whether `displaceIdx`-the-computed or `order`-the-binding is the live one — and the answer differs per popup family, masking the real `Popup` vs `PopupCard` semantic split.
6. **Smallest safe refactoring:** Remove Dead Code (mechanical, per file). For the root cause: Rename Variable/prop on one side of the `Popup`/`PopupCard` semantic split (e.g. `zOrder` vs `displaceIdx`) so a copied expression can't silently satisfy the wrong consumer.
7. **What disappears:** ~450 lines of dead CSS/JS across 15 files, plus the copy-template that re-seeds them.
8. **Instances:** as enumerated in field 4.

## F7: Account-state pages repeat one page scaffold four times, half on useEntityCrud and half hand-rolled

1. **Title:** authwits/contracts/notes/senders pages duplicate the SubPageHeader + LoadingState + error-Banner + empty-state scaffold and split between two fetch idioms.
2. **Smell name:** Duplicate Code + Divergent Change (two fetch idioms for the same page shape means the same bug needs two different fixes); the four `<style module>` blocks are textbook copy-paste.
3. **Impact bucket:** structural. Blast radius: 4 files (275/188/497/225 lines). Change frequency: low (1 commit since Jan) — prioritized below F1-F5 accordingly, but the next account-state surface (e.g. capsules/events) will copy a fifth instance.
4. **Evidence:** popup/pages/settings/advanced/account-state/
   - **Identical CSS:** `.wrapper`/`.content` ×4 (authwits:200-209, contracts:113-122, notes:275-284, senders:157-166), `.empty`/`.empty_headline`/`.empty_sub` ×4 (authwits:234-263, contracts:147-176, notes:456-485, senders:195-224), `.no_results` ×3 (authwits:265-275, contracts:178-188, notes:487-496).
   - **Identical template scaffold:** `LoadingState v-if` → `Tooltip+Banner "Something went wrong" / "Try again"` → list → `NO MATCHES` → dashed-border empty state (authwits:168-194, contracts:66-106, notes:214-268, senders:87-146).
   - **Two fetch idioms:** authwits:40-53 and senders:34-44 use `useEntityCrud`; contracts:29-43 and notes:53-56,111-131 hand-roll `isFetching`/`error`/`fetchX(isRefetching)` with the `openToast("Fetching X again", icon: "zap")` refetch toast — which authwits implements differently again (`handleRefetch` wrapper :84-87).
   - **Identical lifecycle scaffold ×4:** `watch(() => appStore.account, refetch)` + `onMounted(if network && isLogined)` + `onBeforeUnmount(disconnect)` (authwits:103-121, contracts:45-58, notes:184-197, senders:71-79).
5. **Why it harms future change:** a fix to error-retry UX or empty-state copy conventions is a 4-file edit with two different code shapes; migrating contracts/notes to `useEntityCrud` later costs more after each page accretes bespoke state. The 4× CSS blocks already require lockstep edits for any list-page restyle.
6. **Smallest safe refactoring:** Extract Method/Component — an `AccountStatePageShell` (or shared CSS module + a `useAccountStateList` wrapper over `useEntityCrud`) holding header/loading/error/empty slots; migrate contracts + notes onto `useEntityCrud` (notes keeps its `displayNotes` mapping as the `fetch` post-process).
7. **What disappears:** ~200 lines of duplicated CSS + template scaffold and the dual fetch idiom.
8. **Instances:** account-state/{authwits,contracts,notes,senders}/index.vue at the line ranges above.

## F8: Repeated visual micro-patterns (selectable-row card, check/circle ternary, title chip) with sync-by-comment instead of a shared primitive

1. **Title:** The "selectable row card" CSS recipe, the selected-icon ternary, and the activity-card `.chip`/`.title_sep` styles are each duplicated 4-5× with comments promising they "mirror" each other.
2. **Smell name:** Duplicate Code; "sync-by-comment" (named analog: comments-as-deodorant over duplication — the comment exists to coordinate copies that a shared primitive would coordinate structurally).
3. **Impact bucket:** structural (cosmetic per-instance, structural as a family — these are the design system's de-facto components, hand-copied). Blast radius: ~9 files. Change frequency: low-medium (composite/activity 3 commits since Jan; chip styles were touched in the transfer-type-chip arc).
4. **Evidence:**
   - **Row-card CSS recipe** (border `--nulo-border`, hover `surface-low` + `--nulo-outline`, active `surface-high`): SelectFpcPopup.vue:190-212 (`.fpc`), SelectBalanceTypePopup.vue:179-196 (`.card`), SelectNetworksPopup.vue:123-143 (`.network`), account-state/contracts/index.vue:124-145 (`.card`), account-state/senders/index.vue:168-183 (`.card` variant), account-state/notes/index.vue:286-312 (`.card` variant).
   - **Selected-row icon ternary** (`'check-circle' : 'circle'` + `'green'|'primary' : 'tertiary'`): SelectFpcPopup.vue:142-154, SelectBalanceTypePopup.vue:139-143, SelectNetworksPopup.vue:60-72, SelectProfilePopup.vue:95-107, SelectTokenPopup.vue:77-78.
   - **Activity-card chip:** `.title_sep` + `.chip` styles duplicated in components/composite/activity/TransactionTerminalCard.vue:100-118 (comment: "Mirrors the awaiting + settled cards"), TransactionIncomingCard.vue:72-95, TransactionAwaitingCard.vue (chip styles near :73), popup/components/modules/activity/TransactionCard.vue:223-244.
5. **Why it harms future change:** these are exactly the patterns a brand restyle touches; today that's a 10-site sweep where missing one produces subtle visual drift (the kind the TransactionCardLayout extraction was done to prevent — its docstring cites "field-position drift" as a shipped, user-flagged regression). The "mirrors X" comments rot the moment one copy changes.
6. **Smallest safe refactoring:** Extract Component — a `SelectableRow` (L2/L3: selected prop + default slot, owning icon ternary + row CSS) consumed by the Select* popups; for the chip, a `#title-trailing` micro-component (or a shared CSS module imported by the four cards) so the chip is defined once.
7. **What disappears:** ~5 copies of the row recipe, 5 copies of the icon ternary, 4 copies of chip CSS, and three "mirrors" coordination comments.
8. **Instances:** as listed in field 4.

## F9: useFeeEstimation duplicates useFeeEstimationMap's debounce/stale-counter machinery instead of being a single-key wrapper

1. **Title:** The single-slot fee-estimation composable re-implements, line for line, the per-key machinery of its map twin.
2. **Smell name:** Duplicate Code (the twins are documented as deliberate, but the *implementation* duplication isn't required by the deliberate *API* split); borderline Lazy Class for the single-slot variant.
3. **Impact bucket:** local. Blast radius: 2 files + their consumers (send.vue; execute window). Change frequency: low (1 commit each since Jan) — flagged because the duplicated logic is the subtle part (stale-counter + disposed guards), i.e. exactly what you don't want to fix twice.
4. **Evidence:** composables/useFeeEstimation.ts:33-93 vs composables/useFeeEstimationMap.ts:34-101 — `cancel`, `schedule` (clear-timer → null result → flag → counter bump → setTimeout → try/catch/finally with `disposed || myCounter !== counter` checks), and `dispose` are the same algorithm; the map version generalizes only by `key`. The doc comments cross-reference each other ("Send-page-style 800ms callers should prefer `useFeeEstimation`", Map:8-9) — twin APIs are deliberate, twin bodies are not load-bearing.
5. **Why it harms future change:** a fix to the cancellation semantics (e.g. the finally-block isEstimating race, or aborting the in-flight promise via AbortSignal) must be written and tested twice; the two already differ subtly (`cancel` bumps the counter in both, but `dispose` clears results in neither — anyone changing one will have to diff the other to know what's intentional).
6. **Smallest safe refactoring:** Substitute Algorithm — reimplement `useFeeEstimation` as a thin adapter over `useFeeEstimationMap` with a fixed key (preserving its public single-slot API and the 800ms default); both test suites keep passing unchanged.
7. **What disappears:** ~55 lines of duplicated timing/staleness logic; future estimator fixes become single-site.
8. **Instances:** composables/useFeeEstimation.ts:33-93; composables/useFeeEstimationMap.ts:34-101.

## F10: Layer-rule gaps — onboarding may import popup/components/popups, and wallet-services-tree pure utils are imported by L3

1. **Title:** Two enforcement gaps let sanctioned-sounding imports erode the stated boundaries: the onboarding biome override omits the popups subtree, and `capability-meta`'s pure sanitizers pull L3/flat components into the `@/wallet/services/**` tree.
2. **Smell name:** Boundary erosion (cyclic-dependency-family analog; mapping: this is Shotgun-Surgery-in-waiting — when the boundary finally needs enforcing, every leaked import is a forced touch) + Misplaced Responsibility for the sanitizers (Move-Function candidates).
3. **Impact bucket:** architectural (the rules ARE the architecture here; CLAUDE.md documents both the onboarding-is-a-peer rule and the L3 service ban). Blast radius: 6 import sites today; unbounded as precedent. Change frequency: onboarding pages 4 commits each since Jan.
4. **Evidence:**
   - **Gap 1:** biome.json:296-314 bans onboarding → `@/popup/pages`, `@/popup/windows`, `@/popup/components/modules/**` with messages saying "promote shared logic to @/components/composite" — but has **no glob for `@/popup/components/popups/**`**. Live leak: onboarding/pages/import.vue:10 and onboarding/pages/create.vue:8 import `@/popup/components/popups/PasskeyCeremonyDialog.vue`. The dialog itself is entrypoint-portable (teleports to `#popup`, which the onboarding shell declares — create.vue:6-8 comment), so the *component* is fine; its *address* defeats the rule.
   - **Gap 2:** `sanitizeWireString`/`stripWireControl` are pure string utilities living at `wallet/services/dapp-session/capability-meta.ts`, imported by flat components ScopeAddress.vue:31, ScopeClassId.vue:15 and by L3 composites CapabilityDetailPanel.vue:14, DappIdentityBlock.vue:15. The L1-L3 biome ban (biome.json:236-269) covers only `@/wallet/services/*/client` and `*/service` patterns, so these slip through — L3 now has a compile-time dependency edge into the services tree that the layer model says must not exist.
5. **Why it harms future change:** both gaps normalize the next, worse import: a future `import { something } from "@/popup/components/popups/X"` in onboarding or a services-tree helper that grows a `chrome.*`/client dependency would still pass lint, and the violation will be discovered only in review (or never). The map already mis-describes CapabilityDetailPanel as "importing services" — the ambiguity itself is the cost.
6. **Smallest safe refactoring:** Move Function — relocate `sanitizeWireString`/`stripWireControl` to `@/utils/` (pure, zero deps; `capability-meta` re-exports during transition), and Move File for PasskeyCeremonyDialog → `components/composite/` (it is service-free per L3 rules — verify; otherwise the flat components tier). Then add the missing `@/popup/components/popups/**` glob to the onboarding override so the rule matches its stated intent.
7. **What disappears:** the L3→services dependency edge, the onboarding→popup-internals edge, and the silent precedent for future boundary leaks; the biome config becomes congruent with the CLAUDE.md prose.
8. **Instances:** biome.json:296-314 (gap 1), biome.json:236-269 (gap 2 pattern list); onboarding/pages/import.vue:10; onboarding/pages/create.vue:8; components/ScopeAddress.vue:31; components/ScopeClassId.vue:15; components/composite/capabilities/CapabilityDetailPanel.vue:14; components/composite/DappIdentityBlock.vue:15.

## Non-findings

- **ScopeAddress vs ScopeClassId vs AddressDisplay (map family 8):** considered and rejected as a duplication finding — ScopeAddress/ScopeClassId carry explicit, security-load-bearing docstrings explaining why they must NOT share AddressDisplay's contact-resolution behavior (trust surface, class-id/contact collision). The ~40 shared lines (copy handler + row CSS) are below extraction value against the documented isolation rationale.
- **useFeeEstimation/useFeeEstimationMap as an API split:** the twin *interfaces* are deliberate and documented; only the twin *bodies* are flagged (F9).
- **`spec.ts`/`service.ts`/`client.ts` triple and the L0-L6 model:** house convention, excluded per prompt.
- **execute/index.vue `init()` switch (popup/windows/execute/index.vue:181-259):** three case-arms repeat the `getNetworkAndAccount` + push + accounts-dedup block (×3, :211-213/:232-234/:251-253). Considered; rejected as standalone — the discriminated mapper is the honest shape, the repeated fragment is ~6 lines, and extracting it buys little against the cast-heavy types. Borderline; revisit if a 4th account-bearing kind lands.
- **TransactionCardLayout/Awaiting/Terminal/Incoming card decomposition:** well-factored with documented rationale (byte-identical field positions); only the chip CSS leftovers flagged (F8).
- **SelectBalanceTypePopup hardcoded `defaultDisplayOptions`:** data table, single consumer — fine as-is.
- **account-state pages' missing data-testids (map note):** an e2e-convention gap, not a Fowler smell; no test currently depends on them.
- **`humanize.ts` first-underscore-only replace:** already pinned as a documented BUG PIN per house convention — working as intended for extraction fidelity.
- **NewNetworkPopup using `managers.network` while EditNetworkPopup uses `appStore.renameNetwork`:** two access idioms, but one call site each and no shared logic to extract; noted, not actionable as a smell.
- **`onboarding/import.vue` double `bootstrapActiveProfile` call:** counted as drift evidence inside F1 rather than its own finding (it's a consequence, not a separate root cause).

## Out-of-scope observations

- FormPopup passes its `displaceIdx` prop (raw `order` from all callers) to `PopupCard`, which interprets it as `len - order` displacement — FormPopup-based popups likely get wrong stack-displacement visuals when ≥2 popups are open (behavioral; components/composite/FormPopup.vue:21-22, components/Popup/PopupCard.vue:19-21).
- AddressDisplay.vue:61 uses the implicit global `event` (`event.stopPropagation()`) inside a handler that receives no event arg — deprecated global, would throw under strict module conditions (behavioral).
- AddressDisplay resolves contact name in `onMounted` only — stale display if `address` prop changes in-place (behavioral/reactivity).
- BalanceView.vue:270 ships a one-shot storage migration (`loadBalanceDisplayOptionMigration`) with a "Replace me ... at some point" note — per project memory, the wallet has no production users, so the migration could likely be deleted outright (product decision, not a smell ruling).
- NewContactPopup/EditContactPopup `processingError.tooltip` is assigned the raw error object (`tooltip: err`) and rendered via interpolation — renders as `[object Object]` for non-Error throws (behavioral).
- SelectProfilePopup `handleSelectProfile` writes `appStore.profile` directly without the session/unlock dance other profile-switch paths use — possible state-consistency concern (behavioral; not assessed).
- account-state/contracts search lowercases the term implicitly via `searchTerm.value?.toLowerCase()` but compares against raw `contract.includes(...)` — case-mismatch on mixed-case input (behavioral).
