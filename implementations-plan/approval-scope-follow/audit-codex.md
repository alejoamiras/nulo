**1. Adversarial / security**

- **HIGH — Hidden-account protection is incomplete. Confidence: high.** Skipping the explicit account write does not prevent activation of a hidden account. Network switching loads accounts with `includeHidden=true`; [`setupActiveAccountRun`](apps/extension/src/stores/app.store.ts:378) selects the remembered address or `accounts[0]` without checking visibility. A network-only follow can therefore surface a hidden account. Also, `op.account.visible` is an initialization snapshot: hiding the signer while approval is open invalidates it. Revalidate visibility and protect the eventual selection, including fallback.

- **HIGH — Cross-realm writes lack an ownership fence. Confidence: high.** The global account key carries neither profile nor network identity. An approval continuation can overwrite a newer selection or race another realm’s bootstrap. The local activation epoch cannot arbitrate that write. Network persistence checks ownership, but only **after** the proposed account write. This is durable selection corruption, not evidence of access to another profile’s keys: bootstrap still resolves addresses against that profile’s account list. Fence the follow against profile changes, disposal, and superseding selections.

The dApp can choose among authorized operation targets and deliberately cause repeated mismatches; it cannot directly supply banner labels through these resolved rows. Informational styling reduces alarm fatigue but does not prevent griefing. Keeping follow exclusively behind successful popup approval preserves the confirmation boundary; silent execution must remain excluded. **Confidence: high.**

I found no demonstrated mid-flight signer substitution from the pointer write alone: [`send.vue`](apps/extension/src/popup/pages/send.vue:333) snapshots network/account into transfer arguments, and the executor uses those arguments. However, adding live scope synchronization must respect the receiving realm’s pending sends and send form. The closing realm’s guard cannot establish their safety. **Confidence: high.**

**2. Assumption attack**

**Facts**

- **MEDIUM — Fact 6 is conditionally correct, overstated as universal. Confidence: high.** With complete network IDs and an unchanged viewed scope, your proof holds: every follow-eligible payload lies outside that scope. Multi-signer follows require a different chain. However, [`hasInFlightSend`](apps/extension/src/utils/in-flight-send.ts:48) treats either missing network ID as a wildcard; the store also blocks while its tracker is unready. Current send journal creation supplies network IDs, so this does **not** establish ordinary self-blocking. Narrow the claim and test unknown scope, tracker readiness, and scope drift.

Facts 1–5 largely match the source, but Fact 4 does **not** imply another popup reacts to the emitted event. `approveInteraction` acknowledges acceptance and starts detached execution; it does not await transaction success.

**Inferences**

- **HIGH — Inference 2’s event chain does not exist. Confidence: high.** [`popup/app.vue`](apps/extension/src/popup/app.vue:111) watches its realm’s `appStore.network`. No UI subscribes to `onActiveNetworkChanged`, and no account-pointer listener updates an open popup. Account-only follow therefore changes storage without moving an open activity screen; chain follow likewise leaves another realm unchanged. Your chain e2e’s existing wallet page should expose this. Pointer-first ordering helps the **calling realm’s** network watcher, not the claimed cross-window propagation.

- **HIGH — Inference 1 does not establish safety. Confidence: high.** “This window performs none” is false once `activate()` assigns its local network and triggers account setup. More fundamentally, another realm can write the same key. Pointer-only persistence is sufficient for a later bootstrap, not the promised already-open view.

Inference 4’s funding/fee premise is supported: account rows survive network selection, and fee components receive the operation’s network/account. Its **post-follow UI assertion** remains unsupported. **Confidence: high; execution untested.**

**Asks**

- **MEDIUM — Resolve Ask 1 before implementation.** Removing the transaction clause still leaves the behavioral decision to follow read/registration-only approvals.
- Ask 2 should explicitly cover **complete execution failure**, too: this insertion point cannot distinguish partial success, total failure, or eventual success. Confirm that acceptance alone triggers follow.

**3. Implementation critique**

- **HIGH — Pointer-first contradicts “blocked skips both.” Confidence: high.** [`activateNetworkGuarded`](apps/extension/src/utils/guarded-network-activation.ts:60) refreshes the journal before admission. After the account write, activation can return `blocked`, `stale`, or `unconfirmed`. A preliminary boolean check cannot close that race. Define coordinated admission, persistence, and reconciliation; blind rollback could overwrite a newer selection.

