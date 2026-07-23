# Plan — Account + Profile Siloing (deep blueprint, consolidated)

> Consolidates deferred **Phase 1a + Phases 2–4** of `account-switch-isolation` into ONE focused architectural
> arc. Built from three independent plans (main-agent draft, codex xhigh, Opus fable-role) → this consolidation
> with a provenance ledger (§16). One PR, internally staged commits.
>
> **Provenance note:** the durable-protocol design and the execution-abort boundary here are the *corrected*
> forms. Two designs that appeared in the main-agent draft **and** the Opus draft were shown wrong by codex and
> are rejected: (a) a per-source global-max sequence used as a rejection threshold (loses out-of-order distinct
> records — §5.1); (b) a single builder-entry drift check treated as airtight (drift can still occur during
> build/prove/pre-send — §9). The corrected forms (coverage-watermark protocol; serialized pre-broadcast commit
> point) are adopted. See §16 for full attribution.

## 0. Primary invariant

The immutable **composite scope** `S = (profileId, networkId, chainId, accountAddress)` governs every durable
activity record, cache slice, queued claim, execution fence, transaction write, snapshot, event, and rendered
row. A producer may mutate **only** the slice named by its own trusted scope envelope — there is no
`ingestIntoActiveSlice(record)` API anywhere.

## 1. Outcome — non-negotiable "done" signals

1. **Structural render isolation:** a producer can mutate only the slice named by the producer's OWN trusted
   scope; no code path routes a record by active-now. A foreign record physically cannot reach `activeSlice`.
2. **Instant-from-cache:** changing profile/network/account synchronously *swaps the active slice reference*; a
   cached slice renders immediately (no clear-then-rebuild flash). A cold/evicted slice snapshots (honest: the
   pointer swap is O(1); DOM render + cold hydration are not).
3. **Snapshot safety:** a snapshot finishing after a switch updates *its requested scope's* slice, never
   whichever slice is active at completion; it never resurrects a deleted row, clobbers a newer event, or crosses
   an incarnation boundary after SW-restart / re-import.
4. **Execution binding:** a dApp send binds to its authorized profile and its actual `from` account (the builder
   consumes `fence.profileId`, never active-now). Profile drift before the irreversible `node.sendTx` boundary
   aborts with a typed error, a durable `failed` journal card, and a scope-aware user warning. **No tx is
   submitted after detected drift** (a brief-hold commit-to-submit CAS closes the check→send window without
   holding any lock across the network call); once `node.sendTx` is entered, the tx is recorded UNCONDITIONALLY
   under the captured scope (an on-chain fact is never dropped).
5. **Queued/dispatch consistency:** queued-journal creation and dispatch use the *same* account-selection
   function, including the wallet-index-ordered `NO_FROM` fallback.
6. **Journal integrity:** every journal load-modify-write / delete / supersede shares one lock and emits a causal
   mutation; no resurrection.
7. **Incoming identity** is `(scope, siloedNullifier)`, never a bare globally-unique nullifier.
8. **Legacy safety:** legacy rows parse independently; ambiguous legacy rows (e.g. a colliding address with no
   stored profile) are *quarantined*, never copied into multiple slices.
9. **dApp cards stay hidden:** the dApp `ExecuteOperation` task spinner cards remain fail-closed; durable journal
   cards are the only dApp progress surface. No correlation machinery is added.

Canonical execution sequence:
```
session authorization
  → atomic fence capture(expected profile, authorized account, scope)
  → drift check → enqueue on captured-profile lane → drift check after grant
  → composite journal claim → builder(consumes fence)/resource drift checks → prove
  → post-prove drift check → brief-hold commit-to-submit CAS + durable `submitting` marker → node.sendTx
  → UNCONDITIONALLY record tx in captured scope → terminal journal transition in captured scope
```

## 2. Scope

### In scope
Pure durable causal protocol + property model · composite frontend activity slices · tx/journal/incoming scoped
snapshots + mutation envelopes · durable incarnations + per-source counters + snapshot watermarks + tombstones ·
tx/incoming composite persistence keys · profile-aware rendering + residual filters · queued-journal derivation /
claiming / deletion / residue cleanup · atomic authorized-profile fence · abort-on-drift through the last
reversible point · dedicated multi-profile/multi-account network e2e · final `/harden security`.

### Out of scope (state explicitly)
- dApp task↔journal correlation + re-enabling dApp `ExecuteOperation` spinner cards (**Decision D2**).
- Shipping a proverless path; any release/publish change.
- Continuing an operation under the captured profile after drift — the op **aborts** (**Decision D1**).
- Cryptographic ownership changes for incoming notes (keep `NoteDao.owner` as the trusted authority).
- **Re-keying `AccountService` from global address keys to composite keys** — surfaced as an architectural
  follow-up (§15 Ask A3). The execution + activity design must be *safe despite* the current global address key;
  this PR must NOT silently absorb a full account-storage migration. The fence prevents cross-profile signing
  regardless of the account-key shape.

## 3. Ground truth (verified this session — file:line)

**Feed / presentation**
- Activity state is flat: `transactions`/`awaitingTransactions` in `stores/app.store.ts:133`; Phase-1 generation
  + `flush:'sync'` account watcher at `:136-175` (keys account+chain only for tx ingest).
- `journalRecordInScope` checks account + optional network, **not profile** (`RecentActivityView.vue:272`) — H7.
- `activity.vue:75` snapshots terminal journal rows by profile only, ingests journal events without composite
  filtering. `buildActivityRows` is not passed `profileId` and doesn't enforce one scope across all 3 sources.
- Incoming UI state is a separate flat ref in `useIncomingTransfers.ts`.
- `journal/[id].vue` already uses strict profile/network/account checks — preserve while re-sourcing from the
  coordinator.

**Persistence**
- **Accounts are keyed globally by `account.address`** (`account/spec.ts:5-7`, `ACCOUNT_STORAGE_ROOT =
  "nulo:core:accounts"`, "Frozen"). The `Account` row carries `profileId`/`chainId`/`index` as *fields*, but the
  storage KEY is the address → **two same-mnemonic profiles derive colliding addresses that overwrite the same
  row; they do not coexist as two persisted rows.** [VERIFIED — drives the e2e design, §11.]
- `Tx` has `chainId`+`account`, **no** `profileId`/`networkId` (`transaction/spec.ts:97`); stored under
  `nulo:core:txs` keyed by hash; `getTransactions(account)` filters address only; `purgeForAccounts(addresses)`
  cannot distinguish colliding addresses in different profiles.
