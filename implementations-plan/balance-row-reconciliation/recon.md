# recon — balance-row reconciliation

Read-only codebase recon (blueprint Phase 0.4) against this worktree's base `origin/dev` @ `23228d1d`
(the merged first-account seeding fix, #485). Two batched `Explore` agents: a capability reuse sweep
and a full balance-row lifecycle map.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Boot-time repair pass, awaited, failure-isolated | `account/service.ts:106-123` + `:132-139` — `sweepOrphanImportedKeys` runs inside `init()` wrapped in its own try/catch so a sweep failure can't wedge service start; safe without a lock because `init()` is awaited before any RPC/event can interleave (`:114-117`) | **adapt** — closest structural precedent |
| Build-desired-set-off-map → fence → commit | `incoming-transfer/service.ts:715-773` `hydrateSchedulers` — runs at init, on profile switch, and on `onAccountAdded`; bumps `serviceEpoch` at entry (`:716`) and re-checks synchronously before an atomic swap (`:756-772`) | **adapt** — the fencing idiom, collapsed onto `profileGeneration` |
| Boot sweep + periodic tick sharing one method | `operation-journal/reaper.ts:127-154`, `:178-241`; `gc.ts:64-147`. Per-record CAS (`transitionIfStage(..., {ifUpdatedAtIs})`, `reaper.ts:222-227`) rather than a global lock | **adapt** — the "stale snapshot, guard the per-row write" shape |
| Fire-and-forget boot verification | `account-integrity/coordinator.ts:65-85` — deliberately NOT awaited so it can't stall other services' RPCs; skips re-work via a stamp cache (`:98-104`) | **consider** — see Open question 3 (awaited vs detached) |
| Id allocation | `id-allocators.ts:17-37` `nextNumericId` → `balance-repository.ts:60-64` → `service.ts:211-213` `allocateUnfencedId` → already called by `createTokenBalance` (`:216`) | **reuse-as-is, transitively** — route creations through `createTokenBalance` and inherit it |
| Generation fencing | `service.ts:66` declaration, sole bump at `:256`, re-checked at `:219`, `:231`, `:277`, `:279`, `:290`, `:293`, `:296`, `:298`, `:304`, `:308`, `:311`, `:270`, and live via `getGeneration` (`:115` → `balance-job-queue.ts:202,279,188`) | **reuse-as-is** — capture before first await, re-check with zero await gap before every mutation |
| Deletion-epoch fence | `restore-fence.ts:19-27`, `:35-44`; only call site in this service is `restore()` (`service.ts:414-424`) | **not applicable** — guards `deleteProfile`-during-restore; balance rows carry no `profileId` to key it on |
| Orphan-row purge helpers | `purge-rows.ts:21-26`, `:58-84`, `:93-97`; `require-owned-row.ts:12-17` | **not applicable** — deletion-direction only, and `TokenBalanceRaw` has no `profileId` for `requireOwnedRow` |
| Best-effort per-row write loop | `restore-rows.ts:22-35` | **adapt the idiom, don't call it** — its `Restored<T>`/`restoreError` vocabulary is backup-import-specific |
| Unit-test harness | `token-balance/service.test.ts:247-422` — real `ServiceCollection` + `svc()` stubs + `FakeBrowserApi` + a test-side `seedRepo` + `noopTicker`; drives profile switches with manually-held resolvers | **reuse-as-is** — extend this describe block |
| Queue-level test harness | `balance-job-queue.test.ts` — `makeTaskService()`, `makeRepo(seeded)`, `makeProjector(results)`, `FakeBackgroundTicker`; 26 tests incl. 3 generation-fence pins (`:576-643`) | **reuse-as-is** if queue behavior is touched |
| Assets-view / balance-row e2e helpers | `tests/e2e/fixtures/helpers.ts:1316-1347` `captureBalanceBaseline`, `:1367-1483` `waitForFreshBalanceRow`, `:1490-1504` `waitForTokenCardAmount` | **reuse-as-is** for the post-recovery assertion |
| Kill the SW at an arbitrary moment | `stopServiceWorker` — near-identical copies in **5** files (`sw-resilience.test.ts:29-56`, `sw-restart-network.test.ts`, `network/connect-locked-queue-sw-restart.test.ts`, `network/cold-wake-discovery.test.ts`, `network/backup-restore-sw-restart.test.ts`). Uses `worker.close()` (the only Puppeteer call that actually terminates an MV3 SW) + an identity-keyed `targetdestroyed` listener | **reuse-as-is in spirit** — but only available by copy-paste today |
| Kill the SW at a *chosen code point* | **Nothing at the token→balance boundary.** The rendezvous-gate family exists 3× — `restore-gate` (`src/e2e/restore-gate.ts` + `chrome-storage-restore-gate.ts` + `tests/e2e/fixtures/restore-gate.ts`), `incoming-poll-gate`, `proof-gate` — all `chrome.storage.session` arm→`held:true`→release protocols, injected only under `E2E_PROVERLESS` in `runtime.ts:342-347` | **build new (4th instance)** — see Open question 4 |
| Backup/footprint registration | `backup-migration-registry.ts:205` already registers `TOKEN_BALANCE_STORAGE_ROOT`; not in `BACKUP_BLOCKED_ROOTS` (`:233`) | **reuse-as-is** — no new registration; `footprint-coverage.test.ts` governs *migrations*, orthogonal to a runtime write path |

## Absence claims + search trails

- **No existing balance-row reconcile.** `grep -rniE "reconcile|sweep|repair|backfill|hydrate|rebuild|\baudit\b|orphan" apps/extension/src/wallet/services/ --include="*.ts"` (355 hits, all triaged). Five repair precedents exist; none targets token-balance.
- **No `Lock`/`KeyedLock` in `TokenBalanceService`.** Contrast `TokenService.persistToken`, which wraps `nextNumericId` in `this.lock.withLock(...)` (`token/service.ts:279,298`).
- **No `onAccountDeleted` subscriber in `TokenBalanceService`.** Its subscriptions are exactly `service.ts:120-125`.
- **No hard cap on accounts-per-chain or tokens-per-profile** — index allocation is open-ended (`account/service.ts:235`; token `nextNumericId`).
- **No perf assertion/budget test anywhere.** The only convention is a `Debug`-level elapsed-ms log (`balance-job-queue.ts:152-167`, `transaction/service.ts:377`).

## Two premises in the task brief that recon DISPROVED

1. **"Hidden accounts / imported accounts legitimately have no balance row" — false.** `onAccountAdded` (`service.ts:278`) doesn't discriminate on `account.type`, and a newly-created account is always `visible: true` (`account/service.ts:249`); visibility changes later via `changeAccountVisibility` (`:287-303`) which does not re-fire the event. Hidden accounts keep their rows on purpose — `onTokenAdded` passes `all: true` (`service.ts:295`) precisely to cover them.
2. **"Incomplete tokens legitimately have no balance row" — false.** `isTokenComplete` (`token/utils.ts:18-27`) is enforced only in the UI (`NewTokenPopup.vue:196-200`), never in `addToken`/`persistToken`. An incomplete token gets an ordinary balance row; `BalanceProjector` treats the missing side as `"0"` (`balance-projector.ts:135-137,151-154`).

Both corrections matter: a reconcile that "skips hidden accounts" or "skips incomplete tokens" would under-create, and a cleanup pass built on either premise would wrongly delete legitimate rows.

## What genuinely makes the naive design wrong

1. **Id allocation has no lock, and events dispatch un-awaited.** `allocateUnfencedId` (`service.ts:211-213`) is a bare read-then-compute; `EventHandler.invoke` (`packages/wallet-core/src/utils/event-handler.ts:47-61`) and `Service.emit` (`base-service.ts:129-133`) are synchronous and do not await async subscribers. The two existing callers are safe only because each awaits `createTokenBalance` **sequentially in a `for` loop** (`service.ts:280`, `:299`). Two concurrent creators read the same pre-write `getKeys()` snapshot, compute the same id, and the second `repo.set` silently **overwrites** the first — a row vanishes with no `onTokenBalanceDeleted`. **This is a live pre-existing hazard, not merely a reconcile hazard** (`onAccountAdded` and `onTokenAdded` can fire concurrently from independent RPCs). A reconcile increases the number of concurrent creators.
2. **`all: true` is mandatory.** The default visible-only `getAccounts` (`account/service.ts:160-173`) under-covers hidden accounts, and any diff-based cleanup built on it would delete their legitimate rows.
3. **The chain join must be manual.** `TokenBalanceRaw` (`spec.ts:30-38`) has **no `chainId` and no `profileId`** — scoping is construction discipline at each write site. Nothing in the schema stops pairing a mainnet token with a testnet account.
4. **Not every unexplained row is garbage.** `restore()` (`service.ts:406-427`) can legitimately create a row for a token id not yet restored; foreign-profile rows physically coexist and stay invisible via `this.tokens.has()` (`:156`); a chain-purge cascade may still be draining (see 5).
5. **No pair-level create-vs-delete fence exists.** `profileGeneration` fences profile switches only; `invalidatedBalanceIds` protects *existing* ids mid-delete (`balance-job-queue.ts:184-185,266-269`) and cannot protect a not-yet-allocated id. `createTokenBalance` does not re-verify token/account liveness immediately before `repo.set`. Worse, `TokenService.clearChainState`'s `onTokenDeleted` emit is un-awaited, so `deleteNetwork()` can resolve while balance deletion is still draining.
6. **Every `getAll()`/`getKeys()`/`getAccounts()` reads the ENTIRE `chrome.storage.local` namespace** and filters client-side (`entity_storage.ts:8-10,194-224`; one shared adapter wired at `chrome-browser-api.ts:69`). `existsByTokenAndAccount` (`balance-repository.ts:69-72`) pays that cost per call. Per-pair existence checks inside the reconcile loop would multiply a full-storage read by the pair count. Batch once, filter in memory — the pattern `getTokenBalances` (`service.ts:146-159`) already uses.

## Adjacent defects recon surfaced (in scope? — Open question 1)

- **Silent row loss from concurrent id allocation** (item 1 above). Pre-existing; the reconcile makes it more reachable.
- **Orphaned rows on imported-account removal.** `AccountService.reconcileImportedAccounts` (`account/service.ts:785-797`) fires `onAccountDeleted`, which `TokenBalanceService` does not subscribe to. Dropping a zombie imported account without touching tokens or the profile leaves its balance rows permanently orphaned — and if the user later re-imports the same key (same deterministic address), the stale row **silently reattaches with pre-deletion balances** until the queue happens to resync it.

## Collision / dedup risks

- **Do not re-derive id allocation, emit, or enqueue** — route every creation through the existing `createTokenBalance` (`service.ts:215-234`), which already embeds the correct fence-and-write shape.
- **Do not add a second coalescing/epoch mechanism** — `profileGeneration` is the established fence and is already pinned by three tests (`service.test.ts:247-422`) and three queue tests (`balance-job-queue.test.ts:576-643`).
- **Do not call `restoreRows()`** — wrong vocabulary for a silent boot pass.
- **Do not register anything new in the backup slice registry** — `TOKEN_BALANCE_STORAGE_ROOT` is already covered (`backup-migration-registry.ts:205`).
- **Do not copy `stopServiceWorker` a 6th time** if an e2e needs it — consolidating the existing 5 copies is the cheaper drive-by.
