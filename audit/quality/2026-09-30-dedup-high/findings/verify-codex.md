## Q-01 — confirmed

**Independent conclusion:** The duplication is real, but comprises separate chain-ID, `ChainInfo`, and sender-normalization rules. Session-account sets are not interchangeable.

**Corrected instances:**

- Composite formula: `apps/extension/src/utils/chain-ids.ts:12`; `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:101`; `packages/aztec-runtime/src/utils/chain-identity.ts:59`; `apps/extension/src/wallet/services/network/service.ts:1010`; `apps/extension/src/wallet/services/wallet-sdk/session-established.ts:16`; `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:51`.
- Ten `ChainInfo` literals under `apps/extension/src/wallet/services/execution/`: `authwit-discoverer.ts:119,174,224,238`; `discovery-probe.ts:79`; `dapp-send-executor.ts:1005`; `view-executor.ts:213`; `fast-path.ts:227`; `service.ts:1020`; `helpers/batched-view-simulation.ts:362`.
- Sender normalization: `packages/wallet-bridge/src/dispatcher.ts:192` and `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:84`. The narrower sentinel predicate is duplicated at `dispatcher.ts:185` and `apps/extension/src/wallet/services/execution/utils/fee-detection.ts:18`.
- Keep distinct: `packages/wallet-bridge/src/dispatcher.ts:439` accepts raw and CAIP representations; `:1730` extracts addresses for one chain; `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:143` extracts addresses without chain filtering.
- Correction: `network/service.ts:24` imports and **uses constants** from `chain-ids`; it does not import `walletChainId`.

**Drift evidence:** No disagreement in the XOR formula or sender normalization. The session-set difference is observable, but does not establish a reachable authorization bug. Another stale statement exists: `authwit-discoverer.ts:117` calls the local-chain assertion a no-op, whereas `chain-identity.ts:53` checks L1 identity before the local return at `:58`.

**Refined fix:** Reuse [`chainInfoFrom`](packages/aztec-runtime/src/utils/chain-identity.ts:73) immediately. Move the existing pure `walletChainId` to `wallet-core/utils`, retaining the extension re-export; keep the SDK/`Fr` decoder in `aztec-runtime/utils`. Share sender normalization in the existing `wallet-bridge/src/account-resolution.ts`, beside `resolveAuthorizedSessionAccount`. Preserve the distinct session-set contracts and live-node validation.

**Effort:** 1–2 days. **Final confidence:** high.

**ELI5:** Changing how the wallet identifies a network or sender currently requires keeping several independent copies synchronized.

## Q-02 — confirmed

**Independent conclusion:** Three effect-decoding loops, six selector-binding checks, and two artifact-integrity checks repeat substantive rules. Their surrounding error and deduplication policies differ deliberately.

**Corrected instances:** All paths below are under `apps/extension/src/wallet/services/execution/`.

- Effect processing: `authwit-discoverer.ts:110`; `discovery-probe.ts:70`; `dapp-send-executor.ts:1000`.
- Selector binding: `tx-request-builder.ts:340,587`; `authwit-discoverer.ts:197`; `service.ts:1043`; `view-executor.ts:367`; `fast-path.ts:135`.
- Artifact integrity: `service.ts:834,981`.
- Instance-to-artifact lookup: `fast-path.ts:129`; `view-executor.ts:93,365`. These are lookup sequences, **not additional integrity checks**.
- Existing integrity implementation omitted from the recommendation: `packages/aztec-runtime/src/pxe/artifact-class-id.ts:52`, exported through the PXE package.

**Drift evidence:** `fast-path.ts:138` requires the supplied name to match; `tx-request-builder.ts:344` permits an absent name. The probe deduplicates at `discovery-probe.ts:89`, while `authwit-discoverer.ts:123` retains each decoded effect. Both differences are intentional. Fast-path lookup failures return `null` at `:132`; binding violations escape outside that catch.

**Refined fix:** Extract only the decoding kernel, retaining probe state and deduplication outside it. Extend the existing `contract-resolver.ts` helpers—`requireArtifact`, `findFunctionBySelector`, and `validateEncodedCallFn`’s check—with explicit name-presence policy. Preserve caller-specific mutation and catches. Reuse the underlying logic of [`verifyArtifactClassId`](packages/aztec-runtime/src/pxe/artifact-class-id.ts:52); its current catch-and-return-`undefined` contract cannot directly replace throwing service checks without changing error behavior. Execution-specific helpers belong in the extension’s execution directory; artifact verification belongs in `aztec-runtime`.