- `OperationRecord.profileId` is **required** (`operation-journal/spec.ts:69`, Carry #1 tagged at create-time);
  `accountAddress`/`networkId` optional; no `chainId`, no causal revision. [VERIFIED — corrects a draft claim.]
- `setOperationMeta` (`operation-journal/service.ts:321`) and `deleteOperation` (`:415`) do **not** take
  `transitionLock`; `transitionOperation`/`touchOperation` do — H3.
- Incoming rows carry profile/network/account/owner but no chain/revision; repository keyed globally by
  `siloedNullifier` (`incoming-transfer/repository.ts:27`) — H8.
- `EntityStorage` validates per row (a malformed/legacy row doesn't break siblings). Real migration registry is
  empty; pre-production, no numbered migration.

**Authorization / execution**
- Current `ExecutionFence = {profileId, epoch}`; that epoch protects *profile deletion*, not activity
  reincarnation. `ProfileService.captureExecutionFence()` is atomic under the profile facade lock but accepts
  **no** expected-authorized-profile arg.
- Approved dApp path checks session profile, then `await refreshSession`, then execution re-captures active-now
  (`dapp-interaction/service.ts:134-157`) — H4 window (two separate lock acquisitions).
- Silent path fast-forwards queued→`pending` *before* calling execution (`dapp-interaction/service.ts:298-329`)
  — H6.
- Background failure cleanup recognizes only `queued`, not pre-claim `pending` (`background.ts:686-714`) — H6.
- dApp execution mutex key reads active-now (`execution-lane.ts:182-192`); both `buildStandard`
  (`tx-request-builder.ts:113`) and `buildNoFrom` (`:382`) read active-now — H5.
- **Irreversible pipeline is frozen** (`execution-coordinator.ts:147-174`): `checkCancelled → journal(proving) →
  prove → checkCancelled → toTx → journal(submitting) → checkCancelled → send → record → journal(succeeded)`.
  `node.sendTx` is the point of no return; there is already a `checkCancelled` immediately before it. [VERIFIED —
  the serialized-submit fence slots in at that existing checkpoint, §9.4.]
- **NetworkId is randomly allocated** per network (`network/service.ts:_buildNetwork → _freshStored8()`), row
  carries profileId+chainId → two profiles on the same chain have **different** networkIds. [VERIFIED — the e2e
  must not assume networkId equality; two profiles on one chain are *already* distinguished by networkId.]
- `a6ed183` (p1a branch, reference only) introduced `captureExecutionFence(expectedProfileId)` + captured-profile
  mutex keying, but its builder check is **one-shot** (drift after it, before submit, is undetected) and it
  carries correlation work that must NOT be ported.

## 4. Data contracts

### 4.1 Composite scope + key (`packages/wallet-core/src/activity/scope.ts`)
```ts
export interface ActivityScope { profileId: string; networkId: string; chainId: number; accountAddress: string }
export type ActivityScopeKey = string & { readonly __activityScopeKey: unique symbol }
```
`activityScopeKey(scope)`: validate non-empty profile/network/account + `chainId` nonnegative safe int;
canonicalize the Aztec address at the boundary; encode as `JSON.stringify([profileId, networkId, chainId,
accountAddress])` — **not** `${a}|${b}` (delimiters in identifiers are collision-prone).
```ts
export function scopesEqual(a, b): boolean
export function assertCoherentScope(profile?, network?, account?): ActivityScope | undefined
```
`assertCoherentScope` returns `undefined` unless `network.profileId === profile.id && account.profileId ===
profile.id && account.chainId === network.chainId` — prevents a switch from transiently constructing
`(P2, P1-network, P1-account)` while Vue refs settle independently.

### 4.2 Durable causal vocabulary (`packages/wallet-core/src/activity/model.ts`)
Decimal strings, not JSON-hostile `bigint`:
```ts
type DecimalCounter = string
interface ActivityIncarnation { generation: DecimalCounter; nonce: string }   // generation = MONOTONIC decimal
//   lineage the coordinator advances per scope (ordering key, ultra-S6); nonce = the profile's RANDOM pxeGeneration
//   (guards accidental generation reuse, but is NOT comparable — never used for ordering)
interface ActivityRevision   { incarnation: ActivityIncarnation; seq: DecimalCounter }
type DurableActivitySource = "transaction" | "journal" | "incoming"
// Source-indexed DISCRIMINATED union — `source` binds to its record type so TS can't wrap a Tx in a journal
// envelope (audit codex-nb3). Plus a SEPARATE reset control (referenced by §5.2), which is NOT an ActivityMutation.
type ActivityMutation =
  | { source: "transaction"; scope: ActivityScope; recordId; revision; kind: "upsert"|"remove"; record?: Tx }
  | { source: "journal";     scope: ActivityScope; recordId; revision; kind: "upsert"|"remove"; record?: OperationRecord }
  | { source: "incoming";    scope: ActivityScope; recordId; revision; kind: "upsert"|"remove"; record?: IncomingTransferRecord }
interface ActivityScopeReset       { control: "scope-reset"; scope: ActivityScope; incarnation: ActivityIncarnation }
interface ActivitySnapshot<T>      { source: DurableActivitySource; scope; incarnation; watermark: DecimalCounter; records: {recordId;revision;record: T}[]; tombstones: {recordId;revision}[] }
```
Compare counters via `BigInt` only *inside* the pure protocol; validate a bounded digit count at the boundary.
**Runtime codec, not just TS** (audit codex-nb3): a corrupt/hostile producer could hand-craft an envelope whose
`scope`/`recordId`/`incarnation` disagree with the embedded `record`'s own scope fields. The ingest codec MUST
reject unless the envelope `scope` == the record's own `(profileId, networkId, chainId, accountAddress)`, the
envelope `recordId` == the record's derived recordKey, and the revision's incarnation matches — TypeScript alone
cannot stop a P2 row wrapped in a P1 envelope from routing into P1's slice.

### 4.3 Activity slice (`apps/extension/src/stores/activity.store.ts`)
```ts
interface SourceSlice<T> {
  records: Map<string, T>; recordVersions: Map<string, DecimalCounter>
  tombstones: Map<string, DecimalCounter>       // key is (source,recordId) via the per-source slice — a global
  snapshotCoverage: DecimalCounter              //   Map<RecordId,seq> is unsafe (tx hash vs op id vs nullifier collide)
  maxEventSeen: DecimalCounter                  // DIAGNOSTIC ONLY — never a rejection threshold (§5.1)
}
interface ActivitySlice {
  scope: ActivityScope; incarnation?: ActivityIncarnation
  transactions: SourceSlice<Tx>; journal: SourceSlice<OperationRecord>; incoming: SourceSlice<IncomingTransferRecord>
  awaitingById: Map<string, AwaitingTx>; awaitingVersionById: Map<string, number>
  lastAccessedAt: number; refreshState: "cold"|"refreshing"|"ready"|"stale"
}
```
The store exposes **actions + readonly selectors only** (`activateScope`, `ingest<T>(mutation)`,
`applySnapshot<T>`, `addAwaiting`/`removeAwaiting`, `clearScope`/`clearProfile`/`clearAll`, `refreshScope`;
selectors `activeScope`/`activeSlice`/`activeTransactions`/`activeAwaiting`/`activeJournalOps`/`activeIncoming`).
**No action accepts a bare row and implicitly selects `activeScope`.** The mutable `slices` map is never exposed.

## 5. Durable causal protocol (spike + property-test FIRST, before any wiring)

Pure module `packages/wallet-core/src/activity/causal.ts` — no Vue/services/storage; plain data in/out.
Persistence is injected by the wiring layer.

### 5.1 The corrected watermark model (rejects the global-max-seq design)
A source-wide "highest event seen" **cannot** be a rejection threshold. Counterexample (codex):
```
event 12: upsert record B (arrives first)  → if this advances a global reject-watermark to 12…
event 11: upsert record A (arrives second) → …record A is wrongly dropped.
```
So distinguish three things:
- `maxEventSeen` — diagnostics only.
- `snapshotCoverage` — authoritative watermark: an snapshot proved it accounted for every committed revision
  `≤ watermark`. **Only an authoritative snapshot advances it.**
- per-record `recordVersions`/`tombstones` — ordering for events *newer* than coverage.

### 5.2 Mutation reducer (event in the slice's current incarnation)
1. `seq ≤ snapshotCoverage` → ignore (the snapshot already accounted for it).
2. else compare `seq` against both the record's version and its tombstone; apply only if newer than both.
3. `upsert` writes row+version, clears an older tombstone. `remove` deletes row+version, writes the tombstone.
4. update `maxEventSeen` (diagnostic).
Epoch handling — **a cold slice does NOT admit an ordinary event directly** (audit codex-nb1). Letting an event
initialize a cold slice lets a delayed *old-incarnation* event render before the authoritative snapshot arrives
(after popup/SW restart or a same-`profile.id` backup restore), violating Outcome-1. Instead: an event arriving
at a slice whose current incarnation is not yet established is **buffered by `(scope, incarnation)`**; only an
authoritative snapshot (or an explicit `scope-reset` control mutation, §4.2) establishes the current incarnation,
after which buffered events are replayed and only those matching the established incarnation with revision above
its watermark are applied — the rest are dropped. A known incarnation is never replaced by a bare event; events
from retired incarnations are discarded (and trigger a scoped resnapshot if ordering can't be established). This
exact trace (cold slice + delayed old-incarnation event before snapshot → no render) is property **P11**.

### 5.3 Snapshot reducer (watermark `W`)
1. reject if its incarnation is older/differs from the authoritative current one; reject if `W < snapshotCoverage`.
2. never wholesale-replace the map.
3. preserve any client record/tombstone with `seq > W` (it came from a newer event).
4. apply snapshot rows/tombstones only when their revision is newer than the per-record client revision.
5. **for any client record with version `≤ W` absent from the snapshot, remove it — snapshot absence is
   authoritative at `W`.**
6. advance `snapshotCoverage = W`; client tombstones `≤ W` may compact into coverage.

Handles both `snapshot@W=20 then delete@21` and `snapshot@W=20 then update@21` without resurrection/clobber.

### 5.4 Durable backend ordering (`apps/extension/src/wallet/services/activity-protocol/`)
Roots: `nulo:core:activity-incarnations`, `nulo:core:activity-counters`, `nulo:core:activity-checkpoints`,
`nulo:core:activity-tombstones` (namespace verified free — `nulo:core:*`/`nulo:journal`/`nulo:ui:*` are the
existing roots). A low-level singleton coordinator in `wallet/runtime.ts`, injected into
transaction/journal/incoming/profile-deletion services (NOT a duplicate materialized feed). Write algorithm:
```
acquire scope-incarnation lock → acquire source mutation lock →
  verify expected incarnation → persist next ALLOCATION counter → write domain row with revision →
  write/remove tombstone → advance the COMMITTED-THROUGH checkpoint (= this seq) → emit mutation
```
> **Audit ultra-B3 — the snapshot watermark must be the committed-through checkpoint, NOT the allocation
> counter.** A lock-free reader could otherwise observe the durable intermediate `counter=5` while row A@5 is not
> yet written, publish `W=5`, and then §5.3 would drop the later A@5 as `≤ coverage`. So there are TWO durable
> numbers per `(source,scope)`: the **allocation counter** (may gap, never reuse — what the next write claims)
> and the **committed-through checkpoint** (advances ONLY after the row+tombstone are durable, and only
> contiguously — it never jumps past an un-written seq). A snapshot's `watermark` is the **checkpoint**, so it
> only ever claims authority over fully-committed revisions. The read-consistent snapshot path (§5.6/S3) reads
> the checkpoint + the rows at-or-below it; an interleaved in-flight write (counter advanced, row/checkpoint not)
> is invisible to the reader and correctly arrives later as an event above the watermark.

Crash safety: counter-then-crash = unused seq, checkpoint un-advanced (safe); row-then-crash-before-checkpoint =
the seq is re-driven or arrives as a live event above the (un-advanced) checkpoint; delete =
increment→tombstone→delete-row→advance-checkpoint (crash between tombstone+row-delete: tombstone wins);
crash-before-tombstone = deletion uncommitted, retryable. **Property P3b:** a live pause-after-counter (row not
yet written) snapshot must not drop the later row — crash-after-counter alone does not model this live trace.

### 5.5 Long-running producer fence (staleness hole)
An epoch is useless if a stale producer just asks for the newest epoch after it finishes. Every long op captures
an `ActivityWriteFence = { scope, incarnation }` **before** external work and `commitUpsert`/`commitRemove`
**require** the expected incarnation (no "use current epoch" default on update paths): incoming polling captures
before `getNotesRaw`; tx execution captures with the execution fence before proving; pending-tx polling uses the
revision stored on the tx; a journal transition uses the record's stored incarnation.

### 5.6 Lock ordering (ONE total order — no inversion)
> The three partial orders scattered across the drafts (§5.6/§6/§10) were internally **invertible** — an ABBA
> deadlock on `transitionLock ↔ activity-scope` (audit B3/codex): a journal transition holds `transitionLock`
> then emits into the coordinator (transition→scope), while a coordinator snapshot holds the scope lock then
> calls `journal.getActivitySnapshot` which takes `transitionLock` (scope→transition). Resolved by ONE global
> order + making `transitionLock` the journal's source lock (not a lock *above* the coordinator).

The single legal acquisition order, top→bottom, is:
```
queuedCreationLock  →  profile-facade lock  →  activity scope/incarnation lock
  →  journal transitionLock (== the journal SOURCE lock)  →  other per-source mutation locks  →  storage
```
Rules: (1) `transitionLock` IS the journal source lock — the coordinator acquires the activity-scope lock ABOVE
it and never the reverse; a journal method that already holds `transitionLock` must NOT then call back into the
coordinator to acquire the scope lock (invert). Instead the coordinator drives: scope-lock first, then the
journal write under `transitionLock`. (2) Sort `ActivityScopeKey`s before a multi-scope acquire. (3) **Snapshot
reads do NOT take the global write `transitionLock`** (audit S3) — a UI switch fires a cold-scope journal
snapshot that full-scans the journal, and taking the global write lock there would serialize every switch
against every in-flight execution transition (proving/submitting/succeeded). Snapshot reads take a
read-consistent path: either a copy captured under a brief lock hold, or a lock-free read of the immutable
per-record revisioned view; never the write lock across the full scan.

### 5.7 Cross-source atomicity + tombstone retention
No global total order — independent per-`(source,scope)` counters. Cross-source guarantees: one shared scope
incarnation; each source snapshot atomic against that source's writes; subscriptions registered *before*
snapshots; render rules suppress succeeded-journal-when-tx-exists without a global sequence; deletion retires the
scope incarnation *before* source purges. Tombstones: retain for the current incarnation, drop on retirement,
warn (not hard-cap) at a high per-scope threshold; **no** TTL/compaction without a checkpoint protocol (a bare
compaction watermark can itself drop a delayed delete).

### 5.8 Property suite (≥1000 traces/property, print failing seeds)
Actions: upsert · remove · begin-snapshot · deliver-snapshot-later · permute-event-delivery · backend-restart ·
client-restart · retire/reactivate-scope · inject-crash-after-{counter,tombstone,row}.
Properties (P1–P12): no cross-scope mutation · snapshot idempotence · delete-during-snapshot never resurrects ·
newer event survives an older snapshot · **distinct-record lower event survives a higher event** (§5.1) · SW
restart never reuses a revision · old incarnation cannot write after re-import · ABA `upsert→remove→newer-upsert`
converges · same nullifier on two networks stays two records · drain-events + fresh-snapshot == reference model ·
**(P3b)** a live pause-after-counter snapshot never drops the later row (committed-through watermark, ultra-B3) ·
**(P11)** a cold slice buffers a delayed old-incarnation event/**snapshot** until the current incarnation is
established, and a delayed OLD snapshot never re-establishes a lower monotonic lineage (rollback, ultra-S6) ·
**(P12)** cross-source crash graduation: an incoming-note→outgoing-tx graduation whose SW dies before the
incoming removal does NOT leave both visible — startup **exact-scope reconciliation** re-derives suppression
(the live `onTxAdded` callback is unawaited and the existing-record scan returns before outgoing suppression,
`incoming-transfer/service.ts:650`, ultra-S9).

## 6. Producer + persistence integration
- **Transaction** (`transaction/{spec,service,client}.ts`, backup registry, storage-codecs test): add optional
  `profileId?`/`networkId?`/`activityIncarnation?`/`activitySeq?`. Replace the long positional `addTransaction(…)`
  with `recordSubmittedTransaction({fence, scope, …})` that validates `scope.profileId === fence.profileId`,
  `scope.accountAddress ∈ fence.authorizedAccounts`, scope network/chain == fence, deletion epoch current,
  activity incarnation current. New key `JSON.stringify(["tx", scopeKey, hash])`; legacy hash-only keys stay
  readable (rewrite-on-touch under the tx mutation lock). Add `getActivitySnapshot(scope)`,
  `getTransactionsForScope`, `getTransactionForScope`, `purgeForProfile`. Pending polling uses the row's stored
  scope + `submittedEndpointUrl`, never active-now; quarantine an unresolvable legacy row.
- **Operation journal**: add optional `chainId?`/`activityIncarnation?`/`activitySeq?`/`claimToken?`/`claimedAt?`
  (`profileId` already required — do NOT relabel it new). Activity-feed kinds (`transfer`/`dapp_execute`) carry
  complete scope; `token_import` stays outside the composite feed. **All WRITES** — `createOperation`,
  `transitionOperation`, `setOperationMeta`, `touchOperation`, `deleteOperation`, `purgeForProfile`,
  `clearChainState`, claim/prepare/fail-if-unclaimed/supersede — take `transitionLock` (H3). **Snapshot reads do
  NOT take the write lock** (audit S3, §5.6) — read-consistent path only, so a cold-scope UI switch can't stall
  an in-flight execution transition. Add atomic `prepareQueuedOperation`, `claimQueuedOperation(id, expectedScope, claimToken)`,
  `failIfUnclaimed`, `deleteOperationLocked`, `getActivitySnapshot`. Claim checks exact
  profile/network/chain/account (no leniency for a just-created queued record); on mismatch → delete the wrong
  queued record + durable tombstone under the lock, return `scope-mismatch`, create a fresh record under the
  captured correct scope, **never** render the wrong row as a failed op to the mis-attributed account. `pending`
  with no `claimToken` = silent-path preparation (not executor-owned); claim installs the token atomically, so
  background cleanup can fail `queued` or *unclaimed* `pending` without racing a live executor (H6).
- **Incoming** (`incoming-transfer/{spec,service,repository}.ts`): add optional
  `chainId?`/`activityIncarnation?`/`activitySeq?`; repository identity `JSON.stringify(["incoming", scopeKey,
  siloedNullifier])` (H8); every `getRecord`/`hasRecord`/`upsertRecord`/`deleteRecord` takes the composite scope;
  legacy bare keys dual-read + rewrite-on-touch under `serviceLock`. **Preserve `NoteDao.owner` as the trusted
  owner; do NOT reintroduce the reverted `content.owner` drop.** Polling captures an incarnation before PXE work,
  validates inside `serviceLock` before commit.
- **Scope lifecycle** (`ActivityScopeLifecycleCoordinator`): activate/ensure scopes per `(profile,network,account)`
  tuple; retire a scope before account-deletion / chain-purge; extend `ProfileDeletionRows` to concrete scope
  descriptors; retire every profile scope before tx/journal/incoming purges; **change tx profile-deletion from
  `purgeForAccounts(addresses)` to `purgeForProfile(profileId)`** (address-only is unsafe with collisions).

## 7. Frontend slice coordinator
- **Activation:** a `flush:'sync'` watcher on `[profile?.id, network?.id, network?.chainId, account?.address]`
  derives a scope only via `assertCoherentScope` (else the immutable empty slice). On change: (1) swap
  `activeScopeKey` synchronously; (2) return the cached slice immediately if present; (3) start a coalesced
  background `refreshScope(scope)` for that *exact* scope; (4) apply the response to that scope even if no longer
  active; (5) on refresh failure retain rows + mark `stale`.
- **Producer bridge** (`apps/extension/src/activity/source-bridge.ts`): connects the 3 clients, **registers event
  handlers before snapshotting**, receives only `ActivityMutation`/`ActivitySnapshot`, does **not** import
  `app.store` and cannot inspect active scope — active-routing misuse is structurally impossible, not guarded by
  more `if (activeAccount===…)`.
- **UI migration** (`app.store.ts`, `activity.store.ts`, `useIncomingTransfers.ts`, `RecentActivityView.vue`,
  `activity.vue`, `journal/[id].vue`, `activity-rows.ts`, `send.vue`, `app.vue`): move tx + awaiting into slices;
  make `useIncomingTransfers` a readonly selector/refresh adapter (or delete after adoption); remove local
  `journalOps`/`terminalJournalOps`; pass `profileId` into `buildActivityRows`; filter all present fields with
  present-and-equal semantics + add `chainId` to journal/incoming filtering; keep strict journal-detail checks;
  awaiting placeholders capture complete scope at submit-time and clean up on the tx/journal record's OWN slice;
  keep dApp orphan-task publication fail-closed (no correlation). **Retain Phase-1's present-and-equal display
  filters as defense-in-depth** until the full PR is proven.
- **Cache lifetime:** keep ≤32 recently-used slices in the popup process; never evict active; eviction drops only
  in-memory cache (durable data remains); clear deleted-profile slices immediately (deletion tombstone so a late
  refresh can't recreate them); **cap-enforce on EVERY refresh completion** (not just on activation) so a late
  snapshot can't recreate an evicted/cleared slice past the cap (ultra-S7). Expose only `activeSlice`, never the
  map. A fresh popup / evicted slice is cold → snapshots.
  > **Audit ultra-S7 — "clear-all on hard lock" CONTRADICTS the switch UX, which today IS lock→unlock**
  > (`Header.vue:22`: profile switch = lock → profile selector → unlock). So clearing on lock destroys the very
  > cache instant-switch-back needs; retaining across lock crosses the lock/privacy boundary. This is a real
  > design fork (Ask A2): either (i) accept that switch-back after a lock is **cold** (simplest; instant-cache
  > then only benefits within one unlocked session — of which there is currently none, so effectively a no-op
  > until an in-session switcher exists), or (ii) build a distinct **authenticated switch lifecycle** separate
  > from lock, with cache/request epochs. Surfaced, not silently assumed.

## 8. Legacy attribution (no numbered migration; additive optional fields)
Frontend leniency is **not** permission to guess scope: a populated field must exactly equal the requested scope;
a missing field is accepted only if the backend can **uniquely** attribute the row; ambiguous rows are excluded
from snapshots + logged as quarantined. Examples: a legacy tx with account+chain only → include only if that
address currently has exactly one profile owner and the endpoint/network resolves uniquely; a colliding address
with **no** stored profile is ambiguous → renders under neither. Backup: derive the composite key when scope
fields exist (hash-only fallback for legacy); on restore validate optional fields, **do not trust restored
activity epoch/counter values** (strip/re-stamp through the coordinator), reject duplicate composite identities,
preserve per-row failure reporting. New causal-clock/tombstone roots are local protocol metadata, not backup
content.

## 9. Execution fencing + abort semantics

### 9.1 Fence contract — a MONOTONIC session generation (ABA-safe), not identity comparison
> **Audit ultra-B1 (ABA):** identity comparison (profileId + deletion epoch + incarnation) is ABA-blind — a
> P1→P2→P1 switch (or lock→unlock-P1) during proof leaves all three identical, so the CAS would broadcast despite
> the user having switched away and back. `capturedAt` is not monotonic-comparable. Fix: a monotonic
> `sessionGeneration` bumped on EVERY session open/close/switch.
```ts
interface ExecutionScopeFence {
  profileId: string; profileDeletionEpoch: number
  sessionGeneration: DecimalCounter          // monotonic; bumped on every open/close/switch (ABA-safe, ultra-B1)
  authorizedAccounts: readonly string[]; scope: ActivityScope; activityIncarnation: ActivityIncarnation
  capturedAt: number                         // diagnostic only
}
ProfileService.captureExecutionFence(expectedProfileId, authorizedAccounts, scope): Promise<ExecutionScopeFence>
```
Inside the same `runExclusive` lock lock/open/delete take: require active profile; require
`active.id === expectedProfileId`; reject reserved/deleting; validate scope profile; freeze the authorized
account set; capture deletion epoch; capture the **current `sessionGeneration`**; capture the activity
incarnation. Every drift checkpoint AND the commit-to-submit CAS compare `fence.sessionGeneration` to the live
one — an intervening switch-and-return is caught even when the identity triple is unchanged. **The authorized
account is the dispatcher's actual `from`, NOT `appStore.account`** — a multi-account dApp session may validly
send from B while the home screen shows A; treating popup-selected account as the principal would break
`multi-account-from`. **Incarnation ordering (audit ultra-S6):** `activityIncarnation.generation` is a durable
**monotonic decimal lineage** maintained by the activity coordinator per scope — NOT `pxeGeneration`, which is
128-bit RANDOM hex (`profile/spec.ts:28-33`, not comparable with `>`); `pxeGeneration` is carried only as the
incarnation `nonce`. A snapshot/reset advancing the incarnation must move the monotonic lineage forward so a
delayed OLD snapshot cannot re-establish a lower lineage (ultra-S6 rollback).

### 9.2 Propagate authorized profile
Both approved + silent paths pass `payload.session.profileId` to `ExecutionService.executeOperations`. Replace
`check active → await refreshSession → capture active-now` with `captureExecutionFence(expectedProfileId,
[operation.accountAddress], operationScope)` **after** materialization resolved the authorized account and
**before** mutex/build/prove.

### 9.3 Drift checkpoints — the builder CONSUMES the fence (no assert-then-read-active TOCTOU)
The primary H5 closure is that the builder + ALL resource resolution take their profile/account **from the
fence**, never re-derive from active-now. `buildStandard`/`buildNoFrom` today call `requireActiveProfile` (a
separate facade-lock acquisition) then `getAccountContract(profile.id, …)` (`tx-request-builder.ts:113/115`,
`:382/:387`) — asserting-equal-then-reading-active is the *same* two-acquisition window the plan condemns as H4
(audit finding S2). So the builder signature takes `fence.profileId` + `fence.authorizedAccounts` and resolves
the account contract from **those**, with `assertExecutionFenceCurrent(fence)` as a *supplementary* liveness
check, not the source of the profile id. One typed check `assertExecutionFenceCurrent(fence)` (active profile +
deletion epoch + **`sessionGeneration`** + activity incarnation still current). Call it: (1) after capture;
(2) before enqueue; (3) after mutex grant; (4) before journal claim/create; (5) at `buildStandard` entry; (6) at
`buildNoFrom` entry; (7) after slow contract/authwit discovery; (8) before proof; (9) after proof before
`toTx`/submitting; (10) at the commit-to-submit checkpoint (§9.4). Mutex key = captured profile. Fee-strategy
chain carries the fence (`fee/{fee-strategy,embedded-strategy,fee-juice-strategy,fee-juice-with-claim-strategy,
fpc-strategy}.ts`), each resolving accounts from the fence, not active-now. **Do NOT port correlation from
`a6ed183`.**

> **Audit ultra-S8 — split PREVIEW vs AUTHORIZED builders.** `estimateOperationFee` runs the SAME builder with no
> session fence (`dapp-send-executor.ts:208`); making the fence *required* on the builder breaks fee preview,
> making it *optional* is fail-open. So there are two builder entry points: a **preview** path (no fence, no
> drift abort, no scope stamping — read-only, cannot submit) and an **authorized** path (fence-consuming, drift
> checks, stamps scope). The `SendPrincipal` (§17/D16) selects the path; a `kind:"dapp"` authorized build with no
> `expectedProfileId` rejects. Preview never reaches the commit-to-submit boundary.

### 9.4 The commit-to-submit boundary — brief-hold CAS, NOT a lock held across `node.sendTx`
> **This supersedes the rejected "hold the profile-facade `Lock` across `node.sendTx`" design.** That design is
> broken (audit B1/B2, verified): the facade `Lock` force-releases after `MAX_HOLD_MS = 5min` *while the holder
> runs* (`packages/wallet-core/src/utils/lock.ts:4,37-44`), and a hanging `node.sendTx` worst case is ~246s
> (4 attempts × 60s + [1,2,3]s backoff — `aztec-runtime/src/utils/fetch.ts:18`), under 5min with **zero margin**;
> SW-timer throttling or one extra await pushes it over → force-release fires → a queued switch acquires the lock
> (H5 reintroduced) → the holder's `finally leave()` double-releases and corrupts the lock wallet-wide. That lock
> also gates the popup poll, `refreshSession`, and the emergency **lock-wallet** action, so holding it across a
> multi-minute send is a wallet-wide availability + security regression.

Since the builder already binds everything to `fence.profileId` (§9.3), *nothing is ever built under the wrong
profile* regardless of active-now — a mid-prove switch cannot mis-bind. The only residual is the tiny
check→`sendTx` window, closed **without** a long-held lock:

1. **Commit-to-submit (atomic hand-off — audit ultra-B2):** at the existing pre-send `checkCancelled`
   (`execution-coordinator.ts:174`), under a **private lock-held** critical section (a `*_locked` fence-check
   helper — the facade `Lock` is non-reentrant, so a *public* lock-taking check called from here self-deadlocks,
   ultra-Minor): (a) re-verify the fence current INCLUDING `sessionGeneration` (§9.1); (b) persist the durable
   submission bundle (§9.7); (c) **synchronously invoke `node.sendTx(tx)` and capture its Promise WITHOUT
   awaiting it** inside the critical section; then (d) **release the lock and `await` the Promise OUTSIDE**. This
   closes the release→send gap: a queued switch cannot interleave between "fence verified" and "send dispatched"
   because the send is *dispatched* under the lock; only its network wait happens outside. **The returned Promise
   must NOT flow back through `runExclusive`** (`profile/service.ts:160`'s `return await fn()` would hold the lock
   across the network — ultra-B2). If the fence is stale at (a) → abort (no send).
2. **The switch never waits on the network:** a switch acquiring the facade lock after our critical section
   proceeds immediately; one that held it before makes (a) fail → abort.
3. **Record via a ONE-SHOT capability, not a blanket bypass (audit ultra-B4 + S1):** post-`sendTx`, the tx +
   terminal journal are recorded under `fence.scope`. This write bypasses the §5.5 incarnation-current gate
   **only** via a one-shot capability bound to `(marker id, scope, incarnation, txHash)` minted at step-1 — the
   normal producer APIs must **never** accept an "omit fence" flag (else a genuinely-stale write sneaks through).
   An accepted on-chain tx is irreversible and must never be dropped; but if the scope was RETIRED (profile
   delete) between capture and the record write, the row cannot enter the deleted profile's feed (privacy) — it
   goes to a **non-rendering orphan ledger**, and profile deletion stays **reserved until all armed submissions
   reconcile** (then a final purge), so a purge can neither erase the on-chain record nor race the recreate
   (ultra-B4). Never reported as `EXECUTION_SCOPE_CHANGED`.

Wire via an optional coordinator hook `commitSubmission?: (fence, sendThunk) => Promise<void>`. **Submission
recovery (§9.7) applies to ALL sends** (a UI transfer can also SW-die post-accept — `transfer-executor.ts:199`,
ultra-S8); only the drift-ABORT is dApp-only. No wallet-wide freeze; no 5-min-force-release hazard.

### 9.7 Restart reconciliation — a versioned bundle, reconciled BEFORE the reaper
> **Audit ultra-B5:** the existing journal reaper's boot sweep transitions EVERY non-terminal record to `failed`
> at SW startup (`operation-journal/reaper.ts:121-128`, "recovery is impossible"). A naive `submitting` marker
> would be reaped to `failed` before any reconciler ran — and `failed→succeeded` is illegal. And `{scope,txHash,
> fence}` lacks the journal id, endpoint, `Tx` draft, and public-authwit tail the send callbacks need
> (`transaction/service.ts:115`).

The durable marker is a **versioned, runtime-validated submission bundle** `{ version, journalId, scope, fence,
endpointUrl, txHash, txDraft, authwitTail }` persisted *before* the synchronous send-dispatch (§9.4 step-1c). On
SW restart: (1) a `submission_unknown` journal state (NOT `failed`) is stamped for any record with a live marker;
(2) the **reconciler runs BEFORE the reaper** — it re-checks each marker's tx against the marker's **pinned
endpoint** (a transport timeout is ambiguous — NOT proof of rejection), and on a found tx records `succeeded`
under the captured scope via the one-shot capability, on a confirmed-absent tx after a bounded grace →
`failed`; (3) every step is idempotent and the **marker is deleted LAST**; (4) only then may the reaper sweep the
remaining (marker-less) non-terminal records as today. This inverts the current boot ordering (reconcile →
reap) and adds the `submission_unknown` non-terminal state so the reaper skips armed records.

### 9.5 Error + warning UX (typed, no-leak, durable card)
Add `ExecutionScopeChangedError` (`packages/extension-messaging/src/errors.ts`, code `EXECUTION_SCOPE_CHANGED`,
"Wallet scope changed; the transaction was not sent."). Map in `wallet-sdk/error-envelope.ts` to JSON-RPC
`-32000` + `data.walletErrorCode="EXECUTION_SCOPE_CHANGED"`. **Not EIP-1193 `4001`** (this was not an explicit
user rejection). **Never** include profile/account/network/origin/builder-phase in the dApp envelope. Journal:
pre-claim drift → `failIfUnclaimed` terminalizes `queued`/unclaimed-`pending`; post-claim drift → executor catch
transitions its owned record to `failed` with `error.kind="scope_changed"`; **keep the failed record — do NOT
tombstone it — the durable failed card IS the warning + audit trail**; never leave `pending` residue. Immediate
warning: emit `onExecutionScopeAborted{journalId, scope}`; a popup shows a toast **only when its current scope ==
the event scope** ("Transaction stopped because the wallet profile changed."), dedup by journalId, no retries; a
popup on another profile shows nothing. On return to the authorizing scope the durable failed card is visible.

### 9.6 Abort DoS analysis
A dApp cannot switch the wallet profile — abort is a user action. Per-origin/lane caps stay 8/32; one drift →
one terminal journal row + one warning; no auto-retry; warning copy is wallet-controlled (never dApp
title/subtitle); a dApp can't cancel another origin's request. **The facade lock is held only for the
milliseconds of the commit-to-submit CAS (§9.4), NEVER across `node.sendTx`** — so a switch is never delayed by a
network call and a hung endpoint cannot freeze profile switching or the emergency lock-wallet action (this is the
correction of the rejected design's wallet-wide freeze, audit B1/B2).

## 10. Queued-journal + dispatcher consistency
Shared pure helper `packages/wallet-bridge/src/account-resolution.ts`:
```ts
resolveAuthorizedSessionAccount({ walletAccounts /* index/address-sorted */, sessionAddresses, requestedFrom }): IAccountRef
```
Explicit `from` → require exact session membership + wallet ownership; omitted/`NO_FROM` → first wallet-ordered
account in the session; no match → refuse (never fall back outside the session). Used by **both**
`WalletSdkDispatcher.resolveNetworkAndAccount` **and** `wallet-sdk/queued-journal.ts` (which adds
`extractSendFrom(message)` for `message.args[1].from`, normalizes `NO_FROM`, fetches
`AccountService.getAccounts(profileId, chainId)`, calls the shared resolver). A session `[B,A]` with wallet order
`[A,B]` must queue **and** dispatch `NO_FROM` under **A** (H1/H2). Queued record carries
profileId/networkId/chainId/accountAddress/sessionId; claim compares all five. Queued creation uses the dApp
session's authorized profile (active equality is still verified via the atomic fence). Lock order is the ONE
global order in §5.6 (`queuedCreationLock → facade → activity-scope → transitionLock → …`), never reversed.

## 11. Deterministic multi-profile / multi-account network e2e
Files: `tests/e2e/network/account-profile-siloing.test.ts`, `tests/e2e/fixtures/profiles.ts`,
`tests/e2e/fixtures/execution-scope-gate.ts`, `apps/extension/src/e2e/execution-scope-gate.ts`. Extend the
playground with a real account selector so `opts.from` can pick the 2nd granted account (also upgrades
`multi-account-from.test.ts` past its first-account-only limitation).

**Test-only gate** (`ExecutionScopeGate`, mirrors the proof-gate DCE pattern): placed **after
`ExecutionScopeFence` capture, before `ExecutionLane.acquireSlot`** — the exact H5 interleaving (authorized, but
before any active-now lane/builder read). Injected only when `E2E_PROVERLESS` is statically true; static import,
no dynamic chunk; storage-key + class-marker absent from a normal prod bundle (negative-grep gate); no
release/publish change.

**Fixture topology** (respects the verified account-global-key + random-networkId facts): one browser; P1 from a
deterministic mnemonic; **P2 imported from the SAME mnemonic** (→ different profileId, but `P1.A===P2.A` and
`P1.B===P2.B`); both on Local Network / same chainId; assert profileIds differ and internal networkIds normally
differ. **Because account storage is globally keyed by address, the fixture recreates/ensures the active
profile's A/B rows after each switch and asserts the stored row's `profileId` — it does NOT assume both profiles'
rows coexist.**

**Authoritative no-submit proof (audit codex-nb4):** the test installs an observable **`node.sendTx` invocation
counter** (e2e-only hook) — the no-submit assertion is `sendTxCount === 0`, NOT "balances unchanged / no tx row"
(both of which can pass for reasons other than a real abort). **Arm the `MutationObserver` on the destination
activity root BEFORE the switch begins**, not after P2 activation — arming after misses a one-frame leak during
the switch tick.

**Sequence:** activate P1 + ensure A/B belong to P1 → connect playground under P1 → grant the tx bundle for both
accounts in order `[B,A]` → select explicit `from=B` → fund B → **arm the `MutationObserver` + reset the sendTx
counter** → start `sendTx`, approve → wait until the scope gate reports the P1/B fence captured → in a separate
wallet page lock/switch/unlock P2, select Local Network, ensure/create B (global address row now belongs to P2),
assert visible active scope is P2/local/B → release the gate → assert: the dApp gets error status + JSON-RPC
`-32000` + `walletErrorCode==="EXECUTION_SCOPE_CHANGED"` + **no** scope details; **`sendTxCount === 0`**; **no**
tx row under P1 or P2; the observer recorded **zero** P1 card ids under P2; no P2 journal bound to P1's request;
P1 has no queued/pending residue → switch back to P1 (recreate/ensure A/B), activate B, assert exactly one
`failed` `scope_changed` card carrying P1's scope → switch A→B→A in P1, verify cached rows return without
cross-account assignment → assert no console/page errors.

**Second case IN THE SAME dedicated network e2e (not a separate composition test) — the post-prove/pre-submit
closure (D10):** use the existing **proof gate** to hold *after* the builder has proved but *before* the
commit-to-submit CAS; switch to P2; release → assert the CAS drift-check aborts, `sendTxCount === 0` (the proof
is dropped, `node.sendTx` is never entered), and one `failed` card under P1. This is the case the pre-`acquireSlot`
gate CANNOT prove; both gates are required to cover the full drift window.

**Must-stay-green regressions:** `concurrent-sendtx{,-approve,-confirm}.test.ts`, `cancel-mid-prove.test.ts`,
`transfers.test.ts`, `multi-account-from.test.ts`, `account-switch-isolation.test.ts` (the H0 gate),
`incoming-transfers.test.ts`.

## 12. Phases + validation gates (one PR, staged reviewable commits — no product wiring before the spike passes)

### Phase 0 — Characterization + invariant pinning (no behavior change)
Add characterization tests for: distinct-record event reordering · journal delete-vs-transition resurrection ·
pending pre-claim cleanup · P1/P2 colliding-account ownership behavior · exact dispatcher `NO_FROM` wallet order ·
the current one-shot builder drift window · mixed profile/network/account frontend refs fail closed.
**Gate:** `bun run --cwd apps/extension test src/stores/app.store.test.ts src/composables/useIncomingTransfers.test.ts
src/popup/components/modules/general/RecentActivityView.test.ts src/utils/activity-rows.test.ts
src/wallet/services/{execution,operation-journal,wallet-sdk}` · `bun run typecheck:all` · `bun run lint`.

### Phase 1 — Pure durable-protocol spike (§5). NO extension/UI wiring.
New `packages/wallet-core/src/activity/{scope,causal,model,index}.ts` + `causal.property.test.ts`. Add
`fast-check` as a `@nulo/wallet-core` **devDependency** (subject to the 7-day min-age policy; commit `bun.lock`).
**Gate:** `bun run --cwd packages/wallet-core test src/activity` (≥1000 traces/property, seeds printed) · `bun run
--cwd packages/wallet-core typecheck` · `bun run typecheck:all` · `bun run lint`. **No wiring lands before this
is green.**

### Phase 2a — Durable protocol storage primitives (§5.4, §6 storage) — NO execution-fence dependency
> Split out of the old Phase 2 (audit codex-c2 / Opus-M1): the old Phase 2 depended on Phase 4's
> `ExecutionScopeFence`, so it could not stand alone. 2a is the fence-free half.

Activity-protocol repo/coordinator + runtime singleton + the ONE lock order (§5.6); tx/journal/incoming optional
composite fields + codecs + composite storage keys + `getActivitySnapshot` read-consistent paths; scope
lifecycle/retirement; profile-deletion by profile/scope (not address); legacy dual-read + unique-attribution
quarantine; backup re-stamp; per-row codec tests. Producers do NOT yet stamp incarnation from a fence.
**Gate:** `bun run --cwd apps/extension test src/wallet/services/{activity-protocol,transaction,operation-journal,
incoming-transfer,backup} src/wallet/services/storage-codecs.test.ts src/wallet/services/cross-profile-isolation.test.ts`
· `bun run --cwd packages/wallet-core test src/activity` · `typecheck:all` · `lint` · `bun run test`.

### Phase 2b — Execution scope fence + producer scope-stamping (§9.1–9.2, §5.5) — MUST precede Phase 3
The `ExecutionScopeFence` capture (atomic, §9.1) + `SendPrincipal` discriminator (§17/D16) + `ActivityWriteFence`
(§5.5) + producers emitting COMPLETE causal envelopes (tx/journal/incoming stamp `scope` + `activityIncarnation`
from the fence). This is the half Phase 3 depends on: only once every real tx/journal producer stamps its scope
can the slices route real records (else a colliding-address tx with no `profileId` is quarantined and vanishes —
audit Opus-M1). Abort/drift semantics do NOT land here (Phase 4).
**Gate:** `bun run --cwd apps/extension test src/wallet/services/{profile,execution,transaction,operation-journal,
incoming-transfer}` — assert every send path stamps scope+incarnation · `typecheck:all` · `lint` · `bun run test`.

### Phase 3 — Composite frontend slices + instant cache (§7)
Activity store + event bridge + coherent-scope watcher; migrate both activity surfaces + journal detail +
awaiting placeholders. Because Phase 2b now stamps real records, isolation is provable END-TO-END, not just
store-synthetic. Tests: A-event while B-active mutates only A · A-snapshot resolving while B-active mutates only
A · A→B→A restores cached A with no clear/refetch paint · mixed refs → empty scope · **distinct profileIds with a
colliding account/network/chain, using REAL stamped records, stay isolated** · cold-slice buffers a delayed
old-incarnation event until the snapshot establishes the incarnation (P11) · store-level snapshot/event ordering ·
filters check profile+network+chain+account · undefined legacy fields display-lenient only after scoped-envelope
admission + unique attribution · dApp orphan cards stay hidden.
**Gate:** `bun run --cwd apps/extension test src/stores src/activity src/composables/useIncomingTransfers.test.ts
src/popup/components/modules/general src/popup/pages/activity.vue src/utils/activity-rows.test.ts` · `bun run
test:e2e` · `typecheck:all` · `lint` · `bun run test`.

### Phase 4 — Queued-claim correctness + abort-on-drift execution (§9.3–9.7, §10)
Shared wallet-bridge resolver + actual-`from` extraction + exact `NO_FROM`; composite queued record + claim token
+ lock-serialized supersede + `failIfUnclaimed`; builder CONSUMES `fence.profileId` + **PREVIEW/AUTHORIZED split**
(§9.3, no TOCTOU, no broken fee-estimate); all drift checkpoints comparing **`sessionGeneration`**;
captured-profile lane key; fee-strategy fence propagation; **atomic commit-to-submit hand-off (sync-dispatch under
private lock-held check, await outside) + versioned submission bundle + one-shot-capability unconditional record +
orphan ledger + reconcile-BEFORE-reaper restart recovery** (§9.4/9.7 — NOT a lock held across `node.sendTx`);
typed `-32000` dApp error; scope-aware warning; pending-residue cleanup. **No correlation from `a6ed183`.**
Tests: capture-vs-switch atomic · **ABA `P1→P2→P1` + `lock→unlock-P1` during proof both ABORT** (ultra-B1) ·
switch before-enqueue/while-mutex-waiting/during-builder/during-proof aborts · switch at the commit-to-submit CAS
aborts before send · switch AFTER the sync-dispatch does NOT falsely report abort + records captured scope via the
one-shot capability · scope-retirement between capture and record → the on-chain tx lands in the orphan ledger,
never dropped, deletion waits (ultra-B4) · **SW-death after dispatch → the reconciler runs BEFORE the reaper and
recovers from the submission bundle; the reaper never fails an armed `submission_unknown` record** (ultra-B5) ·
`estimateOperationFee` (preview) still works with no fence · happy paths keep lane ordering.
**Gate:** `bun run --cwd packages/wallet-bridge test` · `bun run --cwd apps/extension test
src/wallet/services/{profile,dapp-interaction,execution,wallet-sdk,operation-journal} src/popup/utils` · `bun run
test:e2e` · `typecheck:all` · `lint` · `bun run test`.

### Phase 5 — Multi-profile/multi-account network harness (§11)
Fixture helpers + real playground account selector + execution-scope gate + the dedicated test + strengthened
`multi-account-from`.
**Gate:** `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-profile-siloing.test.ts` ·
`… tests/e2e/network/multi-account-from.test.ts tests/e2e/network/cancel-mid-prove.test.ts` · `bun run --cwd
apps/extension build:chrome` · `! rg -n "nulo:e2e:execution-scope-gate|ChromeStorageExecutionScopeGate"
apps/extension/dist/chrome` · `typecheck:all` · `lint`.

### Phase 6 — One-PR integration, regression, security gate
Remove the now-redundant Phase-1 clear/generation code **only after** slice tests prove equal-or-stronger
containment (keep the final present-and-equal filters). Run the shared-execution regressions in one invocation:
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/{concurrent-sendtx,concurrent-sendtx-approve,
concurrent-sendtx-confirm,cancel-mid-prove,transfers,multi-account-from,account-profile-siloing}.test.ts`.
Then `bun run lint && bun run typecheck:all && bun run test && bun run test:e2e && bun run build:chrome`. Finally
`/harden security` over the diff; fix all blocking findings; rerun targeted suites + the full final gate. **Final
product ask:** confirm once more the dApp `ExecuteOperation` spinner re-enable stays dropped (planned: hidden).

## 13. Hazard traceability (H0–H8)
| Hazard | Structural answer | Pin |
|---|---|---|
| H0 flat active-now state | composite slices; record-owned routing; Phase-1 filters retained as defense | store + switch component tests |
| H1 queued account from `accounts[0]` | parse actual `from`; shared resolver | explicit-from-B unit/e2e |
| H2 wrong `NO_FROM` order | one wallet-bridge helper for queue + dispatch | `[B,A]` session / `[A,B]` wallet test |
| H3 delete/meta resurrection | all journal writes/deletes under one lock + durable tombstones | adversarial deferred-promise races |
| H4 non-atomic authorized profile | `captureExecutionFence(expectedProfileId, …)` under facade lock | capture-vs-switch test |
| H5 post-capture drift | builder CONSUMES `fence.profileId` + **monotonic `sessionGeneration`** (ABA-safe) at every checkpoint + captured lane key + **atomic commit-to-submit hand-off** (sync-dispatch under lock, await outside) + one-shot-capability record + reconcile-before-reaper recovery | scope-gate e2e (pre-acquireSlot) + proof-gate case (post-prove/pre-submit) + **ABA P1→P2→P1** unit, all asserting `sendTxCount===0` |
| H6 silent pending residue | claim token distinguishes prepared/claimed; `failIfUnclaimed` handles queued+unclaimed-pending | background-cleanup tests |
| H7 profile-less display filter | profile+network+chain+account present-and-equal | P1/P2 colliding-address render test |
| H8 restart/ABA/snapshot/reincarnation | durable incarnation (keyed on `pxeGeneration`; covers chain-purge + same-address re-add + **same-id backup restore** — NOT mnemonic re-import into an occupied slot, which mints a new profileId → new scope key) + per-source counter + coverage watermark + per-record tombstone + composite incoming key | property suite (P1–P11) |

## 14. Security & Adversarial Considerations
**Threat model / adversaries:** a dApp choosing arbitrary ops/origin/`from`/ordering/concurrency; broadcast
events reaching every popup; honest async completion after switches; SW termination at any await; old snapshots
resolving after newer events; profile delete/re-import mid-flight; corrupt/legacy storage rows; colliding
addresses across profiles + nullifier identities across network trees. **Security properties:** *confidentiality*
(no foreign composite row renders), *authorization integrity* (no sign/submit under a non-authorized
scope), *causal integrity* (stale work can't resurrect/overwrite), *existence privacy* (mismatched claims +
warnings never reveal another profile's identifiers to a dApp). **Trusted:** validated dApp session profile,
dispatcher account authorization, wallet-owned network/account rows after exact ownership checks, the atomic
profile facade lock, the incarnation coordinator. **Untrusted:** dApp `from`/titles/method names, active-now
reads after authorization, optional legacy scope fields without unique attribution, any record routed merely
because the UI happens to match. **Note provenance:** `NoteDao.owner` is the trusted owner — decoded content is
not a replacement authority; **do NOT restore the reverted owner-mismatch filter.** **Abort UX/DoS:** §9.6.
**Storage tampering:** a corrupt high counter can suppress activity (local availability loss) but must **never**
redirect rows to another scope; on malformed clock/incarnation metadata fail closed for that scope + quarantine +
reconstruct only from valid row/tombstone revisions under an explicit repair path (never silently reset counters
+ reuse an old incarnation). **Supply chain:** `fast-check` dev-only, 7-day min-age, `bun.lock` committed,
frozen-lockfile CI; no crypto rolled. **Test seam:** the `ExecutionScopeGate` is DCE'd out of prod (negative-grep
gate), same posture as the accepted proof gate.

## 15. Assumptions
**Facts** — see §3 (all verified file:line this session): accounts keyed by address (colliding profiles overwrite)
· journal `profileId` required · the frozen prove→send pipeline with a pre-send `checkCancelled` · random
networkId per profile · flat Phase-1 feed state + its sync watchers · tx has no profileId/networkId · incoming
keyed by bare nullifier · setMeta/delete unlocked · silent-path pending fast-forward + queued-only cleanup ·
active-now mutex/builder reads · empty real-migration registry (pre-production).

**Inferences (attack these):**
- (I1 — CORRECTED, was partly false) The durable activity **incarnation** is **mandatory**, sourced from the
  profile's `pxeGeneration` (the source of truth for a same-scope reincarnation). Verified (audit codex/Opus):
  **backup restore REUSES `profile.id` when the id is free and mints only a fresh `pxeGeneration`**
  (`profile/service.ts:1337-1348`, comment: "same-id re-import: the D4 fence distinguishes this incarnation") —
  so same-scope-key reincarnation is REAL, not conditional. Mnemonic re-import into an *occupied* slot mints a new
  id (`nextUnreservedId`, `:837-841,993-999`) → a different scope key. Either way the incarnation must key on
  `pxeGeneration` + be included in the profile-deletion purge set. **Highest-risk wiring point — dedicated store
  test for the same-id-restore-bumps-pxeGeneration → old-incarnation-events-dropped path.**
- (I2 — pin in Phase 0, don't infer) Locking a profile does NOT synchronously abort in-flight controllers (a held
  job survives until its next `checkCancelled`, verified `execution-lane.ts:136-180`); the design uses the scope
  gate + the commit-to-submit CAS, never lock-mid-prove. **Characterize this contract in Phase 0** rather than
  resting on inference.
- (I3 — CORRECTED) `refreshSession()` cannot switch to P2, but it is **not** side-effect-free: it calls
  `getActive()` which can close a TTL-expired session (`session-manager.ts:159-166,259-277`). The H4 drift vector
  (concurrent switch between the `:149` check and SW-side capture) is still closed by the atomic fence; just don't
  assume `refreshSession` is a no-op.
- (I4 — measure, don't assume) The 32-slice cap is per LIVE popup — a popup teardown loses the cache (cold repaint
  on reopen), and slice size is otherwise unbounded. **Measure memory + define the cold-paint UX**; don't assert
  no regression.

**Asks.** Audit note (codex): A1/A2/A3/A5/A6 are baked into implementation phases → they are **approval
PRECONDITIONS**, not deferrable asks; A4/A7 restate binding decisions. Surface all at the gate:
- (A1 — precondition) The `ExecutionScopeGate` prod seam (DCE'd, negative-grep-guarded) is assumed built — or
  accept a less-deterministic mutex-wait-only repro.
- (A2 — DECISION FORK, ultra-S7) **Inactive-profile cache vs the lock-based switch.** Today a profile switch IS
  lock→unlock (`Header.vue:22`), so "clear on lock" and "instant switch-back" are in direct conflict. Two options
  to pick between: (i) **switch-back is cold after a lock** (simplest, safe; instant-cache benefits only a future
  in-session switcher — effectively inert now), or (ii) build a **distinct authenticated switch lifecycle** with
  cache/request epochs that retains slices across the switch but not across a true wallet-lock. Recommend (i) for
  this PR (defer the switcher), but this is a genuine product call — not silently assumed. Confidentiality: any
  retained inactive-profile feed data lives in a trusted extension document; the store exposes only `activeSlice`.
- (A3 — precondition) **AccountService composite re-key** stays a **follow-up** (§2) — the fence prevents
  cross-profile *signing* regardless of the global address key; its current shape causes ownership churn (row
  overwrite on switch) but not a signing leak.
- (A4) **Abort semantics** = the dispatcher-authorized `from` governs execution (popup-selected `appStore.account`
  is presentation state, not an SW authority) — binding.
- (A5 — CORRECTED, precondition) **Commit-to-submit is a brief-hold CAS + durable `submitting` marker (§9.4),
  NOT a lock held across `node.sendTx`.** The rejected "hold the facade lock across the bounded node request"
  answer was wrong (audit B1/B2): the bound is *minutes* (≈246s worst case, under the lock's 5-min force-release
  with zero margin) and would freeze every profile op wallet-wide including emergency lock. Confirm the corrected
  design.
- (A6 — precondition) `fast-check` as the property lib (dev-only, 7-day-min-age policy-subject).
- (A7) Final confirm: dApp `ExecuteOperation` spinner cards stay **dropped** (D2) — binding.
- (A6) Confirm `fast-check` as the property lib (dev-only, policy-subject).
- (A7) Final confirm: dApp `ExecuteOperation` spinner cards stay **dropped** (Decision D2).

## 16. Decision ledger (with provenance)
| # | Decision | Chosen | Rejected | Source / rationale |
|---|---|---|---|---|
| D1 | Mid-switch execution | **abort before broadcast + warn** | continue under captured profile | **User binding**; smaller execution trust surface (all 3 planners agreed). |
| D2 | dApp in-progress cards | **keep fail-closed hidden** | re-enable correlation cards | **User binding**; drops the biggest audit-pain surface (all 3). |
| D3 | Activity isolation | **composite slices** | more active-now guards | all 3; guards can be omitted, slice routing is structural. |
| D4 | Snapshot ordering | **coverage watermark + per-record revision; `maxEventSeen` diagnostic-only** | **per-source global-max-seq threshold** | **codex correction — supersedes the main + Opus drafts** (counterexample §5.1: a global max loses out-of-order distinct records). |
| D5 | Epoch | **durable generation + nonce** | in-memory integer | codex + main; survives SW restart, prevents reuse. |
| D6 | Counters | **per-(source,scope) decimal string** | global total order / bigint | codex; no required cross-source order + JSON-safe. |
| D7 | Long-running producer | **capture `ActivityWriteFence` before external work; commit requires expected incarnation** | "ask for newest epoch after finishing" | **codex — closes a staleness hole neither draft had.** |
| D8 | Legacy rows | **parse + uniquely-attribute-or-quarantine** | blind undefined-field leniency | **codex correction — supersedes main + Opus "lenient on undefined"** (prevents colliding-profile duplication). |
| D9 | Incoming key | **(scope, nullifier)** | global nullifier | all 3; nullifier uniqueness is rollup-tree-local. |
| D10 | Drift closure | **builder consumes `fence.profileId` + repeated checks + captured lane key + a brief-hold commit-to-submit CAS + durable `submitting` marker + unconditional post-send record** | ~~single builder-entry check~~ AND ~~hold the facade lock across `node.sendTx`~~ | **evolved twice**: codex killed the single-check; **Opus-B1 killed the "hold lock across send"** (5-min force-release under a ~246s send → lock corruption + wallet-wide freeze) → the brief-hold CAS + unconditional record (§9.4). |
| D15 | Lock ordering | **ONE order `queuedCreationLock→facade→activity-scope→transitionLock(=journal source lock)→other-source→storage`; snapshot reads take NO write lock** | ~~three partial orders~~ (invertible: ABBA on `transitionLock↔activity-scope`) | codex-c1 + **Opus-B3/S3** — the drafts' partial orders deadlocked; snapshot-under-global-write-lock coupled UI nav to execution. |
| D20 | Cold slice | **buffer events by `(scope,incarnation)` until a snapshot/reset establishes the incarnation** | admit an ordinary event into a cold slice | **codex-nb1** — else a delayed old-incarnation event renders before the authoritative snapshot (P11). |
| D21 | Mutation envelope | **source-indexed discriminated union + separate `scope-reset` control + runtime codec asserting envelope-scope == embedded-record-scope** | a `source: string` shape with TS-only typing | **codex-nb3** — TS alone can't stop a corrupt producer wrapping a P2 row in a P1 envelope. |
| D22 | Post-send record | **UNCONDITIONAL under captured scope; SW-death recovered via the `submitting` marker; never report `EXECUTION_SCOPE_CHANGED`** | incarnation-fence the post-send write like pre-send work | **Opus-S1** — an accepted on-chain tx must never be dropped because the scope retired mid-send. |
| D23 | Incarnation source | **`pxeGeneration`** (covers chain-purge, same-address re-add, same-id backup restore) | assume re-import always mints a fresh id (no same-scope reincarnation) | **codex/Opus-I1** — backup restore reuses `profile.id` + fresh `pxeGeneration` (`profile/service.ts:1337-1348`). |
| D24 | Phase order | **split old Phase 2 → 2a storage-primitives + 2b fence+producer-stamping; 2b precedes Phase 3** | Phase 2 standalone before Phase 3 | **codex-c2/Opus-M1** — Phase 2 depended on Phase 4's fence; Phase 3 couldn't prove isolation until producers stamp scope. |
| D25 | Drift detection | **monotonic `sessionGeneration` bumped on every open/close/switch; compared at every checkpoint** | identity (profileId+epoch+incarnation) comparison | **ultra-B1** — identity is ABA-blind: P1→P2→P1 during proof leaves the triple unchanged. |
| D26 | CAS hand-off | **synchronously DISPATCH `node.sendTx` under a private lock-held check, capture the Promise, release, await OUTSIDE (never via `runExclusive`)** | "release the lock, then call sendTx" | **ultra-B2 + Minor** — a release→send gap lets a switch interleave; a public lock-taking check self-deadlocks (non-reentrant). |
| D27 | Snapshot watermark | **committed-through checkpoint (advances only after row is durable, contiguously)** | the raw allocation counter | **ultra-B3** — a lock-free reader can see `counter=5` before row 5 is written → later A@5 wrongly dropped. |
| D28 | Post-send record | **one-shot capability bound to (marker,scope,incarnation,hash); orphan ledger if scope retired; deletion RESERVED until armed sends reconcile** | a blanket "omit fence" unconditional write | **ultra-B4** — a blanket bypass lets stale writes through, and a retired scope has no valid feed destination (privacy vs. losing an on-chain fact). |
| D29 | Restart recovery | **versioned submission bundle + `submission_unknown` state + reconcile BEFORE the reaper + pinned endpoint + marker-deleted-last** | `{scope,txHash,fence}` marker reconciled after boot | **ultra-B5** — the existing reaper (`reaper.ts:121`) fails every non-terminal record at boot; `failed→succeeded` is illegal; the thin marker lacks the send-callback inputs. |
| D30 | Incarnation ordering | **durable MONOTONIC decimal lineage (coordinator-maintained); `pxeGeneration` is only the nonce** | order incarnations by `pxeGeneration` | **ultra-S6** — `pxeGeneration` is 128-bit RANDOM hex (`profile/spec.ts:28`), not comparable; a delayed old snapshot could rollback. |
| D31 | Shared builder | **split PREVIEW (no fence) vs AUTHORIZED (fence) builder; submission recovery for ALL sends, drift-abort dApp-only** | one fence-consuming builder for estimate + send | **ultra-S8** — `estimateOperationFee` has no fence (`dapp-send-executor.ts:208`); a UI transfer can also SW-die post-accept (`transfer-executor.ts:199`). |
| D32 | Cache vs lock | **FORK surfaced (A2): cold-switch-back-after-lock (recommended, inert now) vs a new authenticated switch lifecycle** | "clear on lock + retain across switch" (contradictory today) | **ultra-S7** — profile switch IS lock→unlock (`Header.vue:22`). |
| D33 | Graduation crash | **startup exact-scope reconciliation re-derives incoming↔tx suppression (P12)** | rely on live `onTxAdded` suppression only | **ultra-S9** — SW death mid-graduation leaves both visible (`incoming-transfer/service.ts:650`). |
| D11 | Abort error to dApp | **typed `-32000 EXECUTION_SCOPE_CHANGED`, no scope details** | EIP-1193 `4001` | **codex — a scope abort is not an explicit user rejection; no info-leak.** |
| D12 | Wrong queued claim | **locked delete + tombstone → fresh record; never render wrong failed card** | reuse / show wrong card | codex + main. |
| D13 | Abort record | **keep the `failed` card (durable warning/audit); do NOT tombstone** | tombstone the drift record | **codex correction — supersedes the main draft's tombstoned-remove.** |
| D14 | Pending ownership | **claim token distinguishes prepared vs claimed** | re-read stage in the cleanup block | codex — makes the queued/owned distinction explicit, not racy. |
| D16 | Blast-radius framing | **discriminated `SendPrincipal` `{kind:"dapp",expectedProfileId}` vs `{kind:"wallet"}`; dApp-without-profile REJECTS; only drift-abort is inert for wallet; stamping applies to ALL** | Opus's `expectedProfileId===undefined` inert sentinel (fail-OPEN) | Opus framing, **hardened by codex-c3** — a sentinel lets a missed dApp call-site bypass the fence silently. |
| D17 | AccountService re-key | **follow-up, out of scope** | absorb the full account-storage migration now | codex — fence prevents cross-profile signing regardless. |
| D18 | Delivery | **one PR, staged commits** | multiple PRs | **User binding**; mitigated by §17. |
| D19 | Migration | **optional fields + dual-read** | numbered migration | all 3; pre-production, per-row tolerance. |

## 17. One-PR blast-radius mitigation
First commit = tests only (Phase 0). Second = the standalone property-tested protocol (Phase 1). Backend APIs
additive before old feed APIs are removed; raw legacy service events remain for non-feed consumers (the new
bridge uses causal events). Phase-1 containment stays until the new slices pass unit+component+mocked-e2e+network.
The execution entrypoint takes a **discriminated `SendPrincipal`** (D16, hardened per audit codex-c3): `{kind:
"dapp"; expectedProfileId: string}` vs `{kind: "wallet"}`. A `kind:"dapp"` send with no profile **rejects**
(fail-closed) — an `expectedProfileId===undefined` sentinel would let one missed dApp call-site silently bypass
the fence + captured lane + commit-to-submit. Only the *drift-abort* behavior is inert for `kind:"wallet"` sends;
**activity scope + revision STAMPING applies to ALL sends** (a wallet transfer must still land in its own slice).
So UI transfers / `executeTransfer` / read-only simulate / `estimateOperationFee` keep their behavior (no abort,
no captured-lane change) but DO stamp scope. The shared coordinator gets an *optional*
`commitSubmission` hook; unrelated send paths preserve behavior until explicitly opted in. `a6ed183` is evidence
only (correlation excluded). Each internal commit passes targeted typecheck/tests. `/harden security` is the
final blocking review, not a follow-up. The merge condition is not "tests pass" — it is: no durable producer has
an active-scope write API, every ambiguous legacy row fails closed, every queued claim is composite + serialized,
and the last reversible execution boundary is demonstrably fenced.

## 18. Critical files
`packages/wallet-core/src/activity/{scope,causal,model}.ts` (new — pure protocol + property tests) ·
`apps/extension/src/wallet/services/activity-protocol/*` (new — durable coordinator/repo) ·
`apps/extension/src/stores/activity.store.ts` + `src/activity/source-bridge.ts` (new — slices + producer bridge) ·
`profile/service.ts` (`captureExecutionFence(expectedProfileId, accounts, scope)` + `submitIfExecutionFenceCurrent`) ·
`execution/{tx-request-builder,execution-lane,execution-coordinator}.ts` + `fee/*` (drift checks, captured lane
key, serialized submit hook) · `wallet-sdk/{queued-journal,background}.ts` + `packages/wallet-bridge/src/
account-resolution.ts` (shared resolver, H1/H2, H6) · `operation-journal/service.ts` (locked mutations, claim
token, tombstones) · `incoming-transfer/{repository,service}.ts` + `transaction/{spec,service}.ts` (composite
keys, scope fields) · `RecentActivityView.vue`/`activity.vue`/`activity-rows.ts` (profile-aware render) ·
`src/e2e/execution-scope-gate.ts` + `tests/e2e/network/account-profile-siloing.test.ts` (deterministic H5 e2e).