Keep the resolver colocated and reuse signer/network deduplication. Hoisting a shared comparison core is possible without CAIP re-encoding, but offers little benefit. Rejecting a generic `useAccountActivation` is reasonable; rejecting **any coordinated scope boundary** is not.

The decomposition is reasonable, but specify zero signers, unavailable active scope, and `default_entrypoint`/`NO_FROM`: an attached account is not necessarily the transaction signer.

Service-worker coordination deserves reconsideration because serialization matters here. It need not affect every approval type, but moving writes there alone still does not synchronize open views.

The gates are real, but mocked activation cannot prove ordering or cross-realm convergence. Add successful account-follow coverage and tests for delayed guard refusal, persistence failure, hidden fallback, profile drift, and an already-open wallet. The current account e2e proves only decline.

**4. Verdict**

reject (with blocking findings: absent cross-window propagation, account writes preceding guard admission, and incomplete profile/visibility fencing)

---

# Round 2 — resumed session, on plan rev 3

**1. Previous blocking findings**

- **Cross-window propagation: resolved by explicitly narrowing the contract** to the next popup opening.
- **Account-write-first: resolved as originally reported.** Direct network-first persistence avoids the closing realm’s network watcher. It does not make the two writes atomic.
- **Profile/visibility fencing: partially resolved.** Hidden-account activation is now an acknowledged limitation, not prevented. Profile changes during follow remain unfenced. The ledger should distinguish accepted behavior from repaired behavior.

**2. Phase 0**

The account/network safety argument is supported: the dApp send paths use explicit operation network/account identifiers. Actual `seed` producers create `token_import` records, already excluded by `SENDING_KINDS`; they never needed this freeze. **Confidence: high.**

- **MEDIUM — Journal origin does not consistently mean “initiated by the wallet UI.” Confidence: high.** [`auth-registry/service.ts`](apps/extension/src/wallet/services/auth-registry/service.ts:280) sends revocations and registry-enable changes with `OriginType.UI`, but `ExecutionLane.beginJournal()` hardcodes `origin: "dapp"`. Phase 0 therefore removes their freeze too. Their explicit scope arguments support allowing account/network switching, but the plan must acknowledge and test this case—or correct their journal provenance if D1 means all UI sends remain guarded.

- **MEDIUM — Profile safety needs separate evidence. Confidence: high.** DApp execution does read the active **profile** while acquiring lanes and building transactions. `profile-switch-teardown.ts` terminates channels; it does not itself prove that already-running execution aborts safely. Network ownership checks provide protection, and this interleaving was already reachable, but add a regression that switches profiles while execution is parked and proves no successor-profile signing or transaction attribution.

- **MEDIUM — The proposed Phase 0 e2e is ineffective. Confidence: high.** Switching after the returned hash appears in Activity generally tests a completed send, which the old guard already permits. Hold a dApp send at `proving`, assert its nonterminal journal stage, then switch. Retain the equivalent popup-transfer refusal test.

Keep `origin === "popup"` **alongside** `SENDING_KINDS`; removing `dapp_execute` substitutes operation type for provenance. Give existing fixtures explicit origins—they currently omit them—and test mixed popup/dApp records plus all guarded stages.

**3. Direct-write follow**

- **HIGH — The account write can outlive its profile. Confidence: high.** Acceptance → await refresh/network RPC → lock or profile switch → account write remains possible. The existing profile-change handler initiates rejection/closure; it does not cancel this continuation. Capture approval profile and a lifecycle generation, invalidate on lock/profile change/disposal, and recheck after awaits. Account-only follow has no network ownership check at all. Test both paths.

- **HIGH — “Last write wins” does not describe a two-key update. Confidence: high.** Two follows can interleave: X writes network X; Y writes network Y and account Y; X writes account X. The result is **network Y/account X**, neither intended pair. A popup opening between writes can also bootstrap and overwrite the account fallback. Refreshing the journal does not serialize either case. Specify coordination/reconciliation, or explicitly surface partial/mixed persistence as an accepted limitation; the current race-free inference is false.

- **MEDIUM — Persistence failures are indeterminate. Confidence: high.** [`setActiveNetwork`](apps/extension/src/wallet/services/network/service.ts:567) persists before node creation/event emission; an RPC rejection can occur after persistence. Conversely, account storage can fail after network success. Add both cases to Phase 3 and define the resulting behavior without blind rollback.

