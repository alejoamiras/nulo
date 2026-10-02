# q06-popup-popups-windows — claude

Scope read: `apps/extension/src/popup/components/popups/` (PopupManager, New/Edit/ImportContacts, ConfirmPopup, IncomingTrust, SelectNetworks, Change/RevokeAuthwits, New/Edit Account/Sender/Fpc/Endpoint heads, popup-shared.module.css, CSS tails of Confirm/IncomingTrust/SelectProfile); `apps/extension/src/popup/windows/` (discover, capabilities, verify, json, logger, passkey head, execute/index.vue 1-600, CallArguments/OperationCard CSS tails, window-shell.module.css). Handoff edges read: `composables/useEntityCrud.ts`, `usePopupEntity.ts`, `useDappApprovalWindow.ts`, `useDappHostname.ts`, `stores/popup.store.ts`, `popup/pages/send.vue:180-215`, `popup/pages/settings/contacts/index.vue:30-60`. Git counts are total/since 2026-06-01 (all history is since June, so they are equal).

## q06-popup-popups-windows-C-1: Contact/FPC popups hand-roll the add/update/delete list mirror that `useEntityCrud` already provides — RECURRING (prior: 2026-08-16 Q-07, UI-popups half)

- **Smell:** Duplicate Code (incomplete adoption of an existing extraction); Shotgun Surgery on the splice protocol.
- **Maintenance impact:** structural; blast radius 6 files; change frequency high (EditContact 9, NewContact 8, Import 6, send.vue active).
- **Evidence:** the same three handlers (`onXAdded` push, `onXUpdated` findIndex-replace-else-push, `onXDeleted` filter) plus the three `service.onX.add(...)` registrations are copied verbatim in:
  - `popup/components/popups/NewContactPopup.vue:29-51`
  - `popup/components/popups/EditContactPopup.vue:29-59` (same, plus a draft-refresh branch)
  - `popup/components/popups/ImportContactsPopup.vue:31-49`
  - `popup/pages/send.vue:192-212`
  - `popup/components/popups/NewFpcPopup.vue:89-98` (and registration at 106-108)
  - `popup/components/popups/EditFpcPopup.vue:136-146`
  The canonical form exists (`composables/useEntityCrud.ts`, used by `settings/contacts/index.vue:43` in `resync` mode, plus holdings, authwits, senders, fpcs, tokens). The contacts list page that sits next to these popups uses `mode: "resync"` with a sequence guard; the popups use the naive splice with none.
- **Why it harms future change:** a change to the event contract (payload shape, identity key, a scope filter like the `accept` option that `useEntityCrud` already has) lands in the six-file copy set by hand. The list page and the popups already disagree about consistency mode, so a bug fixed in one view persists in the others.
- **Smallest safe refactoring:** Replace the hand-rolled handlers with `useEntityCrud({ fetch, added, updated, deleted })` (incremental mode) in the four contact sites and two FPC popups. The Edit popups keep their draft-refresh branch as a `watch` on the returned `entities`. The popups gate fetch on `show`, so call `refresh()` from `onShow` and `dispose()` from `onHide`. No new package; the composable is already C1 in `src/composables`.
- **What disappears:** about 6 × 18 = ~100 lines and 18 listener registrations.
- **Instances:** listed above.

## q06-popup-popups-windows-C-2: New/Edit/Import contact flows each re-encode the contact uniqueness rule, canonical-lowercase rule and submit-gate

- **Smell:** Duplicate Code → Shotgun Surgery (one business rule, three-plus copies).
- **Maintenance impact:** structural-local; blast radius 3 popups plus `send.vue`; high change frequency (see C-1).
- **Evidence:** all sites contain the same logic, each in its own shape:
  - Name/address validators ("Already exist" by name; hex check; case-insensitive address dup): `NewContactPopup.vue:53-73` and `EditContactPopup.vue:66-92`. They differ only by `&& c.id !== contactToEdit.value?.id`.
  - The same dup detection done a third way with Maps: `ImportContactsPopup.vue:94-117` (`contactsByName` / `contactsByAddress`, `toLowerCase()`).
  - The derived flags (`isAlreadyExistName`, `isValidAddress`, `isAlreadyExistAddress`, `isAvailableTo{Add,Update}Contact` latch ladder of 5 guards) at `New:75-92` vs `Edit:100-119`.
  - `processingError` shape and the "Already exist" string compare (`error.value === "Already exist"`, a magic string used as a flag) at `New:94-99` vs `Edit:121-126`.
  - Canonical `toLowerCase()` on save, re-stated in a comment at each write: `New:~106`, `Edit:144`, `Edit:153`.
