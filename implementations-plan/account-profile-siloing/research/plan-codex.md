# Plan — Composite Account + Profile Siloing

Status: implementation plan for one PR  
Target branch: `dev` after Phase 1 / PR #314  
Primary invariant: the immutable composite scope

```ts
(profileId, networkId, chainId, accountAddress)
```

governs every durable activity record, cache slice, queued claim, execution fence, transaction write, snapshot, event, and rendered row.

## 1. Outcome and non-negotiable invariants

Done means:

1. A producer can mutate only the slice named by the producer’s own trusted scope envelope. There is no `ingestIntoActiveSlice(record)` API.
2. Changing profile, network, or account synchronously swaps the active slice reference. A cached slice renders immediately; it is not cleared and rebuilt.
3. A snapshot that finishes after a switch updates its requested scope’s inactive slice, never whichever slice is active at completion.
4. An old snapshot or event cannot resurrect a deleted row, clobber a newer event, or cross a scope-incarnation boundary after service-worker restart or re-import.
5. A dApp send is bound to its authorized profile and actual `from` account. Profile drift before broadcast aborts with a typed error, a failed durable journal entry, and user-facing warning.
6. No transaction is submitted after detected drift. The irreversible `node.sendTx` boundary is serialized against profile switching.
7. Queued journal creation and dispatch use the same account-selection function, including the wallet-index-ordered `NO_FROM` fallback.
8. Every journal load–modify–write and delete/supersede operation shares one lock and emits a causal mutation.
9. Incoming-transfer identity is `(scope, siloedNullifier)`, not a globally unique nullifier.
10. Legacy rows parse independently and do not break a table. Missing fields are lenient only after safe backend attribution; ambiguous legacy rows are quarantined instead of copied into multiple slices.
11. The dApp `ExecuteOperation` task spinner cards remain hidden. Durable journal cards are the only dApp progress surface.

A useful execution sequence is:

```text
session authorization
  → atomic fence capture(expected profile, authorized account)
  → drift check
  → enqueue on captured-profile lane
  → drift check after grant
  → composite journal claim
  → builder/resource drift checks
  → prove
  → post-prove drift check
  → serialized pre-broadcast commit point
  → node.sendTx
  → record transaction in captured scope
  → terminal journal transition in captured scope
```

## 2. Scope and non-goals

### In scope

- A pure, durable causal protocol and property-test model.
- Composite frontend activity slices.
- Transaction, journal, and incoming-transfer scoped snapshots and mutation envelopes.
- Durable activity incarnations, per-source counters, snapshot watermarks, and tombstones.
- Transaction/incoming composite persistence keys.
- Profile-aware rendering and residual filters.
- Queued-journal derivation, claiming, deletion, and residue cleanup.
- Atomic authorized-profile fence capture.
- Abort-on-drift through the last reversible point.
- A dedicated multi-profile, multi-account network e2e.
- Final `/harden security`.

### Explicitly out of scope

- dApp task↔journal correlation.
- Re-enabling dApp `ExecuteOperation` spinner cards.
- Shipping a proverless path.
- Release or publish changes.
- Continuing an operation under the captured profile after drift. The operation aborts.
- Cryptographic ownership changes for incoming notes.
- A general redesign of dApp permissions or profile authentication.

Re-keying `AccountService` itself from global address keys to composite keys is surfaced as an architectural follow-up below. The execution and activity design must be safe despite the current global key, but this PR should not silently absorb a complete account-storage migration unless the final gate explicitly expands scope.

---

## 3. Ground truth from the current tree

### Feed and presentation

- Activity state is flat: `transactions` and `awaitingTransactions` live in [app.store.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/stores/app.store.ts:133).
- Phase 1’s generation and synchronous account watcher are in [app.store.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/stores/app.store.ts:136). They key only account plus chain for transaction ingest.
- `journalRecordInScope` checks account and optionally network, but not profile, in [RecentActivityView.vue](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/popup/components/modules/general/RecentActivityView.vue:272).
- The full history page snapshots terminal journal rows by profile only and ingests journal events without composite filtering in [activity.vue](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/popup/pages/activity.vue:75).
- `buildActivityRows` is not passed `profileId` and does not enforce the same scope across all three sources.
- Incoming UI state is another flat ref managed by `useIncomingTransfers.ts`.
- The journal detail page already uses strict profile/network/account checks. Preserve that behavior while changing its source to the activity coordinator.

### Persistence

- `Tx` has `chainId` and `account`, but no `profileId` or `networkId`, in [transaction/spec.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/transaction/spec.ts:97).
- Transactions are stored under `nulo:core:txs` keyed by hash and `getTransactions(account)` filters only the address.
- `purgeForAccounts(addresses)` therefore cannot distinguish colliding addresses in different profiles.
- Operation journal rows require `profileId` but have optional `accountAddress` and `networkId`; they have no `chainId` or causal revision.
- `setOperationMeta` and `deleteOperation` do not acquire `transitionLock` in [operation-journal/service.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/operation-journal/service.ts:321) and [operation-journal/service.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/operation-journal/service.ts:415).
- Incoming rows have profile/network/account, but no chain or causal revision. The repository is globally keyed by `siloedNullifier` in [incoming-transfer/repository.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/incoming-transfer/repository.ts:27).
- `EntityStorage` validates per row. A malformed/legacy row does not make every sibling unreadable; optional additive codecs preserve this behavior.
- The real migration registry is empty. This is pre-production and does not require a numbered migration.

### Authorization and execution

- The current `ExecutionFence` contains only `{profileId, epoch}`; that epoch protects profile deletion, not activity reincarnation.
- `ProfileService.captureExecutionFence()` is atomic under the profile facade lock but accepts no expected authorized profile.
- Approved dApp execution checks the session profile, then awaits `refreshSession`, then execution re-captures active-now in [dapp-interaction/service.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/dapp-interaction/service.ts:134).
- The silent path fast-forwards the queued row to `pending` before calling execution in [dapp-interaction/service.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/dapp-interaction/service.ts:298).
- Background failure cleanup recognizes only `queued`, not pre-claim `pending`, in [background.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/wallet-sdk/background.ts:686).
- The dApp execution mutex key reads active-now in [execution-lane.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/execution/execution-lane.ts:182).
- Both standard and `NO_FROM` builders read active-now in `tx-request-builder.ts`.
- The irreversible sequence is explicitly `prove → toTx → submitting → send → record → succeeded` in [execution-coordinator.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/execution/execution-coordinator.ts:147).
- Commit `a6ed183` correctly introduced `captureExecutionFence(expectedProfileId)` and captured-profile mutex keying, but its builder check is one-shot. A switch after that check and before submission remains undetected. It also contains correlation work that must not be ported.

### Two important repository constraints

