# recon — account-balance-orphans

Read-only recon (blueprint Phase 0.4) against `origin/dev` @ `9103dea0` (includes #485 + #486).
Two batched `Explore` agents: a deletion-path/cascade map and a schema-extension feasibility study.
The owner's framing question: **does this need architectural work, or a point patch?**

## The defect, precisely scoped

`TokenBalanceRaw` (`token-balance/spec.ts:30-38`) carries no `profileId`/`chainId`; rows are keyed
`(token, account)` by construction discipline. There is **no standalone delete-account RPC anywhere**
(repo-wide grep). Accounts disappear through exactly three paths:

| Path | Balance rows end up… | Why |
|---|---|---|
| `AccountService.clearChainState` (chain purge, `account/service.ts:146-158`) | **fully deleted** | `TokenService.clearChainState` (`token/service.ts:162-176`) kills the chain's tokens; `onTokenDeleted` (`token-balance/service.ts:439-455`) sweeps their rows account-agnostically |
| `AccountService.purgeForProfile` (`:589-630`, deliberately silent) | **fully deleted** | `ProfileDeletionCoordinator.purge` awaits `balances.purgeForTokens(s.tokenIds)` directly (`profile-deletion/coordinator.ts:121`) before the account/token tail |
| **`AccountService.reconcileImportedAccounts` (`:785-797`)** | **ORPHANED** | deletes only the Account row + emits `onAccountDeleted`, which no balance code subscribes to (`token-balance/service.ts:131-136`) |

**The orphan is reachable in ONE restore pass** — no re-import needed to produce it: full-backup
restore writes token-balance rows for a restore-accepted imported account (`useFullBackupImport.ts:864-898`,
filtered only by address acceptance `:254-258` + chain relink `:270-335`, neither of which knows about
key-row presence), and only afterwards (`:909-918`) does `reconcileImportedAccounts` drop an imported
Account whose key row is missing. A corrupted or hostile backup (Account row present, key row absent)
yields a live orphaned balance row for a live token.

**Re-import reattaches it.** Imported addresses are recomputed from the raw key (`account/service.ts:441-444,705-707`)
— byte-identical on re-import. `importAccount`'s duplicate check is `(profileId, chainId)`-scoped (`:447-448`),
so the fresh row lands, `onAccountAdded` fires, and #486's `ensurePairsHoldingLock` **skips** the pair because
the stale row already occupies `${token}:${account}` (`token-balance/service.ts:282-287`) — it is not even
enqueued for resync.

**Severity calibration (softer than first assumed):** the stale numbers are not permanent. Three unscoped
self-heals exist — `refreshBalances(10, …)` on every unlock (`auth.vue:174`, refreshes rows ≥10 min old),
token-detail mount (`tokens/[id].vue:72-84`), and the manual refresh menu (`TokensView.vue:301-302,417`).
Exposure = wrong balances rendered until the next unlock/visit/refresh. Real, silent, bounded.

## Why an event subscriber is the wrong fix (the "monkey-patch" ruled out)

- `EventHandler.invoke` (`event-handler.ts:47-61`) neither awaits nor observes async subscribers; `Service.emit`
  (`base-service.ts:129-133`) is synchronous. Every `onAccountDeleted` reaction is structurally fire-and-forget.
- The repo's own strongest precedent compensates for exactly this: `ProfileDeletionCoordinator.purge`
  (`coordinator.ts:109-131`) does the real work through **direct awaited calls in dependency order** and treats
  the trailing events as harmless no-ops. `AccountService.purgeForProfile` is *silent on purpose* for the same
  reason (`account/service.ts:593-599`, audit H3: a late fire-and-forget consumer can clobber a successor at a
  reused deterministic address).
- Existing sibling shape to mirror: `TransactionService.purgeForAccounts(addresses, profileId?)`
  (`transaction/service.ts:301-364`, with `isSoleOwner` `:279-295`) and `AuthRegistryService.purgeForAccounts`
  (`auth-registry/service.ts:428-449`). `TokenBalanceService` has `purgeForTokens` but **no `purgeForAccounts`**.

## Shared addresses across profiles — confirmed, deliberately reachable

Derivation is mnemonic-only, never profileId-salted (`derive-account-seed.ts:25-31`; profileId only selects the
secret, `account/service.ts:227`). The duplicate-wallet guard is soft (`profile/service.ts:1917-1928`,
`allowDuplicate` flows from a warn-and-confirm dialog), and the same raw key imports into two profiles
unblocked (`imported-keys-repository.ts:26-35` keys per-profile). The design acknowledges collisions
explicitly (`account/spec.ts:14-18`; `transaction/service.ts:305-310`: "an address-only match deletes the
OTHER profile's history too"). **A balance purge keyed by bare address is forbidden.**

## Schema-extension feasibility (the architectural option) — LOW cost, leaning LOW

1. **Migrations policy:** pre-production; CLAUDE.md: "*do NOT write migrations… A shape change simply
   redefines the launch baseline*". Empirically `realMigrations = []` (`migrations/index.ts:18,22`).
2. **`TokenBalanceRaw` is the odd one out in its own family.** `Account` (`account/spec.ts:110-135`, composite
   storage key), `Token` (`token/spec.ts:11-17,39-41`) and `ImportedAccountKey` (`account/spec.ts:95-101`) all
   carry required `profileId`/`chainId`. No recorded rationale for balances omitting them — #486's docs treat
   the absence as a workaround target and named "schema-carried incarnation" as the durable fix, deferred for
   scope only.
3. **Both write sites already hold every value in scope**: `createTokenBalanceHoldingLock` receives the full
   `Token` (profileId/chainId/contract, `token/spec.ts:11-17`); `restore()` already takes `profileId` as a
   required param for the deletion fence (`token-balance/service.ts:537,542-546`).
4. **The transition self-heals through #486.** `TokenBalanceRawSchema` is a plain `z.object` (not strict);
   with new REQUIRED fields, old rows fail the read codec → KEEP-but-hidden (`entity_storage.ts:95-142`) →
   invisible to `getAll()` → `reconcileBalanceRows` (runs every init + profile switch,
   `token-balance/service.ts:149,397`) recreates the pair as a fresh canonical row and enqueues its projection.
   The just-shipped reconcile IS the migration story. Residue: the hidden old-shape bytes are never purged
   (harmless debris; a raw sweep is a design option).
5. **Backups degrade gracefully:** old exports' balance rows produce per-row `restoreError`s
   (`restore-rows.ts:22-35`) and the post-activation reconcile recreates the pairs. No backup-version bump
   (`CURRENT_BACKUP_SCHEMA_VERSION` derives from `realMigrations`, `backup-migrator.ts:74`); compat-epoch
   governs key-derivation generations only (`backup-migration-registry.ts:58-71`). Registry entry `:205`
   anchors identity on `id` — unaffected.
6. **Zero UI changes** (UI consumes only projected `TokenBalanceInfo`; repo-wide grep confirms no other
   readers of the raw shape).
7. **What the fields retire** (each workaround's own comment names the gap as its cause): the token-map-only
   cross-profile guard (`service.ts:171-174`), `backup()`'s owned-token-ids join (`:528-530`), the queue's
   `isRowEmittable` indirection (`balance-job-queue.ts:50-56`), `reconcile-pairs`' manual chain join +
   temporal-id-reuse caveat (`reconcile-pairs.ts:42-61`), and the e2e helpers' contract→id joins
   (`helpers.ts:1322-1331,1403-1412`). Storing `contract` closes the **temporal token-id-reuse residual**
   (identity comparison instead of reusable numeric id) — the thing #486 filed as "not solvable from this schema."
8. **The single riskiest part:** `restore()` stamping `chainId`/`contract`. Token restore **reallocates ids**
   (`token/service.ts:721`), so restored rows must resolve those fields through the existing old-id→new-id
   relink (`relinkRestoredTokenBalances`, `useFullBackupImport.ts:270-335`, which already emits
   "could not be re-linked" restoreErrors). A wrong join silently stamps the wrong chain/contract — worse
   than today. This path gets the audit focus.

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Profile-scoped account purge shape | `TransactionService.purgeForAccounts(addresses, profileId?)` + `isSoleOwner` (`transaction/service.ts:279-364`) | **adapt** — the signature and scoping discipline to mirror |
| Awaited cascade orchestration | `ProfileDeletionCoordinator.purge` (`coordinator.ts:109-131`) — dependents purged before parents, direct awaits, snapshot + single-flight + idempotency | **adapt** — the ordering rationale (purge balances BEFORE dropping the account row) |
| Serialized deletion inside the balance service | #486's lock: `onTokenDeleted`/`purgeForTokens` already hold it; `invalidatedBalanceIds` fence for in-flight projections (`token-balance/service.ts:439-478`) | **reuse-as-is** — a new `purgeForAccounts` joins the same lock + fence |
| Row-shape stamping precedent | `AccountSchema`/`TokenSchema` required `profileId`/`chainId`; `requireOwnedRow<T extends {profileId}>` (`require-owned-row.ts:12-17`) currently unusable for balances | **reuse-as-is** once the fields exist |
| Old-shape cleanup machinery | `repo.purgeMalformed` raw pass (`balance-repository.ts` / `purge-rows.ts:58-84`) | **consider** — could sweep codec-hidden old-shape rows; deletion-direction caution applies |
| Transition auto-repair | #486 `reconcileBalanceRows` (`token-balance/service.ts:312-348`) | **reuse-as-is** — IS the migration path for hidden/errored rows |
| Restore relink | `relinkRestoredTokenBalances` (`useFullBackupImport.ts:270-335`) | **adapt** — must carry chainId/contract resolution through the id remap |
| E2E balance assertions | `captureBalanceBaseline`/`waitForFreshBalanceRow`/`waitForTokenCardAmount`; shared `stopServiceWorker` (all `tests/e2e/fixtures/helpers.ts`) | **reuse-as-is** |

## Absence claims + search trails

- **No delete-account RPC.** Repo-wide grep for `deleteAccount|removeAccount`: one stale comment + spec file only.
- **No `purgeForAccounts` in token-balance.** Grep across the whole module: only `purgeForTokens`.
- **No balance-layer subscriber to `onAccountDeleted`.** Subscribers are exactly AuthRegistry (`auth-registry/service.ts:97-99`), Transaction (`transaction/service.ts:113,274-276`), IncomingTransfer (`incoming-transfer/service.ts:275,337-387`).
- **`reconcileImportedAccounts` has one caller**: `useFullBackupImport.ts:910`.
- **`changeAccountVisibility` deletes nothing** and nothing in the balance layer keys off visibility (`account/service.ts:287-303`; `token-balance` grep for `visible`: only the `all: true` comments).
- **Stale doc**: `network/service.ts:718-725`'s subscriber-order comment lists TransactionService, which removed its chain-purge subscriber (`transaction/service.ts:99-113`) — do not trust that comment for ordering.

## Collision / dedup risks

- **Do not add an `onAccountDeleted` subscriber** — structurally fire-and-forget; the coordinator precedent exists precisely because of that.
- **Do not purge by bare address** — sibling-profile destruction (shared addresses are a supported state).
- **Do not bolt cleanup onto `purgeForTokens`** — token-id scoping and account scoping are different axes; keep the two purge methods parallel to the Transaction/AuthRegistry family.
- **Dependency direction**: `AccountService` (phase 0) cannot call into `TokenBalanceService` (phase 1, depends on AccountService). The awaited purge must be orchestrated from above — the restore composable (the only caller of `reconcileImportedAccounts`) or a coordinator — never from inside AccountService.