**Effort:** 1–2 days. **Final confidence:** high.

**ELI5:** Updating an execution safety check requires finding every route that copied it.

## Q-03 — confirmed

**Independent conclusion:** Several small lifecycle protocols are duplicated around existing helpers. A universal row-service abstraction would conceal important differences. An additional account-update site provides concrete drift evidence.

**Corrected instances:** Paths below are under `apps/extension/src/wallet/services/`.

- Seven fenced writes: `fpc/service.ts:230,293`; `contact/service.ts:116`; `dapp-session/service.ts:204`; `network/service.ts:325,493`; `token/service.ts:412`.
- Purge pipelines: `auth-registry/service.ts:512,541,561`; `token-balance/service.ts:541,574`.
- Scope-key expressions: `auth-registry/service.ts:515,518,533,536`; `token-balance/service.ts:577,581,598`.
- Inline scope parameter types: `auth-registry/service.ts:512`; `token-balance/service.ts:574`. The cited `:107` and `:147` are registration callbacks, not duplicate type declarations.
- Restore preambles: `auth-registry/service.ts:593`; `token-balance/service.ts:681`; `transaction/service.ts:534`.
- Hostile-row projections: `contact/service.ts:287`; `account/service.ts:674,766`; `token/service.ts:858`.
- Remaining restore loop: `config/service.ts:62`.
- Complete account identity checks: `account/service.ts:180,339,409`; `account/imported-keys-repository.ts:28`.
- **Additional incomplete check:** `account/service.ts:322`.

**Drift evidence:** [`patchAccountField`](apps/extension/src/wallet/services/account/service.ts:322) checks profile and chain but omits address. `getAccountContract` at `:339` checks all three. The updater subsequently writes using the row-carried address at `:327`, demonstrating materially different identity enforcement.

Other differences are intentional: token writes additionally check network authority and lock ownership; transaction purging has legacy `soleOwner` rules.

**Refined fix:** Build on existing `purgeRows`, `purgeMalformedRows`, `restoreRows`, and `captureRestoreEpochs`. Extract small fenced-write and restore-entry helpers beside those files; keep locks, network checks, cache invalidation, and event timing explicit. Consolidate purge orchestration privately within each service. Put account scope types and a shared identity predicate beside existing `accountRowId`/`accountRowIdOf` in `account/spec.ts`. Preserve config’s allowlist filtering before calling `restoreRows`. Drop the optional raw-marker abstraction from this finding: these instances do not substantiate it.

**Effort:** 2–4 days. **Final confidence:** high.

**ELI5:** Changing how deleted profiles are prevented from leaving records behind requires updating several independently maintained cleanup routines.

## Q-04 — confirmed

**Independent conclusion:** Endpoint selection and policy are repeatedly implemented. Missing-endpoint behavior intentionally varies; local-network status handling has actually diverged.

**Corrected instances:**

- Primary selection in `apps/extension/src/wallet/services/network/service.ts:348,423,581,731,747,769,846` and `network/spec.ts:93,107`.
- Additional consumers under `apps/extension/src/`: `wallet/services/execution/transfer-executor.ts:377`; `dapp-send-executor.ts:470`; `operation-estimate-reuse.ts:141`; `transfer-estimate-reuse.ts:181`; `wallet/services/incoming-transfer/service.ts:536`; `popup/components/popups/EditNetworkPopup.vue:58`.
- Status methods: `wallet/services/network/service.ts:726,742`.
- Endpoint identity checks: `wallet/services/network/service.ts:603,650`.
- Transport predicates: `wallet/services/network/spec.ts:151`; `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:58`.
- Error classification: `apps/extension/src/popup/components/popups/NewEndpointPopup.vue:54`; `EditEndpointPopup.vue:69`.

**Drift evidence:** [`getNodeStatus`](apps/extension/src/wallet/services/network/service.ts:734) calls `_getChainId` without the network kind; `probeNodeStatus` at `:753` explicitly treats `kind === "local"` as chain zero. A local network using a non-seed endpoint can therefore receive different status classifications.