- **Why it harms future change:** a change to what counts as the same contact (e.g. normalizing checksummed/0x-stripped addresses, ignoring name whitespace) must be made in three differently-shaped implementations. Import's Map form cannot be grepped from the validator form, so one is easy to miss. The error string doubling as a boolean flag breaks silently if either copy is reworded.
- **Smallest safe refactoring:** Extract Composable `useContactForm({ contacts, excludeId })` in `src/composables/` (C1, receives the list; no service client), returning `{ form, nameTerm, addressTerm, nameExists, addressExists, addressValid, canSubmit }`, plus a pure `canonicalContactAddress()` / `findConflictingContact(contacts, {name,address}, excludeId)` helper in `src/utils/` that Import also calls. The error becomes a typed constant or a boolean from the validator.
- **What disappears:** ~60 lines across New/Edit and the Map build in Import; the magic string.
- **Instances:** `NewContactPopup.vue:53-99`, `EditContactPopup.vue:66-126`, `ImportContactsPopup.vue:94-117`, and the canonical-lowercase writes at `EditContactPopup.vue:144,153`.

## q06-popup-popups-windows-C-3: The popup key is written four times per popup (manager ×3, popup ×2): Shotgun Surgery on the registry

- **Smell:** Shotgun Surgery / Primitive Obsession (a stringly-typed key repeated as magic strings with no single definition).
- **Maintenance impact:** structural; blast radius 25 files (PopupManager + 24 popups, 51 `popups.<key>?.order` reads); change frequency: popups dir 47 commits since 06-01.
- **Evidence:** `PopupManager.vue:316-354` writes `isOpened('k')` and `close('k')` per popup. Each popup then re-declares the same key to compute its own stacking offset: `const displaceIdx = computed(() => popupStore.len - popupStore.popups.<k>?.order)`. This exists in 24 files (e.g. `ConfirmPopup.vue:30`, `NewContactPopup.vue:23`, `RevokeAuthwitsPopup.vue`), and every one of them reads `popupStore.popups.<k>?.order` a second time in its template (`ConfirmPopup.vue:87`, `NewContactPopup.vue:163`, FormPopup/Popup `:displaceIdx`). The offset arithmetic `len - order` is identical in all 24.
- **Why it harms future change:** renaming a popup key, or changing the stack-offset rule (for instance, the gap-free order invariant in `popup.store.ts:27`), requires edits in 25 files. A typo in one template key yields `undefined` and the popup silently stacks at the wrong depth, because the read is optional-chained and untyped.
- **Smallest safe refactoring:** Move Function to the owner of the key. Have PopupManager (which already knows each key) `provide` the displacement for the popup it mounts, or add `popupStore.displaceIdx(key)` and a one-line `useDisplaceIdx("new_contact")` composable. The preferred shape is to pass `:displaceIdx` from the manager as a prop and delete the per-popup computed plus the duplicated `?.order` template bindings. The manager is the L5 registry, so the layer rules hold.
- **What disappears:** 24 computeds, ~48 key-literal reads, the `popupStore` import in popups that use it only for this.
- **Instances:** `grep -n "popupStore.len - popupStore.popups" popup/components/popups/*.vue` (24 files); `PopupManager.vue:316-354`.

## q06-popup-popups-windows-C-4: `windows/verify` re-implements three things `useDappHostname`/`useDappApprovalWindow` already own; `json` and `logger` copy a fourth

