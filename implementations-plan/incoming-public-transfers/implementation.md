# implementation.md — incoming-public-transfers

Handoff for the implementing session (VPS or fresh local). Read this + [`plan.md`](plan.md) FIRST.
This captures the non-obvious lessons from planning so you don't re-derive or re-break them.
The plan went through a Claude "fable" audit + **6 codex passes** (all in
[`audit-codex.md`](audit-codex.md) / [`audit-fable.md`](audit-fable.md)); the *why* behind every
design choice is the 22-entry Decision Ledger in `plan.md`. If a choice looks wrong, read the
ledger row before "fixing" it — it was probably already litigated.

## Status at handoff

- **APPROVED-to-implement** (user moved it to their VPS). No code written yet — planning only.
- Worktree branch: `worktree-incoming-public-transfers`, cut from `dev @ 68a856a`.
- **FIRST implementation step: rebase/merge current `origin/dev`** — the plan's D8 dust filter
  consumes the `price` service that landed on `dev` AFTER this worktree was cut (squash PR #309,
  "feat(prices): live usd prices…"). Without the rebase, `apps/extension/src/wallet/services/price/`
  won't exist. Verify `git show origin/dev:apps/extension/src/wallet/services/price/spec.ts` before Phase 4.
- 5 phases, each with a real validation gate in `plan.md`. Ship gate = Phase 5 network e2e.

## How to start (paste the /goal from the bottom of this file), then work phase-by-phase

The plan's phases are the source of truth. A phase is "green" ONLY when its Validation-gate
commands pass AND the NAMED tests in its pass-criteria exist and pass — the gates deliberately
name specific scenario tests so a green suite alone can't fake it. Log each phase in
`lessons/phase-N.md`.

## The load-bearing lessons (verified facts — do NOT re-litigate)

### Runtime / node API (Phase 1)
- **`toBlock` is EXCLUSIVE** (`@aztec/stdlib/.../logs_query.d.ts:24`). Always `+1` to include the
  intended top block. A bare tip omits it forever until a later block appears.
- **Resolve tips with `node.getBlockNumber("checkpointed" | "finalized")`** — returns a plain
  `BlockNumber` (`aztec-node.d.ts:145`). Do NOT do arithmetic on `getChainTips()` — those are
  structured `L2TipId` values (bit us in a codex pass).
- **`referenceBlock`** (`logs_query.d.ts:33`) is the reorg anchor: pass your last-synced block
  HASH; the node THROWS if that block was reorged out. This is the whole reorg-detection mechanism
  — no polling, no `L2BlockStream` subscription (that exists but is infra plumbing, not a client API).
- **`getPublicEvents` sugar is NOT used** — it drops `txIndexWithinBlock`/`logIndexWithinTx` and
  only emits `nextCursor` on exactly-full (20-log) pages. We own a thin mapping over
  `node.getPublicLogsByTags` returning an explicit `scannedThrough` (last log of ANY page, so
  partial pages advance — else the tail page livelocks).
- **`MAX_LOGS_PER_TAG = 20`** (`@aztec/stdlib/.../api_limit.js:5`).
- **`LogResult` already carries `blockTimestamp` + `blockHash`** — no `getBlockTimestamp` backfill
  RPC for public records (unlike the note arm).
- **The tag is EVENT-TYPE scoped, not recipient-scoped** — `computeLogTag(eventSelector,
  EVENT_LOG_TAG)`. There is NO way to query "only my receipts"; you fetch ALL of the contract's
  `Transfer` events and filter `to == account` client-side. This is inherent to public events
  being public plaintext (private notes ARE per-recipient; public events are not). It's why
  backfill cost scales with the contract's total transfer count, and why pre-lock filtering matters.
- **`PRIVATE_ADDRESS_MAGIC_VALUE = 0x1ea7e01501975545617c2e694d931cb576b691a4a867fed81ebd3264`**
  (fixed constant). `to == MAGIC` ⇒ went-to-private (not our address); `from == MAGIC` ⇒
  came-from-private; `from == 0` ⇒ mint; `to == 0` ⇒ burn.

### Class gate (Phase 1/2) — the subtle one
- Resolve the token's current class **node-direct: `node.getContract(address, "finalized")`**, NOT
  the `getContractInstance` cascade. The cascade SHORT-CIRCUITS on a PXE-preimage hit
  (`pxe/service.ts:270-271`) and registered tokens always hit the preimage → it reports the
  ORIGINAL class and never throws `ContractUpgradedError` for an upgraded registered token. Cache
  the gate result keyed by the FINALIZED tip (stable), re-check on tip advance. Non-matching /
  upgraded / unresolvable → no public scan (fail closed).