The schema rejects userinfo at `network/spec.ts:166`; the adapter accepts HTTPS immediately at `aztec-node-factory-adapter.ts:66`. That is a policy difference, not sufficient evidence that the adapter must adopt the schema’s stricter rule.

**Refined fix:** Reuse existing `primaryEndpointUrl` for URL-only consumers and `networkInfoFrom` for `getNetworkInfo`. Add an endpoint-object selector in `network/spec.ts` for consumers needing IDs; preserve explicit fallback/throw/undefined policies. Extract the two identity checks and shared status classification without moving network calls inside locks. Move the common transport predicate to `wallet-core/utils`, preserving schema-only userinfo rejection. Keep popup error wording in a local popup helper.

**Effort:** 1–2 days. **Final confidence:** high.

**ELI5:** Changing endpoint rules currently requires coordinated edits in network management, transaction execution, and several screens.

## Q-05 — confirmed

**Independent conclusion:** Fee composition, strategy stages, and snapshot fields repeat. The strategies and cache-validation ladders are not interchangeable; existing shared cache machinery already addresses part of the finding.

**Corrected instances:** Paths below are under `apps/extension/src/wallet/services/execution/`.

- Five task wrappers: `fee/fee-juice-strategy.ts:25`; `fee/fee-juice-with-claim-strategy.ts:25`; `fee/embedded-strategy.ts:32`; `fee/fpc-strategy.ts:136,207`.
- **Stale citation:** `fee-juice-with-claim-strategy.ts` has only 50 lines. Its wrapper is `:25–48`, and its simulation options are at `:39`, not `:79–102` and `:93`.
- Folded discovery: `fee/fee-juice-strategy.ts:33`; `fee/fpc-strategy.ts:153,221`.
- FPC finalization: `fee/fpc-strategy.ts:178,283`.
- Seven validated-options literals: `fee/fee-juice-strategy.ts:54`; `fee/fee-juice-with-claim-strategy.ts:39`; `fee/embedded-strategy.ts:42`; `fee/fpc-strategy.ts:172,254,280`; `fee/fee-strategy.ts:170`.
- Fee composition: `fee/fee-strategy.ts:289`; `fee/fpc-strategy.ts:177,261`; `operation-estimate-reuse.ts:160`; `transfer-estimate-reuse.ts:197`.
- Priority selection also occurs at `service.ts:1103`; it delegates the default through `undefined`, rather than restating the default constant.
- Snapshot producers: `transfer-executor.ts:373`; `dapp-send-executor.ts:447`.
- Validators: `transfer-estimate-reuse.ts:151`; `operation-estimate-reuse.ts:124`.
- Misplaced fingerprint helper: `transfer-estimate-reuse.ts:44`.
- Live-handle resolution: `transfer-executor.ts:299`; `dapp-send-executor.ts:799`.

**Drift evidence:** [`transfer-estimate-reuse.ts:197`](apps/extension/src/wallet/services/execution/transfer-estimate-reuse.ts:197) catches fee-fetch/product failures and rejects reuse; `operation-estimate-reuse.ts:159–163` propagates them. Transfer additionally reconstructs `GasFees`; operation uses the returned object directly. Preserve these existing contracts during deduplication.

The two-pass FPC rebuild condition at `fpc-strategy.ts:237` intentionally differs from the effects-or-initialization condition at `:164`.

**Refined fix:** First reuse `probedFirstSimOpts(undefined, built)` for validated options and consolidate fee multiplication beside existing `predictedWorstMinFees` in `aztec-runtime/fee-juice.ts`. Move `fingerprintBaseFee` into existing `estimate-reuse-shared.ts`; retain its `SingleShotTtlCache` and `pendingHashesChanged`. Extract snapshot fields and live-handle resolution without reordering validation or fence checks. Keep FPC finalization private to `FpcStrategy`. A generalized strategy runner is optional, not required to obtain the main benefit.

**Effort:** 2–3 days. **Final confidence:** high.

**ELI5:** A fee-calculation change must currently reach both estimation and several independent checks that decide whether an estimate can be reused.

## Q-06 — partially confirmed

**Independent conclusion:** Row construction and presentation repeat, but the complete feeds have intentionally different selection rules. Some alleged duplicate locations already delegate to shared helpers.

