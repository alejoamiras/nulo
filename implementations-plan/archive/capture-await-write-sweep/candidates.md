# Candidates — pass-1 enumeration (consolidated)

Six read-only agents each fully read their recon.md §5 slice (coverage: every file ✓, none partial) and returned every capture→await→write instance in the format READ/AWAIT/WRITE/GUARD/NOTE. This file is the committed condensed record — one line per candidate, ID'd `<file-key>#n` for the triage join. Verdicts live in `triage.md` (same IDs; row-count parity is the phase-2 gate). Pass-2 (async-boundary) and pass-3 (score-0/1 re-screen + extension-messaging + promoted files) candidates are appended in their own sections.

Legend: R=state read · A=await crossed · W=dependent write · G=visible guard (agent-observed; sufficiency judged at triage).

## Slice 1

**profile/service.ts** (`prof`)
- prof#1 L178-195 sweepStalePendingRestore — sync zeroizing counterparty; doc-contract "under facade lock". G:contract-only
- prof#2 L203-223 consumeDekRewrapContext — R:pendingDekRewraps A:pre-lock ensureInitialized W:map delete+TTL zeroize G:runExclusive body
- prof#3 L285-337 init — R:tombstones/restored session A:tombstone reads, restore, isBlocked W:initReserved/hydrate, close() G:none; close targets NOW-active not verdict's session
- prof#4 L310-326 init restore-callback — R:repo row+isReserved A:restorePending get/delete W:profile → session rehydrate G:isReserved+marker-gen compare; row predates marker await
- prof#5 L355-364 captureExecutionFence — helper-returned {profileId,epoch}; atomic under runExclusive (D13 core)
- prof#6 L366-370 getProfiles — R:getAll+live isReserved filter at different instants A:getAll W:RPC response G:none
- prof#7 L372-430 createProfile — R:dup verdict+nextUnreservedId A:fingerprint/id/MAC W:repo.set+emit+open G:whole commit under runExclusive
- prof#8 L438-550 unlockProfile — 3-phase snapshot/slow-unlocked/revalidate-under-lock; phase-3 current captured before DEK awaits then opened. G:refetch+isReserved+byte-compares
- prof#9 L556-559 generateProfileId — returns UNRESERVED id consumed after a whole WebAuthn ceremony G:none here (documented caller contract)
- prof#10 L561-617 createPasskeyProfile — R:id pre-ceremony A:WebAuthn minutes W:repo.set+open G:under-lock contains||isReserved re-verify → ProfileIdConflictError
- prof#11 L625-635 getPasskeyCredentialId — locked read consumed across out-of-process ceremony
- prof#12 L637-737 unlockPasskeyProfile — phase-3 current captured before fingerprint/DEK awaits G:refetch+credentialId-rotation compare
- prof#13 L739-755 importPasskey — ceremony result consumed after multi-minute window; checks live in callee's lock
- prof#14 L784-797 lockActiveProfile — post-close read-back verdict after await G:runExclusive (5-min watchdog caveat)
- prof#15 L805-812 lockProfileIfActive — R:isActive check A:then close W:closes CURRENT session G:check+close in one runExclusive
- prof#16 L822-828 persistIntegrityBlockIfLive — isReserved evaluated before repo.get await; record built off-lock G:facade lock shared with deleteProfile's block-clear
- prof#17 L838-858 deriveDappSessionMacKey — R:getSecret A:HKDF W:returns MAC key used to sign rows G:NO facade lock, NO isReserved
- prof#18 L860-865 refreshSession — writes whatever session is active at execution G:runExclusive
- prof#19 L867-884 changeProfileName — whole-row get→set under runExclusive; reverts non-facade-writer fields
- prof#20 L886-1028 changeProfilePassword — seconds of crypto awaits between row read and whole-row write G:runExclusive+MAC-covers-DEK+pre-persist verify; delegate call is reentrancy seam
- prof#21 L1035-1098 confirmProfileOperation — TOCTOU on authorization itself: post-op recheck under lock but caller's write is a later separately-locked RPC G:snapshot+capturedEpoch+recheck
- prof#22 L1119-1192 openSessionVerified — opens with caller's pre-await row snapshot G:pre-open isReserved + post-open isReserved/isCurrent + isActive invariant
- prof#23 L1203-1207 nextUnreservedId — reserve-nothing allocator; uniqueness true only at return instant
- prof#24 L1229-1341 deleteProfile — rows snapshot taken BEFORE tombstone/reservation exists (creation gap not purged); phase-2 cascade off-lock G:epoch-CAS clearIfSame, tornGuard tuple
- prof#25 L1364-1465 resumePendingDeletions — snapshot loop over validPayloads/validMarkers acted on after many awaits G:per-item runExclusive, clearIfSame, deleteIfSame, age floors
- prof#26 L1467-1482 importMnemonic — commit in callee's locked section
- prof#27 L1484-1612 exportPlain — post-ceremony recheck at L1550-1563 runs WITHOUT re-entering runExclusive (exportMnemonic's is under lock) G:refetch+isReserved+isCurrent+rotation compare
- prof#28 L1620-1703 exportBackupMaterial — DEK unsealed from PRE-await profile.dekSealed, not the re-fetched `still` G:still refetch+isReserved+isCurrent, off-lock
- prof#29 L1707-1716 getProfileDekSealed — locked read consumed by backup builder later
- prof#30 L1721-1765 exportImportedKeysDek — same stale-dekSealed shape as prof#28
- prof#31 L1770-1776 getProfileDek — pre-lock await only G:runExclusive+isReserved
- prof#32 L1778-1830 exportMnemonic — words derived from pre-await entropy G:post-derivation recheck INSIDE runExclusive
- prof#33 L1917-1928 assertNotDuplicateWallet — helper verdict consumed after further awaits G:callers run under commit lock
- prof#34 L1936-1943 assertNotDuplicateCredential — check-before-await authorization G:caller's lock
- prof#35 L1945-1953 getProfileSecret — consumer holds secret across later awaits G:runExclusive+isReserved
- prof#36 L1961-1967 getPxeGeneration — D4 fence value consumed by provision path later G:locked read
- prof#37 L1974-2014 importPasswordProfile — id+fingerprint captured before 3 crypto awaits G:whole body runExclusive
- prof#38 L2020-2069 importPasskeyProfile — contains check then two awaited dup checks before write G:runExclusive
- prof#39 L2100-2107 restore name-alloc — runs OUTSIDE runExclusive; two concurrent restores can mint same display name G:none
- prof#40 L2163-2259 restore password branch — id settled several awaits before row lands G:runExclusive; marker-before-row; sweep excludes id
- prof#41 L2277-2378 restore passkey branch — long unlocked ceremony+DEK window feeds locked write G:locked tail; credentialId bind; expected tuple
- prof#42 L2426-2589 finalizeRestore — session opens against entry-read profile snapshot G:runExclusive; entry-delete B-11; expected tuple+fingerprint

**wallet-core/migration/migrator.ts** (`migr`)
- migr#1 L135-153 run — attemptRecorded instance flag; second overlapping run() resets mid-flight G:none (comment per-RUN)
- migr#2 L155-198 runInner — fresh-install version-set authorized by pre-write `in all` check G:barrier spans run
- migr#3 L221-282 applyOne — snapshot→backup→up()→commit; concurrent-actor row reverted by stale backup on restore G:stamped flag; guardCommit footprint
- migr#4 L300-381 resumeIfInterrupted — destructive restore authorized by pre-await version compare G:isValidBackup/marker, version range, counted-first
- migr#5 L389-400 restore — toRemove computed before the set; key created between the two calls missed/removed by ordering G:reserved-prefix filter
- migr#6 L409-419 bumpAttempts — read-modify-write on durable counter (terminalization authority) G:corrupt-reset only
- migr#7 L433-451 footprintKeysFor/snapshot — two-phase keys-then-values with await between G:none

**dapp-session/service.ts** (`dses`)
- dses#1 L75-80 getDappSessions — profile captured before deleteExpired; switch yields departed-profile rows G:none
- dses#2 L82-99 getDappSession/tryGet — isExpired may delete+emit from snapshot; returns possibly-just-deleted row G:contains recheck in isExpired
- dses#3 L114-139 tryGetByOriginAndChain — snapshot loop w/ per-item expiry deletes; returned row routes dApp RPC later G:forProfileId anchor on dispatch path
- dses#4 L141-169 addDappSession — profile.id captured before deleteExpired+lock; switch files session under departed profile G:lock covers id-mint→write only
- dses#5 L178-187 patchSession — get→mutate→set under lock; setter values computed from older row G:lock
- dses#6 L202-221 upgradeDappSession — contains(newSessionId) check 3 awaits from its write G:lock
- dses#7 L283-317 applyCapabilityDecision — popup-era decision merged; same-type concurrent approvals last-completion-wins G:lock+delta-merge vs LATEST row (B-14)
- dses#8 L319-330 deleteDappSession — emit carries pre-delete snapshot G:lock
- dses#9 L332-344 isExpired — deletes by caller-captured id possibly many awaits old G:contains recheck under lock
- dses#10 L346-359 deleteExpired — snapshot sweep, no per-item recheck (purgeRows unconditional) G:lock
- dses#11 L363-383 purgeForProfile — raw rowsForProfile snapshot loop during off-lock cascade G:lock; true-storageId deletes

**token-balance/balance-job-queue.ts** (`bjq`)
- bjq#1 L150-168 tick — batch dequeued before await; reset() mid-await clears queue not in-flight batch G:fences live in syncBatch
- bjq#2 L173-195 writeSyncFailure — get→set from current; emits pre-write snapshot after awaited write G:isRowEmittable+invalidated+gen checked awaitlessly pre-write
- bjq#3 L197-316 syncBatch — gen+owned captured before projector flight; catch path writes failures with same stale gen G:invalidated+emittable+gen before EACH write; owned identity task ops; identity-checked finally

**wallet-sdk/queued-journal.ts** (`qj`)
- qj#1 L108-225 tryCreateQueuedJournal — caps read then create atomic only vs this module's lock G:stamp gate+anchored reads+pre-persist revalidation+profileEpoch assert
- qj#2 L250-266 failQueuedIfUnclaimed — record id captured long before; CAS re-read under journal lock G:transitionIfStage(["queued"])

**operation-journal/reaper.ts** (`reap`)
- reap#1 L127-154 start — bootCutoff captured first stmt; records in capture→sweep gap protected only by createdAt compare G:B-03 cutoff
- reap#2 L178-241 reap — snapshot loop; age/kind/reason computed pre-loop G:per-op CAS transitionIfStage + ifUpdatedAtIs on periodic

**aztec-runtime/pxe/artifact-registry.ts** (`areg`)
- areg#1 L109-112 ensureKnown — known repopulated by loader succeeding after concurrent clear() (file comment records hole) G:memo identity on rejection only
- areg#2 L122-125 hasKnownClassId — field read post-await; clear() between yields false for bundled class G:none
- areg#3 L159-192 resolve — policy captured at entry; setPolicy/clear between capture and source loop G:classId recompute pxe-local branch
- areg#4 L200-212 verifyAndCache — clear() during verification silently undone by post-await add (cache resurrection) G:none

