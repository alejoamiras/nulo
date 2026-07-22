# Fable audit — incoming-public-transfers (Round 1)

Top-tier Claude audit leg of the /blueprint mid dual audit. The auditor read the draft
[plan.md](plan.md) and verified its claims directly against the repo + node_modules
(emit map + `PRIVATE_ADDRESS_MAGIC_VALUE` from the embedded Token source, `getPublicEvents`
/ `getPublicLogsByTags` / `MAX_LOGS_PER_TAG = 20`, the full `LogResult` shape,
`TokenContract.events.Transfer` in the aztec-standards dist, the incoming-transfer
service/repo/spec, `withPxeRead`/`withPxeWrite`, the balance job queue, the descriptor/client
zod-validation pattern, root scripts, the CLAUDE.md pre-production no-migration rule, the 51
scenario tests, both e2e harness files).

## Findings

**F1 — HIGH — token delete does not touch the cursor row.**
`onTokenDeleted` (`apps/extension/src/wallet/services/incoming-transfer/service.ts:477-518`)
wipes records + resets trust, and pins the invariant "re-add re-indexes … order preserved."
The plan wires the cursor into `clearProfile`/`clearChain` + account-add reset but not token
delete → re-adding a token would resume from the old tip with wiped records: all historical
public receipts permanently lost. → Delete/reset the cursor inside `onTokenDeleted`'s locked
section; add a "token delete → re-add rediscovers public history" scenario test.

**F2 — HIGH — no reorg/pruning story.**
The note arm inherits PXE reorg handling; the public arm persists node-asserted `LogResult`s
forever with no reconciliation: phantom "Received" rows for reorged txs, and undefined behavior
for a cursor pointing into a pruned block (node behavior UNVERIFIED). Threat model covers a
lying node, not an honest node on a reorging chain. → State a policy (query only to
proven/finalized tip via `toBlock`, or accept phantom rows explicitly) + cursor-error recovery
(reset-and-rescan, idempotent by PK).

**F3 — MEDIUM — public PK not profile/network scoped.**
`pub:${txHash}:${logIndexWithinTx}` collides across profiles (same seed in two profiles →
second upsert clobbers the first; `clearProfile(A)` deletes B's row) and across networkIds
sharing a chainId. The note arm has the same latent flaw with bare `siloedNullifier`; L6 is
redefining the PK anyway — the free moment to fix it. → Key public records
`pub:${profileId}|${networkId}|${txHash}|${logIndexWithinTx}` (consider scoping note ids too).

**F4 — MEDIUM — partial-page cursor advance unspecified; naive aztec.js mirror is wrong.**
aztec.js only emits `nextCursor` when the page is FULL (`length === MAX_LOGS_PER_TAG`).
Persisting the cursor only when `nextCursor` exists → the cursor never advances past the
always-partial tail page → every tick re-fetches + re-walks the tail forever (idempotent but
permanent wasted RPC + lock churn; invalidates the "steady state is 1 near-empty call" claim).
→ Persisted cursor := `LogCursor` of the last COMMITTED event of any page (full or partial);
define budget-exhaustion-mid-page; scenario test "partial page advances cursor; next tick
fetches nothing."

**F5 — MEDIUM — cursor writes must be lock+epoch-guarded or the account-add reset is lost.**
Race: backfill page in flight → `onAccountAdded` → hydrate bumps epoch + resets cursor → the
in-flight scan writes `cursor = pageTail` → reset clobbered → new account permanently misses
prior history. The plan epoch-guards record commits but never says the CURSOR write is inside
the serviceLock with the same `epochAtStart` check. → State it explicitly; the Phase 2
"account-add cursor reset" scenario must include the mid-backfill interleaving.

**F6 — MEDIUM — dusting defense misses the realistic attacker; record growth unbounded.**
User-added tokens are auto-trusted (`service.ts:440-475`) → dust in the token everyone adds
bypasses trust entirely: every dust event is a visible row + persisted record. Public dust is
cheaper than private dust. Repository full-table scans are designed for "hundreds, not
millions"; record count is now attacker-controlled. → Acknowledge the residual honestly;
consider per-(account,token) record cap / min-amount heuristic as fast-follow; add
storage-growth to the threat model.

**F7 — MEDIUM — backfill cost is per-contract-TOTAL, not per-user; account-add re-pays it.**
The log tag is one tag for ALL Transfer events of the contract. Genesis backfill pages the
contract's entire transfer history at ≤100 events/30s of SW uptime; 1M transfers ≈ 50k pages ≈
days-to-weeks of cumulative MV3 SW lifetime; each account-add resets to genesis and re-pays.
Inference 1 materially understates whose events. → Reword Inference 1; document the
account-add restart; keep `startBlock` as the named mitigation.

**F8 — MEDIUM — balance-refresh emit is at-most-once against an in-memory queue.**
`BalanceJobQueue` is purely in-memory; the D4 emit fires only on FIRST persist. SW teardown
between persist and queue drain permanently loses the refresh (record exists → never re-emitted)
until the >30-min-stale unlock / manual refresh. Phase 5 gate (c) becomes probabilistic under
MV3 lifetime (window ~1s). → Accept + document, or cheap hardening: on the existing-record
branch re-emit when `record.blockTimestamp > balance.updatedAt`.

**F9 — LOW — dependency declaration omitted.**
`TokenBalanceService.dependencies` is `[ProfileService, TokenService]` with a convention
comment; the plan adds `services.get(IncomingTransferService)` without declaring it. No cycle
(verified: no reverse edge). → Add `IncomingTransferService.name` to `dependencies`.

**F10 — LOW — needless blockTimestamp backfill: `LogResult` already carries it.**
`LogResultBase` includes `blockTimestamp: UInt64` (+ `blockHash`). Fact 3 omits it; D3 routes
public records through the `getBlockTimestamp` RPC cache for nothing. → Put `blockTimestamp`
in the wire shape; drop the backfill RPC for public-kind records.

**F11 — LOW — dead citation + pattern-cite inconsistency.**
(a) `token-balance/utils/core.ts:143-164` doesn't exist (the >30-min-stale unlock refresh
lives elsewhere — substance of Fact 8 holds, citation dead). (b) D1 cites "the `getNotes`
pattern" AND `withPxeRead`, but `getNotes` itself uses `withPxeWrite` (service.ts:399).
→ Fix both citations; state that response zod-validation lives in the SW-side `client.ts`
(the actual trust boundary), not loosely "at the offscreen boundary."

