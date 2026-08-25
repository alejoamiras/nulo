# Recon — shell-identity-fences (batch 6 of audit-448-remediation)

Base: dev `2665af59`. Two read-only sweeps (fence sites; N-09 removal inventory) + in-worktree grep closure of their honest gaps. Condensed; file:line for every claim.

## N-05 — the app.vue network watcher has no identity fence (Major)

- `apps/extension/src/popup/app.vue:100-131`: `watch(() => appStore.network, async …)` — 4 awaits (getAccounts, ensureDefaultAccount, getAccounts, setupActiveAccount) + syncTransactions, with post-await writes (`appStore.accounts = …` ×2) and ZERO fences. A superseded run survives `disconnect()` via pre-registration RPC immunity (base-client.ts:121 parks BEFORE `pending.set` :143; disconnect rejects only registered pendings) and lands a cross-chain active account.
- The pattern to mirror: `useProfileBootstrap.ts:45-102` — module-level generation counter, `isCurrent` closure captured per run, re-checked after EVERY await, bumped synchronously before the run's first await (:110-132). 12 tests incl. two superseded-generation cases.
- app.vue has NO test file — the fence needs extraction or an e2e-adjacent pin.

## N-08 — auth.vue unlock continuation (Major, split verdict)

- `auth.vue:45` `isAwaitingResponse`; `handleUnlockWallet` :83-142: the busy-wait `while (!appStore.isLogined) { await sleep(100) }` (:100-102) has no identity check, no bound — the `finally` releasing the latch (:121-123) is UNREACHABLE if the flag never flips → bricked spinner + permanently-disabled submit (the adjudicated REAL half). Post-wait writes :125-138 are unguarded (profile/account/tx-service/navigation) — the stale-hijack half (rare).
- Contributing: `app.vue` `onActiveProfileChanged` :140-166 — `await bootstrapActiveProfile(profile)` (:145) has no try/catch in the emitter callback; a rejected bootstrap RPC starves the busy-wait (exactly the spinner brick).
- One guard fixes both halves (adjudication): bound the wait + identity-guard the continuation (`appStore.profile?.id !== activeProfile.id → return`), and wrap the bootstrap call so failure releases the latch path.
- auth.test.ts: 5 cases, none touch this class.

## N-23 — RecentActivityView reset keyed on address only (Low)

- `RecentActivityView.vue:707-720` watches `appStore.account?.address` with `flush: "sync"`; same-address profile switch (same-mnemonic imports) no-ops (`nv === ov`) → A's executing-task progress card renders under B (`hasOrphanExecutingTask` :454-464); B's rows invisible until an unrelated event. The render filter `journalRecordInScope` :281-294 ALREADY checks the full triple — the gap is the reset/reload trigger only. Post-await guards inside `resnapshotJournal` (:591-608) and `loadExecutingTaskSnapshot` (:681-696) capture the same narrow key.
- Mirror: `useIncomingTransfers.ts:64-65,118-128` `scopeKey` = `${profileId} ${networkId} ${account}` watch — the composable this very component consumes.
- RESOLVED at recon: `TaskService` clears its map on profile-identity change (task/service.ts:245-253), so post-switch `getTasks()` is empty — `isExecutingTask`'s senderAddress-only check (TransferContent carries no profile/network) is moot after a switch; the fix stays S (watcher key + the two captured guards widened to the triple).
- RecentActivityView.test.ts: 7 cases, all address-change-driven; the same-address profile-switch case is absent (harness already separates profile/account fields — cheap to add).

## N-22 — EditProfilePopup silent catch (Minor)

- `EditProfilePopup.vue:82-89`: `catch (err) {}` — the sole silent outlier among 12 popup-family consumers. Copy `EditAccountPopup.vue:60-68`'s block verbatim (family standard, byte-identical in EditNetworkPopup/NewContactPopup/EditContactPopup): `catch { openToast({ label: "Something went wrong", icon: "warning" }, TOAST_DURATION.LONG); return }`. Must add `TOAST_DURATION` to the `:6` import. EditProfilePopup.test.ts: 12 cases, openToast mock already wired; the rejection case is absent.

## N-09 — REMOVAL (owner-authorized, decision of record in the adjudication)

Verified item-by-item at dev 2665af59; two additions beyond the runbook; grep-closed in-worktree.

**Delete:**
- `apps/extension/src/composables/notification.js` ENTIRE FILE — `getTemplate` (aztecReset is its only case) + `checkNotificationsForShow`; every import in the file serves only that path; no colocated test.
- `auth.vue:15` import + `:138` call; `auth.test.ts:25` mock line.
- `utils/core.ts:186-194` (`sentinelPath`, `setSentinel`, `checkSentinel`) **+ the now-unused `storageLocalGet, storageLocalSet` import (:29 — used nowhere else in core.ts)** [beyond-runbook #1].
- The four `setSentinel` call sites + imports: `profile/new-profile-helpers.ts:3,:41`; popup `pages/import.vue:20,:76`; onboarding `pages/create.vue:12,:53`; onboarding `pages/import.vue:13,:44` (three of the four import lines carry setSentinel as the SOLE name — whole line drops).
- `new-profile-helpers.test.ts`: the 4 setSentinel assertions (:7-11 mock, :28 import, :72, :82 ordering, :90 negative).
- `package.json:7` `"sentinel": "8"`; `vite.shared.ts:39` `__SENTINEL__` define; **`types/vite-env.d.ts:5` ambient `declare const __SENTINEL__`** [beyond-runbook #2].
- **TWO e2e specs assert the stamp** [grep-closure find]: `tests/e2e/import-paths.test.ts:116,:119` and `tests/e2e/passkey-backup.test.ts:493,:497` — drop the `nulo:ui:sentinel` key from the get + the truthy expect (the specs' other assertions stand).
- `types/auto-imports.d.ts` / `.eslintrc-auto-import.json` are GENERATED — regenerate, never hand-edit.
- `tests/e2e/sentinel.ts` is UNRELATED boot-sentinel e2e infra — KEEP (name collision only).

**Survivors (the notification system stays live):** `stores/notification.store.ts` + `NotificationManager.vue` (mounted in BOTH shells: popup app.vue:295, onboarding app.vue:87) with three inline producers that never used getTemplate: "Profile creation failed" (popup profile/new.vue:70-82 + onboarding create.vue:56-69), "Profile import failed" (popup import.vue:135-147 + onboarding import.vue:108-120), "Import completed with errors" (onboarding import.vue:96-107).

**Safety corroboration:** UPDATE.md (the real @aztec bump procedure) never references the sentinel; e2e fixtures' `registerProfile()` stamps it during setup so the gate was structurally a no-op in e2e; `nulo:ui:sentinel` orphan storage key needs no migration pre-production (CLAUDE.md).

## Cross-cutting

- app.vue is touched by BOTH N-05 (network watcher) and N-08 (onActiveProfileChanged) and N-09 (auth.vue neighbor) — separate hunks, one file.
- The audit's cross-cutting note suggests a shared fence helper for the N-04/05/08/09/10 family — batch 3 shipped `trackProfileSwitchEpoch` for the SW side; the popup side has `useProfileBootstrap`'s generation pattern. Extracting a shared popup-side helper is a design decision for the plan (candidate: a tiny `createRunFence()` composable-adjacent util; counter-candidate: inline per-site captures, smaller diff).
- Smoke e2e REQUIRED (popup/UI touched); network e2e also (import-paths + passkey-backup spec edits are network suite members).
