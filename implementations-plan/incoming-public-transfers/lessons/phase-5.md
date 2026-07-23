# Phase 5 — Network e2e ship gate + multi-round codex post-impl audit

Log for Phase 5 (behavioral ship gate) and the iterative codex hardening the user asked for
("several rounds … until satisfied … work with your Codex team mate").

## Codex round 1 — adversarial + correctness review of the core (session 019f8e8c-…, gpt-5.6-sol xhigh)
Scoped to the highest-risk new code: `public-events.ts` (runtime scan/decode/reorg), the service's
D6 reconciliation + D4 outbox arm, `public-event-indexer.ts`, `spec.ts`. Prompt asked codex to BREAK
it. Verdict: "Reject for now — D6 has two permanent fork-corruption paths, and D4 can discard its only
durable retry marker." I verified every finding against the code before acting (codex ≠ oracle):

| # | Sev | Verdict | Finding |
|---|-----|---------|---------|
| 1 | Critical | **CONFIRMED** | Forward `scan()` fetches up to `maxPages=5` pages, ALL pinned to the same old low `referenceBlock` (`indexer.ts:89`); the runtime re-reads `checkpointed` per page (`public-events.ts:215`). A checkpointed-region reorg BETWEEN pages leaves the low anchor canonical → no throw → fork A + fork B events both commit, anchor saves fork B, fork-A orphans never cleaned. |
| 2 | Critical | **CONFIRMED** | `fetchPublicTokenTransferEvents` returns `{scannedThrough:null,hasMore:false}` for BOTH genuine EOF (`:237`) and a validator-DROPPED page (`:251,:259`). In `stepReconciliation` that terminal signal → `finishReconciliation` → deletes records not in `seen`. One non-monotonic/out-of-bound page (a compromised RPC node is in-scope) forces premature reconcile completion → valid records deleted, anchor advanced. |
| 3 | High | **CONFIRMED** | Reconcile fetch is not upper-bounded to `marker.upperBound`; the runtime bounds to the FRESH `checkpointed`. If checkpointed advanced past the marker, reconcile scans + `seen`-accumulates beyond the window; cursor advances past upperBound while the anchor stays `upperBoundHash` (low) → a later reorg of those higher blocks strands orphans. |
| 4 | High | **CONFIRMED** | `drainBalanceOutbox` (`:1504-1510`) deletes the outbox row on ANY `requestBalanceRefresh` throw — a transient storage/task failure is indistinguishable from a genuinely-missing balance → the sole durable refresh marker is lost. |
| 5 | High | **CONFIRMED** | `onAccountAdded` resets cursors under the lock (`:288-296`) but the epoch bump is deferred to `hydrateSchedulers` (`:303`). An in-flight scan (pre-reset epoch) can acquire the lock in the gap and overwrite the reset (its `persistCursorLocked` epoch check still passes) → new account's history skipped. |
| 6 | Med | **CONFIRMED** | `seen` accumulates one tuple per global token event with no cap (`:1277-1278`) → a busy reconcile window can exceed storage quota and wedge reconciliation. `finishReconciliation` only needs one hash per height. |
| 7 | Med/High | ACCEPTED-NARROW | Class gate resolves at `finalized` but scans `checkpointed` data → a contract upgrade malicious-at-checkpointed/standard-at-finalized is temporarily fail-open; polluted rows persist after the upgrade finalizes and scanning stops. Display-only (balance is simulated separately), narrow timing. Revisit in round 2. |
| 8 | Med | NEEDS-VERIFY | Task-fresh ack doesn't prove the balance sim observed the event's checkpointed block; a lagging snapshot could false-ack stale data. Self-heals next scan. Revisit in round 2. |

"Looks correct" per codex: public PK uniqueness (tx-global `logIndexWithinTx`), the `checkpointed+1`
exclusive bound, per-log decode isolation, recipient filtering, outbox-before-record ordering,
coalescing handling, display-only treatment of `from`/`amount`.

## Codex round 2 — verify the round-1 fixes (same session)
Codex CONFIRMED #2/#4/#5 fixed and #8 sound (`balance_of_public` goes through
`node.simulatePublicCalls` = current state, not the lagging PXE header). But it broke two more:
- **Critical #1 STILL-BROKEN.** The post-scan probe missed (a) an A→B→A double-reorg (page 1 reads
  fork B, chain returns to A, the probe of H_A passes → fork-B rows committed) and (b) the
  `checkpointedBlockHash === null` path (no probe → original splice). Fix: pin the checkpoint FORK
  HASH as the `referenceBlock` on EVERY forward page (any page off the wrong fork throws), probe the
  low boundary anchor separately, cap to 1 atomic page when the tip hash is unavailable. Removed
  `committedPages`.
