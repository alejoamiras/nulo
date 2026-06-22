# IncomingTransfer trust-state-machine refactor plan (Codex)

## 1. Goal + success criteria

Goal: linearize every mutation of the incoming-transfer trust row and its contract-scoped record set behind one per-triple `Lock`, using `Map<${profileId}|${networkId}|${contract}, Lock>` and keeping the repository last-write-wins. The refactor should remove correctness dependence on the current patch stack (`scanGenerations`, `txDeleteInflight`, compensating reverts, replay live re-checks) without changing the external FSM, UI return contracts, or storage schema.

Success criteria:

- Every write path touching `IncomingTrustRecord` or `IncomingTransferRecord` for a `(profileId, networkId, contract)` triple routes through one lock seam in `packages/extension/src/wallet/services/incoming-transfer/service.ts`.
- The residual race called out in the prompt is closed: if `setTrustAllow` lands while `scanContract` is parked before `buildRecord`, the final persisted record is not permanently hidden. Add a regression test that proves this.
- `polling` remains as scheduler singleflight, but write correctness no longer depends on `scanGenerations` or `txDeleteInflight` (`packages/extension/src/wallet/services/incoming-transfer/service.ts:95-112`, `486-517`).
- The 4-state FSM remains `unknown -> pending -> trusted | blocked` with re-add still modeled as delete + rediscover (`packages/extension/src/wallet/services/incoming-transfer/spec.ts:23-27`, `67-78`; `packages/extension/src/utils/activity-rows.ts:62-72`).
- `IncomingTrustPopup.vue` and `NewTokenPopup.vue` still rely on `ok !== false` / `ok === false` exactly as they do now (`packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:80-105`, `packages/extension/src/popup/components/popups/NewTokenPopup.vue:216-234`).
- No repo migration or storage-key change is introduced; rollback is code-only.

## 2. Scope — ordered work phases

This is still a single-PR big-bang switch. The phases below are for implementation order and within-PR commit shape, not for shipping independently.

### Phase 0 — Add the lock seam, not behavior

Files:

- `packages/extension/src/wallet/services/incoming-transfer/service.ts`
- `packages/extension/src/wallet/services/incoming-transfer/service.test.ts`
- `packages/extension/src/wallet/services/incoming-transfer/repository.test.ts`

Work:

- Add a private lock map keyed by the same string as the trust table. Reuse `trustKey()` from `repository.ts` so storage key and lock key cannot drift (`packages/extension/src/wallet/services/incoming-transfer/repository.ts:23-27`, `77-85`).
- Add helper(s) such as `acquireTrustLock`, `withTrustLock`, and `withTrustLocks(sortedKeys, op)`.
- Add ref-counted eviction beside the `Map<key, Lock>` so idle keys are deleted safely after the last waiter releases. Do not evict based on `Lock` internals; `Lock` exposes no queue/held introspection (`packages/wallet-core/src/utils/lock.ts:6-68`).
- Name each lock with the triple key and pass `this.logger` so queue wait / force-release logs are actionable (`packages/wallet-core/src/utils/lock.ts:14-17`, `22-24`, `29-40`, `52-55`).

Checkpoint:

- Behavior unchanged.
- New unit tests cover key composition reuse and lock-map eviction on simple acquire/release.

### Phase 1 — Migrate single-triple writers and replay

Files:

- `packages/extension/src/wallet/services/incoming-transfer/service.ts`
- `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`
- `packages/extension/src/wallet/services/incoming-transfer/spec.ts`

Work:

- Route `setTrustState`, `setTrustAllow`, `setTrustReject`, `onTokenDeleted`, and `replayPendingPrompts` through the new lock seam.
- Split public wrappers from internal locked helpers. Current code chains public methods (`setTrustAllow -> setTrustState`, `setTrustReject -> setTrustState`), which will deadlock once both methods acquire the same non-reentrant `Lock` (`packages/extension/src/wallet/services/incoming-transfer/service.ts:237-307`; `packages/wallet-core/src/utils/lock.ts:19-28`, `63-67`).
- Preserve current event order for delete: delete rows first, then emit `onIncomingTrustChanged(state="unknown")`, because `PopupManager` closes/purges queued prompts on the `unknown` transition (`packages/extension/src/wallet/services/incoming-transfer/service.ts:470-482`; `packages/extension/src/popup/components/popups/PopupManager.vue:124-153`).
- Preserve `false` semantics on stale-token allow/reject. The stale check should become part of the locked state-machine path, not a compensating follow-up write (`packages/extension/src/wallet/services/incoming-transfer/service.ts:243-311`, `314-324`; `packages/extension/src/wallet/services/token/service.ts:260-268`).
- Make `replayPendingPrompts` lock each triple before live re-read + emit so replay cannot race with delete/allow/reject on that same triple (`packages/extension/src/wallet/services/incoming-transfer/service.ts:707-758`).

Checkpoint:

- UI contract still unchanged.
- Scenario tests prove allow/reject/delete/replay serialize per triple.

### Phase 2 — Refactor `scanContract` into unlocked discovery + locked commit

Files:

- `packages/extension/src/wallet/services/incoming-transfer/service.ts`
- `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`

Work:

- Keep `polling` and the scheduler topology unchanged (`packages/extension/src/wallet/services/incoming-transfer/service.ts:95-101`, `521-537`).
- Stop using `getTrustState()` as a stale local snapshot for record construction. The current bug comes from reading trust once, mutating a local `trustState`, then calling `buildRecord` after more awaits (`packages/extension/src/wallet/services/incoming-transfer/service.ts:565-669`, especially `639-645` and `668-669`).
- Move the state-machine decision for each note under the triple lock: load live trust, load live record, decide transition, decide hidden/visible, persist, emit.
- Keep long I/O outside the lock when it is straightforward. `Lock` force-releases after 5 minutes, so `getNotesRaw` must stay out of the critical section, and `getBlockTimestamp` should stay out when possible to avoid a slow PXE call blocking all trust operations on that contract (`packages/wallet-core/src/utils/lock.ts:3-4`, `36-43`; `packages/extension/src/wallet/services/incoming-transfer/service.ts:548-578`).
- Preserve the first-receive semantics: exactly one `unknown -> pending` transition and exactly one pending emit per pending cycle (`packages/extension/src/wallet/services/incoming-transfer/spec.ts:91-109`; `packages/extension/src/popup/components/popups/PopupManager.vue:48-75`).

Checkpoint:

- Add the explicit residual-race regression: parked `scanContract`, concurrent `setTrustAllow`, final row visible.
- Add a same-contract cross-account sequencing test, because the lock key intentionally excludes `accountAddress`.

### Phase 3 — Migrate multi-triple writers

Files:

- `packages/extension/src/wallet/services/incoming-transfer/service.ts`
- `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`

Work:

- Refactor `onTransactionAdded` to:
  - take an initial snapshot of matches by tx hash,
  - derive unique triple keys from those matches,
  - acquire them in stable lexical order,
  - re-read live matches inside the locks before deleting and emitting.
- Refactor `clearProfile` and `clearChain` similarly:
  - derive the union of triple keys from trust rows, incoming records, and currently registered tokens in scope,
  - sort keys once,
  - acquire all scoped locks,
  - perform the clear,
  - then rebuild schedulers.
- Keep `clearProfile` / `clearChain` silent unless the user explicitly wants event semantics changed. The current implementation clears storage and rehydrates schedulers without delete/trust events (`packages/extension/src/wallet/services/incoming-transfer/service.ts:327-336`).

Checkpoint:

- Tests prove no deadlock under overlapping multi-lock operations.
- Concurrent duplicate `onTransactionAdded` events no longer need `txDeleteInflight` to avoid double delete emits.

### Phase 4 — Remove obsolete guard code and tighten comments

Files:

- `packages/extension/src/wallet/services/incoming-transfer/service.ts`
- `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`
- `packages/extension/src/wallet/services/incoming-transfer/spec.ts`

Work:

- Remove `scanGenerations` and its bump/check machinery once the lock-backed scan path is green (`packages/extension/src/wallet/services/incoming-transfer/service.ts:102-112`, `345-372`, `423-447`, `540-667`).
- Remove `txDeleteInflight` and its test pins once `onTransactionAdded` is re-read-under-lock (`packages/extension/src/wallet/services/incoming-transfer/service.ts:486-517`).
- Remove compensating reverts and per-record stale checks that only existed because writes were racing (`packages/extension/src/wallet/services/incoming-transfer/service.ts:249-289`, `301-307`, `270-278`, `734-745`).
- Rewrite comments to explain the new invariant: one lock owns trust transitions, visibility flips, delete/reset, and pending replay for a triple.

Checkpoint:

- The service no longer mixes lock-based serialization with old generation / inflight write guards.

## 3. Security & adversarial considerations

### Token impersonation

- Discovery is intentionally limited to user-added fungible-token contracts (`packages/extension/src/wallet/services/incoming-transfer/spec.ts:13-18`, `packages/extension/src/wallet/services/incoming-transfer/service.ts:556-561`). The refactor must not broaden this seam.
- Manual add is intentionally auto-trusted only in `NewTokenPopup.vue`; dApp-driven token registration does not get that bypass (`packages/extension/src/popup/components/popups/NewTokenPopup.vue:208-234`). Keep that asymmetry.
- Token deletion removes the token from `TokenService` storage before `onTokenDeleted` emits (`packages/extension/src/wallet/services/token/service.ts:260-268`). Use that fact: the locked scan commit and locked allow/reject path should live-check token registration so a deleted/spoof contract cannot be trusted or prompted after the token row is gone.

### Notification flooding

- Pending prompts are already coalesced per `(profileId, networkId, contract)` in both the spec and the popup queue (`packages/extension/src/wallet/services/incoming-transfer/spec.ts:91-109`; `packages/extension/src/popup/components/popups/PopupManager.vue:48-75`).
- The lock refactor must preserve “one pending emit per pending cycle” and linearize `scanContract`, `replayPendingPrompts`, `setTrustAllow/Reject`, and `onTokenDeleted`, otherwise replay could reopen prompts after delete or after a user decision (`packages/extension/src/wallet/services/incoming-transfer/service.ts:614-659`, `707-758`; `packages/extension/src/popup/components/popups/PopupManager.vue:124-153`).
- If `txDeleteInflight` is removed, the replacement must still prevent duplicate `onIncomingTransferDeleted` emits for the same logical delete (`packages/extension/src/wallet/services/incoming-transfer/service.ts:486-517`).

### Storage exhaustion / orphan retention

- Records are keyed by `siloedNullifier`, so duplicates are already idempotent at the storage key layer (`packages/extension/src/wallet/services/incoming-transfer/spec.ts:8-10`; `packages/extension/src/wallet/services/incoming-transfer/repository.ts:40-50`).
- The real storage-risk bug is orphan retention: a stale hidden row can become permanent because later scans short-circuit on `getRecord(existing)` and replay only targets `pending` trust (`packages/extension/src/wallet/services/incoming-transfer/service.ts:594-607`, `699-758`).
- The refactor should treat delete/reset and record insert/update as one serialized state machine so clear/delete can no longer be followed by a stale resurrection.

### State-machine soundness

- The public model is fixed at four states (`packages/extension/src/wallet/services/incoming-transfer/spec.ts:23-27`).
- The locked implementation should centralize legal internal transitions instead of letting each caller open-code them from stale snapshots.
- Preserve current UI-visible semantics:
  - allow/reject return `false` when the token is gone (`packages/extension/src/wallet/services/incoming-transfer/spec.ts:136-145`, `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:80-105`);
  - delete/reset still purges queued popups via `state === "unknown"` (`packages/extension/src/popup/components/popups/PopupManager.vue:147-153`).

### Concurrency invariants

