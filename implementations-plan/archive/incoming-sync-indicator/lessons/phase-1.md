# Phase 1 — sync indicator: the signal + the 5-round codex cycle

## The load-bearing lesson: measure COVERAGE, not the cursor

The first implementation derived `backfilling` from `checkpointedTip − cursor.blockNumber > THRESHOLD`.
**That was fundamentally wrong** and codex round 1 flagged it Critical: `cursor.cursor.blockNumber` is the
last *event's* block, not how far the scan has *covered*. A quiet token whose last event was block 10 but
which has fully scanned to tip 100 reads "90 behind" → **stuck "Catching up…" forever.** No threshold tune
fixes it — the quantity was wrong.

**The correct signal is scan coverage:** `forwardScanOnce` now returns
`reachedTip = !result.hasMore && !result.dropped` (a complete pass covered the whole `(cursor,
checkpointed]` window — the same predicate `finalizedWatermark` already used). `scanPublicContract` emits
POST-scan from that. The block-gap heuristic + threshold constant are gone. Regression guard:
`(CRITICAL) a quiet token whose last event is far back but which SCANS THROUGH to the tip → caught-up`.

## Codex cycle (5 rounds, gpt-5.6-sol xhigh) — what each round caught

- **R1 (Critical + High×2):** the cursor-vs-coverage bug (above); failure/teardown stranding a cached
  `backfilling`; network-switch / reconnect UI staleness.
- **R2:** confirmed the coverage model; then — indexer's non-advancing (hostile) page reported
  `!dropped` → false `caught-up` (now marked `dropped`, which also stops a latent watermark over-advance);
  token-delete bumped the epoch too late (moved to first statement in the lock); TokensView seed clobbering
  live events; zero-token/first-token never connecting the client.
- **R3:** the TokensView async races again — the ad-hoc `syncLiveSinceSeed`/`seedGen` didn't cover an
  `onBalanceAdded` snapshot clobber or the outer `fetchTokenBalances` ordering.
- **R4:** unified to a live-event clock (`liveClock`/`lastLiveAt`) + `seedGen`; found the remaining A→B→A
  scope-cycle race (network-equality isn't enough).
- **R5: SHIP — no blocker.** Synchronous `scopeGen` (bumped in the watcher before any await, captured by
  every snapshot + `fetchTokenBalances`) closes A→B→A and the outer fetch race.

## Accepted, documented (codex-agreed non-blockers)

- **Tips/network failure emits nothing** (leaves last state). Flipping to `caught-up` on a transient RPC
  blip would wrongly clear the indicator mid-backfill; a persistent failure means the node is down
  (everything is stale). Honest + self-heals. — `service.ts` tips-catch comment.
- **Reconciliation completes → caught-up only on the NEXT forward pass** (reconciliation rewinds the
  cursor). If the node then fails PERSISTENTLY before that pass, the indicator stays "catching up" until
  recovery. Same node-down staleness class; fully closing it means forward-scanning inside the audited D6
  reorg tick — not worth the risk for a cosmetic indicator. — `service.ts` reconciling-branch comment.

## TokensView race tests (codex round-5 recommendation — DONE)

Added `TokensView.test.ts`: deterministic deferred-promise tests for the three guards — a live event wins
over a later-resolving snapshot (no stale clobber), the A→B→A scope cycle drops the old-scope snapshot,
and the baseline event→prop wiring. Mounted `shallow` and asserted via the stubbed `TokenCard`'s
`backfilling` prop. (`useTicker` is stubbed as a global — an auto-imported custom composable the test
transform doesn't inject.)

## Validation

- `bun run audit:vue` — exit 0 (3579 tests, build).
- Service signal: 8 `getReceiptFee`… no — 7 sync-state tests (quiet-token critical guard, budget-incomplete,
  dropped, non-advancing hostile page, transition/dedupe, non-standard, fail-open) + TokenCard §3 states.
- typecheck + biome clean; D6 reconciliation suite intact through the `forwardScanOnce` return-type +
  indexer `dropped` changes.
