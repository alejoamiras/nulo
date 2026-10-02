# q09-ext-composables-stores-utils — claude

Scope read: apps/extension/src/utils/{token-amount,token-order,token-fold,token-aggregate,token-search,tx-amount,snack-amount,received-display,activity-rows,transfer-intent,token-transfer-vocabulary,tx-enrichment,primary-method,fee-estimation,in-flight-send,account-name,profile-name,chain-ids,coalesce,lastActiveProfile,background-liveness,clipboard,general,string,core,password,incoming-dust}.ts and amount.ts (first 300 lines); composables/{runFence,unlockWait,waitForProfileActive,useFeeEstimation,useFeeEstimationMap,useIncomingTransfers,useEntityCrud,useLegalAcceptance,useScopedTokens,useSeedStatus,useAuthRegistryStatus,useIncomingSyncHealth,usePrestoStatus,usePrestoCheck,usePrices,usePinnedTokens,useArrivals (head),useSecretClipboardCopy,useProfileCreateFlow,useProfileNameDefault,useProfileNameField}.ts; stores/activity.store.ts and stores/app.store.ts (in-flight tracker, 140-330). Cross-boundary: popup/components/modules/general/recent-activity-rows.ts, popup/components/popups/EditProfilePopup.vue, wallet/services/price/convert.ts, wallet/services/price/price-map.ts, packages/design/src/internal/sanitize.ts, packages/aztec-runtime/src/utils/chain-identity.ts. Not read in depth: balances.store.ts, full-backup-helpers.ts, files.ts, journal-state.ts, useFullBackupImport/full-backup-restore, useProfileImportFlow, useDappApprovalWindow (the jscpd lead `useDappApprovalWindow.ts:100-115` is not evaluated).

## q09-ext-composables-stores-utils-C-1: Latest-wins async guard hand-rolled in 8 places next to an existing `createRunFence`

**Smell:** Duplicate Code (Fowler) / Parallel adoption of an extracted helper (Q-07 pattern). A shared primitive exists, and each site re-implements the same counter-and-compare with its own flavour of the `disposed` flag.

**Maintenance impact:** structural. Blast radius 8 files plus `app.store`. Change frequency is high: 7 commits since 2026-06-01 across five of the sites. These are stale-fetch and ABA races, where one site missing an invalidation is the usual failure.

**Evidence:** `composables/runFence.ts:12-20` is `begin(): () => boolean`, used by `useProfileBootstrap.ts:44`, `useScopedTokens.ts:31` and `popup/network-switch.ts:45`. The same logic is hand-rolled as an integer bumped per run and compared after an await:
- `useEntityCrud.ts:77,81,92,96,100` (`seq` / `mySeq`)
- `useIncomingTransfers.ts:76,79,104` (`refreshSeq`)
- `useLegalAcceptance.ts:16,19,28,52` (`seq`)
- `useSeedStatus.ts:56,89-90,133` (`generation`, with `isLatest()`)
- `useIncomingSyncHealth.ts:50,94-99,134` (`generation`)
- `usePrestoStatus.ts:16,20,30` (`generation`)
- `usePinnedTokens.ts:169,194,202` (`refreshGeneration`)
- `stores/app.store.ts:156,209,218,277-280` (in-flight tracker `generation`, plus a `revision`)

Every site also carries `disposed ||` in the post-await check. `useSeedStatus` and `useIncomingSyncHealth` even define the same local `isLatest` closure that `begin()` returns.

**Why it harms future change:** The fence's contract (supersede, invalidate on dispose, never reuse a generation) lives in 4 shapes, so a fix to one is not applied to the others. `useLegalAcceptance`/`useSeedStatus` also need an "invalidate without starting a run" operation, which `RunFence` lacks, so the next author reaches for a counter again. Adding an `invalidate()` or auto-dispose semantics means 8 edits instead of 1.

**Smallest safe refactoring:** Extract Function / Parameterize Function. Extend `RunFence` with `invalidate()` (bump without returning a closure) and optional `dispose()` (permanently stale). Replace the counters with `const isCurrent = fence.begin()` in the 7 composables. `app.store` stays as is: its `suspended` and `revision` counters are extra state on top of the fence. Put the change in `composables/runFence.ts` (L0, no dependencies).

