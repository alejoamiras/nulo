# Codex-leg audit — profile-fenced-execution

OpenAI-family leg of the mid-tier dual audit (GPT-6 Astra, `high`, read-only sandbox on the worktree at `c543c18d`). Every path is repo-relative. Driver disposition per finding is in `plan.md` §Decision ledger.

## Round 1 — on rev 1 → no verdict

The session read ~17 cited files and then the ChatGPT account hit its usage limit; no response was produced. Logged in `lessons/planning.md`. The owner re-logged codex into a subscribed account the same day.

## Round 2 — on rev 2 → reject

**Rev 2 still violates D5 and does not reliably implement D7. Confidence: high.** This is a source audit; I did not run implementation tests.

1. **CRITICAL — profile identity is not session identity.** Inference 2 is unsafe. A→B→A and A→lock→A preserve both fence fields. An asynchronous sweep cannot repair this invariant: it can miss records created after enumeration, while a delayed profile-wide enumeration can cancel newly authorized work after A returns. There is also an initialization hole: [silent restore emits no event](apps/extension/src/wallet/services/profile/service.ts:462), so merely remembering truthy subscriber events misses the restored session’s first lock. Capture a session generation, invalidate it synchronously on session termination/replacement, and scope cleanup to the ended generation. Initialize the subscriber baseline. Fable’s identity-over-epoch endorsement and disposition #9 are insufficient under D5.

2. **CRITICAL — the “blind window” is a defect, not an acceptable limitation.** The [coordinator](apps/extension/src/wallet/services/execution/execution-coordinator.ts:298) awaits `toTx()` and journal persistence after the proposed assertion. Lock can occur there; if `submitting` wins before cancellation, the sweep refuses cancellation and broadcasting continues while locked. No broadcast had occurred when the user locked. Serialize final authorization/admission with session termination after `toTx()`, and define the submission commitment point explicitly. Do not hold the facade lock across network I/O. Fable disposition #5 documents the breach without resolving it.

3. **HIGH — alarm-only deferral loses ordinary races.** Inferences 7–8 and the lazy-expiry limitation overclaim. A normal `getActive()` call can acquire the facade lock after `lockedAt` but before alarm processing and close the session. No broken alarm is necessary. Expired restore also closes independently. Furthermore, [calling `refresh()` directly](apps/extension/src/wallet/services/profile/session-manager.ts:422) first calls `getActive()`, closes an expired session, and uses configured TTL rather than 60 seconds. Extract the persistence/alarm writer and reconcile all expiry paths. Sixty seconds is a reasonable polling interval, not a correctness guarantee.

4. **HIGH — the reaper does not bound session deferral.** Fact 15 correctly lists stage grace periods; the claimed session-wide bound does not follow. [Reaping measures `updatedAt`](apps/extension/src/wallet/services/operation-journal/reaper.ts:187); execution waiters are heartbeated without the queued-wait ceiling, and silent sends enter `pending` before acquiring their slot. Successive sends can continually replenish eligible work. Capacity limits bound concurrency, not duration. Silent execution also refreshes the session and need not represent a fresh user click. D7 hides an unresolved product choice: an absolute deferral deadline versus potentially indefinite activity-driven unlocking.

5. **HIGH — the change map misses execution plumbing.** [TransferEstimateReuse](apps/extension/src/wallet/services/execution/transfer-estimate-reuse.ts:176) independently rereads the active profile and falls back on mismatch; modifying `OperationEstimateReuse` does not cover it. Fact 7/recon’s read-site inventory is incomplete. Required builder fences also cross fee strategies, discovery estimation and view/estimate callers omitted from the map; preserve the existing fee-method and gas-settings arguments. Separately, slot acquisition sits outside `runInSlot`’s catch: a new early assertion can strand a silent path’s already-`pending` record. Specify terminalization before claim.