- **Smell:** Duplicate Code (shared helper exists, the outlier window bypasses it).
- **Maintenance impact:** structural; blast radius 4 windows (all dApp-facing or lock-handling); change frequency verify 7, execute 19, capabilities 14.
- **Evidence:**
  - Anti-phishing hostname + IDN/punycode detector: `verify/index.vue:44-57` is byte-equivalent to `composables/useDappHostname.ts:9-27`. It is the same security-sensitive predicate, and the other three windows call the composable (`discover:53`, `capabilities:121`, `execute:134`).
  - `closeWindow` (`chrome.windows.getCurrent` → `remove(id)`): `verify/index.vue:77-83` vs `composables/useDappApprovalWindow.ts:88-92`, plus `json/index.vue:16-21` and `logger/index.vue:12-17` (the latter two are the "profile went null, close the window" handler, identical in both).
  - The "wait for `appStore.isSessionChecked`" watch-once promise: `verify/index.vue:118-133` vs `useDappApprovalWindow.ts:102-115`.
- **Why it harms future change:** a hardening of the hostname check (e.g. mixed-script or confusable detection, which the code comments elsewhere show is a live concern) lands in `useDappHostname` and leaves the verify window, the trust-confirmation screen, on the old rule. Four hand-written `getCurrent→remove` blocks mean a MV3/Firefox window-API quirk (the repo already has a `BrowserDriver` difference doc for this) is fixed in one place.
- **Smallest safe refactoring:** (a) Replace `verify`'s `dappHostname`/`hostnameHasNonAscii` with `useDappHostname(dapp)`. (b) Extract `closeCurrentWindow()` into `src/utils/` (plain function, no Vue), and call it from `useDappApprovalWindow`, verify, json and logger. (c) Extract `whenSessionChecked(appStore)` into a C0 helper shared by verify and the hook. Verify stays outside the full approval hook, which is correct since it has no interaction payload.
- **What disappears:** ~14 lines (hostname), ~20 (close ×3), ~15 (session wait); one security predicate instead of two.
- **Instances:** `verify/index.vue:44-57,77-83,118-133`, `json/index.vue:16-21`, `logger/index.vue:12-17`, `useDappApprovalWindow.ts:88-92,102-115`, `useDappHostname.ts:9-27`.

## q06-popup-popups-windows-C-5: The three approval windows each re-wire the same composable quartet and repeat the approve-failure/reject tail

- **Smell:** Duplicate Code → Shotgun Surgery (the lifecycle half was extracted, the wiring and outcome-handling half was not).
- **Maintenance impact:** structural; blast radius 3 windows (discover, capabilities, execute), the most actively changed files in the cluster (execute 19, capabilities 14, discover 6 commits); matches jscpd leads (22/20-line clones across capabilities, discover, execute).
- **Evidence:**
  - Approve catch ladder, identical in meaning each time: `error instanceof JobCancelledError` → `isInteractionCancelled.value = true` (same explanatory comment), else `console.error(getErrorData(error)); setError("Something went wrong")`. Found at `discover/index.vue:108-117`, `capabilities/index.vue:326-337`, `execute/index.vue:523-534` (the last uses `getErrorMessage`, a minor variant).
  - `reject` twin: guard `isInteractionCancelled`, `rejectViaInteractionService("User rejected")`, `closeWindow(true)`: `discover:121-125`, `capabilities:344-348`, `execute:539-548` (execute adds two cancel calls).
  - Setup quartet, same 4 calls in the same order: `useDappInteractionPayload({ interactionService, getRequestId: () => router.currentRoute.value.query.requestId?.toString(), dappOf })` (`discover:47`, `capabilities:115`, `execute:128`), then `useDappHostname(dapp)`, then `useDappApprovalWindow({ profile, isInteractionCancelled, isLoading, connectServices, disconnectServices, init: () => init(), reject: () => reject() })`, then `profileService.onActiveProfileChanged.add(...)`, `onMounted(startWindow)`, `onUnmounted(disposeWindow)` (`discover:128-132`, `capabilities:367-371`, `execute:597-611`). Also the repeated `getRequestId` router-query lambda.
  - `init` catch tail: `console.error(...)` + `setError("Something went wrong")` (`discover:88-90`, `capabilities:~180`, `execute:~290`).
