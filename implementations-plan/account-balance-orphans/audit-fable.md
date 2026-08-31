# audit-fable.md — fable-leg plan audit (account-balance-orphans)

Independent top-tier Claude reviewer (blueprint mid, dual-audit leg), run as a background `Plan`
agent against the committed `plan.md` + `recon.md` and the cited source at `origin/dev` @ `9103dea0`.
Paths rewritten repo-relative for the committed artifact. Every load-bearing claim was independently
re-verified against source by the main agent before adoption (see `lessons/phase-0.md`).

---

I verified every cited file. Here is the audit.

---

# Fable-leg audit — `account-balance-orphans`

## 0. What holds

The defect is real and correctly localized. `reconcileImportedAccounts` (`apps/extension/src/wallet/services/account/service.ts:785-797`) deletes only the Account row + emits `onAccountDeleted`; the balance service subscribes to `onActiveProfileChanged`/`onAccountAdded`/token events/`onTransactionUpdated` only (`token-balance/service.ts:131-136`). `ensurePairsHoldingLock` keys on `${token}:${account}` (`:282-287`) and will silently skip a re-imported address. Confirmed.

One fact the plan **should** be leaning on and isn't: `TokenService.updateToken` hard-rejects any change to `profileId`/`chainId`/`contract` — `throw new Error("token profile id, chain id and contract cannot change")` (`token/service.ts:389-394`). That makes the proposed triple the token's **immutable natural key**, so a stamped copy can only go stale by token *deletion* — which already has an awaited cascade. This is the single strongest argument for Outline A's field set and it is absent from both documents.

---

## 1. Adversarial / security review

### C-1 — **Critical** — "not RPC-exposed" is false; the plan's own call site forces RPC exposure

Plan §Security: *"`purgeForAccounts` is not RPC-exposed (internal + composable-called)."* These are mutually exclusive in this codebase.

`useFullBackupImport.ts` runs in the popup and reaches services only through `*ServiceClient` port RPC. The dispatcher is fail-closed on an explicit surface: `!this.rpcMethods.has(methodName) && !this.frameworkRpcMethods.has(methodName)` → reject (`packages/extension-messaging/src/core/base-service.ts:88-94`), and `frameworkRpcMethods` is exactly `new Set(["backup","restore"])` (`background/service.ts:25`). So a composable-called `purgeForAccounts` **must** be added to `Methods` in `token-balance/spec.ts` and to `defineRpcMethods` — and `defineRpcMethods` is exhaustive in both directions (`core/rpc-methods.ts:23-29`), as is `definePassthroughsExhaustive` on the client (`token-balance/client.ts:33`). Net effect: a **destructive, address-scoped delete becomes part of the token-balance public RPC surface**, callable from any trusted internal context (popup, options, offscreen) with attacker-influenced arguments if any UI path ever forwards them.

Mitigating: `isTrustedInternalSender` (`core/sender-auth.ts:18-24`) excludes content scripts and foreign extensions, so dapps cannot reach it. And `reconcileImportedAccounts` — itself destructive — is already RPC-exposed (`account/service.ts:62`). So this is a surface *expansion*, not a breach. But the plan asserts the opposite of what it will build, and that assertion is load-bearing in its own risk rating.

**There is an existing repo pattern that avoids the exposure entirely** — see A-1 below.

### C-2 — **High** — the awaited purge is called on a disconnected client

