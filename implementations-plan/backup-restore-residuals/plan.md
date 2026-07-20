# backup-restore-residuals — finish D13 to zero deferrals + low-severity cleanups

> ## OUTCOME (read first)
> **7 audit passes** (5 codex xhigh + 2 Opus) unanimously proved that the two D13 SECURITY fences (token-metadata + balance-projection) CANNOT be closed to provable zero-resurrection as one PR — they decompose into a wallet-wide deletion-concurrency redesign across ~10 leaf services + a service-worker leaf-draining protocol + a token↔network lock-order redesign (the "atomic" fix INTRODUCES an ABBA deadlock) + a **novel cross-process PXE offscreen-barrier generation fence** (a SW `isLive` check provably can't fence the offscreen worker). codex NO-GO'd the design until those are built explicitly. Both auditors: the parent arc's **deferral was the correct pre-production call.**
>
> **SHIPPED (this PR):** the 4 low-severity, deadlock-free cleanups — a direct `coordinator.test.ts` (awaited order + pxe-last + fail-fast + single-flight), corrupt-tombstone **TELEMETRY** (`corruptIds` surfaced at resume; auto-repair REJECTED by both auditors as fail-open), the confirmation that **dup-token-id is already blocked upstream** by backup normalization (documented, no redundant code), and the `index.md` entries.
> **DEFERRED (tracked epic):** the token-metadata + balance-projection epoch fences → a deliberate deep/mega-deep multi-PR effort. The v1→v3 design below + `audit-codex.md`/`audit-fable.md` (7 passes) are its ~80%-complete design doc.

## (v3 DEEP design history — the epic's blueprint, NOT shipped here)

**Tier: `deep`** (ESCALATED from mid — the final fresh-codex pass on v2 surfaced 2 criticals: the leaf purges are NOT lock-atomic with their writers, and the writer set spans 5 leaf services (token, balance, account, incoming-transfer, operation-journal). Rubric: security HIGH + blast-radius HIGH (a cross-cutting concurrency change to the deletion purge + every leaf's write lock). Still ONE mechanism (the proven monotonic epoch fence) but the correct fix is architectural, not a per-writer patch. Branch off `dev` → `dev`, ONE PR.

> **The core architectural fix (v3):** D13 resurrection is closed by TWO invariants applied UNIFORMLY to every profile-owned-row leaf:
> 1. **Atomic purge** — each leaf's `purgeFor*` holds the leaf's write lock across its ENTIRE snapshot-and-delete (NOT snapshot-outside-then-lock-per-row). This is the fix for codex-final C1: today `token.purgeForProfile` (`token/service.ts:549`) snapshots at :552 outside the lock, so a concurrent writer's in-flight `set` is missed.
> 2. **isLive writer gate** — every writer re-checks `isLive(profileId, capturedEpoch) = !isReserved && isCurrent` UNDER that same leaf lock, immediately before its write.
> Together they linearize writer↔purge on one lock: write-before-purge → the row is snapshotted + deleted; purge-before-write → `isLive` is false → skip/throw. No TOCTOU (isLive reads are synchronous, no await).

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

## Fence design (v3 — atomic purge + isLive gate, uniform across leaves)
1. **Primitive:** `ProfileDeletionState.isLive(id, capturedEpoch) = !isReserved(id) && isCurrent(id, capturedEpoch)` (reservation-aware — closes codex C3: a post-`beginDeletion` enqueue captures the new epoch so bare `isCurrent` stays true; `isReserved` catches it; corrupt-tombstone epoch-0-reserved also caught). Capture `{profileId, epoch}` at authorization while NOT reserved. Reads are synchronous → no TOCTOU.
2. **Atomic purge (the load-bearing v3 change):** refactor each leaf's `purgeFor*` to hold the leaf write lock across the WHOLE snapshot-and-delete. Per leaf: `token.purgeForProfile`, `token-balance.purgeForTokens`, `account.purgeForProfile`, `incoming.clearProfile`, `operation-journal.purgeForProfile`. (Networks/PXE/tx/auth are already awaited + tx is fenced; confirm they hold their lock across snapshot-delete too.)
3. **isLive writer gate, inline under the leaf lock (NOT a helper — codex #8: a helper can't give atomicity):** every writer re-checks `isLive` under the same leaf lock, immediately before its write.
4. **Owner resolver:** INTERNAL, active-profile-INDEPENDENT `TokenService.getOwnerProfileId(tokenId)` (raw token row's `profileId`) — the balance fence resolves the authoritative owner. Compare the LIVE token's `profileId` to the captured profile (defeats successor-id reuse; `(id,token,account)` alone recurs — codex #7).
5. **Profile-switch policy (codex-final medium):** `balance-projector` still uses active-gated `getTokenRaw` (`:64,:114`). A queued P1 refresh after switching to P2 is SKIPPED — declared POLICY (the balance is stale-not-wrong; re-refreshes on switch-back). Pin it so it's intentional, not an accidental false-skip.
6. **Policy:** user/dapp writes (addToken, createAccount) THROW on a dead fence; background refreshes (balance projection, detached onTokenAdded/onAccountAdded callbacks) SKIP; restores THROW (`restoreError`); journal create/transition on a dead fence → no-op.

## Full writer inventory (codex-enumerated — the "no writer left behind" set)
| Leaf | Writer(s) | Purge counterpart | Fence action |
|---|---|---|---|
| token | `addToken:132`, `updateToken:224`, `restore:571` | `purgeForProfile:549` (+ `clearChainState:~94`) | atomic purge + isLive gate on all 3; clearChainState takes the token lock; addToken journal-op created inside the fence (no post-delete journal row — codex #6) |
| token-balance | projection `repo.set` (`balance-job-queue:151`), detached `createTokenBalance` (`service:156-168,198-209`), `restore:296` | `purgeForTokens:227` | shared balance Lock across all + purge; isLive under it |
| account | `createAccountInternal:108` (writes `:125` after `NuloAccount.new` pause) | `purgeForProfile` | atomic purge + isLive gate; share the per-tuple serialization with purge |
| incoming-transfer | `onTokenAdded:440` (trust write `:458-462`, detached) | `clearProfile` | atomic purge + isLive gate under `serviceLock` |
| operation-journal | `createOperation:160`, transitions (`:235`→`:303`) | `purgeForProfile` | atomic purge + isLive gate on create + transition |

## Phases

### Phase 1 — fence primitive + shared-state wiring ☐
- `ProfileDeletionState.isLive(id, epoch)` (reservation-aware) + unit pins (reserved→false; stale epoch→false; corrupt-tombstone epoch-0-reserved→false; live→true).
- Inject `deletionState` (`getDeletionState()`) into every leaf that will fence: TokenService, TokenBalanceService, AccountService, IncomingTransferService, OperationJournalService. Add internal active-independent `TokenService.getOwnerProfileId(tokenId)`.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services/profile/profile-deletion-state.test.ts`.

### Phase 2 — ATOMIC PURGE refactor (the load-bearing v3 change) ☐
- Refactor each leaf `purgeFor*` to hold the leaf write lock across the WHOLE snapshot-and-delete (currently they snapshot-outside-then-lock-per-row — codex C1): `token.purgeForProfile`, `token-balance.purgeForTokens`, `account.purgeForProfile`, `incoming.clearProfile`, `operation-journal.purgeForProfile`. Verify the already-awaited leaves (networks/pxe, tx, auth) also snapshot-and-delete under one lock; fix any that don't.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services` (no regression in the existing purge/cross-profile-isolation suites) — plus a pin per refactored leaf that a writer racing the purge (write-before-purge ordering) ends with the row DELETED (linearizable), via an injected purge hold-point.

### Phase 3 — token-write fences (add/update/clearChainState/restore + journal order) ☐
- `addToken`: capture epoch at entry (before `fetchTokenMetadata`); re-check `isLive` under `this.lock` immediately before `tokens.set` → THROW if dead; the journal op is created/committed INSIDE the fence (no post-delete journal row — codex #6).
- `updateToken`: explicit `isLive` assert under the lock before `set`. `clearChainState`: take `this.lock`. `restore`: fence each row → `restoreError` on dead.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services/token` — deterministic pins (metadata-fetch hold-point): add mid-delete → THROW + not written + no orphan journal; chain-purge mid-update → not rewritten; restore into reserved → restoreError; normals still work.

### Phase 4 — balance-write fences (shared balance lock + owner resolver + switch policy) ☐
- Shared `Lock` in `TokenBalanceService`/`BalanceJobQueue` across projection `repo.set`, `purgeForTokens`, the detached `createTokenBalance` (onTokenAdded/onAccountAdded), and `restore`. `enqueue`: resolve owner via `getOwnerProfileId`; skip-before-task if gone; else capture `{profileId, epoch}`.
- Under the shared lock before each write: `isLive` (+ live-owner identity) → SKIP (background) / restoreError (restore). The profile-switch skip (`balance-projector` active-gated `getTokenRaw`) is declared POLICY + pinned.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services/token-balance` — deterministic pins (project hold-point): purge-before-set → no set/no `onBalanceUpdated`; write-before-purge → row ends deleted; detached callback after purge → suppressed; restore into reserved → restoreError; successor-id owner-mismatch → skipped; profile-switch → skipped-by-policy; normal writes.

### Phase 5 — account / incoming-transfer / operation-journal write fences ☐
- **account** (`createAccountInternal:108`): capture epoch before `NuloAccount.new`; `isLive` under the per-tuple serialization (shared with `purgeForProfile`) before the `:125` write → THROW on dead. (Account creation needs the session secret; a delete closes the session — confirm + pin the capture-then-delete window.)
- **incoming-transfer** (`onTokenAdded:440` → trust write `:458-462`): `isLive` under `serviceLock` before the trust write → SKIP on dead (detached callback).
- **operation-journal** (`createOperation:160`, transitions `:235`→`:303`): `isLive` under the journal lock before create + before the transition write → no-op on dead.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services/account src/wallet/services/incoming-transfer src/wallet/services/operation-journal` — deterministic pins (hold-point per writer): each writer racing its purge → no resurrected row; normals work.

### Phase 6 — coordinator direct unit test ☐
- `profile-deletion/coordinator.test.ts`: stub leaves record call order → assert every purge awaited, address-derived (txs/auth/balances) BEFORE the account/token/network tail, `pxe.clearProfileState` last, a leaf throw propagates. NB (audit finding 9): "tombstone retained on failure" is proven at the ProfileService integration layer (add a pin there), not here.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services/profile-deletion src/wallet/services/profile/service.integration.test.ts`.

### Phase 7 — reject duplicate old-token-id in relink ☐
- In `useFullBackupImport` relink: detect duplicated `token.id` in the backup slice (mirror `sourceIdCounts`); drop the collided rows to `restoreErrorLog` instead of collapsing `oldIdToChain`.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/composables/useFullBackupImport.test.ts` — pin: two `token.id:5` → map intact, collision recorded.

### Phase 8 — corrupt-tombstone TELEMETRY only (NO auto-repair — audit D-D) ☐
- `TombstoneRepository`: `validPayloads()` already skips corrupt. ADD only: a `corruptCount()/logCorrupt()` surfaced at coordinator resume (count + ids, warn) for manual recovery. **NO `repairOrphaned`/auto-drop** — a corrupt tombstone whose profile row is absent is a phase-1-done, purge-pending deletion; dropping it is fail-OPEN. Fail-closed stays.
- **Gate:** typecheck 0 · lint 0 · `vitest run src/wallet/services/profile/tombstone-repository.test.ts` — pins: corrupt row → counted + logged + RETAINED (still reserved); no drop path exists.

### Phase 9 — docs + index + e2e ☐
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
| **Atomic purge (v3/codex-final C1)** | Each leaf `purgeFor*` holds the leaf lock across the WHOLE snapshot-and-delete (not snapshot-outside-then-lock-per-row). This is what actually linearizes writer↔purge; the isLive gate alone is insufficient because the purge's snapshot misses an in-flight write. | codex-final C1. Rejected: v2's "isLive under the lock before write" WITHOUT the atomic-purge refactor. |
| **Writer set = 5 leaves (v3/codex-final C2)** | +account (`createAccountInternal`), +incoming-transfer trust (`onTokenAdded`), +operation-journal (`createOperation`/transition). | codex-final C2. Rejected: v2's token+balance-only scope. |
| **Profile-switch skip** | Declared POLICY (queued P1 refresh after switch→P2 is skipped; stale-not-wrong; re-refreshes on switch-back) + pinned, rather than re-plumbing profile-bound projection deps. | codex-final medium. |
| **Tier** | ESCALATED mid→deep (2 criticals in the final v2 pass triggered the plan's own escalation rule + codex's explicit call). | codex-final. |

## Audit trail
- v1 dual audit (WRONG base, both caught it): `audit-codex.md`, `audit-fable.md`. v2 final fresh-codex pass appended to `audit-codex.md`. Both v1 legs also yielded the substantive findings folded above.

## Seeds
_(finalized post-approval — see eli5.html.)_