**F12 — LOW — e2e seed-fixture update floats between Phases 2 and 5.**
Record shape changes in Phase 2; smoke first runs in Phase 4; fixtures silently broken in
between. → Move the fixture update into Phase 2's deliverables.

**F13 — INFO — same-tx note + public event: sound.** Two records under disjoint PKs, both
balance-affecting, late-delete handles both kinds by txHash+account. Cosmetic: `noteIndexInTx`
reuse holds `logIndexWithinTx`, a different index space — mixed-pair within-tx ordering is
arbitrary. Worth a spec comment.

**F14 — INFO — emit map + no-double-count claim verified correct** (all 9 emit sites; `to` is
a real recipient only in transfer_public_to_public / private→public leg / mint_to_public;
public→private legs emit `to: MAGIC`).

## Assumption attack (bucketed)

- **Facts**: 1,2,4,5,6,7,9,10 ✓. 3 understated (`blockTimestamp`+`blockHash` exist → F10).
  8 half-misstated (dead `utils/core.ts` citation → F11).
- **Inferences**: I1 unsafe as worded (F7). I2 sound. I3 sound (Phase 5 surfaces it).
  I4 optimistic, compounds with account-add reset (F7). I5 substantively fine (F11b nit).
- **Asks**: "none unresolved" is NOT accurate — three unstated product decisions:
  (a) reorg/finality policy (F2); (b) acceptance of attacker-controlled record growth for
  already-trusted tokens (F6); (c) whether token re-add must recover public history at parity
  with the note arm's re-index invariant (F1).

## Outline A vs B

Steelman for B: the note scanner is the most audit-scarred surface in the repo (lock/epoch +
51 scenario tests encode multiple audit cycles); the lifecycles genuinely differ (cursor-based
at-least-once vs PXE-snapshot reconciliation) — F1/F5 are direct evidence that unifying them
produces exactly the missed interactions B would have prevented; trust could stay single-writer
via a narrow `ensurePending` RPC; the PK rewrite exists only because of A.

Why A still wins: the `unknown→pending` transition must be atomic with the record insert under
the SAME lock — a cross-service `ensurePending` reintroduces a two-service lock-ordering
surface strictly worse than a second in-service arm; purge fan-outs are exactly where this
codebase's historical bugs lived, and B doubles every wired path; three-source UI merge is real
friction. **Rejection of B sound — conditional on A auditing every lifecycle path against BOTH
arms' state (records AND cursors), which the draft did incompletely (F1, F5).**

## Phase/gate quality

Sequencing correct; commands real. Weaknesses: (a) Phase 2/3 pass criteria should NAME the new
scenario tests so the gate can't green without them; (b) fixture-update blind window (F12).
Phase 2's scenario list must gain: token-delete→re-add cursor recovery (F1), mid-backfill
account-add reset (F5), partial-page cursor advance (F4).

## Verdict

**VERDICT: conditional approve** (conditions: **F1** cursor deleted/reset inside
`onTokenDeleted`'s locked section + re-add-recovers-history scenario test; **F4+F5** cursor
persistence semantics specified — last-committed-event cursor for partial pages, written inside
the serviceLock with the epoch check, mid-backfill account-add race tested; **F3** public
record PK scoped by profileId+networkId while the schema is being rewritten; **F2** an explicit
reorg/finality policy — proven-tip `toBlock` or documented phantom-row acceptance plus
cursor-error recovery — stated in the plan before Phase 2.)