1. Accounts are stored globally by address in [account/spec.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/account/spec.ts:5). Two same-mnemonic profiles derive colliding addresses but do not coexist as two persisted account rows. Activating/recreating one ownership row overwrites the other.
2. Network IDs are randomly allocated in [network/service.ts](/home/homelab/Projects/nulo/.claude/worktrees/account-switch-isolation/apps/extension/src/wallet/services/network/service.ts:774). Two profiles on the same chain normally have different `networkId`s.

The network e2e must acknowledge both facts rather than assuming two colliding profiles already coexist cleanly.

---

## 4. Data contracts

### 4.1 Composite scope and key

Add the shared types to `packages/wallet-core/src/activity/scope.ts`:

```ts
export interface ActivityScope {
  profileId: string
  networkId: string
  chainId: number
  accountAddress: string
}

export type ActivityScopeKey = string & {
  readonly __activityScopeKey: unique symbol
}
```

`activityScopeKey(scope)` must:

- Validate non-empty profile/network/account fields.
- Validate `chainId` as a nonnegative safe integer.
- Canonicalize Aztec addresses at the boundary.
- Encode with `JSON.stringify([profileId, networkId, chainId, accountAddress])`.

Do not use `${a}|${b}|...`; delimiters in identifiers make ad hoc concatenation collision-prone.

Add:

```ts
export function scopesEqual(a: ActivityScope, b: ActivityScope): boolean
export function assertCoherentScope(
  profile: ProfileInfo | undefined,
  network: Network | undefined,
  account: Account | undefined,
): ActivityScope | undefined
```

`assertCoherentScope` returns `undefined` unless:

```ts
network.profileId === profile.id
account.profileId === profile.id
account.chainId === network.chainId
```

This prevents a profile-switch render from briefly constructing `(P2, P1-network, P1-account)` while Vue refs settle independently.

### 4.2 Durable causal vocabulary

Use decimal strings rather than JSON-incompatible `bigint`:

```ts
type DecimalCounter = string

interface ActivityIncarnation {
  generation: DecimalCounter
  nonce: string
}

interface ActivityRevision {
  incarnation: ActivityIncarnation
  seq: DecimalCounter
}

type DurableActivitySource = "transaction" | "journal" | "incoming"

interface ActivityMutation<T> {
  source: DurableActivitySource
  scope: ActivityScope
  recordId: string
  revision: ActivityRevision
  kind: "upsert" | "remove"
  record?: T
}

interface ActivitySnapshotRecord<T> {
  recordId: string
  revision: ActivityRevision
  record: T
}

interface ActivityTombstone {
  recordId: string
  revision: ActivityRevision
}

interface ActivitySnapshot<T> {
  source: DurableActivitySource
  scope: ActivityScope
  incarnation: ActivityIncarnation
  watermark: DecimalCounter
  records: ActivitySnapshotRecord<T>[]
  tombstones: ActivityTombstone[]
}
```

The random `nonce` protects against accidental generation reuse if metadata is lost. The durable generation orders intentional retire/re-import operations.

Validate decimal counters with a bounded digit count and compare through `BigInt` only inside the pure protocol.

### 4.3 Activity slice

`apps/extension/src/stores/activity.store.ts` owns:

```ts
interface SourceSlice<T> {
  records: Map<string, T>
  recordVersions: Map<string, DecimalCounter>
  tombstones: Map<string, DecimalCounter>
  snapshotCoverage: DecimalCounter
  maxEventSeen: DecimalCounter // diagnostic only
}

interface ActivitySlice {
  scope: ActivityScope
  incarnation?: ActivityIncarnation

  transactions: SourceSlice<Tx>
  journal: SourceSlice<OperationRecord>
  incoming: SourceSlice<IncomingTransferRecord>

  awaitingById: Map<string, AwaitingTx>
  awaitingVersionById: Map<string, number>

  lastAccessedAt: number
  refreshState: "cold" | "refreshing" | "ready" | "stale"
}
```

The tombstone key is `(source, recordId)` through the source slice. A single global `Map<RecordId, seq>` is unsafe because a transaction hash, journal ID, or nullifier could have identical string forms.

The incoming in-memory identity is the nullifier only because the containing slice already supplies the composite scope. Persisted identity remains `(scope, nullifier)`.

### 4.4 Store API

Expose actions, not the mutable `slices` map:

```ts
activateScope(scope: ActivityScope | undefined): void
ingest<T>(mutation: ActivityMutation<T>): void
applySnapshot<T>(snapshot: ActivitySnapshot<T>): void

addAwaiting(scope: ActivityScope, row: AwaitingTx): void
removeAwaiting(scope: ActivityScope, id: string): void
clearScope(scope: ActivityScope): void
clearProfile(profileId: string): void
clearAll(): void
refreshScope(scope: ActivityScope): Promise<void>
```

Readonly selectors:

```ts
activeScope
activeSlice
activeTransactions
activeAwaiting
activeJournalOps
activeIncoming
```

There must be no action accepting a bare row and implicitly selecting `activeScope`.

---

## 5. Durable causal protocol

### 5.1 Critical correction to the proposed `seqBySource` design

A source-wide “highest event seen” cannot be used to reject every lower event.

Counterexample:

```text
event 12: upsert record B arrives first
event 11: upsert record A arrives second
```

If event 12 advances the rejection watermark to 12, record A is incorrectly lost.

The protocol therefore distinguishes:

- `maxEventSeen`: diagnostics only.
- `snapshotCoverage`: an authoritative watermark proving that a snapshot accounted for every committed revision `<= watermark`.
- Per-record revision/tombstone: ordering for events newer than snapshot coverage.

Only an authoritative snapshot can advance `snapshotCoverage`.

### 5.2 Mutation reducer

For a mutation in the slice’s current incarnation:

1. If `seq <= snapshotCoverage`, ignore it; the authoritative snapshot already accounted for it.
2. Compare `seq` with both the record’s version and its tombstone.
3. Apply only if it is newer than both.
4. `upsert` writes the row/version and removes an older tombstone.
5. `remove` deletes the row/version and writes the tombstone.
6. Update `maxEventSeen`, but do not use it as a global rejection threshold.

For an epoch mismatch:

- A regular event may initialize a cold slice with no incarnation.
- A regular event may not replace an already-known incarnation.
- A newer authoritative snapshot or explicit `scope-reset` control mutation resets the whole slice.
- Events from retired incarnations are discarded and cause a scoped resnapshot if the store cannot establish ordering.

### 5.3 Snapshot reducer

Given snapshot watermark `W`:

