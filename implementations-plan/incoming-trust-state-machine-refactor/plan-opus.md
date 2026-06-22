# IncomingTransferService — Per-Triple Lock Refactor (Opus Plan)

> **Locked decisions:** single-PR big-bang switch · `Map<triple, Lock>` using `wallet-core/utils/lock.ts` · current 4-state FSM (`unknown → pending → trusted | blocked`) preserved · actor-only (no CAS), repo stays last-write-wins.
>
> Inputs: codex audit-6 verdict, six prior audit cycles (`ee1c900 → 136bb36`), PR #74 (merged), `service.ts` at 841 LoC, 1840-LoC scenarios suite.

---

## 1. Goal + Success Criteria

### Goal
Replace the ad-hoc `scanGenerations` counter, the `txDeleteInflight` set, the `polling` set, the compensating-action reverts in `setTrustAllow/Reject`, the per-iteration `getRecord` re-check, and the `replayPendingPrompts` live re-checks with **one** serialization primitive: a per-`(profileId, networkId, contract)` `Lock` map that owns every read-then-write sequence on the trust row + the records belonging to that triple.

Net code shape after this PR:
- One `tripleLocks: Map<string, Lock>` field.
- One `withTriple(triple, fn)` helper that acquires the lock, runs `fn`, releases in `finally`.
- One `acquireMany(triples, fn)` helper used by `scanContract` (multi-triple per scan, deterministic order to prevent deadlock) and by `clearProfile/clearChain` (bulk).
- One `evictIdleLocks()` housekeeping hook (lock map otherwise grows unboundedly across re-add cycles).
- All 8 writers funnel through these helpers. No `Set`/`Map` counters survive except the lock map itself.

### Measurable Success Signals

| Signal | Pre | Post | Verification |
|---|---|---|---|
| `service.ts` LoC | 841 | ≈ 600–650 | `wc -l` |
| Distinct race-guard primitives in `service.ts` | 3 sets/maps (`scanGenerations`, `txDeleteInflight`, `polling`) + 5 ad-hoc `isStale()` calls + 3 compensating-action reverts | 1 (`tripleLocks`) | grep |
| Scenario-suite race tests (audit-3/4/5 fixtures) | Pass via guards | Pass via lock | `bun test` |
| New scenario: `setTrustAllow` mid-flight against `scanContract` `unknown → pending` | Hidden orphan persists | Either Allow runs after scan (record visible) OR scan runs after Allow (record visible from build-time) | new test |
| New scenario: per-note `blockTimestampFor` await window race fixed | Locally-cached `trustState=pending` → hidden record permanently | Record visible if `setTrustAllow` won the lock at any point | new test |
| Lock map size after 100 add/delete cycles on one contract | N/A | ≤ 1 entry after `evictIdleLocks` runs | new test |
| Force-release log lines (`Lock: force-released after`) | N/A | 0 in CI | grep `vitest` output |
| Existing 60+ test names | Pass | Pass | `bun test` |
| E2E `incoming-transfers.test.ts` | Pass | Pass | `bun test:e2e:network` |
| Type-check (`bun typecheck:all`) | Green | Green | CI |
| Lint (`bun lint`) | Green | Green | CI |

