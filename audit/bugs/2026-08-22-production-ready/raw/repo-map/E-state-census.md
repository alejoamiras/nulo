# Map E — State-owner census

> Mapper (explore agent), 2026-08-22. Lock semantics: `Lock` (`packages/wallet-core/src/utils/lock.ts:4-23`) force-releases after 5 min unless `maxHoldMs: null`; `KeyedLock` = per-key `Lock` map.

## 1. Per-service mutable state

| Service | Field | Type | Mutated by | Guard |
|---|---|---|---|---|
| **ProfileService** `services/profile/service.ts` | `pendingRestoreSecrets` :120 | `Map<id,{secret,dek,capturedAt}>` | restore() set :2299; finalizeRestore() delete :2467; deleteProfile delete+zeroize :1256; TTL sweep :164 (30 min) | facade lock :96 |
| | `pendingDekRewraps` :132 | `Map<id,{sourceDek,destDek,capturedAt}>` | restore() set :2171/:2301; consumeDekRewrapContext :189; sweep :173; finalize leftover-zeroize :2381 | facade lock |
| | `deletionState` :214 (shared via getDeletionState :1159 with Execution/Transaction/Journal) | ProfileDeletionState (reserved-id Set + per-profile epoch counters) | initReserved/hydrateDeletion init :278-285; beginDeletion/release/capture/isCurrent/assertCurrent | facade lock all writers |
| | `deletionDelegate`, `integrityDelegate` :217,:220 | nullable delegates | setDeletionDelegate :1063 / setIntegrityDelegate :1068 — called once at last-phase startup | none (unprotected, benign startup-only) |
| **SessionManager** `session-manager.ts` | `activeSession` :97 | ActiveSession? {profile, session, secret:Fr, dek} | open :269, close :319, silentClose :594, restore :543, patchActiveProfile :561 | facade lock injected as runExclusive :118 (alarm close :716 + config TTL path :660 serialize through it); readers getActive/getSecret/getDek LOCK-FREE |
| | `sessionTtl`, `strictSecurityMode` :98,:105 | number/boolean | ctor + onConfigUpdated :616-638 — mutated SYNCHRONOUSLY outside lock (deliberate sync config listener); storage side-effects deferred into runExclusive | partial (flagged) |
| **TokenService** `token/service.ts` | tokens storage handle only; no in-memory cache. Row writes under lock :61 (persistToken :251, updateToken :355, deletes :420, purge :651, restore :678) | | | Lock |
| ↳ TokenSeeder `token/seeder.ts` | inflight/rerunRequested :83-94 | Promise?/bool single-flight coalescing | run() :104 | sync check-then-set |
| | epoch :89 | purge-generation counter | onChainPurged :165, purgeForProfile :181 | unsynchronized int bump, re-checked inside markerLock critical sections (:260) |
| | markerLock :84 | promise-chain mutex | withMarkerLock :138 serializes ALL marker blob RMWs incl. seed commit :259 | promise chain |
| **TokenBalanceService** `token-balance/service.ts` | `tokens` :48 | Map<number, Token> active-profile-only | init fill :127, onActiveProfileChanged clear+rebuild :253-272, token add/update/delete handlers :292/:307/:316, purgeForTokens :344 | generation fence profileGeneration :65 (++ per switch; every handler captures gen before awaits, re-checks after each await). NO lock — fence is the only guard |
| | `invalidatedBalanceIds` :74 | Set<number> deletion fence, never freed within worker lifetime | onTokenDeleted :318, purgeForTokens :331, allocateUnfencedId skip loop :207 | additive set |
| ↳ BalanceJobQueue `balance-job-queue.ts` | queue :59, pendingTasks :60 | Queue<number>, Map<id→taskId> | enqueue :120, reset :97, syncBatch bookkeeping :186-293 identity-checked pointer cleanup :288 | single ticker consumer; no lock |
| | tickerHandle :61 | subscription | start() :75 / stop() :82 | idempotent flag |
| **TransactionService** `transaction/service.ts` | pending :65 | Map<hash, Tx> | init re-arm scan :122, addTransaction :216, worker transitions :443-453, purges :280/:294 | lock :77 write paths; **worker tick reads + collectDroppedDue mutates droppedWatch/droppedNextCheckAt outside any lock** :344-358 (flagged) |
| | droppedStreaks :68 | Map<hash,number> DROPPED debounce | updateTx :400-410 — streak set/delete PRE-lock (documented conservative-on-restart) | unguarded (flagged) |
| | droppedWatch, droppedNextCheckAt :73-74 | resurrection-watch maps | collectDroppedDue (unguarded), guarded persist block :447-453, purges :285-297 | mixed |
| | worker loop runWorker :321 | infinite while(true)+sleep(1000) | — | SW-lifetime; no stop |
| **TaskService** `task/service.ts` | tasks :32 | Map<string, Task> | createTask :75, complete/fail/cancel/start :134-176, cleanupStaleTasks :226 (lazy on read), profile-switch clear :248 | **NO lock anywhere** (flagged); relies on JS atomicity |
| | profile :33 | current profile id | onActiveProfileChanged :245 | none |
| **ContactService** | none in-memory beyond storage + lock :41-42; CRUD under lock :100/:123/:145 | | | Lock |
| **PriceService** `price/service.ts` | generation :89 | kill-switch epoch | onConfigUpdated :219 (sync bump) | entry-time gen captured before awaits; every commit re-checks |
| | inflight :90, abortController :91 | single-flight fetch + abort | refresh :302 identity-guarded clear :309; local controller pattern :333-380 | identity checks |
| | consecutiveFailures, nextAllowedFetchAt, lastCompletedFetchAt :92-99 | backoff/watermark counters | doRefresh success/fail :360-373 | unguarded (single-flight caller only) |
| | configTransition :104 | chained promise serializing enable↔disable tails | onConfigUpdated :231 | promise chain |
| **PasskeyService** `passkey/service.ts` | pending :52 | Map<requestId,{request,handleId}> | openWindowAndWait :124 + finally-delete :126, resolve/reject :93/:105 | no lock (RPC-driven; benign) |
| **DappSessionService** `dapp-session/service.ts` | storage = MAC-wrapped EntityStorage :63; lock :52 | patchSession :169, upgrade :193, applyCapabilityDecision :274, deleteExpired :337, purgeForProfile :356 all under one lock | | Lock |
| **DappInteractionService** `dapp-interaction/service.ts` | storage :63 | Map<id, DappInteraction> pending approvals | registration under lock :64 (interaction() :261); **approve/resolve/reject/cancel mutate outside the lock** :115/:138/:151/:199 (first-claim-wins flags) | partial (flagged) |
| **ExecutionService** — state delegated to collaborators below | | | | |
| ↳ ExecutionLane `execution-lane.ts` | activeControllers :65 | Map<jobId, AbortController> | registerController :90 (sync pre-acquire invariant), deleteController :94, cancelJob abort :187 | sync-only mutations; documented frozen invariants :13-26 |
| | executionMutex :74 → ExecutionMutex (`execution-mutex.ts`) | tails Map FIFO, laneDepth/originDepth Maps (mutex :72-81) | acquire :97 / release :123 (idempotent, sole decrement path) | no lock; synchronous enqueue + promise chaining; NO timeout by design |
| | executionWaiters + executionHeartbeatTimer :81-82 | Set<journalId> + setInterval 30s heartbeat | begin/endExecutionWait :287-302 | timer cleared when set empties :298 |
| ↳ EstimateCancelRegistry `estimate-cancel-registry.ts` | active/pending/settled :80-82 | Maps keyed by estimate token (caps 4 active / 8 parked per profile; TTLs 15 min / 2 min) | admit :111, settle :166, cancel :189, sweep :262, admitNext :241 | no lock; all sync methods |
| ↳ GasBalanceReader `gas-balance-reader.ts` | cache :52, inFlight :57, epoch :63, evictGeneration :68 | TTL(5 min) cache + single-flight map + two invalidation epochs | get :72, markStale/evictAll, compute write-back gated on both epochs :98-103 | epoch fencing instead of a lock |
| ↳ TransferEstimateReuse :125 / OperationEstimateReuse :95 (SingleShotTtlCache `estimate-reuse-shared.ts:18`) | cache Map + per-entry setTimeout(ttl+1) eviction :29 | stash/consume/evict | no lock, TTL 120 s | |
| **OperationJournalService** `operation-journal/service.ts` | transitionLock :89 | global Lock serializing EVERY load→write (transition/touch/meta/delete/refile/purges/create :64-88, applied at :175,:194,:221,:304,:402,:440,:497,:525); only getOperation lock-free | | global Lock |
| ↳ JournalReaper / JournalGC | stateless besides dispatcher/bootCutoff :101-110 | reap passes :178; sweep gc :113 | alarm-driven | |
| **IncomingTransferService** `incoming-transfer/service.ts` | schedulers :141, publicSchedulers :149 | Map<key, setInterval> (note arm per (network,account), public arm per (network,contract); default 30 s) | started by hydrateSchedulers commit :760-772; torn down there + stopPublicScheduler :820 + onAccountDeleted :366 | **NOT under serviceLock** — epoch fencing only (serviceEpoch :170, born-at-epoch guard :783/:809) (flagged) |
| | watchedContracts :143, publicWatched :152, polling :145, publicPolling :150 | contract sets + singleflight sets | hydrate/token handlers/poll entries | same epoch/singleflight guards |
| | classGateCache :155, feeCache :181, syncState :185 | derived caches | scan paths + onAccountAdded reset :324, evictions on purge | serviceLock for most writers |
| | serviceEpoch :170 | lifecycle counter | bumpServiceEpoch :214 from every clear/rebuild | sync bumps |
| **AccountService** `account/service.ts` | tupleLocks :243 | KeyedLock({maxHoldMs:null}) per (profile,chain,type) serializing index allocation | createAccount/ensureDefaultAccount :171/:186 | KeyedLock |
| | restoreLock :74 | backup-restore serialization | restore() | Lock |
| **AccountIntegrityCoordinator** | bootVerification :88 | in-flight boot re-verify promise | start() :82 | single assignment |
| **NetworkService** `network/service.ts` | nodes :196 | Map<chainId, AztecNode> | getOrInitNetworks :257, endpoint/primary changes :429/:458/:551/:592, getNode lazy :647, clears on profile switch :832/:846 | lock :199 for RPC paths |
| | transientNodes :198 | Map<url,{node,failures}> polling pin cache | getNodeForUrl :679 (check-then-set, no lock), reportEndpointFailure :685 (increment + evict at 3, called cross-service from TransactionService.updateTx — UNLOCKED) | flagged |
| **ConfigService/ConfigStore** | config object (store :17) | whole-config in memory | set under store lock :60; **apply() (load/reset) mutates WITHOUT the lock** :81-95 | partial (flagged) |
| **AuthRegistryService** | authwits/statuses storage + lock :55 | writes under lock (recordPendingAuthwits :146 etc.) | | Lock |
| **ProfileDeletionCoordinator** | inflight :60 | Map<profileId, Promise<void>> single-flight purges | runFor :101 | sync check-then-set |
| **LoggerStore** `wallet/logger/store.ts` | logs ring buffer, nextId, logLevel :8-11 | append on every log | log/logWithContext :27/:46, config flip resize :94-99 | no lock (sync appends) |
| | flushTimer :11 | 2 s debounced flush to chrome.storage.session["nulo:logs"] :87 | scheduleFlush :81 | self-clearing one-shot |
| **PxeServiceClient** `pxe/client.ts` | module-level storeKeyProvider/generationProvider :18-20 | registered once at boot (runtime.ts:256,274) | registration fns | module singleton |
| **Wallet-sdk handler** `wallet-sdk/background.ts` (closure state) | pendingVerification :112, pendingDiscoveryPromises :123 (+ caps :561-567), sessionQueues :131 (per-session FIFO chains), establishmentStatus :141 | deleted on session teardown :244-246, discovery settle :639, queue chaining :331 | no locks — per-session FIFO + synchronous check-then-set | |
| **WindowManager** `window-manager/window-manager.ts` | handles :43 | Map<handleId,{resolve,reject,windowId,settled,unsubOnRemoved,timeoutHandle}> | openAndAwait :51, settle/cancel/_settleUserClose :119-192, detach :135 | sync-only; timeout cleared on every exit path |
| Stateless: NoteService, AccountStateService, LogViewerService, ActivityProtocolCoordinator (storage + two KeyedLocks :83-85) | | | | |

