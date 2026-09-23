# Map G — Popup UI + onboarding state

> Mapper (explore agent), 2026-08-22.

## 1. Pinia stores

### stores/app.store.ts — root state container
| State | Kind | Sync |
|---|---|---|
| profile, profiles, account, accounts, network, networks, networkStatus | cache | Written by useProfileBootstrap (initNetworks/initAccount: getOrInitNetworks, getActiveNetwork, setActiveNetwork, ensureDefaultAccount, getAccounts) + app.vue watchers; syncNetworkStatus → getNodeStatus (app.store.ts:180-189) |
| isLogined, isSessionChecked, pageAwaitingAuth, isLoading, _isHomeScreenOpened, displayOption, isPrivacyModeEnabled, defaultExplorer | UI-only | Flipped by shells/auth flow; defaultExplorer set only from config event (popup/app.vue:70-72); dappSessions = ref([]) dead stub (app.store.ts:425) |
| onboardingCompleted | persisted UI flag | Direct storageLocalGet/Set("nulo:onboarding:completed") (app.store.ts:32-41) |
| activity feed (via useActivityStore) | per-scope cache | see below |
| inFlightOps / hasInFlightSend | cache | One app-lifetime OperationJournalServiceClient (app.store.ts:225): subscribes onOperationAdded/Updated/Deleted + re-read on onConnected; refreshInFlight() → getOperations({profileId}) (247-289). Watcher on profile.id resets readiness (292-299) |

Direct writes bypassing a service round-trip: selectAccount writes durable pointer nulo:ui:activeAccount straight to chrome.storage with NO scope guard (app.store.ts:133-138) — unlike setupActiveAccount (77-132) which fences through commitScopeChange + activation epoch/scope capture. changeAccountVisibility/updateAccount mutate local accounts[] after RPCs (139-174).
Scope-change guard: commitScopeChange(commit) refuses any account/network re-point while hasInFlightSend — synchronous commit callback, fresh journal read immediately before (app.store.ts:319-327). setupActiveAccount layers monotonic activationEpoch + captured (profile,network) scope over it (76-81), re-checked before durable pointer write (127).

### stores/activity.store.ts — per-scope tx cache
- slices: Map<scopeKey, ActivitySlice> (shallowRef + triggerRef), LRU-evicted at 32, slices holding optimistic placeholders exempt (34, 187-205).
- Fences: per-scope mutationVersion from store-lifetime mutationSeq + incarnation baseline advanced by clear* — fetch capturing version before an await dropped if any event landed between (109-154, 241-251). Fetch loop in app.store.syncTransactions retries up to 4× backoff when install loses race (app.store.ts:389-423).
- Routing: txScope() routes each tx to OWN scope; unscoped legacy rows attributed to reference scope only under soleProfile (70-101).
- Optimistic AwaitingTx placeholders added by send.vue, removed by id on rejection, settled by primary-call match on onTxAdded (app.store.ts:367-383).
- clearAll() on lock/switch — deliberate cold start (329-340).

### stores/balances.store.ts — fee-juice + FPC cache
- App-lifetime clients at store init: ExecutionServiceClient, FpcServiceClient, TransactionServiceClient (155-164; tx subscription lazily via ensureTxSubscription).
- Entries keyed (profileId,networkId,chainId,address); gas slice splits SWR display vs gating-grade verified (52-63); signals version/retryVersion/forcedVersion/retryDebt.
- Profile fence: epoch bump + entry clear called synchronously by app-shell watcher (belt, 620-628) and by last-subscriber release (suspenders, 296-303). Superseded ensures throw typed EnsureSuperseded (98-105).
- Raw-RPC single-flight reuse across timed-out attempts (rawReuse 334-349); forced refreshes never join pre-trigger flights (379-397); retry backoff [5s,10s,20s,30s] runs only while retry-capable subscriber holds key (547-599); tx-settle forces getGasBalances(forceRefresh) for txRefresh keys (601-611).

### stores/cache.store.ts — pure UI scratch
Untyped reactive({}) slots incl. closures: confirm (title/description/callback), incomingTrust (Allow/Reject closures written by PopupManager:92-102), edit-target indexes, preselections, import scratch (importType, importContacts, importPromise), failureLog, viewerData.

### stores/popup.store.ts — UI-only. Open-popup registry {name:{order,payload}}; payloads survive while popup object exists.
### stores/notification.store.ts — UI-only serial modal queue; auto-destroy timers.

## 2. Composables