**What disappears:** about 7 counter declarations, about 15 `mine !== seq` comparisons, 3 local `isLatest` or `isStale` closures; roughly 30 lines. Each `disposed ||` check collapses into the fence.

**Instances:** composables/useEntityCrud.ts:77-100; composables/useIncomingTransfers.ts:76-79,104; composables/useLegalAcceptance.ts:16-52; composables/useSeedStatus.ts:56-90,133; composables/useIncomingSyncHealth.ts:50-99,134; composables/usePrestoStatus.ts:16-30; composables/usePinnedTokens.ts:169-202; stores/app.store.ts:156-280 (optional).

## q09-ext-composables-stores-utils-C-2: Activity-feed scope/sort rules duplicated between `activity-rows.ts` and `recent-activity-rows.ts`, already drifted

**Smell:** Duplicate Code / Shotgun Surgery. Semantic duplication of the scope predicate and the sort key. The history of the file records that this duplication has been extracted once already ("codex + opus audit M3") and has regrown.

**Maintenance impact:** structural, user-facing data path (Home preview and History). 6 commits since 2026-06-01 across the two files. Blast radius: 2 files, 2 screens.

**Evidence:**
- Tx scope predicate (account, chain, `isForeignProfile`), then the `tx:${hash}` row: `utils/activity-rows.ts:79-88` and `popup/components/modules/general/recent-activity-rows.ts:55-64`. They are identical, and the popup comment says "exactly as `buildActivityRows` does".
- Incoming scope predicate (account, network) plus the `blockTimestamp*1000 ?? discoveredAt` sort key, including the same 6-line explanatory comment: `utils/activity-rows.ts:104-121` (sortKey at :117) and `recent-activity-rows.ts:66-82` (sortKey at :77).
- The copies have already drifted. The popup version calls `isForeignProfile(scope.profileId, inc.profileId)` for incoming rows (`recent-activity-rows.ts:73`). `incomingRows` in `activity-rows.ts:104-121` does not, so History applies a weaker containment check than Home. The header comment of `activity-rows.ts` ("defense-in-depth ... a single missed guard can't leak") claims this guard for all three row types.

**Why it harms future change:** Any new scoping rule (for example a further scope dimension beyond profile) must be added to 2 files by hand. Forgetting one silently shows another profile's rows on one of the two surfaces, which has already happened for incoming rows.

**Smallest safe refactoring:** Extract Function. In `utils/activity-rows.ts` export `txInScope(tx, scope)`, `incomingInScope(inc, scope)` and `incomingSortKey(inc)`. Have `activity-rows.ts` and `recent-activity-rows.ts` call them. The popup keeps its own token filter, journal pre-filtering and slicing, which are its legitimate differences (per its header). `incomingInScope` should include the profile check in both.

**What disappears:** about 25 duplicated lines plus one duplicated comment block; 2 divergent predicates become 1.

**Instances:** utils/activity-rows.ts:79-88,104-121; popup/components/modules/general/recent-activity-rows.ts:55-64,66-82.

## q09-ext-composables-stores-utils-C-3: "Which method names are mints/transfers" is encoded in four places with different answers

**Smell:** Shotgun Surgery / Duplicate knowledge (parallel switch ladders). The token-function vocabulary is hand-listed in 4 places with different membership.

**Maintenance impact:** local to structural; 3 files plus the wallet descriptors. The owner-gated approval and activity surfaces read these. Low churn (the vocabulary changes rarely), but the divergence is live.