## 2. Persistence census (chrome.storage.local unless noted)

| Root | Owner | Kind | Row shape |
|---|---|---|---|
| nulo:core:profiles (profile/repository.ts:24) | ProfileRepository | EntityStorage | key=profileId; {id,name,type,pxeGeneration,dekSealed,walletFingerprint, guard/secret/entropy (password), envelopeMac|credentialId (passkey)} |
| nulo:core:profile-tombstones@<id> (tombstone-repository.ts:4) | TombstoneRepository | RAW stringified JSON (corrupt rows must keep reserving) | {profileId,addresses[],tokenIds[],networkIds[],epoch,pxeGeneration} |
| nulo:core:restore-pending@<id> | RestorePendingRepository | raw JSON | {profileId,pxeGeneration,at} |
| nulo:core:account-integrity-blocked@<id> / -verified@<id> | DUAL WRITER: AccountIntegrityCoordinator (direct write when facade-locked :134; persistIntegrityBlockIfLive off-lock coordinator.ts:118) AND ProfileService (delete-time clears service.ts:1273-1274) | raw JSON | blocked: {profileId,chainId,accountIndex,storedAddress,derivedAddress,walletVersion…}; stamp: {walletVersion,accountSetDigest} |
| nulo:core:session — chrome.storage.session (session-manager.ts:72) | SessionManager exclusively | ValueStorage | {profile, bearer?, since, lockedAt?, passhash?(legacy never accepted)} |
| nulo:config (wallet/config/store.ts:10) | ConfigStore | ValueStorage | whole serialized Config |
| nulo:logs — chrome.storage.session (logger/store.ts:67-87) | LoggerStore | raw | Log[] (last 2000) |
| nulo:liveness — chrome.storage.session (runtime.ts:366,373) | runtime heartbeat | raw | {nulo:liveness: epochMs} |
| nulo:onboarding:tab-id (utils/onboarding-tab.ts:20) | onboarding util | raw | tab id |
| nulo:schema:* (migrator.ts:39-52; migrations/index.ts:45-46) | migration engine | raw | version/running/backup/attempts/blocked/degraded |
| nulo:journal (operation-journal/service.ts:109) | OperationJournalService | EntityStorage | key=16-byte-hex op id; OperationRecord |
| nulo:core:accounts (account/spec.ts:8) | AccountService | EntityStorage | composite key accountRowId(profileId,chainId,address); {profileId,chainId,address,index,type,l1ChainId,name,visible} |
| nulo:core:imported-account-keys (account/spec.ts:87) | ImportedKeysRepository | EntityStorage | same triple key; sealed signing-key blob v2 |
| nulo:core:tokens (token/spec.ts:9) | TokenService | EntityStorage | key=numeric-string id |
| nulo:core:token-seeded@<profileId> (seeder.ts:324) | TokenSeeder | ValueStorage per-profile | Record<"chainId:contract", {attempts,cappedAtVersion?,outcome?,observedDecimals?}> |
| nulo:core:token-balances (token-balance/spec.ts:9) | BalanceRepository | EntityStorage | key=numeric id; balance row |
| nulo:core:token-prices (price/service.ts:29) | PriceService | ValueStorage | PriceState: coingeckoId → validated quote |
| nulo:core:txs (transaction/spec.ts:15) | TransactionService | EntityStorage | key=tx hash; Tx incl. profileId?, submittedEndpointUrl?, ambiguous? |
| nulo:core:dappSessions (dapp-session/service.ts:64) | DappSessionService through MAC wrapper (mac-storage.ts:23) | EntityStorage | key=64-bit hex; row + mac signed per-profile HKDF key |
| nulo:core:contacts (contact/spec.ts:7) | ContactService | EntityStorage | random id |
| nulo:core:fpcs (fpc/spec.ts:8) | FpcService | EntityStorage | random id |
| nulo:core:networks (network/spec.ts:7) | NetworkService | EntityStorage | random id; Network w/ endpoints[] |
| nulo:core:active-network@<profileId> (network/service.ts:50, raw at :938-944) | NetworkService | RAW value | networkId string |
| nulo:core:auth-registry / -enabled (auth-registry/spec.ts:8,15) | AuthRegistryService | EntityStorage ×2 | authwit rows (numeric ids, cap 255/account); enabled-flag rows keyed per account |
| nulo:core:incoming-transfers/-trust/-public-cursors/-balance-outbox (incoming-transfer/repository.ts:32-35) | IncomingTransferRepository | EntityStorage ×4 | record ids kind-prefixed note:/pub:; trust & cursor keys ${profileId}|${networkId}|${contract}; outbox 4-part composite |
| nulo:core:activity-incarnations/-counters/-tombstones (activity-protocol/spec.ts:7-11, coordinator.ts:89-91) | ActivityProtocolCoordinator | EntityStorage ×3 | scope-keyed |