1. Reject if its incarnation is older or differs from the authoritative current incarnation.
2. Reject if `W < snapshotCoverage`.
3. Never wholesale replace the map.
4. Preserve any client record or tombstone with `seq > W`; it came from an event newer than the snapshot.
5. Apply snapshot rows/tombstones only when their revision is newer than the per-record client revision.
6. For any client record with version `<= W` that is absent from the snapshot, remove it. Snapshot absence is authoritative at `W`.
7. Advance `snapshotCoverage = W`.
8. Client tombstones `<= W` may be compacted into the coverage watermark.

This handles both:

```text
snapshot starts at W=20
delete event 21 arrives
snapshot response arrives later
```

and:

```text
snapshot starts at W=20
update event 21 arrives
snapshot response arrives later
```

without resurrection or clobbering.

### 5.4 Durable backend ordering

Introduce:

```text
apps/extension/src/wallet/services/activity-protocol/
  repository.ts
  coordinator.ts
  spec.ts
  repository.test.ts
```

Storage roots:

```text
nulo:core:activity-incarnations
nulo:core:activity-counters
nulo:core:activity-tombstones
```

The coordinator is a low-level singleton created in `wallet/runtime.ts` and injected into transaction, journal, incoming, and profile-deletion services. It is not a duplicate materialized feed.

Write algorithm:

```text
acquire scope-incarnation lock
  acquire source mutation lock
    verify expected incarnation
    persist next counter first
    write domain row with revision
    write/remove tombstone as appropriate
    emit mutation only after durable state succeeds
```

A counter may contain gaps. It may never be reused.

Crash cases:

- Crash after counter increment, before row: unused sequence; safe.
- Crash after row, before event: next snapshot sees the row.
- Delete: increment counter, persist tombstone, then delete row. A crash between tombstone and row deletion leaves both, and the tombstone wins.
- Crash before tombstone: deletion has not committed and can retry.

### 5.5 Long-running producer fence

An epoch is useless if a stale producer simply asks for the newest epoch after it finishes.

Every long operation must capture an `ActivityWriteFence` before external work:

```ts
interface ActivityWriteFence {
  scope: ActivityScope
  incarnation: ActivityIncarnation
}
```

Examples:

- Incoming polling captures before `getNotesRaw`.
- Transaction execution captures with the execution fence before proving.
- Pending-transaction polling uses the revision already stored on the transaction.
- A journal transition uses the record’s stored incarnation.

`commitUpsert` and `commitRemove` require an expected incarnation. They have no “use current epoch” default for update paths.

### 5.6 Lock ordering

The only legal order is:

```text
profile facade lock
  → activity scope/incarnation lock
    → source mutation lock
      → source storage
```

For multi-scope operations, sort `ActivityScopeKey`s before acquiring locks.

Refactor any source method that currently takes its own lock and then calls the activity coordinator. Otherwise profile deletion or snapshots can deadlock in the reverse order.

### 5.7 Cross-source atomicity

Do not invent a global total event order. Transactions, journal, and incoming use independent per-`(source, scope)` counters.

Cross-source guarantees are:

- One shared scope incarnation.
- Source snapshots are each atomic against that source’s writes.
- Subscriptions are registered before snapshots begin.
- The reducer makes snapshot/event order irrelevant within each source.
- Rendering rules suppress succeeded journal records when a transaction exists; they do not depend on a global sequence.

Profile/account/network deletion retires the shared scope incarnation before source purges. That prevents an old source from writing into a new incarnation.

### 5.8 Tombstone retention

For this PR:

- Retain durable tombstones for the current scope incarnation.
- Drop them when the scope incarnation is retired.
- Log a warning at a high per-scope tombstone threshold, but do not introduce an unsafe hard cap or TTL.
- Do not implement tombstone compaction without an authoritative checkpoint protocol; a bare compaction watermark can itself drop a delayed delete and retain a stale row.

---

## 6. Producer and persistence integration

### 6.1 Transaction service

Modify:

```text
wallet/services/transaction/spec.ts
wallet/services/transaction/service.ts
wallet/services/transaction/client.ts
wallet/services/backup/backup-migration-registry.ts
wallet/services/storage-codecs.test.ts
```

Add optional persisted fields:

```ts
profileId?: string
networkId?: string
activityIncarnation?: ActivityIncarnation
activitySeq?: DecimalCounter
```

Replace the long positional `addTransaction(...)` call with:

```ts
recordSubmittedTransaction({
  fence,
  scope,
  origin,
  calls,
  nonce,
  feePaymentMethod,
  hash,
  submittedEndpointUrl,
  estimatedFee,
  gasDetails,
})
```

It validates:

```text
scope.profileId === fence.profileId
scope.accountAddress is in fence.authorizedAccounts
scope.networkId/chainId === fence scope
fence deletion epoch is current
fence activity incarnation is current
```

New transaction storage key:

```ts
JSON.stringify(["tx", scopeKey, hash])
```

Legacy hash-only keys remain readable. When a legacy row is safely attributable and later updated, rewrite it under the composite key and delete the old key under the transaction mutation lock.

Add:

```ts
getActivitySnapshot(scope: ActivityScope): ActivitySnapshot<Tx>
getTransactionsForScope(scope: ActivityScope): Tx[]
getTransactionForScope(scope: ActivityScope, hash: string): Tx | undefined
purgeForProfile(profileId: string): Promise<void>
```

Keep legacy RPCs temporarily for non-feed callers, but migrate incoming-transfer dedupe, backup, deletion, and UI feed code away from address-only lookup.

Pending polling must:

- Use `submittedEndpointUrl` where present.
- Use the row’s stored scope for event routing.
- Never fall back to active profile/network for a scoped row.
- Quarantine a legacy row whose endpoint and ownership cannot be resolved uniquely.

### 6.2 Operation journal

Add optional fields:

```ts
chainId?: number
activityIncarnation?: ActivityIncarnation
activitySeq?: DecimalCounter
claimToken?: string
claimedAt?: number
```

`profileId` is already required; do not misdescribe it as a new optional field.

For activity-feed kinds (`transfer`, `dapp_execute`), new rows must carry complete scope. `token_import` can remain outside the composite feed protocol where it lacks account activity semantics.

All of these take `transitionLock`:

- `createOperation`
- `transitionOperation`
- `setOperationMeta`
- `touchOperation`
- `deleteOperation`
- `purgeForProfile`
- `clearChainState`
- claim, prepare, fail-if-unclaimed, and supersede helpers

Snapshot reads also take that lock.

Add internal atomic methods:

```ts
prepareQueuedOperation(id, expectedScope): Promise<OperationRecord>
claimQueuedOperation(id, expectedScope, claimToken): Promise<ClaimResult>
failIfUnclaimed(id, error): Promise<boolean>
deleteOperationLocked(id, reason): Promise<void>
getActivitySnapshot(scope): Promise<ActivitySnapshot<OperationRecord>>
```

`claimQueuedOperation` checks exact profile/network/chain/account. There is no legacy leniency for a just-created queued record.

On mismatch:

1. Delete the incorrect queued record and emit a durable tombstone while holding the journal lock.
2. Return `scope-mismatch`.
3. Create a fresh record under the captured correct scope after leaving the first critical section.
4. Never render the incorrect row as a failed operation to the wrongly attributed account.

`pending` with no `claimToken` means silent-path preparation, not ownership by an executor. Claim installs the token atomically. Background cleanup can then safely fail `queued` or unclaimed `pending` without racing a live executor.

### 6.3 Incoming transfer service

Add optional fields:

```ts
chainId?: number
activityIncarnation?: ActivityIncarnation
activitySeq?: DecimalCounter
```

Change repository identity to:

```ts
JSON.stringify(["incoming", scopeKey, siloedNullifier])
```

Update every `getRecord`, `hasRecord`, `upsertRecord`, and `deleteRecord` call to take the composite scope.

Legacy unqualified keys are dual-read. A touched legacy row is rewritten under the composite key while holding `serviceLock`.

Preserve note provenance:

- The trusted owner is `NoteDao.owner`.
- Do not compare against a decoded `content.owner`.
- Do not reintroduce the reverted owner-drop. Delegated discovery may legitimately make decoded content differ.

Incoming polling captures an activity incarnation before PXE/network work and validates it inside `serviceLock` before committing.

### 6.4 Scope lifecycle and deletion

Add an `ActivityScopeLifecycleCoordinator` depending on profile, network, account, and activity protocol services.

Responsibilities:

- Activate/ensure scopes for each matching `(profile, network, account)` tuple.
- Retire a scope before account deletion or network chain purge.
- Extend `ProfileDeletionRows` to include concrete scope descriptors, not only address and network ID arrays.
- Retire every profile scope before transaction/journal/incoming purges.
- Preserve retired epoch metadata after domain rows are erased.

Change transaction profile deletion from `purgeForAccounts(addresses)` to `purgeForProfile(profileId)` or `purgeScopes(scopes)`. Address-only deletion is unsafe with collisions.

---

## 7. Frontend slice coordinator

### 7.1 Activation

A synchronous watcher observes:

```ts
[
  appStore.profile?.id,
  appStore.network?.id,
  appStore.network?.chainId,
  appStore.account?.address,
]
```

with `flush: "sync"`.

It derives a scope only if profile, network, and account ownership are coherent. Otherwise it activates the immutable empty slice.

Activation behavior:

1. Change `activeScopeKey` synchronously.
2. Return the cached slice immediately if present.
3. Start a coalesced background refresh for that exact scope.
4. Apply responses to that scope even if it is no longer active.
5. Retain existing rows on refresh failure and mark the slice stale.

The pointer change is O(1). Deriving/sorting visible row arrays and Vue rendering remain O(number of visible rows); the plan should not claim that DOM work is O(1).

### 7.2 Producer bridge

Create:

```text
apps/extension/src/activity/source-bridge.ts
```

It connects the three clients, registers event handlers first, and then snapshots.

The bridge receives only `ActivityMutation` or `ActivitySnapshot`. It does not import `app.store.ts` and cannot inspect the active scope.

This makes active-routing misuse structurally harder than adding more `if (activeAccount === ...)` checks.

### 7.3 UI migrations

Modify:

```text
stores/app.store.ts
stores/activity.store.ts
composables/useIncomingTransfers.ts
popup/components/modules/general/RecentActivityView.vue
popup/pages/activity.vue
popup/pages/journal/[id].vue
utils/activity-rows.ts
popup/components/modules/send/send.vue
popup/app.vue
```

Changes:

- Move transactions and awaiting placeholders from `app.store.ts` into slices.
- Make `useIncomingTransfers` a readonly selector/refresh adapter, or delete it after direct store adoption.
- Remove local `journalOps` and `terminalJournalOps` refs from both activity surfaces.
- Pass `profileId` into `buildActivityRows`.
- Filter all present fields using present-and-equal semantics.
- Add `chainId` to journal/incoming filtering.
- Keep strict journal-detail ownership checks.
- Awaiting placeholders capture complete scope at submit time.
- Cleanup of awaiting placeholders is applied to the transaction/journal record’s own slice.
- Keep dApp orphan-task publication fail-closed. Do not add correlation.

Retain Phase 1’s final present-and-equal display filters until the full PR is proven. They become defense-in-depth rather than the primary router.

### 7.4 Cache lifetime

Recommended policy:

- Keep up to 32 recently used slices in the popup process.
- Never evict the active slice.
- Eviction drops only the in-memory cache; durable source data remains.
- Clear all slices on explicit full-wallet lock/reset.
- Clear deleted-profile slices immediately.
- Preserve inactive profile slices across an ordinary profile-to-profile switch in the same popup process to satisfy profile switch-back caching.

This retains sensitive inactive-profile feed data inside a trusted extension document. The store must expose only `activeSlice`, not the complete map, to UI components.

A fresh popup or an evicted slice is cold and must snapshot. “Instant-from-cache” applies when the slice is actually cached.

---

## 8. Legacy attribution and migration

### Migration decision

There is no numbered storage migration.

All additive persisted fields are optional:

- Transaction: `profileId`, `networkId`, activity revision fields.
- Journal: `chainId`, claim fields, activity revision fields.
- Incoming: `chainId`, activity revision fields.

The codecs parse each row independently.

### Legacy rows must not be copied into multiple scopes

Frontend leniency is not permission to guess scope.

Rules:

- A populated field must exactly equal the requested scope.
- A missing field can be accepted only if the backend can uniquely attribute the row.
- Ambiguous rows are excluded from activity snapshots and logged as quarantined.

Examples:

- Legacy transaction with account+chain only: include only if that address currently has one unambiguous profile owner and the endpoint/network resolves uniquely.
- Legacy journal row: profile is known. Missing network/chain may be resolved only when account ownership plus profile networks produce exactly one candidate.
- Legacy incoming row: profile/network/account are already present; resolve optional chain from the owned network row.
- A colliding address with no stored profile on the transaction is ambiguous and must not render under either profile merely because both filters are “lenient.”

### Backup handling

Transaction backup keys currently use `hash`. Update the backup registry to derive the composite key when scope fields exist and retain hash-only fallback for legacy rows.

On restore:

- Validate optional fields.
- Do not trust restored activity epoch/counter values.
- Strip/re-stamp revisions through the current activity coordinator.
- Reject duplicate composite identities within the import.
- Preserve per-row failure reporting.

New causal clock/tombstone roots are local protocol metadata and should not be treated as user backup content.

---

## 9. Execution fencing and abort semantics

### 9.1 Fence contract

Extend the execution fence without conflating deletion and activity epochs:

```ts
interface ExecutionScopeFence {
  profileId: string
  profileDeletionEpoch: number

  authorizedAccounts: readonly string[]
  scope: ActivityScope
  activityIncarnation: ActivityIncarnation

  capturedAt: number
}
```