6. **MEDIUM — the promised lock error contract contradicts the implementation.** Phase 0 deliberately throws plain `"Wallet locked"`, which cannot become typed `SESSION_ENDED` through the proposed class-only classification. Successful sweeps instead produce `JobCancelledSentinel` → cancellation/`JOB_CANCELLED`. Inference 3 is correct about channel survival, not guaranteed error delivery. Make the locked-fence failure typed, and either preserve cancellation semantics in the documented envelope contract or introduce an explicit lifecycle cancellation reason. Both terminal shapes are reasonable; the current guarantees are not.

7. **MEDIUM — consent remains best-effort, and the selector refusal is not moot.** The tracker is asynchronous and initially empty; count-zero can lock without warning while approved work exists. Refreshing improves accuracy but cannot eliminate the popup-to-worker race. This needs an explicit best-effort consent decision. Also, [the selector](apps/extension/src/popup/components/popups/SelectProfilePopup.vue:50) still checks cached `hasInFlightSend` before refreshing; lock does not necessarily clear that tracker, and locked journal events are filtered. Stale or submitting rows can still produce the refusal toast. Fable #4 is therefore not wholly moot. Excluding submitting work is otherwise sensible. Reset/restart may bypass this dialog; inactivity expiry must honor D7.

8. **HIGH — Phase 6’s TTL test cannot run as specified.** The [proof gate auto-releases after 20 seconds](apps/extension/src/e2e/chrome-storage-proof-gate.ts:19); settings accepts integer minutes, whose smallest positive value is 60 seconds. Increasing Vitest’s timeout alone cannot fix this. Specify a test-only longer gate or a controlled shorter TTL, plus sufficient timeout for the subsequent 60-second alarm. The other two e2es are constructible, but profile creation must not outlast the gate unnoticed.

**What holds:** Both dApp entries, including public-authwit grants through the dispatcher, converge on `executeOperations`; I found no additional fence-less dApp send route after the proposed changes. Auth-registry calls are UI-originated. Keeping `executeTransfer`’s RPC signature unchanged is right.

Facade-locked assertions need an internal SessionManager read, not recursive `getActiveProfile()`. Existing send callers do not already hold that facade lock. The in-process journal query does not acquire it; wire deferral without introducing a Profile↔Execution initialization cycle. Inference 4’s journal-first cancellation is sound with per-record error handling; `transitionIfStage` is existing reusable machinery. Illegal transitions must neither abort controllers nor escape into unlock.

Inference 1 holds narrowly: warm PXE work may continue against **A**, not B; missing-key reprovision fails closed, and proving has a timeout. It does not guarantee immediate termination on lock.

Facts 1–26 were checked. Besides substantive corrections above, Fact 11’s actual query is `app.store.ts:253`, Fact 12’s missing-key rejection is runtime client `:182-183`, and Fact 17’s lock wrapper is `profile/service.ts:294-295`. Remaining cited anchors support their local claims; Fact 13 describes UI routing, not an enforced service precondition.

Phase 2’s transfer reuse cases fit D1–D6. DApp build gates must target a specific lookup before the rejecting assertion; after Phase 3, event-driven cases expect cancellation, so retain separate checkpoint tests. The commands exist. Keep synchronous failure classification and revise ordering pins deliberately. Two review arcs are reasonable, but do not ship/revert cancellation independently of its consent UI.

**Outline B:** reject its veto and sparse checkpoints. Its generation idea is stronger than the draft’s ABA handling; combine that with thorough fence threading and no veto.

reject (with blocking findings: session-generation gap, non-atomic submission admission, inconsistent expiry deferral, false deferral bound, incomplete execution plumbing, and unconstructible TTL e2e gate)
## Round 3 — resumed on rev 3 → reject

**Rev 3 fixes the central identity problem, but still has blocking cancellation and expiry races. Confidence: high; cap recommendation: moderate.**