### Out of Scope (explicitly punted)
- Repo CAS (user-locked decision #4 — repo stays last-write-wins).
- New trust states (`re_added`, `expired`, etc. — user-locked decision #3).
- Multi-PR sequencing (user-locked decision #1).
- An actor / message queue (user-locked decision #2).
- Lock fairness beyond FIFO microtask (the primitive already gives that).

---

## 2. Scope — Files and Surface Per Phase

Even though this lands as **one PR**, the work breaks into seven ordered commits. Each commit is independently buildable + testable so `git bisect` stays useful.

### File inventory (every file the PR touches)

**Production code:**
- `packages/extension/src/wallet/services/incoming-transfer/service.ts` — primary.
- `packages/wallet-core/src/utils/lock.ts` — read only; no changes expected (see Phase 7 contingency).

**Tests — modified:**
- `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts` — augmented (race fixtures now assert post-lock semantics; same fixture mechanics, different invariants).
- `packages/extension/src/wallet/services/incoming-transfer/service.test.ts` — untouched (the `orderByBlockIndex` pin is independent).
- `packages/extension/src/wallet/services/incoming-transfer/repository.test.ts` — untouched (repo unchanged).

**Tests — added:**
- New file: `service.lock-races.test.ts` in same dir, ≈ 350–500 LoC, dedicated to the new lock-ordering invariants and lock-map eviction. Keeping it separate makes it cheap to revert if Phase 7 contingency triggers.

**E2E (assert only — no source edits):**
- `packages/extension/tests/e2e/network/incoming-transfers.test.ts` — runs as-is. Behavior must not regress.

**Consumers (no source edits required — surface unchanged):**
- `packages/extension/src/popup/components/popups/PopupManager.vue`
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue`
- `packages/extension/src/popup/components/popups/NewTokenPopup.vue`
- `packages/extension/src/popup/components/modules/general/RecentActivityView.vue`
- `packages/extension/src/popup/pages/activity.vue`
- `packages/extension/src/stores/cache.store.ts`
- `packages/extension/src/wallet/services/incoming-transfer/client.ts`
- `packages/extension/src/wallet/services/incoming-transfer/spec.ts`

Spec and client unchanged because the user-facing contract is **byte-identical**: same methods, same events, same return values (`setTrustAllow/Reject` keeps the `boolean` return). The lock is purely an internal implementation detail.

---

## 3. Security & Adversarial Considerations *(required)*

This service's threat surface is non-trivial — first-receive prompts are an attack vector for token-impersonation; the records table feeds the activity feed. Below is the threat list, with the lock's coverage for each. Cited line numbers are pre-refactor.

### S1. Token Impersonation via Pollution
**Threat.** Adversary deploys contract `X`, sends a note to the victim. Victim sees a "Received TKA" prompt for `X` and Allow-clicks under the impression it's the legitimate token. Pre-existing defense: the contract must be **registered** (`tokenService.getTokensRaw` filter at `service.ts:558`).
**Lock impact.** The lock does NOT widen this surface. The "is contract registered" check still runs under the lock at the top of `scanContract`'s critical section. The change is that the check + the `pending` write happen atomically — no window where the registration check passes but the write lands after a `onTokenDeleted` purged the row.

### S2. Notification / Pending-Prompt Flooding
**Threat.** Adversary sends thousands of notes from contract `X` in rapid succession during the `pending` window, hoping each note opens a popup or each emit eats a port slot.
**Pre-existing defense.** `pending` is sticky — once set, subsequent notes inside the per-note loop see `trustState === "pending"` (line 626) and skip the transition. The popup also dedupes by triple-key in `PopupManager.vue:119`.
**Lock impact.** The lock **strengthens** this. Today: a second poll could re-read `trustState` as still `unknown` if the first poll's `setTrust("pending")` hasn't flushed to storage (last-write-wins repo). Under the lock, the second `scanContract` invocation for the same triple cannot enter its critical section until the first releases — `trustState` will be `pending` by the time it loads.
**Residual.** The Pending **emit** is gated by `incomingTransfersVisible` (line 690-696). One emit per `pending` transition is still possible per poll cycle if the user toggles visibility OFF→ON between scans — but PopupManager's triple-key dedup absorbs that (`PopupManager.vue:119`).

### S3. Storage Exhaustion via Lock-Map Growth
**Threat.** Adversary triggers thousands of distinct contract additions then deletions, growing `tripleLocks` without bound. Each `Lock` carries a `queue: (() => void)[]`, a `forceReleaseTimer`, and metadata.
**Mitigation.** `evictIdleLocks()` runs on the same cadence as the existing scheduler housekeeping (token-add, token-delete). An entry is evictable if it is not currently held AND its queue is empty. The `Lock` primitive already has `locked: boolean` and `queue.length` we can inspect via a small accessor extension OR by tracking "in-use" externally in the wrapper (see Phase 3 design).
**Residual.** A pathological adversary that interleaves activity across N triples in a way that never lets `evictIdleLocks` see them idle could grow the map. The eviction trigger is also called from `onTokenDeleted` (which already happens on every contract removal), so the natural lifecycle keeps it bounded. Bound: `O(distinct contracts ever observed since last eviction sweep)`. At realistic UX cadence (hundreds of tokens lifetime), this is negligible.

### S4. State-Machine Soundness
**Threat.** Concurrent writers leave the FSM in an illegal state — e.g., `trusted` with hidden records, `blocked` flipped from `unknown` (skipping `pending`), or `unknown` with persisted records.
**Pre-existing defense (post-lock).** The FSM permits all transitions (`setTrustState` is direct; no `assertCanTransition`-style guard exists). The current "soundness" is purely vibes-driven: writers know not to write illegal combinations.
**Lock impact.** Concurrency-induced illegality (`scanContract` writing `pending` over `setTrustAllow`'s `trusted`) goes away. **The lock is silent on operator-induced illegality** (a programmer wiring `setTrustState(..., "blocked")` from `unknown` still succeeds). This is acceptable per user-locked decision #3 — adding state-transition validation is out of scope.
**Recommendation (NOT in this PR, file as a follow-up).** A `validateTransition(from, to)` helper. Logged as Open Question #1.

### S5. Concurrency Invariants — What the Lock Actually Guarantees

The contract the lock enforces:
1. **Triple-scoped mutual exclusion.** For any `(profileId, networkId, contract)`, at most one critical section runs at a time.
2. **Read-then-write atomicity within a critical section.** A writer that reads trust + reads records + writes either of them sees a consistent snapshot for that triple — no other writer for that triple landed any write between read and write.
3. **FIFO ordering per triple.** First caller to `lock.enter()` for triple T runs first. This matters for the user-mediated path: `setTrustAllow` enqueued during a `scanContract` runs after the scan completes, observing the pending row the scan persisted, and flips it visible.

The contract the lock does **NOT** enforce:
1. **Cross-triple ordering.** `onTransactionAdded` may scan records across many triples (`listByTxHash` is profile/network-scoped, contract-agnostic). Multiple triples may be touched. We acquire a single triple lock per matched record. Two `onTransactionAdded` events for different hashes that match records in different triples can interleave — and that's correct, because no row is touched by both.
2. **Repo consistency across triples.** `clearProfile / clearChain` (bulk wipes) interleave with single-triple writers. See Phase 2.5 below — bulk wipes acquire a snapshot lock and serialize against new lock acquisitions during the wipe.
3. **Eventual delivery of events.** The lock is purely about ordering of writes/reads. Event emission still happens inside the critical section, but if a Vue subscriber throws, the next critical section still runs (the lock leaves in `finally`).

### S6. Deadlock / Starvation Surfaces

**D1. Re-entry deadlock.** `Lock` is non-reentrant (`lock.ts:8`). A method holding the lock for triple T must NOT call another method that re-acquires T. **Audit list:**
- `setTrustAllow` → `setTrustState` → `repo.setTrust`. Today `setTrustState` is a public method; under the refactor it must be split: a public `setTrustState` (acquires lock) + a private `_setTrustStateLocked` (no acquire). Same for any method that today calls another lock-acquiring method.
- `scanContract` → `getTrustState` (line 565). `getTrustState` today calls `ensureInitialized` then `repo.getTrust`. Either move this read inside the critical section (delete the helper call) or have `scanContract` re-do the read directly. Decision: read directly inside the critical section in `scanContract`; this keeps `getTrustState` lock-free for external read-only callers.
- `setTrustAllow` → `isTokenStillRegistered` calls `networkService.getNetwork` + `tokenService.getTokensRaw`. These are **other services' surfaces** — no lock ownership cross-pollination. Safe.

**D2. Multi-triple acquisition order.** `onTransactionAdded` touches multiple triples (one per matched record). If acquired in arbitrary order, two concurrent emits acquiring overlapping triple sets in different orders could deadlock.
**Mitigation.** Acquire in **lexicographic order of `${networkId}|${contract}`** — deterministic, fixed at the start of the operation. `clearProfile` / `clearChain` similarly.
**Residual.** Lock-set acquisition is sequential (acquire all, then run, then release in reverse). This is O(N) lock waits worst case but the realistic cardinality is N=1 (one record per hash collision).

**D3. Starvation.** A continuously-rescheduled poll (`scanContract` runs every interval) could starve user-mediated writers. **The `Lock` primitive is FIFO** — `setTrustAllow` enqueued during a poll runs before the **next** poll, not behind an indefinite queue. Verified at `lock.ts:25-28`. Acceptable.

**D4. Force-release.** `Lock` force-releases after 5 minutes (`lock.ts:4`). If a critical section hangs that long (e.g., `noteService.getNotesRaw` parked on a dead PXE), the lock will release and the next caller runs **while the hung caller is still inside its `try` block.** The hung caller's `finally { lock.leave() }` will then attempt to release an already-released lock — `Lock.leave()` is idempotent on `locked: boolean` (sets it to `false` no matter what). But the next caller may have entered, and the hung caller's eventual writes will land on top of it. **This is a known residual** — the same residual the rest of the codebase accepts. Logged as Open Question #2.

### S7. Privacy: Cross-Profile Leakage
**Threat.** A `clearProfile(P1)` running concurrently with a `scanContract(P2, ...)` could, in a non-locked world, accidentally affect P2 records. Pre-existing defense: the repo filters by profileId. No regression here. The triple key includes profileId, so the lock map naturally segregates.

### Specific File:Line Citations
- `service.ts:540-684` — `scanContract` body, the critical-section nucleus.
- `service.ts:243-293` — `setTrustAllow`, compensating-action revert at 256-259 and 288-291.
- `service.ts:437-484` — `onTokenDeleted`, wipe + trust reset.
- `service.ts:493-519` — `onTransactionAdded`, `txDeleteInflight` guard.
- `service.ts:707-759` — `replayPendingPrompts`, live re-checks.
- `service.ts:101` — `polling` set.
- `service.ts:112` — `scanGenerations` map.
- `service.ts:491` — `txDeleteInflight` set.
- `lock.ts:4` — `MAX_HOLD_MS = 5 * 60_000`.

---

## 4. Assumptions *(required)*

### Facts (verified, with citation)

- **F1.** `Lock` primitive at `packages/wallet-core/src/utils/lock.ts` is non-reentrant, FIFO via microtask queue, with a 5-min force-release. Lines 4, 6-9, 19-45.
- **F2.** Repository writes are last-write-wins; no CAS. `IncomingTransferRepository.upsertRecord` calls `EntityStorage.set` directly. `repository.ts:48-50`.
- **F3.** Eight writers exist on this surface — they match the count in the brief: `scanContract`, `setTrustState`, `setTrustAllow`, `setTrustReject`, `onTokenDeleted`, `onTransactionAdded`, `clearProfile`, `clearChain`. Cross-referenced against `service.ts`.
- **F4.** The records table is keyed by `siloedNullifier` (cryptographically unique). Inserts are idempotent by primary-key collision. `repository.ts:48-50`, `spec.ts:30-32`.
- **F5.** Trust rows are keyed by `${profileId}|${networkId}|${contract}` (matches the proposed lock key). `repository.ts:25-27`.
- **F6.** UI consumers (4 of them) subscribe to events and rely on the **boolean return** of `setTrustAllow/Reject` (`NewTokenPopup.vue:224-225`, `IncomingTrustPopup.vue:82`). These contracts must not change.
- **F7.** Tests cast-access `scanContract` and `repo` via `as never as { ... }` (`service.scenarios.test.ts:277-282`, 1272, 1306). The refactor must not rename or remove these test-only surfaces.
- **F8.** Activity-row sortKey uses `inc.blockTimestamp * 1000 ?? inc.discoveredAt` (`cache.store.ts:105`). Records that drop `blockTimestamp` will sort by `discoveredAt`, fine.
- **F9.** The `Service` base class's `emit` (`packages/extension-messaging/src/background/service.ts:104-117`) calls `EventHandler.invoke` **synchronously** AFTER `postMessage` to each port. `EventHandler.invoke` itself does NOT await its async subscribers (this is the root cause of the `txDeleteInflight` set today, see `service.ts:489-490`).
- **F10.** `scanContract` is called by the singleflight `poll` loop (`service.ts:521-538`) — same `(networkId, accountAddress)` key already serializes contracts inside one poll, but DOES NOT serialize against `setTrustAllow` / `onTokenDeleted` etc.
- **F11.** `setTrustState` is exposed on the public `Methods` interface (`spec.ts:135`) but **only the test suite and the service's own `setTrustAllow/Reject` call it directly**. UI consumers use `setTrustAllow/Reject`. Audit confirmed via grep on `setTrustState` in `.vue` and `popup/` — only `NewTokenPopup` indirect via `setTrustAllow`. So the public method can become "thin wrapper around `_setTrustStateLocked`" without ripple.
- **F12.** PopupManager binds the `allow/reject` closures at *dequeue* time (`PopupManager.vue:100-101`), capturing the triple. If the user-mediated allow click lands AFTER a `onTokenDeleted` purged everything, the service's pre-flight `isTokenStillRegistered` check returns false and the wrapper returns `false`. Under the lock, this guard runs inside the lock, eliminating the compensating-action revert.

### Inferences (deduced, label clearly)

- **I1.** The lock map can be cleaned up opportunistically on `onTokenDeleted` and on a periodic sweep tied to the same scheduler tick as polling. Inference: the cardinality remains bounded under realistic usage even without periodic sweeps because `evictIdleLocks` runs whenever we know a triple has been wiped (every `onTokenDeleted`, `clearChain`, `clearProfile`). Verified by reading the existing hooks.
- **I2.** Moving from `scanGenerations` to the lock changes the **failure mode** of "delete during scan" from "scan bails before write" to "scan completes and runs in a serialized order against the delete." Both produce correct end states; the lock-based path is simpler. Inference verified by walking each `isStale()` check in `scanContract` and confirming the corresponding lock-acquisition order would produce the same observable post-state.
- **I3.** The per-iteration `getRecord` re-check inside `setTrustAllow`'s loop (`service.ts:275-276`) becomes unnecessary under the lock: the same critical section that holds `listByContract`'s snapshot ALSO holds the lock against any concurrent `onTokenDeleted` (which would acquire the same triple lock). Hence, the snapshot stays accurate for the duration of the loop.
- **I4.** The `polling` set (line 101) is per-scheduler-key (`networkId|accountAddress`), not per-triple, so the lock does NOT replace it directly. We keep `polling` to prevent two simultaneous polls of the same scheduler, but it's no longer carrying race-protection weight — only "don't do duplicate work." Inference: leave it in place; remove only the per-triple race protection it incidentally provided (it never actually protected races, just resource).
- **I5.** `replayPendingPrompts` reads two snapshots (`listTrust`, `tokens`) outside any critical section, then per-row re-checks (`liveTrust`, `liveTokens`). Under the lock, each per-row block must enter the triple's lock to do its `getTrust` + emit atomically. The `tokens` snapshot stays outside the lock — it's a different service's surface. Inference verified by inspecting the failure mode it guards.
- **I6.** The codex audit-6 verdict ("introduce a per-triple serialized critical section that owns trust transitions, record visibility flips, delete/reset, replay/pending emits") maps exactly onto the proposed lock-map design. Inference verified against `service.ts` writer enumeration.

### Asks (FEW — user already locked the four big decisions)

- **A1.** **Lock-map eviction cadence.** Should `evictIdleLocks` run on (a) every `onTokenDeleted` + `clearChain`/`clearProfile` only (event-driven, simplest), or (b) additionally on a timer that aligns with the existing 30 s scheduler tick? Default if no input: option (a). Rationale: bounded under realistic UX; timer adds complexity for negligible benefit.
- **A2.** **Force-release log noise.** Should the lock be instantiated with a `name + logger` (yielding `Lock: waiting (queue: N)` debug logs) per `lock.ts:22-23`, or unnamed (silent)? Default if no input: named, with `incoming-transfer:${triple}` so audit logs are diagnosable. Cost: one more log line on every contended acquire.
- **A3.** **Initial-poll race during `hydrateSchedulers`.** `hydrateSchedulers` (`service.ts:364-395`) clears + rebuilds schedulers. Under the refactor, should this method acquire **all** known triple-locks (across all networks/contracts of the active profile) before rebuilding, or accept that an in-flight `scanContract` for a triple about to be re-hydrated may complete its write under a now-stale view? Default if no input: don't acquire all locks (would cause large lock-acquisition cascade); rely on the natural lock-acquisition inside the next `scanContract` to re-read the world.

---

## 5. Phase Ordering Rationale + Revert Safety

Single PR, seven ordered commits. Each commit compiles, lints, and passes tests in isolation — verified by the gates in Phase 8.

### Phase 1: Introduce `withTriple` + `tripleLocks` map (no behavior change)
**Commit:** `refactor(incoming-transfer): scaffold tripleLocks map + withTriple helper`
**Changes:**
- Add `private readonly tripleLocks = new Map<string, Lock>()` to `IncomingTransferService`.
- Add `private getOrCreateLock(triple: string): Lock` (idempotent allocation).
- Add `private withTriple<T>(profileId, networkId, contract, fn: () => Promise<T>): Promise<T>` — enter, try/finally leave.
- Add `private acquireMany<T>(triples: Array<[string, string, string]>, fn: () => Promise<T>): Promise<T>` — sorts triples lexicographically, sequentially enters, finally releases in reverse.
- Add `private evictIdleLocks(scope: { profileId?, networkId?, contract? })` — sweeps the map, removes entries that are idle (no holder, no queue). Needs a small Lock accessor (see contingency in Phase 7).
**Wired into:** nothing yet. The helpers exist but no caller uses them. Tests still pass because behavior is identical.
**Rationale for going first:** Pure additive scaffolding. If a downstream phase regresses, this commit can stay (it's dead code; biome's `noUnusedPrivateClassMembers` would flag it — see Phase 7 contingency).

### Phase 2: Migrate `setTrustAllow` + `setTrustReject` + `setTrustState`
**Commit:** `refactor(incoming-transfer): serialize trust transitions via tripleLocks`
**Changes:**
- Extract `_setTrustStateLocked(profileId, networkId, contract, state)` private method (no lock acquire). Public `setTrustState` becomes a thin `withTriple` wrapper.
- `setTrustAllow` body becomes: `withTriple(triple, async () => { ... existing body without compensating-action revert and without per-iteration getRecord re-check ... })`. Specifically:
  - Drop the second `isTokenStillRegistered` revert block (`service.ts:288-291`).
  - Drop the per-iteration `repo.getRecord` re-check (`service.ts:275-276`).
  - Drop the mid-loop `isTokenStillRegistered` revert (`service.ts:256-259`).
  - Keep ONE upfront `isTokenStillRegistered` check, now inside the lock. Single point of truth.
- `setTrustReject` mirrors: lock-wrapped, drop both compensating reverts.
- `setTrustState` becomes: `await withTriple(triple, () => _setTrustStateLocked(...))` plus emit.
**Rationale:** These three methods are the easiest to lock-wrap — short critical sections, no fanouts. Migrating them first proves the helper works and gives us a baseline test pass. If something is wrong with `withTriple`, we find out here.
**Tests:** The audit-5 fixtures (`service.scenarios.test.ts:1671-1729`) currently assert that the compensating-action revert wrote `unknown`. Under the lock, the delete-during-await can't happen — the delete is sequenced AFTER the Allow/Reject. **Update those test cases** to assert the new sequenced semantics:
- "delete fires WHILE setTrustAllow is in flight" — under lock — becomes: "delete is sequenced after Allow → Allow completes (returns `true`), then delete wipes everything (records vanish, trust returns to `unknown`)."
- The end state for the user is the same: re-add re-prompts. But the path through the writes differs.

### Phase 2.5: Migrate `clearProfile` + `clearChain` (bulk wipers)
**Commit:** `refactor(incoming-transfer): serialize bulk wipes via acquireMany`
**Changes:**
- `clearProfile(p)` and `clearChain(p, n)` are unique: they wipe arbitrary triples without knowing the contract list at call time. We can't acquire one lock per triple because we don't know the triples.
- Decision: **Do not lock-wrap the bulk wipes.** Instead, do:
  1. Pre-acquire a snapshot of `listTrust()` filtered to `{profileId, networkId?}` → produces the list of (profileId, networkId, contract) triples to wipe.
  2. `acquireMany(triples, async () => { await repo.clearProfile / clearChain })`.
- This avoids deadlock with single-triple writers (lexicographic acquisition) and ensures no concurrent writer is mid-flight on a triple about to be wiped.
- **Caveat:** a NEW triple discovered during the bulk wipe (a scan that completed *after* the snapshot but *before* the wipe finished) would NOT be in the lock-acquisition set, so its write could land after the wipe. Mitigation: do a **second-pass** scan after the wipe to also delete the newly-arrived triple via `repo.clearProfile/clearChain` (still last-write-wins; the wipe is idempotent). This is a real edge case but the cost is small.
**Rationale:** Done in its own commit because it's the most exotic locking pattern and reverting it doesn't disturb the simpler Phase 2 work.

### Phase 3: Migrate `onTokenDeleted` (write-heavy, multi-record fanout)
**Commit:** `refactor(incoming-transfer): serialize onTokenDeleted under tripleLocks`
**Changes:**
- `onTokenDeleted` body wrapped in `withTriple(triple, async () => { ... existing body ... })`.
- The wipe-records loop + trust reset both run inside the lock.
- **Crucially:** under the lock, the compensating-action reverts in `setTrustAllow/Reject` (already removed in Phase 2) and the `isStale()` checks in `scanContract` (to be removed in Phase 4) are unnecessary because the delete cannot interleave with them anymore.
**Rationale:** Wiring the wipe-side first means Phase 4's removal of `scanGenerations` is safe — the scan can't observe a half-completed wipe.

### Phase 4: Migrate `scanContract` + retire `scanGenerations`
**Commit:** `refactor(incoming-transfer): serialize scanContract via tripleLocks, retire scanGenerations`
**Changes:**
- `scanContract(profileId, networkId, accountAddress, contract)` body wrapped in `withTriple(triple, async () => { ... existing body ... })`.
- **CRITICAL:** the `noteService.getNotesRaw` call (`service.ts:550`) is a PXE roundtrip that can be slow. Under the lock, this potentially blocks other writers for the duration. **Mitigation:** keep `getNotesRaw` OUTSIDE the lock (it's a pure read against PXE state, not against our repo). Restructure:
  ```
  // outside lock
  const notes = await this.noteService.getNotesRaw(networkId, accountAddress, contract)
  const network = await this.networkService.getNetwork(networkId)
  const tokens = await this.tokenService.getTokensRaw(profileId)
  const outgoingTxHashes = ...
  const inflightTxHashes = ...

  // critical section starts here
  await this.withTriple(profileId, networkId, contract, async () => {
    // re-read tokens INSIDE the lock (stale-token check)
    const tokensLive = await this.tokenService.getTokensRaw(profileId)
    const token = tokensLive.find(...)
    if (!token) return
    const trustState = await this.repo.getTrust(...).then(t => t?.state ?? "unknown")
    // per-note loop, all of it
    for (const note of notes) { ... }
  })
  ```
- Remove `scanGenerations` map, `bumpGeneration`, `genKey`, `isStale()`. All seven `if (isStale()) return` checks gone.
- Remove the per-note backfill `isStale()` block (the lock holds across the `blockTimestampFor` await).
- Remove `polling` set's race-protection rationale (comment-only update; field stays for "don't duplicate work" reasons per I4).
- **Subtle issue: `blockTimestampFor`** is also a PXE call inside the per-note loop. Keeping it inside the lock means a scan with 50 notes spanning 50 unique blocks holds the lock for 50 sequential PXE roundtrips. **Decision:** prefetch block timestamps for the unique blocks of `notes` OUTSIDE the lock, into the cache; the per-note loop then reads from the cache (sync). This both shortens the critical section AND preserves the existing per-scan memoization invariant.
**Rationale:** Done after Phase 3 so the lock is already held by the delete path. Now the scan can drop all its staleness gymnastics and read sequentially.

### Phase 5: Migrate `onTransactionAdded` + retire `txDeleteInflight`
**Commit:** `refactor(incoming-transfer): serialize onTransactionAdded per-triple, retire txDeleteInflight`
**Changes:**
- `onTransactionAdded` matches records by `(profile, network, txHash)`. Multiple records (across multiple contracts) can match.
- For each match, acquire that record's triple lock, re-fetch under lock, delete + emit if still matching. Loop is sequential (one lock at a time). The triple key is `(record.profileId, record.networkId, record.contract)`.
- Remove `txDeleteInflight: Set<string>` (line 491). Why it's safe: the two same-hash events both want to delete the same `(profile, network, contract)` record. They'll serialize on the lock. The second one re-fetches inside the lock, sees the record gone, no-ops.
- **Account-filter (`record.accountAddress !== tx.account`)** stays — it's a domain rule, not a race guard.
**Rationale:** Last single-event writer. After this, only ad-hoc fields left to remove are dead code.

### Phase 6: Migrate `replayPendingPrompts` + retire all live-recheck blocks
**Commit:** `refactor(incoming-transfer): serialize replayPendingPrompts per-row`
**Changes:**
- Outer snapshots stay (visibility check, `listTrust`, initial token read for symbol/decimals).
- Per-row body wrapped in `withTriple(triple, async () => { ... })`. Inside the lock:
  - Re-read `getTrust` for the triple. If state !== "pending", return (no emit).
  - Re-read `tokenService.getTokensRaw` (different service, not our lock — still need the live check).
  - Emit `onIncomingTransferPending`.
- Remove the existing `liveTrust` and `liveTokens` per-row re-checks (they were doing the lock's job manually).

### Phase 7: Tests + Documentation
**Commit:** `test(incoming-transfer): lock-ordering scenarios + map eviction + invariant pins`
**Changes:**
- New file `service.lock-races.test.ts` with scenarios listed in §6.
- Update audit-5 fixtures in `service.scenarios.test.ts` to assert sequenced semantics (see Phase 2 note).
- Update the file-header comment block in `service.ts` (line 31-64) to reflect the new architecture: replace the "compensating-action revert" narrative with the lock-as-source-of-truth narrative.
- Update the inline race-rationale comments — most of them now reference a lock-protected critical section instead of a generation counter.

### Within-PR Revert Safety

| If Phase fails | Revert window |
|---|---|
| 1 fails | Drop commit; no production code touched |
| 2 fails | Revert commits 1-2; production unchanged |
| 2.5 fails | Revert commit 2.5; setTrustAllow/Reject still under lock |
| 3 fails | Revert commits 3 onward; setTrust + bulk wipes under lock, scan still uses generation counter |
| 4 fails | Revert commits 4 onward — **HIGHEST RISK COMMIT.** Scan is the largest body. Should ship behind a CI green gate, not on faith. |
| 5/6 fail | Revert that commit; rest of refactor stands |
| 7 fails | Tests-only, revert that commit |

**Bisect-friendliness:** Each commit leaves the codebase in a buildable + test-green state. If a downstream commit breaks something, `git bisect` resolves to the offending commit (not the whole PR).

---

## 6. Test Plan *(production calibration)*

### Per-Writer Unit Pins (preserve)

Existing tests in `service.scenarios.test.ts` already pin:
- Visibility-gate matrix (`describe "public surface gating"`).
- Trust transitions (`describe "trust transitions"`).
- Account lifecycle (`describe "account lifecycle"`).
- Dedup + emit semantics (`describe "scanContract dedup + emit semantics"`).
- Late-delete (`describe "late-delete on onTransactionAdded"`).
- Cleanup wiring.
- Path-2 block-timestamp.
- All audit-3/4/5 race fixtures (`describe "codex post-impl Path-2 audit fixes"`).

**Action:** All MUST pass post-refactor. Audit-5 fixtures (which assert compensating-action reverts) get their **assertions** updated to match the new sequenced semantics — the end state is the same; the path differs. The fixture mechanics (`getTokensRaw` returning different values across calls, `repo.listByContract` interception) MAY require adjustment because the lock changes call ordering. Specifically:
- `(Audit-5 High) setTrustAllow reverts trust to unknown when delete lands after the upfront guard` (line 1671): under the lock, the delete-during-flow scenario is replaced by "delete is sequenced after Allow." New assertion: `ok === true`, trust === "trusted" briefly, then after the queued delete completes, trust === "unknown" and records empty. Test must `await flushPromises()` after both calls.
- `(Audit-5 High) setTrustAllow skips per-record upsert when record was deleted mid-loop` (line 1731): under the lock, the delete cannot land mid-loop. The fixture deletes from the underlying Map directly (not via the service) which doesn't acquire the lock — so this fixture is actually testing the SAME thing under the lock: a Map-direct delete is unobservable to lock-holders. The test becomes a regression pin for "service-level lock doesn't accidentally re-create rows that were externally deleted." Keep, but with updated commentary.

### New Race-Scenario Tests (file: `service.lock-races.test.ts`)

**LR1. The concrete residual race from the brief.**
> `scanContract` captures `trustState` locally → `setTrustAllow` writes `trusted` during the per-note `blockTimestampFor` await → record persists with `hidden: true` permanently.

Test mechanics:
- Boot service with a token, a note. Set trust to `unknown`. Block `getBlockTimestamp` indefinitely.
- Concurrently: (a) `service.scanContract(...)` started, parks on `getBlockTimestamp`. (b) `service.setTrustAllow(...)` invoked.
- Under the lock, `setTrustAllow` must wait for the scan to complete. Resolve `getBlockTimestamp`. Scan completes with `trustState = "pending"`, record persists hidden.
- Then `setTrustAllow` runs, observes the now-pending row, flips records to visible.
- Assertion: final record state is `hidden: false`, an `onIncomingTransferAdded` was emitted.
- **Without the lock:** `setTrustAllow` would run first (already enqueued), write `trusted`, then scan resumes and writes a hidden record using its local stale `pending` value. Test fails. With the lock, **the order is enforced.**
- **Important refinement:** Lock FIFO means whoever called `lock.enter()` first runs first. The test must verify the order matches what we want (likely: scan started first, so it runs first; setTrustAllow runs after and flips the hidden record). Both orderings produce a visible record at end of test.

**LR2. Concurrent `setTrustAllow` + `onTokenDeleted` → sequenced; no orphan record.**
- Start with pending trust, hidden record.
- Concurrently fire `setTrustAllow` and `onTokenDeleted`.
- Under the lock, either Allow runs first (record briefly visible, then deleted) OR Delete runs first (records gone, trust reset to unknown, Allow's pre-flight `isTokenStillRegistered` check returns false, Allow returns false).
- Both end states are correct; the lock guarantees one of them happens — never both writes interleaved.

**LR3. Concurrent `scanContract` for same triple from two pollers — serialized.**
- Manually invoke `scanContract` twice in parallel.
- Pre-existing `polling` set serialized them at the scheduler level; the lock serializes them at the triple level too.
- Assert: `noteService.getNotesRaw` is called twice (PXE-side reads aren't deduplicated, that's fine); `repo.upsertRecord` is called at most once per unique siloedNullifier.

**LR4. Concurrent `onTransactionAdded` for same hash — exactly one delete emit.**
- Mirrors existing test `(P5) per-hash reentrancy guard` (line 836-871).
- Under the lock, both events serialize on the triple lock; second sees no record; one delete emit total.
- Assertion identical to existing test; the implementation underneath changed.

**LR5. Concurrent triples — no cross-blocking.**
- Two `scanContract` calls for different triples (contract A, contract B).
- Both should run in parallel — no contention.
- Assert: total wall-clock time is approximately `max(timeA, timeB)`, NOT `timeA + timeB`. Use spies on `getNotesRaw` with a shared promise to detect serial vs parallel.

**LR6. Lock-map eviction.**
- 100 cycles of: register token X, scan, delete token X.
- After all cycles + `evictIdleLocks` trigger, lock map size ≤ 1 (the most recent cycle's lock might still be transient).
- Assert via `(service as never as { tripleLocks: Map<string, Lock> }).tripleLocks.size`.

**LR7. Bulk wipe `clearChain` against concurrent `scanContract`.**
- Pre-seed contracts A, B, C with pending trust each.
- Start scans for A, B, C in parallel; start `clearChain` after a tick.
- Under the locks, the clear acquires A+B+C locks (lexicographic order). Scans finish first (they hold their locks), then the wipe runs.
- Assert: records exist briefly, then are wiped. Trust empty.

**LR8. Late-discovered triple after `clearChain` snapshot.**
- Trickier: `clearChain` snapshots `listTrust()` returning [A, B]. A scan for contract C completes between snapshot and acquireMany. Without the "second-pass scan" mitigation, C survives the wipe.
- Assert: post-wipe, the second-pass scan in `clearChain` catches C; final trust is empty.

**LR9. Reentrancy regression: `setTrustState` (public) does NOT call itself recursively.**
- Pre-condition: `setTrustState` is now a wrapper over `_setTrustStateLocked`. Verify that the wrapper does NOT re-acquire when called from inside another lock-holder. **Strategy:** add a no-op pin that `setTrustAllow` does not deadlock — if it ever did, the test would time out.
- A simple `await service.setTrustAllow(...)` finishing in < 1s under the test's `vitest` timeout proves no deadlock.

**LR10. Force-release does not corrupt state (best-effort pin).**
- Simulate a hung critical section by mocking `noteService.getNotesRaw` to never resolve.
- Wait 5+ minutes? No — instead, mock `MAX_HOLD_MS` indirectly by directly poking the lock map (via cast access). Verify: after force-release, a subsequent `setTrustAllow` does NOT throw; the trust row reflects the second writer's write (last-write-wins repo).
- This pin documents the residual, doesn't fix it.

### Invariant Violation Tests

**IV1. Records hidden ⟺ trust !== "trusted".**
- Existing tests cover this on the happy paths. Add a property-style test: after a random sequence of allow/reject/delete events, scan the records table. For each record, assert `record.hidden === (trust.state !== "trusted")`.

**IV2. Lock map never contains a held + empty-queue lock that's not actually being used.**
- After every test in `service.lock-races.test.ts`, sweep the lock map and assert no entries have `locked: true && queue.length === 0`. Implemented as an `afterEach` hook.

### Quality Gates

- Existing 60+ tests in `service.scenarios.test.ts`: pass.
- New ≈ 10 tests in `service.lock-races.test.ts`: pass.
- `orderByBlockIndex` pin in `service.test.ts`: pass.
- E2E `incoming-transfers.test.ts`: pass.

---

## 7. Quality Gates *(local + CI)*

### Local Pre-Push

Run in order:
```
bun lint
bun typecheck:all
bun run --cwd packages/extension test src/wallet/services/incoming-transfer
bun run --cwd packages/extension test
bun run --cwd packages/extension test:e2e:network -- --testNamePattern=incoming-transfers
```

Expected times (rough): lint < 5 s; typecheck ≈ 30 s; vitest scenarios ≈ 5 s; full extension vitest ≈ 60 s; E2E network ≈ 5 min.

### CI Gates (the PR must be green on)

- `audit:vue` (root script: typecheck:all + test + lint + build).
- `test:e2e:network` for the relevant subset.

### Contingency: Lock primitive needs a small accessor

`evictIdleLocks` needs to know whether a `Lock` is held and whether its queue is empty. The current `Lock` API exposes neither — `locked` and `queue` are private (`lock.ts:7-8`).

**Option A (preferred):** Add `public isIdle(): boolean { return !this.locked && this.queue.length === 0 }` to `Lock`. One-line additive change to `wallet-core`. Low risk.

**Option B:** Wrap each `Lock` in a small `{ lock, inFlight: number }` object inside the service; track `inFlight++` before `enter()`, `inFlight--` after `leave()`. Local-only change, no `wallet-core` change. Verbose.

Default: **Option A**. Filed as the only `wallet-core` change in this PR. If reviewers prefer to keep `wallet-core` untouched, fall back to Option B.

---

## 8. Rollback / Risk

### Per-Phase Revert
Each commit is independently revertable. If post-merge a regression surfaces:

1. Identify the offending phase via `git bisect`.
2. Revert phases ≥ the offender (in reverse order).
3. The revert path leaves earlier phases in place — the lock infrastructure stays, only the unmigrated writer falls back to its ad-hoc guard.

### Full-PR Revert
`git revert -m 1 <merge-sha>` produces a clean revert. The lock map is unused → biome flags it → blocked until you also revert the dead-code commit. Acceptable cost.

### Risk Heatmap

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| `scanContract`'s lock window is too long, blocking user-driven flow | M | H | Pull PXE calls (`getNotesRaw`, `getBlockTimestamp` prefetch) OUTSIDE the lock — Phase 4 detail. |
| Deadlock from multi-triple acquisition (`onTransactionAdded`, `clearChain`) | L | H | Lexicographic ordering; lock-set size capped at the records touched. New test LR-7/LR-8 pins this. |
| `setTrustState` recursive call corruption (reentrancy) | L | H | Split into public-wrapper + private `_locked`. Static review + LR-9 pin. |
| Audit-5 fixtures fail post-refactor with no clear remediation | M | M | Tests are updated in Phase 7's commit; reviewer reads the diff alongside the production change. |
| Lock map grows unboundedly | L | M | `evictIdleLocks` + sweeps on every deletion path. LR-6 pin. |
| `Lock` force-release leaves the next holder writing on top of the previous holder | L | L | Documented as a residual matching the rest of the codebase. Acceptable per F1 + the existing 11-service usage. |
| E2E `incoming-transfers.test.ts` regresses | L | H | Run before push. The lock changes ordering, not semantics — public API is byte-identical, so E2E should be insensitive. |
| PopupManager closures bind to stale triple | N/A | — | This is a UI-side concern out of scope. Not affected by the refactor. |

---

## 9. Open Questions

**OQ-1.** Should we add a `validateTransition(from, to)` guard (e.g., reject `unknown → blocked`)? **Out of scope per user-locked decision #3**, but the locked critical section is the natural place to add it later. File as a follow-up issue.

**OQ-2.** Is the 5-min force-release acceptable given `getNotesRaw`'s tail latency? The lock holds across this PXE call by design (we want to atomicity guarantee against `setTrustAllow` etc.). If PXE ever takes > 5 min, the force-release fires and the next critical section runs concurrently with the (still-pending) network call. Today's `scanGenerations` counter has the same residual. No regression; flagged for awareness.

**OQ-3.** Should `evictIdleLocks` run synchronously (blocking the deletion path until sweep completes) or async (`void evictIdleLocks().catch(...)`)? Default: sync — the sweep is O(map size) and the map is small. If profiling shows ≥ 1 ms per sweep, switch to async.

**OQ-4.** Should the lock map keys include `accountAddress` as well? Today the triple is `(profileId, networkId, contract)` — accountAddress is NOT in the key because trust is contract-scoped, not account-scoped. Records, however, are scoped by `(profileId, networkId, accountAddress, contract)`. Operations on records belonging to the same triple but different accounts (e.g., split-fee scenarios where account A's tx affects account B's record) still serialize via the contract-level lock — which is over-strict but correct. Open question: do we accept the false-sharing cost? **Default: yes**, the contract-level lock is fine. Account-add fanout under `onAccountAdded` doesn't write to the trust row; it just hydrates schedulers — not part of the critical section.

**OQ-5.** Should we instrument lock-hold latency for prod telemetry? The `Lock` primitive logs at > 50 ms wait + > 100 ms hold (`lock.ts:31-32, 54-55`). Default: rely on the existing logs; no new metrics.

---

## 10. Branch + Commits + PR Shape

### Branch
`refactor/incoming-transfer-triple-lock` off `dev`.

### Commits (in order — Conventional Commits)

1. `refactor(incoming-transfer): scaffold tripleLocks map + withTriple/acquireMany helpers`
2. `refactor(incoming-transfer): serialize setTrustAllow/Reject/State via tripleLocks; drop compensating-action reverts`
3. `refactor(incoming-transfer): serialize clearProfile/clearChain via acquireMany; add second-pass sweep for late triples`
4. `refactor(incoming-transfer): serialize onTokenDeleted via tripleLocks`
5. `refactor(incoming-transfer): serialize scanContract; retire scanGenerations + isStale checks`
6. `refactor(incoming-transfer): serialize onTransactionAdded; retire txDeleteInflight`
7. `refactor(incoming-transfer): serialize replayPendingPrompts; retire live-trust/live-token re-checks`
8. `test(incoming-transfer): lock-ordering scenarios + map eviction; update audit-5 sequenced-semantics assertions`
9. `feat(wallet-core): Lock.isIdle() accessor for eviction sweeps` [if Phase 7 Option A chosen]

### PR Title
`refactor(incoming-transfer): per-triple lock as single source of mutual exclusion (codex audit-6)`

### PR Body Skeleton
```
## Summary

Replaces three race-protection sets/maps + five inline `isStale()` checks +
three compensating-action reverts in `IncomingTransferService` with one
`Map<triple, Lock>` serializing every writer (8 distinct) on the trust row
and records belonging to that `(profileId, networkId, contract)` triple.

Public surface unchanged; UI consumers untouched. Internal complexity
significantly reduced.

## Locked decisions

- Single-PR big-bang. 7 ordered commits, each independently buildable.
- Lock-per-triple via existing `wallet-core/utils/lock.ts` primitive.
- 4-state FSM preserved.
- Actor-only; repo stays last-write-wins.

## Test plan

- [ ] `bun lint` green
- [ ] `bun typecheck:all` green
- [ ] `bun test` green on extension package
- [ ] `bun test:e2e:network` green for `incoming-transfers`
- [ ] New `service.lock-races.test.ts` adds 10 race-ordering pins
- [ ] Audit-5 fixtures updated to assert sequenced (not compensating-revert) semantics

## Risk

See implementations-plan/incoming-trust-state-machine-refactor/plan-opus.md
Section 8.
```

---

## 11. Implementation Discipline

### Code Style

- **No `as never as { ... }` casts in production code.** Tests use these; production should not.
- **Lock acquisition site**: always `withTriple(profileId, networkId, contract, async () => { ... })`. Never raw `lock.enter()` / `lock.leave()` from a writer — too easy to forget `finally`.
- **Critical-section comments**: every `withTriple` body opens with a single-line comment stating what it owns ("// CS: trust read + per-note record writes for this triple").
- **No nested locks.** A lock-holder must not call another method that acquires the same triple. Code review checks: grep `withTriple` calls inside `withTriple` bodies.
- **PXE calls and other-service reads**: where possible, do these OUTSIDE the critical section, then enter, then re-read the bits that need atomicity.
- **No new `Set`/`Map` "race guards"**: if review finds a new ad-hoc guard added in this PR, it's a smell — push back. The lock is the only race guard.
- **Comment hygiene**: every comment in `service.ts` referring to `scanGenerations`, `isStale`, `txDeleteInflight`, or compensating-action reverts must be deleted in the same commit that deletes the corresponding code.
- **biome.json**: no new disables. The refactor should make `noUnusedPrivateClassMembers` happy by virtue of fewer fields.

### Review Checklist
- [ ] Every public method that mutates state acquires `withTriple` (or `acquireMany` for multi-triple operations).
- [ ] No public method calls another lock-acquiring public method.
- [ ] `evictIdleLocks` runs from at least: `onTokenDeleted`, `clearProfile`, `clearChain`.
- [ ] Locks are acquired in lexicographic order in `acquireMany`.
- [ ] No `try { } catch { /* swallow */ }` around `lock.leave()` — must always run via `finally`.
- [ ] Service unit tests still cast-access `scanContract` and `repo` — refactor must not break that.
- [ ] Test names referencing "race", "stale", "compensating-action revert" are either kept-as-pin or renamed with explanation.

### What NOT To Do
- Don't move to a per-`accountAddress` lock granularity (over-fine; user-locked decision #2 — per-triple).
- Don't introduce an actor or message queue (user-locked decision #2).
- Don't add new states to the FSM (user-locked decision #3).
- Don't add CAS / version-stamp checks to the repo (user-locked decision #4).
- Don't change the boolean returns of `setTrustAllow/Reject` (UI contract).

---

## 12. `/goal` and `/loop` Seed Strings

### `/goal`

```
/goal Refactor IncomingTransferService at packages/extension/src/wallet/services/incoming-transfer/service.ts to replace three race-protection sets/maps (scanGenerations, txDeleteInflight, polling), five inline isStale() checks, and three compensating-action reverts in setTrustAllow/Reject with one Map<triple, Lock> using packages/wallet-core/src/utils/lock.ts. Triple key is (profileId, networkId, contract). All 8 writers (scanContract, setTrustState, setTrustAllow, setTrustReject, onTokenDeleted, onTransactionAdded, clearProfile, clearChain) funnel through withTriple/acquireMany helpers. Preserve the 4-state FSM (unknown → pending → trusted | blocked). Repo stays last-write-wins. Public surface (Methods, Events, boolean returns) is byte-identical. Add ~10 race-ordering tests in service.lock-races.test.ts; update audit-5 fixtures to sequenced-semantics assertions; preserve the 60+ existing tests in service.scenarios.test.ts. Quality gates: bun lint, bun typecheck:all, bun test, bun test:e2e:network -- --testNamePattern=incoming-transfers all green. Branch refactor/incoming-transfer-triple-lock, 7-9 conventional commits (one per writer migration + tests + optional Lock.isIdle()). Single PR. See implementations-plan/incoming-trust-state-machine-refactor/plan-opus.md for phase ordering, deadlock analysis, eviction strategy, and risk matrix.
```

### `/loop`

```
/loop incoming-transfer-triple-lock: (1) read plan-opus.md sections 5 and 11. (2) commit 1: scaffold tripleLocks Map + withTriple + acquireMany + evictIdleLocks in service.ts. Run bun lint && bun --cwd packages/extension test src/wallet/services/incoming-transfer. (3) commit 2: migrate setTrustAllow/Reject/State, drop compensating-action reverts at lines ~256/288, drop per-iteration getRecord re-check at ~275. Update audit-5 test assertions in service.scenarios.test.ts:1671-1729 to sequenced semantics. Test. (4) commit 3: migrate clearProfile/clearChain via acquireMany over listTrust snapshot + second-pass sweep. Test. (5) commit 4: migrate onTokenDeleted under withTriple. Test. (6) commit 5: migrate scanContract — pull getNotesRaw + prefetch block timestamps OUTSIDE the lock; per-note loop INSIDE; retire scanGenerations, bumpGeneration, genKey, isStale, the seven isStale return points. Update inline comments. Test. (7) commit 6: migrate onTransactionAdded, retire txDeleteInflight. Test. (8) commit 7: migrate replayPendingPrompts per-row, retire liveTrust + liveTokens re-checks. Test. (9) commit 8: add service.lock-races.test.ts with LR1-LR10. (10) commit 9 (optional): add Lock.isIdle() to wallet-core if Option A chosen. (11) bun lint && bun typecheck:all && bun test && bun test:e2e:network -- --testNamePattern=incoming-transfers. If any step fails, stop, diagnose, fix in a new commit (do not amend), continue. (12) git push -u origin refactor/incoming-transfer-triple-lock && gh pr create using the template in plan section 10. (13) STOP. Wait for code review.
```
