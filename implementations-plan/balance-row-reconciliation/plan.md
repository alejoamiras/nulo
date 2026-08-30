# balance-row-reconciliation — repair the two worker-death windows that strand a token

**Tier:** `mid` (escalated from `light` at recon; both auditors confirmed). **`eli5_mode`:** Artifact.
**Budget:** recon 2 agents · competing outline + codex/fable dual audit + re-audit to convergence · `/code-review` **medium** · codex fix loop ≤3 rounds.
**Base:** `origin/dev` @ `23228d1d` (the merged #485 seeding fix). **Worktree/branch:** `balance-row-reconciliation` / `worktree-balance-row-reconciliation`.
**Owner standing preference:** the most durable, testable, modularized solution — not the smallest hack. All open questions routed to codex + the fable reviewer, never to the owner.

## Problem — two windows, two symptoms

`createTokenBalance` (`token-balance/service.ts:215-234`) does three things in sequence: allocate an id, `repo.set` the row (`:228`), then `emit` + `queue.enqueue` (`:232-233`). An MV3 worker death can land in either gap, and **nothing repairs either one**:

| Window | Residual state | What the user sees |
|---|---|---|
| Before `repo.set` | token row exists, **no balance row** | token is **invisible** — `getTokenBalances` returns rows filtered by active account (`:146-159`), `TokensView.vue:309` renders only those |
| After `repo.set`, before `enqueue` | balance row exists at `updatedAt: 0`, **no queued work** | token card stuck **"Loading balance…" forever** — `TokenCard.vue:52` treats `updatedAt === 0` as never-synced, and there is no ambient periodic resync |

Rows are created in only two event handlers (`onAccountAdded` `:276-282`, `onTokenAdded` `:284-301`); neither `init()` (`:127-134`) nor `onActiveProfileChanged` (`:255-274`) reconciles — both only rebuild the in-memory token map.

This is the residual tail of #485: after seeding persists a default token, `onTokenAdded` fires un-awaited (`base-service.ts:129-133`), so a worker death mid-backfill reproduces the owner's original "no default tokens" report by another route — or the loading-forever variant.

## Architecture & Implementation — the consolidated shape

Outline A (additive create-only pass) was **rejected by both auditors**; Outline B (repository-owned `ensureRow`) was rejected as the right invariant at the wrong layer with a disqualifying per-pair cost. The adopted design is the third shape both converged on independently.

### 1. One service-owned mutation lock

`TokenBalanceService` gains `private readonly lock = new Lock(...)` (`packages/wallet-core/src/utils/lock.ts:17`), placed on the **service**, mirroring `TokenService.persistToken` (`token/service.ts:279`). Not on `BalanceRepository`: the repository is a storage-ownership seam and cannot see generation checks, token liveness, emits, or queue behavior.

**Constructed with `maxHoldMs: null`.** The default 5-minute watchdog force-releases, which `lock.ts:29-34` and `:138-142` document as admitting "a second critical section into a legitimately-running one" — precisely the allocator invariant this lock exists to protect. Holds here are data-dependent (the balance Cartesian product has no cap; the extension has `unlimitedStorage`), so queueing is the correct semantic and the watchdog must be off.

**Four ensure callers, plus one separate locked restore writer.** `onAccountAdded`, `onTokenAdded`, the init sweep and the profile-switch sweep share the idempotent ensure path. **`restore()` shares the lock but NOT the ensure semantics** — one whole-batch acquisition around its `restoreRows` loop, mirroring `TokenService.restore` (`token/service.ts:713`), retaining only `TokenBalanceRawSchema.parse` and `assertRestoreEpoch`. It must **not** run through pair dedup, zero-initialization, the generation check, active-map membership, emit, or enqueue.

**Why restore cannot take the ensure path:** full-backup balances are restored *before* the imported profile is activated — `useFullBackupImport.ts:900-905` is explicit ("Late activation: open the session NOW that all backup data is in storage"), and the slice-restore loop at `:890-895` runs ahead of it. Restored token ids are therefore intentionally absent from the active map at write time, so applying active-map authorization to restore would **reject every restored balance and silently break full-backup import**.

**`purgeForTokens` (`:328-347`) also joins the lock** — profile deletion invokes it directly (`profile-deletion/coordinator.ts:116-121`), and its typed snapshot, deletes and raw purge currently run unlocked, so a creation whose `repo.set` settles after that snapshot survives profile deletion. Both the typed and raw passes go under the same hold.

**Nested acquisition must be structurally impossible.** The lock is non-reentrant, so every internal callee takes an explicitly named `…HoldingLock` form (the convention `TokenService._deleteTokenByIdHoldingLock` already uses) and only the outermost entry point acquires.

The critical section covers **read → diff → allocate → write**, not merely allocation. Pre-loop reads that don't need serializing (`getTokenRaw`, the account read) stay outside the hold.

**Why a lock is mandatory** — the draft's "strictly sequential is sufficient" was refuted twice over:
- `onActiveProfileChanged` has ≥2 async subscribers: `TokenBalanceService` (`:120`) **and** `TokenService.onActiveProfileChangedSeed` (`token/service.ts:127`), which runs `seeder.run()` → `persist` → `emit("onTokenAdded")` → a second `createTokenBalance` loop. `EventHandler.invoke` (`event-handler.ts:47-61`) dispatches un-awaited, so a sweep on the switch tail is **guaranteed** a concurrent creator.
- `init()` subscribes at `:120-125` **before** it awaits at `:127`/`:129`, and RPC handlers are live during `services.start()` (`runtime.ts:435`) — so init is not quiescent either.

Without the lock, two creators read the same pre-write `getKeys()` snapshot, compute the same id, and the later `repo.set` silently overwrites — a row vanishes with no `onTokenBalanceDeleted` (window: `id-allocators.ts:17-37`, no lock at `:211-213`). The sweep would add a third concurrent creator, making a live bug more reachable.

### 2. One idempotent ensure path

The **four** ensure callers route through one method that, under the hold: reads existing rows once, builds desired pairs, diffs, and creates only what's missing — updating the in-memory existing-pair set after each creation so the batch is self-consistent without re-reading. Restore is the fifth writer and is deliberately outside this path (§1).

### 3. Repair both windows

- **Missing row** → create it.
- **Never-projected row** (`updatedAt === 0 && syncFailure === undefined`) → **enqueue it**. This is the second window; create-only would leave those cards spinning forever. `syncFailure === undefined` distinguishes "never ran" from "ran and failed" (which the queue already owns).

### 4. One profile-wide account read

`getAccountsRaw(profileId)` (`account/service.ts:564-567`) — one read, all chains, no visibility parameter — grouped by `chainId` in memory, replacing N per-chain `getAccounts(…, all: true)` calls. This removes the `all: true` footgun **structurally** rather than by remembering a boolean, and cuts steady state from `1 + N` full-namespace reads to 2.

Every `getAll`/`getKeys`/`getAccounts` deserializes the entire `chrome.storage.local` namespace and filters client-side (`entity_storage.ts:194-224`; one shared adapter at `chrome-browser-api.ts:69`), so read *count* is the whole cost model.

### 5. Token-deletion safety

`onTokenDeleted` (`:317-324`) removes the token from `this.tokens` **synchronously**, then purges under the same lock. Immediately before any new write, re-check the generation **and** token liveness — the existing generation fence covers profile changes only, not token deletion.

**Liveness is an identity comparison, not `tokens.has(id)`.** Token ids are allocated `max+1` (`id-allocators.ts:17-37`) and are therefore **not monotonic over time**: deleting the highest token frees its id for reuse, which `token/service.ts:681-684` already warns about ("a successor that reuses the highest token id"). An in-flight creation for an old token would see the reused id present and pass a bare membership check. Compare the current map entry's stable identity — `profileId`, `chainId`, `contract` — against the captured token.

### 6. Pure diff module

`token-balance/reconcile-pairs.ts` exports `missingBalancePairs({ tokens, accountsByChain, existing })` — no `chrome.*`, no repo, no service. It filters the existing index down to active desired keys rather than materializing every foreign row, and emits a **total** deterministic order — chainId, then **token id**, then account index, then address. Chain/account alone does not order multiple tokens on the same chain; `getAccountsRaw` does not sort, unlike `getAccounts` (`account/service.ts:169-172`). Pinned by an input-permutation test.

### 7. Other required changes

- `dependencies` (`:42`) gains `AccountService.name` — init now awaits an account read, and the declaration exists precisely so topological start guarantees init-time peers (`:38-41`).
- Per-pair `try/catch` in the create loop, adapting `restore-rows.ts:22-35`'s best-effort idiom, so one bad row can't abort the whole repair.
- Repair **count** logged at `Warn` (a non-zero repair means something upstream broke); the no-op path logs elapsed ms at `Debug`, matching `balance-job-queue.ts:152-167`.

### File-level change map

| File | Change |
|---|---|
| `token-balance/reconcile-pairs.ts` | **new** — pure diff, no I/O |
| `token-balance/reconcile-pairs.test.ts` | **new** — table-driven, incl. a large-input case |
| `token-balance/service.ts` | lock; ensure path; both sweeps; `restore()` under the lock; `onTokenDeleted` sync map removal; `dependencies` += `AccountService.name`; logs |
| `token-balance/balance-repository.ts` | `requireKeyIdentityMatch: true` + `keyIdentityMode: "numeric"` (Phase 3) |
| `token-balance/service.test.ts` | extend `:247-422`; **add `getAccountsRaw` to the `AccountService` stub at `:279`**; two-parked-allocators concurrency test |
| `services/cross-profile-isolation.test.ts` | **add `getAccountsRaw` to the bare stub at `:206`** |
| `token-balance/service.composition.test.ts` | **new** — real service graph, seeded rows, recovery proof |
| `tests/e2e/…` | one storage-seeded gap → worker restart → recovery spec |

### Trade-offs / alternatives not taken

- **A 4th rendezvous-gate** to park the SW mid-race: rejected by both auditors. It needs a new production seam plus a new `nulo:e2e:*` literal in the negative grep, and park-then-kill is the most flake-prone construction in this suite (the `e2e-testing` skill documents `stopServiceWorker`'s 15s deadline and "all three retries failing does NOT mean it is real"). It would also be the **ninth** copy of `stopServiceWorker` (verified: 8 exist today, correcting recon's 5).
- **A delete/cleanup direction**: rejected — see Assumptions.
- **A storage-change-triggered kill**: rejected by codex — it cannot establish that the async subscriber hasn't already completed.

## Security & Adversarial Considerations

- **Threat model.** No new RPC (`rpcMethods` at `:35` unchanged), no new storage root, no key material, no network I/O, no dependency.
- **Exact-pair forgery (High, accepted residual).** `TokenBalanceRaw` has neither `profileId` nor `chainId` (`spec.ts:30-38`), so a stored-state attacker can forge the active `(tokenId, account)` pair with chosen balances and the sweep will treat it as present. Mitigation is directional: desired pairs originate **exclusively** from active-profile tokens and `getAccountsRaw(profileId)`; existing rows may only answer "does this already-constructed desired key exist?" — never contribute identity. Fundamentally indistinguishable without a schema change; recorded, not solved.
- **Shared-namespace safety holds only among *currently stored* rows (High, corrected).** Token ids are one global sequence across profiles (`token/service.ts:298`; `restore()` reallocates rather than preserving source ids, `:721`), which `TokenBalanceService.backup` relies on (`:399-400`, "an exact partition"). But ids are `max+1` (`id-allocators.ts:17-37`) and therefore **not monotonic over time** — deleting the highest token frees its id. A worker death after token deletion but before its un-awaited balance purge can leave an old, already-projected row; a later token can reuse that id, and profiles can share deterministic account addresses. That stale `(tokenId, account)` row then **suppresses repair** and, because `updatedAt > 0`, is not re-enqueued either. The sweep cannot infer incarnation from this schema. **Accepted residual, filed** — a durable fix needs non-reused token identities, an awaited token-delete cascade, or schema-carried incarnation.
- **Codec-hidden malformed rows.** `getValues()` hides them; `getKeys()` still sees their physical keys, so a recreated pair lands at a fresh id and cannot overwrite the hidden bytes. Exactly one duplicate, once, self-limiting, and the hidden twin never reaches the UI. Both auditors agree: **do not** delete malformed rows in a create-only sweep — using raw fields to suppress repair would preserve the outage.
- **Availability amplification (Medium).** The pass converts stored token × account cardinality into writes and queued tasks, and neither has a practical cap. Bounded by: one profile-wide account read, zero writes in the steady state, and the `Warn` repair-count log making an anomalous repair visible. A large-input unit test pins the diff's cost shape.
- **Residual: valid duplicate pairs.** `restore()` imposes no `(token, account)` uniqueness and the view renders every returned row, so pre-existing duplicates stay visible. The sweep must not add another; it cannot safely clean existing ones. Recorded.

## Assumptions

### Facts (verified at `23228d1d`; corrections from both audits folded in)

1. **Corrected.** Rows are created in **three** places, not two: `onAccountAdded` (`:276-282`), `onTokenAdded` (`:284-301`) — both via `createTokenBalance` (`:215-234`) — **and `restore()`** (`:406-427`), which writes via `repo.set` at `:424` and is a third allocator user.
2. Neither `init()` (`:127-134`) nor `onActiveProfileChanged` (`:255-274`) reconciles.
3. `getTokenBalances` hides rows whose token is absent from the map (`:156`); `getTokenBalanceInfo` throws `"unknown token"` on a miss (`:238-241`), reachable from `getTokenBalance(id)` (`:137-144`).
4. `createTokenBalance` writes unconditionally — no existence check (`:215-228`).
5. **Premises verified, the draft's safety conclusion was false.** `allocateUnfencedId` (`:211-213`) is lock-free; `EventHandler.invoke` (`event-handler.ts:47-61`) and `Service.emit` (`base-service.ts:129-133`) dispatch async subscribers un-awaited. Sequential awaits protect only *one* handler's loop, never independent invocations.
6. `enqueue()` (`balance-job-queue.ts:128-134`) is synchronous and pre-`start()`-safe (`:83-86`); it mints one `TaskService` record per row (`:130`).
7. Every `getAll`/`getKeys`/`getAccounts` reads the entire `chrome.storage.local` namespace (`entity_storage.ts:194-224`; `chrome-browser-api.ts:69`).
8. `getAccounts(…, all)` filters `… && (all || x.visible)` (`account/service.ts:160-173`); `onTokenAdded` passes `all: true` (`:295`).
9. `TokenBalanceRaw` has no `chainId` and no `profileId` (`spec.ts:30-38`).
10. `footprint-coverage.test.ts` governs migrations only; `TOKEN_BALANCE_STORAGE_ROOT` is already registered (`backup-migration-registry.ts:205`).
11. `TokenBalanceService` has no `onAccountDeleted` subscriber (`:120-125`) — unlike `TransactionService` (`transaction/service.ts:113`), `IncomingTransferService` (`incoming-transfer/service.ts:275`) and `AuthRegistryService` (`auth-registry/service.ts:97`).
12. No `Lock` in `TokenBalanceService`; `TokenService` serializes its allocate/write section (`token/service.ts:279,298`).
13. **New, and narrower than first recorded.** Token ids are one global sequence across profiles (`token/service.ts:298`, restore reallocates at `:721`) — but **only among currently stored rows**. Allocation is `max+1` (`id-allocators.ts:17-37`), so deleting the highest token frees its id for reuse (`token/service.ts:681-684` warns about exactly this). The "a foreign row can never suppress a creation" claim is therefore false across deleted incarnations.
14. **New.** `init()` subscribes at `:120-125` before awaiting at `:127`/`:129`; the `:129-131` map write is the only unfenced token-map write in the service. RPC handlers are live during `services.start()` (`runtime.ts:435`).
15. **New.** `getAccountsRaw(profileId)` exists (`account/service.ts:564-567`) — one read, all chains, no visibility parameter; already used from a boot path (`account-integrity/coordinator.ts:93`).
16. **New.** `updatedAt === 0` renders a permanent "Loading balance…" state (`TokenCard.vue:50-52`), and no ambient periodic resync exists.
17. **New.** `stopServiceWorker` has **8** local definitions in the e2e tree (verified by grep), not 5 — there is no reusable helper.
18. **New.** Full-backup restore writes **before** profile activation (`useFullBackupImport.ts:890-905`, "Late activation"), so restored token ids are intentionally absent from the active map at write time.
19. **New.** `Lock`'s default watchdog force-releases and explicitly "admit[s] a second critical section into a legitimately-running one" (`lock.ts:29-34`, `:138-142`); locks with by-design long holds must pass `maxHoldMs: null`.
20. **New.** `waitForFreshBalanceRow` actively calls `refreshBalances` unless `maxRefreshes: 0` (`tests/e2e/fixtures/helpers.ts:1434`), and `TokensView` does not refetch balances on the token-balance client's reconnect (`TokensView.vue:176`, `:337`).

### Inferences (post-audit)

1. ~~Create-only is sufficient~~ — **false, corrected.** It restores visibility but leaves the never-projected window stranded. The sweep now also re-enqueues `updatedAt === 0 && syncFailure === undefined` rows.
2. ~~Steady-state cost is one batched read~~ — **false, corrected.** It was `1 + N` full-namespace reads plus a `getKeys()` per created row. Now 2 reads and 0 writes in the steady state via `getAccountsRaw`; the per-created-row allocation scan remains and is bounded by the repair count.
3. ~~A strictly sequential loop suffices~~ — **false, corrected.** Refuted at both call sites (Facts 5, 14). Replaced by the service lock.
4. **The pure diff seam is right** — retained, and now filters the existing index to active desired keys rather than materializing foreign rows.
5. **Remaining live inference:** taking `restore()`'s allocate/write section under the same lock introduces no deadlock. Checked: `createTokenBalance` emits (`:232`) and enqueues (`:233`); `sendEvent` reaches connected ports only (`extension-messaging/src/background/service.ts:85-94`) and no in-SW service subscribes to `onTokenBalance*`, so no re-entrancy. `Lock` is non-reentrant and this instance disables the watchdog (`maxHoldMs: null`), so a missed re-entrancy path is a hang rather than a race — which is why every internal callee takes a `…HoldingLock` form and only entry points acquire. `withLock` releases through `finally` (`lock.ts:79`), so a throw or early return still releases. To be re-verified during implementation.

### Asks — resolved by the audits

| # | Question | Ruling |
|---|---|---|
| 1a | Fix concurrent id loss here? | **Yes, both auditors, High.** The sweep adds a third allocator; shipping without the lock knowingly makes a live loss path more reachable. |
| 1b | Fix `onAccountDeleted` orphans here? | **No, both auditors — separate PR.** A bare subscriber isn't durable (unawaited promises) and deleting by address alone can erase another profile's rows (addresses can be shared). Needs an awaited coordination path scoped by profile/chain + that profile's token ids. |
| 2 | Awaited vs detached? | **Awaited inside `init()`, failure-isolated.** `BaseService.start()` doesn't mark the service initialized until init resolves (`base-service.ts:64`) and `getTokenBalances` gates on `ensureInitialized` (`:147`) — so awaiting means no read can observe the unrepaired state. The detached precedent tolerates tens-of-seconds bb work; this is two storage reads. |
| 3 | Serialization? | **One service-level lock covering read/diff/allocate/write, all allocators participating.** |
| 4 | E2E shape? | **Seed the gap directly, restart the worker, assert recovery.** No 4th gate. Concurrency proven deterministically in service tests by parking two allocation callers. |
| 5 | Direction? | **Create-only** (plus the re-enqueue). General deletion can't be made owner-safe from this schema. |
| 6 | Tier? | **`mid`**, both auditors. |

### Filed as separate follow-ups

- **`onAccountDeleted` orphans** (Ask 1b) — needs an awaited, profile/chain-scoped coordination path; a bare subscriber isn't durable and deleting by address alone can erase another profile's rows.
- **Temporal token-id reuse** — a stale already-projected row from a deleted token incarnation can suppress repair and won't be re-enqueued (`updatedAt > 0`). Needs non-reused identities, an awaited token-delete cascade, or schema-carried incarnation.

## Phases

### Phase 1 — Pure diff module
`reconcile-pairs.ts` + colocated table-driven test: cross-chain exclusion, hidden accounts included, duplicate-pair input, empty input, a row whose token is absent from the map, deterministic ordering, and a large-input cost-shape case.

**Validation gate.** `bun run lint && bun run typecheck && bun run --cwd apps/extension test src/wallet/services/token-balance/`. Pass: exit 0. Layers: lint · typecheck · unit.

### Phase 2 — Lock + one ensure path
Introduce the service lock with **`maxHoldMs: null`**. Build the ensure path and route the **two live handlers** (`onAccountAdded`, `onTokenAdded`) through it — Phase 3 adds the two sweep callers, making four; wrap `restore()`'s whole `restoreRows` batch in a single acquisition **without** ensure semantics; put `purgeForTokens`' typed **and** raw passes under the same lock. `…HoldingLock` helpers so nothing can reacquire. `onTokenDeleted` removes from the map synchronously; every write re-checks the generation **and** token **identity** (`profileId`/`chainId`/`contract`, not `has(id)`). Add `AccountService.name` to `dependencies`. Fix the two bare `AccountService` stubs (`service.test.ts:279`, `cross-profile-isolation.test.ts:206`).

**Fence the init hydration** — capture the generation before the first init await and commit both the hydration and its sweep only if generation *and* profile identity still match. This is the service's one unfenced token-map write (Fact 14); the sweep would turn that latent cache corruption into cross-profile balance writes.

New tests: two parked allocation callers produce unique ids and no duplicate pair (must fail without the lock — record the red run); a profile switch while `getTokensRaw` is parked must not let the late init continuation repopulate the departed profile's tokens.

**Validation gate.** Above, plus `bun run --cwd apps/extension test src/wallet/services/`. Pass: exit 0; the concurrency test fails without the lock (record the red run).

### Phase 3 — The sweep + key identity
Init + profile-switch sweeps calling the ensure path; `getAccountsRaw` grouped in memory; re-enqueue never-projected rows; `Warn` repair-count / `Debug` elapsed-ms logs.

**Enable the key-identity guard on `BalanceRepository` here, not earlier — and it MUST be configured as:**

```ts
new EntityStorage<TokenBalanceRaw>(TOKEN_BALANCE_STORAGE_ROOT, area, parse, {
  requireKeyIdentityMatch: true,
  keyIdentityMode: "numeric",
})
```

`keyIdentityMode` defaults to `"string"` (`entity_storage.ts:44-45`) and that guard requires `typeof embedded === "string"` (`:161`), but balance ids are numbers (`spec.ts:30`). Passing `requireKeyIdentityMatch` **alone** would make every valid balance row read as `undefined` — an empty assets view — while `getKeys()` still returns their physical keys (`:206-212`), so every wake would allocate fresh rows that are themselves instantly hidden: unbounded storage growth on top of a blank wallet. The mode is not optional detail.

Two tests, not one: the mismatched-key recovery case **and** a control that `@1` containing `{ id: 1, … }` stays visible.

— landing it alongside the sweep means no intermediate phase hides mismatched rows without repairing them. Codex held this ruling with the deferral counter-argument in view: the sweep *is* the recovery story — the guard hides but retains the mismatched row, physical `getKeys()` still prevents overwriting it, and the awaited init creates a canonical replacement at a fresh id and enqueues its projection before the first balance RPC can complete. What is not preserved is the corrupt row's last-known value; the replacement starts unresolved and gets an authoritative projection, which is the fail-closed behaviour.

Composition test (`COMPOSITION-TESTS.md`-compliant: storage + lifecycle, no PXE/bb/simulate) proving recovery and proving **zero** `repo.set` calls when state is complete. Service test: a valid mismatched-key desired row becomes exactly one visible canonical row while the old physical bytes remain untouched.

**Validation gate.** Above, plus the composition test green and the no-op assertion. Layers: lint · typecheck · unit · composition.

### Phase 4 — E2E
Create a token/account normally, delete every matching `nulo:core:token-balances@*` row via `page.evaluate`, prove the gap, stop the worker, wake it, then assert: exactly one valid pair row reappears; it gets a fresh projection; the card shows the expected amount.

Two false-pass traps to close (Fact 20): pass **`maxRefreshes: 0`** to `waitForFreshBalanceRow` so the assertion proves the *boot enqueue* rather than an explicit refresh the helper itself triggered; and **reload/remount the popup** before asserting the card, because `TokensView` does not refetch on the client's reconnect and would otherwise still show its pre-deletion card. Extract `stopServiceWorker` into `fixtures/helpers.ts` rather than adding a 9th copy. Must fail without the sweep — record red/green in `lessons/phase-4.md`.

**Validation gate.** `bun run e2e:agent tests/e2e/network/<spec>.test.ts` plus the documented pre-fix red run.

### Phase 5 — Regression sweep + docs
`bun run audit:vue`; **both** smoke modes (armed source build, and unarmed artifact-mode with `NULO_E2E_ARTIFACT_RUN=1` + `EXTENSION_PATH` — the default command exercises neither, per #485's `lessons/phase-4.md`); `NULO_E2E_PROVERLESS=1 bun run e2e:agent`. Docs: `ARCHITECTURE.md` balance-row lifecycle.

**Validation gate.** All four exit 0.

## Delivery

**Single arc, single PR** → `dev`, plain `gh pr create`. `/code-review` **medium**.
Title (≤93 chars): `fix(balances): serialize row creation and repair stranded token balances on boot`

## Post-implementation

1. **`/code-review medium --fix`** on the net diff; skim; commit separately.
2. **Codex audit** (`/codex xhigh`): net diff + code-review commit summary + this plan.md + decision ledger + adversarial/security ask + both rules verbatim.
   - *No over-engineering:* "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - *Comment quality:* "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
3. **Iterative fix loop.** Verify each claim against the repo, apply, commit, log the round in `lessons/`, resume the same codex session with the fix diff. Loop until no new material findings; surface and stop after 3.
4. **Delivery.** Only now: `gh pr create --base dev`, then `gh pr checks --watch` until `quality-status`, `smoke-e2e-status`, `network-e2e-status` are green. Re-run genuine flakes; fix real breakage; never weaken a gate. Update `implementations-plan/index.md`.

**Post-implementation hardening:** no `/harden` pass — no new trust boundary.

## Decision ledger

| Decision | Source | Rationale |
|---|---|---|
| Reject Outline A | **both auditors** | Snapshot-diff with no write-time guard, at a call site with a guaranteed concurrent creator → duplicate pairs + inherited id loss |
| Reject Outline B | **both auditors** | Right invariant, wrong layer (repo can't see generation/liveness/emit/queue) and a disqualifying per-pair full-namespace read; also omitted `restore()` |
| Adopt the service-lock ensure path | both, independently | B's atomicity at A's cost |
| Re-enqueue never-projected rows | **codex only** | Fable missed the second window entirely; `TokenCard.vue:52` proves it strands a card loading forever |
| `getAccountsRaw` | **fable first**, codex concurred | Removes the `all: true` footgun structurally; `1+N` reads → 2 |
| `restore()` under the lock | **codex first**, fable identified restore as a third creator | Otherwise the allocation race stays alive |
| `onTokenDeleted` sync map removal | **codex only** | The generation fence covers profile changes, not token deletion |
| Global token-id sequence as a Fact | **fable proposed, codex narrowed** | Recorded, then corrected: it holds only among *currently stored* rows. Ids are `max+1` and reusable after deleting the highest token, so a stale row from a deleted incarnation can still suppress repair — filed as a residual, not relied on |
| Fix the two bare test stubs | **fable only** | Verbatim repeat of #485's phase-4 lesson |
| Gate commands must run under Bun | **fable only** | CLAUDE.md:33 — `bun --bun vitest run`; the draft (and #485's gates) launched vitest under Node |
| No 4th rendezvous gate | both | New production seam + the most flake-prone construction in the suite; would be the 9th `stopServiceWorker` copy |
| 1b (`onAccountDeleted`) deferred | both | Needs an awaited, profile/chain-scoped coordination path; addresses can be shared across profiles |
| Key-identity scope | **codex, held under challenge** | Enabled in this PR, landing with Phase 3. The sweep IS the recovery story: the guard hides but retains the row, `getKeys()` still prevents overwrite, and the awaited init creates a canonical replacement before the first balance RPC. The corrupt row's last-known value is deliberately not preserved |
| `maxHoldMs: null` on the lock | **codex only (round 2)** | The default watchdog force-releases and admits a second critical section into a running one — it would break the very invariant the lock exists for (`lock.ts:29-34`) |
| Restore shares the lock, not the ensure semantics | **codex only (round 2)** | Full-backup restore writes before profile activation, so active-map authorization would reject every restored balance and break import (`useFullBackupImport.ts:888-895`) |
| `purgeForTokens` under the lock | **codex only (round 2)** | Profile deletion calls it directly; unlocked, a creation settling after its snapshot survives deletion |
| Token liveness by identity, not `has(id)` | **codex only (round 2)** | Ids are `max+1` and reusable after deleting the highest token |
| Fence the init hydration | **codex round 2, fable C-2** | The one unfenced token-map write; the sweep would turn latent cache corruption into cross-profile writes |
| e2e `maxRefreshes: 0` + popup remount | **codex only (round 2)** | Otherwise the spec can prove an explicit refresh, and can assert a stale pre-deletion card |
| Temporal token-id reuse | **codex only (round 2)** | Fact 13 as first recorded was false across deleted incarnations; corrected and filed as a residual |

## Audit verdicts

**Fable (Opus, plan round 1): `conditional approve`** — 8 conditions, all adopted. Full transcript: `audit-fable.md`.
**Codex (session `01a05286-63b9-7c91-a4b4-1827954071ce`, `gpt-5.6-sol` xhigh, plan round 1): `reject`** — blocking findings, all adopted. Full transcript: `audit-codex.md`.
**Codex round 2 (re-audit of the consolidated design): `conditional approve`** — 7 conditions: fence the init hydration; separate restore from ensure semantics; include `purgeForTokens` in a non-force-releasing lock; strengthen token liveness beyond id membership; correct and file the temporal id-reuse residual; enable numeric key identity with recovery tests; make the e2e prove automatic projection against a remounted UI. **All seven adopted in this revision.**
**Codex round 3 (discharge check): `reject`** — six of seven conditions discharged; one Critical: Phase 3 said "enable `requireKeyIdentityMatch`" without specifying `keyIdentityMode: "numeric"`, and the default `"string"` mode would have hidden every numeric-id balance row while `getKeys()` kept allocating replacements — a blank wallet with unbounded storage growth. **Adopted**, plus the two Low stale-text/wording fixes.
**Codex round 4 (final): `approve`** — "The plan is implementable as written… No remaining architecture, concurrency, recovery, security, or test-design blocker." Two citation Lows fixed (`useFullBackupImport.ts:900-905`, `token/service.ts:681-684`).

**Final verdict: `approve`** after four rounds (reject → conditional → reject → approve), plus the independent fable leg's `conditional approve`. Full transcripts: `audit-codex.md`, `audit-fable.md`.
