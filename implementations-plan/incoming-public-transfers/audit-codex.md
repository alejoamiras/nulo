# Codex audits — incoming-public-transfers

## Round 1 (gpt-5.6-sol, xhigh, read-only, fresh session)

Prompt: full plan brief (facts with file:lines, unverified inferences flagged, adversarial +
security + assumption-attack asks, outline A vs B steelman ask, design-hole hunt including the
same-tx note+public case, phase/gate quality). Codex read the plan + repo from the worktree.

### Response (verbatim)

Reject: the plan has four blocking correctness/liveness flaws—unbounded global-stream scanning,
unsafe cursor semantics, cross-scope key collisions, and non-durable balance refresh.

1. **Critical — D3 / Security: scan scalability.** The tag identifies the event type, not `to`;
every wallet downloads every Transfer event for every added token. The 5-page budget sustains
only 3.33 events/sec. Above that, lag grows forever, so receipts may never appear. Unrelated
events also enter the global service-lock loop, allowing one busy token to starve private scans
and trust actions. Require production-volume benchmarks and a maximum detection-lag SLA; filter
non-recipient events before locking, isolate public ingestion, and reject this mechanism for
tokens exceeding the sustainable rate unless recipient-indexed querying becomes available.

2. **High — D3 / Record identity.** `pub:${txHash}:${logIndexWithinTx}` is not globally unique
across profiles or networks, while EntityStorage keys are global. A collision overwrites another
scope's record. Upstream only guarantees the block/tx/log tuple as a stream position. Key public
records by at least `profileId|networkId|contract|txHash|logIndex`, and use a discriminated Zod
union so note-only fields cannot be absent on `kind:"note"`.

3. **High — D1/D3 / Cursor protocol.** Upstream emits `nextCursor` only when a page has exactly
20 logs. A non-empty short page still needs its last-log cursor persisted or it repeats forever.
Also, `startBlock` cannot be used because the proposed RPC has no `fromBlock`. Return
`{events, scannedThrough, hasMore}`; include `fromBlock`; require strictly increasing, sorted,
bounded cursors and reject repeated/out-of-order/full-page-without-progress responses.

4. **High — D1/D3 / Reorgs and poisoned state.** The plan discards `blockHash`, omits
`referenceBlock`, and permanently persists node-supplied cursors and records. A reorg can retain
orphan rows and skip replacement events; a malicious node can return a far-future cursor that
remains poisoned after switching nodes. Carry `blockHash` and the already-present
`blockTimestamp`, anchor queries with `referenceBlock`, define rollback/reconciliation and
node-endpoint-change reset behavior, and test them.

5. **High — D3 / Lifecycle.** Token deletion wipes records and trust, but cursor deletion/reset
is not specified. Re-adding the token would resume after old events and fail to rebuild the wiped
history. Cursor deletion on token removal and account-add reset must occur atomically under the
service lock with an epoch bump. Add token-delete→re-add, account-add-mid-page,
chain-purge-mid-page, and profile-switch-mid-page tests.

6. **High — D4 / Balance durability.** `EventHandler.invoke` does not await async listeners, and
`BalanceJobQueue` is memory-only. A worker death after record persistence but before successful
enqueue loses the refresh permanently because replay sees the existing record and skips emission.
Startup also races: making TokenBalance depend on Incoming starts Incoming's immediate poll
before TokenBalance subscribes. Replace the event with a persisted dirty marker/outbox committed
before cursor advancement, drained on boot, and acknowledged only after durable refresh
completion; coalesce by balance key.

7. **High — Security / D2.** "Fabricated events are hidden-pending at worst" is false: explicitly
added tokens are auto-trusted, so fake or dust events render immediately. Trust does not mitigate
spam inside a trusted token. Moreover, `getContractInstance` prefers PXE preimages and
synthesizes `currentContractClassId = originalContractClassId`; it is not a live-current class
gate for registered/upgraded tokens. Add a node-current, anchored class check and define
retention/aggregation/dust limits plus storage and refresh backpressure.

8. **Medium — Outline A vs B.** The draft steelmans only an end-to-end B with duplicate
trust/storage. The stronger B is a `PublicEventIndexer` owning hostile high-volume RPC, cursor,
backoff, and reorg handling while IncomingTransferService remains the sole trust/record
projector. That avoids a third UI source and double writer while protecting the note scanner's
lock. Reject full standalone B, but prefer this hybrid boundary over monolithic A.