Add:

```ts
ProfileService.captureExecutionFence(
  expectedProfileId: string,
  authorizedAccounts: readonly string[],
  scope: ActivityScope,
): Promise<ExecutionScopeFence>
```

Inside the same `ProfileService.runExclusive` used by lock/open/delete:

1. Require an active profile.
2. Require `active.id === expectedProfileId`.
3. Reject a reserved/deleting profile.
4. Validate the scope profile.
5. Freeze the authorized account set.
6. Capture deletion epoch.
7. Capture the activity incarnation using the documented profile→activity lock order.

The authorized account is the dispatcher/materializer’s actual `from`, not `appStore.account`.

That distinction is intentional: a multi-account dApp session may validly send from B while the normal wallet home screen is displaying A. Treating the popup-selected account as the execution principal would break `multi-account-from` and make account selection in different popup documents ambiguous.

### 9.2 Propagating authorized profile

Both approved and silent paths pass `payload.session.profileId` to `ExecutionService.executeOperations`.

Do not:

```text
check active profile
await refreshSession
capture active-now
```

Instead, each state-changing send branch calls:

```ts
captureExecutionFence(expectedProfileId, [operation.accountAddress], operationScope)
```

after materialization has resolved the authorized account and before mutex/build/prove work.

### 9.3 Drift checkpoints

Introduce one typed check:

```ts
assertExecutionFenceCurrent(fence): Promise<void>
```

It checks active profile and deletion epoch under the profile facade lock. Builder/resource checks also assert:

```text
network.profileId/networkId/chainId match fence
resolved account address matches fence authorized account
activity incarnation remains current
```

Call it:

1. Immediately after capture.
2. Immediately before enqueue.
3. Immediately after mutex grant.
4. Before journal claim/create.
5. At entry to `buildStandard`.
6. At entry to `buildNoFrom`.
7. After slow contract/account/authwit discovery.
8. Before proof.
9. After proof and before `toTx`/submitting.
10. At the serialized submission boundary.

Use the captured profile for the mutex key. If drift is already present, abort before enqueue. If it happens while waiting, abort immediately after grant and release the slot in `finally`.

The fee-strategy chain must carry the fence for checks:

```text
fee/fee-strategy.ts
fee/embedded-strategy.ts
fee/fee-juice-strategy.ts
fee/fee-juice-with-claim-strategy.ts
fee/fpc-strategy.ts
```

Do not port correlation fields or publication work from `a6ed183`.

### 9.4 The unavoidable submission boundary

No software can “abort” a transaction after the node has accepted/broadcast it.

Define:

```ts
ProfileService.submitIfExecutionFenceCurrent(
  fence,
  submit: () => Promise<void>,
): Promise<void>
```

It acquires the same profile facade lock, rechecks the fence, and holds the lock through the `node.sendTx` await.

Consequences:

- If profile switching wins before this lock, submission aborts.
- If submission wins, the active profile has not yet changed; the switch waits until `sendTx` resolves.
- Once `sendTx` begins, the operation reconciles its transaction and journal under the captured scope even if a switch completes immediately afterward.
- Do not report such a transaction as aborted; it may be on-chain.

Holding this lock only across node submission, not simulation/proving, is the narrowest airtight boundary. A stalled endpoint can delay profile switching, so submission must retain the node client’s bounded timeout and must not retry indefinitely under the lock.

Use an optional coordinator hook so the shared `ExecutionCoordinator` sequencing remains characterized for all send types:

```ts
commitSubmission?: (send: () => Promise<void>) => Promise<void>
```

dApp sends supply the profile-fenced implementation. Existing callers retain their current behavior until deliberately opted in.

### 9.5 Error and warning UX

Add `ExecutionScopeChangedError` to `packages/extension-messaging/src/errors.ts`:

```ts
code = "EXECUTION_SCOPE_CHANGED"
message = "Wallet scope changed; the transaction was not sent."
```

Map it in `wallet-sdk/error-envelope.ts` to:

```json
{
  "code": -32000,
  "message": "Wallet scope changed; the transaction was not sent.",
  "data": {
    "walletErrorCode": "EXECUTION_SCOPE_CHANGED"
  }
}
```

Do not use EIP-1193 `4001`; this was not an explicit rejection. Do not include profile ID, account, network, origin, or builder phase in the dApp envelope.

Journal behavior:

- Pre-claim drift: `failIfUnclaimed` terminalizes `queued` or unclaimed `pending`.
- Post-claim drift: executor catch transitions its owned record to `failed`.
- Persist `error.kind = "scope_changed"` with wallet-controlled copy.
- Keep the failed record; do not tombstone it. The durable failed card is the warning and audit trail.
- Never leave `pending` residue.

Immediate warning:

- Emit `onExecutionScopeAborted` with the journal ID and scope.
- A popup shows a toast only when its current scope equals the event scope:
  “Transaction stopped because the wallet profile changed.”
- A popup showing another profile does not display details about the old profile’s operation.
- On return to the authorizing scope, the durable failed journal card is visible.
- Deduplicate by journal ID; no retries or repeated toasts.

### 9.6 Abort DoS analysis

A dApp cannot itself switch the wallet profile. It can enqueue its own requests, but:

- Existing per-origin and lane caps remain 8/32.
- One drift produces one terminal journal row and one warning.
- No automatic retry occurs.
- Warning copy never includes dApp-controlled title/subtitle.
- A dApp cannot use scope drift to cancel another origin’s request.
- The submission lock can delay a switch only while a node request is bounded and underway.

---

## 10. Queued journal and dispatcher consistency

### Shared account resolver

Extract a pure helper into `packages/wallet-bridge/src/account-resolution.ts` and export it:

```ts
resolveAuthorizedSessionAccount({
  walletAccounts,       // AccountService's index/address sorted order
  sessionAddresses,
  requestedFrom,
}): IAccountRef
```

Rules:

- Explicit `from`: require exact session membership and wallet ownership.
- Omitted/`NO_FROM`: return the first wallet-ordered account contained in the session.
- No match: throw/refuse; never fall back outside the session.

Use this exact helper in:

- `WalletSdkDispatcher.resolveNetworkAndAccount`
- `wallet-sdk/queued-journal.ts`

`queued-journal.ts` adds `extractSendFrom(message)` for `message.args[1].from`, normalizes `NO_FROM`, obtains `AccountService.getAccounts(profileId, chainId)`, and calls the shared resolver.

A session `[B, A]` with wallet order `[A, B]` must queue and dispatch `NO_FROM` under A.

### Composite claim

The queued record contains:

```text
profileId
networkId
chainId
accountAddress
sessionId
```

Claim compares all five relevant bindings, including session when provided.