- **#3 NEW BUG I introduced.** My `Math.min(toBlock, nodeCheckpointed)` clamp: if the node's
  checkpointed regressed below a reconcile's pinned `upperBound`, it scanned a truncated window → EOF
  → `finishReconciliation` DELETED canonical records in the tail. Fix: DEFER (`dropped:true`) when the
  pin exceeds the node's checkpointed, never clamp down.
- #6 height-dedup accepted (window is finality-lag-bounded); #7 raised to Medium.

## Codex round 3 — verify the round-2 rewrites (same session)
CONFIRMED #3 fixed and the in-scan splice closed. Found two more:
- **Critical #1 — boundary-anchor TOCTOU.** The low anchor and high anchor were validated at DIFFERENT
  times, so two independent "canonical now" probes don't prove the boundary is an ANCESTOR of the
  checkpoint — a flapping/lying node passes both while the cursor advances onto fork B, orphaning
  fork-A rows. **Fix (the Aztec API has exactly the primitive):** `node.getBlockHashMembershipWitness(
  referenceBlock=checkpointedBlockHash, blockHash=lastSyncedBlockHash)` — ONE atomic archive-membership
  query proving the boundary is in the checkpoint's archive. A non-member throws → reconcile. Threaded
  as a `verifyAncestorHash` fetch arg (pure verification, no log fetch). Falls back to the canonicity
  probe only when the tip hash is null.
- **#7 — codex WON the argument.** My baseline-equivalence claim (junk-token spam is equivalent) was
  WRONG: the upgrade trick impersonates an ALREADY-TRUSTED, price-mapped token at its existing address
  (e.g. "Received 1,000,000 USDC" under the real USDC contract, passing the USD dust filter) — a new
  junk token can't inherit that identity/trust/price-mapping. **Fix:** dual-anchor class gate — require
  the bundled Token class at BOTH `finalized` AND `checkpointed`; cache by BOTH tips so a checkpointed
  advance re-resolves (else a mid-cache upgrade is served a stale "standard"). Residual (accepted): rows
  indexed in the ≤1-tick window before the checkpointed check catches the upgrade persist (display-only,
  no balance forge).
- **New availability note (accepted):** the 1-page cap under a PERSISTENTLY hash-unavailable node can
  fall behind a >20-event/tick token. It fails SLOW (1 page/tick progress), not corrupt; only a
  degraded node triggers it. Documented, not fixed.