9. **High — Assumptions / Phases.** **Facts:** cursor availability is misstated as record-key
uniqueness; `LogResult` also supplies block hash/timestamp; `withPxeRead` is the correct
node-only wrapper. **Inferences:** query cost, deployed-class parity, sandbox support, and
throughput remain unproven. **Asks:** detection-lag SLA, dust/retention policy, finality/reorg
policy, MV3 alarm versus unreliable `setInterval`, and whether mixed note+public deliveries in
one external tx render as two legitimate receipts. Surface these decisions and require a
live-node capability/traffic probe before Phase 2.

10. **Medium — D5 / Gates.** Phase 2 is not independently correct: `useIncomingTransfers`,
`activity-rows`, and RecentActivity key by `siloedNullifier`, despite D5 claiming no structural
changes. Move all identity propagation into Phase 2. Add mixed-arm same-tx, SW-crash/outbox,
cursor poison, reorg, and sustained-over-budget tests. `audit:vue` is real, but delaying the
first actual node API proof until Phase 5 is too late.

What looks sound:
- Keeping one trust/record projector and trust-independent factual balance semantics.
- `withPxeRead`, epoch cancellation, live token rechecks, and at-least-once record writes.
- The single-operation public→private non-double-count argument and fail-closed intent.

VERDICT: reject (blocking findings: unscalable all-transfer scan, unsafe cursor/reorg protocol,
cross-scope identity collisions, non-durable balance refresh)

### Post-audit verification by the planning agent

- Finding 10 (UI keying) **verified correct**: `apps/extension/src/utils/activity-rows.ts:72`
  keys `incoming:${inc.siloedNullifier}`; `useIncomingTransfers.ts:62/67/71` dedupes on it.
- Finding 7's class-gate half **over-stated**: the runtime cascade
  (`packages/aztec-runtime/src/pxe/service.ts:259-297`) `assertNotUpgraded`s node-sourced
  instances (throws `ContractUpgradedError`) and hydrates PXE preimages under a DOCUMENTED
  repo-wide no-upgrades assumption shared by the note-schema lookup. Not new surface. The
  auto-trust-dust half of finding 7 stands (matches fable F6).
- Finding 4's proven-tip remedy **implementable**: `getBlockNumber(tip?: L2BlockTag)` exists on
  the node interface (`@aztec/stdlib/dest/interfaces/aztec-node.d.ts:145`).

Disposition of all findings: see plan.md "Decision ledger" (A1–A16 adopted, R1–R5 rejected with
reasons).

## Round 2 (final fresh-context pass) — appended below after plan revision

## Round 2 (final fresh-context pass — gpt-5.6-sol, xhigh, read-only, NEW session)

Fresh session given the consolidated post-R1 plan + both audit transcripts + the R1 verification
notes. Verdict: **reject** with 8 mechanism findings (4 blocking). Findings, verbatim summary:

1. **Critical — D4/L5/Phase 3:** outbox not durable through completion — `refreshTokenBalance`
   returns after in-memory enqueue; delete-then-SW-death-before-1s-tick loses the refresh; queue
   drops failures (TaskService records only). "Same locked section" is not atomic —
   `EntityStorage.set()` is one key per call. → outbox-first write ordering + lazy ack (retain
   until observed-complete). **Folded: L17, D4 rewrite, Fact 12.**
2. **High — D6/L9:** "proven" is NOT irreversible — the API distinguishes `proven` (rolls back
   on L1 reorg) from `finalized` (L1-final). → index to `finalized`; standardize inclusive
   `toBlock`. **Folded: L9, D6 rewrite, Fact 11.**
3. **High — D2/L12:** L12 wrongly rejected in R1 — at `pxe/service.ts:270-271` a PXE-preimage
   hit short-circuits the node, so an upgraded REGISTERED token never throws
   `ContractUpgradedError`. → node-direct `node.getContract` class check. **Folded: L12
   overturned, D2 rewrite, Fact 10.**
4. **High — Phase 2/L15:** the `describe.skipIf` source integration test never runs (`audit:vue`
   = `src/**` no sandbox; `e2e:agent` = `tests/e2e/network/**` only). → fail-loud capability
   test in the network suite, run explicitly in Phase 2. **Folded: L15, Phase 2 gate, Fact 14.**