Queued creation must use the dApp session’s authorized profile, not a separately sampled active profile. Active equality is still verified through the atomic execution fence.

### Locking

Lock order for arrival:

```text
queuedCreationLock
  → operationJournal.transitionLock
    → activity source lock
```

No code may acquire these in reverse.

Count+create remains under `queuedCreationLock`; journal create itself is serialized under its mutation lock.

---

## 11. Deterministic multi-profile/multi-account network e2e

### Files

Add:

```text
apps/extension/tests/e2e/network/account-profile-siloing.test.ts
apps/extension/tests/e2e/fixtures/profiles.ts
apps/extension/tests/e2e/fixtures/execution-scope-gate.ts
apps/extension/src/e2e/execution-scope-gate.ts
```

Extend the playground with a real account selector so `opts.from` can be set to the second granted account. This also upgrades `multi-account-from.test.ts` from its documented first-account-only limitation.

### Test-only gate

Add a statically tree-shaken `ExecutionScopeGate`, mirroring the proof-gate pattern.

Place it:

```text
after ExecutionScopeFence capture
before ExecutionLane.acquireSlot
```

The test can hold the request after authorization but before active-now lane/builder reads—the exact H5 interleaving.

Requirements:

- Only injected when `E2E_PROVERLESS` is statically true.
- Static import; no dynamic chunk.
- Storage key and class marker absent from a normal production bundle.
- No release/publish workflow changes.

### Fixture topology

Create one browser with:

- Profile P1 from a deterministic mnemonic.
- Profile P2 imported from the same mnemonic but with a different profile ID.
- Both on Local Network / same `chainId`.
- Two derived indices A and B per profile.
- Assert `P1.A === P2.A` and `P1.B === P2.B`.
- Assert profile IDs differ.
- Assert internal network IDs normally differ.

Because account storage is globally keyed by address, the fixture must recreate/ensure the active profile’s A/B rows after each profile switch and assert the stored row’s `profileId`. Do not claim both profiles’ rows coexist.

### Test sequence

1. Activate P1 and ensure A/B belong to P1.
2. Connect the playground under P1.
3. Grant the transaction bundle for both accounts in order `[B, A]`.
4. Select explicit `from = B`.
5. Mint enough funds for B.
6. Start `sendTx`; approve the execute popup.
7. Wait until the execution-scope gate reports that the P1/B fence was captured.
8. In a separate wallet page:
   - lock/switch/unlock P2,
   - select Local Network,
   - ensure/create B so the global address row now belongs to P2,
   - assert the visible active composite scope is P2/local/B.
9. Keep a `MutationObserver` on P2’s activity root and record every journal/transaction card ID seen.
10. Release the execution-scope gate.
11. Assert the dApp gets:
    - error status,
    - JSON-RPC code `-32000`,
    - `walletErrorCode === "EXECUTION_SCOPE_CHANGED"`,
    - no profile/account/network details.
12. Assert:
    - no node submission was observed,
    - balances did not change,
    - no transaction row was created under P1 or P2,
    - P2 never rendered P1’s queued/pending/failed journal ID,
    - no P2 journal was bound to P1’s request,
    - P1 has no queued or pending residue.
13. Switch back to P1:
    - recreate/ensure A/B ownership for P1,
    - activate B,
    - assert exactly one failed `scope_changed` journal card appears,
    - assert it carries P1’s profile/network/chain/account scope.
14. Switch A→B→A in P1 and verify cached rows return without being assigned to the other account.
15. Assert no console/page errors.

A separate composition test uses the existing proof gate to switch after the builder but before the post-prove submission check. That proves the final drift check drops the proof and never enters `node.sendTx`.

### Required existing network regressions

Keep green:

- `concurrent-sendtx.test.ts`
- `concurrent-sendtx-approve.test.ts`
- `concurrent-sendtx-confirm.test.ts`
- `cancel-mid-prove.test.ts`
- `transfers.test.ts`
- `multi-account-from.test.ts`

Also run the standard and `NO_FROM` send tests if their filenames are separate in the final tree.

---

## 12. Phases and validation gates

All work lands in one PR, but each phase should be an independently reviewable commit series. Do not begin product wiring before the Phase 1 spike passes.

### Phase 0 — Characterization and invariant pinning

Add failing/characterization tests for:

- Distinct-record event reordering.
- Journal delete vs transition resurrection.
- Pending pre-claim cleanup.
- P1/P2 colliding account ownership behavior.
- Exact dispatcher `NO_FROM` wallet ordering.
- Current one-shot builder drift window.
- Mixed profile/network/account frontend refs fail closed.

No production behavior change.

Validation gate:

```sh
bun run --cwd apps/extension test src/stores/app.store.test.ts src/composables/useIncomingTransfers.test.ts src/popup/components/modules/general/RecentActivityView.test.ts src/utils/activity-rows.test.ts
bun run --cwd apps/extension test src/wallet/services/cross-profile-isolation.test.ts src/wallet/services/execution src/wallet/services/operation-journal src/wallet/services/wallet-sdk
bun run typecheck:all
bun run lint
```

### Phase 1 — Pure durable-protocol spike

Add:

```text
packages/wallet-core/src/activity/scope.ts
packages/wallet-core/src/activity/causal.ts
packages/wallet-core/src/activity/model.ts
packages/wallet-core/src/activity/causal.property.test.ts
packages/wallet-core/src/activity/index.ts
```

Add `fast-check` as a `@nulo/wallet-core` dev dependency and commit `bun.lock`.

Property actions:

- upsert
- remove
- begin snapshot
- deliver snapshot later
- permute event delivery
- backend restart
- client restart
- retire/reactivate scope
- inject crash after counter/tombstone/row steps

Properties:

- No cross-scope mutation.
- Snapshot idempotence.
- Delete-during-snapshot never resurrects.
- Newer event survives an older snapshot.
- Distinct-record lower event survives a higher event.
- SW restart never reuses a revision.
- Old incarnation cannot write after re-import.
- ABA `upsert → remove → newer upsert` converges correctly.
- Same nullifier on two networks remains two records.
- Draining events plus a fresh snapshot equals the reference model.

Run at least 1,000 generated traces per property; preserve and print failing seeds.

Validation gate:

```sh
bun run --cwd packages/wallet-core test src/activity
bun run --cwd packages/wallet-core typecheck
bun run typecheck:all
bun run lint
```

No extension service or UI wiring may land before this gate passes.

### Phase 2 — Durable source protocol and storage integration

Implement:

- Activity protocol repository/coordinator.
- Runtime singleton injection.
- Source lock ordering.
- Transaction composite fields/keys/snapshots/events.
- Journal scope/revision fields and fully serialized mutations.
- Incoming composite key and snapshots/events.
- Scope lifecycle/retirement.
- Profile deletion by scope/profile rather than address.
- Legacy dual-read and unique-attribution quarantine.
- Backup re-stamping.
- Per-row codec tests.