The composable constructs `TokenBalanceServiceClient` inside `backupServices` (`useFullBackupImport.ts:869-877`) and disconnects **all** clients in the loop's `finally` (`:894-896`). The plan's purge lands after `reconcileImportedAccounts` at `:910`, i.e. after that `finally`. Implementation must construct a fresh client (or prove `disconnect()`-then-`request()` reconnects — the base client's `disconnect` rejects every in-flight request, `core/base-client.ts:244`, and the existing `:910` call reuses a client disconnected at `:830`, which is at minimum an undocumented reliance). Not fatal, but it is exactly the kind of detail that turns "awaited" into "silently threw and got swallowed" — and note `:908-916` already wraps the reconcile in a `catch` that logs and continues.

### C-3 — **High** — the purge will throw on its first row if it mirrors `purgeForTokens` naively

`purgeForTokens` emits through `this.getTokenBalanceInfo(tb)` guarded by `if (this.tokens.has(tb.token))` (`token-balance/service.ts:466`), because `getTokenBalanceInfo` throws `"unknown token"` when the token is absent from the active map (`:359-365`). At the plan's call site the imported profile is **not yet active** (`finalizeRestore` is at `:919`), so `this.tokens` holds the *previous* profile's tokens — every row the purge touches is unmappable. If the implementation uses the shared `purgeRows` helper it is **abort-on-error by design** ("a rejected `remove` aborts the loop… Do not 'harden' this into swallowing errors", `services/purge-rows.ts` header) — one throw abandons the rest of the purge. Must be pinned by a test that runs the purge with a foreign/empty active token map.

### C-4 — **High** — "restore-side truth" is only half true, and the half that matters is client-supplied

Plan §2/§Security: relink and `restore()` *"overwrite from restore-side truth (the restored token, the threaded profileId)"*.

- `profileId`: genuinely service-derived (already a required param, `token-balance/service.ts:537,542-546`). Fine.
- `chainId`/`contract`: **not** service-derived. They would be stamped by `relinkRestoredTokenBalances` in the **popup**, then shipped over RPC and accepted by `restore()` on faith. The service's new identity fields — which now gate `getTokenBalances`, `isRowEmittable`, `reconcile-pairs` matching and `purgeForAccounts` scoping — become client-authored.

Worse, the values the relink would stamp are themselves blob content: `TokenService.restore` writes `TokenSchema.parse({ ...token, id })` (`token/service.ts:725`) — only `id` is reallocated; `profileId`, `chainId`, `contract` come verbatim from the backup. So "restore-side truth" reduces to "whatever the blob said, laundered through a restored token row."

That is *not weaker than today* (today's `token` FK is equally blob-chosen), but the plan's security claim overstates it, and the mitigation is cheap — see A-2.

Two concrete relink traps if stamping stays there: (a) the function's per-token chain map is `oldIdToChain.set(old.id, old.chainId)` — the **old** token's chainId (`useFullBackupImport.ts:293`), not the restored row's; (b) `oldIdToChain` is populated for *all* indices including `restoreError` rows, while `oldIdToNew` is populated only for successful ones (`:292-295`) — a naive `oldIdToContract` built on the same loop would stamp `contract` off a **failed** token row, whose `contract` is raw unvalidated blob content (`restore-rows.ts` returns the original input row on failure).

### C-5 — **High** — Inference 4 is wrong: an account-orphaned row is *not* hidden by the fail-closed filters

Inference 4: *"a crash mid-finalize … the next unlock's reconcile + fail-closed filters make the orphan invisible."*

The identity filters compare a row against the **live token** (`profileId`/`chainId`/`contract`). A row orphaned by *account* removal points at a perfectly live token of a live profile — it matches identity exactly. Nothing in `getTokenBalances`, `isRowEmittable`, or `reconcile-pairs` filters by account membership. So the residual is not invisible: it survives, and `backup()` **exports** it (A's `row.profileId` filter matches it just as B's token-id join does), so it round-trips into every future backup. The UI happens not to render it only because `refreshBalances` iterates accounts (`utils/core.ts:145-165`) — an accident, not a guard.

This is the single technical error in the Assumptions section, and it invalidates the plan's answer to Ask 5.

### C-6 — **Medium** — the transition is a full-store rewrite executed inside one unbounded lock hold

Mechanics check out: new required fields → old rows fail `TokenBalanceRawSchema.parse` → `decodeRow` KEEPs-but-hides (`entity_storage.ts:129-140`) → invisible to `getValues()` → `reconcileBalanceRows` recreates the pairs. Physical keys survive, and `getKeys()` is codec-free (`entity_storage.ts:206-212`), so `allocateIdAvoiding` cannot collide. Verified.

Unpriced cost (Inference 1's gap, and it's larger than stated): `createTokenBalanceHoldingLock` → `allocateUnfencedId` → `nextNumericId` → `storage.getKeys()` → `this.storage.get()` **with no key filter** — a full `chrome.storage.local` deserialization *per created row*. On first boot after the change that is one full-namespace read + one write **per (token × account) pair**, all inside a single `Lock("token-balance", undefined, null)` hold whose `maxHoldMs: null` is deliberately non-force-releasable (`token-balance/service.ts:50-60`). Then N projections are enqueued. Meanwhile every balance renders `0`/loading until projection lands.

Pre-production, this is acceptable — but it must be **measured**, not asserted. Add a Phase 1 test that reconciles a store with ≥200 old-shape rows and asserts (a) exactly one canonical row per pair, (b) no duplicate pairs, (c) bounded wall time. The plan's Inference 1 explicitly flags this as unproven and then ships no proof for it.

### C-7 — **Medium** — backup import mid-transition is fine; the raw purge pass is the part to specify

Old *exports* land as new-shape via relink (or via A-2), and old *live* rows are separate. But `purgeForAccounts` needs a raw second pass (every sibling has one: `purgeForTokens` `:472-475`, tx `:355-363`, authwit `:439-443`, `purgeForProfile` `:614-635`). Under A its predicate must be `raw.account ∈ addresses && raw.profileId === profileId`, which **correctly skips** codec-hidden old-shape rows: they are unattributable, and deleting them would be a bare-address delete by another name. Under B the predicate would be `raw.account ∈ addresses && raw.token ∈ profileTokenIds`, which *does* reach them. The plan defines neither. State A's predicate and the deliberate skip.

### C-8 — **Low** — `getTokenBalance(id)` stays fail-open

The plan filters `getTokenBalances` (plural) and `isRowEmittable`. The singular RPC `getTokenBalance(id)` (`:156-163`) has no filter and goes straight to `getTokenBalanceInfo`, which resolves the token by numeric id alone — an identity-mismatched row would be returned decorated with the *wrong* token's info. No in-repo caller today (grep: spec + service only), which is why it's Low, but it is a declared RPC method and "fail-closed everywhere" is the plan's stated posture.

### C-9 — **Low** — `AuthRegistryService.purgeForAccounts` is the wrong model to name

Recon and plan both cite it as a shape to mirror (`auth-registry/service.ts:428-449`). It takes **no `profileId`** and deletes by bare address — precisely the hazard both documents forbid. Cite `TransactionService.purgeForAccounts` (`transaction/service.ts:301-364`) alone.

---

## 2. Assumptions

### Facts — 13 checked

| # | Verdict |
|---|---|
| 1 | **Holds.** Chain purge cascades via `TokenService.clearChainState` → `onTokenDeleted` (`token-balance/service.ts:439-455`); profile deletion via `coordinator.ts:120` `balances.purgeForTokens`. |
| 2 | **Holds.** `Promise<string[]>` at `account/service.ts:785`; sole caller `useFullBackupImport.ts:910`. |
| 3 | **Holds.** Subscribers are AuthRegistry, Transaction (`transaction/service.ts:113,274-276`), IncomingTransfer. No balance-layer subscriber. |
| 4 | **Holds.** `EventHandler.invoke` is a sync `for` over callbacks, return values discarded (`packages/wallet-core/src/utils/event-handler.ts:47-60`). |
| 5 | **Holds in substance, one bad path.** `derive-account-seed.ts` is at `packages/wallet-crypto/src/`, not the extension. The claim is independently confirmed by `account/spec.ts:10-18` and `transaction/service.ts:307-313`. |
| 6 | **Holds, line numbers off.** `BASELINE_VERSION` is `:19`, `realMigrations = []` is `:26` (plan says `:18,22`). CLAUDE.md §"Persisted-storage shape changes" `:94` quoted accurately. |
| 7 | **Holds.** Plain `z.object` (`spec.ts:41`); KEEP-but-hidden at `entity_storage.ts:129-140`; reconcile at `:149,397`. |
| 8 | **Holds.** |
| 9 | **Partly wrong — see C-4.** The relink tracks the **old** token's `chainId` (`:293`), and `contract` lives on `newTokens` only, reachable by index, not by the `oldIdToNew` value lookup the balances use. "Already tracks" overstates it. |
| 10 | **Holds.** `CURRENT_BACKUP_SCHEMA_VERSION = maxBackupSchemaVersion(realMigrations)` (`backup-migrator.ts:74`); registry anchors on `numberAnchor("id")` (`backup-migration-registry.ts:205`). |
| 11 | **Holds.** |
| 12 | **Overstated — the absence claim is wrong.** Two raw-shape readers exist outside the service module and the registry: `apps/extension/src/utils/full-backup-helpers.ts:206` (`RESTORE_ERROR_FIELDS_BY_SERVICE[TOKEN_BALANCE] = [ID]`, a **fail-closed allowlist** — see below) and `apps/extension/tests/e2e/fixtures/helpers.ts:1322-1340,1403-1425,1468` (raw row parsing + contract→id joins). Neither breaks, but "no reader exists" is false, and the first one is a decision point: adding `profileId`/`chainId` there is optional, adding `contract` would leak a contract address into the restore-error log, which the surrounding doc explicitly forbids for `address`-class fields (`full-backup-helpers.ts:167-178`). **Record the deliberate no-op** or an implementer "completing the convention" will regress it. |
| 13 | **Holds.** `auth.vue:174` exact. |

Test-surface facts the plan omits from its change map: `services/storage-codecs.test.ts:98-111` uses `satisfies TokenBalanceRaw` (compile-enforced, good); `services/cross-profile-isolation.test.ts:91-92` uses `as TokenBalanceRaw` (**no** compile error — it will red at runtime instead, on two assertions); `token-balance/service.test.ts:33` is a single typed factory; `balance-job-queue.test.ts:469,499` wire `isRowEmittable` twice.

### Inferences

1. **Unsafe as stated** — see C-6. Directionally right, quantitatively unproven, and the per-row full-namespace read makes it worse than the plan implies. Convert to a test.
2. **Safe for the current code, fragile as a standing assumption.** The two guards are consistent: relink runs under `if (data["token-balance"]?.length)` (`:850`) and the restore under `Array.isArray(sliceData)` (`:890`), with tokens restored first (`:840`). There is no import path that skips relink. But the assumption is an *ordering* invariant in a 1000-line composable with nothing enforcing it — and A-2 removes the dependency entirely.
3. **Safe, with two gaps.** Everything visible today has a live token in the map, and post-transition rows match identity, so no new visibility loss. Gaps: `getTokenBalance(id)` singular is unfiltered (C-8), and `BalanceProjector` resolves tokens through the **authoritative** `tokens.getTokenRaw(balance.token)` (`balance-projector.ts:64`), not the active map — so a foreign row still gets *projected* (a PXE/network call) before `isRowEmittable` refuses the write. If fail-closed identity is the goal, the projector is the third guard site and the plan's change map omits it.
4. **Wrong — see C-5.** Blocking as written.

### Asks — rulings

**Ask 1 · A vs B → A**, conditioned on A-1/A-2/A-3 below. The deciding evidence is not the family-symmetry argument the plan leads with; it is `token/service.ts:389-394` (the triple is immutable by contract) plus the fact that B's token-id join must be *remembered and re-derived* at every future scoping site, while A makes `requireOwnedRow` (`services/require-owned-row.ts:12-17`) apply to balance rows for the first time. B is not a bad patch — it is correct, ~40 lines, and its raw purge pass is *strictly more capable during the transition* (C-7) — but it leaves the schema decision to a moment when it costs a migration, and the pre-production window (`realMigrations = []`) is the cheapest this will ever be.

**Ask 2 · Field set → all three.** Justify with `token/service.ts:389-394`, not with family symmetry. `chainId` is redundant-but-cheap and retires the manual chain join in `reconcile-pairs.ts:80-89`; `contract` is what closes the id-reuse residual documented at `reconcile-pairs.ts:57-61`. Do **not** add a composite storage key — the plan's rejection of that is correct and well-argued (`numberAnchor("id")` at `backup-migration-registry.ts:205`, `keyIdentityMode: "numeric"` at `balance-repository.ts:34`).

**Ask 3 · Stale-row deletion → NO. Fail-closed filtering only.** The service's own comment already names the killer case: a balance's token can be absent from the map because of "*a codec-hidden token row*" (`token-balance/service.ts:171-174`). Identity-based deletion in the reconcile would destroy balances whose token row is merely *unreadable* — recoverable data turned into permanent loss, which is the exact inversion `decodeRow`'s KEEP policy exists to prevent (`entity_storage.ts:83-93`). Deletion stays exclusively in caller-scoped purges (`purgeForTokens`, `purgeForAccounts`) where authoritative scope is supplied.

**Ask 4 · Old-shape debris raw-sweep → NO.** Debris is inert (hidden, unexported, physical keys still block id reuse) and **self-cleaning**: `purgeForTokens`' raw pass matches on `typeof raw.token === "number" && set.has(raw.token)` (`:472-475`), which reaps old-shape rows when their token or profile dies. A boot-time sweep would have to key on "no `profileId`", which is unattributable by construction — it would delete *other* profiles' pre-upgrade rows. Not worth it.

**Ask 5 · Crash-window ordering → SPLIT. Purge before delete.** Inference 4 is false (C-5), so the residual is not self-healing. `recon.md:101` already ruled this way — *"adapt — the ordering rationale (purge balances BEFORE dropping the account row)"* — and plan §5 does the opposite. Shape: `listKeylessImportedAccounts(profileId)` (read-only) → `purgeForAccounts(orphans, profileId)` → `reconcileImportedAccounts(profileId)` (unchanged, idempotent, still returns `dropped`) → purge the returned set again (idempotent, catches anything that raced). Crash residual flips from "orphan rows nothing will ever clean, exported into every future backup" to "balances purged for an account that still exists" — which `reconcileBalanceRows` repairs on the next init (`:149,397`). Strictly the safer direction, and the reconcile's `catch`-and-continue at `:908-916` makes it matter more, not less.

**Ask 6 · Tier → `mid`, confirmed.** HIGH blast radius is right; irreversibility is genuinely LOW; churn is compiler-guided across ~8 source files + 5 test files. `deep` would not buy anything the dual audit doesn't.

---

## 3. Architecture & Implementation

### A-1 — **High** — recon's dependency-direction constraint is wrong, and it forced the weaker design

`recon.md:123`: *"AccountService (phase 0) cannot call into TokenBalanceService (phase 1)… The awaited purge must be orchestrated from above — the restore composable… or a coordinator — never from inside AccountService."*

The repo already solves exactly this by **registration**, and `AccountService` is itself the consumer of the pattern: `this.networkService.registerChainPurgeSubscriber(async (profileId, chainId) => this.clearChainState(profileId, chainId))` (`account/service.ts:111`) — a higher-phase service registering an awaited callback into a lower-phase one, which then awaits it in dependency order and fail-fasts if any subscriber failed (`network/service.ts:736-770`). No type import, no cycle, no event.

Applied here: `TokenBalanceService.init` registers `(profileId, addresses) => this.purgeForAccounts(addresses, profileId)` with `AccountService`; `reconcileImportedAccounts` lists → awaits registered purges → deletes rows. This:

- eliminates C-1 entirely (no new RPC surface, `Methods` untouched, client untouched);
- eliminates C-2 (no client lifecycle);
- makes Ask 5's ordering a two-line rearrangement inside one method rather than a composable protocol;
- and answers B's strongest objection to A — *"any future account-removal feature re-opens it and must remember the join"* — because any future removal path inherits the cascade for free.

This capability is missing from `recon.md`'s reuse map, which lists the coordinator but not the registration pattern. That is the one real recon gap, and it is the gap that shaped the plan.

### A-2 — **High** — stamp in `restore()`, not in `relinkRestoredTokenBalances`

Direct answer to the audit's question: **`restore()` should derive the fields itself.**

`TokenBalanceService` already holds `this.tokenService`, and `getTokensRaw(profileId)` takes an **explicit** profileId with no active-profile gate (`token/service.ts:186-190`) — unlike `getTokenRaw(id)`, which calls `requireActiveProfile` + `requireOwnedRow` (`:199-203`) and would throw during restore since the imported profile isn't active until `:919`. So one read at the top of the restore hold gives an authoritative `Map<tokenId, Token>` for the profile being restored, and each row is stamped from it — or rejected with a `restoreError` if its `token` isn't owned.

Why this is materially better than relink stamping:

- **Removes the client from the trust path** (C-4). The service no longer accepts *any* identity field from the wire.
- **Closes an existing hole the plan doesn't notice**: today `restore()` writes a row for an arbitrary `token` id with **no ownership check at all** (`:552-563`) — the sole defense is the composable's relink. A service-side owned-token lookup makes the restore fence real.
- **Makes "old backups remain fully importable" true by construction**, not by composable cooperation — and it makes Inference 2 moot.
- **Deletes the C-4(a)/(b) index-alignment and failed-row traps** before they're written.
- Leaves `relinkRestoredTokenBalances` completely unchanged (its `token: newId` remap and chain-equality cross-check still carry their weight), removing one file from the diff.

Cost: one extra `getTokensRaw` per restore batch. Ordering is already correct (tokens at `:840`, balances at `:888-893`).

### A-3 — **Medium** — the plan under-specifies the pieces most likely to go wrong

Add to the change map / phase text, all verified as necessary:
- the raw second pass predicate for `purgeForAccounts` and its deliberate skip of unattributable rows (C-7);
- the `this.tokens.has(...)` emit guard and the abort-on-error property of `purgeRows` (C-3);
- `services/cross-profile-isolation.test.ts` (two assertions go red; the `as` cast hides it from the compiler), `services/storage-codecs.test.ts:98-111`, `utils/full-backup-helpers.ts:206` (deliberate no-op, C-12);
- `balance-projector.ts` — either add the identity guard or record why it stays authoritative-lookup (Inference 3).

### A-4 — **Medium** — gate gap: the composable test isn't in any gate before Phase 5

Phase 1 touches the relink (under A-2 it wouldn't, which is another point for A-2) and Phase 3 touches the composable, but the gates are `test src/wallet/services/token-balance/` and `test src/wallet/services/`. `apps/extension/src/composables/useFullBackupImport.test.ts` — which has ~10 token-balance cases including `:1093-1222` on the relink key — sits under `src/composables/` and is first exercised by `audit:vue` in Phase 5. Add `bun run --cwd apps/extension test src/composables/useFullBackupImport.test.ts` to the Phase 1 and Phase 3 gates. (All named commands exist: `package.json:17,22,24,29,35`.)

### A-5 — **Low** — `existsByTokenAndAccount` is dead

`balance-repository.ts:78-81` documents itself as "used by the projector write loop"; repo-wide grep finds no caller. Since Phase 2 is explicitly a workaround-retirement pass, delete it there.

### On the identity-filter safety question

Safe for every existing consumer, with the two gaps in Inference 3 above. UI reads only `TokenBalanceInfo` (`TokensView.vue`, `BalanceView.vue`, `TokenCard.vue`, `tokens/[id].vue`, `send.vue`); `utils/core.ts:145-165` goes through `getTokenBalances`; `requestBalanceRefresh` (`:198-215`) is already effectively scoped because token ids are globally unique, so incoming-transfer's outbox (`incoming-transfer/service.ts:1904`) is unaffected. `onTokenUpdated` (`:425-437`) will re-enqueue identity-mismatched rows that then fail the write with `"Token no longer active"` — noise, not corruption.

---

## Conditions for approval

1. Correct the Security section: `purgeForAccounts` **is** RPC-exposed under the composable-orchestration design (C-1) — or adopt A-1 and make the statement true.
2. **Adopt A-1** (awaited registered subscriber, `registerChainPurgeSubscriber` precedent) or explicitly rule against it with a reason that survives `account/service.ts:111`; correct `recon.md:123`.
3. **Adopt A-2**: derive `chainId`/`contract` in `restore()` from `tokenService.getTokensRaw(profileId)`; reject rows whose token the profile doesn't own; leave `relinkRestoredTokenBalances` alone.
4. **Ask 5 = split** (purge before delete). Strike Inference 4 and replace it with C-5's finding.
5. Pin C-3 (foreign/empty active token map during purge) and C-6 (≥200-row transition, one canonical row per pair, bounded time) as tests, not prose.
6. Specify the raw second-pass predicate and its deliberate skip (C-7); add `getTokenBalance(id)` to the identity filter (C-8); decide and record the `balance-projector.ts` position (Inference 3).
7. Fix the Assumptions section: Fact 9 (C-4), Fact 12 (two raw-shape readers exist), Fact 5 path, Fact 6 line numbers; mark Inference 1 as test-backed and Inference 4 as retracted.
8. Add the composable test to the Phase 1/3 gates (A-4); add `cross-profile-isolation.test.ts`, `storage-codecs.test.ts`, `full-backup-helpers.ts` to the change map (A-3).

Asks answered: **1 → A** · **2 → all three fields** · **3 → no deletion, filter only** · **4 → no sweep** · **5 → split, purge first** · **6 → `mid` confirmed**.

### Critical files for implementation
- apps/extension/src/wallet/services/token-balance/service.ts
- apps/extension/src/wallet/services/token-balance/spec.ts
- apps/extension/src/wallet/services/account/service.ts
- apps/extension/src/composables/useFullBackupImport.ts
- apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts

conditional approve (with conditions: correct or eliminate the false "not RPC-exposed" claim (C-1); adopt the registered-awaited-subscriber shape per `account/service.ts:111` or refute it explicitly and fix `recon.md:123`; move `chainId`/`contract` stamping from `relinkRestoredTokenBalances` into `restore()` via `tokenService.getTokensRaw(profileId)` with fail-closed rejection of unowned tokens; reverse the Ask-5 ordering to purge-before-delete and retract Inference 4, which is factually wrong; pin C-3 and C-6 as tests; specify the raw second-pass predicate and add `getTokenBalance(id)` to the identity filter; repair Facts 5, 6, 9 and 12; add `useFullBackupImport.test.ts` to the Phase 1/3 gates and `cross-profile-isolation.test.ts` / `storage-codecs.test.ts` / `full-backup-helpers.ts` to the change map)
