1. **Tombstone storage**

Use a dedicated `TombstoneRepository` over `browserApi.storage.local`, not decoded `EntityStorage` reads.

`EntityStorage.getKeys()` is decode-free ([entity_storage.ts:118](/home/homelab/Projects/nulo/nulo-3/packages/wallet-core/src/storage/entity_storage.ts:118)), but `get()`/`getValues()` call `decodeRow`, which asynchronously removes syntax-invalid JSON ([entity_storage.ts:61](/home/homelab/Projects/nulo/nulo-3/packages/wallet-core/src/storage/entity_storage.ts:61)). `ValueStorage` has no key enumeration ([value-storage.ts:28](/home/homelab/Projects/nulo/nulo-3/packages/wallet-core/src/storage/value-storage.ts:28)).

Smallest safe shape:

- Use `EntityStorage` only for `set/delete`.
- For reservation/resume, call `storage.local.get()`, filter `nulo:core:profile-tombstones@`, and derive IDs from keys.
- Parse each value manually with `JSON.parse` + schema `safeParse`, never removing failures.
- Raw-key IDs populate `reservedIds`; only valid payloads drive cleanup.

Do not call tombstone `getValues()` anywhere.

2. **Ownership and wiring**

The graph is registered at [runtime.ts:159](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/runtime.ts:159) and started at [runtime.ts:201](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/runtime.ts:201). `dependencies` are service-name strings ([base/index.ts:21](/home/homelab/Projects/nulo/nulo-3/packages/wallet-core/src/base/index.ts:21)); phases are awaited sequentially ([base/index.ts:65](/home/homelab/Projects/nulo/nulo-3/packages/wallet-core/src/base/index.ts:65)).

Register the coordinator last and declare dependencies on Profile, Execution, Transaction, AuthRegistry, TokenBalance, IncomingTransfer, Contact, DappSession, FPC, Journal, Account, Token, and Network.

Avoid a setter/startup race by constructor-injecting a lazy delegate into `ProfileService`:

```ts
() => services.get<ProfileDeletionCoordinator>(ProfileDeletionCoordinator.name)
```

Expose only `snapshot(profileId)` and `runFor(profileId, snapshot)`. The closure must not be resolved during `ProfileService.init()`; currently that init only resolves PasskeyService ([profile/service.ts:130](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/profile/service.ts:130)). Thus ProfileService has no coordinator dependency and no cycle.

3. **Lock boundary**

Implement three distinct sections:

```ts
const snapshot = await runExclusive(phase1)
await delegate.runFor(id, snapshot)
await runExclusive(() => tombstones.clearIfSame(id, snapshot))
```

Phase 1 contains: validate live/non-tombstoned profile; raw account/token/network snapshot; durable tombstone write; epoch bump; profile-row deletion; pending-secret zeroization; active-session close; UI-only emit. Note current code emits before closing ([profile/service.ts:568](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/profile/service.ts:568)); reverse that.

The purge is entirely outside the non-reentrant facade lock ([profile/service.ts:109](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/profile/service.ts:109)). Purge methods must use raw profile IDs and their own locks—never `requireActiveProfile`, `getActiveProfile`, or `getProfileSecret`. Otherwise cleanup either fails after session closure or re-enters ProfileService.

Clear the tombstone only after every purge succeeds; compare the stored snapshot/generation before deleting it.

4. **Read gating**

Use an in-memory `Set<string>` loaded once from raw keys before `SessionManager.restore()` ([profile/service.ts:130](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/profile/service.ts:130)), then maintained synchronously by the sole tombstone writer. Per-call full-storage scans are unnecessary.

Centralize `getLiveProfile/assertLive/reserveId`; route `getProfiles`, active-profile restoration/read, unlock phases 1 and 3, passkey lookup, exports, confirmation, secret access, create/import/restore ID collision checks, mutations, and `finalizeRestore` through it. `getProfiles` currently bypasses the facade lock entirely ([profile/service.ts:156](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/profile/service.ts:156)); serialize it or ensure the cache transition is atomic before visibility changes.

5. **Deletion epoch**

Put a small shared `ProfileDeletionState` beside ProfileService, initialized from tombstone raw keys:

```ts
capture(id): number
beginDeletion(id): void // increments epoch + marks deleting
assertCurrent(id, captured): void
```

Leaves capture before external work and, after acquiring the same service lock used by `purgeForProfile`, re-check immediately before persistence. This ordering ensures either the old write finishes before purge, or it acquires afterward and is rejected.

It must cover transaction polling ([transaction/service.ts:220](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/transaction/service.ts:220)), token metadata ([token/service.ts:171](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/token/service.ts:171)), balance projection ([balance-job-queue.ts:123](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:123)), journal writes, and approved execution. Add `ExecutionService.quiesceProfile` before purging journal state.

6. **Resume**

Immediately after `await services.start()`:

```ts
void coordinator.resumePending().catch(logFailure)
```

This does not block unrelated startup. Make `runFor` single-flight per profile and every deletion idempotent. Resume must first complete phase 1 under ProfileService’s lock, then run the full purge. Invalid tombstones remain reserved and surface “deletion pending.”

7. **Scope**

The full coordinator plus D13 is required to claim “deleted means verifiably erased.” Without fencing, an already-running worker can write after purge and after tombstone clearing. A smaller PR is coherent only if it **never clears the tombstone or reports success** until fencing lands; that closes ID-reuse/cross-profile exposure but not privacy erasure.

Two code-grounded blockers must be folded into Phase 8:

- `NetworkService.purgeChain` still swallows subscriber and PXE failures ([network/service.ts:601](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/network/service.ts:601)); add a strict fail-fast path.
- `TransactionService`’s lock currently guards only restore ([transaction/service.ts:311](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/transaction/service.ts:311)); `addTransaction`, worker writes, and deletion remain unlocked despite the Phase-2 plan. This is a direct resurrection race, not polish.