# Phase 0 — recon + dual audit verification trail

## Pre-audit self-verifications (done while the auditors ran)

- **Relink strictly precedes balance restore, single path**: `relinkRestoredTokenBalances` at
  `useFullBackupImport.ts:851`, balance slice restored in the generic loop at `:890`. (Later mooted
  by adopting A-2 — stamping moves into `restore()` — but recorded because Inference 2 rested on it.)
- **`isRowEmittable` takes `tokenId: number` only** (`balance-job-queue.ts:55`); every call site
  (`:179,193,272,287`) already holds the full row, so an identity-check signature change is clean.
  Two queue tests wire it (`balance-job-queue.test.ts:469,499`).

## Fable-leg claims verified against source before adoption (all TRUE)

| Claim | Verified at |
|---|---|
| Registration pattern exists for higher-phase → lower-phase awaited callbacks | `account/service.ts:111` — AccountService registers `clearChainState` into NetworkService's chain-purge subscriber list |
| The `profileId`/`chainId`/`contract` triple is immutable on tokens | `token/service.ts:389-394` — `updateToken` throws "token profile id, chain id and contract cannot change" |
| `getTokensRaw(profileId?)` has no active-profile gate (usable mid-restore); `getTokenRaw(id)` requires the active profile | `token/service.ts:186-190` vs `:199-203` |
| `restore()` writes rows for arbitrary `token` ids with no ownership check | `token-balance/service.ts:552-563` — the hole A-2 closes |
| Restore-error allowlist for balances is `[ID]` only; `address`-class fields deliberately excluded | `full-backup-helpers.ts:206` (TOKEN_BALANCE row), doc at `:167-178` |
| The reconcile call is catch-and-continue — a thrown follow-up purge would be silently swallowed | `useFullBackupImport.ts:914-917` |

## The two recon errors the fable audit exposed

1. **`recon.md`'s dependency-direction constraint was wrong** ("AccountService cannot call into
   TokenBalanceService… must be orchestrated from above"). The repo's own registration pattern
   (`registerChainPurgeSubscriber`) is exactly a higher-phase service registering an awaited callback
   into a lower-phase one — no import, no cycle, no event. That wrong constraint is what pushed the
   draft toward composable orchestration, which in turn forced RPC exposure (the fable C-1 Critical:
   a composable call reaches services only through the port dispatcher, whose method set is
   fail-closed — so "internal + composable-called" and "not RPC-exposed" are mutually exclusive).
2. **Draft Inference 4 was factually wrong**: an account-orphaned row points at a live token of a
   live profile, so identity filters do NOT hide it, and `backup()` exports it into every future
   backup. The crash-window residual was not self-healing — the ordering must be purge-before-delete.

## Codex-leg claims verified against source before adoption (all TRUE)

| Claim | Verified at |
|---|---|
| Same key importable on multiple chains in ONE profile → purge must be `(profileId, chainId, address)` | `account/service.ts:446-448` dup check filters by `(profileId, chainId)` before the address test; `imported-keys-repository.ts:26-36` full-tuple keys; `reconcileImportedAccounts` checks keys per-`(profileId, chainId, address)` but returns bare addresses |
| `ensurePairsHoldingLock` occupancy set is `${token}:${account}` only — a stale identity-mismatched row blocks canonical creation | `token-balance/service.ts:282-287` |
| Hostile backups can mint duplicate canonical pairs (registry dedupes row ids, not pairs) | `backup-migration-registry.ts:281-291`; restore allocates + writes each row `token-balance/service.ts:552-563` |
| `refreshBalances` ignores its minutes param and hardcodes 30 — self-heal is user-action-dependent | `utils/core.ts:142-165` (`checkAge(tb.updatedAt, 30)`, param named `_minutes`) |
| Identity gaps beyond the plan's two filters: `getTokenBalance(id)`, `refreshTokenBalance`, `requestBalanceRefresh`, `refreshAccountBalances`, `onTokenUpdated`, `onTransactionUpdated`, projector | `token-balance/service.ts:156-220,425-435,499-520`; `balance-projector.ts:51-76` |
| Fail-fast is feasible: the reconcile call precedes `finalizeStarted = true`, so removing its catch escapes to the outer pre-finalize rollback (`rollbackCreatedProfile`) | `useFullBackupImport.ts:909-923,987-993` |
| `existsByTokenAndAccount` is dead in production (repo test + structural test-fake only) | repo-wide grep: `balance-repository.test.ts`, `balance-job-queue.test.ts:98` fake — `balance-job-queue.ts` itself never calls it |

## Dispute resolutions (fable vs codex)

1. **Stale-row deletion** — fable NO (codec-hidden-token case = data loss) vs codex YES-narrow (only
   live-token identity-mismatch, active profile). NOT actually in conflict: codex's criterion
   requires the token id to resolve to a live token, which structurally excludes fable's killer case
   (token absent from the map). Adopted merged, carve-out pinned by test.
2. **Legacy debris sweep** — fable NO (unattributable, cross-profile) vs codex YES (allocator-tax +
   storage argument: `id-allocators.ts:17-36` scans physical keys incl. hidden per allocation).
   Codex rules per the owner's decision-routing directive, and its argument is materially stronger:
   balance rows are recomputable projections; swept rows are invisible + never exported meanwhile,
   and each profile's own next activation reconcile recreates its pairs. Adopted with codex's rails
   (lock-held, exact legacy-shape predicate, snapshot-byte recheck via `purgeMalformed`).
3. **Orchestration shape** — fable A-1 registration vs codex composable 3-step. A-1 adopted: it
   achieves codex's exact list→purge→delete ordering INSIDE `reconcileImportedAccounts` while
   discharging codex's own Medium RPC-expansion finding. To be ratified in the discharge resume.
