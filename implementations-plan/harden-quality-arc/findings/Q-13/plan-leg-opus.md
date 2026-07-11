# Q-13 planning leg — opus Plan subagent (raw)

## 0. What is already done (do not redo)
The **delete-before-emit cascade** is already extracted: `apps/extension/src/wallet/services/purge-rows.ts` (`purgeRows(rows, remove, emitDeleted)`) with a pinned test (`purge-rows.test.ts`), adopted by token, transaction, contact, operation-journal, fpc, account, auth-registry, dapp-session. The `restoreError` normalizer (`apps/extension/src/utils/restore-error.ts`) and cascade-fanout wiring (`NetworkService.registerChainPurgeSubscriber`, `ProfileService.onProfileDeleted`) are also shared. **Remaining open-coded scaffolding = restore loops, ID allocation, ownership guards.** The naive read of Q-13 ("extract the pattern") is wrong: shapes diverge hard, and `purgeRows` already proved the correct shape is *small explicit helpers, caller owns loading/locking*.

## 1. Per-service inventory (DIVERGENCES flagged)

| Service | Key | Key gen | Ownership model | Guard | Restore | profile-delete | chain-purge |
|---|---|---|---|---|---|---|---|
| token `service.ts:186,543` | `${id}` | numeric max+1 from getKeys() | active-profile (list only) | **getToken/deleteToken by-id have NO profile guard** | shared cursor id=max+1, id++ per row | onProfileDeleted→loop deleteToken | clearChainState+purgeRows |
| token-balance `service.ts:264` + `balance-repository.ts:42` | `${id}` | numeric max+1 via repo.allocateId() | **INDIRECT — no profileId field** (via token FK + account) | allocateId() per row | per-row catch | none (via onTokenDeleted) | none (via onTokenDeleted) |
| fpc `service.ts:197,264,471` | random hex8 | while(contains) getRandomHex(8) | active-profile | fpc?.profileId !== profile.id | keep-id-else-random + legacy-type reject + strip isProtocol | onProfileDeleted→purgeRows under lock | clearChainState+purgeRows |
| account `service.ts:105,208` | address | no id; numeric per-type index=max+1 | **CALLER-profile (profileId is ARG)** | account?.profileId !== profileId | **no realloc; pre-loop hasIntersectionByKeys→THROWS WHOLE restore** | onProfileDeleted→purgeRows | clearChainState+purgeRows |
| auth-registry `service.ts:151,429` | `${id}` + statuses keyed by account | numeric max+1 from getValues().id | **INDIRECT — no profileId** (via account) | none by-id beyond existence | cursor max+1, ++ per row | none (via account.onAccountDeleted) | none |
| contact `service.ts:99,285` | random hex8 | while(contains) getRandomHex(8) | active-profile | contact?.profileId !== profile.id | keep-id-else-random, per-row catch | onProfileDeleted→purgeRows | none |
| network `service.ts:238-487,634` | random hex8 | while(contains) getRandomHex(8) | active-profile (canonical Invalid id, 12 methods) | network?.profileId !== profile.id | safeParse + BACKUP_TOO_OLD + (profileId,chainId) collision reject + keep-id-else-random | onProfileDeleted→purgeChain per net | **OWNS purgeChain + subscriber registry** |
| incoming-transfer `service.ts:201` + repository.ts | records=siloedNullifier; trust=profileId\|networkId\|contract | none (natural) | CALLER-profile (arg) | filters by profileId in repo | **NO restore()** (re-discovered via PXE scan) | clearProfile (repo filters) | clearChain via subscriber |

**Three killer divergences:** (a) token-balance & auth-registry **have no profileId** — `ProfileScopedRepository<T extends {profileId}>` cannot even type them; (b) fpc/contact/network are **active-profile-scoped** while account/incoming-transfer are **caller-profile-scoped** (arg) — incoming-transfer `service.ts:221-224` explicitly documents that using getActiveProfile instead of the arg **wipes the wrong profile's rows**; (c) account's restore **throws the whole batch** on collision; every other restore is **per-row**.