- **Why it harms future change:** adding a new terminal state (e.g. `SessionExpiredError`, or a change to how a raced cancel renders) must be done in three places, in the path where a missed copy shows the user an error banner instead of the cancelled overlay. The hook's header says it owns "completion semantics", yet failure semantics live outside it.
- **Smallest safe refactoring:** Extract Function inside `useDappApprovalWindow`: return `runApproval(fn)` (sets `isLoading`, catches `JobCancelledError` → cancelled overlay, else `setError`; returns normally) and `rejectWith(service, message)`. Move the `getRequestId` query read into `useDappInteractionPayload` as the default. Keep window-specific guards (`isReady`, `initComplete`, `noAccountsAvailable`) in the windows. Layer rule: it is a C1 composable receiving the service, so no new coupling.
- **What disappears:** ~3 × 12 lines of catch ladders, ~3 × 6 of reject, the router lambda ×3.
- **Instances:** listed above.

## q06-popup-popups-windows-C-6: `PopupManager` hosts the incoming-trust queue and repeats the live-triple identity check five times

- **Smell:** Large Class / Divergent Change (a popup registry that also owns an event-driven queue, a replay scheduler and a config-toggle state machine) with a Duplicate Code core (the `(profile, network, account)` comparison).
- **Maintenance impact:** structural; blast radius 1 file, but it is mounted on every popup open; change frequency 6.
- **Evidence:** `PopupManager.vue` (355 lines, 27 of them template) contains: the trust queue and dedup (`tripleKeyOf`, `enqueueIfNew`, `dequeueNextPendingTrust`, `purgeTripleFromQueue`, lines 55-150); the replay scheduler (`tryReplayForTriple`, 172-186); a config-toggle state machine (`lastVisibility`, `visibilityInitialized`, 222-250); and teardown. The live-triple comparison is spelled out in `payloadMatchesLiveTriple` (76-78), again as three early-returns in `onIncomingTransferPending` (114-116), again inline in the identity-switch watcher (208-210), and as an all-present guard at 174-177 and 245. Comments carry workflow tags (`P8 tactical C2 fix`, `P6`, `opus H-6`), which CLAUDE.md's comment rule bans.
- **Why it harms future change:** changing the trust scope (say, adding `chainId`, or dropping account-scoping) means editing five sites in a file whose job is to map keys to components. Every unrelated popup registration edit sits in the same diff as queue logic.
- **Smallest safe refactoring:** Extract Composable `useIncomingTrustPrompts()` in `src/composables/` (C1; owns the client, receives nothing else, exposes `dispose()` that PopupManager calls, per the CLAUDE.md convention) with one `isLiveTriple(p)` helper used by all five sites. PopupManager keeps only the registry template. Strip the phase tags.
- **What disappears:** ~200 lines from PopupManager (moved, not deleted) and 4 of the 5 triple comparisons.
- **Instances:** `PopupManager.vue:55-150,172-186,190-215,222-250,76-78,114-116,208-210`.

## q06-popup-popups-windows-C-7: `popup-shared.module.css` exists but `.wrapper` (×16) and the heading `.title` (×4) are still re-declared per popup