**execution/contract-resolver.ts** (`cres`)
- cres#1 L67-77 ensureRegistered — check-then-register TOCTOU vs any other PXE registrant G:none
- cres#2 L151-172 ensureContractsRegistered — single getContracts snapshot; no per-item recheck (documented) G:none
- cres#3 L114-134/177-202 resolveInstance(s)/resolveArtifacts — helper snapshots of chain state consumed post-await G:none

**composables/internal/fee-estimation-engine.ts** (`fee`)
- fee#1 L127-152 debounced timer body — inflight.delete/completed.set after await touch whatever entry key now holds; guard is counter not token identity G:disposed+myCounter staleness on every branch; handedOff consulted

**incoming-transfer/public-event-indexer.ts** (`pei`)
- pei#1 L78-125 scan — helper-returned cursor-advance snapshot; consuming write in service G:cross-page monotonicity, pinned toBlock
- pei#2 L136-146 probe — throw/no-throw verdict authorizes caller's write G:ancestor hash
- pei#3 L62-68 getTips/getClassStatus — tips consumed by watermark writes later G:none

**passkey/service.ts** (`pass`)
- pass#1 L96-106 resolvePasskeyRequest — entry captured; after create() await settles handle with NO liveness re-check G:none
- pass#2 L108-114 rejectPasskeyRequest — sync post-capture; RPC boundary only interleave
- pass#3 L116-135 openWindowAndWait — finally pending.delete(id) NOT identity-checked; re-minted same 8-hex id could delete newer entry G:none

**profile/restore-pending-repository.ts** (`rpr`)
- rpr#1 L72-80 deleteIfSame — tuple compare pre-await; fresh same-id marker written between compare and remove still erased G:tuple compare (no CAS)
- rpr#2 L84-120 validMarkers/corruptIds — separate keyspace reads can disagree; snapshots drive torn-import reap G:decodable-only

**aztec-runtime/pxe/artifact-catalog.ts** (`acat`)
- acat#1 L91-108 catalogMemo+cache — test-only reset mid-flight = not re-cached (no stale write) G:memo identity-guarded

**config/service.ts** (`cfgs`)
- cfgs#1 L64-87 restore — snapshot loop, no per-item recheck; user toggle mid-restore clobbered by backup value G:F-06 allowlist; per-item restoreError

**composables/importPreflight.ts** (`ipre`)
- ipre#1 L33-81 probeOneNetwork/preflight — point-in-time verdicts consumed after further awaits; Map write post-await keyed by captured networkId G:deadline re-reads; sync shift()

**wallet-sdk/discovery-approval.ts** (`dapp`)
- dapp#1 L24-68 approveOrRollbackDiscoverySession — approve branch has no post-await profile re-check; approverProfileId stamped from pre-write capture G:freshness re-check; approve-failure compensating delete

**wallet-core/utils/alarm-dispatcher.ts** (`alrm`)
- alrm#1 L41-46 listen — second listen() overwrites #unsubscribe, orphaning first subscription (stop can't detach) G:documented call-once contract
- alrm#2 L59-63 stop — create() landing during clear() await → armed alarm with no listener (or vice versa) G:none

**restore-fence.ts / composables/runFence.ts** — none (fence primitives; caller-side discipline judged at their sites)

## Slice 2

**incoming-transfer/service.ts** (`inc`)
- inc#1 L218-296 init — SW-restart init racing early switch installs schedulers for changed profile G:hydrate's own epoch fence
- inc#2 L298-300 onActiveProfileChanged — two rapid switches interleave rebuilds G:hydrate epoch
- inc#3 L302-335 onAccountAdded — profile/networks/tokens captured PRE-lock; locked reset writes cursors for stale set G:epoch bump first in lock; no re-read under lock
- inc#4 L337-387 onAccountDeleted — pre-lock activeProfile scopes scheduler kill; snapshot delete loop no per-record recheck G:lock; epoch bump AFTER wipe
- inc#5 L391-413 getIncomingTransfers — visibility gate precedes 4+ awaits G:fail-closed read
- inc#6 L422-429 getIncomingTransferById — isolation check TOCTOU across two reads G:scope compare after both
- inc#7 L442-476 getReceiptFee — cache set fenced only by epoch equality across node fetch G:serviceEpoch check pre-set
- inc#8 L492-512 emitSyncStateIfChanged — sync body but callers captured epochAtStart many awaits earlier G:epoch early-return
- inc#9 L534-565 applyDustFilter — thresholds/tokens/quotes sampled at different instants G:fail-open
- inc#10 L574-577 _setTrustStateLocked — emit inside lock → async subscriber bodies run unordered vs CS G:comment-only lock contract
- inc#11 L579-609 setTrustAllow — write clobbers with STALE captured record though stillThere re-checked (lost update on changed fields) G:lock+existence recheck
- inc#12 L611-632 setTrustReject/isTokenStillRegistered — helper verdict from other services' reads authorizes trust flip G:lock; fail-closed catch
- inc#13 L634-688 clearProfile/clearChain — caches wholesale-cleared; off-lock getReceiptFee is acknowledged repopulator G:lock+epoch-first+finally re-clear
- inc#14 L696-703 resolveNetworkByChainId — networks[0] snapshot consumed by handlers later G:none
- inc#15 L715-773 hydrateSchedulers — descriptors gathered across awaits; single epoch check before await-free commit G:epoch re-check pre-commit
- inc#16 L775-817 startScheduler/startPublicScheduler — timer closures carry install-time identity; publicWatched.set BEFORE has(key) early-return → re-hydrate rebinds live interval's target G:bornAtEpoch tick fence
- inc#17 L832-845 pollPublic — target captured before scan; rebind mid-scan invisible G:publicPolling single-flight only, no epoch
- inc#18 L847-877 onTokenAdded — active-profile captured pre-lock; switch mid-flight auto-trusts contract under previously-active profile G:lock; idempotent skip
- inc#19 L879-934 onTokenDeleted — network resolved pre-lock; record-delete snapshot loop no per-item recheck G:lock+epoch bump first
- inc#20 L936-969 onTransactionAdded — profile/network pre-lock; stale-copy emit G:lock+stillThere
- inc#21 L971-992 poll — iterates LIVE watchedContracts Set across awaits while onTokenDeleted mutates it G:polling reentrancy Set
- inc#22 L994-1141 scanContract — network.chainId captured pre-loop is token-match key in every CS G:epoch at CS entry AND after each PXE await; live re-reads in lock
- inc#23 L1149-1155 isVisibilityEnabled — gate consumed in emit paths G:fail-closed
- inc#24 L1166-1212 replayPendingPrompts — pending list pre-lock snapshot; visibility predates every emit G:per-item lock with live re-reads
- inc#25 L1222-1227 recipientsFor — recipient map captured once per pass routes per-event writes G:none
- inc#26 L1230-1250 resolvePublicClassGate — cache set has NO epoch check post-await (unlike every other cache write in file); repopulates key deleted under lock G:none
- inc#27 L1254-1266 persistCursorLocked — single cursor chokepoint; every caller's correctness rests on this fence G:lock+epoch→false
- inc#28 L1273-1373 scanPublicContract — whole-row cursor RMW from snapshot across network round-trips G:epoch inside persist+emit
- inc#29 L1382-1516 forwardScanOnce — cursor spreads from stale snapshot can resurrect reset fields; persistCursorLocked return IGNORED at 3 of 4 sites G:per-write epoch fence
- inc#30 L1543-1558 pendingPageReorged — verdict authorizes cursor rewrite after probe G:none
- inc#31 L1562-1589 beginReconciliation — marker spreads pre-failure cursor G:persist fence (checked)
- inc#32 L1594-1676 stepReconciliation — cursorRow re-persisted wholesale after multi-second scan; persist return unchecked G:persist epoch fence
- inc#33 L1681-1738 finishReconciliation — delete loop no per-record recheck; final cursor RMW READS OUTSIDE the lock it writes under G:epoch at lock entry + persist fence
- inc#34 L1745-1815 commitPublicEvent — epoch checked ONLY at CS entry, NOT after 6 intra-CS awaits (asymmetric with note arm) G:entry epoch
- inc#35 L1852-1854 markBalanceDirty — unconditional outbox overwrite (clobbers pendingTaskId) G:callers hold lock
- inc#36 L1872-1925 drainBalanceOutbox — current.dirtyAt re-written after refresh await → reverts mid-call bump to older timestamp G:per-row lock + current re-read at CS entry
- inc#37 L1928-2014 readTaskState/collect* — sync verdict authorizes outbox delete; dedupe sets sampled pre-write, throw degrades to no-suppression G:fail-soft

**dapp-interaction/service.ts** (`dint`)
- dint#1 L89-95 getInteractionPayload — payload can be deleted/cancelled the instant after G:none
- dint#2 L97-126 approveInteraction — sync claim; captured interaction crosses every await in executeAndResolve G:first-claim-wins+sync delete
- dint#3 L128-153 resolveInteraction/rejectInteraction — settle/cancel routed by captured handleId; reject lacks cancelledAt guard G:presence check
- dint#4 L155-190 executeAndResolve — active-profile revalidated BEFORE awaits only; executes/settles minutes later with no re-check G:entry check
- dint#5 L192-202 cancelInteraction — the concurrent mutator approve/resolve race against G:sync
- dint#6 L208-234 execute — journal stage check authorizes popup/execution starting several awaits later G:cancel-before-claim check
- dint#7 L236-246 requestCapabilities/discover — session revoked mid-flight still yields approval popup bound to it; discover lacks ensureInitialized G:none
- dint#8 L248-294 interaction — deferred finally delete keyed by captured id fires long after G:lock around mint+open+register
- dint#9 L296-381 silentInteraction — profile! captured pre-await is account-lookup scope for every materialized op G:entry-time profile check only
- dint#10 L383-430 validateSession — permissions validated once; session row editable before ops run G:none
- dint#11 L474-502 isConfirmationNeeded — decision to SKIP user confirmation made one await before silent execution G:none

**price/service.ts** (`pric`)
- pric#1 L116-133 init — lock/kill-switch flip between reads leaves alarm inconsistent G:none (no gen on this path)
- pric#2 L145-159 refreshIfStale — G:gen captured before any await, re-checked in refresh/doRefresh (documented fence)
- pric#3 L177-196 onAlarmTick — two clear() calls NOT generation-checked; unlock's fresh alarm cleared by stale-read decision G:gen guards refresh only
- pric#4 L200-211 onActiveProfileChanged — two rapid changes race both IIFEs on the alarm G:gen on refresh only
- pric#5 L213-249 onConfigUpdated — no re-check between tail awaits (after getActiveProfile before ensureAlarm) G:sync gen bump+tail supersede+configTransition chain
- pric#6 L302-313 refresh — older-gen caller can adopt newer run and vice versa G:finally identity check
- pric#7 L315-381 doRefresh — G:gen re-checked at 6 points incl. post-cache-write; verify mergeMonotonic→cache.set gap
- pric#8 L408-425 mergeMonotonic — RMW split across two functions; concurrent set lost except where fetchedAt ordering saves G:per-entry monotonic compare