**Corrected instances:** Paths below are under `apps/extension/src/`.

- Transaction rows: `utils/activity-rows.ts:79`; `popup/components/modules/general/recent-activity-rows.ts:55`.
- Incoming rows: `utils/activity-rows.ts:104`; `popup/components/modules/general/recent-activity-rows.ts:66`.
- Inline profile predicates: `popup/components/modules/general/TokensView.vue:66`; `RecentActivityView.vue:270`.
- Journal presentation: `popup/components/modules/general/RecentActivityView.vue:337,352,358,367,378,388`; `utils/journal-state.ts:372,397`.
- Orphan-task projections: `RecentActivityView.vue:156,176,184,190`; these consume task data rather than journal records.
- Dispatch/routes: `RecentActivityView.vue:852`; `popup/components/modules/activity/TransactionsList.vue:62`.
- Remove `RecentActivityView.vue:240,399` and `TransactionsList.vue:44,49` as independent projection implementations: they already call shared builders.
- Separator/chip styles: `components/composite/activity/TransactionAwaitingCard.vue:132,141`; `TransactionTerminalCard.vue:87,94`; `TransactionIncomingCard.vue:77,84`; `popup/components/modules/activity/TransactionCard.vue:200,207`.
- The timestamp expression is duplicated; the claimed identical comment is not.

**Drift evidence:** [`recent-activity-rows.ts:73`](apps/extension/src/popup/components/modules/general/recent-activity-rows.ts:73) filters incoming rows by profile; `activity-rows.ts:107–118` does not. Separately, `RecentActivityView.vue:369` permits an empty amount string to reach the formatter, which returns `"0"` at `utils/amount.ts:103`; `journal-state.ts:380` suppresses it.

Symbol visibility, token filtering, journal prefiltering, and the incoming chip’s green color are intentional differences. Inline profile predicates also use truthiness, unlike `isForeignProfile`’s explicit undefined checks.

**Refined fix:** Share row predicates/builders in `utils/activity-rows.ts`, preserving each feed’s orchestration. Reuse existing `isForeignProfile`, `buildIncomingCardProps`, and `buildJournalTerminalCardProps`; extract their common journal fields with explicit amount/symbol policy. Put any shared row renderer at L4 in `popup/components/modules/activity/`, because it renders the service-bound `TransactionCard`. Share presentation CSS under `components/composite/activity/`, retaining variants.

**Effort:** 1–2 days. **Final confidence:** high.

**ELI5:** Making activity look and filter consistently requires changing both Home and History without accidentally changing which records each shows.

## Q-07 — partially confirmed

**Independent conclusion:** Verify duplicates the hostname helper’s behavior; it does not currently omit its protection. Window closing and session waiting repeat, while approval/rejection orchestration differs substantially.

**Corrected instances:** Paths below are under `apps/extension/src/`.

- Hostname logic: `popup/windows/verify/index.vue:53,61`; existing helper `composables/useDappHostname.ts:8`.
- Window closure: `popup/windows/verify/index.vue:78`; `json/index.vue:19`; `logger/index.vue:15`; `composables/useDappApprovalWindow.ts:88`.
- Session wait: `popup/windows/verify/index.vue:119`; `composables/useDappApprovalWindow.ts:102`.
- Initialization catches: `popup/windows/discover/index.vue:88`; `capabilities/index.vue:177`; `execute/index.vue:263`—not approximately `:290`.
- Approval catches: `discover/index.vue:108`; `capabilities/index.vue:327`; `execute/index.vue:520`.
- Reject handlers: `discover/index.vue:121`; `capabilities/index.vue:344`; `execute/index.vue:539`.
- Request-ID lambdas: `discover/index.vue:49`; `capabilities/index.vue:117`; `execute/index.vue:130`.

**Drift evidence:** JSON/logger omit the window-ID guard present in verify and the approval hook. Hostname implementations currently agree.

Approval differences are deliberate: discover keeps loading while awaiting verification; execute rearms estimates at `:523` and shows `"Processing error."` with details at `:532`; the other windows show a generic failure. Execute rejection also cancels outstanding estimates.

