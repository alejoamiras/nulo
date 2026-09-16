# Profile-fenced execution

A transaction runs under the session that approved it, or it stops — never under whichever session
happens to exist when the work resumes.

```yaml
driver: claude-code
tier: mid
eli5_mode: artifact
eli5_url: https://claude.ai/artifact/T3jRDFD9JS6Jj8k74MGMT4
code_review: off      # owner's standing directive — the codex fix loop is the review
harden: not scheduled # this IS execution-layer hardening; the pre-release /harden pass is tracked separately
revision: 9           # rev 1: fable r1 conditional approve; rev 2–6: codex r2–r6 reject (all folded); rev 7: codex r7 conditional approve → conditions met in rev 8; rev 9: owner approval D8–D10 + the dialog pre-title override — see §Decision ledger
approved: 2026-09-16  # owner — design (D8), UI copy (D9), Ask A1 (D10); verbatim answers in §Decision ledger
prerequisite_for: approval-scope-follow (parked, ledger D6)
budget: default (recon 2 explorers; codex high; fable = opus Plan agent)
```

## Summary

Every send the wallet executes — a dApp `sendTx` (with or without an approval popup), the popup's
own transfer, an auth-registry revoke — is authorized under one session, then proves for seconds to
minutes. Today the code re-reads *"which profile is active?"* at seven points after authorization
(mutex key, account contract, two estimate-reuse checks, journal stamp, …). If the session changes
in between, the operation silently continues under the new one. The wallet already captures an
authorization fence (`ExecutionFence { profileId, epoch }`) at approval; it just drops it before the
two send kinds reach the code that needs it (Fact 1), never captures one at all on the silent dApp
path (Fact 2), and never checks anything but the deletion epoch (Fact 4).

This plan makes the fence the execution identity. It gains a third field — the **session serial**,
a monotonic id every unlocked or restored session carries (Facts 27, 35) — so a fence names *this*
session, not just this profile: A → B → A and A → lock → A both fail it. The fence is captured
atomically at both dApp authorization moments, threaded non-optionally along the dApp path,
resolved-from and asserted at every site that needs a profile, asserted again after proving, and
checked **synchronously** in the same tick as the broadcast invocation — the one place a session end
cannot interleave (Fact 28). A mismatch throws a typed `SessionEndedError`; the record terminalizes
`failed` (kind `session_ended`) under its **original** profile; nothing is submitted.

The owner chose the UX to match: **ending the session cancels in-flight work.** Locking (manual)
cancels whatever is still pending/simulating/proving, after a confirmation at the lock button;
unlocking a different profile is always preceded by a lock, so that one dialog covers every switch
path; the inactivity auto-lock **defers** while approved sends are running — within a per-session
budget — instead of destroying them silently; and the service worker cancels the ended session's
registered in-flight sends the moment it ends, keyed by serial, so the cards read "Cancelled" immediately.

## Scope

**In**