**aztec-runtime/pxe/chain-runtime.ts** (`crt`)
- crt#1 L304-315 ensure — clear()/disposeProfile() during factory await undone by trailing set (resurrects runtime for deleted profile) G:doc "MUST hold chain WRITE guard" (external)
- crt#2 L329-342 settleDisposals — re-add on rejected dispose can clobber newer runtime at same key G:caller-held barrier
- crt#3 L347-366 clear/dispose — clear-then-await-then-conditional-re-add; delete-after-dispose drops re-created runtime from map while live G:caller-held write lock
- crt#4 L379-389 disposeProfile — same re-add-after-await window G:caller-held profile barrier
- crt#5 L100-174 ChainRuntime.dispose/createChainRuntime — purge during getL1ContractAddresses can remove dir this then opens G:try/catch close

**note/service.ts** (`note`)
- note#1 L78-131 getNotesRaw — returned snapshot committed by scanContract awaits later G:per-note try/catch
- note#2 L252-266 lookupSchema — check-then-set across await on per-call map (benign shape, listed)
- note#3 L67-76 getBlockTimestamp — consumed inside scanContract CS as its PXE park point G:fail-soft

**execution/operation-planner.ts** (`plan`)
- plan#1 L88-167 buildTransferOperation — lock/profile check authorizes op assembled after 3 awaits; token edit/delete mid-flight builds call against stale contract G:none

**token-balance/balance-projector.ts** (`proj`)
- proj#1 L55-95 project — token metadata captured in first loop drives grouping long after G:catch→error entry
- proj#2 L97-203 projectChunk — results attributed by index into pre-sim calls array; token deleted mid-sim still yields ok row G:try/catch all-error
- proj#3 L205-244 enqueueCall — two-pass ordering load-bearing on sequential pushes G:none

**execution/execution-coordinator.ts** (`coor`)
- coor#1 L111-155 simulateTxTask/proveTxTask — task handle captured before long PXE call; reap/expiry mid-flight lands transition on dead record G:none
- coor#2 L161-175 sendTxTask — initializesAccount provenance captured at build time G:none
- coor#3 L191-209 proveAndSend — pxe/node handles resolved before prove; switch/rebind mid-prove sends through captured runtime G:checkCancelled ×3; no profile/epoch re-check

**wallet-core/utils/rw-guard.ts** (`rwg`)
- rwg#1 L83-107 read — token install after wait loop; fence is loop condition G:while re-check after every wake
- rwg#2 L109-136 write/enterWrite/acquireWrite — no re-check after wake; correctness rests on baton handoff invariant; unpaired leaveWrite releases mid-op G:handoff sets writeActive
- rwg#3 L160-195 startForceReleaseTimer — deferred callback expires stuck readers → writer overlaps still-running reader G:per-token age check

**account-integrity/coordinator.ts** (`aint`)
- aint#1 L65-85 start — bootVerification deliberately fire-and-forget; verdict lands against whatever profile active by then G:none (documented)
- aint#2 L90-128 verifyRestoredSessionOnce — rows snapshot before slow derivation is what green stamp binds G:persistIntegrityBlockIfLive guarded; lockProfileIfActive id-scoped
- aint#3 L142-191 verifyProfile — snapshot loop, no per-account recheck; stamp+clear written after N slow awaits G:caller-supplied guards

**profile/passkey-recovery-coordinator.ts** (`prc`)
- prc#1 L59-139 all five entry points — ceremony results returned for caller's write; caller owns re-validation; confirm() authorizes destructive op post-ceremony G:documented contract

**composables/useEntityCrud.ts** (`crud`)
- crud#1 L65-80 refresh — G:seq+disposed on all arms (reference fence)
- crud#2 L82-116 onAdded/onUpdated/onDeleted — event splice can be overwritten by in-flight refresh's older response (seq orders refreshes only, not events-vs-refresh) G:seq inside refresh only

**wallet-sdk/content-message-relay.ts** (`cmr`)
- cmr#1 L75-127 register/attach — fully sync; ordering fence is assignment order; attached swapped between dispatches G:snapshot-and-clear before callbacks

**composables/useFeeEstimationMap.ts** (`feem`)
- feem#1 L68-89 engine callbacks — per-key ref writes keyed by identity captured before estimator ran G:staleness is engine's concern

**wallet-core/base/index.ts** (`base`)
- base#1 L65-93 start — registry snapshot before any await; service registered during startup invisible; started siblings stay live after aggregate failure G:phase barrier; documented no-rollback

**profile/profile-deletion-state.ts** — none (sync fence primitive)
**wallet-core/utils/keyed-lock.ts** (`klok`)
- klok#1 L49-71 withLock/delete — lock INSTANCE captured at entry; concurrent delete(key) mints fresh Lock → two CS for same key G:documented in-flight-keeps-reference
**execution/estimate-reuse-shared.ts** (`ersh`)
- ersh#1 L24-64 stash/consume/evictStale — timer closure deletes whatever occupies id when it fires; ids fresh per stash G:single-shot by construction
**execution/mark-failed-unless-cancelled.ts** (`mfuc`)
- mfuc#1 L28-41 — deliberately sync; sentinel branch is only fence against overwriting cancelled with failed; other raced terminalizations undetected G:JobCancelledSentinel rethrow
**restore-rows.ts** (`rrow`)
- rrow#1 L22-35 restoreRows — per-row awaits, no per-row liveness recheck (epoch fences are caller-side) G:per-row try/catch

## Slice 3

**composables/useFullBackupImport.ts** (`fbi`)
- fbi#1 L196-256 restoreAccountsAndFilterOwnedSlices — mutates shared `data` slices in place post-await; retry re-reads mutated object G:none
- fbi#2 L401-455 pickBackupFile — entry-only progress check never re-checked after two awaits; late publication stomps a started restore G:entry check
- fbi#3 L457-497 decryptBackup — identity fence covers re-pick but not decryptionPassword changing mid-KDF G:selectedBackup identity after each await
- fbi#4 L507-534 restoreBackup validate — helper-returned {data,backup} snapshot consumed for the whole function G:progress latch
- fbi#5 L561-579 rollbackCreatedProfile — destructive delete ×3 by captured id; id may be freed+re-imported between attempts G:none (commit-ambiguity documented)
- fbi#6 L583-673 profile leg — opts.password/profileName refs read AFTER the unbounded ceremony await; row committed under values the UI no longer shows G:none on parent refs
- fbi#7 L685-759 network leg + active pointer — createdNetworks captured, consumed ~5 awaits later; active-pointer write not epoch-fenced here G:index pairing+dup backstop; catch swallow
- fbi#8 L764-828 account+token legs — importedChainAddress predates token restore; accountService disconnected in finally yet reused later (L879) G:finally disconnect; index pairing
- fbi#9 L833-867 services snapshot loop — per-item client.restore with no per-item profile-liveness recheck (service-side fences are the guard) G:try/finally disconnect
- fbi#10 L878-895 reconcile+finalize — password ref re-read long after entry; finalizeStarted flag governs rollback G:finalizeStarted set pre-await
- fbi#11 L919-953 chain-sync tail — isRestoreHasErrors read once decides auto-complete while chain-sync's own record callback writes same ref G:isolated try/catch
- fbi#12 L954-1004 catch/rollback — 60 s liveness window between rollback decision and delete; profile may be unlocked/used by then G:liveness gate+bounded ceiling+fail-closed

**account/service.ts** (`acct`)
- acct#1 L106-139 init+sweepOrphanImportedKeys — snapshot loop deletes key rows; import writing key-row-first mid-sweep reaped G:init-ordering claim (unenforced)
- acct#2 L146-158 clearChainState — snapshot loop, NO lock, no per-item recheck; emits fan into cascades G:none
- acct#3 L196-258 ensureDefaultAccount/createAccountInternal — index computed before probe/derivation awaits; restore writes under DIFFERENT lock (restoreLock vs tupleLocks) G:deletion capture-before-secret-await + assertCurrent flush (N-03); per-tuple lock
- acct#4 L274-303 changeAccountName/changeAccountVisibility — whole-row get→set, NO ensureInitialized, NO lock; the pair clobber each other's field G:none
- acct#5 L305-326 getAccountContract — row deleted/re-created during derivation → integrity block written for captured coordinates G:address equality vs captured row
- acct#6 L375-418 exportAccount — plaintext signing-key envelope routed by captured row across password-auth awaits G:fresh password auth
- acct#7 L427-495 importAccount — dek captured BEFORE lock wait; key-row-first write with compensation G:serializePerTuple; compensating delete; zeroize
- acct#8 L507-538 raiseRuntimeMismatch — two separately-awaited writes; delete between leaves orphan block G:persist still-live guarded; lock not
- acct#9 L576-583 rawAddressesForProfile — raw snapshot feeds deletion cascade G:key-derived identity
- acct#10 L589-630 purgeForProfile — two independent snapshot loops OUTSIDE any lock; restore landing between survives G:restoreLock only for malformed pass
- acct#11 L632-636 backup — active-profile switch between two awaits exports wrong profile's shape G:none
- acct#12 L638-693 restore — collides decision once before per-row awaits; per-row getL1ChainIdStored reads possibly-purging network row G:restoreLock; assertRestoreEpoch per write; seen dedupe
- acct#13 L717-777 backupImportedKeys/restoreImportedKeys — contexts CONSUMED before row-loop awaits; expiry/second-restore in gap orphans rows G:restoreLock; epoch per write; zeroize
- acct#14 L785-797 reconcileImportedAccounts — snapshot loop deleting account rows, NO lock, no epoch fence G:none

**operation-journal/service.ts** (`jrn`)
- jrn#1 L169-209 clearChainState/purgeForProfile — snapshot+sweep in one transitionLock hold; getOperation is lock-free G:transitionLock; raw byte-equality re-read
- jrn#2 L226-289 _createOperationLocked — profile-existence check two awaits before write G:transitionLock; deletion.isCurrent epoch; network-liveness
- jrn#3 L309-446 _transitionLocked/setOperationMeta/touchOperation — whole-row spread writes of captured snapshot under the one lock G:transitionLock+FSM; in-lock re-reads
- jrn#4 L479-490 countOperations — lock-free snapshot; cap check and create are separate acquisitions G:none
- jrn#5 L514-535 transitionIfStage — sufficiency rests on every mutator bumping updatedAt G:in-lock re-read+stage set+updatedAt CAS
- jrn#6 L549-572 refileOperationScope — whole-row spread re-scope under lock, stage-gated G:transitionLock+allowed stages

**wallet/runtime.ts** (`rt`)
- rt#1 L159-223 evaluateMigrationGate — whole-status RMW from captured `s`; two concurrent gate evaluations lose a claim G:fail-closed
- rt#2 L234-302 doStart migration branches — blocked status composed from gate snapshot pre-engine-run; degraded/healthy two sequential status writes non-atomic G:freeFailure classification
- rt#3 L311-412 doStart parallel load + registration zone — retrySafe mutated at 5 points across awaits; ~20 services.add non-idempotent G:retrySafe=false before zone
- rt#4 L372-387 registerPxeStoreKeyProvider callback — generation re-check closes read→HKDF→send, not send→offscreen-accept G:post-HKDF gen re-check (+offscreen D4 gate)
- rt#5 L420-493 post-start wiring — reaper/journalGc/heartbeatHandle assigned after awaits; stop() during boot documented not cancelling G:cutoff pre-start