## Codex round 4 — verify the round-3 fixes (same session)
Confirmed the ancestry primitive is correct (Aztec's `getBlockHashMembershipWitness(referenceBlock,
blockHash)` proves `blockHash ∈ archive(referenceBlock)` ⇔ ancestry — verified independently against
the `@aztec/stdlib` doc). Found two more High issues:
- **#1 anchor/cursor skew.** `scannedThrough` advances past malformed/skipped tail logs, but the
  committed anchor was the last DECODED event's block hash → a malformed tail left the persisted hash
  lagging the cursor; the next ancestry proof then validated a stale sub-cursor block and could miss a
  reorg above it. **Fix:** anchor the committed fork on the PINNED CHECKPOINT HASH (which every page
  validated against), never a decoded-events hash. Removed `topBlockHash` (now unused). Also switched
  the null-checkpoint-hash path from a 1-page cap to a full DEFER (the class gate already fail-closes
  that tick — see #7 — so the forward-scan defer is a defensive fallback).
- **#7 same-height reorg + TOCTOU.** The class-gate cache was keyed by tip NUMBERS (a same-height
  checkpointed reorg served a stale "standard"), and the checkpointed anchor was resolved via the
  SYMBOLIC `"checkpointed"` tag (the node could show fork A for the class query then serve fork B for
  the scan). **Fix:** pass the EXACT pinned checkpoint hash into `getContract` (a `BlockHash`, not the
  tag) and key the cache by that hash. Threaded the checkpoint hash through the `getPublicTokenClassStatus`
  RPC. A null hash → `unresolved` (fail closed).

## Codex round 5 — verify the round-4 fixes (same session)
CONFIRMED Fix B (class-gate hash pin + hash-keyed cache closes the TOCTOU + same-height hole). Found
two more High in the forward/pending-page arm:
- **A1 — watermark outran the cursor.** `lastScanFinalized` advanced to `finalized` every tick, even
  when the forward scan was budget-INCOMPLETE (`hasMore`) or DROPPED and the cursor lagged finality.
  A later reorg then reconciled `[finalized+1..checkpointed]` and jumped the cursor forward, PERMANENTLY
  skipping the unscanned logs in the `(cursor, finalized]` gap. **Fix:** a `finalizedWatermark` helper
  = `min(finalized, highest-contiguously-scanned-block)` — capped at `scannedThrough` when `hasMore`,
  at the cursor when `dropped`, at `checkpointed` only when the scan actually reached it.
- **A2 — pending-page recovery TOCTOU.** `pendingPageReorged` used a standalone canonicity probe of
  the stale `upperHash` (same flaw the forward boundary already fixed) — a flapping/lying node exposes
  the old fork here, the new one during the scan, the marker clears, orphan survives. **Fix:** the same
  atomic ancestry membership proof — `upperHash ∈ archive(current checkpoint hash)` — and set
  `pendingPage.upperHash` to the pinned checkpoint hash. Also fixed the Low (capability e2e test now
  passes the checkpoint hash to `resolveTokenClassStatus`).

## Codex round 6 — convergence check (same session)
CONFIRMED A2. Two more class-(a) (honest-node reachable) issues:
- **A1 off-by-one.** A budget-limited scan stops MID-block, so `scannedThrough.blockNumber` is only
  PARTIALLY scanned; the safe floor is `scannedThrough.blockNumber − 1` (else a reconcile skips the
  rest of that block). Also made the floor MONOTONIC (`max(oldFloor, …)`) and dropped-safe (a dropped
  scan confirms nothing new → floor unchanged).
- **Checkpoint ROLLBACK.** Aztec prunes the checkpointed tip back to the proven tip; a rollback (100→90)
  correctly fails the ancestry probe, but reconcile `[..90]` left records at 91–100 (above the new tip)
  undeleted, and a cursor stranded above 90 skipped the replacement chain. **Fix:** `finishReconciliation`
  now DELETES records above `marker.upperBound` (stale/rolled-back), and rewinds a stranded cursor to
  `null` (re-scan from `startBlock` as the checkpoint re-advances). The finalized guarantee (checkpointed
  never rolls below finalized) keeps `lastScanFinalized ≤ new checkpointed`, so the reconcile window stays
  valid.

Codex's convergence call: no Critical since round 2; the ONLY remaining residuals are class-(b) —
lying-node log omission/mangling, an upgrade→emit→restore squeezed between the two gate samples, and a
persistently-null-checkpoint-hash scanning stall. All are malicious/degraded-node, display-only (never a
forged balance — balances are independently simulated) and ACCEPTED for a display-integrity feature.

## Codex round 7 — final verdict: SATISFIED
Both round-6 fixes CONFIRMED-FIXED. Codex's exact words: **"No class-(a) Critical/High remain —
satisfied."** 7 rounds, ~14 real issues found + fixed on the D6 reorg/reconcile/class-gate/outbox arm.
The remaining residuals are all class-(b) (lying/degraded-node, display-only — never a forged balance,
since balances are independently simulated) and are accepted + documented above.

## Fixes applied (rounds 1–6)
- **Critical #1** (final): per-page checkpoint-fork-hash pin + `toBlock` bound + 1-page cap when null +
  an ATOMIC boundary-ancestry membership proof (`verifyAncestorHash`).
- **Critical #2**: `dropped` discriminator; reconcile defers on a dropped page, never finishes.
- **High #3**: pin the reconcile scan to `marker.upperBound`; DEFER (not clamp) when the pin exceeds
  the node's checkpointed.
- **High #4 (drain)**: `{missing:true}` return vs a transient throw; delete only on missing.
- **High #5 (epoch)**: bump inside the account-add reset critical section.
- **Med #6**: height-deduped `seen`.
- **#7**: dual-anchor (`finalized` + `checkpointed`) class gate, cached by both tips.
Runtime + indexer + service unit/scenario coverage added for each. `bun run audit:vue` green.