- `SessionEndedError` (typed, detail-free; dApp envelope 4900 `SESSION_ENDED`); `session_ended` job-error kind.
- `ExecutionFence.session` (serial, allocated inside `open`'s artifact section and at `restore`);
  `ProfileService.assertFence(fence)` (awaited, under the facade lock) and
  `ProfileService.isFenceLive(fence)` (synchronous, lock-free).
- Fence capture on the silent dApp path; fence required for DAPP-origin `executeOperations`;
  threading + assert at every send-path profile read — the seven sites in Fact 7, including
  `TransferEstimateReuse` and the fee strategies; the post-prove assert; the synchronous check
  immediately before `node.sendTx`, after the existing post-`submitting` cancellation check; the
  lane terminalizes an already-`pending` record it refuses.
- One serial-aware in-flight registry in the lane (`registerInFlight`, synchronous, the only
  writer of the controller map), used by `acquireSlot`, the claim helper's three sites and the
  transfer path; a registration under a dead serial is reported to the caller, who terminalizes
  `failed/session_ended`; `abandonDeadSessions` decides deadness per record at action time.
- The two auth-registry send entries (`revokeAuthwits`, `setRegistryEnabled`) capture their fence
  at entry, before their awaited preparation, and forward it.
- Auto-lock deferral: one `expireOrDefer` on both expiry paths (alarm and lazy); **every** write
  of the session row (`refresh`, `applyTtlChange`, `clearBearer`, deferral) goes through one
  artifact-locked writer that compares the expected deadline and config revision *inside* the
  lock; coalesced decisions; step `min(60 s, ttl)`; a per-session deferral budget (Ask A1) computed
  from the TTL in force at decision time.
- Lock-button confirmation when approved sends are running (profile-wide count, `queued` excluded),
  after one fresh journal read.
- Failed-card copy for `session_ended`.
- Composition tests per read site and per race, unit + component tests, three network e2e, smoke,
  `audit:vue`, `execution/README.md` fence section, one `ARCHITECTURE.md` paragraph.

**Out**

- The wallet's own Send freeze (`hasInFlightSend` account-scoped guard on account/network switches)
  and `commitScopeChange` — untouched (owner D3; the parked plan narrows it on its own terms).
- The lock-screen profile selector (`SelectProfilePopup`) — untouched.
- Continuing a transaction across a lock or switch ("graceful drain") — needs two key contexts
  alive at once; a possible later plan, for which this fence is the prerequisite.
- The `cancelJob` principal rule (active profile may cancel its own jobs) — correct as-is.
- D13 deletion-epoch fencing on local writes (token/fpc/network/contact) — unrelated, untouched.
- dApp-session teardown (`profile-switch-teardown.ts`) — unchanged.
- **The TTL activity policy.** Today a dApp's silent call refreshes the session like a user action
  (Fact 2, `:475`) and so does every popup navigation (Fact 43). Distinguishing user activity from
  dApp activity is a session-policy change with its own UX; this plan states the consequence
  (§Known limitations) and does not change it.
- **Journal-independent execution tracking.** A send that has no journal record (creation failed,
  or a UI entry that arrives without `queuedJournalId`) is not registered and not swept; stated as
  a limitation and tested as such, not fixed here.
- `SessionManager.restore()`'s expiry handling — unchanged (it assigns a serial, nothing else).

## UI impact (owner sign-off required — quoted in the PR body)

| Surface | Before | After |
|---|---|---|
| Header lock button, while approved sends are running anywhere in the profile (`pending`/`simulating`/`proving` — not `queued`, not `submitting`) | Locks instantly; the running transaction keeps proving and, if it finishes while locked, still submits. | One fresh journal read, then: `ConfirmPopup`, red confirm: **pre-title** "Running transactions" · **title** "Lock wallet?" · **body** "1 transaction is still running. Locking cancels it." / "{N} transactions are still running. Locking cancels them." · **confirm** "Lock anyway" · Cancel default. Confirming locks and cancels. Zero running → instant lock, exactly as today. The pre-title needs a new optional `cacheStore.confirm.pre_title`: today `ConfirmPopup` derives it from the button colour ("Irreversible" for red, "Action required" otherwise), and cancelling a send is not irreversible. Every other dialog keeps the derived label (D9). Rendered with the real components in the ELI5 (both themes; the sheet is full-height because `showPopupFullscreen` defaults on). |
| Inactivity auto-lock, while approved sends are running | Fires on schedule; the transaction keeps proving and may still submit locked. | Waits — re-checks every `min(60 s, ttl)` — until the last approved send terminalizes or the session's deferral budget (Ask A1) is spent, then locks (and cancels what is left). Nothing is shown. |
| Activity — a send cancelled by the lock (dialog or sweep) | (today the send continued) | Existing "Cancelled" gray card. No new copy. |
| Activity — a send that reached a checkpoint after a session end (rare race) | (unreachable today; the op continued) | Failed card, red, subtitle **"Stopped — wallet was locked"**. |
| dApp — its pending `sendTx` on a lock | survives the lock; may still succeed | resolves with the existing cancellation error (sweep) or `4900 SESSION_ENDED` (checkpoint) |
| Lock-screen profile selector | Refuses with a toast when the viewed account has a send in flight. | Unchanged code (see §Known limitations for the residual). |

Nothing else the user sees changes.

## Known limitations (deliberate, owner-visible)

- **Ending the session ends the work.** Lock or switch mid-proof cancels the transaction
  (owner D5). "Keep the old vault open until the proof drains" is a security-model change; out of scope.
- **The broadcast invocation is the point of no return.** The synchronous check binds authorization
  to the *invocation* of `node.sendTx`, not to the transport's eventual transmission; a session end
  after the call has been issued cannot recall it. The record completes on its own merits.
- **Two terminal shapes for a session end, plus the existing one.** Sweep-cancelled sends read
  "Cancelled" (dApp: the existing cancellation error); a send refused at a checkpoint or at
  registration reads "Stopped — wallet was locked" (dApp: `SESSION_ENDED`). One shape would
  require the sweep to lie about who cancelled.
- **Consent is best-effort.** The popup asks after one fresh journal read, but a send that the
  service worker admits between that read and the lock is cancelled without a warning. Closing the
  gap would mean the popup holding a lock on the worker's admission path; not worth it for a
  sub-second window.
- **The deferral budget is per session, not per burst of work.** Each unlocked session can push
  its inactivity expiry out by at most the budget in total; the budget does not refill while the
  session lives, because the only observable "no sends left" moment is the one that closes the
  session anyway. A user who runs many long sends under a short TTL in one session refreshes the
  TTL through the popup on every send (Fact 43), so in practice the budget only matters for
  unattended work.
- **The budget bounds deferral, not activity.** A dApp's silent call already refreshes the TTL
  today (Fact 2), so a connected dApp with a self-pay capability can keep a wallet unlocked by
  *activity* with or without this plan. That is the existing TTL policy, stated here, not changed
  here (§Scope Out).
- **A silent dApp send defers the auto-lock like an approved one.** The journal cannot tell a
  popup-approved send from a self-paid no-popup one; both are `pending+`. The budget bounds it.
- **Other lock paths ask nothing.** A settings reset, an extension update or a service-worker
  restart end the session without the dialog; the sweep and the checkpoints still hold.
- **Unregistered execution is not swept.** A send whose journal record could not be created keeps
  executing without a controller today (Fact 38) and will keep doing so; a UI entry that arrives
  without `queuedJournalId` is registered only once its record exists. Such work cannot be
  cancelled promptly by a session end; the fence checks still stop it before any PXE build and
  before broadcast, and the waits/heartbeats it holds end when its next check fails.
- **The lock-screen selector's refusal toast can still appear** when the popup's in-flight tracker
  holds rows from before the lock (its cached check runs before its refresh, Fact 30). The lock has
  already cancelled those sends, so the toast is stale, not a hold. Fixing it means touching the
  Send freeze helper (D3: out); the parked plan owns that surface.

## Architecture & Implementation

### Proposed architecture

Four pieces; the first is the invariant, the other three make it feel intentional.

1. **The invariant (service worker).** `ExecutionFence` gains `session` — the serial of the
   `ActiveSession` that authorized the work. `SessionManager` allocates it from a monotonic counter
   **inside `open`'s artifact section**, as a field of the object assigned at `:298` before
   `onChange` fires, and likewise at `restore`'s assignment (`:627`) (Fact 35); a serial is never
   reused after a rolled-back publication. Captured at both dApp authorization moments —
   `executeAndResolve` (exists) and `silentInteraction` (new: atomic capture + compare replacing the
   bare id read) — and passed to `executeOperations`, which **throws** when `origin.type === DAPP`
   and no fence arrived. Inside, the fence is a required parameter of the lane's `acquireSlot`, the
   builder, both estimate-reuse caches, the fee strategies' ctx and the executors' internals; it is
   optional only on `executeSendTransaction` (the direct UI entry: absent ⇒ capture now) — the
   exact contract `executeRegisterToken` has (Fact 3). The two UI callers that *do* await
   preparation before calling it — `revokeAuthwits` and `setRegistryEnabled` in the auth registry
   (Fact 44) — capture their own fence at entry and forward it, so a lock + re-unlock during their
   network or storage reads cannot hand them the replacement session's serial. Two checks exist:
   - `assertFence(fence)` — awaited, under the facade lock, reading the session manager directly
     (never the recursive `getActiveProfile`): an active session exists, its serial equals
     `fence.session` (which implies the profile), deletion epoch current (existing `assertCurrent`).
     Any miss throws `SessionEndedError` (the deletion-epoch error stays its own class). Sites: slot
     acquisition (before the mutex key, now built from the fence), build context, both estimate
     reuses (never falling through to a fresh build), transfer journal stamp, and right after the
     post-prove `checkCancelled` in `proveAndSend`.
   - `isFenceLive(fence)` — synchronous, lock-free: `activeSession !== undefined &&
     activeSession.serial === fence.session`. Called inside `sendTxTask`'s `try`, after the task
     step is created, as the statement immediately before `node.sendTx(tx)` (Fact 39) — with no
     `await` between them. `close()` clears the in-memory session synchronously before its first
     await (Fact 28), so a session end cannot land between the check and the invocation. The
     existing post-`submitting` `checkCancelled` (`:303`) stays exactly where it is, **before** this
     check: a job cancellation and a session end are different questions and each keeps its own
     answer.
2. **The registry and the sweep (service worker).** The lane gains one **synchronous**
   `registerInFlight(journalId, serial, controller): { live: boolean }` — the single writer of the
   controller map, replacing the direct `set` calls in `acquireSlot`, `claim-helper.ts` (three
   sites) and `registerController` (Fact 36). It records the serial next to the controller and
   reports whether that serial is live (`peekLiveSerial()` equal); when it is not, it registers
   nothing and the **caller** — always inside an `async` function that owns the record — terminalizes
   `failed/session_ended` and throws `SessionEndedError` (the same exit `acquireSlot` already takes
   for a capacity rejection, Fact 38). `acquireSlot` registers **before** its first `await` (today
   the network-key resolution precedes the registration, Fact 36). `abandonDeadSessions()` takes no
   snapshot argument: for each tracked record it reads `peekLiveSerial()` *at that moment*, and
   only a record whose serial ≠ the live one (or no live session) and whose stage is
   pre-`submitting` is journal-first cancelled (`transitionIfStage`) and aborted — so the sweep's
   outcome is `cancelled`, a registration refusal's is `failed/session_ended`, and the two never
   describe the same record. A record registered by a session that opened while the sweep was
   running is never touched. `SessionManager.close()` fires `onChange(undefined)` synchronously at
   the memory clear and `open` fires `onChange(profile)` at publication (Facts 28, 35); the
   existing `ExecutionService` subscriber (`service.ts:401`) schedules the sweep off the handler,
   never awaits the facade; failures logged. Nothing depends on remembered events (the silent
   restore emits none, Fact 31).
3. **Auto-lock deferral (service worker).** Three changes to `SessionManager`, one to wiring:
   - **One session-row writer, two kinds of write.** `commitSession(session, { mutate, expect? })`
     is the only code that mutates and persists a live session's row and swaps its alarm. It runs
     under `artifactLock`; *inside* the lock it checks `this.activeSession === session` (every
     caller), applies `mutate` to the **current** object, persists that object, and re-arms the
     alarm if `lockedAt` changed. `expect` is passed by **stale-decision writers only** — the
     deferral, whose decision was computed from a snapshot across an awaited predicate: `expect =
     { lockedAt, configRev }` as observed, and a mismatch is a silent stand-down (someone with
     fresher information already moved the deadline). `refresh()`, `applyTtlChange` and
     `clearBearer` are **must-apply writers**: they pass no `expect`, compute from the current
     object inside the lock (`refresh` from `now`, `applyTtlChange` from `since` and the new TTL,
     `clearBearer` removes the bearer fields), and therefore never lose — they only ever serialize.
     A deferral that wins the lock first cannot make a later `clearBearer` disappear (codex r6 #1);
     a `clearBearer` that wins first changes neither `lockedAt` nor `configRev`, so the deferral's
     expectation still matches and it commits against the scrubbed row — both orders end with the
     extended deadline and no bearer (codex r7). Today `refresh` writes under the artifact lock while
     `applyTtlChange` and `clearBearer` write under the facade lock only (Facts 40, 45), and
     `ValueStorage.set` serializes the row at call time (Fact 45), so two writers on different
     locks can persist two snapshots of one object in either order; after this every live-row write
     is serialized and every mutation is applied to the row as it is at that moment. `configRev`
     increments on every `applyTtlChange`, including non-zero → non-zero changes. The locked
     branch of `clearBearer` (no live session) stays as it is — there is no live row to race.
   - **One expiry decision.** `expireOrDefer(session)`, used by **both** expiry paths —
     `onAlarmFired` and the lazy branch of `getActive()` (Fact 16) — is coalesced (one promise per
     session object; a `refresh()` arriving meanwhile joins it through `getActive()`, Fact 16).
     It snapshots the effective deadline `deriveLockedAt(session)` (Fact 41), the raw `lockedAt`
     and `configRev`, awaits the late-bound `shouldDeferExpiry(profileId)` predicate (set by
     `ExecutionService.init`, so no Profile↔Execution construction cycle), then either
     `commitSession` with `expect = { lockedAt: raw, configRev }` and a `mutate` that sets
     `lockedAt = min(now + step, budgetEnd)` — or,
     when the predicate is false, throws, or the budget is spent, re-checks identity, raw
     `lockedAt` and `configRev` **one more time** and only then calls `close(session)` outside the
     artifact lock. `step = min(60_000, sessionTtl)`.
   - **A per-session budget.** `session.deferBudgetEnd ??= effectiveDeadline + budget`, set on the
     first deferral of the session, with `budget = min(sessionTtl at that moment, 10 min)` (Ask
     A1); `refresh()` leaves it alone; nothing refills it. `next` is clamped to `deferBudgetEnd`
     (never closed early because a whole step does not fit); at or past it, close.
   - `ProfileService` forwards `setExpiryDeferral(pred)`; `ExecutionService.init` supplies
     `hasApprovedSendsInFlight` (journal: send kinds at `pending|simulating|proving`).
4. **The lock dialog (popup).** `Header.vue`'s lock handler awaits one `refreshInFlight()` (the
   store's existing tracker read, Fact 11), then: zero approved sends → `lockActiveProfile()` as
   today; else `cacheStore.confirm` with the copy above, red confirm, whose callback calls
   `lockActiveProfile()` — the sweep does the cancelling. No popup code cancels anything itself.

### Key interfaces

```ts
// packages/extension-messaging/src/errors.ts
/** The session that authorized an operation ended (lock, expiry, or another profile) before it
 *  finished. Constant message, no ids — it rides the message-only code channel. */
export class SessionEndedError extends WalletError { /* code: "SESSION_ENDED" */ }

// apps/extension/src/wallet/services/profile/profile-deletion-state.ts
export type ExecutionFence = { profileId: string; epoch: number; session: number }

// apps/extension/src/wallet/services/profile/session-manager.ts
interface ActiveSession { …; serial: number; deferBudgetEnd?: number; expiryDecision?: Promise<void> }
setExpiryDeferral(pred: (profileId: string) => Promise<boolean>): void
peekLiveSerial(): number | undefined            // synchronous; no lazy close
private configRev: number                        // bumped by every applyTtlChange
private commitSession(session, opts: { mutate: (s: Session) => void; expect?: { lockedAt: number | undefined; configRev: number } }): Promise<boolean>
  // the only live-row writer. Identity is always checked; `expect` only by the deferral (stale-decision
  // CAS, stands down on mismatch). refresh · applyTtlChange · clearBearer pass no `expect` and always apply.
private expireOrDefer(session: ActiveSession): Promise<void>     // coalesced; both expiry paths

// apps/extension/src/wallet/services/auth-registry/service.ts
revokeAuthwits(…)     // fence = captureExecutionFence() as the first awaited statement; forwarded
setRegistryEnabled(…) // same

// apps/extension/src/wallet/services/profile/service.ts
assertFence(fence: ExecutionFence): Promise<void>   // SessionEndedError | deletion-epoch error
isFenceLive(fence: ExecutionFence): boolean          // synchronous

// apps/extension/src/wallet/services/execution/service.ts
executeOperations(ops, origin, parentTask?, hooks?, approvals?, authorizedFence?)   // DAPP + no fence → throws
executeSendTransaction(op, origin, parentTask?, hooks?, fence?)                     // absent ⇒ capture now
hasApprovedSendsInFlight(profileId: string): Promise<boolean>

// execution-lane.ts
registerInFlight(journalId, serial, controller): { live: boolean }   // sync; the only writer of the controller map
acquireSlot(networkId, queuedJournalId, fence, onEnqueued?, originKey?)
  // registerInFlight before the first await; dead serial or failed assert → terminalize
  // `queuedJournalId` (failed/session_ended) → throw SessionEndedError; then the mutex key from the fence
abandonDeadSessions(): Promise<void>                                  // deadness read per record at action time

// execution-coordinator.ts — ProveAndSendContext gains:
assertAuthorization: () => Promise<void>   // awaited after the post-prove checkCancelled
assertLive: () => void                     // synchronous; sendTxTask calls it right before node.sendTx

// tx-request-builder.ts
buildStandard(op, fence, feeMethod, parentTask?)   // fence inserted; existing args preserved
buildNoFrom(op, fence, parentTask?)

// operation-estimate-reuse.ts · transfer-estimate-reuse.ts
tryConsume(…, fence)   // entry.profileId !== fence.profileId → SessionEndedError, no fallback

// utils/in-flight-send.ts  +  stores/app.store.ts (tracker)
approvedSendsInFlight(ops, profileId): { ids: string[]; count: number }

// packages/wallet-core/src/jobs/types.ts
KnownJobErrorKind |= "session_ended"      // + mirror entry
```

`executeTransfer` keeps its signature (RPC-exposed, captures at `:437`); the fence is threaded
*inside* `TransferExecutor` only. `ViewExecutor`'s three builder calls (estimates and simulations,
UI- or dApp-originated) capture a fence at their entry and pass it — they are not sends; the
builder simply refuses to build without a session to build for.

### Data & control flow (dApp send, the critical path)

```
approve  → executeAndResolve: fence = capture()  { profileId, epoch, session }                (exists + field)
silent   → silentInteraction: same capture + compare (replaces the bare id read)              [Phase 1]
  → executeOperations(ops, origin, …, fence)      DAPP && !fence → throw                      [Phase 1]
  → dispatchOperation → send_transaction / aztec_sendTx: pass fence (today: dropped)          [Phase 1]
  → lane.acquireSlot(…, fence): registerInFlight (sync) → assertFence;                        [Phase 1]
       dead/miss → terminalize pending record (failed/session_ended), throw
       key = `${fence.profileId}:${chainId}`
  → build: assertFence; account = getAccountContract(fence.profileId, chainId, addr)           [Phase 1]
     └ reused estimate (either cache): entry.profileId === fence.profileId else SessionEndedError
  → journal(proving) → prove (A's warm PXE runtime; ops carry A's NetworkInfo — Fact 12)
  → checkCancelled (:298) → await assertAuthorization()  (cheap early exit before toTx)        [Phase 1]
  → toTx → journal(submitting) → checkCancelled (:303, unchanged)
  → sendTxTask: task step; assertLive(); node.sendTx(tx)     ← same tick, no await between    [Phase 1]
  → record → succeeded
catch SessionEndedError → markJournal(failed, { kind: "session_ended" }) → rethrow
   (at `submitting` the transition is failed, which the FSM allows — Fact 9)

session end (lock | expiry | unlock other) → close(): activeSession = undefined (sync) → onChange
   → ExecutionService: schedule abandonDeadSessions()  (deadness read per record) → cancelled  [Phase 3]
TTL due (alarm or lazy) → expireOrDefer: coalesce → snapshot → predicate →
   commitSession(expect, configRev, mutate) | re-check → close                                [Phase 4]
lock button → await refreshInFlight() → count > 0 ? ConfirmPopup → lockActiveProfile()         [Phase 5]
```

### File-level change map

| File | Change |
|---|---|
| `packages/extension-messaging/src/errors.ts` (+ test) | `SessionEndedError`; payload round-trip; detail-free |
| `packages/wallet-core/src/jobs/types.ts` (+ test) | `"session_ended"` in the union and the mirror |
| `wallet/services/wallet-sdk/error-envelope.ts` (+ test) | branch → `{ code: 4900, data: { walletErrorCode: "SESSION_ENDED" } }` |
| `wallet/services/profile/profile-deletion-state.ts` | `ExecutionFence.session` |
| `wallet/services/profile/session-manager.ts` (+ test) | serial allocated in `open`'s artifact section (`:298`) and at `restore` (`:627`); `peekLiveSerial`; `commitSession` (single artifact-locked live-row writer with in-lock expectation checks; `refresh`, `applyTtlChange` and `clearBearer`'s live branch refactored onto it); `configRev`; `expireOrDefer` (coalesced) on both expiry paths; per-session budget; `setExpiryDeferral` |
| `wallet/services/auth-registry/service.ts` (+ test) | `revokeAuthwits` and `setRegistryEnabled` capture a fence as their first awaited statement and pass it to `executeSendTransaction` |
| `wallet/services/profile/service.ts` (+ integration test) | capture includes the serial; `assertFence`; `isFenceLive`; forwards `setExpiryDeferral` |
| `wallet/services/dapp-interaction/service.ts` (+ composition test) | `silentInteraction` captures + compares atomically, passes the fence |
| `wallet/services/execution/service.ts` (+ tests) | DAPP-origin fence requirement; dispatch arms pass it; `executeSendTransaction(…, fence?)`; sweep on the existing subscriber; `hasApprovedSendsInFlight`; registers the deferral predicate in `init`; `buildForDiscovery` passes the fence |
| `wallet/services/execution/execution-lane.ts` (+ test) | `registerInFlight` (sync single writer, reports liveness); `acquireSlot(…, fence)`: register before the first await, assert, terminalize-before-throw, mutex key from the fence; `abandonDeadSessions` |
| `wallet/services/execution/claim-helper.ts` (+ test) | its three controller-map writes (`:181,197,272`) go through `registerInFlight` with the fence serial; a dead result terminalizes and throws (Fact 36) |
| `wallet/services/execution/tx-request-builder.ts` (+ pins test) | `fence` required; `resolveBuildContext`/`buildNoFrom` assert + resolve from it |
| `wallet/services/execution/fee/{fee-juice,fpc,embedded,fee-juice-with-claim}-strategy.ts` (+ tests) | ctx carries the fence; every `buildStandard` call passes it (Fact 32) |
| `wallet/services/execution/view-executor.ts` | captures a fence at entry for its three builder calls |
| `wallet/services/execution/dapp-send-executor.ts` (+ test) | thread `fence` to build/reuse/NO_FROM; reused branch resolves from the fence; `assertAuthorization` + `assertLive` in the ctx; `:526` fallback removed |
| `wallet/services/execution/operation-estimate-reuse.ts` (+ test) | `tryConsume(…, fence)`; drift throws, never falls through |
| `wallet/services/execution/transfer-estimate-reuse.ts` (+ test) | same: compare vs the fence at `:176`, throw instead of reject-and-rebuild |
| `wallet/services/execution/transfer-executor.ts` (+ test) | fence into `createTransferJournal`, `fromReusedEstimate`, `buildFresh`, its ctx; `registerController` → `registerInFlight` (dead → terminalize + throw); inline catch classifies `session_ended` |
| `wallet/services/execution/mark-failed-unless-cancelled.ts` (+ test) | `SessionEndedError → kind "session_ended"` (stays synchronous) |
| `wallet/services/execution/rpc-cancel.ts` (+ test) | `SessionEndedError` rides the code channel (detail-free, so N-15 holds) |
| `wallet/services/execution/execution-coordinator.ts` (+ test) | `assertAuthorization` after the post-prove `checkCancelled`; `assertLive()` inside `sendTxTask`'s `try`, the statement before `node.sendTx`; `:303` untouched |
| `wallet/services/execution/service.composition.test.ts` | session fake with serials + `fireChanged()`; controllable journal storage write; the session-end and race cases |
| `wallet/services/execution/README.md`, `ARCHITECTURE.md` | "Authorization fence" section; one paragraph |
| `utils/in-flight-send.ts` (+ test) | `approvedSendsInFlight(ops, profileId)` |
| `stores/app.store.ts` (+ shape pins test) | the computed |
| `components/Header.vue` (+ test) | lock handler → refresh, then dialog when count > 0 |
| `popup/components/popups/ConfirmPopup.vue` (+ test) | optional `cacheStore.confirm.pre_title` over the colour-derived label (D9) |
| `utils/journal-state.ts` (+ test) | `session_ended` → "Stopped — wallet was locked" |
| `tests/e2e/fixtures/helpers.ts` | `createAndActivateProfile(page, name, password)`; `setSessionTtlMs(page, ms)` via the config RPC; `peekSession(page)` — a non-refreshing `getActiveProfile` RPC issued from the popup page's service client; `readSessionRow(page)` — the persisted session's `since`/`lockedAt` read from `chrome.storage` in the page context (the proof-gate fixture already reads storage the same way) |
| `tests/e2e/network/lock-cancels-dapp-send.test.ts` · `auto-lock-defers-while-proving.test.ts` · `profile-switch-sweeps-transfer.test.ts` | **new** |

