# faucet-journal-bugs — lessons (phase 1)

Round-3 plan 5 (blueprint mid). One codex session (fresh; blueprint audit → PR review) plus one
fable-role audit in parallel on the first draft.

## Consults

| Turn | Who | Ask | Verdict | Folded |
|---|---|---|---|---|
| 1 | fable-role | blueprint audit (first draft) | conditional approve | (1) B's hash clear must be a compare-and-set on the reverted hash — a late poll in one tab would otherwise wipe another tab's fresh hash (the dropped-streak clear has the same latent flaw; not copied); (2) a journal-side `patchFuel` calling the internal `patchRecord` would bypass the characterization harness, which traces the EXPORTED `updateRecord` — the helper writes through that export; (3) `reconcileFuelConsumed` (`useDeposit.ts:88`) and `sendStandaloneFjClaim` (207/216, after up to 40×6 s of polling) are the same stale class — inventory corrected; (4) B's success criterion restated per ladder (private fueled ⇒ "consumed" stop, not a resend) and the session-live auto-resend on reconnect surfaced (A2) and pinned; (5) I5 reconciled by keeping the note copy verbatim; A1 restated: the card's explorer link is lost |
| 2 | codex | blueprint audit (first draft) | **reject** | blocking: (a) cross-tab freshness — this tab's reactive `records` can lag kv, so A reads the PERSISTED record (`currentRecord` = reload from kv, then find) and B's CAS compares against it; true exclusion (Web Locks) is out of scope by scope § 5 (F11 stays as it is) → residual R1 + owner ask A3; (b) included-revert outcomes undefined for private-fueled and direct-FJ records → per-variant criterion (fjwc ⇒ sponsored fresh send; private ⇒ consumed stop; direct-FJ ⇒ simulate rejects the consumed message, argued unreachable on the live shape) each pinned, plus a live `{status, executionResult}` coupling test. Corrected on its evidence: the direct-FJ `setupInsufficiency` reader does not exist (the resurrection is data hygiene, not a double-mint); the direct-FJ characterization mock must invoke the callbacks for test 2. Agreed independently with fable on both decision points (scoped helper, terminal-only clear; forensics only ever as a separate non-routing field) |

| 3 | codex | blueprint audit round 2 (reconciled draft) | conditional approve | five conditions, all folded: (1) the freshness read must not touch the reactive ref → `currentRecord` = `loadJournal(deps.kv).find(…)`; (2) "CAS" was two reads → the guard now lives INSIDE the load-then-write (`bridge-core` `patchRecordWhen`), named an expected-hash guard, with the residual stated honestly (localStorage has no atomic CAS; the window is the same one every `patchRecord` has); (3) "unreachable" is not an argument for direct-FJ → the builder fail-stops on an included `fuel.claimTxHash` (rebuilds on dropped), pinned both ways; (4) a `sendStandaloneFjClaim` stale-write pin (the largest window); (5) latch-callback invocation in the direct-FJ builder mock is opt-in so the two existing direct-FJ snapshots stay; recon's stale helper/RETRY sentences corrected. Tests 5 and 7 confirmed non-redundant; the live coupling test kept |

## Decision ledger

- **Helper**: kv-fresh READ in the journal (`currentRecord`) + WRITE through the exported
  `updateRecord` in deposit-flow — fable's trace-preserving placement with codex's persisted-not-
  reactive freshness. Whole-block constructions stay explicit.
- **Revert**: clear the hash with a CAS on the reverted hash; no routing flag; forensics deferred to
  the owner (A1).
- **Residuals stated in the PR**: R1 cross-tab double send (pre-existing); R2 checkpointed-as-final;
  R3 L11 under tampered storage (unchanged).

## Lessons

(filled as the PR lands)