**Evidence:**
- `utils/token-transfer-vocabulary.ts:71-74` `MINT_SIGNATURES`: `mint_to_private`, `mint_to_public`. The approval-card reader `parseTransferIntent` uses it, so `mint_to_commitment` is `unverified`.
- `utils/tx-amount.ts:10` `STANDARD_MINTS`: `mint_to_public`, `mint_to_private`, `mint_to_commitment` (3 names). Settled-activity amounts treat a commitment mint as a mint.
- `utils/tx-enrichment.ts:19-20` `METHOD_LABELS` (2 mint names) and `:104-105` `getTxCategory`, which uses `startsWith("transfer")` and `startsWith("mint_to_")`. It does not use the vocabulary at all, so any `transfer*` name, or a recognised-by-prefix `mint_to_x`, is titled "Transfer"/"Mint" even where `findTransferSignature` or `findMintSignature` would refuse the same call.
- Transfer direction labels are a third list: `TRANSFER_TYPE_LABELS` (`tx-enrichment.ts:150-161`) next to `TRANSFER_LABELS` (vocabulary.ts:29) and `LABELS` in `received-display.ts:38-43`. That overlap is weaker (different strings on purpose), so I do not count it as an instance.

**Why it harms future change:** Supporting a new standard-token entry point (for example another mint variant) requires edits in `token-transfer-vocabulary`, `tx-amount`, `tx-enrichment` (labels and category). Today they already disagree for `mint_to_commitment`, so the same call reads as "Mint" in the title, as an amount from `txAmount`, and as `unverified` on the approval card.

**Smallest safe refactoring:** Move Function / Extract Function. Make `token-transfer-vocabulary.ts` the single source: add `MINT_SIGNATURES` entries (or a `isStandardMint(name)` helper) for all standard mint names. Have `tx-amount.STANDARD_MINTS` and `getTxCategory` derive from `findMintSignature` / `TRANSFER_SIGNATURES`. The owner should decide whether `mint_to_commitment` belongs in the approval vocabulary, since that changes what the approval card shows (UI-impact rule in CLAUDE.md), so this refactor must not silently flip it.

**What disappears:** 1 hand-written set, 2 `startsWith` ladders, and the undocumented membership disagreement.

**Instances:** utils/token-transfer-vocabulary.ts:71-77; utils/tx-amount.ts:10,40-43; utils/tx-enrichment.ts:17-25,102-108.

## q09-ext-composables-stores-utils-C-4: Fee Juice USD valuation implemented twice (`feeToUsd` vs `price/convert`)

**Smell:** Duplicate Code (semantic), Alternative Classes with Different Interfaces. Both compute `raw * rate / 10^decimals`, half-up, in bigint, with a `<` hint for dust, but through different helpers and scales.

**Maintenance impact:** local to structural. 5 commits since 2026-06-01 across `fee-estimation.ts` and `convert.ts`. Blast radius 4 consumers (`fee-helpers.ts:19`, `tx/[id].vue:106,108`, `received/[id].vue:135`, `GasBalanceCard.vue:81`).

**Evidence:**
- `utils/fee-estimation.ts:96-116` `feeToUsd`: hand-snaps the rate (`Math.round(usdRate * 1e6)`, the same operation as `rateToMicroUsd`), divides by `1000 * 10^decimals`, renders three decimals with a `<$0.001` hint. Its own comment says it is the scaled-rate approach that convert.ts "mirrors" (`convert.ts:2-4`).
- `wallet/services/price/convert.ts:76-113` `tokenAmountToUsdMicro` + `formatUsdMicro`: same math at micro precision, two decimals. Rate snap is in `rateToMicroUsd` (:19-29).
- The fee-juice pricing shape is itself a fork: `feeJuicePricingFromUsd` (`fee-estimation.ts:28-39`) hard-codes the contract address and a separate `AssetPricing` type, while `GasBalanceCard.vue:81` prices the same token through `tokenAmountToUsdMicro(…, FEE_JUICE_DECIMALS, quote.usd)`. `FEE_JUICE_DECIMALS = 18` lives in `fee-estimation.ts:8`.

**Why it harms future change:** A change to rate handling (clamping, sanity bands, rounding policy) has to be made in both files, and the two can disagree in the last digit (single half-up rounding at milli vs micro then cents). The same fee can show different USD on the gas card and on the tx detail.