**aztec-runtime/pxe/public-events.ts** (`pube`)
- pube#1 L172-190 module memos — reset() during in-flight get swaps slot under pending consumer G:identity-guarded rejection clear only
- pube#2 L219-325 fetchPublicTokenTransferEvents — checkpointed read one await before log fetch; node tip/fork can move G:beyond-bound+strict-increase validation vs captured checkpoint; dropped flag
- pube#3 L355-368 getPublicScanTips — fallback path number+hash from different reads/instants G:same-block on happy path
- pube#4 L382-410 resolveTokenClassStatus — two sequential anchor reads against mutable node G:dual-anchor; checkpoint pinned by hash

**token/seeder.ts** (`seed`)
- seed#1 L104-161 run/withMarkerLock/updateMarker — whole-blob marker RMW; correctness rests on every mutator taking the lock G:single-flight; markerLock; tombstone preserve
- seed#2 L164-183 onChainPurged/purgeForProfile — epoch bump OUTSIDE the lock, sweep inside G:markerLock; bump-before-queue order
- seed#3 L185-313 doRun/previewOne — state blob read once pre-loop, never refreshed per iteration; guardsHold itself awaits between its checks and caller's write G:guardsHold (epoch+profile+network re-check) before every write; in-lock commit epoch+tombstone re-read

**aztec-runtime/pxe/opfs-store.ts** (`opfs`)
- opfs#1 L97-183 openChainStore — slot released (L172) BEFORE initStoreVersionStamp; concurrent open starts while store still stamping/closing G:check→set sync; identity-guarded release; quarantine on timeout
- opfs#2 L201-225 initStoreVersionStamp — stamp TOCTOU: two openers both read absent, both stamp G:refuse-not-wipe on mismatch
- opfs#3 L255-302 listChainStoreDirs/removeChainStoreDir/removeProfileStoreDirs — snapshots + handles resolved pre-await drive recursive deletes; caller-contract fences G:NotFoundError swallow; doc'd caller guarantees

**activity-protocol/coordinator.ts** (`actp`)
- actp#1 L103-137 currentIncarnation/retireScope — retire deletes counter/tombstone rows under SCOPE lock only; concurrent allocate/record (SOURCE lock) re-creates them G:withScope
- actp#2 L147-208 allocate/record/watermark/tombstone — whole-row spreads under source lock; watermark read lock-free; cross-lock exposure vs retire/purge G:withSource; monotonic skips
- actp#3 L216-246 purgeScope/purgeProfile — purgeScope under scope lock only; purgeProfile NO lock at all, three snapshots, no per-item recheck G:none (purgeProfile)

**execution/fast-path.ts** (`fast`)
- fast#1 L172-230 runFastPath — assertLiveChainIdentity once, then three further awaits before the merged result routes signing G:single identity check

**composables/useProfileBootstrap.ts** (`upb`)
- upb#1 L52-102 initNetworks/initAccount — client swap pre-recheck for that leg; syncNetworkStatus and setupActiveAccount run after last await with no fence G:isCurrent after every other await (B-27)
- upb#2 L110-132 runBootstrapCore — IIFE begins (sync manager swap) BEFORE inFlightBootstraps.set G:per-id single-flight+gen; identity-guarded clear
- upb#3 L139-191 bootstrapActiveProfile/hydrateKnownProfile — appStore.profiles from pre-bootstrap snapshot; isSessionChecked unconditional G:lock-wins re-read before isLogined

**execution/operation-estimate-reuse.ts** (`oer`)
- oer#1 L118-174 tryConsume — six-await revalidation ladder; each rung stale by return; entry handed back for signing G:full drift ladder+single-shot consume (fence-by-design; verify rung order)

**wallet-sdk/profile-switch-teardown.ts** (`pst`)
- pst#1 L44-68 enforceSessionProfileBinding — return-true is pre-await authorization; caller dispatches after further awaits G:fail-closed map-miss; respond-before-terminate
- pst#2 L84-145 trackProfileSwitchEpoch/wireProfileSwitchTeardown — sync; epoch is the cross-await comparator; teardown snapshot loop is sync today G:first-truthy bump

**storage/migrations/index.ts** — none (sync decoders; realMigrations arrays are exported mutable module state consumed across awaits by runtime/backup-migrator)

**execution/discovery-aware-estimator.ts** (`dae`)
- dae#1 L91-127 estimate — probe.collected read AFTER the await (mutable accumulation during); abort check once before long validated build G:fold eligibility; one signal check

**composables/usePrices.ts** (`upx`)
- upx#1 L26-45 resnapshot/onQuotesUpdated — post-await write clobbers event-stream writes; construction+reconnect overlap → last-writer-wins on quotes ref G:none

**utils/background-liveness.ts** (`bliv`)
- bliv#1 L31-95 readLiveness/awaitLivenessAdvance — pre-await settled check stale by consider-time; baseline read separated from arming G:idempotent settle; finally re-check

**aztec-runtime/pxe/note-schemas.ts** (`nsch`)
- nsch#1 L62-90 schemasMemo/reset — loader-local map (no partial observable); test reset clears slot mid-flight G:memo single-flight

**composables/completeImportWithRecovery.ts** (`cir`)
- cir#1 L52-67 — recover() invoked on pre-await timeout decision; activation just after ceiling → second bootstrap concurrent with succeeded one G:both legs caught

**wallet-core/utils/queue.ts** — none (sync; RMW pairs are caller-side)

**aztec-runtime/offscreen/entry.ts** (`oe`)
- oe#1 L43-47 createPxeOffscreen — no single-flight/re-entrancy guard; second invocation builds second PxeService over same OPFS dirs G:none

**wallet-sdk/queued-wait-vouching.ts** (`qwv`)
- qwv#1 L15-37 chainSendTxWithVouching — heartbeatId names a journal row possibly reaped/cancelled/refiled during FIFO wait; endQueuedWait fires against stale id G:documented ordering invariants; idempotent end

## Slice 4

**network/service.ts** (`net`)
- net#1 L231-267 getOrInitNetworks — profile captured BEFORE lock; switch/delete during wait seeds+activates rows for departed profile G:lock (profile read outside)
- net#2 L318-332 resolveVerifiedL1ChainId — TWO separate reads; row edited between → probe validates one row, returns another's l1ChainId; authorizes ACCOUNT CREATION derivation G:seeded-constant equality+probe-vs-stored throw; lock-free
- net#3 L342-351 getActiveNetwork — pointer and row read at different instants G:post-read ownership check
- net#4 L362-372 setActiveForProfile — no deletion-epoch fence (unlike restore) G:lock+requireOwnedRow
- net#5 L376-395 addNetwork — profile captured before RPC probe; row written with captured profile.id; NO deletion fence G:lock+dup checks
- net#6 L397-411 renameNetwork — in-place mutate + whole-object write over collision-check await G:lock+requireOwnedRow
- net#7 L413-439 deleteNetwork — active-check authorizes delete completing up to 30 min later; node eviction keyed by pre-cascade chainId G:lock+deletingNetworks reservation across cascade
- net#8 L449-453 isNetworkLive — verdict stale at return; consumed by callers after further awaits G:reservation consulted pre-await
- net#9 L455-469 setActiveNetwork — node cache populated from PRE-write endpoint snapshot G:lock+requireOwnedRow
- net#10 L473-511 addEndpoint — peek.kind read pre-probe never re-validated against re-read row G:lock+re-read+chain/L1 equality
- net#11 L513-603 updateEndpoint/deleteEndpoint/setPrimaryEndpoint — cache evictions keyed by pre-persist snapshots G:lock+re-read+requireOwnedRow
- net#12 L607-640 getNodeStatus/probeNodeStatus — verdicts consumed by callers far later G:requireOwnedRow
- net#13 L642-657 getNode — cache set after awaits; lock shared with clearers G:lock wraps check-then-set
- net#14 L682-689 getNodeForUrl — check-then-set across await; second poller overwrites first's failure counter G:none
- net#15 L703-709 getNetworkInfo — {profileId,chainId,rpcUrl} snapshot consumed by PXE callers later G:inherits ownership check
- net#16 L736-760 purgeChain — snapshot loop over mutable subscriber registry; identity emitted after whole cascade G:best-effort+fail-fast aggregate
- net#17 L784-840 restore — collision check vs pre-loop snapshot; id-alloc awaits between check and write G:lock; assertRestoreEpoch per write; avoid-set
- net#18 L844-849 onActiveProfileChanged — clear queued behind a 30-min lock lands after NEXT switch repopulated caches G:lock
- net#19 L856-877 purgeForProfile — snapshot loop, no per-item recheck before purgeChain per network G:lock whole cascade

**execution/dapp-send-executor.ts** (`dse`)
- dse#1 L175-244 runInSlot — finally keys off ids captured before arbitrarily long body G:hoisted journalId; post-claim checkCancelled; dual-key idempotent delete
- dse#2 L246-379 estimateOperationFee/stashOperationEstimate — profile switch between getActiveProfile and stash parks signed request under departed profile id G:consume-side drift ladder; checkCancelled ×3
- dse#3 L381-473 executeSendTransaction — activity row + authwit index written from network snapshot taken before prove G:fence into addTransaction; slot held
- dse#4 L475-671 executeAztecSendTx — reused txRequest signed under ESTIMATE-time context while network/account resolved fresh (two instants) G:drift ladder; live-handle re-resolution; checkCancelled
- dse#5 L678-835 executeNoFromSendTx — authwits pushed into long-lived request across per-item awaits; NO post-simulating cancel re-check (documented divergence) G:assertLiveChainIdentity before authwit chainInfo

**execution/helpers/batched-view-simulation.ts** (`bvs`)
- bvs#1 L173-201 resolve+register — chain purge/PXE reset between resolve and register re-creates registrations on rebuilt runtime G:none visible
- bvs#2 L219-307 anchor+identity+dispatch — chainInfo captured pre-dispatch commits both arms; node can drift post-validation G:assertLiveChainIdentity on both derivation sites; allSettled
- bvs#3 L347-363 rerun — shared slowTuples array rewritten in place after await, then consumed by unpack G:rerunNeeded flag

**auth-registry/service.ts** (`auth`)
- auth#1 L97-108 init subscribers — fire-and-forget purgeForAccounts/reconcileFromTx; overlapping reconciles in flight G:best-effort documented
- auth#2 L120-130 reconcileFromTx — outcome decided from payload snapshot; tx can transition again before write lands G:Dropped no-op
- auth#3 L141-150 assertWithinCap — cap checked at build time, rows land at post-send tail (TOCTOU) G:counts pending+unique
- auth#4 L157-171 recordPendingAuthwits — id cursor from pre-loop snapshot; cap NOT re-checked here G:lock; seen dedupe
- auth#5 L177-189 reconcileAuthwits — snapshot loop; {...row} rewrite clobbers concurrent field changes G:lock
- auth#6 L191-250 revokeAuthwits — rows may be reconciled/deleted between capture and post-mine sync G:ownership per id; MAX_REVOKES; waitForTxProven
- auth#7 L256-311 setRegistryEnabled/syncRegistry — verifying node resolved minutes after submit; endpoint flip reads different RPC G:waitForTxProven before sync
- auth#8 L334-344 waitForTxProven — target bound to entry receipt; check-before-await authorizing later deletes G:throws on timeout
- auth#9 L346-380 syncAuthwits/syncAuthwit — existence-only re-check before delete (ABA on re-allocated numeric id passes); emit carries stale row G:lock+existence re-check
- auth#10 L382-403 syncStatus — chain-read snapshot decides local write after unbounded lock wait G:lock+diff check
- auth#11 L405-423 backup — nested snapshot walk; torn export G:entry requireActiveProfile
- auth#12 L428-449 purgeForAccounts — check-then-await-delete pair on statuses G:lock whole purge
- auth#13 L451-523 restore — three pre-loop snapshots (seen/occupied/id cursor) only mutated locally; non-lock writer invisible G:lock; epoch per write; safe-int bound