Two factual corrections: the tracker already refreshes automatically on profile changes, so cold-read failure is not inevitable; an explicit refresh is still useful. Also, un-awaited execution runs concurrently with follow—follow is **not guaranteed to precede execution**.

**4. Verdict**

conditional approve (with conditions: fence follow continuations against profile/lifecycle changes; resolve or explicitly accept mixed-pointer persistence; cover UI auth-operation provenance and genuinely in-flight switching in Phase 0 tests)

---

## Round 3 — fresh-context pass on rev 4 (GPT-6 Astra, `high`, new session) → reject

Prompt: a new session with no prior context, handed rev 4 plus the full decision trail, asked to re-judge the whole plan (adversarial, assumption attack, implementation critique) and specifically the rev-4 call to reject the execution-lane regression test.

**Rev 4 still overstates its safety guarantees. Confidence: high.** The main blockers are the follow's incomplete lifecycle fence and the unsupported justification for removing profile-switch protection.

1. **HIGH — The follow can still write after lock/profile change.** Checking `appStore.profile` before `storageLocalSet()` does not fence persistence: [storage.ts:73](apps/extension/src/utils/storage.ts:73) first awaits `migrationIdle()`, then writes without another check. Moreover, `app.vue` awaits `getProfiles()` before clearing the store on lock, so the store can temporarily retain the old profile even after the lock event arrives. `disposed` alone does not represent that invalidation.

   Capture the approval identity before awaiting approval, invalidate a lifecycle generation immediately on lock/profile-change events, and define how persistence checks that generation after its internal waits. Add a test suspending **inside the storage facade**, not merely inside `refreshInFlight` or the network RPC. Phase 3's "nothing is written for the wrong profile" promise is currently unproved. **Confidence: high.**

2. **HIGH — Rejecting the execution regression was the wrong call.** **Fact 1** is false if "active scope" includes profile. [TxRequestBuilder:214](apps/extension/src/wallet/services/execution/tx-request-builder.ts:214), lane acquisition, and the estimate-reuse execution path read the active profile. **Fact 19** describes a *deletion* epoch; it does not fence ordinary profile switches. Channel teardown is not evidence that an already-running execution remains correctly attributed.

   Consequently, **Inferences 5 and 6** establish account/network independence, not profile-switch safety. Earlier reachability does not justify broadening exposure without a regression. Hold execution across a profile switch and verify that it either fails safely or finishes exclusively under its original signing and persistence identity; cover the UI auth-registry path too. I found no demonstrated theft exploit, but the asserted safety argument is incomplete. **Confidence: high.**