**Smallest safe refactoring:** Parameterize Function. Add a `decimals` option to `formatUsdMicro(micro, { places })` (3 with `minDecimals: 3` for fees), and rewrite `feeToUsd` as `tokenAmountToUsdMicro(fee, 18, usd)` + `formatUsdMicro`. Decide whether the double rounding is acceptable (it changes at most one milli-dollar). `formatUsdMicro` stays in `wallet/services/price/convert.ts`. Drop `AssetPricing.symbol`/`address` if no reader remains.

**What disappears:** about 20 lines (scaled-rate arithmetic, the dust hint, `RATE_SCALE`) and one rate-snapping implementation. Confidence: moderate, since `feeToUsd` has a formatting contract (three decimals, `$0.000` for zero) that the merge must preserve.

**Instances:** utils/fee-estimation.ts:28-39,90-116; wallet/services/price/convert.ts:19-29,76-113; popup/components/modules/general/GasBalanceCard.vue:81.

## q09-ext-composables-stores-utils-C-5: Dead production exports kept alive by tests only

**Smell:** Dead Code (plus Speculative Generality for the near-twin `computeMaxFee`/`buildFeeEstimate`).

**Maintenance impact:** local / cosmetic; each one widens the auto-import surface (`types/auto-imports.d.ts` lists them) and keeps tests that pin behavior nobody ships.

**Evidence** (zero inbound refs outside the defining file and `*.test.ts`; grep over `src` and `tests`, `.ts`/`.vue`/`.js`, excluding `auto-imports.d.ts`). `auto-imports.d.ts` was confirmed to list these as auto-importable, and no `.vue` or non-test `.ts` file uses the bare names:
- `buildFeeEstimate` and the `FeeEstimate` type: `utils/fee-estimation.ts:119-140`. It re-implements the `computeMaxFee` formula inline (`:132`) instead of calling it, so the pair is a parallel pair and only `computeMaxFee` is live (`wallet/services/execution/tx-fee-details.ts:16`).
- `isValidAmount`: `utils/amount.ts:208-216` (test only).
- `getCallCountLabel` (`tx-enrichment.ts:127-134`) and `formatCallSummary` (`:147-149`): test only.
- `requireTransaction`: `utils/core.ts:131`. Only `requireNetwork` has a caller (`popup/windows/capabilities/index.vue:351`); `requireAccount` (:137) has none outside core/tests, which I did not recheck individually, so I exclude it.
- `isReceiptAboveDustThreshold = isAmountAboveDustThreshold` (`utils/incoming-dust.ts:46`) is an alias with one production caller (`wallet/services/incoming-transfer/service.ts:21,593`) and a test that asserts identity (`incoming-dust.test.ts:8`). Two names for one function.

**Why it harms future change:** Dead exported code gets maintained and tested when neighbouring code moves (for example `formatTransferType` or fee display changes), and readers assume the ladder in `fee-estimation.ts` is exercised.

**Smallest safe refactoring:** Remove Dead Code; Inline Function for the alias (have the service call `isAmountAboveDustThreshold`, delete the alias and its identity test). Delete each function together with its test cases.

**What disappears:** about 55 lines of source plus their tests, one alias, and 6 auto-import entries.

**Instances:** utils/fee-estimation.ts:119-140; utils/amount.ts:208-216; utils/tx-enrichment.ts:127-134,147-149; utils/core.ts:131-135; utils/incoming-dust.ts:46 with wallet/services/incoming-transfer/service.ts:21,593.

## q09-ext-composables-stores-utils-C-6: Two "wait for the shell to activate profile X" helpers with the same body

**Smell:** Duplicate Code (near-clone with a superset). `waitForProfileActive` is a strict subset of `awaitProfileActivation`.

**Maintenance impact:** local; 2 files, 2 call sites (`popup/pages/import.vue:72`, `popup/pages/auth.vue:164`). The jscpd lead `unlockWait.ts:33-38 ↔ waitForProfileActive.ts:30-35` is this.

**Evidence:** `composables/waitForProfileActive.ts:30-47` and `composables/unlockWait.ts:33-62` share the already-active early return, the timer, the `watch` over `isLogined` and `profile.id`, and the `clearTimeout; stop(); resolve()` tail. `unlockWait` adds only the bootstrap-failure signal and typed errors (its doc comment explains why it must be a single watcher). `waitForProfileActive` rejects with a bare `new Error("Profile activation timeout")`, so its caller cannot branch on type, unlike `UnlockTimeoutError`.