5. **Medium — D4 lifecycle:** token/account-delete missing from outbox purge; a stale row is NOT
   harmless — `refreshTokenBalance(tokenId)` throws on a missing balance record. → purge on
   delete + drain looks up the balance row first. **Folded: L18, D4.**
6. **Medium — D5/Fact 9:** identity propagation missed `RecentActivityView.vue:109` (a separate
   `siloedNullifier` row-builder) → public rows would collide on `incoming:undefined`. **Folded:
   D5 (three sites named), Fact 9.**
7. **Medium — Phase 5:** default 30s test timeout == scheduler interval → first-tick timeout
   risk; sandbox proving is ~200ms (not the bottleneck). → ≥120s receipt-assertion budget +
   deterministic poll-trigger. **Folded: Phase 5.**
8. **Low — L16/Inference 1:** "hundreds–thousands" unverified → label as accepted product
   assumption or record page latency in the probe. **Folded: Inference 1, L16.**

**Resolved blockers codex R2 confirmed closed:** pre-lock filtering preserves matching-event-only
trust transitions; scoped discriminated identities are sound; partial-page/`fromBlock`/budget +
lock+epoch cursor mechanics coherent; Incoming→TokenBalance dependency acyclic and starts
TokenBalance first; L14's citation is valid.

All 8 folded into plan.md (L12 overturned node-direct; L17/L18 added; D2/D4/D6 rewritten; Phase
2/5 gates corrected; Facts 8–14 updated). Resume with the fixes for the verdict flip appended
below.

## Round 2 follow-up (resume, verdict re-check #1)

Resumed with the 8-finding fold. Codex confirmed 5 of 8 CLOSED (capability probe, stale-outbox
lifecycle, identity propagation incl. `RecentActivityView.vue:109`, Phase 5 timing, scale
assumption) but found 3 residual mechanism gaps in the fixes — reject:

1. **Non-causal outbox ack.** `updatedAt > dirtyAt` is not causal: an OLDER refresh (enqueued
   before this receipt) can read stale chain state yet write `updatedAt` after `dirtyAt`, falsely
   acking a receipt it never included. → persist a generation/nonce through enqueue→completion,
   or anchor the ack to a specific refresh task. **Folded: D4 rewritten to CAUSAL task-anchored
   ack** — `requestBalanceRefresh → taskId` persisted on the row, ack only on THAT task's
   terminal-success (task created during drain, strictly after `dirtyAt`). Ledger L17, Facts 8/13.
2. **Exclusive `toBlock` off-by-one.** `getPublicLogsByTags.toBlock` is documented EXCLUSIVE
   (`logs_query.d.ts:24`), so `toBlock = finalizedTip` omits the tip block — potentially forever.
   → `toBlock = finalizedTip + 1`. **Folded: D1, D6, Ledger L9, Fact 11.**
3. **Stale/unanchored class gate.** `node.getContract` must pass the `"finalized"` tag, and the
   per-service-epoch memo goes stale after a finalized upgrade. → `node.getContract(address,
   "finalized")`, reject `current != original`, cache keyed by finalized tip + re-check on tip
   change. **Folded: D2, Ledger L12, Fact 12.**

Codex also noted finalized-only WITHOUT reconciliation is appropriate for v1 once #2 is fixed
(reconciliation need not ship in v1) — matches the plan.

Resume #2 (verdict re-check on these 3 fixes) appended below.

## Round 2 follow-up #2 (resume, verdict re-check #2) — CONDITIONAL APPROVE

Verdict on the 3 fixes: #2 (finalized `+1`) and #3 (node-direct `getContract("finalized")` +
tip-keyed revalidation) CLOSED. #1 (causal ack) NOT yet closed — the coalescing gap the planning
agent pre-flagged is REAL: while T1 (balance X) is processing, receipt B reuses T1 via
`pendingTasks[X]`; T1 can complete on pre-B chain state, and B — having stored T1 — would delete
its row before a successor projection succeeds.

Minimal fix codex prescribed + planning agent FOLDED (D4 + Phase 3 + L17):
- `requestBalanceRefresh` attaches a task id ONLY when it creates a FRESH task; returns `busy`
  (enqueue-only, no id) if balance X already has a pending/processing task → a later drain
  anchors to the post-receipt T2.
