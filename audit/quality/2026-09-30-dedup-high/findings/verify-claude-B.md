# Verification B (Q-06 to Q-10), Claude

Paths are relative to `apps/extension/src/` unless they start with `packages/` or `apps/`. All line numbers were opened in source on branch `dev`.

## Q-06 — confirmed (drift real but latent on the profile guard; one extra drift found)

**Independent conclusion (before reading the description).** Home (`RecentActivityView.vue` + `recent-activity-rows.ts`) and History (`pages/activity.vue` + `utils/activity-rows.ts`) each own a copy of the scope rules and of the card-field projection. The row-builder pairs are line-for-line siblings, including the duplicated sort-key comment. The card CSS is four copies of `.title_sep` and `.chip`, but the `.chip` copies are not all identical. The fix direction is sound.

**Corrected instances**
- (a) `utils/activity-rows.ts:79-88` (`txRows`) against `popup/components/modules/general/recent-activity-rows.ts:54-64` (`scopedTxRows`): identical bodies.
- (a) `utils/activity-rows.ts:104-121` (`incomingRows`) against `recent-activity-rows.ts:66-82` (`tokenScopedIncomingRows`): the same `blockTimestamp * 1000` sort-key block and comment.
- The inline copies of the profile predicate are at `popup/components/modules/general/RecentActivityView.vue:270` and `popup/components/modules/general/TokensView.vue:66`. Both re-spell `op.profileId && appStore.profile?.id && op.profileId !== appStore.profile.id`, which is `isForeignProfile` (`utils/activity-rows.ts:73`).
- (b) `RecentActivityView.vue:337-395` (`cardTitleFor`, `cardOriginLabelFor`, `cardIconFor`, `cardAmountFor`, `cardAmountSymbolFor`, `cardTransferTypeFor`) against `utils/journal-state.ts:380-420` (`transferCardFields`, `dappCardFields`). The orphan computeds at `RecentActivityView.vue:156-194` (`executingProgressTitle`, `executingAmount`, `executingAmountSymbol`, `executingOriginLabel`) are a third copy of the title and amount logic for the live task.
- (c) Dispatch ladders: `RecentActivityView.vue:852-865` and `popup/components/modules/activity/TransactionsList.vue:62-75`. The route templates `/popup/tx/`, `/popup/received/` and `/popup/journal/` are spelled in both.
- (d) CSS: `components/composite/activity/TransactionAwaitingCard.vue:130-152`, `TransactionTerminalCard.vue:84-105`, `TransactionIncomingCard.vue:77-95`, `popup/components/modules/activity/TransactionCard.vue:198-215`. `.title_sep` is byte-identical in all four.
- Not line-shifted or wrong; all listed ranges hold within a few lines.

**Drift evidence**
1. Profile guard on incoming rows. `recent-activity-rows.ts:73` has `if (isForeignProfile(scope.profileId, inc.profileId)) continue`. `activity-rows.ts:104-121` has no such line. It is latent today: both surfaces fetch through `useIncomingTransfers`, which calls `getIncomingTransfers(profileId, networkId, account)`, so the service already scopes by profile. The builder is meant as the second layer, and History lacks it. It is a defense-in-depth gap, not a current leak.
2. Network scoping on journal ops. Home's `journalRecordInScope` (`RecentActivityView.vue:264-278`) drops ops whose `networkId` differs from the active network. History's `journalRows` (`activity-rows.ts:91-102`) has no `networkId` check, so a terminal journal op from another network can render in History. Neither the finding nor the consolidated description mentions this; it is a stronger drift than item 1.
3. Amount gate. `cardAmountFor` (`RecentActivityView.vue:~376`) tests `op.amountRaw === undefined`. `transferCardFields` (`journal-state.ts:~370`) tests truthiness (`op.amountRaw && token`), and its comment says it exists to avoid a fake "0 USDC". An empty-string raw amount renders `0` in-flight and nothing once terminal.
4. CSS. `TransactionIncomingCard.vue` `.chip` is green (`var(--green, var(--nulo-accent))`) with `flex-shrink:0`/`nowrap`. `TransactionCard.vue` `.chip` has neither shrink nor nowrap and is secondary-coloured. So "four copies" is really `.title_sep` ×4 and `.chip` ×3 identical plus one deliberate green variant.

