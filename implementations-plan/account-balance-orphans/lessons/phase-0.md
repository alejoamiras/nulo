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