**Why it harms future change:** A fix to the activation condition (for example `isLogined` flipping last, or the identity check) has to be applied twice, and `import.vue` is the path that most needs the typed failure it does not get.

**Smallest safe refactoring:** Consolidate Duplicate Conditional Fragments. Make `awaitProfileActivation` accept a store whose `bootstrapFailure` is optional (treat absent as `null`), switch `import.vue` to it, and delete `waitForProfileActive.ts`. `import.vue` then needs to handle `UnlockTimeoutError` where it now matches a generic error, so check its catch block first.

**What disappears:** one file (47 lines) and one exported type.

**Instances:** composables/waitForProfileActive.ts:30-47; composables/unlockWait.ts:33-62; callers popup/pages/import.vue:72, popup/pages/auth.vue:164.

## q09-ext-composables-stores-utils-C-7: Scope-key stringifier re-declared in 6 composables, with two different separators

**Smell:** Duplicate Code / Data Clumps. The same "(profileId, X, Y) → identity string" helper is hand-written per composable, for scopes of the same shape.

**Maintenance impact:** local; 6 files. Low churn, but it decides stale-drop correctness (see C-1).

**Evidence:**
- `useIncomingTransfers.ts:72` and `useArrivals.ts:103`: `` `${profileId} ${networkId} ${account}` `` (space-separated; the two must agree because `useArrivals` reads `IncomingScope` from `useIncomingTransfers`).
- `useSeedStatus.ts:39`: `` `${profileId}|${chainId}` ``.
- `useIncomingSyncHealth.ts:38`: `` `${profileId}|${networkId}` ``.
- `useScopedTokens.ts:52-55`: `` `${profileId} ${chainId}` `` (space).
- `@nulo/wallet-core/activity` already exports `activityScopeKey` (used by `stores/activity.store.ts`), so a safe keying function exists and is not used here.

**Why it harms future change:** Adding a scope dimension touches 6 functions. The space-delimited variants collide if a component ever contains a space (for example a `networkId` that is user-chosen), which is exactly the ambiguity the JSON-keyed `activityScopeKey` avoids. A collision would make two scopes share a key.

**Smallest safe refactoring:** Extract Function. Add `scopeKey(...parts: (string | number)[])` (JSON array key, as `activityScopeKey` does) to a C0 helper such as `composables/runFence.ts` or a new `utils/scope-key.ts`, and use it at all 6 sites. Do this together with C-1, since both touch the same stale-check lines.

**What disappears:** 6 bespoke lambdas; one key format.

**Instances:** composables/useIncomingTransfers.ts:72; composables/useArrivals.ts:103; composables/useSeedStatus.ts:39; composables/useIncomingSyncHealth.ts:38; composables/useScopedTokens.ts:52-55.

## q09-ext-composables-stores-utils-C-8: Helpers exist but call sites re-inline them (`normalizeProfileName` x5, malformed-row predicate x3)

**Smell:** Duplicate Code. These are partial-adoption copies of a helper that lives in this cluster. Both are small, so I group them.

**Maintenance impact:** local; 2 + 3 sites. Low churn. Product-visible: profile-name collision rules.

**Evidence:**
- `utils/profile-name.ts:7-9` `normalizeProfileName` (NFKC + `toLocaleLowerCase`) is the named collision form that `useProfileNameField` uses. `popup/components/popups/EditProfilePopup.vue:46,78,79,81,111` re-inline `.normalize("NFKC").toLocaleLowerCase()` five times.
- The "row cannot be trusted" predicate `parseRawBalance(tb) === undefined || !isValidDecimals(decimals)` is written as `isUnknownRow` (`utils/token-order.ts:39-41`), again in `safeFiatOf` (`token-amount.ts:50`), and again as the `malformed` local in `aggregateFiat` (`token-aggregate.ts:22-23`). Only the optional-chaining on `token` differs.

