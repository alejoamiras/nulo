# incoming-public-transfers

Index incoming PUBLIC transfers for the user's added tokens, at parity with the existing
private-note "Received" rows: discover them in the background, run them through the same
per-contract trust machine, render them in the activity feed, and — for BOTH arms, private and
public — durably trigger a token-balance refresh when a receive is discovered. Cursor-based
public-event indexing against the node's tag index; no balance-diff polling.

**Tier**: `mid` (rubric: 0 HIGH dimensions — novelty MODERATE first event-indexer but surface
fully mapped, blast radius MODERATE activity+balances, irreversibility LOW pre-production
storage, migration LOW, external coupling MODERATE one new node API already in our stdlib,
security MODERATE dusting/spam — but spans `aztec-runtime` + extension services + UI, so
`light` is out).
**Companion docs**: [`implementation.md`](implementation.md) (START HERE to implement — state +
every verified lesson + rejected paths) · [`audit-codex.md`](audit-codex.md) (6 codex passes) ·
[`audit-fable.md`](audit-fable.md) (fable audit) · [`eli5.html`](eli5.html) (plain-language +
seeds) · `lessons/phase-N.md` (filled during implementation).
**Baseline**: rebases onto current `origin/dev` (past `68a856a`) to pick up the `price` service
(PR #309, "live usd prices") that D8 consumes. The worktree was cut at `68a856a`; implementation
merges/rebases current `dev` before Phase 4.
**Worktree**: `incoming-public-transfers`.
**Status: REVISED post-conditional-approve with user design decisions (2026-07-22). Audit trail:
fable cond-approve (F1–F14) + codex R1 reject (#1–#10) → final codex R2 reject (8) → R2-followup
reject (3) → R2-followup-2 CONDITIONAL APPROVE (4 conditions, all folded). THEN the user chose:
checkpointed+reconciliation (L9), USD dust filter (L10/D8), the UI detail design (L20–L22/D5), and
IDENTIFIED the pub→priv observability (L19/D7). Focused codex delta-review of those THREE new
surfaces: **reject** — all blockers now resolved: D6 reconciliation folded to codex's exact
prescription (`referenceBlock` in the D1 signature, `lastSyncedBlockHash` + `reconciling` marker
in the cursor row, rewind-to-finalized, full-window-before-delete, enqueue-refresh-before-delete,
private-arm reframed as pre-existing); D3 dust conditions folded (gate order, raise/lower wording,
price spec); D7 (the misattribution blocker) DROPPED by user (Ask 8 → "Received privately", no
sender). D8 price-dependency: user corrected a stale-`dev` check — the `price` service IS on `dev`
(PR #309), so D8 is IN v1 (baseline rebases onto current `dev`), Ask 9 resolved. Final codex
confirm: **CONDITIONAL APPROVE** — two residual D6 crash/reorg races (hash-pin every reconciliation
page via `upperBoundHash`; `pendingPage` marker for the normal-scan record-before-cursor window)
+ D8 precision (`getPriceMapEntry` mapping, cross-multiplication threshold compare) — **ALL FOLDED
into D6/D8/Phase 2**. See ledger L1–L22. **All Asks resolved; READY FOR APPROVAL GATE.**
Fable: conditional approve. Codex: conditional approve.**

## Problem

The wallet's incoming-transfer discovery (`apps/extension/src/wallet/services/incoming-transfer/`)
is 100% PXE-note-based, so it only sees privately-delivered tokens. A public transfer to the
user's address:

- never appears in the activity feed (no note → no record → no row), and
- never refreshes the token balance (nothing enqueues a `TokenBalanceService` job on incoming —
  true for the private arm too: today a discovered private receive shows a "Received" row while
  the balance number stays stale until a manual refresh / own-tx / >30-min-stale unlock).

## Enabling facts (why event indexing, not balance diffing)

The bundled token (`@aztec-foundation/aztec-standards@5.0.1`, exact-pinned in both
`packages/aztec-runtime/package.json:31` and `apps/extension/package.json:55`) emits an
ERC20-style **public `Transfer { from, to, amount }` event** on every public-balance mutation.
Emit map (from the source embedded in `target/token_contract-Token.json`, all 9 emit sites
verified by the fable audit):

| Token function | Event |
|---|---|
| `transfer_public_to_public` | `Transfer { from, to, amount }` |
| `increase_public_balance_internal` (the private→public leg) | `Transfer { from: PRIVATE_ADDRESS_MAGIC_VALUE, to, amount }` |
| `_mint_to_public` | `Transfer { from: 0, to, amount }` |
| `decrease_public_balance_internal` / `transfer_public_to_commitment` | `Transfer { from, to: PRIVATE_ADDRESS_MAGIC_VALUE, amount }` |
| `_burn_public` | `Transfer { from, to: 0, amount }` |

Client-side filter `to == account` therefore catches every public receipt (plain public sends,
private→public sends, public mints) and — crucially — **cannot double-count** with the private
note scanner: a public→private send to us emits `to: PRIVATE_ADDRESS_MAGIC_VALUE` (never our
address) on its public leg, and the private leg arrives as a note the existing scanner owns.
A single tx that delivers BOTH a note and a public transfer to the same user correctly yields
two records (two balance-affecting receipts) under disjoint PKs.

Query primitive: the node's tag index. Public events are tagged
`computeLogTag(eventSelector, DomainSeparator.EVENT_LOG_TAG)` and queried via
`node.getPublicLogsByTags({ contractAddress, tags, fromBlock, toBlock })`
(`node_modules/@aztec/aztec.js/dest/api/events.js`). Pages of `MAX_LOGS_PER_TAG = 20`
(`@aztec/stdlib/dest/interfaces/api_limit.js:5`). Each `LogResult` carries `blockNumber`,
`blockHash`, `blockTimestamp`, `txHash`, `txIndexWithinBlock`, `logIndexWithinTx`
(`@aztec/stdlib/dest/logs/log_result.d.ts`) — unique record key, ordering tuple, chain
timestamp, and reorg-detection anchor, all in one response.

**Important scale property (audit-corrected):** the tag identifies the EVENT TYPE per contract,
not the recipient — a scan pages through ALL `Transfer` events of the contract, every
sender/recipient, and filters `to` client-side. Backfill cost is proportional to the contract's
total transfer count. Fine for alpha traffic; the accepted-limitation + seams story is in
"Detection-lag & scale posture" below.

**We do NOT use the aztec.js `getPublicEvents` sugar directly**: its mapping discards
`txIndexWithinBlock`/`logIndexWithinTx`, and it returns `nextCursor` ONLY on exactly-full pages
(20 logs) — a naive mirror would never advance past a partial tail page. The runtime owns its
own thin mapping over `node.getPublicLogsByTags` + `decodeFromAbi` (kept fields + explicit
scanned-through cursor, D1). Event metadata comes ready-made from the generated
`TokenContract.events.Transfer` (`@aztec-foundation/aztec-standards/dist/src/artifacts/Token.js`):
an `EventMetadataDefinition { eventSelector, abiType, fieldNames }`.

## Scope

In:
- `packages/aztec-runtime`: one new PXE-service RPC — fetch a page of decoded public `Transfer`
  events for `(network, contract)` after an optional cursor, bounded to the checkpointed tip.
- `apps/extension` incoming-transfer service: a second scan arm (public events) built around an
  internal `public-event-indexer.ts` module (paging, cursor validation, reorg policy), per-contract
  cursor persistence, generalized record identity (`kind`-discriminated union), same trust
  machine, same 3-source dedupe.
- Balance wiring: **both arms** (private note + public event) durably trigger a
  `TokenBalanceService` refresh via a small persisted outbox, written adjacent to the record
  (ordered, NOT atomic — EntityStorage is one-key-per-`set`) and acknowledged causally by a
  specific refresh task's completion.
- UI: activity feed keys migrate `siloedNullifier` → `id`; `TransactionIncomingCard` renders
  public receipts at parity with a Private/Public delivery chip.
- Tests at every layer, a live-sandbox integration probe for the new node API in Phase 2, and
  one new network e2e (the behavioral ship gate).

Out (explicit user decisions):
- **Non-standard tokens**: only contracts whose effective class matches the bundled
  aztec-standards Token class are event-scanned (D2); unknown classes degrade to "no public
  detection", silently.
- **Backfill window config**: v1 is full-history, NO settings surface. The cursor row's
  `startBlock` field is the retrofit seam (a future per-token window = data edit + cursor reset,
  no logic change).
- Outgoing public "Sent" rows from events (own txs already produce rows via TransactionService).
- NFTs, MultiToken, private *events* (`offchain` delivery) — notes only.
- Dust/record-growth mitigation (per-(account,token) record caps, feed pagination) — recorded as
  a named fast-follow, not v1 (see Security).

## Design

### D1 — Runtime surface (`packages/aztec-runtime`)

New method on the PXE service (offscreen side) + client + spec + descriptor. Concurrency
wrapper: `withPxeRead` — this is a node-only read with no PXE store mutation (unlike `getNotes`,
which runs `withPxeWrite` because `debug.getNotes` syncs PXE state; `pxe/service.ts:398-400`).

```
getPublicTokenTransferEvents(
  network: NetworkInfo,
  contract: string,
  args: { fromBlock?: number, afterCursor?: PublicEventCursor, referenceBlock?: string },
) → { events: PublicTransferEvent[], scannedThrough: PublicEventCursor | null, hasMore: boolean }
```
- **`referenceBlock` (D6 reorg anchor):** the cursor's `lastSyncedBlockHash`; the node THROWS if
  that block was reorged out (`logs_query.d.ts:33`) → node-driven reorg detection. The signature
  carries it explicitly (codex delta-review #1 — the earlier signature omitted it, so the D6
  mechanism wasn't representable). (No `byTx` enrichment mode — D7 was dropped, Ask 8.)

- `PublicTransferEvent` (wire, all-JSON): `{ from: string, to: string, amountRaw: string,
  txHash: string, l2BlockNumber: number, blockHash: string, blockTimestamp: number,
  txIndexWithinBlock: number, logIndexWithinTx: number }`.
- `PublicEventCursor` (wire): `{ blockNumber: number, txIndexWithinBlock: number,
  logIndexWithinTx: number }` — round-trips through `LogCursor`'s zod schema.
- **`scannedThrough` semantics (audit F4/codex#3):** the position of the LAST log in the
  returned page — full or partial — or `null` when the page is empty. The caller persists
  `scannedThrough`, never upstream's full-page-only `nextCursor`. `hasMore` mirrors
  "page was full" so the caller can loop within its budget.
- **`fromBlock`** exists so the cursor row's `startBlock` seam is actually usable (codex #3).
- **`toBlock` = checkpointed tip + 1** (reorg policy, D6 — user chose `checkpointed` over
  `finalized` for latency, 2026-07-22): the implementation resolves the bound via
  `node.getBlockNumber("checkpointed")` — a plain `BlockNumber` (`aztec-node.d.ts:145`) — NOT
  arithmetic on the structured `getChainTips()` `L2TipId` values (codex delta-recheck #1). Bounds
  the query `toBlock = checkpointed + 1` (EXCLUSIVE upper bound — `logs_query.d.ts:24` — so `+1`
  includes the checkpointed tip block itself). Checkpointed = "latest block whose enclosing
  checkpoint has been published on L1" — seconds of latency, but NOT irreversible (can still
  reorg), which is why D6 adds reconciliation. `node.getBlockNumber("finalized")` gives the D6
  rewind watermark.
- **Reorg-safety anchor (D6):** the caller passes `referenceBlock = <last-synced block hash>`
  (`logs_query.d.ts:33`, "if set and the block is no longer present, the call throws"). The node
  itself detects a reorg that dropped our anchor and throws — no polling, no bespoke reorg
  engine. The cursor row persists this anchor hash; recovery on throw is in D6.
- **Hostile-response validation (codex #3/#4):** the offscreen side rejects pages whose logs are
  not strictly increasing in `(blockNumber, txIndexWithinBlock, logIndexWithinTx)`, whose
  positions are ≤ `afterCursor`, or whose `blockNumber` exceeds the checkpointed tip — any
  violation drops the page with a warn (no cursor advance, no records). A malformed individual
  log is skipped with a warn, never thrown (per-item isolation, mirroring
  `note/service.ts:98-129`). Response zod-validation lives where the trust boundary is: the
  SW-side `client.ts` schemas (the descriptors pattern), with the offscreen side additionally
  zod-parsing node input.
- Tag computation memoized at module level; `u128` amounts stringify via `BigInt(...).toString()`.

### D2 — Contract-class gate (standard tokens only)

Before scanning a contract, resolve its CURRENT class **node-direct** — NOT through the
`getContractInstance` cascade — and compare against the bundled Token contract-class id
(computed once from the aztec-standards artifact). Rationale (codex R2 #3, verified at
`pxe/service.ts:268-275`): the cascade's PXE-preimage hit short-circuits before the node is
consulted, and registered tokens ALWAYS hit the preimage path — so the cascade reports the
ORIGINAL class and never throws `ContractUpgradedError` for an upgraded registered token. The
gate therefore calls `node.getContract(address, "finalized")` itself
(`getContract(address, referenceBlock?)` verified at `aztec-node.d.ts:377`) and compares the
actual current class id against the bundled original — rejecting `current != original`. **Anchor
freshness (codex R2-followup #3):** the result is cached keyed by the FINALIZED TIP (block
number/hash), NOT per service epoch — so a finalized contract upgrade (class change) is
re-detected on the next finalized-tip advance and the scan stops, rather than a stale
epoch-memoized "match" scanning an upgraded contract forever. Cost: one node call per contract
per finalized-tip change (cheap; finality advances slowly). Non-matching, upgraded, or
unresolvable class → no public scan for that contract (fail closed, log once at debug).

### D3 — Service arm (`incoming-transfer`)

**Module split (codex #8 hybrid, adopted as code organization):** a new
`public-event-indexer.ts` inside the service directory owns the RPC paging loop, cursor
validation/advance, page budget, and reorg-recovery policy — a plain injected-collaborator
class, unit-testable in isolation. `IncomingTransferService` remains the SOLE writer of records,
trust, cursors, and the outbox; the indexer returns decoded+validated events and proposed
cursor advances, it never touches storage.

**Scheduler split.** Note scans stay per `(networkId, accountAddress)`. The public scan is per
`(networkId, contract)` — ONE event stream serves every account (`to` fans out client-side). A
second scheduler map keyed `(networkId, contract)` ticks on the same `DEFAULT_POLL_INTERVAL_MS`
(30s), rebuilt by the same `hydrateSchedulers` lifecycle, inside the same `serviceLock` /
`serviceEpoch` discipline. (MV3 note: `setInterval` in the SW is exactly as reliable here as for
the existing note arm — ticks stop when the SW sleeps and resume on the popup-open kick; parity,
not a new regression. An `chrome.alarms` upgrade would serve both arms and is out of scope.)

**Pre-lock filtering (codex #1, adopted):** each fetched page is filtered to events whose `to`
is one of the active profile's accounts on that network BEFORE any lock acquisition.
Non-matching events (the vast majority on a busy token) only advance the cursor. Lock
acquisitions ≈ actual receipts, so a busy token cannot starve note scans or user trust actions.

**Cursor rows.** New EntityStorage table `nulo:core:incoming-public-cursors` keyed
`${profileId}|${networkId}|${contract}` holding
`{ cursor: PublicEventCursor | null, lastSyncedBlockHash: string | null,
lastScanFinalized: number | null, startBlock: number,
pendingPage?: { fromCursor: PublicEventCursor | null, toScannedThrough: PublicEventCursor,
upperHash: string },
reconciling?: { lowerBound: number, upperBound: number, upperBoundHash: string,
progress: PublicEventCursor | null, seen: Array<[height: number, blockHash: string]> } }`.
`startBlock = 0` in v1 (retrofit seam); `lastSyncedBlockHash` is the D6 reorg anchor (passed as
`referenceBlock`); `lastScanFinalized` is the D6 rewind floor (finalized tip at the last
successful scan — NOT current, codex delta-recheck #1); `pendingPage` closes the normal-scan
record-before-cursor crash window (codex final-confirm #1b — persisted BEFORE record writes,
reconciled on resume); `reconciling` is the STAGED resumable marker (`upperBoundHash` pins the
fork so a mid-reconcile reorg is caught, codex final-confirm #1a). **Cursor persistence rules
(audit F4/F5, codex #3):**
- The cursor is written ONLY inside the serviceLock, guarded by the same `epochAtStart` check
  as record commits — an in-flight page cannot clobber a concurrent reset (account-add,
  clear, token delete).
- Persisted value := `scannedThrough` of a page whose matching events have ALL been committed
  (records + outbox in the same locked section). Partial pages advance the cursor (F4).
  Budget exhaustion mid-scan simply leaves `hasMore` work for the next tick.
- Crash between record commit and cursor write → re-delivery next tick → idempotent upsert by
  PK. At-least-once, converging.
- **Normal-scan reorg-safety (codex final-confirm #1b).** Advancing the cursor is not enough:
  after writing a page's records but before the cursor advance, a crash + reorg would leave those
  records on a since-orphaned fork while `lastSyncedBlockHash` still points at the OLD (still-
  canonical) position — so no future `referenceBlock` throw ever flags them. Fix: write
  `pendingPage = { fromCursor, toScannedThrough, upperHash: <blockHash of the page's top block> }`
  BEFORE the record writes; advance the cursor + CLEAR `pendingPage` after. On startup/resume, if
  `pendingPage` is set, reconcile that exact range first (re-query it with `referenceBlock =
  upperHash`; on throw, the page reorged → run D6 recovery for the range) before normal scanning.

**Cursor lifecycle (audit F1/F5, codex #5):**
- `onTokenDeleted`: the cursor row for `(profileId, networkId, contract)` is DELETED inside the
  same locked section that wipes records + resets trust — re-add re-indexes public history from
  `startBlock`, preserving the note arm's documented remove/re-add parity.
- `onAccountAdded`: cursor reset to `null` (rescan from `startBlock`) so the new account's
  historical receipts are discovered; reset inside the lock, epoch bumped (the existing
  `hydrateSchedulers` bump covers it — the reset happens there).
- `clearProfile` / `clearChain` / chain-purge subscriber: cursor rows wiped with records.

**Record identity (audit F3, codex #2).** `IncomingTransferRecord` becomes a zod DISCRIMINATED
UNION on `kind`:
- Common: `id` (NEW primary key + storage key), `kind`, `profileId`, `networkId`,
  `accountAddress`, `contract`, `tokenId?`, `amountRaw`, `txHash`, `l2BlockNumber`,
  `txIndexInBlock`, `indexInTx` (renamed from `noteIndexInTx`; holds `noteIndexInTx` for notes,
  `logIndexWithinTx` for public events — different index spaces, so mixed-pair within-tx
  ordering is arbitrary; spec comment says so), `hidden`, `discoveredAt`, `blockTimestamp?`.
- `kind: "note"`: `siloedNullifier` (required), `noteHash` (required), `owner`.
  `id = note:${profileId}|${networkId}|${siloedNullifier}`.
- `kind: "public-event"`: `from` (required; `PRIVATE_ADDRESS_MAGIC_VALUE` sentinel = "from
  private", zero-address = mint), `blockHash` (required; reorg anchor).
  `id = pub:${profileId}|${networkId}|${txHash}|${logIndexWithinTx}`.
Both ids are profile+network scoped (F3: same seed in two profiles / two networkIds on one
chainId can no longer collide; the note arm's latent bare-`siloedNullifier` collision is fixed
in the same rewrite). Pre-production: NO storage migration (CLAUDE.md rule); zod schemas updated
in place; e2e seed fixtures updated in the SAME phase (F12).

**Per-event flow** (only for pre-filtered matching events): per-event locked commit → epoch
check → live token re-read → 3-source dedupe (existing records by `id`, own outgoing tx hashes,
in-flight journal `progress.txHash`) → trust read (same `unknown → pending` first-receive
transition, same `hidden` semantics, same `onIncomingTransferPending` coalescing) → write outbox
row THEN upsert record (D4 ordering — EntityStorage is one-key-per-`set`, NOT multi-key atomic,
so ordering + idempotent replay substitute for a transaction, codex R2 #1) →
`onIncomingTransferAdded` when trusted+visible. `blockTimestamp` comes from the event itself
(F10) — NO `getBlockTimestamp` backfill RPC for public records.

**Self-send + late-delete.** Own public sends dedupe by txHash (same as private change-notes).
The late-delete reconciliation (`onTransactionAdded`) extends to public-kind records via the
same `listByTxHash` + accountAddress match, unchanged logic.

### D4 — Balance wiring: persisted outbox with CAUSAL task-anchored acknowledgement

New EntityStorage table `nulo:core:incoming-balance-outbox`, rows keyed
`${profileId}|${networkId}|${accountAddress}|${tokenId}` (natural coalescing — N receipts for
one balance = one row) holding `{ dirtyAt: number, pendingTaskId?: string }`.

- **Write ordering (codex R2 #1 — EntityStorage writes one key per call, NOT multi-key
  atomic):** the outbox row is written BEFORE the record row, both inside the locked section,
  for BOTH kinds, regardless of trust state (a hidden/pending receive still changed the
  chain-factual balance; trust gates display, not facts). Crash between the two writes → the
  event re-delivers next tick (cursor hasn't advanced) and the record upserts; an outbox row
  without a record is a harmless extra refresh. Ordered write + idempotent replay give
  at-least-once WITHOUT a transaction (no "atomic" claim anywhere).
- **Causal task-anchored ack (codex R2-followup #1 — a plain `updatedAt > dirtyAt` compare is
  NON-causal: an OLDER refresh, enqueued before this receipt, can read stale chain state yet
  write its `updatedAt` after `dirtyAt`, falsely acking a receipt it never included).** The
  `BalanceJobQueue` already mints a TaskService task per balance on enqueue
  (`balance-job-queue.ts:80-81`, terminal via `completeTask`/`failTask`), BUT it COALESCES: a
  second enqueue while balance X's task is pending REUSES the existing task id. A naive anchor
  would reintroduce the non-causal gap through that door — task T1 (created for receipt A) can
  complete on pre-B chain state, yet B, having reused T1's id, would false-ack (codex
  R2-followup-2 #1, a gap the planning agent flagged and codex confirmed real). The fix
  (codex's minimal form):
  - `TokenBalanceService` exposes `requestBalanceRefresh(tokenId, accountAddress) →
    { taskId } | { busy: true }`: it attaches + returns a task id ONLY when it creates a FRESH
    task; if balance X already has a pending/processing task it enqueues the re-projection
    (so the value still refreshes) but returns `busy` WITHOUT a task id.
  - A new receipt for an existing row OVERWRITES `dirtyAt` and CLEARS any prior `pendingTaskId`
    (the old anchor is now stale w.r.t. the newer receipt).
  - Drain pass (`init` AND every scan tick), per row: no/ cleared `pendingTaskId` → call
    `requestBalanceRefresh`; on `{ taskId }` persist it + KEEP row; on `{ busy }` KEEP row with
    no anchor (a later drain, after the in-flight task finishes, creates a FRESH post-`dirtyAt`
    task T2 and anchors to it). `pendingTaskId` + terminal-SUCCESS → that task was created FRESH
    strictly after this row's `dirtyAt`, so its projection read chain state including the
    receipt → delete the row. Causal. `pendingTaskId` + terminal-FAILURE/MISSING → clear +
    re-request.
  - **Drain is ACTIVE-PROFILE-SCOPED** (codex R2-followup-2 #1): only the active profile's
    outbox rows are drained — `TokenBalanceService`'s token/balance map is active-profile-only,
    so draining a foreign profile's row could look up a missing balance and false-classify it as
    stale. Inactive-profile rows wait until that profile is active (their receipts were already
    persisted; the refresh is not time-critical while the profile is backgrounded).
  SW death at any point loses nothing (init drain re-requests); pull-based, so no event-order or
  startup-subscription race. `IncomingTransferService` gains `TokenBalanceService.name` +
  `TaskService.name` in `dependencies` (verified acyclic; this direction also starts TokenBalance
  first). Task terminal state is read via `TaskService` (the queue's own ledger — the outbox does
  NOT duplicate retry bookkeeping, it only anchors the ack).
- **Stale rows (codex R2 #5):** `onTokenDeleted` / `onAccountDeleted` purge matching outbox rows
  in their locked sections; the drain additionally tolerates rows whose token/balance no longer
  exists — it looks up the balance row FIRST and classifies+deletes rather than calling
  `requestBalanceRefresh` (which would throw on a missing balance record).
- Purge fan-out: outbox rows wiped in `clearProfile`/`clearChain`.

### D5 — UI: dedicated detail view + identity propagation (design decisions A–D)

Design settled with the user (2026-07-22) against the `received-detail-design` artifact.

- **Phase-2-coupled identity propagation (codex R1 #10 + R2 #6, verified):** THREE independent
  keying sites move to `inc.id` in the SAME phase as the record rewrite: `activity-rows.ts:72`
  (`key: incoming:${inc.siloedNullifier}`), `useIncomingTransfers.ts:62/67/71` (dedupe), AND
  `RecentActivityView.vue:109` (SEPARATE row-builder; codex R2 #6). Phase 2 greps `siloedNullifier`
  repo-wide as the completeness check and names every hit in its test list.
- **Decision A — dedicated detail route.** New `/popup/received/:id` page (built off
  `tx/[id].vue`'s hierarchy), replacing today's redirect-to-token-page for incoming rows
  (`TransactionsList.vue:52-71`). `incomingCardProps` (`:73-81`) is widened to thread
  `id, kind, type, from, blockHash` (today only `{tokenSymbol, amountRaw, tokenDecimals, txHash}`).
- **Decision B — the "From" card always shows, stating the truth.** Content by resolved type:
  a real address (pub→pub only), a "From private" sentinel pill (priv→pub, `from = MAGIC`), or a
  redaction treatment "sender not disclosed" (BOTH note kinds — priv→priv and pub→priv, since D7
  was dropped). Never renders the MAGIC/zero sentinel as a raw address. (Redaction visual is
  PROVISIONAL — built with real `@nulo/design` components and re-reviewed; the user didn't love
  the artifact's hatch.)
- **Decision C — always link the tx hash (user override of the draft's "link only when
  meaningful").** The "View on {explorer}" link renders for ALL received types whenever an
  explorer URL exists (mainnet/testnet). SANDBOX (chainId 0) has no base URL in
  `wallet/constants/explorers.ts` → copy-hash there regardless (hard constraint, not a choice).
  Consistency with sent-tx UI is the user's stated priority; the honest caveat (a private tx's
  explorer page shows only the public shell) is accepted.
- **Decision D — THREE receiver-honest labels** (D7 dropped, so pub→priv isn't distinguished):
  "Received privately" (BOTH note kinds), "Public → Public", "Private → Public", plus "Minted"
  (`from = 0`). `data-testid="tx-incoming-kind-chip"`. Chip label is derived from the resolved
  type, not the raw record.
- Card testid `tx-incoming-card` preserved verbatim.

Explorer-link scope note: only a `tx-effects/{txHash}` URL builder exists — no block / contract /
account URL builders. Block hash, token contract, and your own address stay COPY-only in the
detail view until builders are added (named follow-up, not v1).

### D7 — pub→priv sender: DROPPED (user decision, Ask 8, 2026-07-22)

The user identified that a pub→priv debit leg IS observable — `transfer_public_to_private(from,…)`
enqueues `decrease_public_balance_internal(from,…)` emitting `Transfer{from:<sender>, to:MAGIC,
amount}` in the SAME tx, while `transfer_private_to_private` emits no public log (verified in
token source). BUT the codex delta-review proved the ATTRIBUTION is unprovable: one tx can carry
a priv→priv note (amount X) to us AND an unrelated pub→priv transfer (amount X) to a THIRD party —
observationally identical, but the public leg did NOT fund our note. No on-chain link exists
between a public debit event and a specific note commitment (`includeEffects` gives the tx's
note-hash set, not a leg→note mapping). So a recovered sender could only ever be an unverified
hint, and the user chose to **DROP it** rather than surface a spoofable address.

Consequence: pub→priv is NOT distinguished from priv→priv. Both are note-kind records shown as
"Received privately" with the sender redacted ("sender not disclosed"). No same-tx lookup, no
`byTx` RPC mode, no enrichment cache — the note arm's display is unchanged from today apart from
the shared identity/record rewrite. This paragraph stays as institutional knowledge: the reason
pub→priv can't be labeled distinctly is an attribution gap, not an oversight.

### D8 — USD-value dust filter (settings; user decision 2026-07-22; price dependency VERIFIED present)

A user-configurable display filter, replacing v1's "accept the dust residual". A new
`ValueStorage` config key `incomingDustUsdThreshold` (default `0` = off) under Settings. A
received record is filtered from the activity feed at READ time (`getIncomingTransfers`).

**Price dependency — PRESENT on `dev` (corrected).** The `price` service shipped to `dev` via
squash PR **#309 "feat(prices): live usd prices, fiat send input, default token seeding"**
(`apps/extension/src/wallet/services/price/`). Its surface (verified on `origin/dev`):
`PriceService` (name `"price"`) with `getQuotes()` + `refreshIfStale()` returning `PriceState =
Record<coingeckoId, PriceQuote>`; `PriceQuote { coingeckoId, usd, fetchedAt, providerUpdatedAt }`;
the single freshness rule `isQuoteFresh` (`QUOTE_TTL_MS = 15min`, uses the older of fetch/provider
time); `onQuotesUpdated` event; integer **micro-USD** arithmetic in `price/convert.ts`
(`rateToMicroUsd`, `USD_MICRO_PER_USD = 1e6`) — no float drift. (This is a baseline bump: see
"Baseline" — the worktree branched from `68a856a`, which predates #309; implementation rebases
onto current `origin/dev` to pick up the `price` service. An earlier draft wrongly called this
dependency absent — it was a stale-local-`dev` check.)

- **USD computation (codex final-confirm #2, verified):** map the token via
  `getPriceMapEntry(chainId, contract)?.coingeckoId` (`price/price-map.ts:54` — the (chainId,
  lowercase-contract) → entry map; arbitrary token metadata does NOT carry CoinGecko ids) →
  `getQuotes()[coingeckoId]`; if fresh (`isQuoteFresh`), value uses the `convert.ts` micro-USD
  integer path. **Threshold comparison by CROSS-MULTIPLICATION** — compare `amountRaw × rateMicro`
  against `thresholdMicro × amountScale` as integers, avoiding any half-up value rounding at the
  boundary (the alternative — round the value to micro-USD and compare — carries a ±0.5 micro-USD
  ambiguity; cross-multiplication is exact).
- **Gate ORDER (codex delta-review #3):** apply `incomingTransfersVisible` and per-record `hidden`
  FIRST; the dust filter runs LAST and a price failure must NEVER bypass those two gates.
- **Display-only, records still persisted** — RAISING the threshold hides MORE receipts; LOWERING
  it re-reveals. (The chain fact is never dropped.)
- **Fail OPEN:** a token with no CoinGecko mapping OR only a stale quote (`!isQuoteFresh`) → cannot
  compute USD → **shown**, and the row/detail MARKS pricing unavailable so the user knows it
  wasn't dust-filtered.
- **Refresh triggers:** re-evaluate the filter on `onQuotesUpdated` AND on a threshold-config
  change (both re-run the read-time filter; records are already persisted).
- **Scope honesty:** COSMETIC feed filter — does NOT cap storage. It also does NOT gate the D4
  balance-refresh outbox: a dust-filtered receipt still enqueues its balance refresh (balances are
  chain facts, independent of display). The per-(token,account) record CAP stays a separate named
  fast-follow.

### D6 — Reorg / finality policy: CHECKPOINTED + reconciliation (user decision, 2026-07-22)

**v1 policy: index to the CHECKPOINTED tip, with reorg reconciliation.** The user chose
`checkpointed` over `finalized` (fable F2 / codex R1 #4 / R2 #2 flagged finality as an unstated
decision; `finalized` was the conservative default). Rationale: `finalized` lag (L1 finality,
minutes on testnet) is too slow for a receive notification; `checkpointed` ("enclosing
checkpoint published on L1", `l2_block_source.d.ts:287`) is seconds — within the user's ≤~15s
budget. The cost is that checkpointed is NOT irreversible, so reorgs are back in scope and MUST
be reconciled. Reconciliation leans entirely on node-provided facilities — it is NOT a bespoke
reorg engine (the `L2BlockStream` `chain-pruned` event stream exists but is infra plumbing
requiring a local tips store, not a wallet-client subscription):

- **Bound:** `toBlock = node.getBlockNumber("checkpointed") + 1` (EXCLUSIVE upper bound).
  `getBlockNumber(tag)` returns a plain `BlockNumber` — do NOT do arithmetic on the structured
  `getChainTips()` `L2TipId` values (codex delta-recheck #1). `getBlockNumber("finalized")` gives
  the finalized watermark below.
- **Persisted finalized watermark (codex delta-recheck #1 — the key fix).** Each SUCCESSFUL scan
  records `lastScanFinalized = getBlockNumber("finalized")` at scan time into the cursor row. This
  is the rewind floor — NOT the *current* finalized tip. Why: after extension downtime, a reorged
  receipt's block H can have been re-finalized on the replacement chain before restart; rewinding
  to the *current* finalized (> H) would skip the orphan at H and strand it. `lastScanFinalized`
  is ≤ H's era for every reversible record we hold, so it covers them all.
- **Detection (node-driven, zero polling):** every scan page passes `referenceBlock =
  cursor.lastSyncedBlockHash` (D1). If that block was reorged out, the node THROWS
  (`logs_query.d.ts:33`) — authoritative, at query time. A backward move of the checkpointed tip
  between ticks is a secondary signal.
- **Recovery protocol (crash-safe + resumable across ticks, codex delta-review #1 +
  delta-recheck #1):**
  1. Resolve the window `[lastScanFinalized + 1 .. checkpointed]` AND pin its top block hash
     (`upperBoundHash`, codex final-confirm #1a). Write the staged marker `reconciling = {
     lowerBound, upperBound, upperBoundHash, progress, seen: <canonical (height→blockHash) so
     far> }` BEFORE any mutation. The marker carries the window bound + fork pin + staged progress
     + accumulated hashes, so a crash / MV3 tick boundary mid-comparison RESUMES from `progress`
     rather than losing `seen` or restarting.
  2. Page the window to completion, passing `referenceBlock = upperBoundHash` on EVERY
     reconciliation page (codex final-confirm #1a): if ANOTHER reorg lands mid-reconcile, the node
     throws → DISCARD the staged `seen`/`progress` and RESTART reconciliation against the fresh
     tip, so `seen` can never mix blocks from two forks. Network paging OUTSIDE the lock; each
     `progress`/`seen` advance committed UNDER the lock with the `epochAtStart` recheck. Decide
     deletions ONLY after the window is fully scanned.
  3. For each persisted public record in the window whose stored `blockHash` is NOT the canonical
     hash at its height: **enqueue its `(token, account)` balance refresh to the D4 outbox FIRST,
     THEN delete the record** (delete-first would lose the refresh on MV3 suspension), emitting
     `onIncomingTransferDeleted`. Re-insert canonical events (idempotent PKs). Clear `reconciling`.
  Deletions are decided SOLELY by `blockHash` canonicality — the pre-lock recipient filter never
  drives a deletion.
- **`blockHash` is the reconciliation key** — persisted on every public record AND as the
  cursor's `lastSyncedBlockHash` anchor; `lastScanFinalized` is the rewind floor.
- **Cursor-error recovery (pruned history / node endpoint swap):** same protocol — the node
  throws, we rewind to `lastScanFinalized` (or `startBlock` if that is itself unavailable) and
  rescan; idempotent PKs make replay safe.
- **Private (note) arm — pre-existing behavior, unchanged (codex delta-review #1).** This plan
  does NOT claim notes are reorg-exempt. Our note records are COPIES in `nulo:core:incoming-
  transfers`; a PXE-pruned note does not, today, delete our copied row — that is a PRE-EXISTING
  property of the shipped note scanner, out of scope here. `note_dao` carries `l2BlockHash` for
  the PXE's own note reorg handling; whether to reconcile our copied note rows against it is a
  SEPARATE follow-up, explicitly not solved (and not regressed) by this plan.

### Detection-lag & scale posture (codex #1 — accepted limitation, documented)

Steady state: 1 near-empty node call per (network, contract) per 30s tick; new receipts appear
within one tick + checkpoint-publish lag. Backfill: 5 pages/tick budget = ≤100 events per 30s of SW uptime,
paging the contract's TOTAL transfer history (not just ours). A token with millions of historical
transfers backfills for a long time (and account-add restarts it — the reset-on-account-add is
the correctness-over-speed choice). This is explicitly accepted for the alpha's traffic and NOT
a production SLA; the named seams if it ever hurts: raise/adapt the page budget, set
`startBlock` (the retrofit), or per-account cursors. No recipient-indexed query exists in the
node API today (verified: `getPublicLogsByTags` is the only public-log query on the interface).

## Phases

### Phase 1 — Runtime: public Transfer events RPC ✓

**✓ COMPLETE** (validation gate green: `bun run --cwd packages/aztec-runtime test` = 119 passed
incl. 20 new `public-events.test.ts`; `bun run lint` exit 0; `bun run typecheck:all` exit 0). All
named tests present + passing. Lessons: `implementations-plan/incoming-public-transfers/lessons/phase-1.md`.

`packages/aztec-runtime`: `getPublicTokenTransferEvents` (D1) on service/spec/client/descriptors,
Transfer `EventMetadataDefinition` import, Token contract-class-id constant, node-direct
`getContract`-based class resolution helper (D2), checkpointed-tip bounding + `referenceBlock` anchor, hostile-page
validation. Unit tests (named in the gate): tag memo; fixture-page decode incl. `from`-sentinel
variants; malformed-log skip; NON-monotonic page rejection; cursor-beyond-checkpointed-tip
rejection; partial-page `scannedThrough` correctness; empty-page `null`; `fromBlock` honored;
cursor zod round-trip; class-id constant matches the bundled artifact; upgraded-class →
gate-fails-closed (node-direct, not preimage).

**Validation gate**
- Commands: `bun run --cwd packages/aztec-runtime test && bun run lint && bun run typecheck:all`
- Pass: exit 0; the tests named above present and green (reviewer greps the file for
  `scannedThrough`/`monotonic` cases).
- Layers: typecheck/lint · unit.

### Phase 2 — Service: indexer module, scan arm, cursors, record identity, UI keying ✓

**✓ COMPLETE** (gate green: `bun run audit:vue` exit 0 — typecheck:all/test[287 files, 3456]/lint/build;
`bun run e2e:agent -- public-events-capability.test.ts` = 3 passed against the live sandbox). 37 new
public-arm scenario tests + 10 indexer unit tests, all named scenarios present. Lessons:
`implementations-plan/incoming-public-transfers/lessons/phase-2.md`.

`apps/extension`: `public-event-indexer.ts` module; `(networkId, contract)` scheduler;
pre-lock filtering; cursor table + persistence rules + lifecycle (token-delete, account-add,
purges); record discriminated union + scoped `id` PK; class gate wiring; late-delete extension;
**UI identity propagation** (`activity-rows.ts`, `useIncomingTransfers.ts`, grep-verified rest);
**e2e seed fixtures updated to the new shape** (F12). Scenario tests (named in the gate):
public first-receive pending flow; dedupe vs own outgoing public tx; **partial-page cursor
advance (next tick fetches nothing)**; **mid-backfill account-add reset (interleaved, not
quiescent)**; **token delete → re-add rediscovers public history**; chain-purge/profile-switch
mid-page epoch bail; page-budget resume; MAGIC/zero `from` handling; non-standard-class no-scan;
same-tx note+public double record; **reorg reconciliation (D6) — `referenceBlock`-throw detection;
rewind to the PERSISTED `lastScanFinalized` watermark (NOT current finalized — the downtime case
where a reorged block re-finalized below the current tip must still be revisited); FULL-window
rescan before any delete; orphan deletion (stored `blockHash` ≠ canonical hash at height) enqueues
the balance refresh BEFORE deleting; STAGED `reconciling` marker resumes a multi-tick/crashed
comparison from `progress` (not restart, not lost `seen`); **mid-reconcile reorg → `upperBoundHash`
`referenceBlock` throw → discard+restart, no cross-fork `seen` mixing (codex final-confirm #1a)**;
**normal-scan `pendingPage` crash window — records written, crash+reorg before cursor advance →
resume reconciles the pending range via its `upperHash` (codex final-confirm #1b)**; deletions
never driven by the recipient filter; checkpointed-tip-regression between ticks handled**.

**Node-API capability probe (codex R2 #4 — corrected placement).** The draft's
`describe.skipIf` SOURCE test would never actually run — `audit:vue` runs `src/**/*.test.ts`
with no sandbox, and `e2e:agent` runs ONLY `tests/e2e/network/**`, so a skipped source test is
never re-executed by the network runner. Instead: a FAIL-LOUD capability test
`tests/e2e/network/public-events-capability.test.ts` that calls `getPublicTokenTransferEvents`
against the live sandbox node and asserts a well-formed (possibly empty) page — executed
EXPLICITLY in this phase's gate, not deferred to Phase 5. This proves the node serves
`getPublicLogsByTags` (Inference 3) BEFORE the deep service integration is trusted.

**Validation gate**
- Commands: `bun run audit:vue && bun run e2e:agent -- public-events-capability.test.ts`
- Pass: exit 0; ALL scenario tests named above present and green (pass criterion includes the
  named list, not just a green suite); the network-suite capability probe passes against the
  live sandbox.
- Layers: typecheck/lint · unit · build · network-e2e (capability probe only).

### Phase 3 — Balance wiring: persisted outbox (both arms) ✓

**✓ COMPLETE** (gate green: `bun run audit:vue` exit 0 — typecheck:all/test[287 files, 3468]/lint/build).
11 named drain tests + the queue seam unit test, all present. The outbox WRITE-side landed in Phase 2;
this delivered the causal task-anchored DRAIN. Lessons:
`implementations-plan/incoming-public-transfers/lessons/phase-3.md`.

Outbox table + locked-section writes (outbox-BEFORE-record ordering, note arm AND public arm) +
`requestBalanceRefresh(tokenId, account) → {taskId}|{busy}` on `TokenBalanceService` (fresh-task
attach only) + init/post-tick causal-ack drain (ACTIVE-PROFILE-SCOPED) + `TokenBalanceService`/
`TaskService` dependencies + token/account-delete + purge fan-out (D4). Unit tests (named):
outbox written regardless of trust state; coalescing (N records → 1 row); **row deleted ONLY on
its pendingTaskId's terminal-SUCCESS, NOT on enqueue-return**; **in-flight-coalescing interleave
— T1 processing → receipt B arrives (reuses T1 in the queue) → T1 succeeds → B's row REMAINS
(no anchor, `busy`) → fresh T2 succeeds → B's row deletes** (the exact non-causal gap codex
flagged); new-receipt-clears-prior-anchor + overwrites `dirtyAt`; task terminal-FAILURE/MISSING
→ re-request; **active-profile-scoped drain does NOT touch/delete a background profile's row**;
drain-on-init after simulated SW death (row survives, task re-requested); stale-row tolerance
(token deleted → drain looks up balance first, classifies + deletes, never throws); private-arm
parity (a discovered note refreshes too); token/account-delete + purge wipe rows.

**Validation gate**
- Commands: `bun run audit:vue`
- Pass: exit 0; the named outbox tests present and green.
- Layers: typecheck/lint · unit · build.

### Phase 4 — UI: received detail view + dust filter ✓

**✓ COMPLETE** (gate green: `bun run audit:vue` exit 0 — typecheck:all/test[290 files, 3501]/lint/build;
`bun run test:e2e` exit 0 — 23 files / 80 tests passed, 1 file / 6 skipped, 320s, built + run with CI's
smoke env `VITE_NULO_E2E_DEFAULT_NET=testnet` + migration fixture armed per `_smoke-e2e.yml`). The named
component/unit tests are present + green (chip per resolved type; From card per type; testid pins;
always-link vs sandbox copy-hash; dust filter raise/lower/fail-open/never-bypass-visibility;
getIncomingTransferById unfiltered; composable re-fetch on quotes + threshold). Smoke-triage (a build-env
mismatch decoy, not this phase's code) logged in `lessons/phase-4.md`.

Substantially larger than the original "add a chip" (design settled with the user against the
`received-detail-design` artifact, 2026-07-22):
- **Detail route (D5-A):** new `/popup/received/:id` page off `tx/[id].vue`'s hierarchy; widen
  `incomingCardProps` + `TransactionsList` routing to open it (was: redirect to token page).
- **Honest From + three labels (D5-B/D):** From card content = address (pub→pub) / "From private"
  (priv→pub) / redaction (both note kinds); three receiver-honest chips + "Minted";
  `tx-incoming-kind-chip` testid; `tx-incoming-card` preserved.
- **Always-link explorer (D5-C):** link the tx hash on all types where an explorer URL exists;
  copy-hash on sandbox.
- **Dust filter (D8):** `incomingDustUsdThreshold` settings row + read-time USD filter in
  `getIncomingTransfers` via the `price` service (`getQuotes` + `isQuoteFresh` + `convert.ts`
  micro-USD), applied AFTER the `visible`/`hidden` gates; fails open (+ "price unavailable"
  marker) on missing mapping or stale quote; re-evaluates on `onQuotesUpdated` + threshold change.
Component/unit tests (≥10): chip per resolved type; From card per type (address / "From private" /
redaction, incl. both note kinds redacted); testid pins; always-link vs sandbox copy-hash; mixed
note/public ordering; dust filter — RAISING threshold hides MORE, LOWERING re-reveals, fails open
(shown + marked) on no-mapping AND on stale quote, never bypasses `visible`/`hidden`.

**Validation gate**
- Commands: `bun run audit:vue && bun run test:e2e`
- Pass: exit 0 on both; the named component/unit tests present and green; smoke suite green
  (UI render paths with the Phase-2-updated fixtures).
- Layers: typecheck/lint · unit/component · build · smoke e2e.

### Phase 5 — Network e2e (behavioral ship gate)

New `apps/extension/tests/e2e/network/incoming-public-transfers.test.ts` (harness patterns from
`token-add-auto-trust.test.ts` / `incoming-transfers.test.ts`, parallel-safe runner): second
account sends `transfer_public_to_public` to the wallet account → assert (a) trust behavior per
the token-add path, (b) `tx-incoming-card` row with the Public chip testid, (c) the token's
public balance updates WITHOUT a manual refresh click (the D4 pin). Second case: private→public
leg (`from: MAGIC` → "Private → Public" chip). Third case: **pub→priv — a second account does
`transfer_public_to_private` to us → the row shows "Received privately" with the sender redacted
(D7 dropped; no sender, no hint).** Fourth case: SW-restart mid-flow still converges (cursor +
outbox recovery, reusing the suite's existing sw-restart helpers if stable). Fifth case (if
feasible in the harness): a forced checkpointed reorg → a since-reversed public receipt's row is
reconciled away and its balance re-refreshed (D6).
**Timeout (codex R2 #7):** the default 30s test timeout EQUALS the scheduler interval, so a
receipt assertion could time out on the very first idle tick. Receipt/balance assertions get an
explicit ≥120s wait budget (the sandbox checkpoints ~instantly, so the scheduler cadence — not
finality — is the pacing factor); prefer a deterministic poll-trigger helper (popup-open kick)
over sleeping a full interval where the harness exposes one.

**Validation gate**
- Commands: `bun run audit:vue && bun run e2e:agent -- incoming-public-transfers.test.ts &&
  bun run e2e:agent -- incoming-transfers.test.ts`
- Pass: exit 0 on all three (the second e2e run pins no private-arm regression).
- Layers: typecheck/lint · unit · build · network e2e.

## Security & Adversarial Considerations

**Threat model.** Attackers: (1) anyone on-chain — public `Transfer` events are permissionless
writes into our indexer's input; (2) a malicious/compromised RPC node; (3) a spammy actor
dusting tokens the user ALREADY added.

- **Hostile event data.** Node input zod-parsed offscreen-side; wire responses re-validated by
  the SW-side client schemas (the descriptors trust boundary); page-level monotonicity +
  checkpointed-tip bounds enforced before any state advance (D1); per-item isolation for malformed
  logs; amounts `BigInt`-parse or drop.
- **Hostile cursors / poisoned state.** Cursor advances only from validated pages; positions
  beyond the checkpointed tip rejected; cursor-error recovery = reset-and-rescan with idempotent
  PKs (D6). A lying node cannot wedge the indexer past the chain it will serve.
- **Reorgs (in scope at `checkpointed`).** Checkpointed blocks are reversible, so reconciled
  explicitly: node-driven detection via the `referenceBlock` anchor throw + checkpointed-tip
  regression; recovery deletes orphan records by stored `blockHash`, rewinds the cursor,
  re-inserts, and enqueues a balance refresh for reversed receipts (D6).
- **Dusting / feed pollution — USD-threshold filter (D8; user decision 2026-07-22, supersedes
  the "accept residual" stance of audit F6 / codex #7).** The trust machine defends against
  UNKNOWN contracts, not dust in an already-added (auto-trusted) token. v1 ships a
  user-configurable `incomingDustUsdThreshold` that filters sub-threshold receipts from the feed
  at read time (display-only; records persist; fails open when no price). This is COSMETIC — it
  does NOT bound storage: record count stays attacker-controllable, so the per-(account,token)
  record CAP + feed pagination remain a NAMED fast-follow (orthogonal to D8). A min-amount
  *display* heuristic without a USD basis was rejected (a fixed token-unit cutoff hides real
  receipts of high-value tokens).
- **DoS via event flood.** Page budget bounds RPC/CPU per tick; pre-lock filtering keeps lock
  acquisitions ≈ real receipts, so a busy/spammy token cannot starve note scans or trust
  actions (codex #1); a flooding contract delays only its own backfill.
- **Balance-refresh integrity.** The outbox only triggers reads of chain state via the existing
  projector; a forged event can cause at most a spurious refresh that reads back the true
  balance. `from` is display-only, never an authz input.
- **Cross-profile isolation.** Records, cursors, and outbox rows are all `profileId`-scoped,
  and the PK embeds `profileId|networkId` (F3) — same-seed multi-profile and multi-network
  setups cannot cross-contaminate; purge fan-outs wipe all three tables.
- **Least privilege / supply chain.** No new dependencies; the one new import
  (`TokenContract.events.Transfer`) comes from the already-pinned
  `@aztec-foundation/aztec-standards@5.0.1`. Lockfile committed; 7-day min-age unaffected.
- **No cryptography added.** `computeLogTag` from `@aztec/stdlib` as-is.

## Assumptions

**Facts** (verified; audit-corrected where noted):
1. Token emits public `Transfer{from,to,amount}` per the emit map — embedded source in
   `@aztec-foundation/aztec-standards/target/token_contract-Token.json` (5.0.1); all 9 emit
   sites independently re-verified by the fable audit.
2. `getPublicLogsByTags` is cursor-paginated at `MAX_LOGS_PER_TAG = 20`; aztec.js
   `getPublicEvents` returns `nextCursor` ONLY for exactly-full pages
   (`@aztec/aztec.js/dest/api/events.js`).
3. `LogResult` exposes `blockNumber`, `blockHash`, `blockTimestamp`, `txHash`,
   `txIndexWithinBlock`, `logIndexWithinTx` (`@aztec/stdlib/dest/logs/log_result.d.ts`).
4. Generated `TokenContract.events.Transfer` metadata exists in the package dist.
5. `PRIVATE_ADDRESS_MAGIC_VALUE = AztecAddress::from_field(0x1ea7e015…3264)` — fixed constant.
6. Existing incoming-transfer architecture: 30s schedulers, serviceLock + serviceEpoch,
   3-source dedupe, trust machine, `hidden` semantics
   (`apps/extension/src/wallet/services/incoming-transfer/service.ts`).
7. Storage roots today: `nulo:core:incoming-transfers` (keyed `siloedNullifier`),
   `nulo:core:incoming-trust` (`incoming-transfer/repository.ts:27-28`).
8. Balance refresh triggers today: own-tx terminal update, token/account add, manual RPC,
   unlock >30-min-stale (`token-balance/service.ts:198-283`;
   `apps/extension/src/utils/core.ts:143-164` `refreshBalances` — full path given; a prior
   audit round misread this citation as `token-balance/utils/core.ts`). `BalanceJobQueue` is
   in-memory only, `refreshTokenBalance` returns after an in-memory enqueue (NOT after
   projection), the queue DEQUEUES failures without re-queue (records failure to TaskService
   only), and `EventHandler.invoke` does not await async listeners — jointly why D4 uses a
   persisted outbox with CAUSAL task-anchored acknowledgement (not a timestamp compare, not
   fire-and-forget).
9. UI keys incoming rows by `siloedNullifier` at THREE independent sites: `utils/activity-rows.ts:72`,
   `composables/useIncomingTransfers.ts:62/67/71`, AND `RecentActivityView.vue:109` (separate
   row-builder) — all migrated in Phase 2.
10. `getContractInstance` cascade SHORT-CIRCUITS on a PXE-preimage hit before consulting the
    node (`packages/aztec-runtime/src/pxe/service.ts:270-271`), and registered tokens always hit
    the preimage — so the cascade reports the ORIGINAL class and never throws
    `ContractUpgradedError` for an upgraded registered token. D2's gate therefore goes
    node-direct (`node.getContract`), NOT through the cascade (codex R2 #3, verified).
11. `node.getBlockNumber(tag)` returns a plain `BlockNumber` (`aztec-node.d.ts:145`) for
    `checkpointed`/`finalized`/… — D6 uses THIS, not arithmetic on `getChainTips()`'s structured
    `L2TipId` values (`aztec-node.d.ts:153`; codex delta-recheck #1). `L2BlockTag` semantics
    `l2_block_source.d.ts:287-290` — `checkpointed` = "enclosing checkpoint published on L1"
    (seconds, REVERSIBLE), `finalized` = L1-final (irreversible). D6 bounds indexing to
    `checkpointed + 1` (`toBlock` EXCLUSIVE, `logs_query.d.ts:24`) and rewinds reorgs to the
    finalized watermark. `LogsQueryBase.referenceBlock` (`logs_query.d.ts:33`) is the reorg-safety
    anchor — the node THROWS if that block was reorged out (node-driven detection, no polling).
12. `node.getContract(address, referenceBlock?: BlockParameter)` accepts a block anchor
    (`aztec-node.d.ts:377`) → the D2 class gate calls it with `"finalized"` (the STABLE tag, so a
    reorg can't flip scan on/off — deliberately different from the `checkpointed` INDEX bound) and
    re-checks on finalized-tip change (codex R2-followup #3).
17. `transfer_private_to_private` emits NO public log (only `_increase_private_balance`), whereas
    `transfer_public_to_private(from,…)` enqueues `decrease_public_balance_internal(from,…)` which
    emits `Transfer{from:<sender>, to:MAGIC}` in the SAME tx — verified in the token source. So the
    pub→priv public leg is OBSERVABLE, but there is NO on-chain link tying that leg to a specific
    note commitment, so it is not provably OUR sender (institutional knowledge behind the D7 drop).
18. Extension has a fiat/price surface (`utils/amount.ts`, `TransactionCard.vue`/`TxFeeRow.vue`
    fiat rows) → D8's USD dust threshold is computable; tokens without a price fail open.
13. `BalanceJobQueue.enqueue` mints a TaskService task per balance
    (`balance-job-queue.ts:80-81`), terminal via `completeTask`/`failTask` — the anchor the D4
    causal ack keys on.
14. `EntityStorage.set()` writes ONE key per call — there is NO multi-key atomic write, so D3/D4
    rely on write-ordering + idempotent replay, not a transaction (codex R2 #1).
15. Pre-production storage: shape changes need NO migration (CLAUDE.md § Persisted-storage).
16. Validation tooling real + runner scoping: `audit:vue` runs `src/**/*.test.ts` (no sandbox);
    `e2e:agent` runs ONLY `tests/e2e/network/**` — a skipped source test is never re-run by the
    network runner, so the node-API probe lives in the network suite (codex R2 #4).

**Inferences** (attackable):
1. Per-tag query cost scales with the CONTRACT'S TOTAL Transfer count. The specific alpha-token
   cardinality ("hundreds–thousands of events") is an ACCEPTED PRODUCT ASSUMPTION, NOT a
   verified fact (codex R2 #8) — it is not benchmarked; if wrong the effect is a slower backfill,
   never incorrectness. A mainnet-scale token backfills over days-to-weeks of cumulative uptime
   and account-add restarts it — accepted, seams documented (Detection-lag posture). The Phase 2
   capability probe optionally records observed page latency as a first data point.
2. Deployed token instances on our networks match the bundled class (gate fails closed on
   mismatch).
3. The e2e sandbox node serves `getPublicLogsByTags` — proven by the Phase 2 network-suite
   fail-loud capability test (corrected from the draft's non-executing `skipIf` source test,
   codex R2 #4).
4. Checkpoint-publish lag on the sandbox is near-instant and on testnet is within the user's
   ≤~15s budget for a receive notification; if wrong, the D6 tag choice (checkpointed vs
   proven/finalized) is a one-line change localized to the indexer's bound. Checkpointed reorgs
   are rare but IN SCOPE and reconciled (D6) — not assumed away.
5. `withPxeRead` suffices for the node-only reads (page scan, `getChainTips`, `getContract`) — the
   `fn(pxe, node)` signature provides the node handle; no PXE store mutation occurs.

**Asks — all resolved with the user (Phase 0 + the 2026-07-22 follow-ups):**
1. Backfill: full history, no config; `startBlock` retrofit seam. (Settled.)
2. Trust: same machine for public receipts. (Settled.)
3. Balance wiring: both arms, in scope. (Settled.)
4. Reorg policy: **CHECKPOINTED tip + reconciliation** (user chose latency over finalized's
   irreversibility; D6). (Settled 2026-07-22.)
5. Dust: **USD-value threshold filter in Settings** (D8) — display-only; storage CAP stays a
   named fast-follow. (Settled 2026-07-22.)
6. Detection-lag posture (30s tick + checkpoint-publish lag; unbounded backfill duration on
   busy tokens; no SLA). (Settled — user "A6: Ok".)
7. UI design: dedicated `/popup/received/:id` detail (A); honest From card (B); ALWAYS-link the
   tx hash (C, user override); three receiver-honest labels (D). (Settled 2026-07-22.)
8. pub→priv sender (D7): **DROPPED** — user chose to show pub→priv as "Received privately" with
   no sender rather than surface an unprovable/spoofable address. (Settled 2026-07-22.)
9. D8 dust filter dependency: **RESOLVED — build it in v1.** The user corrected a stale check: the
   `price` service is already on `dev` (PR #309). D8 consumes it (baseline rebases onto current
   `dev`). No defer, no gate. (Settled 2026-07-22.)

## Competing outline (B): standalone `PublicReceiptService` — REJECTED, hybrid adopted

Original B (own service, own storage, third UI feed source) rejected: the `unknown→pending`
transition must be atomic with record insert under ONE lock — a cross-service `ensurePending`
reintroduces two-service lock-ordering, strictly worse than a second in-service arm; purge
fan-outs (where this codebase's historical bugs lived) would double; three-source UI merge is
real friction. Both auditors concurred with rejecting full B. Codex's HYBRID refinement —
isolate the hostile-RPC/cursor/reorg machinery in a `PublicEventIndexer` module while the
service stays sole trust/record writer — is ADOPTED as D3's module split: B's isolation benefit
without B's coordination cost. Fable's caveat stands and is folded: A is conditional on auditing
EVERY lifecycle path against BOTH arms' state (records AND cursors AND outbox) — the D3/D4
lifecycle tables + Phase 2/3 named tests are that audit.

## Decision ledger

| # | Decision | Chosen | Rejected / source | Status |
|---|---|---|---|---|
| L1 | Detection mechanism | Node tag-indexed `Transfer` events, cursor-paginated | Balance-diff polling; per-block effect scanning | settled (user + draft) |
| L2 | Backfill window | Full history, no config; `startBlock` seam | Account-creation anchor; per-token setting v1 | settled (user) |
| L3 | Trust for public receipts | Same per-contract trust machine | Auto-trust public | settled (user) |
| L4 | Service shape | A + internal `PublicEventIndexer` module (codex #8 hybrid) | Full standalone B (both auditors concur); monolithic A (codex) | settled (audit round 1) |
| L5 | Balance refresh mechanism | Persisted outbox, both arms, trust-independent, drain-on-init (codex #6) | Bare in-memory event emit (draft — lost on SW death + startup race); ack-after-projection outbox (R2 over-engineering) | settled (audit round 1) |
| L6 | Record identity | Discriminated union; PK `kind`-prefixed + `profileId|networkId`-scoped (fable F3, codex #2) | Unscoped `pub:${txHash}:${logIndex}` (draft); parallel table | settled (audit round 1) |
| L7 | Public scan granularity | Per `(networkId, contract)`, pre-lock recipient filter, cursor reset on account-add | Per-account cursors (N× RPC); no-reset (misses new-account history) | settled; cost documented (F7) |
| L8 | aztec.js sugar | Own mapping with explicit `scannedThrough` (partial pages advance) + `fromBlock` (fable F4, codex #3) | `getPublicEvents` as-is; `nextCursor`-only persistence (draft — tail-page livelock) | settled (audit round 1) |
| L9 | Reorg/finality | **CHECKPOINTED tip + crash-safe reconciliation** — `toBlock = getBlockNumber("checkpointed")+1`; `referenceBlock`-throw detection; rewind to PERSISTED `lastScanFinalized` watermark; staged+hash-pinned (`upperBoundHash`) resumable marker; `pendingPage` closes the normal-scan record-before-cursor crash window; orphan cleanup enqueues balance refresh before delete — user chose latency 2026-07-22 | FINALIZED-only (R2 — too slow); proven-tip (R1 — not irreversible); rewind-to-current-finalized (delta-recheck — strands after downtime); bare `{rewoundTo}` marker (can't resume multi-tick); unpinned reconciliation (final-confirm — cross-fork `seen` mixing) | settled — user (Ask 4) + codex delta-recheck #1 + final-confirm #1a/#1b, all folded |
| L10 | Dust in trusted tokens | **USD-value threshold filter in Settings** (D8, display-only, fails open on no-mapping/stale) + storage CAP as separate fast-follow; consumes the `price` service (PR #309, on `dev`) via `getQuotes`/`isQuoteFresh`/`convert.ts` micro-USD; baseline rebases onto current `dev` | R1/R2 "accept residual, no v1 filter"; fixed token-unit min (hides high-value receipts); defer/gate (Ask 9 — moot, dep present) | settled — user (Ask 5 + Ask 9 correction: price service IS on dev via #309) |
| L11 | Cursor lifecycle | Delete on token-delete; reset on account-add; lock+epoch-guarded writes (fable F1/F5, codex #5) | Draft's silence | settled (audit round 1) |
| L12 | Class-gate strength | **node-direct `node.getContract(address, "finalized")`, reject `current != original`, cache keyed by finalized tip + re-check on tip change** (codex R2 #3 + R2-followup #3, verified `pxe/service.ts:270-271`, `aztec-node.d.ts:377`) | R1 disposition "cascade already rejects upgrades" WRONG (preimage short-circuit); per-service-epoch memo (stale after a finalized upgrade) | settled (R2 + followup) |
| L13 | blockTimestamp | From `LogResult` directly; no backfill RPC for public kind (fable F10) | Draft's `getBlockTimestamp` reuse | settled |
| L14 | Fable F11a "dead citation" | Rejected — misread; `apps/extension/src/utils/core.ts:143-164` verified correct (path clarified in Fact 8; codex R2 concurred L14 valid) | — | settled (verified) |
| L15 | Node API proof timing + placement | Phase 2 network-suite FAIL-LOUD capability test, run explicitly in the gate (codex R2 #4) | Draft/R1's `describe.skipIf` SOURCE test — never re-run by the network runner (non-executing) | settled (R2 corrected) |
| L16 | Scale SLA | Documented accepted limitation + seams; alpha cardinality labeled an accepted PRODUCT ASSUMPTION not a fact (codex R2 #8) | Codex R1's production-volume benchmark + SLA requirement (alpha scope; no recipient-indexed node query exists) | settled |
| L17 | Balance-refresh acknowledgement | **CAUSAL task-anchored ack, coalescing-safe + profile-scoped** — `requestBalanceRefresh` attaches a task id ONLY on a FRESH task (`{busy}` otherwise); new receipt clears the prior anchor + overwrites `dirtyAt`; row deleted only on its own fresh post-`dirtyAt` task's terminal-success; drain scoped to the active profile (codex R2 #1 + R2-followup #1 + R2-followup-2 #1) | R1 delete-after-enqueue-return; R2 `updatedAt > dirtyAt` compare (non-causal); naive task-anchor that reuses a coalesced pending task (false-acks a later receipt) | settled (R2-followup-2, planning-agent-flagged) |
| L18 | Outbox stale-row safety | `requestBalanceRefresh` throws on missing balance record → drain looks up the balance row first + token/account-delete purges outbox (codex R2 #5) | R1's "stale rows harmless" (false — they'd throw) | settled (R2) |
| L19 | pub→priv sender recovery | **DROPPED** (user, Ask 8) — the public leg is observable but NOT provably attributable to our note (a same-amount pub→priv to a third party in the same tx is observationally identical), so pub→priv shows as "Received privately", sender redacted, no hint (D7) | Authoritative recover+relabel (codex delta-review #2: false attribution); uncertain-hint (user declined the spoofable-address slot) | settled — user chose DROP 2026-07-22 |
| L20 | Received detail surface | **Dedicated `/popup/received/:id`** + widened row props (`id,kind,type,from,blockHash`) (D5-A) | Redirect-to-token-page (draft — no home for sender/block/explorer); inline-expand | settled — user (Decision A) |
| L21 | Explorer link policy | **ALWAYS link the tx hash** where an explorer URL exists; copy-hash on sandbox (D5-C) | Link-only-when-meaningful (draft recommendation — user overrode for UI consistency) | settled — user override (Decision C) |
| L22 | Received label vocabulary | **THREE receiver-honest labels** + "Minted" (D7 dropped, so pub→priv isn't distinguished) (D5-D) | Four labels (would need D7's unprovable attribution); four send-side labels verbatim (fabricates note origin) | settled — user (Decision D + Ask 8 drop) |

Unresolved disagreements: none. Two dispositions changed under scrutiny: R2 overturned R1's L12
(class-gate — my R1 verification was wrong; now node-direct + finalized-anchored), and the
R2-followup replaced R2's own timestamp-compare ack with a causal task-anchored one (L17). Every
finding across all three passes is adopted (ledger A-side) or rejected with a verified reason
(L14; L16 alpha-scope SLA). Items codex confirmed already-closed across the passes (pre-lock
filter preserves matching-only trust transitions; scoped discriminated identities; cursor
partial-page/`fromBlock`/budget + lock+epoch mechanics; acyclic Incoming→TokenBalance dependency
starting TokenBalance first; L14 citation valid) need no further change.

## Post-implementation hardening

Not scheduled. Extension-internal surface; the trust machine + zod boundaries are covered by
the plan's own tests and the standard post-impl audits. Revisit `/harden security` at the next
release-readiness pass as usual.

## Seeds (FINALIZED post-approval, 2026-07-22)

### Recommended: `/goal`

```
/goal Implement implementations-plan/incoming-public-transfers. BEFORE any code: read implementation.md AND plan.md in that dir fully (implementation.md has the verified lessons + rejected paths — do not re-litigate them), then `git merge origin/dev` into this branch (pulls the price service from PR #309 that the Phase-4 dust filter needs) and run `bun install`. Then implement phases 1→5 IN ORDER from plan.md. DONE means: all 5 phases marked ✓ in plan.md (the per-phase headers in the file, not just chat), each ✓ backed by its Validation-gate commands AND the NAMED tests in that gate's pass-criteria reported passing in the transcript; for each phase you printed `LESSONS_FILE=implementations-plan/incoming-public-transfers/lessons/phase-N.md`; `/code-review max --fix` complete with fixes committed separately; codex post-impl audit complete with high/critical findings addressed; and `bun run audit:vue`, `bun run e2e:agent -- incoming-public-transfers.test.ts`, and `bun run e2e:agent -- incoming-transfers.test.ts` all report exit 0 in the transcript. NEVER weaken a quality gate to go green — a red check is a flake (re-run) or real breakage (fix). Log every phase + every codex consult in lessons/phase-N.md.
```

### Alternative: `/loop 15m`

```
/loop 15m Drive implementations-plan/incoming-public-transfers forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/incoming-public-transfers/plan.md and lessons/ (authoritative state — not the chat); run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup` (no --watch).
2. Waiting on CI is fine — confirm it's progressing (`gh run watch <run-id>` up to 10 minutes); use the wait to review the diff or prep the next phase.
3. No task in hand? Pick the next pending step from plan.md and start it. After each meaningful edit run `bun run lint` + the touched package's tests — catch mistakes in-step. Then commit → push.
4. Stuck, or facing a decision you'd normally bring to me? Call /codex xhigh with full context, reach a defensible decision, act on it, log the consult in lessons/phase-N.md. Hard limits stay hard: never merge to dev/main, never publish, never expand scope beyond plan.md.
5. Same step failed 5 times? Stop retrying; reassess with codex, then continue down the agreed path.
6. Phase green? "Green" = THE PHASE'S VALIDATION GATE as written in plan.md, INCLUDING its named tests (commands + pass criteria). Run it, paste the result, mark ✓ in plan.md, file lessons, print `LESSONS_FILE=implementations-plan/incoming-public-transfers/lessons/phase-N.md`, advance.
7. All phases ✓? Post-impl sequence: /code-review max --fix → commit fixes separately → codex post-impl audit (net diff + code-review commit summary + adversarial ask) → address high/critical → wrap-up report → surface and stop.
```