**Refined fix:** Use [`useDappHostname`](apps/extension/src/composables/useDappHostname.ts:8) directly. Extract browser closure into extension `utils/`. Extract session waiting into a C0 composable accepting a reactive getter, without importing the store or owning service connections. Share only cancellation classification with `useDappApprovalWindow`; preserve local cleanup and success behavior. Keep `useDappInteractionPayload` router-independent rather than adding a router-dependent default merely to eliminate three one-line lambdas.

**Effort:** 4–8 hours. **Final confidence:** high.

**ELI5:** Updating approval-window behavior requires checking several screens whose copied pieces have different surrounding responsibilities.

## Q-08 — confirmed

**Independent conclusion:** Eight visibility controls and four closely matching password pairs are real duplicates. There are seven identical shake sequences plus one materially different animation.

**Corrected instances:** Paths below are under `apps/extension/src/`.

- Visibility buttons: `components/composite/import/ImportSecretForm.vue:44,79`; `ImportFullBackupForm.vue:114,142`; `popup/components/modules/settings/new-profile/NewProfileCredentials.vue:31`; `popup/pages/auth.vue:265`; `popup/pages/settings/security/change-password.vue:130,172`.
- Corresponding CSS: `ImportSecretForm.vue:145`; `ImportFullBackupForm.vue:189`; `NewProfileCredentials.vue:80`; `auth.vue:392`; `change-password.vue:266`.
- Matching password pairs: `ImportSecretForm.vue:68`; `ImportFullBackupForm.vue:132`; `NewProfileCredentials.vue:21`; `change-password.vue:161`.
- Additional related pair found by search: `onboarding/pages/create.vue:146`, with different labels, layout, and no visibility toggle. `popup/pages/settings/security/export/full.vue:576` is an encryption-password form with a different error contract.
- Identical keyframes: `components/composite/SecretUnlockSection.vue:65`; `onboarding/components/OnboardingProfileNameField.vue:45`; `popup/pages/auth.vue:439`; `import.vue:352`; `profile/new.vue:180`; `settings/security/change-password.vue:288`; `settings/security/export/full.vue:723`.
- Distinct variant: `popup/components/popups/NewSenderPopup.vue:175,179`.

**Drift evidence:** Identical keyframes run for 0.3 seconds in four places and 0.4 seconds in three. NewSender uses 0.5 seconds and different displacement steps. These variations are observed, not proven accidental. Password autocomplete also differs: `ImportSecretForm.vue:76,106` supplies `new-password`; the corresponding full-backup and new-profile fields omit it.

**Refined fix:** Extract a controlled L3 visibility component and password-pair component into `components/composite/`, accessible from both shells. Reuse existing `Input`, [`newPasswordHint`](apps/extension/src/utils/password.ts:6), and `isNewPasswordValid`. Preserve shared visibility across current/new/confirmation fields, test IDs, and current keyboard behavior. Share the seven identical keyframes through `@nulo/design`, retaining duration overrides and the distinct sender animation. Adding reduced-motion behavior is a separate behavior change, not an automatic deduplication step.

**Effort:** About 1 day. **Final confidence:** high.

**ELI5:** Improving password controls or their error animation requires repeating the same change across several sensitive screens.

## Q-09 — partially confirmed

**Independent conclusion:** Keyed-list mechanics and contact conflict checks repeat, but the claim that all copies append unconditionally is false. Replacing them wholesale with `useEntityCrud` would change behavior.

**Corrected instances:** Paths below are under `apps/extension/src/`.

- Contact reducers: `popup/components/popups/NewContactPopup.vue:36`; `EditContactPopup.vue:38`; `ImportContactsPopup.vue:35`; `popup/pages/send.vue:196`.
- Other listed reducers: `popup/components/popups/NewFpcPopup.vue:89`; `EditFpcPopup.vue:136`; `SelectProfilePopup.vue:77`; `SelectTokenPopup.vue:77`; `popup/pages/settings/connected-apps/index.vue:54`.
- Shared implementation: `composables/useEntityCrud.ts:104`.
- Additional reducer kernels found by `git grep`: `components/Header.vue:101,106`; `composables/useIncomingTransfers.ts:123,128`; `popup/components/modules/general/RecentActivityView.vue:544,550,558,643`; `TokensView.vue:193,204,211,232`; `BalanceView.vue:235`; `popup/pages/activity.vue:82`; `stores/app.store.ts:308`.
- Contact validation: `NewContactPopup.vue:53`; `EditContactPopup.vue:70`; import indexing/conflicts at `ImportContactsPopup.vue:103,117`.
- String flags: `NewContactPopup.vue:81,83`; `EditContactPopup.vue:103,104`.
- Canonical writes: `NewContactPopup.vue:111`; `EditContactPopup.vue:145,151`.
- `SelectFpcPopup.vue:81` exists and is registered/rendered by `PopupManager.vue:342`, but search found no opening caller. Exclude it from the active-consumer count pending dead-code resolution.