**Why it harms future change:** Changing the name-folding rule (for example adding confusables) or the definition of a malformed row needs edits at every copy. `EditProfilePopup` would keep the old rule, so renaming a profile could collide under a rule the create flow rejects (or the reverse).

**Smallest safe refactoring:** Replace inline copies with calls. `normalizeProfileName` in `EditProfilePopup.vue`. Move `isUnknownRow` to `utils/token-amount.ts` (L0, below `token-order`) as `isMalformedRow` with the `token?.` form, and call it from `token-order`, `safeFiatOf` and `aggregateFiat`.

**What disappears:** 5 inline chains and 2 predicate copies (about 10 lines).

**Instances:** popup/components/popups/EditProfilePopup.vue:46,78,79,81,111; utils/token-order.ts:39-41; utils/token-amount.ts:50; utils/token-aggregate.ts:22-23.

## Non-findings considered

- `useFeeEstimation` and `useFeeEstimationMap` (prior 2026-08-14 dedup finding, `:70-148 ↔ :73-169`): both are now thin wrappers over `composables/internal/fee-estimation-engine.ts`. Fixed, skipped.
- Clipboard copy sites (prior 2026-08-14): `utils/clipboard.ts` and `useSecretClipboardCopy.ts` hold the only two `navigator.clipboard.writeText` call sites under `src`. Fixed.
- Sanitizer fork (prior Q-12): `packages/design/src/internal/sanitize.ts` is still a copy of `utils/string.ts`'s `sanitizeString`, but `utils/sanitize-parity.test.ts` now runs one fixture table through both. The copy is deliberate (design cannot import the extension) and the drift is gated. Not a finding.
- Other Q-07 leftover (popup Enter-guard predicate): `usePopupEntity` has 22 consumers and the hand-copied `activeElement` guard is gone from `popup/components/popups/*.vue`, so the adoption gap closed.
- `utils/chain-ids.ts` vs `packages/aztec-runtime/src/utils/chain-identity.ts`: constants live only in `chain-ids.ts`, and the aztec-runtime file references the two rollup-version values only in its doc/test and a bound-check. The bridge/tools mirror is the sanctioned cross-cut in CLAUDE.md.
- `debounce` (`utils/general.ts`) and `coalesce` (`utils/coalesce.ts`): different semantics (trailing vs quiet+max-wait), one caller each of the maximal form.
- `createRunFence` callers other than C-1's list: by design per-site instances.
- `activity.store.ts` mutation-version fencing: specific to slices and ABA across eviction, not a general fence. Carries its accepted complexity directive. Not flagged for complexity.
- `app.store.ts` in-flight tracker `generation` + `revision`: extra state over the fence, deliberate.
- `token-order` / `token-fold` / `token-aggregate` / `token-search`: each composes `token-amount`; `matchesQuery` is the only substring search over token rows. No parallel ordering found.
- `formatSnackAmount` and `balanceFormatted`: snack wraps the existing formatter twice; no re-implementation.
- `fee-estimation.halfUpRound`/`formatFeeJuice` vs `amount.ts`: fee rounding (half-up) deliberately differs from `balanceFormatted` (truncate); contract documented. Not flagged beyond C-4.
- `useProfileNameField`'s `triggerShake` and `useSecretCountdown`-style timers: no second implementation found inside the cluster.
- `utils/core.ts` Proxy + `require*`/`get*` accessors: documented-deliberate; dead-code note for `requireTransaction` only (C-5).
- `utils/index.ts` (barrel) and `lastActiveProfile.ts`: too small to duplicate anything.
- jscpd lead `composables/useDappApprovalWindow.ts:100-115 ↔ popup/windows/verify/index.vue:116-132`: not evaluated (out of time, not verified either way).
- Not examined: `balances.store.ts` (702 lines), `full-backup-helpers.ts`, `files.ts`, `journal-state.ts`, `useProfileImportFlow.ts`, `useFullBackupImport.ts`, `full-backup-restore.ts`. Absence of findings there means "not read", not "clean".

## Incidental bugs noticed (for the bugs run)