- `Lock` is FIFO and force-releases after 5 minutes (`packages/wallet-core/src/utils/lock.ts:19-28`, `36-45`, `63-67`). Do not hold it across broad `getNotesRaw` or profile-wide scheduler rebuilds.
- Multi-triple writers (`onTransactionAdded`, `clearProfile`, `clearChain`) must sort lock keys before acquisition or they can deadlock each other.
- Non-reentrancy is a real footgun here: once `setTrustState` is lock-wrapped, any nested call from another lock-wrapped method will self-deadlock.

## 4. Assumptions

### Facts

- Trust and records are stored in separate last-write-wins tables keyed by `trustKey(profileId, networkId, contract)` and `siloedNullifier`, with profile/chain clears implemented as full scans over storage (`packages/extension/src/wallet/services/incoming-transfer/repository.ts:1-15`, `40-50`, `77-121`).
- The current service has three concurrency mechanisms already: `polling`, `scanGenerations`, and `txDeleteInflight` (`packages/extension/src/wallet/services/incoming-transfer/service.ts:95-112`, `486-537`).
- `scanContract` currently reads trust before the note loop’s final upsert and uses the local value to compute `hidden` (`packages/extension/src/wallet/services/incoming-transfer/service.ts:565-669`, `761-790`).
- Token delete happens before token-delete event emission in `TokenService`, so live token lookups can observe deletion before `IncomingTransferService.onTokenDeleted` runs (`packages/extension/src/wallet/services/token/service.ts:260-268`).
- PopupManager binds allow/reject closures using the queued triple and purges queued/open prompts only on `onIncomingTrustChanged(state="unknown")` (`packages/extension/src/popup/components/popups/PopupManager.vue:82-105`, `124-153`).
- Activity feed ordering already prefers `blockTimestamp` over `discoveredAt`, which is why delete + rediscover can preserve chronological order without a new FSM state (`packages/extension/src/wallet/services/incoming-transfer/spec.ts:67-78`; `packages/extension/src/utils/activity-rows.ts:62-72`).
- Tests cast into private `scanContract`, inspect `schedulers`, and spy on `repo`, so those private names should remain stable during the refactor (`packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:15-19`, `276-283`, `560-589`, `1272-1275`, `1770-1776`).

### Inferences

- Per-note locking in `scanContract` is safer than whole-scan locking. Whole-scan locking would hold a force-release lock across `getNotesRaw` and potentially repeated PXE timestamp waits (`packages/extension/src/wallet/services/incoming-transfer/service.ts:548-578`; `packages/wallet-core/src/utils/lock.ts:36-43`).
- Read-only methods like `getIncomingTransfers` can stay unlocked because the UI already reconciles from live events and reconnect reloads (`packages/extension/src/wallet/services/incoming-transfer/service.ts:206-229`; `packages/extension/src/popup/components/modules/general/RecentActivityView.vue:198-233`).
- `onTransactionAdded` and clear operations need sorted multi-lock acquisition because they can touch more than one contract per call (`packages/extension/src/wallet/services/incoming-transfer/service.ts:327-336`, `493-517`).
- `scanGenerations` should become unnecessary once delete/reset and scan commit are serialized under the same triple lock and live token-registration checks happen at commit time.

### Asks

- Is `setTrustState` meant to remain a generic client-callable escape hatch after this refactor, or can it be treated as internal-only discipline even if the method stays on the spec? `rg` currently finds no UI caller outside the service/client pair.
- Should `clearProfile` / `clearChain` remain silent forever, or is emitting delete/trust-reset events during bulk clears acceptable in a follow-up? This plan assumes “stay silent” to avoid changing popup/activity behavior.

## 5. Phase ordering rationale + revert safety

- Phase 0 first because lock acquisition/release and eviction are the new seam; every later change should reuse it rather than open-code its own queueing.
- Phase 1 before scan because it flushes the obvious self-deadlock risk early and stabilizes the single-triple helper shape on smaller paths.
- Phase 2 before multi-triple work because `scanContract` is the highest-volume writer and the concrete residual bug lives there.
- Phase 3 after that because sorted multi-lock acquisition is easier to review once the single-triple seam is already trusted.
- Phase 4 last because deleting guards too early removes the easiest comparison point during review and bisect.

Recommended within-PR commit shape:

1. lock seam + helper tests
2. single-triple writers/replay on lock
3. `scanContract` locked-commit refactor + residual-race regression
4. multi-triple writers on sorted locks
5. delete obsolete guards + comment cleanup

Reviewer/bisect value:

- Each commit can keep targeted tests green.
- The final cleanup commit is the easiest first revert inside the PR if a new regression appears during review.
- After merge, prefer squash-merge to one commit so dev rollback is one `git revert`, not a sequence.

## 6. Test plan

### Writer pins

- Add a white-box seam test for the new helper (`withTrustLock` / `withTrustLocks`) and spy on that seam rather than on raw `Lock.prototype`. That keeps tests local to this service.
- `setTrustState`: direct call acquires/releases the triple lock and emits `onIncomingTrustChanged` after persistence.
- `setTrustAllow`: acquires the triple lock once, preserves `false` semantics, flips hidden rows visible across all accounts on the contract, and does not deadlock through `setTrustState`.
- `setTrustReject`: same serialization, no visible-row emission, same `false` semantics.
- `onTokenDeleted`: serializes row deletion + trust reset under the triple lock after scheduler teardown.
- `scanContract`: each note commit uses live trust under lock; no local stale `trustState` controls final `hidden`.
- `onTransactionAdded`: duplicate concurrent events do not double-emit delete.
- `clearProfile` / `clearChain`: bulk clear holds all scoped triple locks before mutating storage.
- `replayPendingPrompts`: emits only from inside the triple lock after live re-check.

### Race scenarios

- Residual-race pin: park `scanContract` on `getBlockTimestamp`, run `setTrustAllow`, resume, assert final record is visible and not marooned hidden.
- Park `scanContract`, fire `onTokenDeleted`, resume, assert no row resurrection and no orphan pending emit.
- Park `scanContract`, fire `clearChain`, resume, assert scope remains empty.
- Fire `setTrustAllow` and `setTrustReject` concurrently for the same triple, assert one total order and a legal final FSM state.
- Fire two concurrent `onTransactionAdded` events for the same tx hash spanning multiple contracts, assert one delete emit per record.
- Replay-vs-delete: snapshot pending, run `onTokenDeleted` before replay acquires the lock, assert no prompt emit.

### Invariant tests

- Lock key excludes account address: two accounts on the same `(profile, network, contract)` serialize and share the same trust transition.
- Multi-lock ordering: overlapping `clearProfile` / `onTransactionAdded` paths do not deadlock when they share a subset of keys.
- No writer leaks idle lock entries: after queued same-key operations resolve, the lock map is empty.
- Keep the existing private-surface tests alive: direct `scanContract` cast, `schedulers` inspection, `repo` spy.

## 7. Quality gates

Fast local gates while iterating:

```bash
bun run --cwd packages/extension vitest run \
  src/wallet/services/incoming-transfer/service.test.ts \
  src/wallet/services/incoming-transfer/repository.test.ts \
  src/wallet/services/incoming-transfer/service.scenarios.test.ts

bun run --cwd packages/extension vitest run \
  src/popup/components/popups/PopupManager.test.ts \
  src/popup/components/popups/NewTokenPopup.test.ts \
  src/popup/components/modules/general/RecentActivityView.test.ts

bun run --cwd packages/extension typecheck
bun run --cwd packages/extension lint
```

Pre-push / CI gate:

```bash
bun run audit:vue
```

## 8. Rollback / risk

Primary rollback:

- Revert the merged PR commit.
- Re-run `bun run audit:vue`.
- Ship the revert without any storage migration rollback, because this plan does not change storage keys or on-disk schema.

If bad persisted state already landed on a dev profile:

- Prefer per-token repair first: delete and re-add the affected token. The current delete + rediscover model will rebuild records with the same `blockTimestamp` ordering (`packages/extension/src/wallet/services/incoming-transfer/service.ts:460-469`; `packages/extension/src/utils/activity-rows.ts:62-72`).
- Escalate to `clearChain` / `clearProfile` only if the issue is broader than one triple.

Main risks to watch during implementation:

- Self-deadlock from nested public lock wrappers.
- Multi-lock deadlock from inconsistent sort order.
- Lock-map leaks from incorrect ref-count eviction.
- Holding a force-release lock across slow PXE calls.
- Accidentally changing event order relied on by `PopupManager`.

## 9. Open questions (post-audit)

- Do you want `setTrustState` documented as “escape hatch / internal discipline only” after this refactor, even if we keep the method on the spec for compatibility?
- Is the desired policy for bulk clear still “silent storage wipe + scheduler rebuild”, or do you want a later follow-up to emit row/trust events for open popup/activity surfaces?
- If the PR gets large, do you prefer keeping the new lock helpers inside `service.ts` for one-pass review, or extracting them to a sibling module once behavior is green? My bias is to keep them local for this PR because tests already white-box into the service.

## 10. Branch + commits + PR shape

Branch name:

- `refactor/incoming-trust-lock-map`

Commit prefixes:

- `refactor(extension): add incoming-transfer trust lock seam`
- `refactor(extension): serialize incoming trust writers`
- `refactor(extension): linearize incoming-transfer scan commits`
- `refactor(extension): lock incoming bulk delete paths`
- `test(extension): pin incoming-transfer lock races`
- `chore(extension): remove obsolete incoming-transfer race guards`

PR shape:

- Open as draft immediately.
- Keep the five logical commits above on the branch for review and bisect.
- In the PR body, include one short “Linearization rules” section listing:
  - single-triple writers use `withTrustLock`
  - multi-triple writers sort and use `withTrustLocks`
  - no public lock-wrapped method may call another public lock-wrapped method
  - `scanContract` uses live trust inside the commit step
- Squash-merge after approval for one-step revertability.

## 11. Implementation discipline

- Reuse `trustKey()` for the lock key; do not maintain a second string builder.
- Use `try/finally` around every `enter()` and every multi-lock acquire loop.
- Do not change `scanContract`, `repo`, or `schedulers` private field names unless the tests are updated in the same commit.
- Keep `polling` and scheduler concerns separate from the trust lock. The trust lock is for repo + state-machine mutation, not for interval ownership.
- Keep logger style consistent with the file: `this.logWarn(...)` / `getErrorMessage(error)` for recoverable failures (`packages/extension/src/wallet/services/incoming-transfer/service.ts:192-193`, `401-403`, `551-553`, `798-815`).
- No new `console.*` in the background service. Popup-side `console.warn` behavior in `NewTokenPopup.vue` should stay as-is.
- Preserve existing event order where the UI depends on it:
  - pending trust change before pending popup emit;
  - record deletes before trust reset to `unknown`;
  - visible-row emits only after persistence.
- Comments should explain invariants and sequencing, not narrate syntax.
- No new emoji, no broadened public API, no storage-layer CAS, no repo schema changes.

## 12. `/goal` and `/loop` seed strings

`/goal`

```text
Refactor IncomingTransferService so every trust-row / contract-record mutation is serialized by a per-(profileId,networkId,contract) Lock map in packages/extension/src/wallet/services/incoming-transfer/service.ts. Preserve the current 4-state FSM, preserve setTrustAllow/setTrustReject false-on-stale semantics, keep the repo last-write-wins, keep PopupManager/NewTokenPopup/IncomingTrustPopup contracts unchanged, remove stale-local trust writes in scanContract, and leave incoming-transfer targeted tests plus bun run audit:vue green.
```

`/loop`

```text
1. Enumerate every repo write + trust-dependent emit path in IncomingTransferService.
2. Add one lock seam (single-key + sorted multi-key) with safe eviction and no public-to-public reentrant locking.
3. Migrate single-triple writers first, then scanContract’s commit step, then multi-triple delete/clear paths.
4. Add regression tests for the parked-scan + setTrustAllow race, delete/clear mid-scan, duplicate onTransactionAdded, and lock eviction.
5. Delete scanGenerations/txDeleteInflight/compensating race guards only after replacement tests pass.
6. Finish with targeted vitest, popup consumer tests, extension typecheck/lint, then bun run audit:vue.
```