1. **CRITICAL — the revised sequence removes a necessary cancellation checkpoint.** The flow diagram moves `checkCancelled` before `journal(submitting)` and omits the existing check afterward. Cancellation can win during that journal await; `markJournal` swallows the rejected transition, `assertLive` still passes because the session remains open, and the cancelled transaction broadcasts. Preserve the [post-submitting cancellation check](apps/extension/src/wallet/services/execution/execution-coordinator.ts:303), followed by `assertLive`. The existing coordinator test explicitly pins this behavior. A session check cannot replace a job-cancellation check.

2. **HIGH — resetting `deferredFrom` on every refresh defeats the absolute cap.** `silentInteraction` calls [refreshSession before execution](apps/extension/src/wallet/services/dapp-interaction/service.ts:475). Repeated capability-authorized calls therefore reset both inactivity and deferral deadlines without another human action. The disposition of round-2 #4 remains incomplete. Distinguish user activity from dApp activity: only the former should reset the user-inactivity budget. Otherwise describe the cap honestly as bounding one uninterrupted deferral episode, not preventing indefinite dApp-driven unlocking. Changing the number cannot fix this.

3. **HIGH — Inference 7 lacks stale-decision protection.** An off-lock `expireOrDefer(S)` can await its predicate while `refresh()` extends **the same session object**, another deferral advances its deadline, or configuration disables expiry. Identity still matches. The stale result can then close the refreshed session or overwrite its newer deadline. Revalidate identity **and the observed expiry/activity/configuration revision** after the predicate and at the write; deduplicate concurrent expiry decisions. Do not reacquire the facade lock from `getActive`, or call and await `close()` while holding the artifact lock it reacquires. Clamp the next deadline to the cap instead of closing early whenever a whole polling step no longer fits.

4. **HIGH — serial-tagged controllers do not automatically make the sweep complete or current.** `abandonDeadSessions(liveSerial)` can retain an obsolete argument across scheduling and journal awaits. A lock-triggered sweep carrying `undefined` can cancel a newly registered live session’s work. Determine deadness using current state per candidate; never select future registrations using an old live-serial snapshot.

   Registration also has gaps: [acquireSlot](apps/extension/src/wallet/services/execution/execution-lane.ts:248) awaits network resolution before registering, and registers nothing without `queuedJournalId`; transfers register only after journal creation and have no controller if creation fails. `claim-helper.ts` directly mutates the controller map at multiple sites but is absent from the change map. Centralize serial-aware registration, immediately reject/cancel stale registrations, and cover no-journal waiters. Final fence checks prevent broadcasting, but missed sweeps can leave waits, heartbeats and cards alive.

5. **MEDIUM — serial publication needs an explicit restore rule and correctly framed tests.** Allocate the serial inside the artifact section and include it in the object assigned at [session-manager.ts:298](apps/extension/src/wallet/services/profile/session-manager.ts:298), before `onChange`. Never reuse a serial after failed publication. Also allocate one at restore’s assignment, `:627`; “restore untouched” cannot literally hold.

   Normal facade-locked captures wait until open and its facade validation finish; they cannot resolve halfway through publication. The off-lock peek **can** see the provisional session while persistence is pending, including before rollback at `:321`. That does not revive an old fence: the serial differs, and normal captures cannot obtain the new one yet. Preserve intentional memory-only degraded success. Test successful persistence, degraded success and rollback. An absolute “ANY point” claim also needs to account for the facade lock’s five-minute force-release watchdog.

