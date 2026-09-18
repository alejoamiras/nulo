# Codex audit — holdings-loading-sync

Leg: foreign reviewer, `/codex high` (GPT-6 Astra), read-only.

**Environment note.** On this host codex's `bwrap` sandbox cannot start
(`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` — AppArmor restricts unprivileged user
namespaces), so codex cannot read the repo. Two runs returned a procedural `reject` ("source inspection
could not run") and are not reviews. Round 1 below was run with the plan, the recon map and numbered
excerpts of every key source region pasted inline; codex marks what it could not see as **unverified**.
The same-family leg did read the repo and independently verified the items codex lists as unverified
(sync-state API consumers, gate scripts, Facts 5/6/12/13).

## Round 1 — plan draft

**Verdict: reject (with blocking findings: unsafe scan floor, incomplete failure accounting, and unbounded
loading/retry states).**

### 1. Adversarial / security
- **High — the scan floor can permanently omit legitimate receipts.** Account creation precedes seeding and
  scanning (`token/service.ts:160-165`, `seeder.ts:289-295`); a receipt can arrive before the first scan
  sets its tip-based floor, and an exported phrase used elsewhere is a further counterexample. Change: drop
  the floor unless an independently justified boundary exists.
- **High — three failures do not bound stale-record retention.** Counters are memory-only and cleared in
  `commitSchedulers`; restarts/hydrations can prevent escalation indefinitely
  (`incoming-transfer/service.ts:812-858`). Remove the "bounded ~2 min" claim or persist escalation state.
- **High — failure handling misses paths.** The `catch` wraps only `forwardScanOnce`; input resolution
  swallows failures, reconciliation and pending-page handling sit outside it (`service.ts:1374-1427,
  1465-1477`). Account for the whole eligible scan attempt; preserve pending-page markers on transport
  failure.
- **High — "did not throw" is not success.** Hostile ordering / regressed checkpoints return
  `dropped: true` (`public-events.ts:248-250,278-279`); a dropped pass returns normally with unchanged
  coverage (`service.ts:1537-1561`). Count confirmed coverage / validated EOF as success.
- **High — Retry needs lifecycle fencing, not just the marker lock.** Profile purge deletes the whole blob
  (`seeder.ts:178-208`); a queued retry can recreate state after deletion; resetting attempts during an
  active attempt undermines the cap. Validate active profile/network + seed membership, capture/recheck the
  epoch inside the lock, reject tombstones, coalesce while busy.
- **Medium — placeholders must not imply verified identity.** Non-navigable, excluded from actionable token
  selectors, no fabricated token ids; failed rows expose only Retry.
- **Medium — logging protection is overstated.** Existing seeder lines interpolate identifiers and forward
  raw errors (`seeder.ts:303,351-357`); getter-triggered attempts multiply them. Normalize touched messages
  to fixed strings + named bounded fields; log error categories.

### 2. Assumption attack
- **Facts.** Fact 3 is too broad (manual imports fetch metadata inside the journaled path,
  `token/service.ts:345-368`); `readMarkerState` validates only `typeof attempts === "number"`
  (`seeder.ts:383-397`) — validate every field the status derivation uses. Fact 11: RPC and schema
  operations also throw (`public-events.ts:225,266,327`). Facts 5, 6, 12, 13 unverifiable from excerpts.
- **Inferences.** I4 is false, and `(phraseOrigin ?? "imported") === "imported"` treats an unknown non-null
  string as generated — only an explicitly validated `"generated"` may qualify. I1–I3, I5 unverified;
  preserve metadata fallback values and result decoding when batching (`token/service.ts:701-722`).
- **Asks.** "None open" hides decisions: unavailable seed prerequisites, permanent first-balance failure,
  placeholder interaction, suspended-time health semantics, restore must not preserve `"generated"`.

### 3. Implementation critique
- **High — seed loading can stay pending forever or feed a retry loop.** No-account passes consume no
  attempt (`seeder.ts:278-280`); status events → refetch → getter kick loops; `run()` also reschedules for
  concurrent triggers (`:130-145`). Latch recovery kicks independently of reads/events; test no-account,
  node-down, reconnect, two-consumer cases.
- **High — seed and balance snapshots need coordinated readiness.** Balances loading before seed status
  reproduces the false empty state / `$0`. Expose seed-status readiness, gate on both, and reuse
  `BalanceView`'s dirty/refetch + request-generation pattern (`BalanceView.vue:118-178`) — `TokensView`
  lacks that protection (`:155-175,281-305`).
- **High — health timing is not well-defined.** After 8 h locked the second failure warns ~30 s later;
  during an hour-long outage swallowed tips failures never warn; clearing counters on every rebuild changes
  behavior. Measure an uninterrupted eligible failure episode, reset/pause across suspension, preserve
  across same-scope rebuilds, re-evaluate on skipped ticks, schedule expiry of the min-display.
- **Medium — hero failure handling.** Verify every terminal projection failure persists `syncFailure`; a
  rejected snapshot leaves `isLoaded` false (`BalanceView.vue:170-173`). Never turn unknown into a confident
  zero just to stop loading.
- **Medium — API deletion / rollback.** Reverting Arc 1 after Arc 2 restores calls to deleted APIs —
  document reverse-order rollback.
- **Medium — gates and complexity.** `scanPublicContract` 87 lines, `persistToken` 129,
  `parseTokenInterface` 72 — extract before expanding. Do not document one metadata read before Phase 9.
- **Checks out.** Shared Skeleton, runtime seed-list RPC, batched simulation follow recon; journal-first
  fails the durable-failure requirement; reconciliation markers, epoch fencing and TOFU stay authoritative;
  no migration needed.

## Final fresh-context pass — revised plan + ledger (new session)

reject (with blocking findings: unsafe scan-floor eligibility and capture timing, stranded pending seeds, and incomplete health-progress semantics)

## 1. Adversarial / security review

- **High — D5 still permits omitted receipts. Confidence: high.** Account creation persists the address, emits an event, then returns it (`account/service.ts:284–286`); the incoming handler performs asynchronous work afterward. Nothing shown prevents a receipt arriving while its tip request is delayed. A subsequently captured checkpoint can therefore exceed that receipt’s block. Whether onboarding exposes the phrase even earlier is **unverified**; the creation UI would settle that additional path. Capture the boundary before publishing/returning the first address through an awaited creation hook; otherwise use zero.

- **High — “only account row” does not mean “first-ever account.” Confidence: high.** Delete the sole account’s chain, then re-add it: the profile remains `generated`, the floor was deleted, index zero is recreated, and the sole-row test passes again. This directly contradicts “re-add ⇒ 0.” Account serialization is per `(profile, chain, type)`, not profile-wide (`account/service.ts:289–300`), so the cross-chain count also lacks atomicity. Persist a one-time signup-floor eligibility/consumption decision that survives chain purge, and serialize/fence its consumption against account creation and purge. A delayed handler must use the event’s profile, not whichever profile is active afterward.

- **High — clearing the floor alone does not restore historical coverage. Confidence: high.** Existing cursors retain `startBlock`; today’s reset explicitly preserves it (`incoming-transfer/service.ts:357`). Consequently, a later account can still inherit the signup boundary, and deleting the floor after tip regression does not repair existing cursors. When eligibility ends or the floor is invalidated, clear the stored floor **and reset affected cursors explicitly to zero**, under the existing lock/epoch discipline. Test a later account followed by a newly imported token too.

- **High — D7 can strand seeds indefinitely. Confidence: high.** One recovery pass fails, leaving attempts below three; status becomes `pending`, the lifetime latch remains set, and events only refetch. No further trigger is guaranteed, and Retry exists only for `failed`. The hero releases after 12 seconds, but the seed row remains a skeleton. Specify bounded, backoff-controlled continuation to the existing cap, coalesced across all triggers. Reconnect should invoke the latched recovery entry point: “once per mount” alone cannot recover a worker death while the popup remains mounted.

- **Medium — rejection and retry need explicit atomic transitions. Confidence: high.** The existing generic marker writer does not check epoch inside its lock (`seeder.ts:178–186`); a check before queueing is insufficient. Write `rejectedAtVersion` with the same inside-lock lifecycle/tombstone checks required for retry. Every automatic trigger must honor rejection, with tombstones taking precedence. Atomically reserve retry before releasing the lock, then launch work **outside** it; awaiting a pass inside the marker lock would deadlock its marker writes. Test simultaneous retries and purge during rejection persistence.

- **Medium — session health needs lifecycle-safe persistence and privacy boundaries. Confidence: moderate.** Clearing episodes on lock/profile change is insufficient if an older asynchronous write can recreate them afterward. Serialize writes/removals, fence outcomes and hydration, and finish hydration before polling. Include profile scope in events or treat them solely as refetch invalidations; network ID alone cannot distinguish profiles sharing a network. Validate stored counters/timestamps, retain trusted-context-only access, and cancel minimum-display timers immediately on scope changes. These records expose wallet/network associations, but must confer no scanning or spending authority.

## 2. Assumption attack

- **Facts — High. Confidence: high.** The critical misstated claim is Security’s “an address nobody else could know”: phrase provenance does not establish non-disclosure before the asynchronous capture. Fact 11 accurately describes today’s preservation of `startBlock`, which contradicts the proposed “every other case … reset to 0” once nonzero starts exist. I accept the repo-reading reviewer’s verification of consumers, scripts, and construction sites; missing excerpts are not approval blockers.

- **Inferences — Medium. Confidence: high.** I1 remains reasonable, but “one read” must distinguish the batch-capable path from the explicitly supported slow arm. I2’s in-memory fallback defeats the advertised outage warning under repeated short worker lifetimes; session availability is **unverified**, requiring service storage wiring to settle it. Make durable-across-worker episode storage a gate, rather than silently accepting weaker behavior. I3’s cap bounds the hero only, not seed-row loading. I4 does not follow from blocked dRPC alone: exhausted attempts are necessary for `failed`, and D7 currently may stop before exhaustion.

- **Asks — Medium. Confidence: high.** The recorded selections resolve copy, timing, and imported-wallet backfill scope. They do not authorize the newly identified sole-chain re-add loss or asynchronous signup capture gap. Fix those within “sign-up only.” If implementation requires broader historical omission, surface that specific tradeoff.

## 3. Implementation critique

- **High — block coverage alone misclassifies useful progress. Confidence: high.** The scanner pages by log count. Many valid pages within one block advance the event cursor without advancing `coveredBlock` (`service.ts:1543–1548`). Reconciliation similarly advances its progress cursor while reported coverage remains `lowerBound − 1`. Counting these ticks as `no-progress` creates false warnings and increasingly delays productive scans. Define progress as a **successfully committed, validated forward or reconciliation cursor advance**, or confirmed coverage advance; keep dropped pages unsuccessful. Explicitly propagate reconciliation results and distinguish unresolved class-gate failures from genuinely unsupported contracts (`:1386–1390`). Add same-block pagination and multi-tick reconciliation tests.

- **Medium — snapshot failure must not become evidence of emptiness. Confidence: high.** “Retry once, then set `isLoaded`” conflates settled with successfully loaded. After the cap, an aggregate of no known rows can display `$0.00`; that is not a verified zero balance. Keep readiness and validity separate, preserve current-scope known data, and use the existing partial/unavailable presentation when nothing was obtained. Specify equivalent rejected-fetch recovery for both seed status and `TokensView`; their readiness otherwise remains unbounded.

- **Low — boundaries and ordering are mostly sound. Confidence: high.** L6 owning a connected service client and passing it to a disposable C1 composable is consistent with the supplied rules. Phase 6 can delete the API first because Arc 1 removed its consumer, provided declarations, client exports, implementation, and obsolete tests change together in a passing commit. Keep coverage data needed by outcome accounting. Replace arbitrary test-count minima with behavior coverage, and change the final “five failures” reassessment rule to the repo’s three.

## 4. Ledger check

- **Medium — D3 is defensible, but its justification overclaims. Confidence: moderate.** Retaining conservative reconciliation avoids an unreliable classifier. However, “only extra RPC” and “every user-visible effect fixed” are not established: unnecessary reconciliation can delay discovery, especially with backoff. Record that residual delay and verify recovery after a transient anchored failure. A classifier is unnecessary for approval.

- **High — D5 is not actually resolved by the narrowing. Confidence: high.** Preserve the owner’s signup-only choice, but replace the current count-based implementation with the capture and one-time eligibility safeguards above. Record the newly discovered cases explicitly.

## Checks out

- Runtime seed-list RPC, shared Skeleton, and existing snapshot-pattern reuse follow recon.
- Inert placeholders and compiled-in text preserve the actionable-token boundary.
- Journal-first remains unsuitable for durable failures.
- Reverse-order rollback, wallet-only scope, and no new complexity suppressions are appropriate.
## Re-review 1 (same session resumed)

reject (with blocking findings: scan-floor installation can race invalidation, and phrase exposure still permits receipts before capture)

- **High — The floor’s asynchronous handoff remains unsafe. Confidence: high.** The profile-wide lock serializes account creation, but does not necessarily serialize completion of `onAccountAdded` handlers. First-account handler pauses; second-account handler deletes the floor and resets cursors; first handler resumes and installs its older `signupTip`. The same issue arises across chain purge/re-add or profile deletion. Using the event’s profile fixes attribution, not freshness. Fence floor installation against the originating profile/chain lifecycle, and revalidate eligibility immediately before committing under the incoming-service lock. Ensure a later account’s invalidation cannot be overwritten by an earlier event. Add deliberately reordered-handler and delayed-event-after-purge tests.

- **High — Pre-persist capture closes address-return timing, but not phrase exposure. Confidence: high for the design gap; actual onboarding order unverified.** Security explicitly acknowledges that the phrase may already be shown and used elsewhere before first-account creation, contradicting “no one, the user included, can have the address before the floor block.” This was an outstanding issue in the previous review, not an owner-approved consequence. Capture the boundary before exposing the phrase, or use zero when that ordering cannot be guaranteed. Alternatively, obtain explicit acceptance of this particular omission risk; the recorded “Sign-up only” selection does not establish it. The onboarding phrase-display sequence would settle whether the path exists.

- **Medium — Continuation needs an explicit worker-restart and no-account contract. Confidence: high.** Bounded continuation resolves stranded `pending` while the worker survives, but a scheduled 60-second callback can disappear with it. Mount/reconnect recovery does not guarantee continuation with the popup closed. Use the existing worker wake mechanism to resume due attempts, retaining the cap and avoiding duplicate scheduling. Schedule continuation only after an actual retryable attempt, never merely because entries remain `pending`; otherwise zero-account passes can recreate the original wake loop. Cancel or invalidate scheduled work on scope change/purge. Add worker-death-between-attempts and zero-account continuation tests.

- **Medium — Clearing attempts is not itself a retry reservation. Confidence: high.** Two queued retry calls can both clear the counter before either pass marks the key in flight. Existing `run()` then requests another pass when called while busy. Set a per-key reservation **inside the marker lock**, have competing retries check it, and release it when the launched work settles or is invalidated. Keep launching outside the lock. The proposed simultaneous-retry test should assert one accepted retry and no counter reset after work starts.

- **Medium — Timestamp validation contradicts persisted backoff. Confidence: high.** Episode timestamps are required to be “not in the future,” but `nextAttemptAt` normally is. Rejecting an otherwise valid episode for that field would lose the failure streak on restart. Validate `failingSince` against the current time separately; allow a bounded future deadline for `nextAttemptAt`. Test restart during an active backoff.

- **Low — Synchronize the remaining descriptions. Confidence: high.** The health event signature still omits `profileId`; Popup still says “once per mount”; D2 still defines success using coverage alone; and Asks says everything is resolved despite the pending dash approval. The hero predicate also excludes `unavailable`, so specify whether failure releases the skeleton immediately or only at the cap. These are implementation ambiguities, not reasons for a redesign.

The other prior blockers are resolved **at the design level**: persisted one-time eligibility prevents sole-chain re-add from qualifying; explicit zero resets repair inherited floors; committed cursor progress handles busy blocks and reconciliation; session persistence and scoped invalidations address health lifecycle errors; and snapshot validity no longer equates failed reads with emptiness. The marker-lock fencing and launch-outside-lock direction are sound. I withdraw the test-minima suggestion given the clarified repository rule.

## Re-review 2 (same session resumed, after the owner removed the scan floor)

conditional approve (with conditions: reconcile the hero predicate with its unknown-data behavior and complete the recorded UI sign-off gate)

- **Medium — The hero predicate still contradicts the stated behavior. Confidence: high.** It checks only `state === "loading"`, so transitioning to `unavailable` can release the skeleton before 12 seconds despite the following sentence forbidding that. Include unresolved snapshots in the hold condition, bounded by the existing cap. Also base the post-cap dash on **whether any successful current-scope balance snapshot exists**, not solely `state === "unavailable"`: an unanswered initial request remains `loading` and must not fall through to an empty aggregate displayed as `$0.00`. Preserve the distinction between a successfully loaded empty list and no successful read. Test rejection before the cap and an unresolved request beyond it.

- **Low — Arc 1’s change map omits alarm integration. Confidence: high.** Phase 2 now depends on runtime wake registration or a dedicated alarm, but `wallet/runtime.ts` appears only under Arc 2. Add the actual alarm integration files to Arc 1 and include their relevant checks at its gate. Arc 1 must independently demonstrate recovery after worker restart with the popup closed.

- **Low — The dash approval remains an explicit delivery gate. Confidence: high.** It is correctly recorded as open. Obtain the owner’s sign-off on the concrete rendering before delivering that UI change; the earlier approval does not cover it.

The previous blocking findings are resolved **at the plan level**. Removing the floor eliminates the capture, provenance, handler-ordering, and inherited-cursor risks. I found no operative floor leftovers: account/profile changes, the signup record, and its implementation phase are gone; remaining references explain the decision.

The revised continuation contract, explicit retry reservation, and field-specific episode validation address the previous scheduling and persistence findings. Whole-tick outcomes, committed cursor progress, lifecycle fencing, and snapshot validity remain coherent. No further architectural blocker is evident from the supplied material; implementation review must verify those concurrency guarantees.