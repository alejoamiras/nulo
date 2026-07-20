# Implementation plan — one comprehensive PR

Target: `feat/backup-restore-security-hardening` at `a1242ed`. Keep every phase on this branch and open one squash-merged PR to `dev`. No numbered storage migration; tombstone storage defines the pre-production baseline.

## Architectural decision: awaited destructive coordinator

Do not change `EventHandler.invoke`. Its synchronous, best-effort semantics are used broadly by UI notifications and cross-process events; making it awaited would silently change ordering, error propagation, and RPC latency while still being unable to await offscreen listeners reliably.

Add an extension-level `DeletionCoordinator` service with explicit, typed cleanup calls:

1. `ProfileService.deleteProfile` persists a profile tombstone and closes/hides the session before cleanup. The profile row remains reserved.
2. The coordinator snapshots and persists exact `Network[]`, `Account[]`, and `Token[]` before deleting any child rows.
3. It constructs a runtime-asserted non-empty account set; tx/auth/incoming cleanup consumes `(chainId, canonicalAddress)` from that snapshot. Empty means explicit no-op, never “omit filter.”
4. Token-balance cleanup consumes authoritative token snapshots before token deletion.
5. Chain/profile cleanup is awaited and fail-fast: tx pending state, auth registry, incoming transfers/schedulers/trust, token balances, FPC, journal, contacts, dApp sessions, accounts/tokens/networks, and PXE.
6. Only after all critical cleanup succeeds: delete profile row, delete tombstone, emit `onProfileDeleted` as notification only.
7. A standalone network deletion uses the same coordinator with a network tombstone and chain-scoped snapshots.
8. Coordinator startup depends on all cleanup services and awaits one retry of every tombstone. Failure leaves it hidden/reserved and retryable without blocking unrelated profiles.

This is externally atomic, not ACID rollback: partial physical erasure is idempotently resumed, while tombstones prevent partial state or freed IDs from becoming visible. Restore/id allocation must treat tombstoned IDs as occupied, including the crash window between final row deletion and tombstone removal.

Migrate `onProfileDeleted`/`onAccountDeleted`/`onTokenDeleted` cleanup consumers to explicit coordinator methods. Retain events for UI/cache notification only. Keep `registerChainPurgeSubscriber` temporarily only as a deterministic typed registry if needed; remove swallowed errors and registration-order reliance.

## Phase 1 — Restore result and helper contracts

Introduce `RestoreResult<T> = { ok: true; row: T } | { ok: false; error: { message; input } }` in `packages/wallet-core/src/base/index.ts`. Convert `restoreRows`, service/client restore signatures, `collectRestoreErrors`, and the import composable together—no mixed `restoreError` convention.

Replace the helper footgun with:

- `normalizeAllIds(data, key, value)`
- `remapMatchingId(data, key, oldId, newId)`
- one-pass `remapIdsFromMap` for network maps

Files: `wallet-core/src/base`, `restore-rows.ts`, `full-backup-helpers.ts`, service specs/clients and existing restore tests.

Tests: explicit success/error narrowing; hostile input containing `restoreError` cannot impersonate failure; unchanged-profile no-op keeps all slices semantically identical.

Validation:

```bash
bun run --cwd packages/wallet-core test
bun run --cwd apps/extension vitest run src/wallet/services/restore-rows.test.ts src/utils/full-backup-helpers.test.ts
bun run typecheck:all
```

## Phase 2 — Import validation, provenance, and collision safety

Findings A/B/F/H:

- `AccountService.restore`: `AccountSchema.parse`, canonicalize with Aztec address parsing, require a successfully restored `(profileId, chainId)` network, derive the account from profile secret plus `(chainId,type,index)`, and require exact derived-address equality before writing.
- `TransactionService.restore(profileId, rows)`: `TxSchema.parse`; verify each `(chainId, canonicalAddress)` through `AccountService`; under the tx lock perform `contains(hash) + create`, recording collisions without overwriting. Use the same lock for `addTransaction`, worker writes, and deletion to close TOCTOU/resurrection.
- `AuthRegistryService.restore(profileId, rows)`: `AuthwitSchema.parse`; require the account to belong to that profile.
- `TokenBalanceService.restore(profileId, rows)`: `TokenBalanceRawSchema.parse`; resolve token and account, require both profile ownership and equal chain.
- Remove the composable’s tx-only address filter; services become authoritative. The composable supplies the newly restored profile ID, not an attacker-authored allow-set.

Tests, all red before the fix: pre-existing foreign account graft for tx/auth/balance; same address on wrong chain; whitespace/malformed address; derivation mismatch; malformed codec-hidden rows; existing victim hash and duplicate-in-batch collisions; pending collision never enters polling.

Validation:

```bash
bun run --cwd apps/extension vitest run src/composables/useFullBackupImport.test.ts src/wallet/services/account src/wallet/services/transaction src/wallet/services/auth-registry src/wallet/services/token-balance
bun run typecheck
```