**token-balance/service.ts** (`tbal`)
- tbal#1 L86-135 init — NO generation fence (unlike every other writer here); switch during init repopulates map for departed profile G:none
- tbal#2 L146-167 getTokenBalances/refreshTokenBalance — map cleared mid-switch between reads; enqueue of possibly-deleted row G:tokens.has skip; none
- tbal#3 L179-202 requestBalanceRefresh/refreshAccountBalances — enqueue carries pre-await snapshot; no invalidated check G:missing:true contract
- tbal#4 L211-234 allocateUnfencedId/createTokenBalance — gen param OPTIONAL — caller omitting it gets no fence; two concurrent allocations same id G:gen re-check before+after set (when passed)
- tbal#5 L255-282 onActiveProfileChanged/onAccountAdded — reference implementations G:sync clear pre-await; per-item gen re-check
- tbal#6 L284-315 onTokenAdded/onTokenUpdated — reference gen fences; enqueue loop over snapshot G:gen+ownership rechecks
- tbal#7 L317-324 onTokenDeleted — the ONLY token event handler with NO generation fence G:none
- tbal#8 L328-347 purgeForTokens — snapshot loop; emit BEFORE delete (inverse of purgeRows order); no service-wide lock (own comment) G:invalidated add per delete
- tbal#9 L349-393 onTransactionUpdated — tokenIds built from live map BEFORE await; cleared map → departed-profile selection G:none
- tbal#10 L406-427 restore — NO lock; allocator re-reads keys per row; concurrent restore/create interleave allocations G:epoch per write; schema parse

**execution/transfer-executor.ts** (`tex`)
- tex#1 L81-135 execute prologue — journal op created with profile.id captured across an await; NO fence at create (contrast addTransaction) G:try/catch best-effort
- tex#2 L118-125 markJournal closure — every FSM transition rides entry-captured id G:null check
- tex#3 L137-267 execute body — activity row from network snapshot captured before prove; no execution mutex (controller registry only, documented) G:fence into addTransaction; requireActiveProfile re-read on reuse arm
- tex#4 L269-354 estimateFee — NO checkCancelled between requireActiveProfile and stash; switch parks signed request under departed profile G:drift ladder consume-side

**contact/service.ts** (`cont`)
- cont#1 L97-118 addContact — profile captured before lock+id-alloc awaits; NO deletion fence G:lock
- cont#2 L120-156 updateContact/deleteContact — whole-object merge/emit of snapshots G:lock+requireOwnedRow
- cont#3 L168-221 importContacts — dedupe maps built once; never refreshed; same-row double-update G:per-item try/catch; callee re-validation
- cont#4 L236-257 purgeForProfile — snapshot loop no per-item recheck G:lock
- cont#5 L267-296 restore — injected e2e gate between capture and lock (production-shaped park) G:epochs captured BEFORE gate; assert per write

**execution/authwit-discoverer.ts** (`awd`)
- awd#1 L73-130 discoverPrivateAuthwits — helper-returned actions consumed by executor later; sim result and nodeInfo from different instants G:assertLiveChainIdentity
- awd#2 L180-231 computeEncodedCallMessageHash — MUTATES caller-shared dApp-supplied content object post-await (documented intentional); reentrancy interleaves field writes G:scope-violation throw

**execution/gas-balance-reader.ts** (`gbr`)
- gbr#1 L72-105 get — inFlight finally delete NOT identity-guarded (contrast async-memo): earlier flight settling deletes newer entry under same key G:per-flight epoch stamp; reenter path
- gbr#2 L152-229 compute/legWithRetry — deps resolved once reused across retries spanning switches; cache write from possibly-departed context G:evictGen no-write-back; epoch→already-stale
- gbr#3 L179-188 readPrivate — FPC address captured mid-compute G:structural null

**execution/execution-mutex.ts** (`emtx`)
- emtx#1 L97-194 acquire/release — release closure's captured keys + depth fallbacks consumed long after; abort path over-counts until prior settles (documented conservative) G:sync cap-check+increment; tail identity check; released latch

**wallet-sdk/session-established.ts** (`sest`)
- sest#1 L60-175 handleSessionEstablished — needsVerification derived from row read BEFORE setVerificationHash; residual window between second liveness gate and stamp (file's own comment) G:marker staleness; profileId equality; TWO liveness gates; fail-closed catch; always-clear finally

**operation-journal/gc.ts** (`jgc`)
- jgc#1 L85-98 start — listener live before create resolves; alarm mid-start runs sweep concurrent with boot sweep G:try/catch
- jgc#2 L113-146 sweep — NO per-item stage re-read before delete; stale-grounds eviction on transitioned/re-allocated records G:per-record try/catch (tolerates gone)

**composables/useProfileCreateFlow.ts** (`upcf`)
- upcf#1 L77-114 handleCreate — uniqueness vs pre-create snapshot; trimmedName at create-time ≠ validated value G:isCreating latch pre-await

**profile/tombstone-repository.ts** (`tomb`)
- tomb#1 L45-59 write/clearIfSame — write is last-writer-wins unguarded; clearIfSame compare-then-delete not CAS: re-deletion's NEW epoch marker dropped by stale clear G:epoch equality compare
- tomb#2 L63-101 reservedIds/validPayloads/corruptIds — helper snapshots consumed by id-allocation + resume after awaits G:raw-key fail-closed

**composables/importChainSync.ts** (`ics`)
- ics#1 L48-110 runImportChainSync — probe verdicts up to 45 s stale when goIds drive skip records; items filtered vs pre-registration snapshot G:single-record structural guarantee; absolute deadline

**purge-rows.ts** (`prow`)
- prow#1 L21-26 purgeRows — canonical snapshot-loop primitive; per-item recheck explicitly absent; every caller inherits G:abort-on-error by design
- prow#2 L58-84 purgeMalformedRows — byte-equality re-read shrinks window to re-read→delete gap (no atomic compare-and-delete exists) G:layer-3 re-read

**wallet-sdk/tab-lifecycle.ts** — none today (sync bodies; snapshot-then-mutate shape flagged if terminateSession ever goes async)

**dapp-session/integrity.ts** (`dsi`)
- dsi#1 L49-68 sign/verify — helper-returned MAC/verdict; caller mutating row during sign await persists row failing its own verification G:sync canonicalization pre-await

**aztec-runtime/pxe/async-memo.ts** (`memo`)
- memo#1 L11-63 memoizeAsync(By) — reset() is unconditional/NOT identity-guarded: reset during in-flight load admits duplicate loader; first's success never cached G:rejection clear IS identity-guarded

**aztec-runtime/pxe/lifecycle-coordinator.ts** — none (sync fence primitive; capture→assert lives in withPxeRead/Write callers)

## Slice 5

**execution/service.ts** (`exs`)
- exs#1 L368-390 captureFence/executeTransfer — fence snapshot consumed after long proves G:atomic capture under facade lock; D13 assert at addTransaction
- exs#2 L427-462 withEstimateAdmission/cancelEstimate — no profile re-check after run; admission entry filed under captured profileId; cancel gate vs stale active read G:registry per-branch ownership checks
- exs#3 L496-631 executeOperations — snapshot loop; TaskService cleared mid-batch → operationTask.complete() throws on cleared id; per-op fence captured (earlier op can straddle switch) G:per-item status short-circuit; fence per op
- exs#4 L635-728 executeRegisterContract/Sender/Token — network row consumed across artifact fetches; token persisted under pre-parse profile with no post-await recheck G:class-id/address equality; previewedInterface sanity
- exs#5 L730-766 executeSendTransaction/executeAztecRegisterSender — same captured-network PXE writes G:fence (send); none (sender)
- exs#6 L772-813 executeAztecRegisterContract — two separate PXE writes straddle awaits against one captured network G:class-id equality
- exs#7 L815-887 executeAztecCreateAuthWit — lock/switch mid-chain still signs and returns A's authwit G:assertLiveChainIdentity; selector scope check
- exs#8 L751-759 getGasBalances — in-flight get() repopulates cache AFTER eviction fired G:evict/invalidate hooks

**wallet-sdk/background.ts** (`bg`)
- bg#1 L108-112 isTokenRegistered — stale registered answer routed to captured session G:scope-gated upstream
- bg#2 L249-273 onSessionEstablished/onSessionTerminated — stamp guard is only thing keeping sessionProfiles from resurrecting dead id G:stampSessionProfileGuarded re-check
- bg#3 L275-385 onWalletMessage — termination/switch between arrival gate and journal write; sessionQueues.set can re-add key onSessionTerminated just deleted G:validation identity re-check; stamp guard; re-gate behind baton
- bg#4 L415-439 onDappSessionDeleted — sync snapshot loop; session established between filter and loop tail not torn down G:origin/chain presence
- bg#5 L455-486 onActiveProfileChanged drain — switch (not lock) mid-drain passes !p gate; queued discoveries served to NEW profile G:per-item lock recheck only
- bg#6 L522-714 handleDiscovery — entry-profile ≠ profile the session row is written under after unbounded popup; popup-cap count taken after two awaits G:rejectIfExpired before every approval+write; settledSession re-read; rollback
- bg#7 L730-841 handleWalletMessage — switch mid-dispatch: epoch gate is sole barrier between B-composed response and A's channel G:preEntryEpoch captured before profile await; binding guard; ctx.profileId anchor

**token/service.ts** (`tok`)
- tok#1 L121-128 seed triggers — fire-and-forget seeder runs G:seeder single-flight
- tok#2 L135-148 clearChainState — snapshot loop WITHOUT this.lock (purgeForProfile HAS it); token added mid-purge survives chain purge G:seeder epoch fence pre-snapshot
- tok#3 L165-176 getToken(Raw) — ownership check straddles await G:requireOwnedRow
- tok#4 L178-307 addToken/persistToken — caller-captured profileId never re-validated across live metadata fetch; id alloc→write awaitless G:lock write path; in-lock idempotency re-check
- tok#5 L322-340 addSeededToken — seeded kind structurally forbids re-fetch (TOCTOU fix) G:discriminated metadata
- tok#6 L342-398 updateToken — metadata fetch INSIDE lock; task.complete throws if map cleared on switch G:lock across fetch
- tok#7 L400-434 deleteToken/_deleteTokenById — ownership pre-await only; numeric id reuse between check and delete; emit carries pre-delete snapshot G:requireOwnedRow pre-await
- tok#8 L445-569 parseTokenInterface/previewTokenMetadata — interface stamped with chainId captured pre-fetch; preview computed under A, persisted under B G:TOFU class pin same-fetch
- tok#9 L571-613 fetchTokenMetadata/findToken — helper snapshots; absence-verdict authorizes insert G:none
- tok#10 L639-674 purgeForProfile/backup — ONE lock across typed+raw passes; backup profile switch between reads G:lock (purge); none (backup)
- tok#11 L676-705 restore — epoch per write; id alloc→write awaitless G:lock+assertRestoreEpoch