C1 service-bound: useEntityCrud (seq-fenced refresh, dispose removes handlers + onScopeDispose 118-133); usePrices (receives CONNECTED PriceServiceClient, subscribes onQuotesUpdated + onConnected→resnapshot, 30s ticker, explicit dispose 92-95); useFeeEstimation/useFeeEstimationMap (debounced token-minted remote-cancellable over shared engine internal/fee-estimation-engine; handoff()/handoffAll()+rearm() transfer estimate ownership to execution so unmount cleanup can't cancel submitted op; engine disposed via onScopeDispose); useIncomingTransfers (sync-reset flush:'sync' on scope change, seq+scope-key stale-fetch rejection 71-81, live-scope containment of foreign events 87-90, dispose 137-147); useDappInteractionPayload (loads payload, replays late cancels via isInteractionCancelled; disposed guards post-await writes; dispose removes cancelled handler); useDappApprovalWindow (connect → session-wait → auth redirect → init() → register beforeunload AFTER init resolves 131; closeWindow(true) removes listener, bare close leaves it to deliver rejection via unload 96-100; dispose disconnects then removes listener last 134-137); useProfileCreateFlow/useProfileImportFlow (orchestrate against shared managers.profile; latch-first submit handlers; inject onCreated/completeImport; expose dispose — name-field shake timer); useFullBackupImport (constructs+disconnects own per-run clients inside restoreBackup; try/finally disconnect at 785-787, 794-796, 833-842, 907-909, 980-983); fullscreenPopupSetting (own ConfigServiceClient, self-disposes onBeforeUnmount).

C0 pure: useFormState (per-field refs, sync proxy mirror, touched/dirty/baseline+rebase); useProfileNameField (C0 but owns shake timer; parent MUST dispose 165-168); usePasskeyCeremony (one-shot promise wrapper; rejects second concurrent ceremony 41-43); useSecretCountdown (timers; onScopeDispose clear 50); useSecretClipboardCopy (deliberately NO dispose: 60s clipboard-scrub timer must outlive route-nav, doc 18-26); ticker (ref-counted shared interval; owns its own onUnmounted — C0 carve-out); syncedRef.js (storage-backed ref; adds chrome.storage.onChanged listener NEVER removed, line 20); toast/outside (re-export shims); waitForProfileActive (watch-promise timer teardown both paths 35-45); completeImportWithRecovery/importChainSync/importPreflight (pure orchestrators); useDappHostname (computed hostname + IDN/xn-- suspicion flag); usePopupEntity (§3).

Self-connect/disconnect violations: none found in C1.

## 3. usePopupEntity (composables/usePopupEntity.ts)
- Enter lifecycle: async watch(show); SHOW installs document keydown listener FIRST then awaits onShow; HIDE removes listener then awaits onHide (78-99). submitWaitsForShow keeps Enter inert until onShow fulfills — token-guarded (pendingShowToken) so stale show's settle can't open newer show's gate; rejected population keeps gate closed (67-94).
- Enter predicate isPopupSubmitKey — only Enter while target input/textarea (9-13). Scope-dispose removes listener (100).
- Submit latches live IN THE POPUPS not here (e.g. NewContactPopup full-lifetime isLoading latch read by isAvailableToAddContact, NewContactPopup.vue:82-90, 99-122).
- Consumers (12 popups): New/EditContact (:127/:165), New/EditAccount (:97/:75), New/EditEndpoint (:67/:82), New/EditNetwork (:134/:87), New/EditFpc (:99/:159), EditProfile (:92), NewSender (:81). submitWaitsForShow:true only Fpc pair + EditContact; NewContact deliberately keeps listener-before-population timing (pinned bug, NewContactPopup.vue:124-126).
- No per-entity single-flight/generation machinery beyond show-token.

## 4. popup/app.vue orchestration
- Boot onBeforeMount (193-200): router.isReady() → configService.getProps() → loadProfile().
- loadProfile (156-191): subscribes onActiveProfileChanged → bootstrap truthy branch / lock falsy branch (closeAll, isLogined=false, clearActivity(), refetch profiles, route auth/register — 133-146) and onImportedKeysDegraded toast; getProfiles()+getActiveProfile(); active ⇒ bootstrapActiveProfile, isSessionChecked=true, advance to /popup/general only if shouldAdvanceToGeneral (entry-route allowlist popup/should-advance-to-general.ts:19-21). No active ⇒ preselect last-active, route /popup/auth.
- isBackgroundConnected watcher (248-255): reconnect re-runs loadProfile(); popup reopen = fresh mount of same path.
- Account watcher (88-97): any appStore.account change fire-and-forget syncTransactions(). Network watcher (100-131): disconnects + REPLACES managers.account, refetches accounts, auto-creates default if empty, setupActiveAccount(), syncTransactions() — **no generation fence** here (unlike B-27 in useProfileBootstrap): rapid network flips can interleave client replacement.
- Keep-alive poll (230-234): 10s interval getActiveProfile() result discarded; cleared on unmount.
- Route watcher (237-246): unawaited refreshSession() on nav; home-screen flag.
- In-flight work vs SW restart: send progress survives via durable journal; page navigates away immediately after submit. Import completion has explicit recovery (completeImportWithRecovery).

## 5. Onboarding shell
- Entry index.ts: hash router over ~pages; / redirects welcome; logger wiring; initAppServiceContext eager.
- Shell app.vue: theme bootstrap mirrors popup; onMounted (52-72): load onboardingCompleted → completed ⇒ spawn popup window close tab; else hydrateKnownProfile() — active ⇒ jump learn; profiles exist ⇒ popup; else welcome. Own teleport anchors (#popup etc.) so PasskeyCeremonyDialog works.
- Flow: welcome → create|import → learn → fees → accelerator (detection gate: Continue enabled only on active; skip always allowed, accelerator.vue:13,57-66) → done.
- Create pages/create.vue: name + roving-tablist method toggle + password fields; useProfileCreateFlow; onCreated = bootstrapActiveProfile → setLastActiveProfileId → setSentinel → /onboarding/learn (48-55); zero secrets on unmount (98-104). Passkey create via createPasskeyProfileWithRetry (ProfileIdConflictError retry-once).
- Import pages/import.vue: method picker → seed form (importMnemonic), passkey discovery get (importPasskey), or full backup (ImportFullBackupForm → decrypt/restore machine). Duplicate-phrase guard UX: typed DuplicateWalletError → warn-and-confirm ConfirmPopup ("Add anyway") → retry once allowDuplicate=true (withDuplicateConfirm, useProfileImportFlow.ts:80-120). completeImport = direct bootstrap as wait-for-active + recovery re-hydrate (lines 41-55). Secrets zeroed on unmount (124-130).
- Recovery phrase display/copy NOT present during onboarding (no reveal step — done.vue straight to pin-tip + open wallet; openWallet sets onboardingCompleted, clears tab tracking, asks SW nulo:open-toolbar-popup, falls back spawning popup window, done.vue:23-67).

## 6. Key pages/windows

Send flow (popup/pages/send.vue): identity-scoped fetch on mount + (profile,network,account) triple change, seq-guarded (identityFetchSeq 442-478); tokens/balances/contacts live via service events (74-171). validateSendAmount against raw base-unit balance drives submit gate AND estimation (185-199, 231-238). FeeSettingsCard subscribes balancesStore caps {legs:[gas,fpc],retry:true}; snapshot commit copies store entry into local refs, reconciles saved/default method, opens isInitComplete gate (288-339); zero-balance fee-juice flips Send CTA to "Get Fee Juice" (143-161, 606-614). useFeeEstimation debounced 800ms over inputs watcher (408-433); submit hands off consumable estimate id (handoffFeeEstimate 331-332). Fiat gate frozen session quote + fail-closed evaluateFiatGate, re-checked true wall-clock on click (213-229, 302-311). Submit: optimistic placeholder UUID, fire-and-forget executeTransfer with .then/.catch/.finally owning teardown; navigate away immediately; submitInFlight prevents unmount disconnecting pending RPC (248-264, 299-385, 507-533).

Account export (#433): settings/security/export/account.vue stages "" → ready|protected (fileStatus); password-gated exportAccount(..., protect); download via downloadFile (chrome.downloads-safe filename sanitizer, 164-188); generation fence bumped reset/edit/unmount so late export RPCs can't repopulate after scrub (57-71, 200-207); deep-link ?address= watched + resets (73-91).
Seed export (.../export/seed.vue): agreement → unlock exportMnemonic → reveal 5-min auto-close countdown + copy w/ 60s clipboard scrub; secret nulled on unmount (84-89).
Full-backup export (.../export/full.vue): builds envelope (compat-epoch + backup-schema-version + master-key + entropy/DEK carriers + active-network-id), slices backed per-service, checksummed; encrypt stage → gzip download. Passkey auto-fire ceremony on agree.
Account import (settings/accounts/import.vue): pick file → previewImportAccount address preview → confirm importAccount with scope-snapshot staleness checks around every await; edits invalidate previewed address via generation bump (44-140); pushes imported account into appStore.accounts and WRITES ACTIVE POINTER DIRECTLY (110-113).

useFullBackupImport stage machine (RestoreStage lines 52-66):
1. picked → parse/sanitize embedded name (401-448); encrypted need decryptBackup first (450-481).
2. restoring:profile — validateAndMigrateBackup checksum → compat-epoch → schema-version range → in-memory migration BEFORE any live write (116-181); passkey backups run ceremony for credentialData (577-598); restore secret discriminated by type (609-657); re-entrancy guard restoreStatus==="progress" (497).
3. restoring:networks → index-paired remap + active-network restore (680-743); zero-networks ⇒ bounded rollback (688-699).
4. Accounts restoreAccountsAndFilterOwnedSlices: drop account-owned rows not imported THIS restore (196-256); duplicate-account catch rolls back (760-784); imported-keys slice next (753-759).
5. restoring:tokens + balance re-link chain-equality cross-check (789-812); restoring:services loop whole-loop try/finally disconnects (817-842).
6. finalizing → finalizeRestore opens session (862-870); THEN restoring:account-state + chain-sync — the one network-dialing leg bounded runImportChainSync (45s total budget; preflight ≤21s exponential-backoff probes, registration ≤30s raced at exact remainder; every failure lands in error log nothing throws) (importChainSync.ts:29-34, 95-109; importPreflight.ts).
7. Liveness gates: rollback after disconnect-classified failure waits for SW heartbeat ADVANCE (readLiveness → awaitLivenessAdvance ceiling 60s) before compensating delete; failure fails CLOSED to rollback-failed + actionable cleanup-pending message (929-973). Post-finalize failures keep profile (bookkeeping flags createdProfileId/finalizeStarted, 536-563).

Settings surfaces mutating config: settings/appearance.vue (toggle map + strict-parse dust threshold 74-110), settings/security/index.vue (sessionTtl, strictSecurityMode toggle 55-100), settings/advanced/index.vue (generic toggle map :102). Popup shell applies side-effectful settings live via configService.onUpdate in app.vue (theme/animations/sidePanel/explorer 52-79).

## 7. UI-layer hazard candidates (file:line only)

- popup/app.vue:100-131 — network watcher replaces managers.account across awaits NO supersede fence (B-27 exists only in useProfileBootstrap); rapid network flips can interleave client swaps.
- popup/app.vue:88-97 & :237-246 — unawaited promises in watchers (syncTransactions(), refreshSession()).
- popup/pages/auth.vue:82-84 — busy-wait while (!appStore.isLogined) await sleep(100): infinite spin if activation event never arrives (SW restart between unlock and emit).
- composables/notification.js:27-28 — aztecReset confirm closure reads appStore.profile.id AT CLICK TIME: profile switch between render and confirm deletes whatever profile is current; line 46 appStore.profiles.length && appStore.profiles[0] yields false into ProfileInfo slot.
- composables/syncedRef.js:20 — storage.onChanged listener never removed.
- popup/pages/settings/security/export/full.vue:102-203 — handleBackup no re-entrancy guard (backupStatus "progress" only at :164 after passkey/password awaits; button :438 and Enter default branch :256 can double-fire) AND slice loop :193-198 no try/finally: throwing .backup() leaks client port + skips rest without disconnect.
- composables/useProfileCreateFlow.ts:108-113 — documented: onCreated throw leaves isCreating latched (button stuck "Creating…").
- NewSenderPopup/others using usePopupEntity without submitWaitsForShow — premature-submit risk pattern.
- popup/components/popups/PopupManager.vue:58,174 — module-lifetime queue + replayedForKey triple dedup; documented residual A→B→A replay race (169-173).
- popup/app.vue:230-234 — keep-alive poll result discarded masks unlock-expiry signals from this path.
- stores/cache.store.ts whole file — untyped shared reactive slots holding closures; any writer can clobber another popup's pending dialog state; consumers cast blindly (useProfileImportFlow.ts:62-69).
- popup/pages/send.vue:397-406 — deep watcher on whole tokens array only for awaitingNewToken; harmless but re-fires per balance-event identity churn.
- composables/ticker.ts:29-35 — owns onUnmounted directly (sanctioned carve-out).