**Drift evidence:** [`useEntityCrud.ts:111`](apps/extension/src/composables/useEntityCrud.ts:111) replaces repeated adds; `NewContactPopup.vue:37` appends. However, `SelectProfilePopup.vue:77` already upserts, and `SelectTokenPopup.vue:79` ignores duplicate adds. Unknown updates are appended by the composable at `:127`, but ignored by `NewFpcPopup.vue:94` and `SelectTokenPopup.vue:84`.

EditContact’s draft refresh and connected-app logo preservation are intentional side effects. Import’s “deselect only when both fields collide” rule is also intentional.

**Refined fix:** Extract pure list operations into `utils/entity-list.ts` and use them inside both `useEntityCrud` and local handlers. Preserve append/upsert/replace-only, insertion order, snapshot bookkeeping, and side effects explicitly. Keep connections and popup lifecycle with their current owners. Extract typed contact-conflict results and address canonicalization into extension `utils/`, continuing to use `useFormState` and `isValidHex`; callers retain their own acceptance rules.

**Effort:** 1–2 days for the listed active consumers; additional specialized reducers can follow separately. **Final confidence:** high.

**ELI5:** Lists respond differently to repeated or out-of-order updates because each screen maintains its own version of the same basic operations.

## Q-10 — confirmed

**Independent conclusion:** The 12-position recording contract and repeated send-result tails are real. NO_FROM’s nonce, payment method, and absent public-authwit recording are intentional differences.

**Corrected instances:** Paths below are under `apps/extension/src/wallet/services/`.

- Declaration: `transaction/service.ts:155`.
- Three producers: `execution/transfer-executor.ts:182`; `execution/dapp-send-executor.ts:528,919`.
- Indexed projections: `execution/dapp-send-executor.ts:129,132,134,137`.
- Forwarding adapters requiring migration: `execution/service.ts:350,419`; these are not additional producers.
- Primary-method thunks: `execution/dapp-send-executor.ts:677,874`.
- Offchain-output callbacks: `execution/dapp-send-executor.ts:736,914`.
- Return tails: `execution/dapp-send-executor.ts:754,935`.
- Cancellation closures: `execution/dapp-send-executor.ts:255,295,369`; `execution/transfer-executor.ts:350`.
- Additional closure: `execution/transfer-executor.ts:131`. Additional equivalent checkpoints occur at `execution/discovery-aware-estimator.ts:128`, `execution/fee/fee-juice-strategy.ts:43`, and `execution/fee/fpc-strategy.ts:166,243,266`.

**Drift evidence:** No accidental disagreement was established in the paired output/return tails. The recorder at [`dapp-send-executor.ts:525`](apps/extension/src/wallet/services/execution/dapp-send-executor.ts:525) supports pending public authwits; NO_FROM at `:924–925` intentionally records zero nonce and external payment. The transfer cancellation closure reads controller/journal variables assigned later, so extraction must preserve that laziness.

**Refined fix:** Introduce a named transaction input in `transaction/spec.ts`; migrate the three producers and two forwarders. Extend existing `sentTxRecorder` to accept explicit nonce/payment/endpoint data and an empty authwit list for NO_FROM. Keep primary-method, offchain-output, and return helpers local to `dapp-send-executor.ts`, reusing `pickPrimaryMethod` and `extractOffchainOutput`. Add a sentinel-preserving checkpoint beside existing cancellation helpers in `execution/rpc-cancel.ts`; pass current values when invoked rather than capturing initially undefined values.

**Effort:** About 1 day. **Final confidence:** high.

**ELI5:** Adding a transaction-record field or changing the send response requires synchronized edits across several nearly identical call sites.

Verification was read-only against `dev` at `910a4defcbacbb4e76b53c1d57551a457b1d3fb0`; source and relevant tests were inspected, not executed.