### Service / scan arm (Phase 2)
- New internal module `public-event-indexer.ts` owns paging + cursor + reorg policy; the SERVICE
  stays the sole writer of records/trust/cursor/outbox (codex's hybrid boundary).
- **Pre-lock recipient filtering**: filter a page to events whose `to` is one of the active
  profile's accounts BEFORE acquiring the serviceLock. Non-matches only advance the cursor. Keeps
  lock acquisitions ≈ real receipts so a busy/spammy token can't starve the note scanner.
- Public scan scheduler is per **`(networkId, contract)`** (one stream serves all accounts), 30s,
  under the same serviceLock + serviceEpoch as the note arm.
- **Record identity = zod DISCRIMINATED UNION on `kind`**; PK is `id`, profile+network scoped:
  `note:${profileId}|${networkId}|${siloedNullifier}` / `pub:${profileId}|${networkId}|${txHash}|${logIndexWithinTx}`.
  Renamed `noteIndexInTx` → `indexInTx` (holds `logIndexWithinTx` for public). No storage migration
  (pre-production; CLAUDE.md rule).
- **Reorg reconciliation is the trickiest code** — get it exactly as `plan.md` D6 says:
  - Rewind to the **persisted `lastScanFinalized`** watermark, NOT the current finalized tip
    (after downtime a reorged block can re-finalize below the current tip and get skipped).
  - Staged, resumable `reconciling` marker `{lowerBound, upperBound, upperBoundHash, progress,
    seen}` written BEFORE any mutation — a crash / MV3 tick mid-compare resumes, doesn't restart.
  - Pass `referenceBlock = upperBoundHash` on EVERY reconciliation page; a mid-reconcile reorg
    throws → discard staged `seen`/`progress` + restart (no cross-fork mixing).
  - Full-window scan BEFORE deciding deletions; delete iff stored `blockHash` ≠ canonical hash at
    height; enqueue the balance refresh BEFORE deleting; deletions never driven by the recipient filter.
  - Normal scan: persist `pendingPage {fromCursor, toScannedThrough, upperHash}` BEFORE record
    writes, clear after cursor advance; reconcile it on resume (closes the record-before-cursor
    crash window).
- Cursor row `nulo:core:incoming-public-cursors`: `{cursor, lastSyncedBlockHash, lastScanFinalized,
  startBlock, pendingPage?, reconciling?}`. `startBlock = 0` (retrofit seam for a future per-token
  window). Cursor writes only inside the lock + epoch check.
- Lifecycle: `onTokenDeleted` DELETES the cursor row (re-add re-indexes); `onAccountAdded` resets
  cursor to null; `clearProfile`/`clearChain`/chain-purge wipe cursor + records + outbox.

### Balance wiring (Phase 3) — the part with the most failed designs
- Persisted outbox `nulo:core:incoming-balance-outbox`, keyed `${profileId}|${networkId}|${accountAddress}|${tokenId}`,
  `{dirtyAt, pendingTaskId?}`. Written for BOTH arms, regardless of trust state (a hidden receipt
  still changed the chain balance).
- **EntityStorage.set is ONE KEY PER CALL — no multi-key atomicity.** Write the outbox row BEFORE
  the record row; ordering + idempotent replay substitute for a transaction.
- **CAUSAL task-anchored ack** (four prior designs were wrong — see ledger L17): `TokenBalanceService`
  exposes `requestBalanceRefresh(tokenId, account) → {taskId} | {busy}` and attaches a task id ONLY
  when it creates a FRESH task (the queue COALESCES per balance id — reusing a pending task would
  false-ack a later receipt). New receipt clears the prior anchor + overwrites `dirtyAt`. Delete the
  outbox row ONLY on ITS pendingTaskId's terminal-SUCCESS (that task was created after `dirtyAt`, so
  its projection read chain state including the receipt). Drain on `init` + every tick.
- **Drain is ACTIVE-PROFILE-SCOPED** — `TokenBalanceService`'s token map is active-profile-only;
  draining a background profile's row would false-classify it stale. Look up the balance row FIRST
  (a missing balance record makes `requestBalanceRefresh` throw).
- `IncomingTransferService` gains `TokenBalanceService.name` + `TaskService.name` in `dependencies`
  (verified acyclic; also ensures TokenBalance inits first).