Validation gate:

```sh
bun run --cwd apps/extension test src/wallet/services/activity-protocol src/wallet/services/transaction src/wallet/services/operation-journal src/wallet/services/incoming-transfer
bun run --cwd apps/extension test src/wallet/services/storage-codecs.test.ts src/wallet/services/cross-profile-isolation.test.ts src/wallet/services/backup
bun run --cwd packages/wallet-core test src/activity
bun run typecheck:all
bun run lint
bun run test
```

### Phase 3 — Composite frontend slices and instant cache

Implement the activity store, event bridge, coherent scope watcher, and migrate both activity surfaces plus journal detail and awaiting placeholders.

Tests:

- A event while B active mutates only A.
- A snapshot resolving while B active mutates only A.
- A→B→A restores cached A without clearing/refetch-dependent paint.
- Mixed refs expose empty scope.
- Distinct profile IDs with colliding account/network/chain values remain isolated.
- Snapshot/event ordering through the actual Pinia store.
- Display filters check profile, network, chain, and account.
- Undefined legacy fields remain display-lenient only after scoped envelope admission.
- dApp task/orphan cards remain hidden.

Validation gate:

```sh
bun run --cwd apps/extension test src/stores src/activity src/composables/useIncomingTransfers.test.ts
bun run --cwd apps/extension test src/popup/components/modules/general src/popup/pages/activity.vue src/utils/activity-rows.test.ts
bun run test:e2e
bun run typecheck:all
bun run lint
bun run test
```

### Phase 4 — Queued claims and abort-on-drift execution

Implement:

- Shared wallet-bridge account resolver.
- Actual `from` extraction.
- Exact `NO_FROM` behavior.
- Composite queued record.
- Claim token and lock-serialized supersede.
- `failIfUnclaimed`.
- `captureExecutionFence(expectedProfileId, accounts, scope)`.
- Captured-profile lane key.
- All drift checkpoints.
- Fee-strategy fence propagation.
- Serialized pre-submit gate.
- Typed dApp error.
- Scope-aware warning.
- Pending residue cleanup.

Do not port any correlation code from `a6ed183`.

Tests:

- `[A,B]`, explicit B queues and claims B.
- Session `[B,A]`, omitted/`NO_FROM`, wallet order `[A,B]` queues and dispatches A.
- Mismatched profile/network/chain/account cannot claim.
- Delete/transition and delete/meta races do not resurrect.
- Capture vs switch is atomic.
- Switch before enqueue aborts.
- Switch while mutex-waiting aborts after grant.
- Switch during builder aborts before proof.
- Switch during proof aborts before submission.
- Switch after submission wins does not falsely report abort and still records captured scope.
- Pre-claim `pending` becomes failed.
- Claimed `pending` is not stolen by background cleanup.
- Happy paths keep their current lane ordering.

Validation gate:

```sh
bun run --cwd packages/wallet-bridge test
bun run --cwd apps/extension test src/wallet/services/profile src/wallet/services/dapp-interaction src/wallet/services/execution src/wallet/services/wallet-sdk
bun run --cwd apps/extension test src/wallet/services/operation-journal src/popup/utils
bun run test:e2e
bun run typecheck:all
bun run lint
bun run test
```

### Phase 5 — Multi-profile/multi-account network harness

Add the fixture helpers, real playground account selector, execution-scope gate, dedicated test, and strengthen `multi-account-from`.

Validation gate:

```sh
NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-profile-siloing.test.ts
NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/multi-account-from.test.ts tests/e2e/network/cancel-mid-prove.test.ts
bun run --cwd apps/extension build:chrome
! rg -n "nulo:e2e:execution-scope-gate|ChromeStorageExecutionScopeGate" apps/extension/dist/chrome
bun run typecheck:all
bun run lint
```

### Phase 6 — One-PR integration, regression, and security gate

Remove only the now-redundant Phase 1 clear/generation code after the slice tests prove equivalent or stronger containment. Keep final present-and-equal filters.

Run the required shared-execution regressions in one agent invocation:

```sh
NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent \
  tests/e2e/network/concurrent-sendtx.test.ts \
  tests/e2e/network/concurrent-sendtx-approve.test.ts \
  tests/e2e/network/concurrent-sendtx-confirm.test.ts \
  tests/e2e/network/cancel-mid-prove.test.ts \
  tests/e2e/network/transfers.test.ts \
  tests/e2e/network/multi-account-from.test.ts \
  tests/e2e/network/account-profile-siloing.test.ts
```

Then:

```sh
bun run lint
bun run typecheck:all
bun run test
bun run test:all
bun run test:e2e
bun run build:chrome
```

Finally run:

```text
/harden security
```

Fix all blocking findings, rerun the targeted suite for every changed surface, then rerun the full final gate.

Final product ask: confirm once more that the dApp `ExecuteOperation` spinner re-enable remains dropped. The default and planned code path is to keep it hidden.

---

## 13. Hazard traceability

| Hazard | Structural answer | Pin |
|---|---|---|
| H0 flat active-now state | Composite slices; record-owned routing; Phase 1 filters retained as defense | Store + switch component tests |
| H1 queued account from `accounts[0]` | Parse actual `from`; shared resolver | Explicit-from-B unit/e2e |
| H2 wrong `NO_FROM` order | Same wallet-bridge helper used by queue and dispatcher | `[B,A]` session / `[A,B]` wallet test |
| H3 delete/meta resurrection | All journal writes/deletes under one lock; durable tombstones | Adversarial deferred-promise races |
| H4 non-atomic authorized profile | `captureExecutionFence(expectedProfileId, …)` under facade lock | Capture-vs-switch test |
| H5 post-capture drift | Repeated checks, captured lane key, post-prove check, serialized submit boundary | Scope-gate e2e + proof-gate composition |
| H6 silent pending residue | Claim token distinguishes prepared/claimed; `failIfUnclaimed` handles queued and pending | Background cleanup tests |
| H7 profile-less display filter | Profile+network+chain+account present-and-equal | P1/P2 colliding-address render test |
| H8 restart/ABA/snapshot/reimport | Durable incarnation, per-source counter, coverage watermark, per-record tombstone, composite incoming key | Property suite |

---

## 14. Security and adversarial considerations

### Threat model

Adversaries and failures include:

- A dApp choosing arbitrary operations, origin strings, account inputs, ordering, and concurrency.
- Broadcast service events reaching every connected popup.
- Honest async completion after profile/account/network switches.
- Service-worker termination at any await.
- Old snapshots resolving after newer events.
- Profile deletion/re-import while producers are in flight.
- Corrupt or legacy local-storage rows.
- Colliding account addresses across profiles and transaction/nullifier identities across network trees.