**fpc/service.ts** (`fpc`)
- fpc#1 L92-102 clearChainState — NOT under this.lock (every other mutator is); addFpc mid-loop survives; cache delete after readers repopulated G:none
- fpc#2 L104-116 getOrComputeProtocolAddresses — no single-flight; concurrent derive+set; late set undoes clearChainState delete G:none
- fpc#3 L129-231 getFpcs/getFpc — profile captured pre-lock stamped onto discovery rows written after; ownership check straddles await G:in-lock re-read+has* recheck
- fpc#4 L233-277 addFpc — ~7 awaits between identity read and row write; NO deletion fence G:type allowlist; artifact validation
- fpc#5 L279-352 updateFpc/updateFpcAddress — updateFpcAddress spreads OUTSIDE-lock snapshot → clobbers concurrent rename (lost update); isProtocol decision across unlocked-cache await G:lock; PrivateFPC/protocol blocks
- fpc#6 L354-377 deleteFpc/getFpcImpl — protection decision across await vs unlocked cache; fee identity resolved pre-await consumed downstream G:lock; ownership
- fpc#7 L401-472 purgeForProfile/backup/restore — backup transitively WRITES (discovery); restore epoch-fenced G:lock; assertRestoreEpoch+parse

**wallet/utils/offscreen.ts** (`offs`)
- offs#1 L97-105 onOffscreenReady — READY carries NO pass-id: superseded document's READY resolves CURRENT pass gate G:message equality only
- offs#2 L106-144 onOffscreenTimeout/trackedClose — un-awaited close compensated by pendingClose join; identity-guarded null G:fence bump before close; identity check
- offs#3 L200-217 closeOffscreen — firefoxOffscreenWindowId nulled AFTER await: new pass's handle clobbered → orphaned window G:none
- offs#4 L230-297 createOffscreen — pass-fence checked at 3 points; Firefox branch carries handle-clobber risk G:passId===passSeq ×3
- offs#5 L337-404 ensureOffscreenRunning/doEnsure — healthy-probe TOCTOU: kill decision authorizes close of document a successor may own; unconditional finally null on memo G:pendingClose join; LOCAL ready capture; pass fence

**account-state/service.ts** (`ast`)
- ast#1 L60-142 getAccounts/getSenders/addSender/deleteSender — network row consumed across RPC; events fired under possibly-changed scope G:none
- ast#2 L91-115 getSendersAcrossActiveNetworks — snapshot loop; deleted network still contributes G:per-item status recheck+catch
- ast#3 L156-220 backup — nested snapshot loop with omission warning G:Active gate per network
- ast#4 L240-344 restore — deadline is the only per-item fence; does not cover profile switches G:expired() before EVERY launch; unreachable short-circuit

**execution/estimate-cancel-registry.ts** (`ecr`)
- ecr#1 L111-155 admit — parked entry's {profileId,flowKey} captured at park, consumed by admitNext after arbitrary caller awaits G:duplicate-token reject; ordered retire
- ecr#2 L166-209 settle/cancel — estimateId snapshot of run completed across awaits; cancel gate vs caller-captured profile G:aborted-check stash-vs-evict; per-branch ownership
- ecr#3 L241-277 admitNext/sweep — activates under park-time profileId (wrong-profile cap accounting); sweep only runs on admit G:TTL reaps; capacity recheck

**task/service.ts** (`task`)
- task#1 L46-83 createTask — returned WrappedTask holds bare id consumed across awaits everywhere G:finished-parent check
- task#2 L129-177 complete/fail/cancel/startTask — THROWS on cleared map; every caller invokes after long awaits G:validate* checks
- task#3 L194-243 getTask/cleanupStaleTasks — capture→cleanup-mutate→recheck; recursive delete emits while subscribers re-enter G:post-cleanup has recheck
- task#4 L245-253 onActiveProfileChanged — the map-clearing actor invalidating every captured task id G:id-diff check

**execution/claim-helper.ts** (`clm`)
- clm#1 L85-107 no-queued-id/record-not-found branches — cancelJob during createFreshRecord finds no controller; reaped-verdict authorizes dropping pre-registered controller G:register-immediately discipline
- clm#2 L108-170 scope-mismatch/re-file branch — stage/abort decisions on pre-lock snapshot; re-files record to CURRENT scope G:allowed-stage re-checked UNDER journal lock; abort check
- clm#3 L179-241 claim branch + controller tail — transition-failure re-read disambiguates; no-await discipline between transition and set G:journal mutex; documented microtask residual on legacy fallback

**window-manager/window-manager.ts** (`wm`)
- wm#1 L51-117 openAndAwait — timeout can settle+delete handle during windows.create; double recheck is whole fence G:has(handleId) ×2
- wm#2 L95-114 onRemoved/create-catch — event body reads windowId written after create await; late failure settles reused handle (random ids) G:closedId compare; _settle no-op
- wm#3 L161-192 _settle — settling while create pending leaves windowId undefined → window never removed G:settled flag; delete-before-side-effects

**backup/backup-migrator.ts** (`bmig`)
- bmig#1 L76-117 migrateBackupData — passThrough/present capture across engine awaits; writes go to per-call scratch only G:preflight fail-closed; frozen module arrays

**composables/useIncomingTransfers.ts** (`uit`)
- uit#1 L71-128 refresh/handlers/watcher — A→B→A scope flap fenced; onDeleted deliberately unscoped (subtractive-only) G:disposed+seq+scopeKey triple recheck

**composables/useDappApprovalWindow.ts** (`udaw`)
- udaw#1 L102-137 start/onActiveProfileChanged — switch during init(): profile.value undefined → spurious reject; lock during init still reaches listener registration G:isLogined check pre-init; documented listener ordering

**dapp-session/mac-storage.ts** (`macs`)
- macs#1 L30-52 set/get/contains — sign-then-set clobbers concurrent writer (RMW no CAS); get can DELETE (existence probe mutates) G:callers hold service lock
- macs#2 L41-48 getValues — snapshot loop with destructive per-row drop; row rewritten mid-loop judged on stale snapshot G:per-row verify
- macs#3 L85-110 verifyOrDrop/drop — deletes by row's SELF-REPORTED id not storage key; fire-and-forget delete unordered vs subsequent set G:locked-profile catch hides-not-deletes
- macs#4 L75-83 rowsForProfile — raw snapshot consumed by deletion cascade later G:true-storage-key attribution

**wallet/index.ts** (`widx`)
- widx#1 L29-49 onInstalled/onMessage — fire-and-forget across SW startup; window closed between message and openPopup G:type checks
- widx#2 L91-111 onAlarm/rehydrate-then-start — overlapping ticks resolve services.get on graph built during await; start races alarm shim's start G:single-flight memo

**execution/discovery-probe.ts** (`dpr`)
- dpr#1 L57-96 extractEffects — probe.collected accumulates across per-effect awaits while executor reads it G:used latch pre-await; identity assert; dedup

**token-balance/balance-repository.ts** (`brep`)
- brep#1 L37-64 set/delete/allocateId/allocateIdAvoiding — allocate-then-write TOCTOU; concurrent allocations same id G:hostile-key exclusion; fence pseudo-keys
- brep#2 L69-81 existsByTokenAndAccount/purgeMalformed — check IS the projector's guard; deletable between verdict and set G:byte-equality re-read (purge)

**wallet-core/migration/staging.ts** (`stag`)
- stag#1 L25-58 rows/value — asymmetric read-your-writes: rows picks up mid-read staged writes, value ignores them G:staged-first ordering (value)
- stag#2 L61-69 diff — helper snapshot committed by engine after awaits G:none

**wallet-core/utils/event-handler.ts** (`evh`)
- evh#1 L47-61 invoke — iterates LIVE array (mutating subscriber skips/repeats); async subscriber bodies observe post-invoke state G:per-subscriber isolation

**wallet-core/storage/value-storage.ts** (`vs`)
- vs#1 L28-43 get/set — no CAS primitive: every caller's get→await→set is an unguarded RMW (lost-update sites are caller-side) G:fail-closed codec

**wallet/single-flight-start.ts** (`sfs`)
- sfs#1 L17-26 — retry verdict read after await authorizes memo reset; null unguarded by identity (safe: one catch per link) G:canRetryAfterFailure veto; ??=

## Slice 6 (key rows; fence-primitive files with none omitted for brevity are listed in the coverage roster)

**aztec-runtime/pxe/service.ts** (`pxe`)
- pxe#1 L200-217 init — void sweepOrphanStores fire-and-forget into destructive path concurrent with in-flight deletion cascade G:doc claim (coordinator deletes row LAST)
- pxe#2 L229-276 sweepOrphanStores — profile created/re-imported during getProfiles→remove window absent from snapshot; shared keyval-store emptiness from pre-await dbs list G:whole-profile removal; splice-on-deleted
- pxe#3 L278-323 getContractInstance/getContractArtifact — cascade decision pre-await drives post-await registry read; cache set vs rebound PXE G:withPxeRead envelope
- pxe#4 L442-524 simulateTx/stubClassRegistrations — per-address snapshot loop no recheck; WeakMap memo outlives dispose/recreate of same PXE identity G:chainGuard.write whole body; entry asserts
- pxe#5 L631-656 clearChainState — captured guard objects can stop being the ones new ops allocate (concurrent clearProfileState deletes map entries) G:B-18 double bump; write-under-read-barrier
- pxe#6 L665-721 clearProfileState — deleted(gen) commit uses entry-captured generation after ~10 awaits; keyval-store decision re-read but unfenced G:sync deleting mark; gen-mismatch reject; success-only finalize
- pxe#7 L826-912 withPxeRead/withPxeWrite — store key re-read at ensure while epoch entry-captured; long fn after one-shot fence G:assertGenerationCurrent+assertUnchanged; bounded rebind loop
- pxe#8 L730-761 provisionChainStoreKey — awaitless by design (D4 run-to-completion) G:sync block

**profile/session-manager.ts** (`sm`)
- sm#1 L194-232 getActive/getSecret/getDek — expiry close off facade lock; material handed out after state-transitioning getActive G:expected identity; post-await profile-id equality
- sm#2 L253-341 open — activeSession built from pre-wrapPair strict/TTL snapshot; strict-toggle mid-wrap persists pre-await bearer decision G:artifact mutex; bump-LAST commit; read-back
- sm#3 L351-396 close — in-memory clear BEFORE mutex (successor's in-memory session gap) G:sync identity guard; gen re-check in mutex
- sm#4 L414-443 refresh — mutates SHARED session.since/lockedAt BEFORE mutex; lands even when identity re-check stands writer down G:identity re-check inside mutex
- sm#5 L457-491 clearBearer — leg-2 spread-write can clobber concurrent non-runExclusive writer G:runExclusive; documented rejection of fresh-snapshot form
- sm#6 L506-635 restore — profile row read early committed into session after MAC await G:post-unwrap strict re-check; MAC bound to session.profile; init-only invariant
- sm#7 L675-684 silentClose — unconditional wipe, no identity/generation fence (init-only INVARIANT documented) G:doc invariant
- sm#8 L701-775 onConfigUpdated/applyTtlChange — two rapid TTL toggles launch two writers with different captured values; no second identity check before scheduleLockAlarm(newLockedAt) G:sync field updates; in-lock re-read
- sm#9 L790-818 onAlarmFired — close() called with NO expected (identity guard bypassed); scheduledTime gate is only fence G:runExclusive+staleness gate
- sm#10 L828-850 scheduleLockAlarm/clearLockAlarm — alarm created for session possibly closed during dispatcher.create G:pre-await gates; isExpired reactive net