Untouched: `SelectProfilePopup.vue`, `commitScopeChange`, `profile-switch-teardown.ts`,
`hasInFlightSend`, `cancelJob`, the `:303` cancellation check, `restore`'s expiry handling.

### Non-obvious mechanics

- **Why a session serial and not an identity compare.** `fence.profileId === active.id` cannot
  see A → B → A or A → lock → A (codex r2 #1): both restore the id. A serial that changes on every
  open or restore names the exact session; the profile id stays in the fence because the mutex key,
  the account lookup and the journal stamp need it, and the deletion epoch stays because a serial
  cannot see a delete + same-id re-import inside one session (Fact 4). The manager's existing
  `sessionGeneration` (Fact 27) is an artifact-race counter bumped at the *end* of `open`; the
  serial is a field of the session object, allocated in the same artifact section and present from
  the first read. A facade-locked capture cannot observe a half-published session (it waits for
  `open` to finish); the off-lock `peekLiveSerial` **can** see the provisional session before a
  rolled-back publication (Fact 35) — harmless: that serial dies with the rollback, and no normal
  capture could have obtained it.
- **Why two checks, and why the cancellation check stays.** `assertFence` reads the session under
  the facade lock and is awaited — right for the ordinary sites, wrong for the last one: any
  `await` between a check and `node.sendTx` is a window. `isFenceLive` is synchronous and
  lock-free; JS is single-threaded and `close()` clears memory before its first await, so "check,
  then invoke, in one tick" is airtight for *session* ends. It says nothing about *job*
  cancellation: a cancel can win during the `journal(submitting)` await while the session stays
  open, and only the existing `:303` `checkCancelled` catches that (codex r3 #1). Both stay; the
  session check comes last.
- **Why the assert precedes the mutex key.** A drifted op keyed on the active profile would
  serialize against the wrong profile's lane and skip the right one — reopening the stale-note race
  the mutex exists for (recon, cap. 7). Asserting first makes the key question moot.
- **Why the lane terminalizes before it throws.** `acquireSlot` runs before `runInSlot`'s
  `try` (Fact 33); the silent path has already moved its record to `pending` (Fact 2). A bare throw
  would strand that record at "Preparing…" until the reaper's 2-minute pending grace. The lane
  already does exactly this for a capacity rejection (Fact 38); the fence refusal takes the same exit.
- **Why `registerInFlight` is synchronous and only reports.** A registration that could itself
  cancel would need an awaited journal write inside what must be a synchronous, pre-first-await
  call (codex r4 #2). Reporting `live: false` and letting the async caller terminalize keeps the
  registration synchronous, keeps every refusal on one outcome (`failed/session_ended`), and keeps
  the sweep's outcome (`cancelled`) distinct.
- **Why one registry writer.** Three files write the controller map today (Fact 36). A sweep can
  only be complete for *registered* work if every registration is tagged and happens before any
  await a session end could land in — one function enforces both, and refusing a dead serial at
  registration closes the "registered after the sweep ran" gap (codex r3 #4). What it cannot cover
  is work with no journal record (§Known limitations).
- **Why deadness is read per record, not passed in.** A sweep scheduled by a lock carries
  `undefined`; if a new session opens before the sweep's journal awaits finish, that snapshot would
  cancel the new session's records. Reading `peekLiveSerial()` at each action makes the argument
  unnecessary and the race impossible.
- **Why the fence is required at `executeOperations` for DAPP origin.** Two dApp entries exist
  and one was missed by everyone until audit (Fact 2). A type-level requirement on the shared
  entry cannot be forgotten by a third.
- **Why `abandonDeadSessions` bypasses the cancel principal.** `cancelJob` authorizes by "active
  profile owns the record" — correct for humans. The sweep runs *because* no live session owns the
  record; it is the service worker acting on its own lifecycle event, lane-internal, not an RPC.
- **Why the sweep is scheduled, not awaited, in the handler.** `EventHandler.invoke` is
  synchronous and the profile facade's `onChange` fires inside `runExclusive` on the open path
  (Fact 17); awaiting anything that touches the facade there deadlocks.
- **Why one session-row writer.** Four writers of a live session's row exist today — `refresh()`
  under the artifact lock, `applyTtlChange` and `clearBearer` under the facade lock only, the alarm
  close — and the deferral would be a fifth running off both locks (Facts 40, 45). `ValueStorage.set`
  serializes the object when called, so a later in-memory mutation never reaches an outstanding
  write; two writers on different locks can land two snapshots in either order — a newer deadline
  overwritten, or a bearer strict mode just removed written back. Identity guards cannot order
  writers that hold different locks; a single artifact-locked writer can (codex r3 #3, r4 #1,
  r5 #2). But not every writer is a CAS: the deferral decided on a snapshot across an await and
  must stand down if the deadline moved meanwhile; `refresh()`, `applyTtlChange` and
  `clearBearer` decide from the row *as it is inside the lock* and must always land — a
  deadline-expectation on `clearBearer` would let a deferral that won the lock first make strict
  mode's bearer removal vanish (codex r6 #1). So the writer checks identity for everyone and the
  expected deadline only for the deferral; the three must-apply writers move onto it with their
  semantics unchanged and their ordering finally defined.
- **Why the auth-registry entries capture first.** `executeSendTransaction`'s "absent ⇒ capture
  now" is right only when the caller has done nothing awaited between the user's action and the
  call. Both auth-registry mutations await a network lookup and (for revokes) authwit reads first
  (Fact 44); a lock and same-profile re-unlock inside that window would hand them the new
  session's serial and every downstream check would pass (codex r5 #1). Capturing as the first
  awaited statement binds them to the session the user acted in.
- **Why deferral lives in `expireOrDefer`, not in the alarm handler.** `getActive()` closes an
  expired session lazily on any call (Fact 16); an ordinary RPC landing after `lockedAt` but before
  the alarm would lock mid-proof (codex r2 #3). Both paths call the same function; `refresh()` calls
  `getActive()` first and so *joins* a pending decision rather than racing it.
- **Why the budget anchors on the effective deadline.** Restored sessions may lack a persisted
  `lockedAt`; `deriveLockedAt` falls back to `since + ttl` (Fact 41). Arithmetic on the raw field
  would produce `NaN`; the raw field is still what the CAS compares.
- **Why the budget is per session.** The only moment the manager can observe "no approved send is
  left" is a predicate answering false — which closes the session. Any per-burst refill would have
  to be driven from the execution layer on drain, a second coupling for a case the popup's own
  refresh already covers (Fact 43). Per session is the deliberate, simpler rule (codex r4 #3).
- **Why `refresh()` does not touch the budget.** `silentInteraction` refreshes the session on every
  capability-authorized call (Fact 2), so a reset would let a dApp re-arm the budget indefinitely
  (codex r3 #2). The budget bounds deferral; the activity policy is out of scope and stated.
- **Where the sweep must not reach.** `submitting` — the broadcast has been issued or is being
  issued in this tick. A record there fails only through its own `assertLive` (`submitting → failed`
  is legal; `submitting → cancelled` is not, Fact 9).

### Trade-offs and alternatives not taken

- **Identity compare only (rev 2).** Blind to A → B → A; the sweep cannot repair it. Rejected (codex r2 #1).
- **Lock never cancels + dialog on the profile selector (rev 1).** The selector lives on the lock
  screen (Fact 13); rejected by the owner (D5, D6).
- **Block lock while sends run.** A security action a 2-minute proof can hold hostage. Rejected (D6).
- **Auto-lock cancels too.** Destroys approved work silently. Rejected (D7).
- **Deferral bounded by the reaper.** False bound (Fact 29). Replaced by the budget.
- **Per-burst deferral episodes.** Needs an execution-layer drain signal; see mechanics. Rejected
  in favour of a per-session budget.
- **User-vs-dApp activity for the TTL.** Would make the budget a real bound on dApp-driven
  unlocking, but changes a session policy that predates this plan and has UX of its own. Deferred
  to its own plan; consequence stated.
- **Journal-independent execution tracking.** Would let the sweep reach work without a record;
  a new identity for in-flight work across three executors, for a case the fence checks already
  fail closed. Stated as a limitation instead.
- **Hold the facade lock across `toTx`/`sendTx`** to close the window. Network I/O under the
  session lock; every RPC in the wallet would wait on a broadcast. The synchronous check costs nothing.
- **Replace the `:303` cancellation check with the session check.** Different question; rejected
  (codex r3 #1).
- **Checkpoints only, no sweep.** Safe, but wastes a full prove and shows a red card for a
  cancellation the user consented to. The sweep costs a serial per controller.
- **The popup cancels the sends itself in the dialog callback.** Two cancellers racing; consent
  and action in two places. Rejected — the popup only locks.
- **One terminal shape.** The sweep producing `failed/session_ended` would render consented
  cancellations as red failures. Rejected.
- **Outline B's veto.** Would block *unlock* (the switcher is on the lock screen). Rejected; its
  generation idea is adopted as the serial.

## Security & Adversarial Considerations

**Threat model.** The attacker is time: a legitimate user's own lock, expiry or switch, or a dApp
keeping an approved operation queued behind the lane mutex long enough for one to happen. No new
inputs cross a trust boundary; the change removes an implicit trust ("the active session is still
the authorizing one") and replaces it with an assertion at every read and a synchronous one at the
commitment point.

- **Cross-profile execution.** Same-phrase sibling profiles share the master and the frozen account
  addresses (Fact 6). Today an op authorized under A that resumes under sibling B resolves B's
  account contract for the same address, proves against A's PXE (its `NetworkInfo` carries A's
  `profileId`, Fact 12), and submits — attributing the transaction and its fee to B's journal scope
  while B never approved it. After: `SessionEndedError` before the account lookup, before the
  mutex, after the proof, and in the broadcast tick — on **both** dApp entries.
- **Same-profile re-unlock (A → B → A, A → lock → A).** The serial differs; every check fails. The
  sweep already cancelled the op at the first end; if it had not yet run, the checkpoints hold.
- **The silent dApp path.** `silentInteraction`'s bare id compare is TOCTOU against an unbounded
  FIFO wait (Fact 2). After: atomic capture at the compare, fence required downstream by type.
- **The lane mutex as a griefing lever.** A dApp cannot pick which profile its op keys against
  (the key is the fence's). Existing capacity caps (`TooManyPendingError`, 8/origin, 32/lane) unchanged.
- **The lock dialog as a nag surface.** Counts only `pending | simulating | proving` — a popup-
  approved or capability-authorized send, never a bare queued request. `queued` (dApp-creatable,
  pre-approval) is excluded because `in-flight-send.ts:36-45` documents that hold.
- **Auto-lock deferral as a hold on the session.** The per-session budget bounds what *deferral*
  can add past an expiry, whatever is in flight and however often it is refreshed. It does not
  bound what *activity* can add: a self-paying dApp already refreshes the TTL on every silent call
  today (Fact 2). This plan neither widens nor closes that; it names it.
- **Sweep authority.** `abandonDeadSessions` is lane-internal, reachable only from the execution
  service's own subscriber — not an RPC, not exposed to the popup or dApps. It touches only records
  the lane registered itself, whose serial is dead *at action time* and whose stage is pre-`submitting`.
- **Wire details.** `SessionEndedError` carries no ids (constant message), so the message-only
  reconstruction across the RPC boundary loses nothing (N-15 guard). Serials and ids are logged at
  the throw site as named properties for the `trim()` walker; never in a finished string
  (`log-payload-ban.test.ts`).
- **No new persistence, dependency, or crypto.** The serial, the budget end, the config revision
  and the decision promise live in memory only; `lockedAt` was already persisted and refreshed; one
  new string in an open union.

## Assumptions

### Facts (verified against `origin/dev` @ `c543c18d`; re-checked after each audit)

1. `dispatchOperation` (`execution/service.ts:665-732`) forwards `authorizedFence` only to
   `register_token` (`:681`); `send_transaction` (`:687`) calls `executeSendTransaction(op, origin,
   task, hooks)` which captures a fresh fence (`:847`); `aztec_sendTx` (`:726-732`) captures fresh.
2. `silentInteraction` (`dapp-interaction/service.ts:457-520`) checks `getActiveProfile()?.id !==
   payload.session.profileId` non-atomically (`:458-461`), calls `refreshSession()` (`:475`), moves
   the record to `pending` (`:502`), and calls `executeOperations(operations, origin, undefined,
   hooks)` (`:512`) with **no** fence. `executeOperations`' trailing `authorizedFence` parameter is
   documented as "TRUSTED-INTERNAL … NOT structurally unreachable over the wire (RPC dispatch
   forwards extra positional …)" (`execution/service.ts:608-613`) — optional, and consumed only by
   `register_token`.
3. `executeRegisterToken` (`:788`) implements `authorizedFence ?? fresh capture` at `:804-812`.
4. The only downstream fence validation is `transaction/service.ts:182-185`: `assertCurrent(
   fence.profileId, fence.epoch)` + owner-row check. `ProfileDeletionState` has no identity check
   and its epoch bumps only in `beginDeletion`.
5. `executeAndResolve` (`dapp-interaction/service.ts:257-263`) captures the fence atomically and
   compares `profileId` to `payload.session.profileId`.
6. Same-phrase profiles share the master; the DEK is the only distinguishing secret
   (`ARCHITECTURE.md:156`); account addresses are frozen master-derived (`CLAUDE.md` § freeze).
7. Active-profile reads on send paths: `execution-lane.ts:131,175,220,415`;
   `tx-request-builder.ts:214,372`; `dapp-send-executor.ts:452,526,782`;
   `transfer-executor.ts:227,268,353`; `transfer-estimate-reuse.ts:176-179` (rejects reuse on
   drift and falls back to a fresh build under the *active* profile); `execution/service.ts:437,
   486,514,847`. Classification in `recon.md`. `TxRequestBuilder` has no fence parameter;
   `buildNoFrom` is called at `dapp-send-executor.ts:920` without one.
8. `executeTransfer` is RPC-exposed (`execution/spec.ts:28`, `service.ts:102`) and captures its
   fence at `:437`; `executeSendTransaction` is **not** RPC-exposed (`service.ts:100-111`,
   `client.ts:21-32`).
9. `proveAndSend` (`execution-coordinator.ts:290-307`) is a frozen sequence with `checkCancelled`
   at `:293`, `:298` (post-prove), `:303` (post-`submitting`); `await toTx()` and
   `markJournal(submitting)` sit between `:298` and `:303`; `sendTx` follows via `sendTxTask`.
   FSM: `proving → {submitting, failed, cancelled}`, `submitting → {succeeded, failed}`
   (`fsm.ts:46-47`). The existing coordinator test pins the `:303` check.
10. `OperationFilterSchema` accepts `{ profileId, isTerminal }` (`operation-journal/spec.ts:286-292`).
11. The store's tracker loads every op of the profile (`app.store.ts:220-240` `refreshInFlightOps`;
    the query is `:253`; no profile → rows cleared, `:222-227`); `hasInFlightSend` filters by
    viewed account + network (`utils/in-flight-send.ts:48-58`); `commitScopeChange` (`:207-215`)
    checks the cached value, refreshes once, re-checks, then runs a synchronous `commit`.
12. Every profile-bound PXE op takes a `NetworkInfo { profileId, chainId }` first argument
    (`pxe/client.ts:42-46,76`); the offscreen keeps runtimes warm across lock and switch (`:31-34`);
    a missing store-key provision rethrows the original error
    (`packages/aztec-runtime/src/pxe/client.ts:182-183`).
13. `SelectProfilePopup` is opened only from the lock screen's profile pill (`auth.vue:231`,
    `PopupManager.vue:325`); selecting assigns `appStore.profile` and the user then authenticates.
    Other `appStore.profile` writers: `app.vue:221,237`, `route-guard.ts:52`, `reset.vue:78`. This
    is UI routing, not a service precondition: `open` *replaces* the active session object directly
    (zeroizing the previous DEK, `session-manager.ts:296-298`) whichever screen drove it.
14. The header lock button calls `managers.profile.lockActiveProfile()` directly
    (`components/Header.vue:27`). The repo-standard confirm is `cacheStore.confirm` +
    `popupStore.open("confirm")` → `ConfirmPopup.vue`.
15. Journal reaper per-stage grace: `queued` 10 min, `pending` 2, `simulating` 10, `proving` 35,
    `submitting` 5 (`operation-journal/reaper.ts:74-83`); age is `now - op.updatedAt` (`:187`).
16. Session TTL: `isExpired = sessionTtl !== 0 && deriveLockedAt(session) <= now`
    (`session-manager.ts:665-667`); the proactive alarm `nulo:core:session:ttl` (`:78`) is created
    with `{ when: lockedAt }` (`:845`) and fires `onAlarmFired` (`:802-830`), which re-checks
    `lockedAt` inside `runExclusive` and calls `close()`; `getActive()` also closes lazily on expiry
    **off the facade lock** (`:194-208`); `refresh()` (`:419-445`) **awaits `getActive()` first**
    (`:424`), sets `lockedAt = since + sessionTtl`, and persists + re-arms under `artifactLock` with
    an identity guard.
17. `EventHandler.invoke` is synchronous and swallowing
    (`packages/wallet-core/src/utils/event-handler.ts:47`); the facade's `onChange` fires inside
    `runExclusive` on the open path (`session-manager.ts:299`); `runExclusive` is `this.lock.withLock`
    on a non-reentrant `Lock` (`profile/service.ts:294-295`).
18. `ExecutionService` already subscribes to `onActiveProfileChanged` (`execution/service.ts:401`).
19. `journalTerminalDisplay` (`utils/journal-state.ts:97-122`) maps `cancelled` → "Cancelled" gray,
    interrupted kinds → amber, else `failedSubtitleFor(kind)` red (`:259-271`).
20. `mark-failed-unless-cancelled.ts` is synchronous by design and special-cases
    `DuplicateInitializationError` by kind; `classifyOperationCatch` (`rpc-cancel.ts`) has a code
    channel whose negative control (`rpc-cancel.test.ts:84-92`, N-15) exists because detail-bearing
    classes lose details through the message-only channel.
21. `SESSION_INVALID_ERROR` is `4900` (`error-envelope.ts:194-198`); `wireProfileSwitchTeardown`
    terminates the old profile's sessions on a truthy switch; lock tears nothing down.
22. `execution/service.composition.test.ts:91-212` builds the real service graph; its profile fake
    answers `p1` unconditionally; `makeControllableGate()` (`:58-76`) parks at prove; `getNetwork`
    is a controllable `vi.fn`; the existing prove-gate case reaches the gate via the **transfer
    reuse fast path** (`:159-198`) — a dApp send reaching prove needs a completed `buildStandard`
    (COMPOSITION-TESTS D3/D6).
23. E2E: `fixtures/proof-gate.ts` parks after `journal(proving)` before `pxe.proveTx`;
    `session-profileSwitch.test.ts` creates a second profile inline; `cancel-mid-prove.test.ts`
    asserts a typed error end-to-end; `tx-awaiting-card[data-stage]` is typed over `JobStage`;
    proof-gate tests run as `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent <file>` with
    the `@requires-proverless` marker (`.claude/skills/e2e-testing/SKILL.md:44,69,437`).
24. `bun run typecheck` is `vue-tsc --project apps/extension` only; `typecheck:all` covers the
    packages.
25. `execution/README.md` documents the zero-slot transfer quirk and slot-before-claim; no fence.
26. The lane's `cancelJob` (`execution-lane.ts:163-200`) authorizes by active profile ==
    `record.profileId`, transitions the journal first, then aborts the controller;
    `transitionIfStage` is the CAS primitive (`operation-journal/service.ts:528`).
27. `SessionManager` keeps `sessionGeneration` (`:137`), incremented as the **last** act of
    `open`'s artifact section (`:336`, "COMMIT POINT") and re-checked by a stale `close` (`:364,
    :384`). No per-session id exists on `ActiveSession`.
28. `close()` (`session-manager.ts:356-398`) checks identity synchronously, zeroizes the DEK, sets
    `activeSession = undefined` and fires `onChange(undefined)` **before its first `await`**; the
    persisted row delete and alarm clear follow under `artifactLock` (which `close` acquires itself).
29. The lane heartbeats every journal id waiting on the mutex (`executionWaiters`) every 30 s with
    **no** ceiling; only pre-claim `queuedWaiters` have the 90-minute `MAX_QUEUED_WAIT_HEARTBEAT_MS`
    lease (`execution-lane.ts:74-100,350-372`). Capacity caps are 8 per origin, 32 per lane (`:98-99`).
30. `SelectProfilePopup.handleSelectProfile` (`:42-61`) routes through `commitScopeChange`, whose
    first statement returns on the *cached* `hasInFlightSend` before the refresh (Fact 11).
31. The silent session restore emits no profile-changed event (`profile/service.ts:462-466`:
    "No emit on restore — subscribers pull via `getActiveProfile()` when they mount").
32. `buildStandard` callers outside the two executors: `fee/fee-juice-strategy.ts:27,39`,
    `fee/fpc-strategy.ts:130,155,199,227,248`, `fee/embedded-strategy.ts:35`,
    `fee/fee-juice-with-claim-strategy.ts:28`, `view-executor.ts:67,308,394`,
    `execution/service.ts:336` (`buildForDiscovery`). Each passes `(op, feeMethod, task?)`.
    `ViewExecutor` serves dApp simulations as well as popup estimates.
33. `DappSendExecutor.runInSlot` (`:199-262`) awaits `acquireSlot` at `:224` **before** the
    `try` whose `catch` calls `markFailedUnlessCancelled`; a throw from `acquireSlot` that the lane
    does not terminalize itself therefore terminalizes nothing.
34. The e2e proof gate resolves on its own after `SAFETY_TIMEOUT_MS = 20_000`
    (`src/e2e/chrome-storage-proof-gate.ts:19`); the security settings page edits the TTL in whole
    minutes (`popup/pages/settings/security/index.vue:33`); the config value itself is milliseconds.
35. `open` publishes the session inside the artifact section: `this.activeSession = {…}` at
    `session-manager.ts:298`, then `onChange(profile)` (`:299`), then the persisted write; on a
    failed write whose row cannot be confirmed gone, it rolls the in-memory session back
    (`:321-325`, `onChange(undefined)`) — otherwise it keeps a memory-only degraded success.
    `restore` assigns `this.activeSession = {…}` at `:627` with no event.
36. The controller map is written from three files: `execution-lane.ts:261` (`acquireSlot`, after
    the awaited `resolveExecutionMutexKey` at `:248`, and only when `queuedJournalId` is present),
    `claim-helper.ts:181,197,272` (`:101` is a delete), and `transfer-executor.ts:253` via
    `lane.registerController` (after `createTransferJournal`).
37. The facade `Lock` force-releases a holder after `MAX_HOLD_MS = 5 * 60_000`
    (`packages/wallet-core/src/utils/lock.ts:4`).
38. `acquireSlot` already terminalizes the `queuedJournalId` record on a capacity rejection
    (`execution-lane.ts:283-292`) and surfaces `TooManyPendingError`. The transfer path never takes
    a lane slot (no `acquireSlot` call in `transfer-executor.ts`); it creates its journal record
    first (`:104`), and when creation fails it logs and **continues without a record or a
    controller** (`:248-253`).
39. `sendTxTask` (`execution-coordinator.ts:256-270`) creates the task step synchronously
    (`startSubtask`/`startNewTask`) and then `await node.sendTx(tx)` inside a `try`; there is no
    await between the step creation and the invocation.
40. `applyTtlChange` (`session-manager.ts:746-786`) runs under the facade `runExclusive` **without
    the artifact lock**: it writes `session.lockedAt`, persists the row, clears and re-arms the
    alarm (`:775-783`), or closes immediately when the recomputed deadline is already past (`:771-776`).
41. `deriveLockedAt(session)` is `session.lockedAt ?? session.since + this.sessionTtl`
    (`session-manager.ts:675-677`); restored records may lack `lockedAt`.
42. `OperationJournalService.transitionOperation` holds a global `transitionLock` across load,
    validate **and** the storage write (`operation-journal/service.ts:338-341`).
43. The popup refreshes the session on every route change while logged in (`popup/app.vue:371-379`);
    submitting a Send navigates away (`leaveSend()`, `popup/pages/send.vue:384`), so a Send flow
    refreshes at least twice.
44. `revokeAuthwits` (`auth-registry/service.ts:251-270`) awaits `getNetwork` and the authwit rows,
    and `setRegistryEnabled` (`:324-334`) awaits `getNetwork`, before calling
    `executeSendTransaction` without a fence.
45. `clearBearer` (`session-manager.ts:465-492`) persists the whole live session row under the
    facade `runExclusive` only (`:485`), and `ValueStorage.set` is `storage.set({ [root]:
    JSON.stringify(value) })` — serialized at call time (`packages/wallet-core/src/storage/value-storage.ts:37-38`).
46. E2E profile creation waits up to 90 s (`tests/e2e/network/session-profileSwitch.test.ts:49`).
47. `gh stack init` adopts existing branches automatically and takes `--base <trunk>`; there is no
    `--adopt` flag (`gh stack init --help`).

### Inferences (unverified — attack these)

1. **An in-flight op for A never touches B's PXE store after a switch** — its `NetworkInfo`
   carries A's `profileId` and A's runtime stays warm; a re-provision for a locked A rethrows
   (Fact 12) — fail-closed, though not an immediate termination (proving has its own timeout).
2. **The synchronous check binds authorization to the invocation.** `isFenceLive` reads two
   in-memory fields; `close()` clears them before any await (Fact 28); placed after the step
   creation inside `sendTxTask`'s `try` there is no await between it and `node.sendTx(tx)`
   (Fact 39). A session end can only land after the call is issued; the transport may still be
   transmitting.
3. **The dApp receives the cancellation error on a plain lock** (its channel survives; teardown
   runs only on a truthy switch, Fact 21) and `SESSION_ENDED` if a checkpoint fired instead.
4. **`abandonDeadSessions` reuses `cancelJob`'s journal-first body minus the principal check**
   (`transitionIfStage` to `cancelled`, then abort), per record, errors logged; an illegal
   transition (`submitting`) is skipped without aborting the controller.
5. **The "absent ⇒ capture now" contract is safe only for callers with no awaited preparation.**
   The auth-registry entries are the only UI callers of `executeSendTransaction` (Fact 8), and both
   await before calling (Fact 44) — so both capture at entry instead. No other fence-less caller
   remains after Phase 1; the optional parameter is kept for symmetry with `executeRegisterToken`
   (Fact 3), and a unit pin asserts that every production caller passes one.
6. **The composition harness can express a session end and the races** with a session fake
   exposing `setActive(id | undefined)` (new serial per call; drives `getActiveProfile`,
   `captureExecutionFence`, `assertFence`, `isFenceLive`, `peekLiveSerial`) and a separate
   `fireChanged()`, plus a controllable journal *storage* write and a controllable `sendTx`.
   Prove-gate cases ride the **transfer** reuse fast path (Fact 22); dApp cases park at
   `getNetwork`, a lookup that runs *before* the rejecting assert. The cancel-vs-`submitting` race
   parks the **cancellation's** storage write so the `submitting` transition queues behind it on
   the journal's transition lock (Fact 42); parking the `submitting` write instead would commit it
   first and make the cancel illegal.
7. **`expireOrDefer` is safe off-lock** given: one decision promise per session object; a
   snapshot of the effective deadline, the raw `lockedAt` and `configRev` before the predicate;
   every live-row write — deferral, `refresh()`, `applyTtlChange`, `clearBearer` — through
   `commitSession`, which checks identity for all of them and the deferral's expected
   `lockedAt`/`configRev` *inside* the artifact lock, mutates the current object and persists it;
   the same re-check immediately before any `close()`, which runs outside the artifact lock; and
   `refresh()` joining the decision via `getActive()` (Fact 16). Two writers can no longer persist
   two snapshots of one object: they serialize on the artifact lock; a stale deferral stands down,
   a must-apply writer applies to whatever the row is by then. `SessionManager` has no other
   writer of a live session's row (Facts 16, 40, 45 enumerate `refresh`, `applyTtlChange`,
   `clearBearer`; `open` persists inside its artifact section right after publication, Fact 35;
   `restore` publishes the loaded row and schedules its alarm without writing the row or taking
   the artifact lock, `:627-631`; `close` deletes) — a Phase 4 grep pin asserts `this.session.set(`
   appears only inside `commitSession`, `open` and the locked branch of `clearBearer`.
8. **Late-binding the predicate avoids an init cycle**: `ExecutionService.init` already resolves
   `ProfileService` (`service.ts:191`), so it can call `profileService.setExpiryDeferral(pred)`
   there; `ProfileService` never imports the execution layer.
9. **Chrome may delay or refuse a sub-30 s alarm** (unpacked extensions are exempt from the
   minimum but delivery is best-effort). The e2e therefore reads the **persisted deadline** after
   the Send flow's last navigation (`readSessionRow`, Fact 43 makes any earlier `t0` meaningless),
   drives the lazy path explicitly through a **non-refreshing** RPC (`peekSession`), and proves
   deferral by observing `lockedAt` advance while `since` does not — not by elapsed time; the
   post-send lock is asserted within 30 s.
10. **`ViewExecutor` capturing a fence at entry** is harmless for both origins: estimates and
    simulations are not fenced work; the builder's assert then simply confirms the live session,
    and a dApp simulation already passed the interaction layer's session compare.
11. **Unregistered execution is bounded by the fence checks.** Work without a journal record
    (Fact 38) or before its record exists cannot be swept, but every such path reaches
    `assertFence` at build and `isFenceLive` before broadcast; its wait or proof ends at the first
    failed check, and it never appears on screen because there is no record to render.

### Asks

- **A1 — the deferral budget.** **Resolved 2026-09-16 (D10): `min(sessionTtl, 10 min)`**, as
  recommended below. How much may approved sends push a session's inactivity expiry
  out, in total, over the session's life? Recommended **`min(sessionTtl, 10 min)`**, fixed when the
  session first defers: a user with a 2-minute TTL gets at most 2 more minutes, a user with a
  30-minute TTL at most 10. Alternatives: flat 10 min; 5 min. The plan proceeds on the
  recommendation; the expression is one line. It is a convenience ceiling, not a proof-duration
  guarantee. (Whether *dApp activity* should refresh the TTL at all is a separate policy question
  this plan does not open — §Scope Out.)

## Phases

### Phase 0 — the error, the serial, the two checks ✓

`SessionEndedError` (messaging package, detail-free), `session_ended` kind + mirror, envelope
branch (4900 `SESSION_ENDED`), `ExecutionFence.session`, `ActiveSession.serial` allocated inside
`open`'s artifact section (in the object at `:298`) and at `restore` (`:627`), `peekLiveSerial`,
`captureExecutionFence` includes the serial, `ProfileService.assertFence(fence)` (reads the manager
directly under `runExclusive`) and `isFenceLive(fence)`. Tests: error payload round-trip and
prototype fix-up; the class reconstructs losslessly through the message-only channel; envelope
maps the class and only the class; kinds mirror compiles; `assertFence` — locked → `SessionEndedError`;
another profile → `SessionEndedError`; same profile re-unlocked (new serial) → `SessionEndedError`;
deletion epoch advanced → the existing epoch error; same session + current epoch → resolves;
`isFenceLive` mirrors the first three synchronously; **serial publication**: a successful `open`, a
memory-only degraded success, and a rolled-back publication each leave `peekLiveSerial()` and a
subsequent capture consistent (the rolled-back serial is never observable by a facade-locked
capture and is never reused); `restore` yields a fresh serial.

**Validation gate**
- `cd packages/extension-messaging && bun --bun vitest run` · `cd packages/wallet-core && bun --bun vitest run src/jobs`
- `cd apps/extension && bun --bun vitest run src/wallet/services/wallet-sdk/error-envelope.test.ts src/wallet/services/profile`
- `bun run typecheck:all && bun run lint` (worktree root)
- Pass: all exit 0. Layers: typecheck · lint · unit

### Phase 1 — capture on both dApp entries, thread everywhere, assert at every read, check in the broadcast tick ✓

`silentInteraction` captures atomically and compares (mirrors `executeAndResolve:257-263`) and
passes the fence; `executeOperations` throws on DAPP origin without one; dispatch arms forward it;
`executeSendTransaction(…, fence?)`; lane `registerInFlight` as the synchronous single
controller-map writer reporting liveness, used by `acquireSlot` **before its first await**, by
`claim-helper.ts`'s three sites and by the transfer path — a `live: false` result makes the caller
terminalize `failed/session_ended` and throw; `acquireSlot(…, fence)` asserts, terminalizes
`queuedJournalId` on refusal (the capacity-rejection exit, Fact 38), then keys on the fence;
builder takes a required fence (existing fee-method/task arguments preserved); the four fee
strategies pass the ctx fence; `buildForDiscovery` and `ViewExecutor` pass one; `dapp-send-executor`
threads it (reused branch, NO_FROM, `:526`); both `tryConsume(…, fence)` (operation + transfer
reuse) throw on drift with no fallback; `transfer-executor` threads it into journal, reuse,
`buildFresh`, its ctx; `assertAuthorization` in `ProveAndSendContext` after the post-prove
`checkCancelled` (`:298`); `assertLive()` inside `sendTxTask`'s `try`, the statement before
`node.sendTx`; the `:303` `checkCancelled` untouched; both catch arms classify `session_ended`;
`classifyOperationCatch` code channel. Comments state the invariant, never the plan.

Unit pins (the session fake bumps its serial or clears, plus a same-session negative each):
- `executeOperations`: DAPP origin + no fence → throws before any dispatch; UI origin + no fence
  → proceeds.
- `silentInteraction`: a session end between the compare and the dispatch → `SessionEndedError`,
  never a fresh capture under the new session.
- lane: `registerInFlight` under a dead serial registers nothing and reports `live: false`;
  `acquireSlot` registers before resolving the mutex key; a dead serial or a failed assert
  terminalizes the given `queuedJournalId` as `failed/session_ended` before throwing and never
  calls `acquire`; mutex key is `${fence.profileId}:${chainId}` even when the active profile
  differs; create-time pin extended.
- claim helper: each of its three registration sites goes through `registerInFlight` with the
  fence serial (argument pins); a `live: false` result terminalizes and throws.
- builder: `buildStandard`/`buildNoFrom` call `getAccountContract` with `fence.profileId`, never
  the active id; drift → throws before any PXE call; every strategy passes the ctx fence (one
  strategy test each, argument pin).
- executor: reused branch resolves from the fence; both `tryConsume` variants throw on drift and
  the fresh build is **not** attempted; NO_FROM path asserts.
- transfer: journal `profileId` = fence's; reuse compare vs fence; inline catch → `session_ended`;
  **a failed journal creation still executes without a controller** (the existing behaviour, pinned
  as the stated limitation) and still fails at the build assert after a session end.
- coordinator: `assertAuthorization` rejecting after prove → no `toTx`, journal `failed`;
  **a cancel that commits before the `submitting` write** → the `:303` check throws
  `JobCancelledSentinel`, `sendTx` not called (the existing pin, re-asserted with the new ctx);
  `assertLive` throwing inside `sendTxTask` → `node.sendTx` **not** called, record
  `failed/session_ended` (from `submitting`); a session end **while `node.sendTx` is pending** →
  the send completes and the record proceeds (the point of no return); the frozen-sequence pins
  still green.
- `mark-failed-unless-cancelled`: `SessionEndedError → kind "session_ended"`, still synchronous.
- `rpc-cancel`: rides the code channel; N-15 negative control still holds.
- `executeSendTransaction` without a fence captures one (the contract), and a source pin asserts
  no production caller relies on it.
- auth registry: `revokeAuthwits` and `setRegistryEnabled` capture before their first other
  await and forward the fence; **parked-read regression**: park the authwit read, end the session,
  re-unlock the same profile (new serial), release → `SessionEndedError`, `executeSendTransaction`
  never called with the new serial.

**Validation gate**
- `cd apps/extension && bun --bun vitest run src/wallet/services/execution src/wallet/services/dapp-interaction src/wallet/services/auth-registry`
- `bun run typecheck:all && bun run lint`
- Pass: all exit 0; no existing pin edited except those whose *signatures* changed
  (`buildStandard`/`buildNoFrom`, both `tryConsume`, `acquireSlot`, `registerController` →
  `registerInFlight`), listed in the lessons file. Layers: typecheck · lint · unit

### Phase 2 — composition: the real graph, a real session end, the races

Harness: the session fake gains `setActive(id | undefined)` (new serial per call; drives
`getActiveProfile`, `captureExecutionFence`, `assertFence`, `isFenceLive`, `peekLiveSerial`), a
separate `fireChanged()` (so checkpoint cases run without the sweep), a controllable journal
**storage** write (park a specific record's persist) and a controllable `sendTx`. Cases:
1. **dApp, parked at `getNetwork`** → `setActive("p2")` → release: `SessionEndedError`;
   journal `failed`, `error.kind === "session_ended"`, `profileId === "p1"`; `proveTx` never called.
2. **dApp, parked at `getNetwork`** → `setActive(undefined)` (lock) → release: same shape.
3. **transfer, parked at prove** (proof gate, reuse fast path) → `setActive("p2")` → release:
   `proveTx` called, `sendTx` never; journal `failed/session_ended` under `p1`.
4. **transfer, parked at prove → lock** → release: as 3.
5. **transfer, parked at prove → `setActive("p1")` again** (re-unlock, new serial) → release: as 3
   — the case an identity compare cannot see.
6. **sibling owns the address**: the account fake resolves the same address under `p2`; case 3
   still fails with `SessionEndedError` (the assert, not a lookup miss, stops it).
7. **direct UI entry** (`executeSendTransaction` with no fence): captures, then behaves as case 1.
8. **reused estimate** (operation cache) stashed under `p1`, consumed after `setActive("p2")`:
   `SessionEndedError`, no fresh build (`getAccountContract` not called). Same for the transfer cache.
9. **silent path**: record at `pending`, `acquireSlot` refuses → the record is
   `failed/session_ended` (not stranded), nothing acquired.
10. **cancel vs `submitting`**: `cancelJob` issued while the op is between `toTx` and
    `journal(submitting)`, with the **cancellation's** storage write parked; the `submitting`
    transition queues behind it on the transition lock (Fact 42); release → the cancel commits,
    the `submitting` transition is refused by the FSM, `:303` throws, `sendTx` never called.
11. **session end while `sendTx` is pending**: `sendTx` parked; `setActive(undefined)` → release:
    the send completes, record `succeeded` — the point of no return, pinned.
Every case asserts against the real journal and the fake PXE's call log.

**Validation gate**
- `cd apps/extension && bun --bun vitest run src/wallet/services/execution/service.composition.test.ts src/wallet/services/execution`
- `bun run typecheck:all && bun run lint`
- Pass: all exit 0; COMPOSITION-TESTS D1–D6 respected — **D3** (no `TxExecutionRequest` building or
  account-contract derivation in a fake) and **D6** (bb-free); any case that would need them is
  moved to e2e, not faked. Layers: typecheck · lint · composition

### Phase 3 — the sweep

`abandonDeadSessions()` walks the lane's registry: per record, read `peekLiveSerial()` now; serial
≠ live (or no live) and stage pre-`submitting` → `transitionIfStage(…, cancelled)` then abort;
per-record errors logged; `submitting` skipped. The existing subscriber (`service.ts:401`)
schedules it on every event (truthy or `undefined`), never awaiting in the handler. Composition
cases (with `fireChanged()`): parked at prove → `setActive("p2") + fireChanged()` → the record is
`cancelled` **before** the gate is released, `sendTx` never called; same on lock; a record at
`submitting` is untouched; **stale-argument race**: lock → sweep scheduled → `setActive("p1")`
(new session) and a new record registered → the sweep runs: the old record is cancelled, the new
one untouched; **registration after the sweep**: a `registerInFlight` after the session ended
reports `live: false`, the caller terminalizes `failed/session_ended`, nothing runs; a journal
failure during the sweep does not reject the unlock; the handler returns synchronously.

**Validation gate**
- `cd apps/extension && bun --bun vitest run src/wallet/services/execution`
- `bun run typecheck:all && bun run lint`
- Pass: all exit 0. Layers: typecheck · lint · unit · composition

### Phase 4 — auto-lock deferral

`commitSession(session, { mutate, expect? })` as the single artifact-locked live-row writer:
in-lock identity check for every caller, raw-`lockedAt` / `configRev` expectation for the deferral
only; `refresh()`, `applyTtlChange` and `clearBearer`'s live branch refactored onto it as
must-apply writers (behaviour unchanged; `configRev++` on every TTL change); a source pin that
`this.session.set(` appears only in `commitSession`, `open` and `clearBearer`'s locked
branch;
`expireOrDefer(session)` called from `onAlarmFired` (inside its `runExclusive`, after the
staleness gate) **and** from the lazy branch of `getActive()`; one decision promise per session
(`session.expiryDecision`); snapshot of `deriveLockedAt(session)`, raw `lockedAt`, `configRev`
before the predicate; `deferBudgetEnd ??= effectiveDeadline + min(sessionTtl, 10 * 60_000)` (Ask
A1); `next = min(now + step, deferBudgetEnd)`, `step = min(60_000, sessionTtl)`; predicate true
and `now < deferBudgetEnd` → `commitSession`; otherwise re-check identity / raw `lockedAt` /
`configRev` and `close(session)` **outside** the artifact lock; predicate throwing → same close
path; `refresh()` leaves `deferBudgetEnd` alone. `setExpiryDeferral(pred)` on the manager,
forwarded by `ProfileService`, called from `ExecutionService.init` with `hasApprovedSendsInFlight`
(journal: send kinds at `pending|simulating|proving`). Tests (fake alarms, fake clock,
controllable predicate and storage): alarm with predicate true → not closed, `lockedAt` moved by
`step`, alarm re-armed; predicate then false → closes; predicate throwing → closes; **lazy path**:
`getActive()` after `lockedAt` with predicate true → returns the session and extends;
**coalescing**: alarm + two lazy callers + a `refresh()` during one pending predicate → one
predicate call, one write, `refresh()` joins and then applies its own deadline; **stale
decisions**: `applyTtlChange` (non-zero → non-zero) during the predicate → the decision's CAS
stands down and the TTL change's deadline survives; `applyTtlChange(0)` during the predicate → no
write, no close by the decision; a second decision during the predicate → one write; a
`commitSession` whose `expect` no longer matches → no write, no alarm swap; **`clearBearer` vs
deferral, contention before mutation** (both lock-acquisition orders, driven with a controllable
artifact lock; under artifact serialization storage completion follows acquisition order): the
persisted row ends with the extended deadline **and** no bearer in both orders — deferral-first
shows `clearBearer` still removing the bearer; `clearBearer`-first shows the deferral still
committing (bearer removal changes neither `lockedAt` nor `configRev`, so its expectation
matches); **`refresh()` vs deferral** and **`applyTtlChange` vs deferral** in both lock orders:
the must-apply writer's deadline is what persists and a deferral whose snapshot predates it stands
down; `clearBearer` vs `close()`: no resurrected row; **budget**: repeated
deferrals clamp to `deferBudgetEnd`, then close; `refresh()` mid-session does **not** move
`deferBudgetEnd`; the budget is computed from the TTL in force at first deferral (a session that
starts with TTL 0 and is later given a TTL gets a non-zero budget); **restored session without
`lockedAt`**: the budget anchors on `since + ttl`, no `NaN`; stale alarm still ignored;
`sessionTtl === 0` never arms; a `queued`-only journal does not defer (predicate unit test);
`restore()` behaviour unchanged (expired-at-boot closes).

**Validation gate**
- `cd apps/extension && bun --bun vitest run src/wallet/services/profile src/wallet/services/execution/service.test.ts`
- `bun run typecheck:all && bun run lint`
- Pass: all exit 0. Layers: typecheck · lint · unit

### Phase 5 — the lock dialog and the card copy

`approvedSendsInFlight(ops, profileId)` in `utils/in-flight-send.ts` + the store computed;
`Header.vue`: `await refreshInFlight()`, then count 0 → `lockActiveProfile()` as today; else
`cacheStore.confirm` with the §UI impact copy (singular/plural), red confirm,
`pre_title: "Running transactions"`, callback → `lockActiveProfile()`;
`popup/components/popups/ConfirmPopup.vue`: the pre-title span reads `cacheStore.confirm.pre_title`
when set and falls back to today's colour-derived label otherwise (no other caller sets it, so no
other dialog changes); `journal-state.ts`: `session_ended` → "Stopped — wallet was locked". Tests:
predicate (account-blind; `queued` and `submitting` excluded; kinds); store computed over seeded
records; `Header` — refresh awaited before the decision, instant lock at 0, dialog copy at 1 and
N (pre-title included), confirm locks, cancel does nothing; `ConfirmPopup` — override shown when
set, "Irreversible"/"Action required" when absent; `journal-state` subtitle.

**Validation gate**
- `cd apps/extension && bun --bun vitest run src/utils src/stores src/components/Header.test.ts`
- `bun run typecheck:all && bun run lint`
- Pass: all exit 0; copy matches §UI impact verbatim. Layers: typecheck · lint · unit · component

### Phase 6 — end to end, live

Helpers: `createAndActivateProfile(page, name, password)` extracted from `session-profileSwitch`;
`setSessionTtlMs(page, ms)` writes the config value through the config service RPC (the settings
page only offers minutes, Fact 34) — called **immediately after a fresh unlock or a popup action**,
because `applyTtlChange` recomputes from the existing `since` and closes at once if the result is
already past (Fact 40); `peekSession(page)` issues a `getActiveProfile` RPC from the page's service
client without navigating (navigation refreshes the session, Fact 43). Three network tests,
`@requires-proverless`, `retry: 0`, `PerTest` fixtures, each with a header comment stating the
deliberate departure from `account-switch-live-session` (an account switch lets the send finish; a
session end does not):
1. `lock-cancels-dapp-send` — dApp `sendTx` held at `proving`; click `header-lock`: the dialog
   (`confirm-*` testids) shows the singular copy; confirm; lock screen; release the gate; unlock the
   same profile: the record is `cancelled`, no `tx-card` hash; the dApp's pending call resolved with
   an error (`waitForPgResult` → `status: "error"`).
2. `auto-lock-defers-while-proving` — fresh unlock; `setSessionTtlMs(8_000)`; popup Send held at
   `proving` (the Send flow itself refreshes on entry and on `leaveSend`, Fact 43); **after** the
   post-submit navigation, `row0 = readSessionRow()` (its `lockedAt` is the real deadline; `tGate`
   = the moment the awaiting card shows `proving`); wait until `row0.lockedAt + 1 s`, then
   `peekSession` → still a profile, awaiting card present, and `row1 = readSessionRow()` shows
   `lockedAt > row0.lockedAt` with `since` unchanged — deferral, not activity; release the gate
   before `tGate + 18 s` (Fact 34); the send `succeeded`; `peekSession` polled every 2 s →
   `undefined` and the lock screen within 30 s of the send finishing (Inference 9). Per-test
   timeout 90 s. If `row0.lockedAt + 1 s` would exceed `tGate + 18 s`, the test fails loudly on
   its own precondition rather than passing vacuously.
3. `profile-switch-sweeps-transfer` — **before** the send: create profile B, then unlock A again
   (creation is bounded by 90 s, Fact 46 — it cannot run while the 20 s gate is held); popup Send
   held at `proving`; `header-lock` → confirm → `auth-profile` → select B → unlock B; release the
   gate; back to A: `cancelled`, no hash; nothing under B.

**Validation gate**
- `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/lock-cancels-dapp-send.test.ts` (and the other two, one at a time)
- Pass: all three green at retry 0, run solo; flake vs break per the e2e README. Layers: e2e (live sandbox)

### Phase 7 — close out

`execution/README.md` "Authorization fence" section (what it binds, the serial, where it is
asserted, the synchronous broadcast check after the cancellation check, the registry and its
limits, the two entry contracts, the sweep); `ARCHITECTURE.md` one paragraph under the session
model (a session end cancels approved work; auto-lock defers within a per-session budget; dApp
activity refreshes the TTL as before). Then the sweeps.

**Validation gate**
- `bun run test:e2e` · `bun run audit:vue`
- Pass: both exit 0. Layers: typecheck · lint · unit · build · smoke

## Competing outline (for the audits)

**B — epoch + veto.** Add a *switch epoch* to `ProfileDeletionState` (bump on every session
change), assert it only at two points (`transaction/service.ts` and the post-prove checkpoint), and
make `unlockProfile(B)` **refuse** while A has non-terminal sends. Verdict after four audits: the
epoch idea was right and the draft was wrong to reject it — it is now the session serial. The
sparse checkpoints and the veto stay rejected: between two asserts the mutex key, account contract
and both estimate reuses still resolve under the live session (safety by construction *is* removing
the re-reads), and a veto would block *unlock* (the switcher lives on the lock screen).

## Decision ledger

### Owner decisions (2026-09-16)

| # | Decision | Chosen |
|---|---|---|
| D1 | Validation layers | composition per read site · unit + component · network e2e · smoke + `audit:vue` |
| D2 | Dialog scope (rev 1) | profile switch only; lock silent — **superseded by D5/D6** |
| D3 | The wallet's own Send freeze | untouched in this plan |
| D4 | Design direction (from the parked plan's Ask 3) | prerequisite plan binding execution to the fence; not split-by-axis, not a one-site fix |
| D5 | Lock semantics | **Lock cancels too** — a session end is a session end |
| D6 | Where consent lives | **Warn at the lock button, never block**; the lock-screen selector needs no dialog |
| D7 | Inactivity auto-lock while sends run | **Defer until the approved sends finish** — within a per-session budget (Ask A1) |
| D8 | Plan approval (rev 8, after the real-component renders) | **"Approve rev 8"** — implement phases 0–7 as the two-arc stack |
| D9 | UI copy sign-off (§UI impact) | **"Sign off; red button, add pre-title override"** — the dialog copy, the red "Lock anyway" and the "Stopped — wallet was locked" subtitle as rendered; `ConfirmPopup` gains an optional pre-title so this dialog does not read "Irreversible"; the wording "Running transactions" is the example named in the chosen option, swap it before Phase 5 lands if you want another |
| D10 | Ask A1 — the deferral budget | **`min(sessionTtl, 10 min)`** |

**Owner sign-off, verbatim (2026-09-16, for the PR body).** Asked "Approve plan rev 8
(profile-fenced-execution) for implementation as written?" → **"Approve rev 8"**. Asked "UI copy
sign-off: dialog title "Lock wallet?", body "1 transaction is still running. Locking cancels it." /
"{N} transactions are still running. Locking cancels them.", red confirm "Lock anyway", Cancel
default; card subtitle "Stopped — wallet was locked". And the pre-title the red button triggers?"
→ **"Sign off; red button, add pre-title override"** (option text: "Same copy, but ConfirmPopup
gains an optional pre-title so this dialog can say something accurate (e.g. "Running
transactions"). Small Phase 5 addition."). Asked "Ask A1: how much extra grace may one unlocked
session take, in total, before the inactivity auto-lock fires anyway?" → **"min(TTL, 10 min)"**.
The owner had first replied "looks good" to the ELI5's real-component renders; the three answers
pin that to the surfaces.

### Round 1 — codex (GPT-6 Astra, `high`) → **no verdict: account quota** (rev 1; see `lessons/planning.md`)

### Round 1 — fable (Claude Opus 5, `Plan`) → **conditional approve** (on rev 1)

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | CRITICAL — `silentInteraction` is a second dApp send entry with no fence and a non-atomic id check | yes | **Adopted** (Fact 2, Phase 1; DAPP-origin requirement on `executeOperations`) |
| 2 | HIGH — a profile-wide count including `queued` is dApp-influenceable | yes | **Adopted**: `approvedSendsInFlight` excludes `queued` |
| 3 | HIGH — the switcher is the lock-screen selector; a dialog there fires pre-authentication | yes | **Adopted, changed the design** (D5–D7) |
| 4 | HIGH — count-0-yet-`hasInFlightSend` refusal after the dialog | yes | **Partly moot**: the dialog no longer precedes `commitScopeChange`; the stale-tracker residual is a stated limitation (codex r2 #7) |
| 5 | MEDIUM — the post-prove blind window; a new `await` in a frozen sequence | yes | **Superseded**: the window is closed by the synchronous `assertLive` (codex r2 #2) |
| 6 | MEDIUM — a two-id error on the message-only channel loses details | yes | **Adopted**: detail-free error |
| 7 | Facts 1, 2, 8, 10 line numbers | yes | **Fixed** |
| 8 | Inference 5 hid an Ask (optional fence on a dApp-reachable entry) | yes | **Resolved by #1** |
| 9 | Inference 2 understates A→B→A | yes | **Superseded**: the serial makes A→B→A a hard failure (codex r2 #1) |
| 10 | Reuse the existing `onActiveProfileChanged` subscriber | yes | **Adopted** |
| 11 | `typecheck:all` on the Phase 0 gate | yes | **Adopted** on every gate |
| 12 | Composition prove-gate cases need `buildStandard` (D3/D6) | yes | **Adopted**: prove-gate cases on the transfer path |
| 13 | Don't widen the RPC-exposed `executeTransfer` | yes | **Adopted** |
| 14 | Arc 1 is not UI-free (4900 envelope) | — | **Adopted**: "no popup UI" |

### Round 2 — codex (GPT-6 Astra, `high`) → **reject** (on rev 2; transcript in `audit-codex.md`)

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | CRITICAL — profile identity is not session identity: A→B→A and A→lock→A pass an identity compare; an async profile-wide sweep misses late records and can cancel the *new* session's work; the silent restore emits no event | yes (Fact 31; sweep design) | **Adopted**: `ExecutionFence.session` serial; `assertFence` compares serials; the sweep keys on serials tracked by the lane |
| 2 | CRITICAL — the post-prove "blind window" is a defect: `toTx` + `journal(submitting)` are awaited after the assert; a lock there still broadcasts | yes (Fact 9) | **Adopted**: synchronous `isFenceLive` in the same tick as `node.sendTx`; `submitting → failed` on refusal |
| 3 | HIGH — alarm-only deferral loses ordinary races: `getActive()` closes lazily off the lock; `refresh()` calls `getActive()` first and uses the configured TTL | yes (Fact 16) | **Adopted**: one `expireOrDefer` on both paths; `min(60 s, ttl)`; writer unified in r4 |
| 4 | HIGH — the reaper does not bound the deferral; D7 hides a product choice | yes (Fact 29, Fact 2) | **Adopted**: budget; **Ask A1**; refined in r3 #2 and r4 #3 |
| 5 | HIGH — the change map misses `TransferEstimateReuse`, the fee strategies / discovery / view callers, and `acquireSlot` outside `runInSlot`'s catch | yes (Fact 7, Facts 32–33) | **Adopted**: all in the map; the lane terminalizes before throwing (the capacity-rejection exit, Fact 38) |
| 6 | MEDIUM — a plain "Wallet locked" throw cannot become `SESSION_ENDED`; a sweep produces the cancellation code | yes | **Adopted**: `assertFence` throws `SessionEndedError` for lock too; both dApp outcomes stated |
| 7 | MEDIUM — consent is best-effort; the selector's cached check runs before its refresh | yes (Fact 11, Fact 30) | **Adopted**: `Header` awaits one refresh; both residuals stated; the selector stays untouched (D3) |
| 8 | HIGH — the TTL e2e cannot run as written (20 s gate; 60 s UI minimum) | yes (Fact 34) | **Adopted**: TTL via the config RPC, step `min(60 s, ttl)`, gate released before 20 s |
| — | Fact 11/12/17 line anchors; Fact 13 is UI routing | yes | **Fixed** |
| — | Read the manager directly under the facade lock; no init cycle; journal-first cancel; synchronous classification; arcs reviewed apart, shipped together | — | **Adopted** |
| — | Outline B: reject the veto and sparse checkpoints; adopt its generation idea | — | **Adopted** |

### Round 3 — codex resumed (GPT-6 Astra, `high`) → **reject** (on rev 3; transcript in `audit-codex.md`)

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | CRITICAL — rev 3's sequence dropped the post-`submitting` `checkCancelled` (`:303`); a cancel landing during the journal write would broadcast while the session stays open | yes (Fact 9; the existing pin) | **Adopted**: `:303` untouched; `assertLive` sits after it, inside `sendTxTask`'s `try`; Phase 1 pin + composition case 10 (reshaped in r4 #5) |
| 2 | HIGH — resetting `deferredFrom` on `refresh()` defeats the cap: `silentInteraction` refreshes on every capability call | yes (Fact 2 `:475`) | **Adopted**: `refresh()` leaves the budget alone. The wider point — dApp activity refreshes the TTL today — is stated honestly as an existing policy and scoped **out** |
| 3 | HIGH — off-lock `expireOrDefer` can act on a stale decision after its awaited predicate; must not reacquire the facade lock from `getActive` nor `close()` under the artifact lock; clamp, don't close early | yes (Fact 16, Fact 28) | **Adopted**: coalesced decision; snapshot + revalidation; `close()` outside the artifact lock; clamp — completed by the single writer in r4 #1 |
| 4 | HIGH — a snapshot `liveSerial` argument goes stale across awaits; registration happens after an await in `acquireSlot`, not at all without `queuedJournalId`, and after journal creation on the transfer path; `claim-helper.ts` was missing from the map | yes (Facts 36, 38) | **Adopted**: `registerInFlight` single writer; register before the first await; deadness read per record at action time; `claim-helper.ts` in the map; the unregistered-execution limitation stated and tested (r4 #2) |
| 5 | MEDIUM — allocate the serial inside the artifact section in the object at `:298`; also at `restore` (`:627`); never reuse after rollback; the off-lock peek can see a provisional session; the facade lock has a 5-min watchdog | yes (Facts 35, 37) | **Adopted** |
| 6 | MEDIUM — tests need deterministic clocks and adversarial scheduling; case 10 must end the session *while* `sendTx` is pending; the 8 s TTL can expire the old session at once via `applyTtlChange`; alarm delivery is best-effort; the popup poll is ~10 s | yes (Fact 40, Inference 9) | **Adopted**: Phase 2 cases 10–11, Phase 3 races, Phase 4 stale-decision tests; e2e 2 reshaped again in r4 #6 |
| — | Commitment point: place `assertLive` inside the `try` after task creation | yes (Fact 39) | **Adopted** |
| — | Fact 33 overgeneralizes; Fact 13 "close + open" wrong; Inference 10 wrong (ViewExecutor serves dApp simulations) | yes | **Fixed** |
| — | Ask A1: prefer `min(TTL, 10 min)`; anchoring to *user* activity needs the activity distinction | — | **Adopted** as the recommendation; the activity distinction scoped out |

### Round 4 — codex resumed (GPT-6 Astra, `high`) → **reject** (on rev 4; transcript in `audit-codex.md`)

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | HIGH — `applyTtlChange` writes the row and swaps alarms under the facade lock without the artifact lock, so an off-facade deferral can interleave; a pre-lock check leaves a boundary before the mutation; "TTL enabled" ignores non-zero → non-zero changes; stale protection must also precede every close; the `refresh()`-race test is wrong because `refresh()` joins the decision via `getActive()` | yes (Fact 40, Fact 16 `:424`) | **Adopted**: one artifact-locked `commitDeadline` with in-lock identity / raw-`lockedAt` / `configRev` CAS; `refresh()` and `applyTtlChange` refactored onto it; the same re-check before every `close()`; Phase 4 tests reshaped (`applyTtlChange` non-zero → non-zero during the predicate; `refresh()` joins) |
| 2 | MEDIUM — unregistered execution is broader than a pre-creation span: no registration without `queuedJournalId`, and a failed journal creation continues without a controller (transfers); a `void` registration cannot do async journal-first cancellation; Fact 36 line anchors; Fact 38 "transfers never take a slot" | yes (Facts 36, 38) | **Adopted**: `registerInFlight` is synchronous and *reports* liveness, the async caller terminalizes `failed/session_ended` (one outcome per mechanism); journal-independent tracking scoped **out** with the limitation stated and pinned; Facts 36, 38 corrected |
| 3 | MEDIUM — clearing the budget anchor only on a false predicate also closes the session, so episodes never reset; `capMs` computed at init while the TTL is mutable | yes | **Adopted**: defined deliberately as a **per-session budget**; the budget is computed from the TTL in force at the first deferral; config-change behaviour specified and tested |
| 4 | MEDIUM — restored sessions may lack `lockedAt`; anchoring on the raw field gives `NaN` | yes (Fact 41) | **Adopted**: arithmetic on `deriveLockedAt`; the raw field only in the CAS; restored-session test |
| 5 | MEDIUM — parking the `submitting` write cannot yield the expected result: the journal's transition lock spans the write, so the cancel queues behind and becomes illegal | yes (Fact 42) | **Adopted**: case 10 parks the **cancellation's** write instead; Inference 6 updated |
| 6 | MEDIUM — the TTL e2e's popup navigation refreshes the session; fixed ~12/~15 s scheduling does not establish the window | yes (Fact 43) | **Adopted**: non-refreshing `peekSession` RPC; assertions relative to `t0` and the observed deadline |
| — | Facts 35, 37, 39, serial publication/rollback, per-record liveness, Inference 2 hold | — | kept |

Three fix-loop rounds on one codex session (r2–r4) is the protocol's hard stop; every round's
findings were verified and adopted. The design has been stable since rev 3; rounds 3–4 corrected
mechanics and test construction.

### Round 5 — fresh-context codex pass (GPT-6 Astra, `high`) → **reject** (on rev 5; transcript in `audit-codex.md`)

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | HIGH — the two auth-registry mutations await network/storage reads before `executeSendTransaction` without a fence; a lock + same-profile re-unlock in that window hands them the new serial and every check passes; Inference 5 was unsafe | yes (Fact 44) | **Adopted**: both capture at entry and forward; parked-read regression in Phase 1; Inference 5 rewritten; a source pin that no production caller relies on "absent ⇒ capture" |
| 2 | HIGH — `clearBearer` persists the whole live row under the facade lock only; `ValueStorage.set` serializes at call time; the deadline CAS did not cover it | yes (Fact 45) | **Adopted**: `commitDeadline` generalized to `commitSession`, the single live-row writer; `clearBearer`'s live branch on it; both-orders tests; a source pin on `this.session.set(` call sites |
| 3 | MEDIUM — the TTL e2e's `t0` predates two session refreshes (Send entry and `leaveSend`), so "still unlocked" can pass with deferral disabled; `peekSession` cannot show the deadline; case 3 creates B during the 20 s gate | yes (Fact 43, Fact 46) | **Adopted**: `readSessionRow` after the last navigation; assert `lockedAt` advanced with `since` unchanged; loud precondition; B pre-created |
| 4 | MEDIUM — `gh stack init --adopt` does not exist | yes (Fact 47) | **Fixed**: `gh stack init --base dev worktree-profile-fenced-execution` |
| — | Fable r1 and codex r2/r3 dispositions represented; r4 #1 and #6 were incomplete (the two findings above) | — | **Adopted** |
| — | Serial allocation, rollback non-reuse, synchronous registration + caller terminalization, per-record liveness, both dApp entries, `:303` before the sync check, case 10's park-the-cancellation, D1–D6 constructibility, two arcs merged atomically | — | kept |

### Round 6 — second fresh-context codex pass (GPT-6 Astra, `high`) → **reject** (on rev 6; transcript in `audit-codex.md`)

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | HIGH — a single CAS that requires the expected deadline before *any* mutation lets a deferral that wins the artifact lock first make `clearBearer`'s bearer removal vanish (reproduced against the real `Lock` in a model); "every loser stands down" does not preserve `refresh`/TTL-change semantics either | yes (design; `session-manager.ts:450` contract) | **Adopted**: two kinds of write on one writer — identity checked for all, the deadline/config expectation only for the deferral (stale-decision CAS); `refresh`, `applyTtlChange`, `clearBearer` are must-apply and mutate the current row inside the lock; Phase 4 tests contention before mutation in both lock orders |
| 2 | Fact 46 cited funding waits, not profile creation; Fact 2 misquoted the comment; Inference 7 said `open` writes before publication | yes | **Fixed** (Fact 46 → `session-profileSwitch.test.ts:49`; Fact 2 quote; Inference 7 → publishes then persists, Fact 35) |
| — | Ledger: fable r1, codex r2–r5 dispositions represented except where #1 reaches (r2 #3, r3 #3/#6, r4 #1, r5 #2) | — | **Resolved by #1** |
| — | Serial publication, registration + terminalization, per-record liveness, `:303` then `isFenceLive`, both dApp entries and the auth-registry entries: no stale-session broadcast path found; eleven composition cases and three e2e constructible; commands and stack flags exist; arcs merged atomically | — | kept |

### Round 7 — the second fresh session resumed on rev 7 → **conditional approve**

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | MEDIUM — `clearBearer`-first does **not** make the deferral stand down: bearer removal changes neither `lockedAt` nor `configRev`, so the expectation matches and both commit; the prose and the Phase 4 expectation had it wrong (the algorithm is right); under artifact serialization storage completion follows acquisition order | yes (model against the real `Lock`) | **Fixed** in §Architecture item 3, the "one session-row writer" mechanic and Phase 4 |
| 2 | Inference 7 described `restore` as persisting inside an artifact section; it publishes and schedules the alarm, writes no row, takes no artifact lock | yes (`:627-631`) | **Fixed**; `restore` removed from the `session.set` pin list |
| — | Seven adversarial schedules (deferral↔bearer removal, refresh between snapshot and CAS, TTL disabled before/after, close before/during a write) behave correctly; no new resurrection path; send-fence, composition/e2e, scope and atomic two-arc delivery stand | — | kept |

**Conditions met in rev 8.** Gate: fable r1 conditional approve (rev 1, folded) + codex conditional
approve (rev 7 → 8). **Owner approved 2026-09-16 (D8–D10); rev 9 folds the pre-title override into
§UI impact and Phase 5.** The seeds below are final.

## Post-implementation

Executed by the implementing session from this file. `code_review: off` — `/code-review` is **not**
run; do not add it.

1. **Per arc, at its boundary** (all its phases ✓, before `gh stack add` opens the next arc):
   codex audit (`/codex high`, under tmux, never concurrent with `audit:vue`) over the arc's diff +
   this plan + the decision ledger + the arc map ("arc N of 2; arc 2 builds the lock dialog, the
   card copy and the e2e on arc 1's error/serial/checks/registry/sweep/deferral") + the
   adversarial/security ask + the two rules below, verbatim.
2. **Iterative fix loop**: verify codex's factual claims against the repo, apply accepted fixes,
   commit, log the round in `lessons/phase-N.md`, RESUME the same session with the fix diff.
   Repeat until a round yields no new material findings; hard stop at 3 rounds → surface.
3. **After both arcs**: one FRESH codex session over the net diff from `c543c18d`, asking for
   cross-arc issues (seams, duplication, drift from the plan), same loop.
4. **Delivery** (below) — the first time any PR is opened.

**No-over-engineering rule** (verbatim in every post-impl codex prompt): *"Report bugs and small,
targeted improvements only. Do not propose speculative abstractions, extra configuration surface,
new layers, or rewrites — the smallest change that fixes each real problem. If code works and is
clear, leave it alone."*

**Comment-quality rule** (verbatim): *"Audit the comments for value per character. Flag any comment
that narrates what the code visibly does, restates its line, references implementation plans /
phases / reviews, or spends a paragraph where a sentence works — and flag places where a
non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent
context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

## Delivery

Two arcs, stacked with `gh stack` (`gh stack init --base dev worktree-profile-fenced-execution` —
existing branches are adopted automatically, Fact 47; `gh stack add <arc-2-branch>` at the
boundary), PRs opened only after both arc loops and the
cross-arc pass converge (`gh stack submit --auto`, then `gh pr edit` bodies quoting the owner's
UI sign-off).

| Arc | Phases | Stacks on | PR title | code_review |
|---|---|---|---|---|
| 1 — the invariant | 0, 1, 2, 3, 4 | `dev` | `fix(execution): bind every send to the session that authorized it` | off |
| 2 — the UX | 5, 6, 7 | arc 1 | `feat(popup): confirm before a lock cancels running transactions` | off |

Arc 1 changes no popup UI (the dApp-visible 4900 envelope branch is in it). **The arcs are split for
review, not for release**: arc 1 alone makes a lock cancel running work with no warning, so the
stack merges as a unit (`gh stack merge` on arc 2 lands both — the owner's call, never the
session's). A `session_ended` record before arc 2 falls to the generic "Failed" subtitle.

## Seeds

_(final — owner approved 2026-09-16, D8–D10; paste into a fresh session homed in this worktree)_

```
/goal All phases (0–7) marked ✓ in implementations-plan/profile-fenced-execution/plan.md, each ✓ backed by its phase's validation gate reported passing in the transcript; for each phase the agent has printed LESSONS_FILE=implementations-plan/profile-fenced-execution/lessons/phase-N.md in the transcript; /code-review was NOT run (code_review: off); the codex fix loop converged for arc 1 at its boundary, for arc 2 at its boundary, and for the final cross-arc pass — each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the two stacked PRs into dev exist, created only after that convergence (gh stack view output in the transcript); bun run audit:vue and all three network e2e files report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/profile-fenced-execution forward. Never idle waiting for my input. Each firing: read plan.md and lessons/ as authoritative state, rebuild the task list from plan.md's phase headers if empty, run git status and git log --oneline -5 (gh stack view once the stack exists). No task in hand? Start the next pending phase (0 first); after each meaningful edit run the fast layers (cd apps/extension && bun --bun vitest run <touched dir>, then bun run typecheck:all && bun run lint from the worktree root), then commit and push (gh stack push once stacked). Stuck, or facing a decision you'd bring to me? Call /codex high (under tmux, never concurrent with audit:vue), argue it out, act, and log the consult in lessons/phase-N.md. Same step failed 5 times? Stop and reassess with codex. Phase green means THE PHASE'S VALIDATION GATE in plan.md passes — run it, paste the result, mark ✓, file the lessons entry, print LESSONS_FILE=..., advance. Arc boundary (after phase 4, and after phase 7)? Run the arc's codex loop per plan.md's Post-implementation section with the arc map and both rules verbatim until clean, THEN gh stack add the next arc (after phase 4 only). All phases ✓ and both arcs looped? Run the fresh cross-arc codex pass, then gh stack sync, gh stack submit --auto, gh pr edit bodies (quote the owner's UI sign-off), gh pr checks --watch. Hard limits: never merge, never publish, never touch the account/network Send freeze, commitScopeChange, the lock-screen selector or the :303 cancellation check, never expand scope beyond plan.md.
```