- A new receipt overwrites `dirtyAt` and CLEARS any prior `pendingTaskId`.
- Drain is ACTIVE-PROFILE-SCOPED (else a profile switch false-deletes a foreign row via
  TokenBalanceService's active-profile token map).
- Test the interleave: T1 processing → B arrives → T1 succeeds → B REMAINS → fresh T2 succeeds →
  B deletes.

VERDICT: conditional approve (conditions: outbox anchors only a freshly created post-receipt
task, new receipts invalidate prior anchors, the in-flight-coalescing interleaving is tested, and
drains are active-profile-scoped)

**All 4 conditions folded into D4 + the Phase 3 named-test list before the approval gate.**

## Delta-review (resume of R1 session) — user design deltas (checkpointed reorg / pub→priv enrichment / dust filter)

Focused review of the three post-conditional-approve user deltas. Verdict: **reject** — 2 blocking + D3 conditions.

1. **Delta 1 (D6 reorg) — not sound as written.** `referenceBlock` is sufficient to detect any
   reorg of earlier records even after the cursor advances, BUT the D1 signature omitted
   `referenceBlock` and the cursor row omitted `lastSyncedBlockHash` — the mechanism wasn't
   representable. "Highest still-canonical block" needs a concrete anchor. Fixes folded: rewind to
   the FINALIZED tip; scan the COMPLETE affected window before deciding what didn't reappear;
   enqueue the balance refresh BEFORE deleting a reversed receipt (delete-first loses it on MV3
   suspension); persist reconciliation state (crash-safe); under lock + epoch recheck; deletions
   keyed on `blockHash` canonicality, NEVER the pre-lock recipient filter. Private-arm "exemption"
   is UNPROVEN — our note records are copies, so a PXE-pruned note doesn't delete our row; reframed
   as a PRE-EXISTING property of the shipped note scanner (unchanged here), not an exemption.

2. **Delta 2 (D7 pub→priv enrichment) — NOT sound: can falsely identify a sender.** Amount-match
   cannot prove causality: one tx can carry a priv→priv note (amount X) to us AND an unrelated
   pub→priv transfer (amount X) to a third party → misattribution. No on-chain link exists between
   a public debit event and a specific note commitment (verified: `includeEffects` gives the tx's
   note-hash set but not a leg→note mapping). Downgraded: D7 becomes at most an EXPLICITLY-UNCERTAIN
   hint, never the authoritative From, primary chip stays "Received privately". USER DECISION staged
   (drop entirely vs uncertain-hint). Also: paginate `txHash`-mode results beyond 20; any cache
   carries source blockHash + reorg-invalidation (else it escapes D6).

3. **Delta 3 (D8 dust filter) — conditionally sound.** Service read-time filtering is right (consistent
   across consumers). Conditions folded: apply `incomingTransfersVisible` + `hidden` FIRST, dust
   filter last; price failure must NOT bypass those gates; fail-open OK for a cosmetic filter but UI
   marks "price unavailable"; define price provider/freshness/integer-math/refresh triggers; the
   Phase 4 test wording was BACKWARDS (raising threshold hides MORE, lowering re-reveals) — fixed.

Cross-delta folded: D1 signature now carries `referenceBlock` (D6) + a `txHash` mode (D7); D7 cache
reorg-invalidated; D8 read-filter is display-only and never suppresses the D4 balance-refresh outbox.

VERDICT: reject (blocking: D6 lacked a representable crash-safe reconciliation protocol + wrong
private-arm exemption; D7 can falsely identify a sender). Mechanical fixes (D1/D6/D3 + cross-delta)
folded immediately; D7 held for a user drop-vs-hint decision, then a re-check.

### Ask-8 resolution + fold (2026-07-22)

User chose **DROP** for D7 (pub→priv sender). Folded: D7 marked dropped (institutional-knowledge
paragraph retained explaining the attribution gap); D1 `byTx` mode removed; D5 reverted to THREE
labels + redaction for both note kinds; Phase 4/5 enrichment work + tests removed; ledger L19/L22
updated; Ask 8 closed. The delta-review's two blockers are now both resolved (D6 reconciliation
protocol folded to codex's prescription; D7 misattribution eliminated by dropping the feature) and
the D3 conditions folded. Final delta re-check requested to confirm closure.

## Delta RE-CHECK (resume) — verdict: reject → 2 mechanical fixes folded, 1 user decision (Ask 9)

1. **D6 — not closed → FOLDED.** (a) rewind-to-*current*-finalized strands a reorged block that
   re-finalized below the current tip during downtime → now rewind to the PERSISTED
   `lastScanFinalized` watermark. (b) `{rewoundTo}` can't resume a multi-tick full-window compare
   → now a STAGED marker `{lowerBound, upperBound, progress, seen}`, resumable across ticks/crashes;
   network paging outside lock, transitions under lock+epoch. (c) `getChainTips()` values are
   structured `L2TipId` → use `getBlockNumber("checkpointed"|"finalized")` (plain number). All folded.
2. **D7 — closed conceptually; dangling refs FOLDED.** Removed the stray D1 "Enrichment mode —
   txHash filter" bullet and the Phase 4 "enrichment" title; the byTx mode is gone from the signature.
3. **D8 — not closed (real dependency).** The per-token USD price feed does NOT exist on `dev`
   (only `FEE_JUICE_USD_RATE = 0.02`; the `price` service + per-token fiat is on the UNMERGED
   `token-prices` branch, commits `2724599`/`a5c84c6`, verified not ancestors of this worktree).
   D8 as specified isn't buildable on this baseline. Duplicate D8 section removed (kept the stronger
   one). Escalated to **user Ask 9: (a) defer D8 to a fast-follow [recommended] vs (b) gate D8 on
   token-prices merging to dev**.