6. **MEDIUM — validation still needs deterministic clocks and adversarial scheduling.** Inference 6’s transfer reuse and separately fired events are suitable. Add tests for cancellation during the submitting write, stale sweep arguments, registration after sweep, and refresh/config changes during a deferred predicate. Phase 2 case 10 should end the session **while `sendTx` is pending**, not merely after it resolves.

   Inference 9’s unpacked-extension exception is documented, but alarm delivery can be delayed. [Chrome alarm documentation](https://developer.chrome.com/docs/extensions/reference/api/alarms#method-create). Setting an 8-second TTL can immediately expire an older session through `applyTtlChange`; anchor it to a fresh session/activity timestamp. Observe actual expiry/deferral, not just elapsed time and unchanged DOM. Explicitly drive the lazy-path fallback; the popup’s poll runs every ten seconds, so “locks within eight seconds” is not guaranteed by that fallback.

**Commitment point:** Inference 2 is correct about the current wrapper: `startSubtask`/`startNewTask` are synchronous, and there is no await before `node.sendTx` at `:264`. Put `assertLive` immediately before that invocation, inside its `try`, after task creation. This binds authorization to invocation—not eventual transport transmission.

**Facts and remaining inferences:** Facts 27–32 and 34 support their substantive claims. Fact 33 overgeneralizes: capacity rejection already terminalizes; an unhandled new assertion would not. Fact 13 is wrong about “close + open”: `open` directly replaces the active object. Inference 10 incorrectly calls ViewExecutor UI-only; it serves dApp simulations too. Inferences 1, 3–5 and 8 otherwise remain sound within their stated scope.

**Ask A1:** Ten minutes is a defensible convenience ceiling, not an evidence-backed proof-duration guarantee. I prefer `min(configured TTL, 10 minutes)` additional grace, anchored to the last qualifying **user** activity; it respects short lock preferences and remains bounded for long TTLs.

**What holds:** Per-session serials, both fence entry points, typed lock failures, journal-first conditional cancellation, shared expiry handling, and releasing both review arcs together are sound directions.

reject (with blocking findings: removed cancellation checkpoint, refresh-reset cap bypass, stale expiry decisions, and incomplete/stale sweep tracking)
## Round 4 — resumed on rev 4 → reject

**Rev 4 still has an expiry-coordination gap and invalid concurrency tests. Confidence: high; cap-policy judgment: moderate.**

1. **HIGH — Inference 7’s stale protection is incomplete.** [`applyTtlChange`](apps/extension/src/wallet/services/profile/session-manager.ts:746) writes storage and replaces alarms under the facade lock, **without the artifact lock**. An off-facade lazy deferral can therefore overlap those writes. Checking identity/deadline before entering `persistLockedAt` also leaves a scheduling boundary before its mutation. Moreover, “TTL still enabled” ignores nonzero-to-nonzero configuration changes.

   Serialize all deadline persistence/alarm replacement through the same mechanism; validate the expected deadline and configuration revision **inside that serialization**. Apply equivalent stale protection immediately before every close outcome, including predicate failure. Round-3 #3 remains partially adopted.

   I found no inherent recursive-lock deadlock with the proposed direct journal predicate. But the refresh-race test is wrong: [`refresh()` awaits `getActive()` first](apps/extension/src/wallet/services/profile/session-manager.ts:424), so it joins the pending expiry decision rather than refreshing underneath it. Awaiting refresh before releasing the predicate hangs the test.

2. **MEDIUM — Inference 11 still understates unregistered execution.** [`acquireSlot`](apps/extension/src/wallet/services/execution/execution-lane.ts:259) registers nothing without `queuedJournalId`. Journal-creation failures also allow execution to continue without a controller, including [transfers](apps/extension/src/wallet/services/execution/transfer-executor.ts:248). This is broader than a brief pre-creation span: waits/proofs can remain unsweepable. Final fence checks prevent broadcast, but do not provide prompt cancellation.

   Track execution independently of journal identity, or explicitly accept and test that broader limitation. Reconcile the dead-registration `cancelled` outcome with `acquireSlot`’s promised `failed/session_ended`; asynchronous journal-first cancellation cannot finish inside a `void` registration.

   **Fact 36:** claim-helper registrations are `181`, `197`, [`272`](apps/extension/src/wallet/services/execution/claim-helper.ts:272); `101` deletes. The lane’s set is `261`. **Fact 38:** transfers never take a slot. Round-3 #4 remains incomplete.

3. **MEDIUM — the activity-policy disclosure is honest, but episode mechanics need correction.** Leaving pre-existing dApp-driven refresh behavior out of scope is defensible. However, clearing `deferredFrom` only when an expiry predicate returns false also closes the session. A surviving session never observes intervening periods with no sends; later sends can inherit an exhausted budget. Define that deliberately as a session-level budget, or observe workload drainage to establish episode boundaries.

   Phase 4 also computes numeric `capMs` at initialization, while TTL remains mutable. Starting with TTL disabled and later enabling it would retain a zero cap. Derive the budget from the applicable TTL at episode start and specify configuration-change behavior. Ask A1’s `min(TTL, 10 minutes)` is reasonable, but not a proof-duration guarantee.

4. **MEDIUM — the cap arithmetic must handle missing persisted deadlines.** Restored sessions may legitimately lack `lockedAt`; existing expiry logic uses [`deriveLockedAt`](apps/extension/src/wallet/services/profile/session-manager.ts:675), falling back to `since + TTL`. Anchoring `deferredFrom` to the raw optional field, as specified, can leave it undefined and produce `NaN` in the clamp. Use the effective deadline for arithmetic, separately retaining the raw-field/configuration snapshot for stale detection. Add a restored-session case.

5. **MEDIUM — Inference 6’s submitting-write composition case cannot yield its expected result.** The journal holds its [transition lock through persistence](apps/extension/src/wallet/services/operation-journal/service.ts:338). Parking the submitting storage write makes cancellation wait; releasing it commits `submitting`, after which cancellation is illegal and does not abort. Awaiting cancellation before release hangs.

   Instead, park **cancellation’s** storage write, let submission queue behind it, then release cancellation. This exercises `:303` with the real FSM and an allowed storage fake. Round-3 #1’s production fix holds; its composition gate does not.

6. **MEDIUM — the TTL e2e introduces activity into its inactivity assertion.** Popup navigation invokes [`refreshSession()`](apps/extension/src/popup/app.vue:375). Use a direct, non-refreshing `getActiveProfile` RPC; verify actual deferral and release relative to the observed deadline. Fixed ~12/~15-second scheduling does not establish the intended expiry window or sufficient completion margin. Inference 9’s approach holds, but round-3 #6 remains only partially resolved.

**What holds:** Facts 35, 37 and 39, serial publication/rollback, per-record live-serial checking, and Inference 2’s invocation boundary are sound; assigning the serial on the published object does not create the suggested live-registration/peek mismatch.

reject (with blocking findings: incomplete expiry serialization and stale-decision protection, and invalid concurrency validation gates)
## Round 5 — fresh-context pass on rev 5 → reject

New session `01a0abbe-…`, no prior context.

Rev 5 closes the original dApp submission races, but two implementation gaps and one ineffective validation gate remain. **Confidence: high.** This was a source audit; no implementation tests were run.

1. **HIGH — auth-registry mutations can acquire a replacement session’s fence.**

   [revokeAuthwits](apps/extension/src/wallet/services/auth-registry/service.ts:251) awaits network resolution and authwit storage reads before calling `executeSendTransaction` without a fence. `setRegistryEnabled` similarly awaits network resolution before its call at `:330`.

   Concrete schedule: user authorizes under A₁ → park an authwit read → lock → unlock the same profile as A₂ → resume → `executeSendTransaction` captures A₂’s serial. Every proposed downstream check passes, and the old request can broadcast. The sweep cannot catch it because no controller existed when A₁ ended.

   **Inference 5 is unsafe as an authorization-boundary assumption.** Capture at both auth-registry mutation entries, before their awaited preparation, and forward that fence. Add the parked-read A₁→lock→A₂ regression. This belongs in scope: the summary explicitly promises protection for auth-registry sends.

2. **HIGH — the “single deadline writer” omits a full-session-row writer.**

   [clearBearer](apps/extension/src/wallet/services/profile/session-manager.ts:465) persists the entire session row at `:485` and `:492`, under the facade lock only. That row includes `lockedAt`. [ValueStorage.set](packages/wallet-core/src/storage/value-storage.ts:37) serializes the object immediately, so subsequent in-memory mutations do not update an outstanding write.

   An off-facade deferral can therefore overlap bearer removal: competing snapshots can overwrite a newer deadline or restore a bearer that strict-mode activation removed. The proposed deadline/configuration CAS does not serialize this writer.

   Put bearer-removal persistence under the same artifact serialization, with state revalidation inside it. Test both storage completion orders against deferral and close. **Inference 7 and the comprehensive “one writer” claim remain incomplete.**

3. **MEDIUM — the TTL e2e still does not establish that deferral occurred.**

   [Phase 6 case 2](implementations-plan/profile-fenced-execution/plan.md:892) records `t0` before the Send flow. Entering Send refreshes the session; submitting also [leaves Send](apps/extension/src/popup/pages/send.vue:384), triggering another route refresh. Consequently, “still unlocked at `t0 + 10 s`” can pass with deferral completely disabled.

   `peekSession` avoids introducing another refresh, but returns profile information—not the deadline needed to prove expiry was crossed. Observe persisted `since`/`lockedAt` after the final navigation, cross that actual deadline while proving remains held, and verify deadline advancement without activity advancement. Release relative to gate entry and the remaining budget.

   Case 3 also creates B while the 20-second gate is running; existing profile creation allows 90 seconds. Pre-create B or explicitly prove the gate remained held through the intended switch. [Chrome’s alarm documentation](https://developer.chrome.com/docs/extensions/reference/api/alarms#method-create) supports the lazy-path fallback, but cannot establish these test timings.

4. **MEDIUM — the stack initialization command is invalid.**

   The installed `gh stack init --help` has no `--adopt`; existing branches are adopted automatically. Use:

   ```sh
   gh stack init --base dev worktree-profile-fenced-execution
   ```

   Explicit `--base dev` also avoids relying on the repository’s default branch.

The ledger assessment is:

| Round | Disposition assessment |
|---|---|
| Fable r1 | All fourteen recorded dispositions are represented in rev 5; superseded proposals are correctly replaced. |
| Codex r2 | The specific fixes are represented. The broader expiry-coordination claim still needs finding 2 above. |
| Codex r3 | Rows #1–#5’s specific mechanics are represented, subject to that missing writer; #6’s e2e-validation disposition remains incomplete. |
| Codex r4 | **#1 is incomplete** because full-row persistence is not fully serialized; **#6 is not delivered** because Phase 6 never observes the deadline the ledger claims it uses. Rows #2–#5 are represented. |

I checked all 43 Fact entries and their cited source locations. The material problem is incomplete caller/writer coverage, rather than the central cited mechanics. Facts 35 and 39 support serial publication and the synchronous invocation boundary; Facts 16 and 40 do not constitute an exhaustive persistence inventory.

The serial allocation, rollback non-reuse, restore allocation, synchronous registration with caller-owned terminalization, and per-record sweep liveness are sound. Both dApp entry fixes preserve the authorization fence. Keeping `:303` before the synchronous submission check is correct; submission already invoked remains the explicit commitment boundary.

Phase 2’s eleven cases are constructible within D1–D6 using the existing reuse path and shallow boundary controls. Case 10’s cancellation-write parking is correct: cancellation owns the transition lock first, submission queues behind it, and the existing checkpoint prevents broadcasting. Phase 4’s fake-clock/alarm approach is appropriate, with the missing writer races added. The test commands otherwise exist.

The activity-policy and journal-independent-tracking limitations are defensible for **preventing stale submission**; they do not guarantee immediate cessation of proving. A1’s `min(TTL, 10 min)` is a reasonable product default—**moderate confidence**, not a proof-duration guarantee.

Two review arcs merged atomically are appropriate. Preserve the stated exclusions; add the auth-registry entry fences and bearer-writer serialization.

reject (with blocking findings: late auth-registry fence capture, incomplete session-row serialization, and a TTL e2e that can pass without exercising deferral)
## Round 6 — second fresh-context pass on rev 6 → reject

New session `01a0abc8-…`, no prior context.

Rev 6 still has **one blocking defect in session-row updates**. The send-fencing design holds. **Confidence: high.** I audited rev 6; I treated the question’s “rev 5” reference as historical.

1. **HIGH — the shared CAS can silently discard bearer removal.**  
   [The proposed writer](implementations-plan/profile-fenced-execution/plan.md:201) requires the expected deadline to match before applying **any** mutation, including `clearBearer`, and silently stands down on mismatch.

   Concrete schedule:

   - Lazy expiry and `clearBearer` observe the same session and deadline D.
   - Deferral acquires the artifact lock first and advances D.
   - `clearBearer` acquires it next; its deadline expectation fails.
   - Bearer removal never happens. Subsequent refreshes can persist the retained bearer.

   This contradicts [the existing bearer-removal contract](apps/extension/src/wallet/services/profile/session-manager.ts:450) and Phase 4’s requirement that both writer orderings preserve the newer deadline **and** remove the bearer.

   I reproduced this with a minimal model using the repository’s actual artifact/facade `Lock` implementation: deferral returned `true`, scrub returned `false`, bearer remained. This was a model of the proposed algorithm, not an implementation test.

   **Fix:** retain artifact serialization, but distinguish stale expiry decisions from mutations that must take effect. Bearer removal must mutate the current row under that lock or retry after a deadline conflict, with session-identity revalidation. Specify corresponding conflict handling for `refresh` and TTL changes; “every loser silently stands down” does not preserve their semantics. Test contention **before mutation**, not merely storage completion order.

2. **Ledger assessment.**

   | Round | Assessment against rev 6 |
   |---|---|
   | Fable r1 | All fourteen dispositions are represented; superseded identity/dialog proposals are replaced appropriately. |
   | Codex r2 | Specific submission, entry-point, counting and error fixes hold. **#3’s broader expiry-coordination claim remains incomplete** because of finding 1. |
   | Codex r3 | Serial, cancellation and registry corrections hold. **#3**, and **#6’s expiry-validation portion**, remain incomplete through finding 1. |
   | Codex r4 | **#1 remains incomplete**: serialization now exists, but losing mutations are discarded. #2–#6’s specific corrections are represented. |
   | Codex r5 | #1 auth-registry capture, #3 deadline-observing e2e/pre-created B, and #4 stack command are delivered in the text. **#2 is only partially resolved**: the omitted writer is included, but its required mutation can disappear. |

3. **Adversarial assessment.**  
   Serial allocation inside publication, restore allocation, rollback non-reuse, synchronous registration with caller-owned terminalization, and per-record sweep liveness are sound. Keeping `:303` and placing `isFenceLive` immediately before `node.sendTx` correctly binds authorization to invocation. Both dApp entry points and the newly fenced auth-registry entries preserve their original authorization session. I found no additional stale-session broadcast path in the proposed send graph. **Confidence: high.**

4. **Facts, inferences and limitations.**  
   I checked all 47 Fact entries against their cited locations. The material mechanisms are supported, with these corrections:

   - **Fact 46’s citations are wrong:** `extension.ts:854,876,1016` concern funding/balance waits. The actual 90-second profile-creation wait is [session-profileSwitch.test.ts:49](apps/extension/tests/e2e/network/session-profileSwitch.test.ts:49). Pre-creating B remains correct.
   - **Fact 2 misquotes the source:** it says “NOT structurally unreachable over the wire,” not “NOT structurally required.” The optional parameter and missing silent-path fence are correctly identified.
   - **Inference 7 fails** for finding 1. It also incorrectly says `open` writes before publication; Fact 35 correctly describes publication before persistence.
   
   The remaining inferences hold within their stated scope. Journal-independent tracking and unchanged activity policy are defensible exclusions for preventing stale submission; they cannot support a promise of immediate cessation of PXE/proving work. A1’s `min(TTL, 10 min)` is a reasonable convenience ceiling, **moderate confidence**, not a proof-duration guarantee.

5. **Constructibility and delivery.**  
   Phase 2’s eleven cases are constructible under D1–D6 using transfer reuse, early rejecting dApp paths, and shallow boundary controls. Case 10’s cancellation-write parking correctly puts cancellation ahead of submission on the real transition lock.

   Phase 4’s clock/alarm harness is appropriate, but its bearer-race pass criterion contradicts the specified CAS. The revised three e2es address the prior construction failures: observe persisted deadlines after navigation, use non-refreshing `peekSession`, and pre-create B. The lazy fallback is justified because [Chrome permits delayed alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms#method-create).

   The validation commands exist. Installed `gh stack` help confirms both the corrected initialization command and atomic stack merging. Two review arcs shipped together are appropriate; no broader scope expansion is necessary.

reject (with blocking findings: the shared session-row CAS can silently discard bearer removal, contradicting strict-mode semantics and Phase 4’s required race outcome)
## Round 7 — the second fresh session resumed on rev 7 → conditional approve

Rev 7 closes the reproduced bearer-removal race, but its reverse-order test expects the wrong outcome. **Confidence: high.** I checked the revised rule with models using the repository’s real `Lock`; these are algorithm checks, not implementation tests.

1. **Ledger:** Round 6 #1 is resolved by the proposed writer contract. Round 6 #2’s Fact corrections hold, but the revised description of `restore` is still inaccurate.

2. **Adversarial schedules:** The two writer kinds behave correctly:

   | Schedule | Result |
   |---|---|
   | Deferral → bearer removal | Extended deadline persists; bearer removed. |
   | Bearer removal → deferral | **Both succeed**; extended deadline persists without bearer. |
   | Refresh between snapshot and CAS | Changed deadline rejects stale deferral; refresh survives. Normally, an already-expired `refresh()` joins the pending decision first. |
   | TTL disabled before CAS | Changed `configRev` rejects deferral, including when raw `lockedAt` was already undefined. |
   | Deferral → TTL disable | Must-apply update clears the deadline and alarm. |
   | Close before writer’s identity check | Writer refuses the ended session. |
   | Close during writer’s persistence | Memory clears immediately; artifact-serialized deletion follows the write, leaving no row. |

   These live-row schedules introduce no new session-resurrection path. The close outcome still requires the specified synchronous revalidation immediately before calling `close`, outside the artifact lock.

3. **MEDIUM — Phase 4 requires an impossible stand-down.**  
   [Architecture item 3](implementations-plan/profile-fenced-execution/plan.md:212) and [Phase 4](implementations-plan/profile-fenced-execution/plan.md:916) say bearer-removal-first makes deferral stand down. Removing bearer fields changes neither `lockedAt` nor `configRev`; therefore its expectation **matches**.

   Correct expectation: bearer removal commits, then deferral commits against the current scrubbed row. My model produced successful outcomes for both writers, an advanced deadline, and no bearer in **both acquisition orders**. Fix the prose and test expectation; do not alter the sound algorithm to force rejection. With artifact serialization, storage completion order follows acquisition order rather than varying independently.

4. **Assumptions:** [Inference 7](implementations-plan/profile-fenced-execution/plan.md:719) incorrectly says `restore` persists inside its own artifact section. [Actual restore](apps/extension/src/wallet/services/profile/session-manager.ts:627) publishes the loaded session and schedules its alarm; it neither writes the session row nor takes `artifactLock`. Describe `open` and `restore` separately. This is an evidence correction, not another writer race.

5. **Constructibility and delivery:** The remaining revised gates are buildable, with the corrected bearer-first assertion. The earlier send-fence, composition/e2e, scope and atomic two-arc delivery conclusions stand. No additional production blocker emerged from this targeted re-audit.

conditional approve (with conditions: correct the bearer-first deferral outcome in Architecture and Phase 4, and correct Inference 7’s description of restore)