The security properties are:

- Confidentiality: no foreign composite row renders.
- Authorization integrity: no sign/submit under a profile/account/network other than the authorized operation.
- Causal integrity: stale work cannot resurrect or overwrite newer state.
- Existence privacy: mismatched claims and warnings do not reveal another profile’s identifiers to a dApp.

### Execution trust boundary

Trusted:

- The validated dApp session profile.
- Dispatcher account authorization.
- Wallet-owned network/account rows after exact ownership checks.
- The atomic profile facade lock.
- The activity incarnation coordinator.

Untrusted:

- DApp `from`.
- DApp titles/subtitles/method names.
- Active-now reads after authorization.
- Optional legacy scope fields without unique attribution.
- Any record routed merely because the current UI happens to match it.

### Incoming note provenance

`NoteDao.owner` is the trusted note owner. The decoded note content is not a replacement authority. Do not restore the reverted owner mismatch filter.

### Abort as a UX/DoS surface

- Abort copy is wallet-controlled.
- One journal record yields at most one warning.
- No automatic retries.
- Other-profile popups do not receive operation details.
- Submission has a bounded point of no return.
- A stalled node must not hold the profile facade indefinitely.

### Storage tampering

A corrupt high counter can suppress activity and cause local availability loss. It must not redirect rows to another scope.

On malformed clock/incarnation metadata:

- Fail closed for that scope.
- Quarantine and log.
- Reconstruct only from valid row/tombstone revisions under an explicit repair path.
- Never reset counters silently and reuse an old incarnation.

---

## 15. Assumptions and assumption attacks

### Facts

- Phase 1 is present at current `dev` and uses synchronous clearing, generation checks, and scope-filtered ingest.
- Account rows are globally keyed by address, not `(profileId, chainId, address)`.
- Network IDs are random and profile-owned.
- Journal `profileId` is already mandatory.
- Incoming nullifier storage is currently global.
- The current proof gate is immediately before `pxe.proveTx`.
- `node.sendTx` is the irreversible boundary.
- Storage decoding is per-row tolerant.
- The current real migration list is empty.

### Unsafe or corrected inferences

1. “A source-wide max sequence handles out-of-order events” is false. It loses distinct records.
2. “Mnemonic re-import necessarily creates the same composite key” is false because `profileId` normally changes. Same-key reincarnation arises when an ID/scope is restored or reused. The durable epoch still needs to handle it.
3. “Two colliding profiles’ account rows coexist” is false with the current address-keyed `AccountService`.
4. “The whole switch is O(1)” is overstated. The slice pointer swap is O(1); rendering and cold hydration are not.
5. “Lenient undefined fields are always safe” is false. They are safe only after trusted unique attribution.
6. “A builder-entry check closes post-capture drift” is false. Drift can occur during build, proof, or immediately before send.
7. “Abort is possible after broadcast” is false. After the node accepts the transaction, reconciliation must complete under the captured scope.
8. “Siloed nullifiers are global” is false across different rollup trees.

### Asks surfaced for the final gate

1. **Inactive-profile cache:** recommendation is bounded in-memory retention across ordinary profile switches, cleared on hard lock/delete. If policy requires immediate memory erasure at every profile switch, instant profile switch-back cannot be delivered without an encrypted persisted cache.
2. **Meaning of account drift:** recommendation is that the immutable dispatcher-authorized `from` governs execution. Popup-selected `appStore.account` is presentation state and is not a service-worker authority.
3. **AccountService composite re-key:** recommendation is a follow-up unless the colliding-profile e2e proves the global key causes an uncontainable product defect. Its current shape causes ownership churn/data loss but the planned fence prevents cross-profile signing.
4. **Pre-broadcast serialization:** recommendation is to serialize profile switching against the bounded `node.sendTx` call. This is the only airtight last-window answer.
5. **Property library:** recommendation is `fast-check` as a dev-only wallet-core dependency, subject to repository dependency policy.
6. **Tombstone GC:** recommendation is no unsafe TTL/cap in this PR; retain through the incarnation and design checkpoint compaction separately if measurements require it.
7. **dApp cards:** final confirmation only; keep them hidden and keep correlation out.

---

## 16. Decision ledger and trade-offs

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Mid-switch execution | Abort before broadcast | Continue under captured profile | Binding product decision; smaller execution trust surface |
| Activity isolation | Composite slices | More active-now guards | Guards can be omitted; slice routing is structural |
| Snapshot ordering | Coverage watermark + per-record versions | Global max-event high-water | Global max loses out-of-order distinct records |
| Epoch | Durable generation + nonce | In-memory integer | Survives SW restart and prevents reuse |
| Counters | Per source+scope decimal counter | Global total order | No required cross-source order; less contention |
| Events | Scoped causal envelopes | Raw row events for feed | Envelope makes producer-owned scope mandatory |
| Legacy rows | Parse, uniquely attribute, otherwise quarantine | Blind undefined-field leniency | Prevents colliding-profile duplication |
| Incoming key | Scope+nullifier | Global nullifier | Nullifier uniqueness is rollup-tree-local |
| Journal warning | Durable failed row | Delete drift record | User chose abort+warn; durable journal is the reliable warning |
| Wrong queued claim | Locked delete+tombstone then fresh | Reuse or show wrong failed card | Prevents cross-account residue |
| Submission window | Profile-fenced commit point | One builder check | Closes drift until irreversible send |
| DApp task cards | Hidden | Correlation/re-enable | Binding decision; removes high-risk publication surface |
| Delivery | One PR, internally staged commits | Multiple PRs | Binding decision |
| Migration | Optional fields + dual read | Numbered migration | Pre-production; preserves per-row tolerance |

---

## 17. One-PR blast-radius mitigation

The PR touches shared execution and storage code, so the mitigation is procedural and structural:

- First commit is tests only.
- Second commit is the standalone property-tested protocol.
- Backend APIs are additive before old feed APIs are removed.
- Raw legacy service events remain for non-feed consumers; the new activity bridge uses causal events.
- Phase 1 containment remains until the new slices pass unit, component, mocked e2e, and network e2e.
- The shared execution coordinator receives an optional submission hook; unrelated send paths preserve behavior until explicitly covered.
- `a6ed183` is used only as evidence for expected-profile threading and pending cleanup. Its correlation changes are excluded.
- Every internal commit passes targeted typecheck/tests.
- The final PR description includes H0–H8 traceability and the exact network test logs.
- No release/publish files change.
- No proverless marker appears in production output.
- `/harden security` is the final blocking review, not a post-merge follow-up.

The final merge condition is not merely “tests pass.” It is that each durable producer has no active-scope write API, every ambiguous legacy row fails closed, every queued claim is composite and serialized, and the last reversible execution boundary is demonstrably fenced.