**transaction/service.ts** (`tx`)
- tx#1 L91-128 init — rows purged between getValues and per-row pending.set re-armed into poller G:!ambiguous filter
- tx#2 L155-221 addTransaction — epoch/owner check before dup-check await; write uses entry-captured fence G:D13 assertCurrent+owner under tx lock
- tx#3 L237-272 waitForTx — task registry cleared by switch mid-wait; settle on entry-captured handle G:settled latch; exists check
- tx#4 L274-295 onAccountDeleted/isSoleOwner — payload-driven destructive cascade; helper verdict consumed later G:none
- tx#5 L301-364 purgeForAccounts — soleOwner decided across N awaits before every write; snapshot loop under lock G:lock; raw re-read pass
- tx#6 L366-404 runWorker/updateTx — profile check authorizes whole batch; streak maps mutated OUTSIDE lock post-receipt-await; shared tx object mutated in place G:object-IDENTITY fence in lock (ABA-chosen); unlocked pending-identity check at L444
- tx#7 L537-564 backup — nested snapshot loop filters against entry profile after switch G:per-row filters
- tx#8 L566-607 restore — epochs pre-lock; create-only contains under lock G:assertRestoreEpoch per write; Pending rejected

**execution/tx-request-builder.ts** (`txb`)
- txb#1 L118-398 buildStandard — chain-identity asserted at L139 then NOT re-checked before signing ~20 awaits later; mutates caller's action.type/isStatic G:assertLiveChainIdentity once; result pins chainIdentity+txsLimits from same nodeInfo
- txb#2 L405-534 buildNoFrom — network ~20 awaits older than the nodeInfo it is asserted against G:assertLiveChainIdentity at L488

**execution/execution-lane.ts** (`lane`)
- lane#1 L119-150 beginJournal — fence-absent path reads active profile then creates across await G:fence authoritative when present
- lane#2 L163-212 cancelJob — controller map read AFTER transition await; successor under same id would be aborted G:ownership gate; FSM rejection skips abort
- lane#3 L220-224 resolveExecutionMutexKey — switch between two reads yields mixed key G:none
- lane#4 L243-305 acquireSlot — catch-path controller delete keyed not identity-checked G:sync-register invariant; FIFO baton
- lane#5 L351-377 heartbeatExecutionWaiters — no per-item recheck before touch G:snapshot comment; per-id catch
- lane#6 L388-432 claimOrCreateJournal/markJournal — hooks.queuedJournalId captured at entry drives claim G:fence preferred over fresh read

**composables/useProfileImportFlow.ts** (`upif`)
- upif#1 L81-121 withDuplicateConfirm — second flow overwrites shared confirm slot's callback/copy during await G:settled latch; close-watch cancel
- upif#2 L186-240 handleImportSeed/Passkey — existingNames stale by create; refs read inside retry closure after ceremonies G:in-flight latch pre-fetch
- upif#3 L265-293 pickFile wrapper/copy timer/name watch — error banner after unbounded wait onto possibly-different form state G:FileTooLargeError narrow; only-if-untouched

**execution/fee/fpc-strategy.ts** (`fpcs`)
- fpcs#1 L97-190 buildAndEstimateSponsoredFastPath — ctx.op.actions mutated (unshift/push/splice) across long awaits; final splice rebuilds from pre-await snapshot G:post-build chainId cross-check restores+falls back; signal check
- fpcs#2 L192-285 buildAndEstimateTwoPass — Pass-1 gas captured before Pass 2 awaits spliced back at end; direct gasSettings assignment from first pass G:two signal checks; Pass 2 always validated

**wallet-core/storage/entity_storage.ts** — none (single-op methods; B-23 keep-malformed + rawStringEntries substrate notes)

**execution/transfer-estimate-reuse.ts** (`ter`)
- ter#1 L150-234 tryConsume — every ladder rung check-before-await; profile/endpoint can drift after their rung; caller submits after last sync gate G:full ladder+single-shot (fence-by-design; verify rung order)

**incoming-transfer/repository.ts** (`irep`)
- irep#1 L86-158 list*/setTrust/setCursor/setOutbox — helper snapshots + last-writer-wins rows at this layer (service-side fences are the guard) G:none here
- irep#2 L167-200 clearProfile/clearChain/deleteKeysWhere — textbook snapshot loop: key rewritten after snapshot destroyed; created after snapshot survives; inter-table window G:key-prefix deletion (codec-invalid still erased)

**wallet-core/utils/lock.ts** (`lock`)
- lock#1 L42-86 enter/withLock — acquiredAt single shared field zeroed for current holder by displaced holder's leave; ticket stops cross-release not un-running code G:ticket-first leave; never-reject
- lock#2 L127-162 dispatch — force-release admits next waiter while displaced holder's CS may still run (documented accepted limitation; null-maxHoldMs for long holds) G:timer guards own ticket

**aztec-runtime/account/account-export.ts** — none (pure)

**profile-deletion/coordinator.ts** (`pdc`)
- pdc#1 L66-99 start/snapshot — delegate pointer swap; five concurrent raw reads returned as THE cascade-authorizing snapshot G:doc lock-free-safe under facade lock; raw harvests F-B23
- pdc#2 L101-107 runFor — deferred inflight delete keyed not identity-checked G:sync single-flight
- pdc#3 L116-131 purge — 12 sequential destructive purges all driven by the STALE snapshot; rows created mid-cascade survive G:documented ordering; idempotent steps; fail-fast keeps tombstone; PXE leg gen-fenced

**offscreen/index.ts** (`oidx`)
- oidx#1 L17-38 PONG/adopt listeners — readiness flag gates adoption; close can land while createPxeOffscreen mid-await G:shouldRespondPong B-17; token match
- oidx#2 L95-122 top-level — superseding adopt during init await not re-checked before READY broadcast G:READY after init; flag before send

**profile/repository.ts** (`prep`)
- prep#1 L105-107 generateUniqueId — documented deliberate TOCTOU; callers must re-verify under facade lock G:doc contract (JSDoc L77-104)

**composables/useFeeEstimation.ts** — none (sync delegation; single-slot callback interleave lives in the engine)

**account-integrity/blocked-repository.ts** (`brepo`)
- brepo#1 L41-81 isBlocked/set/clear — check-before-await consumed by callers; clear/set last-writer-wins no CAS G:raw-key fail-closed (isBlocked)

**account/imported-keys-repository.ts** (`ikr`)
- ikr#1 L26-66 get/liveRows/allRowIds/forProfile — helper snapshots feeding orphan reconciliation + deletion cascade G:key-identity cross-checks

**id-allocators.ts** (`ida`)
- ida#1 L17-66 nextNumericId/nextRandomId/preferOrReallocId — allocator TOCTOU family: none reserve the id returned; caller writes after further awaits G:canonical/safe filtering; avoid-set contract