## 2. Proposed abstractions — composable helpers, NOT base-class/mixin
- `restore-rows.ts` — per-row skeleton only: `restoreRows<TIn, TOut extends object>(rows, writeOne)`. ID allocation stays inside caller's writeOne (cursors diverge). NOT account (whole-throw).
- `id-allocators.ts` — `nextNumericId(storage)`, `nextRandomId(storage,len=8)`. auth-registry's max(values.id)+1 provably == nextNumericId iff key===`${id}` — verify with a test, don't assume.
- `require-owned-row.ts` — `requireOwnedRow<T extends {profileId:string}>(row, profileId, message="Invalid id")` throws unless row?.profileId === profileId. profileId passed EXPLICITLY (active-vs-arg stays visible). NOT for token-balance/auth-registry (no profileId).

**Reject base class:** untypeable for no-profileId entities; hides the guard (violates requireActiveProfile's own JSDoc); auto-active-profile would REINTRODUCE the wrong-profile-wipe bug at incoming-transfer:221. Reject mixin: no benefit over free functions.

## 3. PRIVACY adversarial
Isolation invariant: every read/mutate/delete of a profile-scoped row R confirms R.profileId === caller's authorized profile before returning/mutating; missing row / mismatched-or-absent profileId / unresolvable active profile MUST deny, never fall back to all-rows or active-default.

Leak vectors: (1) unfiltered list → sole public list method is listForProfile(profileId), raw getValues private; (2) active-profile used for cross-profile op (cascade fires for INACTIVE profiles) → requireOwnedRow takes profileId as arg; (3) guessable by-id getter with no guard — token/token-balance/auth-registry use SEQUENTIAL numeric ids → cross-profile enumeration trivial; token.getToken/deleteToken today have NO guard (reachable via TokenServiceClient RPC); close ONLY behind a new failing test as a tracked behavior change; (4) restore adopting rows into wrong profile → restoreRows must NOT overwrite profileId (remapIdInBackupData in useFullBackupImport.ts:297 owns remapping).

Cross-profile isolation TEST before any refactor (new cross-profile-isolation.test.ts, template = network/service.test.ts:174): seed FakeBrowserApi with p1/p2 rows in every store, active=p1, assert foreign get/delete deny + survive, lists p1-only, profile-p1-delete leaves p2 intact across all stores, restore doesn't mutate p2 + allocates fresh ids. Stays green through every phase.

## 4. Phasing (behavior-preserving, one service per PR)
0 pin (isolation + characterization tests, no prod change) → 1 helpers (restore-rows, id-allocators, require-owned-row + units) → 2 contact (least divergent) → 3 fpc then network (separate PRs; keep their in-writeOne quirks + network's purgeChain) → 4 token + account (token closes the by-id guard behind a new test = tracked change; account requireOwnedRow arg-scoped only, whole-throw restore stays hand-rolled) → 5 token-balance + auth-registry (restore-rows + nextNumericId only, NO profileId guard; incoming-transfer left as-is).

## 5. Decision ledger
Chosen: composable free functions. Rejected: base class (untypeable no-profileId; hides guard; auto-active-profile = wrong-profile wipe) + mixin.
Chosen: id allocation in caller's writeOne. Rejected: single injected allocateId (flattens token shared-cursor + token-balance per-row).
Chosen: requireOwnedRow(row, profileId) explicit arg. Rejected: resolve active profile inside helper.
Chosen: account excluded from restoreRows. Rejected: forcing per-row (changes whole-throw contract).
Unresolved: (a) token by-id guard latent leak vs intentional — trace RPC callers; (b) auth-registry values-vs-keys max — verify equal; (c) token-balance per-row allocateId O(n²) perf, out of scope; (d) restore ORDERING in useFullBackupImport.ts (token before token-balance FK remap) must not reorder.

## 6. Assumptions
Facts: EntityStorage API (get/set/delete/contains/getKeys/getValues) `packages/wallet-core/src/storage/entity_storage.ts`; Restored<T>=T&{restoreError?} `wallet-core/src/base/index.ts:19`; array_max `wallet-core/src/utils/arrays.ts`; only useFullBackupImport.ts drives entity restore; purgeRows adopted by 8 services.
Inferences: token-balance & auth-registry ownership transitive (0 profileId in spec); token by-id getters reachable unguarded via RPC clients.
Asks: confirm token.getToken/deleteToken lack-of-guard not relied upon; confirm e2e gate command; confirm auth-registry id max may unify to keys-based.