Cross-owner notes: integrity blocked/stamp repos constructed by BOTH ProfileService and the coordinator (deliberate shared ownership); nulo:e2e:* gate keys exist only in tree-shaken E2E builds (runtime.ts:216,230 negative-grep enforced); migration engine may touch any root during migrations (sanctioned, staged ctx).

## 3. Alarms + timers

chrome.alarms (via AlarmDispatcher):
| Name | Scheduler | Cadence | Handler |
|---|---|---|---|
| nulo:core:session:ttl (session-manager.ts:78) | scheduleLockAlarm after open/refresh/restore (:299,:367,:547); cleared on close/TTL-change | one-shot when: lockedAt | onAlarmFired :705 — subscribed DIRECTLY on alarms.onAlarm (:163, bypasses dispatcher for scheduledTime access); staleness gate alarm.scheduledTime === deriveLockedAt, close under runExclusive |
| nulo:price:refresh (price/service.ts:24) | ensureAlarm periodInMinutes=3 (:258); created on unlock+fiat-enabled, cleared on lock/disable/boot reconcile :126-132 | periodic 3 min | dispatched ONLY by module-scope shim wallet/index.ts:91-99 → PriceService.onAlarmTick :177 (single dispatch path; service itself does not listen) |
| nulo:journal:reap (reaper.ts:50) | reaper.start :139, periodInMinutes=1; unconditional boot sweep :150 | periodic 1 min | dispatcher.listen(() => this.reap()) :135 — non-terminal records past per-stage grace → failed |
| nulo:journal:gc (gc.ts:38) | JournalGC.start :92, periodInMinutes=60 + boot sweep :94 | hourly | dispatcher.listen(() => this.sweep()) :88 — evicts oldest succeeded past 50/scope |

