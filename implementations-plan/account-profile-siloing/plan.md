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
4. **Execution binding (via prevention, not detection):** while a send is in flight, a voluntary
   profile/account switch is **blocked** (§9 guard) — so active-scope cannot drift and the builder's active-now
   reads are always correct. No tx can build/sign under a scope other than the one it was authorized in. A send
   completes under the profile that started it, or the user cancels it (the guard's escape hatch). Lock-wallet is
   never blocked; a lock/SW-death mid-send abandons the send (existing reaper behavior, unchanged).
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
session authorization → journal record created (send now "in flight")
  → [ §9 GUARD: any voluntary profile/account switch is BLOCKED for this whole span → active-scope is CONSTANT ]
  → enqueue on lane → composite journal claim → build from active-now (== authorized, guaranteed by the guard)
  → prove → node.sendTx → record tx + terminal journal transition (active scope == authorized scope throughout)
  → record terminal → guard clears → switch now allowed
```

## 2. Scope

### In scope
Pure durable causal protocol + property model · composite frontend activity slices · tx/journal/incoming scoped
snapshots + mutation envelopes · durable incarnations + per-source counters + snapshot watermarks + tombstones ·
tx/incoming composite persistence keys · profile-aware rendering + residual filters · queued-journal derivation /
claiming / delete-serialization (H1/H2/H3) · **the in-flight-send switch guard (§9)** — block a voluntary switch
while a send is in flight, so active-scope can't drift · **the account composite re-key (§6.5)** — file account
rows under `(profileId, chainId, address)` so two same-seed profiles stop overwriting each other · dedicated
multi-profile/multi-account network e2e · final `/harden security`.

### Out of scope (state explicitly)
- dApp task↔journal correlation + re-enabling dApp `ExecuteOperation` spinner cards (**Decision D2**).
- Shipping a proverless path; any release/publish change.
- Letting a voluntary switch happen mid-send at all — it is **blocked** (§9 guard, **Decision D1**).
- Cryptographic ownership changes for incoming notes (keep `NoteDao.owner` as the trusted authority).
- Any change to the **account-ADDRESS freeze** (`packages/aztec-runtime/src/account/`): the vendored artifact,
  derivation vectors, and regime record are untouched. The §6.5 re-key changes *how a row is filed*, never *what
  address a seed derives* — fully independent surfaces (see §6.5).

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
  row; they do not coexist as two persisted rows.** [VERIFIED — **§6.5/Phase 2a′ now re-keys this to a composite
  `(profileId, chainId, address)`, which is why the §11 e2e no longer needs its recreate-on-switch workaround.**]
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

### 6.5 Account composite re-key (pulled into scope — pre-production makes it free)
**Today:** account rows are filed under **`account.address` alone** (`account/spec.ts:5-7`,
`ACCOUNT_STORAGE_ROOT = "nulo:core:accounts"`, marked "Frozen"). The row *carries* `profileId`/`chainId`/`index`
as fields, but the KEY is the bare address. So two profiles created from the **same seed** derive the same
address → **the same storage key** → they overwrite each other's row (name / `visible` / `profileId`). They
cannot coexist. That is one profile's data clobbering another's inside an arc whose whole point is siloing.

**Change:** file the row under the composite `JSON.stringify(["account", profileId, chainId, address])`.
- `AccountService` read/write/list/delete take `(profileId, chainId, address)` — most call sites already pass
  exactly this triple, so the churn is mechanical.
- `getAccounts(profileId, chainId)` becomes a true prefix/filter over composite keys rather than a
  scan-and-filter on the row's `profileId` field.
- Account deletion + profile deletion purge by composite prefix (aligns with the `purgeForProfile` change above).
- **Index/derivation math is untouched** — `index` still feeds derivation exactly as today; only the filing
  changes.

**Why it is cheap RIGHT NOW and expensive later** (the reason for the reversal): the repo is **pre-production**
(`CLAUDE.md` § migrations: "do NOT write migrations… there are no users; every fresh install stamps the current
max schema version"). So: **no numbered storage migration, no backup migration.** Change the key derivation,
re-pin the frozen-root provenance in the backup-migration registry, update the coverage test, reinstall the local
extension. After launch this same change would require the full migration + backup-migration machinery the repo
deliberately avoids — so deferring makes it permanently more expensive.

**Explicitly NOT the address freeze.** `packages/aztec-runtime/src/account/` (vendored `SchnorrAccount.json`,
`frozen-artifact.ts`, `instantiation-descriptor.ts`, `address-freeze.ts`) governs **what address a seed derives**
— a versioned artifact of the extension major. This change governs **how the derived row is filed in storage**.
Independent surfaces: the KAT (`derivation-vectors.test.ts`) and every freeze test must stay green with **zero**
vector/pin edits. If a freeze test reds, the re-key was done wrong.

**Blast radius (honest):** `AccountService` is load-bearing for every lookup, derivation entry point, and backup
slice — bounded and mechanical, but it earns its own early phase (2a′) + its own tests, landing before anything
keys off it. It also **simplifies the §11 e2e**: two colliding-address profiles just coexist as two rows, so the
fixture drops its "recreate/ensure the active profile's rows after each switch" dance.

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
  in-memory cache (durable data remains); **`clearAll()` on wallet lock** (A2 — no inactive-profile data survives
  a lock); clear deleted-profile slices immediately (deletion tombstone so a late refresh can't recreate them);
  **cap-enforce on EVERY refresh completion** (not just on activation) so a late snapshot can't recreate an
  evicted/cleared slice past the cap (ultra-S7). Expose only `activeSlice`, never the map. A fresh popup /
  post-lock / evicted slice is cold → snapshots.
  > **A2 RESOLVED — clear ALL slices on lock; switch-back after a lock is COLD.** (Fork surfaced by ultra-S7:
  > a profile switch today IS lock→unlock (`Header.vue:22`), so clearing-on-lock and instant-switch-back
  > conflict.) Chosen option (i): the simplest and most private answer — no inactive-profile feed data survives
  > a lock. Instant-from-cache therefore serves **within-session** scope changes (account + network switches,
  > plus any future in-session profile switcher), which is where the O(1) slice swap pays off today. Option (ii)
  > — a distinct authenticated switch lifecycle with cache/request epochs — is explicitly deferred.

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

## 9. In-flight-send switch guard (replaces the abort-on-drift machinery)

> **Why this replaces the fence/CAS/recovery apparatus (three audit rounds, ~10 blocking bugs, all here).** The
> abort-on-drift design had to detect a scope change *during* a send and unwind it — which forced a monotonic
> session fence, an atomic commit-to-submit hand-off, an unconditional capability-bound record, and a
> reconcile-before-reaper restart path, each fighting the non-reentrant self-force-releasing facade lock, the
> batch-queuing RPC client (`node.sendTx` only enqueues — `safe_json_rpc_client.ts:208`), and the aggressive boot
> reaper (`operation-journal/reaper.ts:121`). The simpler, correct move is to **prevent the drift instead of
> detecting it**: if the active scope cannot change while a send is in flight, the builder reading active-now is
> *always* correct, and H4/H5/H6 evaporate with no fence at all. (User decision, superseding the earlier
> abort-on-switch choice once the audits proved abort was the over-architecting.)

### 9.1 The invariant
**While a send is in flight for the active profile, a voluntary profile/account switch is blocked.** "In flight"
= there exists a non-terminal execution journal record (`queued`/`pending`/`proving`/`submitting`) for the active
profile. With switching blocked, `active` is constant for the send's lifetime → every active-now read in
`resolveExecutionMutexKey` (`execution-lane.ts:189`) and both builders (`tx-request-builder.ts:113/382`) resolves
the profile/account the send was authorized under. No fence, no session-generation, no CAS, no unconditional
record, no orphan ledger, no restart-recovery beyond what exists today.

### 9.2 The guard (small, one chokepoint)
- A single reactive predicate `hasInFlightSend(activeProfileId)` derived from the operation-journal (a
  non-terminal `transfer`/`dapp_execute` record exists for the active profile). Expose it from the journal
  client the popup already consumes.
- The **profile-switch intent** — today `lock → profile selector → unlock` (`Header.vue:22`) — checks the guard
  BEFORE tearing down the session: if `hasInFlightSend`, block with a toast ("Finish or cancel your pending
  transaction before switching accounts.") and a link to the pending card. The account-switch control (same
  shell) checks the same predicate.
- **Cancel is the escape hatch:** the existing cancel-in-flight path (`cancel-mid-prove` contract) lets the user
  abandon the send, which terminalizes the record → the guard clears → the switch proceeds. So the user is never
  trapped; they either let it finish (seconds) or cancel.

### 9.3 What is deliberately NOT guarded
- **Emergency lock-wallet is NEVER blocked** — it is a security action and must always work. Locking during a
  send abandons it; the existing reaper fails the record at SW boot (unchanged today's behavior). The guard is on
  the *switch-to-another-profile* intent only, not on lock.
- **SW death / TTL auto-lock mid-send** is not a voluntary switch and is out of the guard's scope — the existing
  reaper (`reaper.ts:121`) already terminalizes non-terminal records at boot. This arc does not change the reaper
  or the batch-RPC boundary. There is no attempt to make a send *survive* a lock/restart (that was the entire
  source of the tar pit and is explicitly dropped).

### 9.4 Queued-journal account correctness stays (H1/H2/H3 — independent of switching)
The guard does not touch *which account a send is journaled under*; that is a separate correctness bug fixed in
§10 (dispatcher-consistent `NO_FROM` derivation, lock-serialized delete). Those fixes stay.

### 9.5 dApp-facing behavior
A dApp send is never silently mis-scoped (the guard keeps `active` stable for its lifetime) and there is no new
`EXECUTION_SCOPE_CHANGED` error path — the send simply runs to completion or the user cancels it. No typed
scope-changed error, no scope-aware abort warning, no submission bundle. (All of §9's former error/warning
machinery is dropped.)

### 9.6 Residual + honest limits
- A send in flight when the user hits **lock** is abandoned (reaper-failed at boot) — same as today; acceptable
  and not a regression.
- The guard is a **UX constraint** (you can't switch for the seconds a send proves+submits). This is standard
  wallet behavior and far cheaper than the abort machinery. If a future in-session switcher makes this annoying,
  revisit — but the guard is correct and leak-free as-is.


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
Files: `tests/e2e/network/account-profile-siloing.test.ts`, `tests/e2e/fixtures/profiles.ts`. Extend the
playground with a real account selector so `opts.from` can pick the 2nd granted account (also upgrades
`multi-account-from.test.ts` past its first-account-only limitation). The existing **proof gate** (no new prod
seam needed — the fence/scope gate is dropped with §9) parks a send at `proving` to hold it "in flight"
deterministically.

**Fixture topology:** one browser; P1 from a deterministic mnemonic; **P2 imported from the SAME mnemonic** (→
different profileId, but `P1.A===P2.A` and `P1.B===P2.B`); both on Local Network / same chainId; assert
profileIds differ and internal networkIds normally differ (networkId is randomly allocated per profile). **With
the §6.5 composite re-key, both profiles' A/B rows COEXIST** — so the fixture simply creates them once per
profile and asserts each row's `profileId`; the old "recreate/ensure the active profile's rows after each switch"
dance is gone (that workaround existed only because of the address-only key). Add an explicit assertion that
after a P1→P2→P1 round trip, P1's account rows still carry P1's own name/`visible` (no clobber).

**Case 1 — the render-isolation win (H0/H7):** a real incoming note lands on P1/A while P1 is active; assert it
renders under P1 and, after switching to P2 (no send in flight), **zero** P1 cards appear under P2 (a
`MutationObserver` armed BEFORE the switch records any transient leak); switch back → P1's own activity reappears
instantly. This is the core privacy assertion.

**Case 2 — the in-flight-send guard (§9, replaces the abort case):** activate P1 + ensure A/B belong to P1 →
connect playground under P1 → grant the tx bundle `[B,A]` → `from=B` → fund B → install an observable
**`node.sendTx` invocation counter** → hold the proof gate → start `sendTx`, approve (now a `proving` record
exists = in flight) → **attempt to switch to P2 → assert the switch is BLOCKED** (guard toast asserted via
`waitForToast`; active scope stays P1) → release the proof gate → assert the send **completes under P1**
(`sendTxCount === 1`, the tx row lands under P1/B, never P2) → now that the record is terminal, **the switch to
P2 succeeds** → assert P2 shows zero P1 cards. Also assert **lock-wallet is NOT blocked** during the in-flight
send (locking abandons it; reaper-failed at boot — unchanged behavior).

**Must-stay-green regressions:** `concurrent-sendtx{,-approve,-confirm}.test.ts`, `cancel-mid-prove.test.ts`
(the guard's escape hatch), `transfers.test.ts`, `multi-account-from.test.ts`, `account-switch-isolation.test.ts`
(the H0 gate), `incoming-transfers.test.ts`.

## 12. Phases + validation gates (one PR, staged reviewable commits — no product wiring before the spike passes)

### Phase 0 — Characterization + invariant pinning (no behavior change)
Add characterization tests for: journal delete-vs-transition resurrection (H3) · pending pre-claim cleanup (H6
residue, queued-only today) · P1/P2 colliding-account ownership under the address-only key (what §6.5 fixes) ·
exact dispatcher `NO_FROM` wallet order (H2) · **I2: a profile lock/switch does NOT abort in-flight execution
controllers** (the §9 guard's premise — a send survives until its own `checkCancelled`) · mixed
profile/network/account frontend refs fail closed. (The old "one-shot builder drift window" item is dropped with
the abort machinery — under §9 the builder's active-now read is correct by construction.)
**Gate:** `bun run --cwd apps/extension test src/stores/app.store.test.ts src/composables/useIncomingTransfers.test.ts
src/popup/components/modules/general/RecentActivityView.test.ts src/utils/activity-rows.test.ts
src/wallet/services/{execution,operation-journal,wallet-sdk}` · `bun run typecheck:all` · `bun run lint`.

### Phase 1 — Pure durable-protocol spike (§5). NO extension/UI wiring.
New `packages/wallet-core/src/activity/{scope,causal,model,index}.ts` + `causal.property.test.ts`. Add
`fast-check` as a `@nulo/wallet-core` **devDependency** (subject to the 7-day min-age policy; commit `bun.lock`).
**Gate:** `bun run --cwd packages/wallet-core test src/activity` (≥1000 traces/property, seeds printed) · `bun run
--cwd packages/wallet-core typecheck` · `bun run typecheck:all` · `bun run lint`. **No wiring lands before this
is green.**

### Phase 2a′ — Account composite re-key (§6.5) — lands FIRST of the storage work
Re-key `nulo:core:accounts` to `JSON.stringify(["account", profileId, chainId, address])`; migrate
`AccountService` read/write/list/delete + `getAccounts` prefix semantics + composite-prefix purge; re-pin the
frozen-root provenance in the backup-migration registry + its coverage test. **No numbered migration** (pre-
production). Lands before 2a so every downstream composite key sits on a settled account shape.
Tests: two same-seed profiles hold **two coexisting rows**, each with its own name/`visible`/`profileId` ·
`getAccounts(profileId, chainId)` returns only that profile's rows · account + profile deletion purge by prefix
and leave the other profile's row intact · legacy address-keyed rows are absent-on-fresh-install (no dual-read
needed pre-production; a dev with old-shaped data reinstalls).
**Gate:** `bun run --cwd apps/extension test src/wallet/services/account src/wallet/services/backup
src/wallet/services/storage-codecs.test.ts` · **`bun run --cwd packages/aztec-runtime test`** — the address KAT +
every freeze test green with **zero** vector/pin edits (proves the re-key didn't touch derivation) · `bun run
typecheck:all` · `bun run lint` · `bun run test`.

### Phase 2a — Durable protocol storage primitives (§5.4, §6 storage)
> Split out of the old Phase 2 (audit codex-c2 / Opus-M1): storage primitives first, producer stamping (2b)
> second, so each half is independently reviewable and 2b's stamping lands before Phase 3's slices need it.

Activity-protocol repo/coordinator + runtime singleton + the ONE lock order (§5.6); tx/journal/incoming optional
composite fields + codecs + composite storage keys + `getActivitySnapshot` read-consistent paths; scope
lifecycle/retirement; profile-deletion by profile/scope (not address); legacy dual-read + unique-attribution
quarantine; backup re-stamp; per-row codec tests. Producers do NOT yet stamp their records (that's 2b).
**Gate:** `bun run --cwd apps/extension test src/wallet/services/{activity-protocol,transaction,operation-journal,
incoming-transfer,backup} src/wallet/services/storage-codecs.test.ts src/wallet/services/cross-profile-isolation.test.ts`
· `bun run --cwd packages/wallet-core test src/activity` · `typecheck:all` · `lint` · `bun run test`.

### Phase 2b — Producer scope-stamping (§6, §5.5) — MUST precede Phase 3
Producers emit COMPLETE causal envelopes (tx/journal/incoming stamp `scope` + `activityIncarnation`) from the
active scope at write-time (which the §9 guard keeps stable for a send's lifetime — no execution fence needed).
`ActivityWriteFence` (§5.5) still applies to long-running producers (incoming polling). This is the half Phase 3
depends on: only once every real tx/journal producer stamps its scope can the slices route real records (else a
colliding-address tx with no `profileId` is quarantined and vanishes — audit Opus-M1).
**Gate:** `bun run --cwd apps/extension test src/wallet/services/{execution,transaction,operation-journal,
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

### Phase 4 — In-flight-send switch guard + queued-journal correctness (§9, §10)
The small half. (a) **Guard (§9):** `hasInFlightSend(activeProfileId)` derived from the journal; the profile-
switch + account-switch intents block (toast + link to the pending card) when it's true; lock-wallet is NEVER
blocked; cancel-in-flight clears the guard. (b) **Queued-journal correctness (§10, H1/H2/H3):** shared
wallet-bridge `resolveAuthorizedSessionAccount` used by dispatch + queued-create; actual-`from` extraction; exact
index-sorted `NO_FROM`; lock-serialized `deleteOperation`/`setOperationMeta` + tombstone. **No fence, no CAS, no
recovery machinery — the guard makes active-scope constant for a send's lifetime, so the builder's active-now
reads are always correct (H4/H5/H6 evaporate).** Tests: guard blocks a switch while a `proving` record exists +
allows it after cancel/terminal · lock-wallet is never blocked · `[A,B]` explicit-B queues+claims B · session
`[B,A]`/wallet `[A,B]` `NO_FROM` → A · racing delete+transition doesn't resurrect · happy send under a fixed
profile is byte-unchanged.
**Gate:** `bun run --cwd packages/wallet-bridge test` · `bun run --cwd apps/extension test
src/wallet/services/{operation-journal,wallet-sdk,execution} src/popup/components src/components` · `bun run
test:e2e` · `typecheck:all` · `lint` · `bun run test`.

### Phase 5 — Multi-profile/multi-account network harness (§11)
Fixture helpers + real playground account selector + the dedicated test (Case 1 render-isolation + Case 2
in-flight-send guard, both via the existing proof gate) + strengthened `multi-account-from`.
**Gate:** `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-profile-siloing.test.ts` ·
`… tests/e2e/network/multi-account-from.test.ts tests/e2e/network/cancel-mid-prove.test.ts` · `bun run --cwd
apps/extension build:chrome` · `typecheck:all` · `lint`. (No new prod seam to negative-grep — the §9 guard
reuses the existing proof gate for determinism; the fence/scope-gate is dropped.)

### Phase 6 — One-PR integration, regression, security gate
Remove the now-redundant Phase-1 clear/generation code **only after** slice tests prove equal-or-stronger
containment (keep the final present-and-equal filters). Run the shared-execution regressions in one invocation:
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/{concurrent-sendtx,concurrent-sendtx-approve,
concurrent-sendtx-confirm,cancel-mid-prove,transfers,multi-account-from,account-profile-siloing}.test.ts`.
Then `bun run lint && bun run typecheck:all && bun run test && bun run test:e2e && bun run build:chrome`, plus
**`bun run --cwd packages/aztec-runtime test`** (the address-freeze KAT + regime tests must be green with zero
vector/pin edits — proves §6.5 never touched derivation). Finally
`/harden security` over the diff; fix all blocking findings; rerun targeted suites + the full final gate. **Final
product ask:** confirm once more the dApp `ExecuteOperation` spinner re-enable stays dropped (planned: hidden).

## 13. Hazard traceability (H0–H8)
| Hazard | Structural answer | Pin |
|---|---|---|
| H0 flat active-now state | composite slices; record-owned routing; Phase-1 filters retained as defense | store + switch component tests |
| H1 queued account from `accounts[0]` | parse actual `from`; shared resolver | explicit-from-B unit/e2e |
| H2 wrong `NO_FROM` order | one wallet-bridge helper for queue + dispatch | `[B,A]` session / `[A,B]` wallet test |
| H3 delete/meta resurrection | all journal writes/deletes under one lock + durable tombstones | adversarial deferred-promise races |
| H4 non-atomic authorized profile | **PREVENTED by the §9 guard** — active-scope can't change during a send, so there is no non-atomic window to close | guard-blocks-switch-during-send test |
| H5 post-capture drift | **PREVENTED by the §9 guard** — no drift is possible while a send is in flight; the builder's active-now read is always correct | in-flight-send e2e (Case 2): switch blocked, send completes under P1 |
| H6 silent pending residue | **N/A under the guard** — no fence-abort path exists to leave residue; the send runs to completion or the user cancels (terminalizing the record) | cancel-clears-guard test |
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
not a replacement authority; **do NOT restore the reverted owner-mismatch filter.** **Mis-sign prevention:** the
§9 in-flight-send guard keeps active-scope constant for a send's lifetime, so a tx can never build/sign under a
scope other than the one it was authorized in (H4/H5) — enforced by prevention, not detection. **Guard DoS:** a
dApp cannot switch the wallet or force the guard; the guard blocks only the user's own voluntary switch and
cancel is always available; lock-wallet is never blocked. **Storage tampering:** a corrupt high counter can
suppress activity (local availability loss) but must **never** redirect rows to another scope; on malformed
clock/incarnation metadata fail closed for that scope + quarantine + reconstruct only from valid row/tombstone
revisions under an explicit repair path (never silently reset counters + reuse an old incarnation). **Supply
chain:** `fast-check` dev-only, 7-day min-age, `bun.lock` committed, frozen-lockfile CI; no crypto rolled.

## 15. Assumptions
**Facts** — see §3 (all verified file:line this session): accounts keyed by address (colliding profiles overwrite
— **this is what §6.5/Phase 2a′ now fixes**)
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
- (I2 — pin in Phase 0) Locking a profile does NOT synchronously abort in-flight controllers (a held job survives
  until its next `checkCancelled`, verified `execution-lane.ts:136-180`). Under Option 1 this matters only for the
  guard's edge (lock-during-send abandons the send → reaper-failed at boot, unchanged today). **Characterize in
  Phase 0.**
- (I3) `refreshSession()` calls `getActive()` which can close a TTL-expired session
  (`session-manager.ts:159-166,259-277`). Under Option 1 a TTL close during a send is the same as a lock (send
  abandoned, reaper-failed) — no new handling needed; just don't assume `refreshSession` is a no-op.
- (I4 — measure, don't assume) The 32-slice cap is per LIVE popup — a popup teardown loses the cache (cold repaint
  on reopen), and slice size is otherwise unbounded. **Measure memory + define the cold-paint UX**; don't assert
  no regression.

**Asks.** Audit note (codex): A1/A2/A3/A5/A6 are baked into implementation phases → they are **approval
PRECONDITIONS**, not deferrable asks; A4/A7 restate binding decisions. Surface all at the gate:
- (A1 — resolved by Option 1) No new prod seam. The §9 guard's e2e reuses the EXISTING proof gate; the
  `ExecutionScopeGate` is dropped.
- (A2 — RESOLVED at the gate: **option (i), cold switch-back after a lock**) Today a profile switch IS
  lock→unlock (`Header.vue:22`), so "clear on lock" and "instant switch-back" conflict. **Chosen: clear ALL
  slices on lock** — switch-back after a lock is a normal cold load. Instant-from-cache therefore benefits
  within-session scope changes (account/network switches, and any future in-session profile switcher), not
  across a lock. Rejected: building a distinct authenticated switch lifecycle with cache/request epochs (larger
  surface, defers to a future switcher). **Privacy upside:** no inactive-profile feed data survives a lock at
  all, which is the safer default.
- (A3 — RESOLVED at the gate: **in scope**) **AccountService composite re-key** is now Phase 2a′ (§6.5). Deferral
  was justified only by migration cost; pre-production zeroes it, and post-launch it becomes permanently
  expensive. Confirmed by the user.
- (A4) **Abort semantics** = the dispatcher-authorized `from` governs execution (popup-selected `appStore.account`
  is presentation state, not an SW authority) — binding.
- (A5 — resolved by Option 1) No commit-to-submit CAS, no `submitting` marker, no lock-across-send. The §9 guard
  keeps active-scope stable for the send's lifetime, so the send just runs to completion under the profile that
  started it. The whole execution-abort/recovery apparatus is dropped.
- (A6 — precondition) `fast-check` as the property lib (dev-only, 7-day-min-age policy-subject).
- (A7) Final confirm: dApp `ExecuteOperation` spinner cards stay **dropped** (D2) — binding.
- (A8 — Option-1 tradeoff) The guard is a UX constraint: you cannot switch profile/account for the seconds a
  send proves+submits (cancel is the escape hatch). Standard wallet behavior; confirm acceptable.

## 16. Decision ledger (with provenance)
> **SUPERSEDING NOTE (Option 1, user decision after the audits).** Three audit rounds put ~10 blocking bugs
> entirely in the abort-on-drift machinery. The user chose the **in-flight-send guard** (§9) instead: block a
> voluntary switch while a send is in flight, so active-scope can't drift and no fence is needed. This
> **supersedes** the execution-abort decisions below — kept for provenance (they document a real path explored
> and rejected for cause): **D1 (now block-not-abort), D7's execution use, D10, D11, D16's fence use, D22, D25,
> D26, D28, D29, D31.** Still LIVE (they're protocol/slice decisions, unaffected): D3, D4, D5, D6, D8, D9, D12,
> D13(as the guard's cancel→failed card), D14, D15, D20, D21, D23/D30 (incarnation), D27, D32, D33, D17, D18, D19.

| # | Decision | Chosen | Rejected | Source / rationale |
|---|---|---|---|---|
| D1 | Mid-switch execution | **BLOCK the switch while a send is in flight (§9 guard)** | ~~abort-on-drift~~ (superseded) → ~~continue under captured profile~~ | **User (Option 1) after audits** — abort-done-correctly was the over-architecting; the guard prevents drift instead of detecting it, deleting the whole fence/CAS/recovery stack. |
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
| D32 | Cache vs lock | **RESOLVED: `clearAll()` on lock → switch-back after a lock is COLD; instant-cache serves within-session account/network switches** | a distinct authenticated switch lifecycle with cache/request epochs (deferred) | **ultra-S7 fork, user-decided at the gate** — simplest + most private (no inactive-profile feed data survives a lock). |
| D33 | Graduation crash | **startup exact-scope reconciliation re-derives incoming↔tx suppression (P12)** | rely on live `onTxAdded` suppression only | **ultra-S9** — SW death mid-graduation leaves both visible (`incoming-transfer/service.ts:650`). |
| D11 | Abort error to dApp | **typed `-32000 EXECUTION_SCOPE_CHANGED`, no scope details** | EIP-1193 `4001` | **codex — a scope abort is not an explicit user rejection; no info-leak.** |
| D12 | Wrong queued claim | **locked delete + tombstone → fresh record; never render wrong failed card** | reuse / show wrong card | codex + main. |
| D13 | Abort record | **keep the `failed` card (durable warning/audit); do NOT tombstone** | tombstone the drift record | **codex correction — supersedes the main draft's tombstoned-remove.** |
| D14 | Pending ownership | **claim token distinguishes prepared vs claimed** | re-read stage in the cleanup block | codex — makes the queued/owned distinction explicit, not racy. |
| D16 | Blast-radius framing | **discriminated `SendPrincipal` `{kind:"dapp",expectedProfileId}` vs `{kind:"wallet"}`; dApp-without-profile REJECTS; only drift-abort is inert for wallet; stamping applies to ALL** | Opus's `expectedProfileId===undefined` inert sentinel (fail-OPEN) | Opus framing, **hardened by codex-c3** — a sentinel lets a missed dApp call-site bypass the fence silently. |
| D17 | AccountService re-key | **IN SCOPE — composite `(profileId, chainId, address)` key, Phase 2a′ (§6.5)** | ~~follow-up / out of scope~~ (reversed at the gate) | **User reversal**: the only reason to defer was migration cost, and **pre-production makes it zero** (no storage/backup migration). Now-or-pay-far-more-later; also completes the arc's siloing story at the storage layer and simplifies the e2e fixture. Address-freeze surface untouched. |
| D18 | Delivery | **one PR, staged commits** | multiple PRs | **User binding**; mitigated by §17. |
| D19 | Migration | **optional fields + dual-read** | numbered migration | all 3; pre-production, per-row tolerance. |

## 17. One-PR blast-radius mitigation
First commit = tests only (Phase 0). Second = the standalone property-tested protocol (Phase 1). Backend APIs
additive before old feed APIs are removed; raw legacy service events remain for non-feed consumers (the new
bridge uses causal events). Phase-1 containment stays until the new slices pass unit+component+mocked-e2e+network.
**Under Option 1 the execution side barely changes** — no `SendPrincipal` discriminator, no fence threading, no
`commitSubmission` hook. The only execution-side changes are: (a) the §9 guard (a switch chokepoint reading
`hasInFlightSend`); (b) producers stamping their scope (which they'd do regardless — the slices need it); (c) the
queued-journal account fixes (§10). All existing send paths (`executeTransfer`, dApp sends, `estimateOperationFee`,
simulate) run their current code UNCHANGED except that they now stamp scope on the records they write.
`a6ed183` is evidence only (correlation + fence both excluded). Each internal commit passes targeted
typecheck/tests. `/harden security` is the final blocking review, not a follow-up. The merge condition is not
"tests pass" — it is: no durable producer has an active-scope write API, every ambiguous legacy row fails closed,
every queued claim is composite + serialized, and the guard provably blocks a switch while any send is in flight.

## 18. Critical files
`packages/wallet-core/src/activity/{scope,causal,model}.ts` (new — pure protocol + property tests) ·
`apps/extension/src/wallet/services/activity-protocol/*` (new — durable coordinator/repo) ·
`apps/extension/src/wallet/services/account/{spec,service,repository}.ts` (§6.5 composite re-key — Phase 2a′,
lands first) · `apps/extension/src/stores/activity.store.ts` + `src/activity/source-bridge.ts` (new — slices +
producer bridge) ·
the profile/account-**switch chokepoint** (`Header.vue` + the switch control) reading `hasInFlightSend` from the
journal client (§9 guard) · `wallet-sdk/{queued-journal,background}.ts` + `packages/wallet-bridge/src/
account-resolution.ts` (shared resolver, H1/H2) · `operation-journal/service.ts` (locked mutations, tombstones,
`hasInFlightSend` selector) · `incoming-transfer/{repository,service}.ts` + `transaction/{spec,service}.ts`
(composite keys, scope fields) · `RecentActivityView.vue`/`activity.vue`/`activity-rows.ts` (profile-aware render) ·
`tests/e2e/network/account-profile-siloing.test.ts` (render-isolation + in-flight-guard e2e).