3. **MEDIUM — Mixed persistence is understated, and serialization was dismissed on a false premise.** Neither approved intent is the resulting network-Y/account-X pair. It can recreate the empty-feed problem and select a signing default the banner never announced. **Inference 1** also cannot promise "the signer lands last": another popup's fallback write can complete after the follow.

   "The only cross-realm lock would be a storage lock" is false: [Web Locks](https://www.w3.org/TR/web-locks/) coordinates same-origin windows and workers. Serialize concurrent follows and test their ordering. That alone does not coordinate bootstrap/manual writers; state that residual limitation explicitly. Keeping blind rollback disabled is sensible. Keeping arbitrary mixed pairs should be an explicit owner **Ask**, not supported by "never … unsafe." **Confidence: high on the race; moderate on its practical frequency.**

4. **MEDIUM — Same-chain network rows leave the original bug unresolved.** **Fact 3** correctly identifies `networkId` as part of feed scope; the proposed resolver compares only `chainId`. If the wallet views row B while dApp resolution selects row A on the same chain, with the same account, the resolver returns no mismatch and performs no follow. [activity.store.ts:97](apps/extension/src/stores/activity.store.ts:97) still excludes A's records.

   The known limitation about following the first row does not describe this case: it follows nothing. Define and test row-identity handling, or explicitly obtain acceptance that this supported configuration retains the empty-feed defect. **Confidence: high.**

5. **MEDIUM — Batch-padding griefing is reduced, not closed.** The single-send-like-signer rule defeats a second-account **read**, but a second-account send-like operation still suppresses account following. The resolver does not require that operation to succeed. Describe this as removing cheap read-padding, and test two send-like signers, including a failing secondary operation. Multi-signer ambiguity is legitimate; claiming attackers can no longer manufacture it is not. **Confidence: high.**

6. **MEDIUM — Phase 4's switch test is not a mandatory in-flight gate.** Logging that the proving window was missed and passing allows the test to exercise exactly the previously rejected terminal-state case. Predicate unit tests prove filtering, not safe execution during switching. Add a deterministic suspended-execution test; keep the live E2E as supplementary confirmation. **Confidence: high.**

The resolver promotion, direct writes avoiding the realm-local watcher, and isolated follow failure handling are appropriate. `origin === "popup"` matches today's transfer path, but means neither "all UI sends" nor "all profile-sensitive execution"; document it accordingly. Six phases and one PR are reasonable, provided Phase 0 has explicit safety gates and is prominent in the PR description.

reject (with blocking findings: incomplete lifecycle fencing of follow persistence; unproved profile-switch safety after Phase 0 guard removal)

**Driver's disposition (rev 5):** all six verified against source and adopted — see plan.md §Decision ledger, Round 3. Two owner Asks raised (builder fix pre-authorization if the Phase 0 pin reds; acceptance of the residual mixed-pointer pair).


---

## Round 4 — fresh-context pass on rev 5 (GPT-6 Astra, `high`, new session) → reject

Prompt: a new session, no prior context, handed rev 5 with the full trail and asked whether the round-3 blockers are closed and whether the fixes introduced anything new.

**Rev 5 does not close both blockers. Confidence: high.**

1. **HIGH — Round-3 #1: partially closed; account persistence remains unfenced.** Capturing the generation before approval and invalidating it synchronously fixes the delayed-store problem. Approval completion, lock acquisition plus `refreshInFlight()`, and network-RPC completion are checked before subsequent writes.

   But step 4 still does: await outer barrier → check generation → call `storageLocalSet()` → **await another barrier** → write unchecked. [migrationIdle](apps/extension/src/utils/storage.ts:32) performs a fresh `chrome.storage.local.get` on **every call**. It is neither cached nor immediately resolved. A profile event during that second read reproduces the blocker.

   Put the predicate **inside the facade, after its barrier and immediately before dispatching `set`**. Test the real facade by suspending its internal storage read; mocking the exported `migrationIdle` does not necessarily replace its module-local invocation. The network RPC also has internal awaits; caller invalidation cannot retract an already-dispatched persistence operation. Distinguish preventing subsequent writes from cancelling dispatched writes.

2. **HIGH — Round-3 #2: partially closed; the proposed evidence is insufficient.** **Fact 24** accurately identifies the composition graph and event, but its parked case tests gas-cache eviction. The harness hardcodes p1, returns an account regardless of requested profile, and deliberately bypasses fresh builds. A new pin is constructible with mutable profile state, ownership-aware network/account fakes, and enough build dependencies to reach the intended suspension. It is not constructible merely by firing the existing event.

   The acceptance criteria contradict themselves: permitting completion under p1 while requiring a failed journal and "never sent" forbids that permitted outcome. Choose **failure without submission**, or **completion with exclusively p1 signing, PXE, journal and transaction attribution**.

   More seriously, **Inference 6's estimate-reuse claim is false**: [resolveStandardBuild](apps/extension/src/wallet/services/execution/dapp-send-executor.ts:775) bypasses the builder, resolves network/node/PXE, **then rereads the active profile for the account**. Park there too, including p2 owning the same imported address; "p2 cannot own this address" is not an invariant. `buildNoFrom` separately reads the active profile.

   D4's explicit profile is the right direction for fresh builds, but changing only `resolveBuildContext` leaves reuse, NO_FROM and lane acquisition untouched. Require consistent authorization identity across those paths, or reject drift before using inconsistent contexts. A green fresh-build pin cannot establish that.

3. **MEDIUM — Web Locks improves serialization, but "two complete pairs" is conditional.** Normal `closeWindow(true)` occurs after the awaited lock request, so that ordering is correct. MV3 does not itself invalidate using the API in an extension document; jsdom needs the stated stub. However, unloading the holder releases its locks; it does not roll back storage or cancel an already-running SW RPC. Closure/crash between writes can still leave a partial pair, and outstanding worker work can outlive the lock. Document this additional limitation and verify actual cross-window locking in Chrome; a queue mock only proves application ordering. [Web Locks specification](https://www.w3.org/TR/web-locks/#termination-of-locks).

4. **MEDIUM — Fact 22's comparison is right; the duplicate-row premise is overstated.** Both queries filter the same stored rows, so stable-profile resolution agrees. However, [network creation](apps/extension/src/wallet/services/network/service.ts:477) explicitly rejects a second row for the same profile/chain. This is not an ordinary supported configuration.

   Resolution also occurs at different times: queued creation, popup initialization and SW materialization. Delete/recreate can invalidate the popup snapshot; `claim-helper.ts` explicitly refiles queued records to execution's resolved scope. I found no demonstrated stable-state case where following an existing row lands elsewhere than execution, but "always the same row" is unjustified. Row comparison remains a sensible defensive choice.

**Remaining assumption checks:** Facts **20–21** are correct; their proposed remedy is not. Fact **23** is confirmed. **Inference 1** supports avoiding the network watcher, not excluding every already-running bootstrap writer. **Inference 5** is supported for account/network, not yet profile. **Inference 7** is supported by `lockActiveProfile()` and its event wiring.

D5 honestly accepts manual/bootstrap races; no new owner Ask is needed for that decision. Known limitations still need holder-termination coverage and the corrections above. Batch-padding wording and the deterministic store gate are appropriate.

reject (with blocking findings: storage facade still awaits after the lifecycle check; profile-switch pin and D4 fix do not cover all execution paths)

**Driver's disposition:** all four verified. #1, #3, #4 adopted for rev 6. #2 led to owner decision D6 — a prerequisite plan, `profile-fenced-execution`, binds every send path to its authorization-time fence; this plan is parked until it merges. See plan.md §Decision ledger, Round 4.


---

# Round 6 — fresh-context codex pass on plan rev 6 (GPT-6 Astra, `high`, static) → reject

Run 2026-09-17 against `origin/dev` @ `0e9d9ce2`. Dispositions: `plan.md` §Decision ledger, "Round 6".

**Reject — rev 6 closes the original storage/profile blockers, but leaves a silent-authwit authorization gap and an incomplete cache reset. Confidence: high.**

1. **HIGH — Phase 5 / Fact 30: capture occurs too late. Verified.** `dispatcher.ts:987` awaits account/network resolution; `execution/service.ts:644` then awaits initialization before reaching the authwit arm. A covered request can pause there, survive a lock/re-unlock of the same profile, and capture the **new** session. Both proposed checks then pass. The response guard explicitly permits same-profile lock/unlock (`wallet-sdk/background.ts:1112`). This contradicts “capture at authorization” and is missing from Security. **Smallest fix:** capture the existing `ExecutionFence` in the trusted silent-request path before awaited resolution, validate its profile against `ctx.profileId`, and forward it through `executeOperations`. Add a parked-resolution/initialization test across same-profile re-unlock. The arm’s fallback alone cannot establish authorization provenance.

2. **MEDIUM — Phase 0, architecture 0b: outstanding reads can undo the reset. Verified.** `refreshInFlightOps` validates only `profile.id` before replacing rows and setting readiness (`app.store.ts:271–273`). A pre-lock read can finish **after** `resetInFlight()`, restoring the cancelled transfer and permanently reactivating the cached refusal. `Header.vue:35–42` supplies a concrete route: its timed-out journal read continues after locking. Conversely, an old locked-session response can overwrite the unlock refresh. **Smallest fix:** invalidate outstanding tracker reads on reset/unlock and reject their late success/error writes using a local generation. Test both completion orders. Keep `commitScopeChange`’s unconditional refresh. If the unlock refresh is awaited before publishing `isLogined = true`, retain the final lock-wins check after that new await.

3. **MEDIUM — Phase 3 / round-4 #3: the browser-lock evidence remains missing. Verified.** The plan still tests only a queue mock (`rev6:743–746`), although round 4 explicitly requested actual cross-window verification. Holder termination releases the lock without cancelling an already-dispatched worker RPC; “two complete pairs” therefore remains conditional. **Smallest fix:** add a focused browser test with two extension windows, including holder termination, and explicitly document surviving worker work. No atomic-write redesign is required.

4. **LOW — contradictory implementation instructions remain. Verified.** Security still specifies only `assertFence` immediately before signing (`rev6:433–438`), conflicting with Phase 5’s synchronous final check. The state machine claims operations always share one row (`:133–137`), and Trade-offs still says a profile can hold two rows on one chain (`:379`), despite round-4 #4’s correction. **Smallest fix:** align those passages with Phase 5 and qualify row agreement as stable-state agreement; delete/recreate can invalidate the popup snapshot.

**Round 4 status**

- **#1 — closed:** the predicate inside the facade, after its own barrier, closes the identified await gap; dispatched writes remain irreversible.
- **#2 — closed:** merged lane, fresh/NO_FROM builders, reuse paths and submission checks consume the authorization fence; the existing composition case supplies the requested evidence.
- **#3 — not closed:** termination is acknowledged, but actual cross-window verification and surviving-RPC wording remain outstanding.
- **#4 — not closed editorially:** Known limitations is corrected; contradictory same-row/duplicate-row claims remain elsewhere.

**What holds**

Resetting to empty/ready after an actual lock is safe for the picker; execution does not consume this cache. Ordinary closes reach `enterLockedState`, but superseded lock handlers deliberately return at `app.vue:168`, so Inference 8 is too absolute. Execute windows use the same shell/store implementation in separate realms and are affected too.

For an already-correct fence, account lookup by `fence.profileId`, awaited assertion, then synchronous liveness immediately before signing is sound. No steady-session popup/silent/batch regression was identified. Keep authwits outside `FENCED_OPERATION_KINDS` under the current entry contract. `false` on skipped storage writes is sensible; return `true` only after successful persistence. Existing signer helpers, Banner, storage facade and prerequisite tests are appropriately reused.

**Asks:** Prefer **(b)**. Fold Ask 2 into the execution PR: throwing on missing journal creation is appropriate. The dApp caller releases both controller keys and its slot; the transfer call must enter task-failure handling. Pin refusal-before-proving and terminal task cleanup at both sites.

## Round 2 (resumed session) → conditional approve

**Conditional approve — align the runner’s argument positions and correct the browser-test claim. Confidence: high.**

1. **MEDIUM — Phase 5 / `services-contract.ts:77`, `background.ts:187`, `execution/service.ts:625–642`. Verified.** The bridge interface currently has **four** parameters; adding one trailing fence makes it parameter **five**. The concrete service expects approval envelopes fifth and the fence **sixth**. There is no execution adapter today: `background.ts` passes `ExecutionService` directly. Following the proposed signature literally either fails typechecking or leaves `authorizedFence` absent and rejects silent authwits. **Smallest fix:** preserve an optional fifth `undefined` placeholder in the consumer interface, declare the fence sixth, and pass `undefined, undefined, undefined, ctx.fence` after operations/origin. No new adapter is needed. Pin the call’s argument positions.

2. **LOW — Phase 4 / Known limitations: the proposed test does not establish lock acquisition. Verified.** Both windows closing and the pointer ending at B or C also passes with locking completely removed. Additionally, `concurrent-sendtx-confirm.test.ts:74–84` opens the second popup **after approving the first**; it does not establish two initially open approvals. **Smallest fix:** hold the real named lock from another extension page, approve a request, verify its follow is pending and its pointer unchanged, then release the holder—or close that page—and verify completion. `navigator.locks.query()` can expose the pending request. This requires neither another chain nor production hooks.

**What I checked**

- **#1’s security redesign closes the identified gap**, provided the fence reaches argument six. Entry capture precedes dispatcher resolution and execution initialization; the signing arm cannot silently adopt a successor session. The optional structural context field and consumer parameter are proportionate plumbing. Adding authwits to `FENCED_OPERATION_KINDS` is now correct.
- **Batch inheritance is correct for silent authwits.** Each leg still revalidates dApp permissions. Popup-approved authwits continue receiving their approval-time fence through `DappInteractionService`; they should not be changed to consume the older batch fence. Other legs ignore the field.
- **#2 closes the outstanding-read races** as specified, including rejecting late responses. Preserve the bootstrap’s final lock-wins check if adding an awaited refresh before publishing login.
- **#4’s named contradictions are corrected.**
- **#3’s partial adoption is acceptable concerning pair ordering and mid-pair termination.** The documented non-atomic outcome is accepted scope; a new production hook solely to exercise it is unnecessary. But one chain does not prevent observing actual lock contention, using the browser-level test above.

No further material problem identified in this static pass.

## Round 3 (resumed session) → approve

**Approve — both remaining conditions are satisfied. Confidence: high.**

No new material findings.