setInterval/setTimeout:
- runtime.ts:371 heartbeat setInterval 10 s → chrome.storage.session["nulo:liveness"]; never cleared (SW-lifetime).
- transaction/service.ts:322,338 worker while(true)+sleep(1000); SW-lifetime no stop.
- balance-job-queue.ts:75-85 ticker @1 s; stop() exists but nothing calls it.
- incoming-transfer/service.ts:784,810 two families of setInterval (default 30 s) tracked in schedulers/publicSchedulers; torn down wholesale on hydrateSchedulers commit :760-764, per-key on deletion (:366, :820); stale ticks fenced by bornAtEpoch compare :785,:811.
- execution-lane.ts:290 queued-wait heartbeat setInterval 30 s while executionWaiters non-empty; cleared in endExecutionWait when empty :298-301 — properly paired.
- estimate-reuse-shared.ts:29 per-entry setTimeout(ttl+1) eviction — fire-and-forget, not individually cancelled.
- price/service.ts:335 fetch-abort setTimeout(10 s) — cleared in finally :377.
- window-manager.ts:76 per-window timeout (5 min passkey / 10 min interaction) — cleared on settle/cancel/user-close/detach (:139,:154,:173).
- logger/store.ts:83 2 s debounce flush — one-shot self-clearing.
- Inline sleep() loops (transaction waitForTx:225, gas-balance-reader.ts:222) — bounded.

