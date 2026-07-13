# backup-restore-residuals — finish D13 to zero deferrals + low-severity cleanups (v2)

**Tier: `mid`** (at the mid/deep boundary — security-sensitivity HIGH + concurrency-correctness now non-trivial after the dual audit; still ONE mechanism = the proven monotonic deletion-epoch fence, single-package `apps/extension`, low novelty). Branch off `dev` → `dev`, ONE PR. If the final fresh-codex pass still surfaces a critical, ESCALATE to `deep`.

> **Base note (audit-caught, v1→v2):** the worktree was first cut off `origin/HEAD` = `origin/fix/harden-findings` (harden line), which lacks #276. BOTH audit legs REJECTED v1 because every mechanism fact was absent. Re-baselined `git reset --hard origin/dev` → HEAD `fb61a63` (#276 present). All facts below re-verified against THIS base.

## Goal
Make **D13 COMPLETE**: every profile-owned-row writer that can complete AFTER the deletion coordinator's awaited purge is fenced against the deletion epoch, so no token / balance row resurrects in a purged (or successor) profile. Reuse the SHARED `ProfileDeletionState` + the proven tx-fence pattern, extended per the audit. Plus the 3 cleanups (coordinator test, dup-token-id reject, tombstone telemetry) + index.md.

## Load-bearing facts (v2 — verified against fb61a63)
- `ProfileDeletionState` (`profile/profile-deletion-state.ts`): `capture(id)`, `beginDeletion(id)` (bumps epoch, reserves; epoch never reset on release), `assertCurrent`, `isCurrent`, `isReserved`, `hydrateDeletion` (resume: sets epoch, reserves). `ExecutionFence={profileId,epoch}`. Exposed via `ProfileService.getDeletionState()`. **`isCurrent` compares ONLY epochs — it does NOT check `isReserved`** (audit C3): a job enqueued AFTER `beginDeletion` captures the NEW epoch → `isCurrent` stays true; a corrupt tombstone hydrated reserved-with-epoch-0 is `isCurrent(id,0)`=true. So the fence primitive must be **capture-and-check = `!isReserved(id) && isCurrent(id, capturedEpoch)`**, both read atomically under the leaf lock.
- Tx fence (`transaction/service.ts` addTransaction): the shipped reference — injects `deletionState` at init via `getDeletionState()`, `addTransaction(...,fence?)` asserts `assertCurrent + owning-account-exists` under the tx `Lock` before write.
- **Token writers** (`token/service.ts`, all under `this.lock`): `addToken:132` (allocates new id → `tokens.set:202`; its **journal op is created at :153 BEFORE the lock**); `updateToken:224` (re-reads `tokens.get:238` → throws if gone → SAFE vs `purgeForProfile`, but the coordinator's per-chain `clearChainState:~94` deletes WITHOUT the token lock → update can rewrite a chain-purged token); `restore:571` (`tokens.set:581`). No `registerToken` writer (delegates to `addToken`). `_deleteTokenById(id,emit=false)` = silent purge; `purgeForProfile` loops it under the lock. `getTokenRaw:126` is ACTIVE-PROFILE-gated (wrong as an owner resolver — would skip a legit refresh after a profile switch).
- **Balance writers** (`token-balance/`): `balance-job-queue.ts` `enqueue:78` → batched `projector.project:124` → re-reads `repo.get:138` (skips + `onOrphanDetected` if the row is GONE) → `repo.set:151` + `onBalanceUpdated:153`. The orphan guard covers "row already deleted" but NOT the window where the row still exists while a token/profile purge is in flight — and the check is **NOT atomic** with `purgeForTokens` (`service.ts:227`) (no shared lock). ALSO detached `service.ts` `onTokenAdded`/`onAccountAdded` (156-168,198-209) call `createTokenBalance`→`repo.set` fire-and-forget (`EventHandler.invoke` discards the promise — `wallet-core/utils/event-handler.ts:22`). ALSO `TokenBalanceService.restore:296` writes.
- **Coordinator** (`profile-deletion/coordinator.ts`): awaited ordered `purge()` (txs→auth→balances→incoming→contacts→sessions→fpcs→journal→accounts→tokens→networks→pxe). **Journals are purged BEFORE tokens** — so a stale `addToken` whose journal-op was created pre-purge can leave a post-delete journal row (audit finding 6). No direct unit test.
- **Two-phase delete** (`profile/service.ts` deleteProfile): phase-1 writes the tombstone THEN `repo.delete(id)` THEN (outside lock) awaited purge THEN clear tombstone. So **"profile row absent from storage" does NOT mean "nothing to purge"** — it means phase-1 done, purge maybe pending (audit D-D: auto-dropping a corrupt tombstone here is FAIL-OPEN).
- **Relink** (`useFullBackupImport.ts`): `tokenService.restore(data.token):535` → index-pairs `oldTokens[i]→newTokens[i]:553-557` building `oldIdToChain` keyed by `old.id` → a duplicated backup `token.id` collapses that map (last-wins). Network dup-source-id is already skipped via `sourceIdCounts`; tokens are not.

## Fence design (audit-consolidated)
1. **Primitive:** add `ProfileDeletionState.isLive(id, capturedEpoch): boolean = !isReserved(id) && isCurrent(id, capturedEpoch)` (reservation-aware). Capture = `{profileId, epoch:capture(id)}` read while NOT reserved (else the op is already dead). Keep `assertCurrent` for throw-sites.
2. **Per-leaf shared lock, inline (NOT a guard helper — audit finding 8):** each writer captures the fence at AUTHORIZATION/enqueue, then re-checks `isLive` **while holding the same leaf lock the coordinator's purge takes**, immediately before the write. A helper can't give atomicity (deletion can begin while its `writeFn` awaits); the leaf lock is the choke point.
3. **Owner resolver:** add an INTERNAL, non-active-profile-gated `TokenService.getOwnerProfileId(tokenId)` (reads the raw token row's `profileId`) so the balance fence resolves the authoritative owner without the active-profile skip. Compare the LIVE token's `profileId` to the captured profile — this (not `(id,token,account)` alone) defeats successor-id reuse.
4. **Policy:** user/dapp writes (`addToken`) THROW on a dead fence; background refreshes (balance projection, detached callbacks) SKIP. Restores THROW (record `restoreError`).

## Phases

### Phase 1 — fence primitive + token-service wiring ☐
- `ProfileDeletionState.isLive(id, epoch)` (reservation-aware) + unit pins (reserved→false; stale epoch→false; corrupt-tombstone epoch-0-reserved→false; live→true).
- Inject `deletionState` into `TokenService` at init (`getDeletionState()`); add internal `getOwnerProfileId(tokenId)`.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services/profile/profile-deletion-state.test.ts`.

### Phase 2 — token-write fences (addToken, updateToken, clearChainState lock, restore, journal order) ☐
- `addToken`: capture epoch at entry (before `fetchTokenMetadata`); re-check `isLive(profileId, epoch)` under `this.lock` immediately before `tokens.set` → THROW if dead. Fix the journal-ordering race: create/keep the journal op INSIDE the fence, or delete it on a dead-fence throw (no post-delete journal row).
- `updateToken`: add the explicit `isLive` assert under the lock before `set` (defensive; the reread already blocks purgeForProfile).
- `clearChainState`: take `this.lock` (so a racing `updateToken` can't rewrite a chain-purged token — audit finding 5).
- `TokenService.restore`: fence each row (`isLive` under the lock before `set`) → `restoreError` on dead.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services/token` — deterministic pins (inject a metadata-fetch hold-point): add mid-delete → THROW, not written; chain-purge mid-update → not rewritten; restore into a reserved profile → restoreError; normal add/update/restore still work.

### Phase 3 — balance-write fences (shared balance lock: projection + purge + create + restore) ☐
- Introduce a `Lock` in `TokenBalanceService`/`BalanceJobQueue` shared by `repo.set` (projection), `purgeForTokens`, `createTokenBalance` (the detached callbacks), and `restore`. Inject `deletionState`.
- `enqueue`: resolve owner `profileId` via `TokenService.getOwnerProfileId(token)`; if already gone, skip before creating a task; else capture `{profileId, epoch}` on the queued item.
- Before `repo.set` (projection) AND in the detached `createTokenBalance` AND in `restore`: under the shared balance lock, `isLive(profileId, epoch)` (+ live-owner identity) → SKIP (background) / restoreError (restore). `purgeForTokens` takes the same lock so check+write is atomic with purge.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services/token-balance` — deterministic pins (project hold-point): delete between check and set → no `repo.set`, no `onBalanceUpdated`; detached callback after purge → suppressed; restore into reserved → restoreError; successor-id reuse (owner mismatch) → skipped; normal projection writes.

### Phase 4 — coordinator direct unit test ☐
- `profile-deletion/coordinator.test.ts`: stub leaves record call order → assert every purge awaited, address-derived (txs/auth/balances) BEFORE the account/token/network tail, `pxe.clearProfileState` last, a leaf throw propagates. NB (audit finding 9): "tombstone retained on failure" is proven at the ProfileService integration layer (add a pin there), not here.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services/profile-deletion src/wallet/services/profile/service.integration.test.ts`.

### Phase 5 — reject duplicate old-token-id in relink ☐
- In `useFullBackupImport` relink: detect duplicated `token.id` in the backup slice (mirror `sourceIdCounts`); drop the collided rows to `restoreErrorLog` instead of collapsing `oldIdToChain`.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/composables/useFullBackupImport.test.ts` — pin: two `token.id:5` → map intact, collision recorded.

### Phase 6 — corrupt-tombstone TELEMETRY only (NO auto-repair — audit D-D) ☐
- `TombstoneRepository`: `validPayloads()` already skips corrupt. ADD only: a `corruptCount()/logCorrupt()` surfaced at coordinator resume (count + ids, warn) for manual recovery. **NO `repairOrphaned`/auto-drop** — a corrupt tombstone whose profile row is absent is a phase-1-done, purge-pending deletion; dropping it is fail-OPEN. Fail-closed stays.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services/profile/tombstone-repository.test.ts` — pins: corrupt row → counted + logged + RETAINED (still reserved); no drop path exists.

### Phase 7 — docs + index + e2e ☐
- `implementations-plan/index.md`: list BOTH plans; flip the parent § Follow-ups D13 note → "COMPLETE (backup-restore-residuals)".
- **Gate:** `bun run audit:vue` green · `bun run e2e:agent tests/e2e/network/backup-restore-integrity.test.ts` extended: during the delete→re-add round-trip, trigger a token-add + a balance-refresh mid-delete (with the deterministic hold-points wired through a test hook) and assert NO resurrected token/balance row.

## Security & Adversarial Considerations
Threat: a user/dapp action (add token, balance refresh) OR a fire-and-forget event callback OR a restore writer racing a profile delete → row resurrection in a purged/successor profile (same-user data-integrity + privacy). Also attacker-controlled backup dup-token-id. Fence = the proven monotonic-epoch mechanism, now RESERVATION-AWARE + atomic under each leaf lock (no new crypto, reuse `ProfileDeletionState`). No new storage roots or RPC. Audit asks: can a LEGIT add/refresh be wrongly rejected (false-positive, esp. after a profile switch → the owner-resolver must be active-profile-INDEPENDENT)? Can the tombstone telemetry ever drop a pending deletion (it must not — no drop path)? Does the live-owner identity check truly stop successor reuse? Are all writers covered (addToken, updateToken/clearChainState, token.restore, balance projection, detached createTokenBalance, balance.restore)?

## Assumptions
**Facts:** the v2 Load-bearing facts (fb61a63-verified). Epoch monotonic + never reset on release. `EventHandler.invoke` discards async promises (detached callbacks).
**Inferences (attack):** the full writer set above is COMPLETE (no other profile-owned-row writer completes post-purge). The shared leaf lock + reservation-aware `isLive` is atomic w.r.t. the coordinator's purge (which takes the same leaf lock). Enqueue/authorization is the correct capture point. Owner = the live token row's `profileId`.
**Asks (resolved by the dual audit, see ledger):** D-A fence adds/restores + lock chain-purge + defensive update assert; D-B/C enqueue capture + shared balance lock + reservation-aware; D-D telemetry only; helper-vs-inline → inline.

## Decision ledger (v2 — folds the dual audit)
| Fork | Decision | Source / rejected |
|---|---|---|
| Token scope (D-A) | Fence `addToken` + `token.restore`; add defensive `isLive` to `updateToken`; make `clearChainState` take the token lock. `updateToken` alone is purge-safe via reread. | codex #5 + Opus H1/H2. Rejected: fencing only `updateToken` (misses the real add vector). |
| Balance atomicity (D-B) | Shared balance `Lock` across projection/purge/create/restore; check `isLive` under it. | codex #2 (non-atomic "immediately before" is insufficient). Rejected: unlocked pre-set check. |
| Capture (D-C) | At enqueue/authorization, RESERVATION-AWARE (`isLive`, not bare `isCurrent`). | codex #3 (post-`beginDeletion` enqueue launders via new epoch; corrupt-tombstone epoch-0). Rejected: bare `isCurrent`; project-time capture. |
| Owner resolver | New internal `getOwnerProfileId` (active-profile-INDEPENDENT); compare live token `profileId`. | codex #7 (`getTokenRaw` active-gated → false-skip after switch; `(id,token,account)` recurs). |
| Writer set | +detached `onTokenAdded`/`onAccountAdded`→`createTokenBalance`, `TokenService.restore`, `TokenBalanceService.restore`, `addToken` journal-order. | codex #4/#6. Rejected: v1's 2-writer scope. |
| Helper vs inline | Per-service INLINE under the leaf lock. | codex #8 + Opus 3 (helper can't provide atomicity). |
| Tombstone (D-D) | TELEMETRY only, NO auto-drop. | codex #1 + Opus C3/D-D (fail-open during phase-2). Rejected: `repairOrphaned`. |
| Proof | Deterministic unit/integration pins w/ injected hold-points; e2e extended; coordinator test ≠ tombstone-retention proof. | codex #9. Rejected: polling-only e2e as proof. |

## Audit trail
- v1 dual audit (WRONG base, both caught it): `audit-codex.md`, `audit-fable.md`. v2 final fresh-codex pass appended to `audit-codex.md`. Both v1 legs also yielded the substantive findings folded above.

## Seeds
_(finalized post-approval — see eli5.html.)_
