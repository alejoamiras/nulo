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

**Every new-row allocator participates**: `onAccountAdded`, `onTokenAdded`, the init sweep, the profile-switch sweep, and **`restore()`'s allocation/writes** (`:406-427`) — which both audits flagged as a third allocator the plan had missed. Restore keeps its own row values, `TokenBalanceRawSchema.parse`, and `assertRestoreEpoch`; only its allocate-and-write section joins the hold.

The critical section covers **read → diff → allocate → write**, not merely allocation. Pre-loop reads that don't need serializing (`getTokenRaw`, the account read) stay outside the hold.

**Why a lock is mandatory** — the draft's "strictly sequential is sufficient" was refuted twice over:
- `onActiveProfileChanged` has ≥2 async subscribers: `TokenBalanceService` (`:120`) **and** `TokenService.onActiveProfileChangedSeed` (`token/service.ts:127`), which runs `seeder.run()` → `persist` → `emit("onTokenAdded")` → a second `createTokenBalance` loop. `EventHandler.invoke` (`event-handler.ts:47-61`) dispatches un-awaited, so a sweep on the switch tail is **guaranteed** a concurrent creator.
- `init()` subscribes at `:120-125` **before** it awaits at `:127`/`:129`, and RPC handlers are live during `services.start()` (`runtime.ts:435`) — so init is not quiescent either.

Without the lock, two creators read the same pre-write `getKeys()` snapshot, compute the same id, and the later `repo.set` silently overwrites — a row vanishes with no `onTokenBalanceDeleted` (window: `id-allocators.ts:17-37`, no lock at `:211-213`). The sweep would add a third concurrent creator, making a live bug more reachable.

### 2. One idempotent ensure path

All five call sites route through one method that, under the hold: reads existing rows once, builds desired pairs, diffs, and creates only what's missing — updating the in-memory existing-pair set after each creation so the batch is self-consistent without re-reading.

### 3. Repair both windows

- **Missing row** → create it.
- **Never-projected row** (`updatedAt === 0 && syncFailure === undefined`) → **enqueue it**. This is the second window; create-only would leave those cards spinning forever. `syncFailure === undefined` distinguishes "never ran" from "ran and failed" (which the queue already owns).

### 4. One profile-wide account read

`getAccountsRaw(profileId)` (`account/service.ts:564-567`) — one read, all chains, no visibility parameter — grouped by `chainId` in memory, replacing N per-chain `getAccounts(…, all: true)` calls. This removes the `all: true` footgun **structurally** rather than by remembering a boolean, and cuts steady state from `1 + N` full-namespace reads to 2.

Every `getAll`/`getKeys`/`getAccounts` deserializes the entire `chrome.storage.local` namespace and filters client-side (`entity_storage.ts:194-224`; one shared adapter at `chrome-browser-api.ts:69`), so read *count* is the whole cost model.

### 5. Token-deletion safety

`onTokenDeleted` (`:317-324`) removes the token from `this.tokens` **synchronously**, then purges under the same lock. Immediately before any new write, re-check **both** the generation **and** token-map membership — the existing generation fence covers profile changes only, not token deletion.

### 6. Pure diff module

`token-balance/reconcile-pairs.ts` exports `missingBalancePairs({ tokens, accountsByChain, existing })` — no `chrome.*`, no repo, no service. It filters the existing index down to active desired keys rather than materializing every foreign row, and emits deterministic order (chainId, then account index, then address — `getAccountsRaw` does not sort, unlike `getAccounts` at `account/service.ts:169-172`).

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
| `token-balance/balance-repository.ts` | **pending Open question A** (key-identity) |
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
- **Why the shared namespace is nonetheless safe** — token ids are a **single global sequence across profiles** (`token/service.ts:298`; `restore()` reallocates rather than preserving source ids, `token/service.ts:721`), which `TokenBalanceService.backup` already relies on (`:399-400`, "an exact partition"). So a foreign row can never collide on a desired pair or suppress a legitimate creation. This invariant is load-bearing and gets a comment + a test.
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
13. **New.** Token ids are one global sequence across profiles (`token/service.ts:298`, restore reallocates at `:721`); `TokenBalanceService.backup` already depends on it (`:399-400`).
14. **New.** `init()` subscribes at `:120-125` before awaiting at `:127`/`:129`; the `:129-131` map write is the only unfenced token-map write in the service. RPC handlers are live during `services.start()` (`runtime.ts:435`).
15. **New.** `getAccountsRaw(profileId)` exists (`account/service.ts:564-567`) — one read, all chains, no visibility parameter; already used from a boot path (`account-integrity/coordinator.ts:93`).
16. **New.** `updatedAt === 0` renders a permanent "Loading balance…" state (`TokenCard.vue:50-52`), and no ambient periodic resync exists.
17. **New.** `stopServiceWorker` has **8** local definitions in the e2e tree (verified by grep), not 5.

### Inferences (post-audit)