**Refined fix**
- Do the row scoping first. Export from `utils/activity-rows.ts`: `isForeignProfile` (already exported), `txInScope(tx, scope)` and `incomingInScope(inc, scope)` (with the profile guard). Export `incomingSortKey(inc)` and use it in both builders. Home keeps its own token filter.
- Give `journalRows` the `networkId` rule, or make it a deliberate, commented difference. Replace the two inline profile predicates with `isForeignProfile`.
- Export `buildJournalCardFields(op, ctx)` from `utils/journal-state.ts` (already the home of `transferCardFields`). Delete the six `cardXFor` functions and use the orphan computeds only for the live task (they read a different record, `executingTask`).
- Add a pure `activityRowRoute(row)` next to the row types. The `ActivityRow.vue` component is optional.
- The CSS is lowest value and needs a screenshot under the owner UI rule. The shared home is a CSS module with `composes`, as `components/composite/import/import-shared.module.css` already does.

**Effort.** 1–2 days. Row scoping and route helper about 3 hours; card-field unification about 3 hours; CSS with screenshot about 2 hours.

**Final confidence.** High.

**ELI5.** Two screens show the same list of past transactions, each with its own copy of the filtering rules, and one of them has already forgotten a rule the other follows.

## Q-07 — partially confirmed (a, b, c confirmed; d is weaker than stated)

**Independent conclusion.** The verify window carries a verbatim copy of `useDappHostname`, plus its own close-window and session-wait blocks. The other three windows already use the hook and composable. The failure-handling tails are shaped alike but are not all the same: `execute` differs on purpose.