### UI (Phase 4)
- Dedicated route `/popup/received/:id` (today incoming rows redirect to the token page). Widen
  `incomingCardProps` + `TransactionsList` routing to thread `id, kind, type, from, blockHash`.
- **THREE `siloedNullifier` keying sites move to `inc.id`** — `activity-rows.ts:72`,
  `useIncomingTransfers.ts:62/67/71`, AND `RecentActivityView.vue:109` (a SEPARATE row-builder;
  missing it → public rows collide on `incoming:undefined`). Fresh grep as the completeness check.
- From card: real address only for pub→pub; "From private" for priv→pub (`from == MAGIC`);
  redaction for BOTH note kinds. Never render MAGIC/zero as a raw address.
- **THREE labels** + "Minted": "Received privately" (both note kinds), "Public → Public",
  "Private → Public". Keep `tx-incoming-card`; add `tx-incoming-kind-chip`.
- **Always-link the tx hash** (user override, for UI consistency) where an explorer URL exists;
  copy-hash on sandbox (chainId 0 has no explorer base URL). Only a `tx-effects/{txHash}` builder
  exists — no block/contract/account URL builders (block hash etc. stay copy-only).
- **Dust filter (D8)** consumes the `price` service (on `dev` via #309): map token via
  `getPriceMapEntry(chainId, contract)?.coingeckoId` (`price/price-map.ts:54`), quote via
  `getQuotes()` gated by `isQuoteFresh` (15-min TTL), micro-USD integer math via `price/convert.ts`.
  Compare threshold by **cross-multiplication** (no boundary rounding). Gate order:
  `incomingTransfersVisible` + `hidden` FIRST, dust LAST. Fail OPEN (shown + "price unavailable")
  on missing mapping or stale quote. Re-eval on `onQuotesUpdated` + threshold change. Does NOT gate
  the balance-refresh outbox.

### Tests
- Phase 2 node-API capability probe MUST live under `tests/e2e/network/` and run in the gate —
  `audit:vue` runs `src/**/*.test.ts` (no sandbox) and `e2e:agent` runs ONLY `tests/e2e/network/**`,
  so a `describe.skipIf` SOURCE test never actually executes.
- Phase 5 receipt/balance assertions get a **≥120s** budget — the default 30s == the scheduler
  interval and will flake on the first idle tick. Prefer a deterministic poll-trigger (popup-open kick).

## Rejected paths — do NOT re-attempt (all in the ledger)
- Balance-diff polling for detection (no provenance/amount/order). → tag-indexed events.
- Standalone `PublicReceiptService` (two trust-table writers = the race the serviceLock killed).
- `finalized`-only indexing (correct but minutes of lag) / `proven`-tip (not irreversible). → checkpointed + reconciliation.
- pub→priv sender recovery / "uncertain hint" — the public leg is observable but NOT provably tied
  to your note (same-amount third-party leg is indistinguishable). **Dropped.** Do not re-add.
- Fire-and-forget balance event / `updatedAt > dirtyAt` timestamp ack / naive coalesced-task anchor
  — all can lose or mis-attribute a refresh. → causal fresh-task anchor (above).
- Production SLA / benchmark for scale (alpha; documented limitation with named seams).
- Per-account public cursors (N× RPC for zero correctness gain).

## Validation commands (from the plan's gates)
- Every phase: `bun run audit:vue` (typecheck:all → unit+component → lint → build).
- Phase 1: `bun run --cwd packages/aztec-runtime test && bun run lint && bun run typecheck:all`.
- Phase 2: `bun run audit:vue && bun run e2e:agent -- public-events-capability.test.ts`.
- Phase 4: `bun run audit:vue && bun run test:e2e`.
- Phase 5 (ship gate): `bun run audit:vue && bun run e2e:agent -- incoming-public-transfers.test.ts && bun run e2e:agent -- incoming-transfers.test.ts`.
- Post-impl: `/code-review max --fix` (commit separately) → codex post-impl audit → address high/critical.

## Companion docs
- [`plan.md`](plan.md) — full plan, Security + Assumptions, per-phase gates, 22-entry Decision Ledger, Seeds.
- [`audit-codex.md`](audit-codex.md) — all 6 codex passes verbatim + dispositions.
- [`audit-fable.md`](audit-fable.md) — the fable audit (F1–F14).
- [`eli5.html`](eli5.html) — plain-language overview + the /goal + /loop seeds.
- `lessons/phase-N.md` — fill during implementation.