1. ~~Create-only is sufficient~~ — **false, corrected.** It restores visibility but leaves the never-projected window stranded. The sweep now also re-enqueues `updatedAt === 0 && syncFailure === undefined` rows.
2. ~~Steady-state cost is one batched read~~ — **false, corrected.** It was `1 + N` full-namespace reads plus a `getKeys()` per created row. Now 2 reads and 0 writes in the steady state via `getAccountsRaw`; the per-created-row allocation scan remains and is bounded by the repair count.
3. ~~A strictly sequential loop suffices~~ — **false, corrected.** Refuted at both call sites (Facts 5, 14). Replaced by the service lock.
4. **The pure diff seam is right** — retained, and now filters the existing index to active desired keys rather than materializing foreign rows.
5. **Remaining live inference:** taking `restore()`'s allocate/write section under the same lock introduces no deadlock. Checked: `createTokenBalance` emits (`:232`) and enqueues (`:233`); `sendEvent` reaches connected ports only (`extension-messaging/src/background/service.ts:85-94`) and no in-SW service subscribes to `onTokenBalance*`, so no re-entrancy. `Lock` is non-reentrant with a 5-minute watchdog (`lock.ts:24-38`). To be re-verified during implementation.

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

### Open question A — still live, routed back to codex

**Enable `requireKeyIdentityMatch` on `BalanceRepository` in this PR, or file it separately?** The auditors disagree: codex says enable here (a row at key `@99` with embedded `id: 1` is served by `getAll()`, can suppress repair, and its later `get(1)` reads another key — `balance-repository.ts:23`, `entity_storage.ts:38,152`); fable filed the same finding as pre-existing C-7 and out of scope. Enabling a read-side guard on a live storage root changes how existing mismatched rows behave, which is a different risk class from an additive sweep.

## Phases

### Phase 1 — Pure diff module
`reconcile-pairs.ts` + colocated table-driven test: cross-chain exclusion, hidden accounts included, duplicate-pair input, empty input, a row whose token is absent from the map, deterministic ordering, and a large-input cost-shape case.

**Validation gate.** `bun run lint && bun run typecheck && bun run --cwd apps/extension test src/wallet/services/token-balance/`. Pass: exit 0. Layers: lint · typecheck · unit.

### Phase 2 — Lock + one ensure path
Introduce the service lock; route `onAccountAdded`, `onTokenAdded` and `restore()`'s allocate/write through it; `onTokenDeleted` synchronous map removal + purge under the lock; re-check generation **and** map membership before each write. Add `AccountService.name` to `dependencies`. Fix the two bare `AccountService` stubs (`service.test.ts:279`, `cross-profile-isolation.test.ts:206`). New test: two parked allocation callers must produce unique ids and no duplicate pair.

**Validation gate.** Above, plus `bun run --cwd apps/extension test src/wallet/services/`. Pass: exit 0; the concurrency test fails without the lock (record the red run).

### Phase 3 — The sweep
Init + profile-switch sweeps calling the ensure path; `getAccountsRaw` grouped in memory; re-enqueue never-projected rows; `Warn` repair-count / `Debug` elapsed-ms logs. Composition test (`COMPOSITION-TESTS.md`-compliant: storage + lifecycle, no PXE/bb/simulate) proving recovery and proving **zero** `repo.set` calls when state is complete.

**Validation gate.** Above, plus the composition test green and the no-op assertion. Layers: lint · typecheck · unit · composition.

### Phase 4 — E2E
Create a token/account normally, delete every matching `nulo:core:token-balances@*` row via `page.evaluate`, prove the gap, stop the worker (existing helper — do **not** add a 9th copy), wake it, then assert: exactly one valid pair row reappears; it gets a fresh projection (`waitForFreshBalanceRow`); the card shows the expected amount (`waitForTokenCardAmount`). Must fail without the sweep — record red/green in `lessons/phase-4.md`.

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
| Global token-id sequence as a Fact | **fable only** | It's what makes the pair key safe in a shared namespace; was an unstated assumption |
| Fix the two bare test stubs | **fable only** | Verbatim repeat of #485's phase-4 lesson |
| Gate commands must run under Bun | **fable only** | CLAUDE.md:33 — `bun --bun vitest run`; the draft (and #485's gates) launched vitest under Node |
| No 4th rendezvous gate | both | New production seam + the most flake-prone construction in the suite; would be the 9th `stopServiceWorker` copy |
| 1b (`onAccountDeleted`) deferred | both | Needs an awaited, profile/chain-scoped coordination path; addresses can be shared across profiles |
| Key-identity scope | **disputed** | Open question A — routed back to codex |

## Audit verdicts

**Fable (Opus, plan round 1): `conditional approve`** — 8 conditions, all adopted. Full transcript: `audit-fable.md`.
**Codex (session `01a05286-63b9-7c91-a4b4-1827954071ce`, `gpt-5.6-sol` xhigh, plan round 1): `reject`** — blocking findings, all adopted. Full transcript: `audit-codex.md`.
Round 2 (re-audit of this revision): pending.