**Corrected instances**
- (a) `popup/windows/verify/index.vue:52-67` against `composables/useDappHostname.ts:8-27`. The logic is identical today, character for character in the non-ASCII and `xn--` test. Callers of the composable: `discover/index.vue:53`, `capabilities/index.vue:121`, `execute/index.vue:134`.
- (b) `chrome.windows.getCurrent → remove` is four copies: `verify/index.vue:77-83`, `popup/windows/json/index.vue:16-21`, `popup/windows/logger/index.vue:12-17`, `composables/useDappApprovalWindow.ts:88-92`. They are not identical: `json` and `logger` call `getCurrent(cb)` without the `undefined` options argument and call `remove(window.id)` with no `window.id` guard. `verify` and the hook guard it. `onboarding/pages/done.vue:41` and `popup/pages/settings/appearance.vue:123` use `getCurrent` for a different purpose and are not instances.
- (c) `verify/index.vue:118-133` against `useDappApprovalWindow.ts:102-115`: the same `watch(isSessionChecked, immediate)` promise.
- (d) `getRequestId: () => router.currentRoute.value.query.requestId?.toString()` is at `discover/index.vue:49`, `capabilities/index.vue:117`, `execute/index.vue:130` (the finding's `:47`, `:115`, `:128` are off by 2). The approve-catch cancelled branch is identical in `discover/index.vue:110-117` and `capabilities/index.vue:328-335`. In `execute/index.vue:525-533` the `else` differs: it calls `setError("Processing error.", getErrorMessage(error))`, not `setError("Something went wrong")`. The init-catch (`setError("Something went wrong")`) is at `discover:90`, `capabilities:179`, `execute:265`.
- The reject handlers are not duplicates. `discover` and `execute` guard on `requestId`, `capabilities` does not, and `execute` first cancels fee estimates and authwit previews.

**Drift evidence**
- The failure text in the approve-catch differs: `execute` shows the error message with a different title, the other two show a generic one. Whether that is deliberate is undocumented.
- `json` and `logger` close the window unguarded while the other two guard `window.id`.
- The hostname copy has not drifted yet; the risk is one-sided, because a hardening edit (confusables, mixed script) made to the composable skips verify, the trust-confirmation screen.

**Refined fix**
- In `verify/index.vue`, use `const { hostname: dappHostname, isSuspicious: hostnameHasNonAscii } = useDappHostname(dapp)`. It is the single security-relevant change, about 15 lines deleted, and it keeps the template aliases. `composables/useDappHostname.ts` is the existing helper. Size: under 30 minutes.
- Add `closeCurrentWindow()` to `utils/` (guarded, with the `undefined` options argument). Use it in `verify`, `json`, `logger` and `useDappApprovalWindow.closeWindow`.
- Add `whenSessionChecked(appStore)` in `composables/` (C0, no service clients) for `verify` and `useDappApprovalWindow.start`.
- Make `getRequestId` default to the route's `requestId` in `composables/useDappInteractionPayload.ts`. Keep the option for overrides.
- Skip the `classifyApprovalFailure` extraction unless the owner decides `execute`'s different title is drift: it would force either a parameter or a silent copy change. If done, export only the `JobCancelledError` test.

**Effort.** 0.5 day (a–c plus `getRequestId`); another 2 hours if (d) proceeds.

**Final confidence.** High for (a–c). Moderate for (d), because the copies are only half the same.

**ELI5.** The one screen that asks you to trust a website has its own private copy of the "does this web address look fake?" check, so a fix to the shared check would quietly miss it.

## Q-08 — confirmed (and drift is worse than the finding says)

**Independent conclusion.** Eight near-identical show/hide buttons, four new-password plus confirm pairs, and seven byte-identical `shakeInput` keyframes exist. The shared import stylesheet already exists but two of the five `.visibility_btn` copies still redefine it locally.

**Corrected instances**
- (a) Toggle button with `tabindex="-1"` and `visibility`/`visibility_off` icon (8 sites, counted with `git grep`): `components/composite/import/ImportSecretForm.vue:41-55, 77-91`; `components/composite/import/ImportFullBackupForm.vue:112-126, 140-154`; `popup/components/modules/settings/new-profile/NewProfileCredentials.vue:24-42`; `popup/pages/auth.vue:255-276`; `popup/pages/settings/security/change-password.vue:128-145, 170-185`. The CSS `.visibility_btn` is in all five files (`ImportSecretForm.vue:145-153`, `ImportFullBackupForm.vue:189-197`, `NewProfileCredentials.vue:~80`, `auth.vue:392-402`, `change-password.vue:266-274`), with the same declarations.
- (b) Pairs: `ImportSecretForm.vue:66-108`, `ImportFullBackupForm.vue:130-173`, `NewProfileCredentials.vue:18-59`, `change-password.vue:158-202`.
- (c) `@keyframes shakeInput` (seven byte-identical blocks): `components/composite/SecretUnlockSection.vue:65`, `onboarding/components/OnboardingProfileNameField.vue:45`, `popup/pages/auth.vue:439`, `popup/pages/import.vue:352`, `popup/pages/profile/new.vue:180`, `popup/pages/settings/security/change-password.vue:288`, `popup/pages/settings/security/export/full.vue:723`. The variant `@keyframes shake` in `popup/components/popups/NewSenderPopup.vue:179` has different steps and 0.5s. Durations: 0.3s in `SecretUnlockSection`, `auth`, `change-password`, `export/full`; 0.4s in `OnboardingProfileNameField`, `import`, `profile/new`.

**Drift evidence**
- `autocomplete="new-password"` is present on the new and repeat fields in `ImportSecretForm.vue:76,106` and `change-password.vue:168,200`. It is missing in `ImportFullBackupForm.vue:130-173` and `NewProfileCredentials.vue:18-59`. Browsers may autofill a saved password into a new-password field there. This is a security-relevant inconsistency in the most sensitive screens, and the finding does not mention it.
- `NewProfileCredentials` also has no `@input` handler on its fields and uses different labels ("Strong password" / `strengthHint`) against "Enter new password" / `passwordHint`; some of that may be intentional.
- Shake duration 0.3s vs 0.4s with no rationale.

**Refined fix**
- Put the toggle in `components/composite/PasswordVisibilityToggle.vue` (L3) with `v-model:visible`, because `NewProfileCredentials` and `change-password` share one state across fields. Labels stay per call site (`ImportSecretForm` uses "recovery phrase"). Keep `tabindex="-1"` hard-coded inside it: that makes the owner-accepted tradeoff in CLAUDE.md a single place.
- Shared CSS: put `.visibility_btn`, and a `.shake` with its keyframes, in a CSS module consumed by `composes` (as `import-shared.module.css` already is). Do not put `@keyframes` in `packages/design/src/base.css`: it is hand-authored but hash-pinned by `base.css.test.ts` and shared with the tools app. In a `<style module>` file `animation: shakeInput` is localized, so a global keyframe would need `:global(...)`; `composes` avoids that.
- Unify the duration and add `prefers-reduced-motion` only with owner sign-off, because both change what a user sees. The finding's "no visual change intended" does not hold for those two.
- Then `NewPasswordFields.vue` for the pair, with `autocomplete="new-password"` applied to both fields (a behaviour fix, to be mentioned in the PR).

**Effort.** About 1 day.

**Final confidence.** High.

**ELI5.** Every password box in the wallet carries its own pasted copy of the eye button and shake effect, so fixing one has already left two password screens without the browser's "this is a new password" hint.

## Q-09 — confirmed (extraction target needs adjusting; two bugs found)

**Independent conclusion.** Nine files re-implement add/update/remove list reduction, with visible drift in behaviour. `useEntityCrud` already has the right rules, but it fetches eagerly and `dispose()` is permanent, so show/hide popups that connect on `show` cannot just adopt it.

**Corrected instances**
- Contact add/update/delete handlers: `popup/components/popups/NewContactPopup.vue:29-51`, `EditContactPopup.vue:29-62`, `ImportContactsPopup.vue:30-49`, `popup/pages/send.vue:192-212`. The four "plain" copies use the same three-function shape; `send.vue`, `NewContact` and `ImportContacts` are byte-identical.
- FPC: `NewFpcPopup.vue:89-99`, `EditFpcPopup.vue:136-153`.
- Other entity types: `SelectProfilePopup.vue:77-91`, `SelectTokenPopup.vue:77-89` (token-balance rows with an `inActiveScope` filter), `popup/pages/settings/connected-apps/index.vue:54-73` (session rows, with logo hydration).
- Not an instance: `ImportContactsPopup.vue`'s live `contacts` mutations feed nothing, since `contactsByName`/`contactsByAddress` are built once in the `props.show` watcher (`:94-117`); the handlers are effectively dead there.
- Consumers that already use `useEntityCrud`: `pages/holdings.vue`, `pages/settings/contacts/index.vue`, `settings/fpcs/index.vue`, `settings/tokens/index.vue`, advanced `senders` and `authwits`.

**Drift evidence**
- `useEntityCrud.ts:104-117` deduplicates a repeated `added` (treated as an update). `NewContactPopup.vue:29-31`, `EditContactPopup.vue:~30`, `ImportContactsPopup.vue:~33`, `send.vue:~196` push unconditionally, so a re-emitted contact (reconnect) duplicates. `SelectTokenPopup.vue:79` guards with `.some(...)`.
- Update semantics differ three ways: upsert (contacts, sessions), replace-only with `return` on a miss (`NewFpcPopup`), and splice on delete (`SelectProfilePopup`). `EditContactPopup` and `EditFpcPopup` add "edited entity changed externally" branches the others lack.
- Contact uniqueness: `NewContactPopup.vue:~60` compares `c.name === v` while it saves `nameTerm.value.trim()` (`:~105`); `EditContactPopup.vue:~73` does the same. A name typed with a trailing space bypasses the "Already exist" check and is then saved trimmed as a duplicate. Both copies share the bug, and the finding's proposed `findConflictingContact` is the natural place to fix it. Address comparison is lowercased in both.
- `"Already exist"` is used as a magic flag in both form files.

**Refined fix**
- Add `utils/entity-list.ts` with `upsertById`, `replaceById`, `removeById` (pure, array in, array out), and use them inside `useEntityCrud.ts:104-140` so one implementation backs both. The finding's target is correct; no helper with this job exists yet (`git grep` for `upsertBy|removeBy` finds nothing).
- Add `findConflictingContact(contacts, {name, address}, excludeId)` and `canonicalContactAddress()` in `utils/`, trim the name in the comparison, and return a typed result instead of the string flag. The import popup's two-key rule stays as written.
- Convert the plain contact copies first (four files); the FPC, profile, token and sessions ones carry their own rules and can follow or stay.

**Effort.** About 1 day.

**Final confidence.** High.

**ELI5.** Ten screens each keep their own copy of "when the list changes, update what I'm showing", and the copies already disagree about what a repeated add means.

## Q-10 — confirmed

**Independent conclusion.** `addTransaction` takes 12 positional arguments, many of them same-typed strings. It has three producers, two of which re-spell the same recorder with small differences. The tails between the two dApp-send arms are duplicated.

**Corrected instances**
- Declaration: `wallet/services/transaction/service.ts:155-170` (12 parameters; only `origin`, `chainId`, `account`, `calls`, `nonce`, `feePaymentMethod`, `hash`, `submittedEndpointUrl` are required).
- Producers: `wallet/services/execution/transfer-executor.ts:182-214` (inline closure); `wallet/services/execution/dapp-send-executor.ts:528-541` (`sentTxRecorder`); `dapp-send-executor.ts:919-932` (NO_FROM, inline). `AddTransactionArgs[0|3|5|11]` projections: `dapp-send-executor.ts:125-138` (the `SentTx` interface). Two test callers also use the positional form: `transaction/service.test.ts:68`, `transaction/service.dropped.test.ts:106`.
- Tails, verified and identical in text: `getCalls` thunk at `dapp-send-executor.ts:677-683` and `:874-880`; `wantOffchainOutput` at `:736-739` and `:914-917`; `NO_WAIT` return at `:754` and `:935`; `checkCancelled` (signal form) at `:255, :295, :369` and `transfer-executor.ts:350-352`. The `checkCancelled` at `:250-256` uses a `controller` and differs.

**Drift evidence**
- NO_FROM vs standard send: nonce `Fr.ZERO.toString()` vs `sent.nonce.toString()`; payment method `EXTERNAL` vs the built one; endpoint `submittedEndpointUrl` vs `primaryEndpointUrl(network)`; no authwit write. All four are plausible intentional differences; none is documented at the site.
- `networkId`: transfer passes `network.id`, dApp arms pass `op.networkId`.

**Refined fix**
- Use a parameter object for `addTransaction` (type beside `Tx` in `wallet/services/transaction/spec.ts`), and build `SentTx` from `Pick<…>` of it. Do this first: it removes the same-type swap risk and the four index projections. Update the two test call sites in the same PR.
- Extend `sentTxRecorder` with `{ nonce?, feePaymentMethod?, recordAuthwits }` for NO_FROM rather than keeping a second inline copy.
- Module-level helpers inside `dapp-send-executor.ts`: `primaryMethodCalls(op)` (wrapping the existing `pickPrimaryMethod`), `offchainOutputOf(provedTx)` (wrapping `extractOffchainOutput`), and a `sendReturnTail`.
- `throwIfAborted(signal)` in `wallet/services/execution/` for the four signal closures, with the controller one left alone.

**Effort.** 0.5–1 day.

**Final confidence.** High.

**ELI5.** Recording a sent transaction means remembering 12 details in an exact order, and three places each re-type that list, so a swapped pair would compile and quietly record the wrong fee or nonce.