## Phase 3 — One-pass relinking and token validation

Findings E/G plus structural token pairing:

- `NetworkService.restore` excludes every source network ID while allocating collision replacements.
- Build the complete index-paired old→new map first, then rewrite each original child row once. Pin mixed results as `[M1, N2, N3, M4]`, with created networks 1/3/4.
- `TokenService.restore` runs `TokenSchema.parse` before ID allocation/write.
- Relink balances by token input/result index: each successful token maps its own numeric old ID to numeric new ID. A failed duplicate drops only its own balance; remove composite-key ambiguity logic.
- Add real-service raw-storage tests using complete `TokenSchema` and `TokenBalanceRawSchema` rows.

Files: `network/service.ts`, `token/service.ts`, `useFullBackupImport.ts`, helper and service tests.

Validation:

```bash
bun run --cwd apps/extension vitest run src/composables/useFullBackupImport.test.ts src/wallet/services/network/service.test.ts src/wallet/services/token
bun run lint
```

## Phase 4 — Authoritative token deletion payload

Finding C:

Add `profileId` to `TokenInfo`/`getTokenInfo`. Incoming-transfer deletion resolves the network for that profile, never via `getActiveProfile`; token-balance cleanup also receives authoritative ownership.

Test deleting an inactive profile’s same-chain/same-contract token: only that profile’s records/trust/schedulers change; active-profile history remains byte-identical.

Files: token `spec.ts`, `utils.ts`, `service.ts`, incoming-transfer and token-balance services/tests, affected UI typings.

Validation:

```bash
bun run --cwd apps/extension vitest run src/wallet/services/incoming-transfer src/wallet/services/token-balance
bun run typecheck
```

## Phase 5 — Persisted deletion coordinator and PXE erasure

Finding D:

Add coordinator/tombstone repository, runtime wiring, direct `clearProfileState`/`clearAccounts` methods, and deterministic cleanup ordering. Profile/network reads, unlock/finalize, creation, and restore exclude tombstoned IDs.

PXE gains awaited `clearProfileState`. IndexedDB `error` rejects; `blocked` waits for eventual success but rejects on a bounded timeout. Shared `keyval-store` is deleted only when no surviving PXE profile databases remain. No cleanup failure is logged as success.

Tests:

- Delete promise remains pending while a cleanup is held.
- Inject failure at every critical stage: row remains tombstoned and retry succeeds.
- Reconstruct the service graph over the same fake storage to prove restart resume.
- Immediate restore cannot reuse the tombstoned ID or be clobbered.
- Pending tx cannot rewrite after purge or query another profile’s RPC.
- PXE `error`/permanent `blocked` rejects.
- Replace the hand-rolled loop in `cross-profile-isolation.test.ts` with real `NetworkService.deleteNetwork`.

Validation:

```bash
bun run --cwd apps/extension vitest run src/wallet/services/deletion-coordinator.composition.test.ts src/wallet/services/cross-profile-isolation.test.ts src/wallet/services/profile src/wallet/services/network
bun run --cwd packages/aztec-runtime vitest run src/pxe/service.test.ts
```

## Phase 6 — Required integration gates

Make the sandbox/arming contract in `backup-restore-integrity.test.ts` unconditional under the agent runner; missing setup must fail rather than skip. Extend it to exercise foreign auth/balance rows and preserve valid rows.

```bash
bun run audit:vue
bun run test:e2e
NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/backup-restore-integrity.test.ts
bun run e2e:agent
```

## Sequencing and parallelism

Phases 2 and 3 are parallelizable after Phase 1. Phase 4 is independently implementable but must land before Phase 5. The coordinator is coupled to A/B/C cleanup APIs and should integrate only after their ownership contracts stabilize. Everything remains one PR.

## Security & adversarial review

Request a dedicated audit after Phase 5, focused on:

- SW termination at every tombstone/snapshot/delete boundary.
- Empty-set broad-delete mistakes and mixed-chain address aliases.
- Tx worker writes racing cleanup and hash collision checks.
- Sequential remap reintroduction.
- PXE shared-database handling and blocked deletion.
- Any remaining destructive reliance on `EventHandler`.

Dangerous “obvious” fixes: globally awaiting `EventHandler`; deleting the profile before cleanup; `Promise.all` over order-dependent erasure; snapshotting after the first child deletion; `contains` outside the tx lock; or treating IndexedDB `blocked` as success.

## Assumptions

Facts:

- Branch/base and `a1242ed` are correct.
- Pre-production means no numbered migration.
- PR #275’s index pairing, profile normalization, delimiter-safe key, and append-merge remain intact.

Inferences:

- Tombstones must cover standalone network deletion as well as profiles to satisfy atomicity consistently.
- Snapshotting tokens/networks alongside accounts is necessary for restart-safe cleanup.

Asks:

- Confirm failed tombstones should be hidden from normal UI while exposing a retryable “deletion pending” diagnostic.
- Confirm a bounded PXE-delete timeout is preferable to an indefinitely hanging delete request.