## Event graph (emitter → in-SW listener)

- ProfileService.onActiveProfileChanged ← TaskService (clear map :43), TokenService seeder (:115), TokenBalanceService (:118 rebuild+queue reset), IncomingTransferService (:265 rehydrate), NetworkService (:218 node-cache clear), PriceService (:121 alarm ensure/clear). SessionManager feeds it via onChange callback (service.ts:249).
- ProfileService.onImportedKeysDegraded → popup only. onProfileDeleted has NO in-SW subscriber — deletion cleanup moved to awaited coordinator (comments contact/service.ts:64, account/service.ts:107, dapp-session/service.ts:72).
- TokenService.onTokenAdded/Updated/Deleted ← TokenBalanceService (:120-122), IncomingTransferService (:256-257).
- AccountService.onAccountAdded/Deleted ← TokenBalanceService (:119), TransactionService (:111), IncomingTransferService (:274-275), AuthRegistryService (:84, anonymous arrow — unremovable).
- NetworkService.registerChainPurgeSubscriber ← TokenService (:93), AccountService (:110), FpcService (:84), OperationJournalService (:124), IncomingTransferService (:283, anonymous). Plus onChainPurged event emitted alongside.
- TransactionService.onTransactionAdded/Updated ← IncomingTransferService (:258), TokenBalanceService (:123), AuthRegistryService (:93, anonymous arrow).
- ConfigStore.onUpdate ← ConfigService re-emit (service.ts:41), SessionManager.onConfigUpdated (:147 — unsubscribe handle deliberately discarded :160-163), LoggerStore (:16). ConfigService.onUpdate ← PriceService (:120).
- LoggerStore.onLog ← LogViewerService (ctor :20). NetworkService.onActiveNetworkChanged ← TokenService seeder (:116).

Subscription-without-removal finding: no background service implements dispose/teardown — every .add() is permanent for SW lifetime (consistent MV3 singleton posture). Two anonymous closures (AuthRegistryService) can't be removed if ever needed; everything else keeps named handler refs that would support removal but has none.