VERDICT: reject (D6 watermark/marker — folded; D8 lacks an available token-price provider — Ask 9).
Mechanical fixes folded immediately; D8 ship-path held for the Ask-9 decision, then a final re-check.

## Ask-9 correction (2026-07-22): price service IS on dev

The user corrected the delta-recheck's D8 finding: my "price feed absent" check was against a
STALE local `dev` (68a856a). Re-checked against `origin/dev`: the `price` service is present via
squash PR #309 ("feat(prices): live usd prices, fiat send input, default token seeding") —
`apps/extension/src/wallet/services/price/{service,client,convert,price-map,spec}.ts`. (The old
feature-branch commit SHAs weren't ancestors because #309 squash-merged.) So D8 is IN v1: it
consumes `PriceService.getQuotes()`/`refreshIfStale()` + `isQuoteFresh` (15min TTL) + `convert.ts`
micro-USD integer math; baseline rebases onto current `dev`. Ask 9 resolved (no defer/gate). Both
delta-recheck blockers (D6 folded; D8 dependency present) now closed → final confirm, then gate.

## Final confirm (resume) — CONDITIONAL APPROVE, conditions folded

D6: the watermark + resumable-marker fixes CLOSED the delta-recheck blockers, but two residual
crash/reorg races remained (both folded):
- **#1a hash-pin every reconciliation page.** Persist `upperBoundHash` in the `reconciling` marker
  and pass it as `referenceBlock` on every reconciliation page; a mid-reconcile reorg throws →
  discard staged `seen`/`progress` + restart, so `seen` can't mix two forks.
- **#1b normal-scan record-before-cursor window.** A crash+reorg after writing a page's records
  but before the cursor advance leaves records on an orphaned fork with the anchor still pointing
  at the old (canonical) position → no future throw. Folded a `pendingPage` marker (range +
  `upperHash`) persisted BEFORE record writes, reconciled on resume.

D8: **closed**, non-blocking precision folded — use `getPriceMapEntry(chainId, contract)` (verified
`price/price-map.ts:54`; arbitrary token metadata has no CoinGecko id, unmapped fails open) and
compare the threshold by CROSS-MULTIPLICATION (`amountRaw × rateMicro` vs `thresholdMicro ×
amountScale`) to avoid ±0.5 micro-USD boundary rounding.

VERDICT: conditional approve (conditions: hash-pin every reconciliation window; durably reconcile
the normal-scan record-before-cursor crash window). BOTH conditions + the D8 precision folded into
D6 / D8 / Phase 2 before the approval gate. Fable + codex both at conditional approve, all
conditions folded → gate open.