**wallet-sdk/session-baton.ts** — none (sync factory; queue-map shape lives in background.ts = bg#3)
**wallet-sdk/pending-verification.ts** — none (sync; marker map shapes live in the wallet-sdk handlers)

## Parent slice (census carve-outs)

**wallet/config/store.ts** (`cfg`)
- cfg#1 L23-40+81-95 load→apply / reset→apply — R:storage config A:storage.get W:per-key this.config mutation + onUpdate emits + whole-object storage.set, ALL OUTSIDE the lock that set() uses G:none · boot-load vs concurrent set() lost update; apply's final set persists stale merge
- cfg#2 L46-68 set — validated pre-lock; mutation+emit+persist under lock G:lock.withLock (reference sibling for cfg#1)

**wallet/logger/store.ts** (`log`)
- log#1 L65-78 rehydrate — R:storage.session saved logs A:get W:this.logs.add + nextId re-max G:none · log() during await → duplicate ring ids (diagnostic surface only)
- log#2 L81-92 scheduleFlush — timer reads logs fresh at fire; fire-and-forget session write G:flushTimer single-flight

**wallet/base/index.ts** — none (pure re-export)
**composables/syncedRef.js** (`sref`)
- sref#1 L10-31 init-read + onChanged — init read resolving late overwrites newer ref value; watch echoes stale back to storage (codex-constructed) G:facade re-read on onChanged (echo-terminating for events, not for the init read) · UI-pref scope, outside service-writer filter — recorded per plan

## Pre-seeded rows (prior-fenced + deferred + refuted-adjacent — verification targets, not fix targets)

- X-b1 export-integrity N-01/N-13 sites (full.vue latch+generation; files.ts caps) — verify capture order/branch coverage
- X-b2 migration-lifecycle N-02/N-18/N-27 (migrator counted markers; runtime gate; barrier) — verify
- X-b3 dapp-profile-binding N-04/N-26/N-19 (stamp/guard/teardown/markers/queued-journal belts) — verify
- X-b4 lock-ownership N-11/N-12/N-17 (ticketed Lock; session artifact mutex bump-last; note-CS epoch re-checks) — verify
- X-b5 data-safety N-06/N-24/N-20-hardening (orphan sweep; authwit dedupe; nextNumericId) — verify
- X-b6 shell-identity-fences N-05/N-08/N-23 (network-switch handler; unlockWait; scope-triple loaders) — verify
- X-b7 service-fences N-03/N-14/N-10 (createAccountInternal capture; restore-fence 9 writers; syncBatch gen) — verify
- X-b8 journal-reaper N-07/N-16/N-25 (queuedWaiters lease; waitForTx bound; both-key cleanup; transitionIfStage) — verify
- X-b9 runtime-edges N-15/N-21/N-28 (initializesAccount provenance; passkey budget; ServiceCollection allSettled) — verify
- X-p1 fix-state-fences B-04/05/20/21/29 + B-08 NOT-REPRODUCED (inert) — verify
- X-p2 fix-account-generation-fence F-B27 (setupActiveAccount dual fence) — verify
- X-p3 PR #372 reimport-pxe-fence (tombstone fall-through) — verify
- X-p4 backup-restore-security-hardening D13 chain (ExecutionFence end-to-end; deletion coordinator; tombstones) — verify
- X-p5 account-profile-siloing (journal transitionLock; claim token; composite keys; in-flight-send guard) — verify
- X-p6 fix-pxe-offscreen B-07/17/18 (OPFS quarantine; ensure-pass fences; double bump) — verify
- X-p7 refresh-balances-disconnect #449 (allSettled-before-disconnect) — verify
- X-d1 KNOWN-DEFERRED: token-metadata write path (token/service.ts) — D13 residual, owner-ratified deferral (backup-restore-residuals)
- X-d2 KNOWN-DEFERRED: balance-projection write beyond N-10 (balance-job-queue) — D13 residual, owner-ratified deferral
- X-r1 refuted-adjacent: N-20 hypothesis stays refuted; allocator races ADJACENT to it triage normally (see ida#1, brep#1)

## Pass 2 (async-boundary)

Two agents (extension / packages), grep-trailed; only lifetime/interprocedural shapes reported (shape# 1=registered-closure 2=fire-and-forget 3=aliased-object 4=cross-realm 5=timer-deferred). Guarded/clean rosters retained in the agents' trails.

**packages leg**
- P2-pkg#1 pxe/service.ts:886-887(+829,632-633) · s3 · withPxeWrite/Read capture guard OBJECTS at entry; clearProfileState DELETES both map slots mid-park → resumed op on orphaned guard, fresh op mints new guard → no mutual exclusion; claimed insufficiency: assertGenerationCurrent capture-conditional; clearProfileState never bumps purge epoch
- P2-pkg#2 pxe/service.ts:207 · s2 · void sweepOrphanStores from init; no barrier/lifecycle/epoch participation; same-id re-import between snapshot and remove → deletes brand-new store
- P2-pkg#3 pxe/service.ts:247-265 · s2 · sweep's IDB arm vs clearProfileState's same enumerate-then-delete, unsynchronized; keyval emptiness from mid-drain set
- P2-pkg#4 pxe/service.ts:215 · s1 · onActiveProfileChanged registered once, unremovable, async body under sync invoke — latent (body no-op today)
- P2-pkg#5 pxe/client.ts:166-189 · s4 · recovery chain: requestAlreadyReady bypasses only THIS call's onReady; concurrent request's onReady can recreate offscreen between authority read and wire; equality check compares two pre-restart values
- P2-pkg#6 pxe/client.ts:191 · s3 · finally zeroizes provider-returned buffer; no defensive copy in-file (opfs-store copies; provider contract load-bearing)
- P2-pkg#7 opfs-store.ts:144-155 · s2 · late-open continuation identity-guarded BUT no purge path clears inFlightOpens → quarantined dir survives removal; same-coordinates re-add wedged (ChainStoreWedgedError) until offscreen restart
- P2-pkg#8 opfs-store.ts:143-146 · dead write · entry.state written never read
- P2-pkg#9 chain-runtime.ts:329-338 · s3 · settleDisposals re-add after await can overwrite fresh runtime; safety rests wholly on caller-held barrier (clear() has no prod caller)
- P2-pkg#10 alarm-dispatcher.ts:41-63 · s1+2 · no tick reentrancy guard; stop() doesn't cancel in-flight tick; double-listen makes first listener undetachable (consumers: reaper, gc)
- P2-pkg#11 event-handler.ts:47-61 · s1 · invoke iterates LIVE array (remove-during-dispatch skips sibling); async subscriber rejections escape onError as unhandled
- P2-pkg#12 keyed-lock.ts:59-61 · s3 · delete(key) breaks that key's mutual exclusion (latent — no prod caller); doc frames as safe without noting exclusion break
- P2-pkg#13 rw-guard caller · s5 · clearProfileState's enterWrite granted via reader force-release runs concurrent with a still-proving withPxeWrite (90-min bound, not exclusion) — caller-side of known primitive
- P2-pkg#14 artifact-registry.ts:58-62,207-209 · s2/s3 · success-path late .then repopulates known after clear(); verifiedClassIds re-add post-verify — both LATENT (clear() has no prod caller)
- P2-pkg#15 base/index.ts:76 · s2 · no-rollback start leaves succeeded services (incl. the un-awaited sweep) live after phase AggregateError

**extension leg**
- P2-ext#1 profile/client.ts:138-155 · s1+4 · subscribeActiveProfile: NO unsubscribed flag (sibling subscribeJob HAS one at operation-journal/client.ts:91-110); reconnect snapshot RPC can resolve after a live B-change → re-delivers A; delivers after unsubscribe
- P2-ext#2 offscreen.ts:97-105+364-399 · s4 · READY envelope carries no pass id; pass N's late READY resolves pass N+1's gate (partial acceptance noted at L392-398) — joins offs#1
- P2-ext#3 auth-registry/service.ts:97-99 · s2 · onAccountDeleted → void purgeForAccounts(address-only, no profileId/epoch); deterministic addresses → delete-then-reimport destroys NEW incarnation's authwits
- P2-ext#4 auth-registry/service.ts:106-108 · s2 · overlapping reconciles unordered; remove can land after confirm (lock gives exclusion not ordering; no live status re-read in lock)
- P2-ext#5 mac-storage.ts:107-110 · s2+3 · stale-verdict fire-and-forget drop deletes a FRESH MAC-valid row rewritten during the verify awaits (patchSession family)
- P2-ext#6 dapp-interaction:192-202+115-190 · s3 · cancel after approve silently no-ops (record deleted pre-execute; cancellation never re-read post-approval; profile re-check present)
- P2-ext#7 window-manager:83-146 · s2+3 · create .then holds handle object; membership-only has(handleId) + re-mintable 8-hex id → settle resolves NEW handle, old window never removed; needs object-identity fence (tx updateTx idiom)
- P2-ext#8 task/service+wrapped-task · s1+3 · WrappedTask.complete/fail never consult exists; registry wipe on switch + re-mintable ids → throw or wrong-task transition (joins exs#3)
- P2-ext#9 price/service.ts:200-211 · s1+2 · generation bumped ONLY by kill-switch, not by the profile events that fire the handler; lock mid-handler leaves armed alarm (self-heals on tick)
- P2-ext#10 execution-lane:336-377 · s5 · heartbeat touchOperation unfenced vs purged/recreated id (swallow masks; 90-min lease only)
- P2-ext#11 guarded-network-activation.ts:276-318 · s2+4 · module-level popup-realm tail; enqueuedProfileId checked ONCE at entry; no re-check after commitScopeChange/persist/readActive → lock→unlock-other-profile during slow persist writes A's authoritative network into B's live scope (doc records only the cross-window variant)
- P2-ext#12 utils/storage.ts:68-81 · s4 · facade has no RMW/CAS primitive; popup-realm RMW-vs-RMW lost updates on nulo:ui:feePaymentMethods (FeeSettingsCard vs fpcs settings vs BalanceView) across windows
- P2-ext#13 useEntityCrud:82-120 · s1 · "incremental" mode (default) has NO scope predicate — cross-profile/chain/account rows rendered into settings lists (tokens, fpcs, senders [bare-address payload unfilterable], authwits); contrast useIncomingTransfers.inLiveScope
- P2-ext#14 usePrices:33-45 · s2 · resnapshot at setup + every onConnected, unfenced, out-of-order overwrite incl. `{}` (joins upx#1)

## Pass 3 (score-0/1 re-screen + promotions + extension-messaging)

Screen set = 171 score-0/1 census files, ALL accounted for (0 skipped; per-file clean reasons in the pass-3 trail). 10 files promoted (~21 candidates) + full enumeration of the 3 targets. Census-count reconciliation: table rows sum 295/126 vs the header's 280/122 (carve-outs double-counted; composables 33 vs 32 on-disk off-by-one) — every row covered regardless. Meta-finding: the census write-regex under-fired on caller-owned object-graph writes (`txRequest.txContext.gasSettings =`); pass 1 read files fully so its coverage is unaffected, and the two missed fee files are now enumerated here.

**Promotions**
- P3-A1 operation-journal/client.ts:107-117 subscribeJob — register-first closes lost-event but stale snapshot RPC can overwrite a FRESHER event write (terminal→running inversion); no monotonicity check; reconnect emitSnapshot not single-flighted
- P3-A2 execution/fee/fee-juice-strategy.ts:29-46 — ctx.op.actions.push after await (abort check AFTER push); rebuild path re-reads ctx.op.fee post-await; suggestGasLimits mutates shared txRequest
- P3-A3 backup/row-map-migration.ts:118-129 — whole-root rows→await→setRows RMW + per-key value RMW (serialized today only by the boot gate/scratch; nothing in-file enforces)
- P3-A4 execution/fee/fee-strategy.ts:266-331 finalizeGasLimits — gasSettings whole-object replacement after node RPC; clobbers interleaved suggestGasLimits/applyEmbeddedFpcGasCap on the same request
- P3-A5 execution/fee/embedded-fpc-cap.ts:71-82 — same gasSettings RMW across getCurrentMinFees; budget-vs-committed-cap split on lost update
- P3-A6 account/nulo-account.ts:102-184 — ensureRegistered/ensureContractRegistered check-then-act on PXE registry; buildTxExecutionRequest writes caller-owned outMeta.initializesAccount after 5 awaits (nullifier-witness staleness flips the duplicate-init classification)
- P3-A7 wallet-core/testing/fake-background-ticker.ts:36-64 — cancel-mid-tick leaves sub schedulable; running flag captured pre-await (test-double semantics divergence)
- P3-A8 composables/fullscreenPopupSetting.ts:26-40 — init-read-late echo WITH subscription-registered-first (event received then discarded); no disposed latch on the in-flight read
- P3-A9 composables/syncedRef.js:10-32 — init-read clobber laundered into durable storage via the watch; onChanged re-reads unordered; undefined-key persists undefined; listener never removed
- P3-A10 composables/useDappInteractionPayload.ts:74-113 — load() un-latched (requestId/payload ref pair can mismatch across two calls); isCancelled safe only by monotonicity

**extension-messaging (scope-adjacent, dedicated section)**
- P3-C3a core/base-service.ts:63-68 BaseService.start — unguarded check-then-await-then-set on initialized; concurrent starts double-run init() (every service inherits)
- P3-C3b core/base-service.ts:108-119 handleRequest — ctx (Port) captured at dispatch, response posted to possibly-dead Port after up-to-30-min invoke (3-tier send fallback absorbs; background/service.ts:96 .includes is the mitigation the send lacks)
- P3-C3c core/base-service.ts:117-119 — keepalive ended BEFORE awaited sendResponse: SW kill in the gap loses the response with no terminal record
- P3-C3d core/base-service.ts:128-132 emit — wire-first fire-and-forget vs local invoke ordering; remote can observe out-of-order emits
- P3-C3e background/client.ts:45-64+80-121 connect — NO single-flight; overlapping connect() bodies leak a Port whose listeners still drive disconnect→rejectAllPending against the LIVE port; waitForConnection re-fires connect per 300ms poll (amplifier)
- P3-C3f core/base-client.ts:239-243+261-271 rejectAllPending — re-entrant request() from a rejection handler inserts into pending mid-drain and survives attached to a Port about to be nulled
- P3-C3g offscreen/client.ts:99-133 bypassReadyOnce — instance-level boolean; soundness depends on base request() never awaiting before ensureTransportReady; a sync throw before consume leaks true → next request silently skips ensureOffscreenRunning
- P3-C3h pxe/client.ts (C1 rows) — request() generation-stamp family: pre-stamped bypass never re-validated; provider re-read post-await; no single-flight on recovery provisions (benign-deterministic today); capture-conditional equality guard hole for unregistered providers
- P3-C3i profile/client.ts (C2 rows) — subscribeActiveProfile: lost-event window is a full RPC round-trip (not "one microtask"); no unsubscribed latch (late write into unmounted consumer); reconnect emitSnapshot races; initial-failure + already-connected → handler never fires; 4 sibling events have no helper (consumers hand-roll)
- Clean roster: 14 thin clients, spec/type files, sender-auth, rpc-methods, telemetry (sync-by-contract), decode/error-envelope/utils/zod-helpers; base-client request-id/deadline/settle/handleResponse verified correct (3 deliberate correct instances noted).