- `utils/activity-rows.ts:104-121` — `incomingRows` never calls `isForeignProfile`, while its twin `recent-activity-rows.ts:73` does. Counter-example: two profiles that derive the same account address on the same network and both hold incoming records (for example mnemonic re-import). If a foreign-profile record reaches `incomingTransfers` on the History page (`activity.vue`), the History page lists it, while Home's preview would drop it. Whether a foreign row can reach the list depends on ingest filtering in `useIncomingTransfers.inLiveScope`, which I did not prove fails, so treat this as a lead.
- `utils/tx-enrichment.ts:102-108` — `getTxCategory` uses `startsWith("mint_to_")`, so `mint_to_commitment` is titled "Mint" although `parseTransferIntent` (`transfer-intent.ts:48-58`) treats that call as `unverified`. Counter-example: a dApp call `mint_to_commitment(x, amount)`. The activity title says "Mint" while the approval card refuses to interpret it. Likely intended, so a lead only, not a defect.

## Cross-rebuttal (claude on codex)

**1. Codex findings, verdicts**
- **X-1 (deadline races x8): partially agree.** `withTimeout` (balances.store.ts:124) and `withinDeadline` (auth-guard.ts:83) are real twins, and `withTimeout` is auto-imported app-wide from a Pinia store (auto-imports.d.ts:352), which is a genuine smell. But "eight" is padded: the packages (`base-client.ts`, `opfs-store.ts`) throw typed errors and have late-close/quarantine semantics, and Header/LogsViewer/import* return sentinels or retry. Realistic shared helper covers about 3-4 sites; the cross-workspace move into `wallet-core` is the overreach. Confidence moderate.
- **X-2 (Home vs History rows): agree.** Same as my C-2, which additionally found the rules have already drifted; X-2 frames it as pure duplication and misses the drift.
- **X-3 (verify window bypasses `useDappHostname`): agree, verified.** `popup/windows/verify/index.vue:53-67` is byte-for-byte the body of `composables/useDappHostname.ts:12-27`; the other three approval windows already call the composable (capabilities:121, discover:53, execute:134). Security-adjacent (anti-phishing), so drift matters more than the ~16 lines suggest. I missed this.
- **X-4 (activation waits): agree.** Same as my C-6.
- **X-5 (restore stages via `never` casts): agree on facts, disagree on smell.** Verified `useFullBackupImport.ts:528,536` casts both injected functions `as never`, and `full-backup-restore.ts:326-339` declares `data: never`. It is type-safety erosion and a circular-import workaround, not duplication; it is valid but outside a dedup run's remit. Fix (move the two functions beside the stages) is sound.

**2. What Codex missed that I still stand by**
- C-1: latest-wins guard hand-rolled beside existing `createRunFence`. Codex's non-findings never mention `runFence`.
- C-3: mint/transfer method-name sets encoded in four places with different answers.
- C-4: Fee Juice USD valuation twice (`feeToUsd` vs `price/convert`).
- C-5: dead production exports kept alive by tests only.
- C-7: scope-key stringifier re-declared in 6 composables with two separators.
- C-8: `normalizeProfileName` inlined x5, malformed-row predicate x3.
Codex's "event-backed composables rejected" and "amount helpers distinct" non-findings do not cover any of these.

**3. Both missed / spot-checks**
- Spot-checked my unread files: `balances.store.ts` holds the only generic `withTimeout` (used 3 times at :495/:506/:546, plus a hand-rolled retry timer at :619 that is domain-specific, not a dup). `useProfileImportFlow.ts:75` has a single setTimeout; no duplication found. `full-backup-helpers.ts`: no clone found in a grep-level pass (not read in depth).
- New 1: **Misplaced generic utility / Feature Envy on a store.** `withTimeout` is exported from `stores/balances.store.ts:124` and leaks through auto-import into every file, so `auth-guard.ts:83` re-wrote it rather than depend on a store. Moving it to `utils/` and deleting `withinDeadline` is a 1-file-move fix, cheaper than X-1's cross-package plan.
- New 2: none with concrete evidence.