- **Smell:** Duplicate Code encoding a shared visual component (popup body padding and popup title type); Shotgun Surgery on restyle.
- **Maintenance impact:** local each, structural in aggregate (restyle touches 16 files); low change frequency but every popup is affected by any design-token change.
- **Evidence:** `.wrapper { padding: 0 20px 24px 20px }` declared in 16 files (`ForgotPasswordPopup:68`, `ImportContactsPopup:257`, `ConfirmPopup:166`, `AccountsPopup:127`, `IncomingTrustPopup:222`, `DataViewerPopup:47`, `NewSenderPopup:172`, `ChangeAuthwitsRegistryPopup:151`, `EditProfilePopup:184`, `SelectNetworksPopup:97`, `SelectFpcPopup:192`, `ReceivePopup:87`, `SelectTokenPopup:206`, `SelectProfilePopup:158`, `TokenMetadataPopup:164`, `RevokeAuthwitsPopup:278`). The 9-line headline `.title` (font-family/size 16px/700/0.08em/uppercase/center/primary/margin 0) is identical in `ConfirmPopup:189`, `IncomingTrustPopup:231`, `SelectProfilePopup:167`, `ImportContactsPopup:301`. `popup-shared.module.css` already holds `header`, `pre_title` and `select_row`, and only Confirm, Import, IncomingTrust, SelectFpc and SelectNetworks compose from it. This matches the jscpd CSS leads (Confirm vs IncomingTrust 18 lines, Confirm vs SelectProfile 13).
- **Why it harms future change:** a padding or title-type change has to be replicated across 16 or 4 files; today drift is already possible (SelectProfile's `.header` differs from shared).
- **Smallest safe refactoring:** Move the two rules into `popup-shared.module.css` and `composes:` them (or move the wrapper padding into `PopupCard` as a slot default). Mechanical.
- **What disappears:** ~16 × 3 + 4 × 9 = ~85 CSS lines.
- **Instances:** listed above.

## q06-popup-popups-windows-C-8: Two identical `case` bodies in `buildOperationsFromPayload`

- **Smell:** Duplicate Code (Consolidate Duplicate Conditional Fragments).
- **Maintenance impact:** local; execute/index.vue is the most-changed file in the cluster (19 commits); also matches a jscpd lead (18-line clone).
- **Evidence:** `execute/index.vue:331-348` (`aztec_sendTx`) and `349-365` (`send_transaction`) build the identical object (`network`, `networkId`, `account`, `accountAddress`, `feeSettings: isEmbeddedFeePayment(op) ? { paymentMethod: { kind: "embedded" } } : undefined`) then `pushUniqueAccount`. They differ only in the comment text.
- **Why it harms future change:** adding a field to the send-like draft (a new fee-path default) must be made in both branches; the next send-like kind will be copied a third time.
- **Smallest safe refactoring:** Fall-through: `case "aztec_sendTx": case "send_transaction": {…}`. TypeScript's narrowing on `op` still holds because both are already arms of the same union passed to `isEmbeddedFeePayment`.
- **What disappears:** ~17 lines, one branch.
- **Instances:** `execute/index.vue:331-348,349-365`.

## Non-findings considered

- ConfirmPopup vs ImportContacts / IncomingTrust / SelectNetworks jscpd javascript clones (10-30 lines): shared import block and `emit`/`props`/`vSnackFooter`/store preamble, which is the documented SFC ordering convention. The real cost (the `displaceIdx` line) is C-3.
- ChangeAuthwitsRegistry vs RevokeAuthwits (jscpd 18/13 lines): the shared part is a 6-line `useAuthRegistryStatus` call with an identical scope getter plus the imports. Two copies, no shared bug history, flows diverge. Not worth a helper; revisit if a third registry popup arrives.
- New/Edit pair as a single CRUD component: the 2026-08-14 audit already rejected this (conditional configuration instead of stable duplicate). C-1 and C-2 extract the truly shared parts only.
- CallArguments vs OperationCard CSS (19 lines): the `.toggle`/`.chevron`/`.chevron_open`/`.prop` blocks are copies, but CallArguments is a child used by OperationCard; a shared module is plausible but it is a scoped-CSS clone of ~25 lines in two files of one feature, with no shared-restyle scenario beyond the chevron. Borderline; left out.
- ContactRow vs AccountSelectRow CSS and RecipientField vs SelectFpcPopup CSS: cross-cluster lookalikes (row chrome), not a demonstrated must-change-together pair.
- `usePopupEntity` consumption: prior Q-07's Enter-guard half is fixed (most popups now use it); the remaining non-users (Confirm, Accounts, Receive, Select*, TokenMetadata) have no submit path.
- `execute/index.vue` two `useFeeEstimationMap` setups: parallel by design, each differs in arguments and debounce; the composable is the extraction.
- capabilities/index.vue, execute/index.vue, OperationCard.vue complexity and length: size alone, no duplication; accepted-directive territory.
- passkey window "PATH B, no production callers": documented as preserved for future use; dead-code claim not made since `WindowManager.openAndAwait` registration was not traced within the context cap.
- `DappStatusStrip` vs `SignerIdentityStrip` vs verify's strip (prior 2026-08-14 Q-08): verify now uses `IdentityStrip`; the remaining `SignerIdentityStrip` fork is outside the cluster scan depth and not re-derived.

## Incidental bugs noticed (for the bugs run)

- `popup/components/popups/RevokeAuthwitsPopup.vue:60` — `chunkAuthwits` initializes the chunk with `feeSetting: null` (singular) while every reader uses `feeSettings` (`:66`, `:103`, template `:211`). Harmless today only because `undefined` and `null` are both falsy. A reader that tests `=== null` (or `"feeSettings" in ch`) would misbehave; it is a typo-shaped latent defect, not a demonstrated wrong result.

## Cross-rebuttal (claude on codex)

**1. Codex findings**
- **X-1 (keyed-list reducers, 9 consumers): partially agree.** It is the same smell as my C-1, and the three contact popups plus send.vue are identical. The SelectFpc/SelectProfile/SelectToken instances differ in policy. `SelectFpcPopup.vue:81-91` is update-only with `prepareFpc`, and `useEntityCrud.ts:104-140` has `accept`/`resync` semantics. Codex's proposed `utils/entity-list.ts` is the cheaper extraction and I endorse it over adopting `useEntityCrud` wholesale. "Nine consumers" overstates how much is mechanical. Three or four collapse cleanly, the rest keep their policy.
- **X-2 (verify re-implements `useDappHostname`): agree.** Same as my C-4 first bullet. Codex is narrower: it omits the `closeWindow` twins in verify, json and logger.
- **X-3 (endpoint error ladder): agree.** Verified at `NewEndpointPopup.vue:54-63` and `EditEndpointPopup.vue:69-78`. The branches and strings match except the duplicate-endpoint copy. The refactor is small and safe. I missed this one.
- **X-4 (identical send cases): agree.** Same as my C-8.
- **X-5 (disclosure toggle in CallArguments/OperationCard): agree, but it is a low-value CSS/markup clone.** It is 19 lines of CSS plus a button, in a UI-sign-off-sensitive surface. Any extraction must be pixel-identical, and CLAUDE.md requires the owner to see it.
- **X-6 (name/address typography in ContactRow and AccountSelectRow): partially disagree.** Codex rates it moderate, and I would drop it to low. It is two CSS blocks, which is a token-level coincidence. A shared style module across modules/ and windows/ adds coupling for about 20 lines.
- **Codex's non-findings** (setup clones, passkey window kept) are sound. I agree the passkey window is a registered route, so it is not dead.

**2. Codex missed (I still stand by these)**
- **C-2:** the contact uniqueness, lowercase and submit-gate rules are re-encoded in New, Edit and Import, including the `"Already exist"` magic-string flag. Codex's non-finding about "setup clones" does not cover the business rule.
- **C-3:** the popup key is written four times per popup (PopupManager ×3, plus the popup's own `displaceIdx`). This is Shotgun Surgery on the registry.
- **C-5:** the approve/reject/init-catch tails repeat across discover, capabilities and execute. Codex treated these as "wiring", but the reject and catch tails are real logic.
- **C-6:** PopupManager hosts the trust queue and repeats the live-triple check five times. This is a Large Class smell and is not dedup.
- **C-7:** `.wrapper` is declared in 16 files even though `popup-shared.module.css` exists. The count is verifiable.

**3. Both missed**
- **Dead popup (Speculative Generality / dead code):** `select_fpc` has no opener. `grep select_fpc` outside PopupManager and SelectFpcPopup itself returns nothing, but `PopupManager.vue:342` still mounts `SelectFpcPopup.vue`. The mount means it is connected on every popup host, and Codex's incidental bug (the double `FpcServiceClient`) is reachable only through code nothing calls. Deleting the popup and its registry row removes about 150 lines and that latent bug. Codex noted the missing caller but did not make this a finding. I never flagged it.
- **Mirror handler in SelectFpc:** `prepareFpc` (`SelectFpcPopup.vue:76-80`) re-derives `typeName` from `FpcType`. If another site does the same, that is a Duplicate Code candidate. I did not check other sites, so this is unverified.
