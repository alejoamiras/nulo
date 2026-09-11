# Phase 6 — the attach handoff, the affordance, the copy, cells 31b/31c

Arc 3 (`tools-recovery/exit-attach`). Gate: the Phase 5 commands green again;
`src/composables/useBridgeJournal src/lib/record-policy src/components/BridgeJournalCard src/composables/useHubExit src/composables/exit-attach src/composables/deposit-reconcile`
(8 files, 273 tests) green; typecheck (app + browser tests) exit 0; `bun run lint` exit 0;
`bun run e2e:tools -- specs/exits.spec.ts` on its own sandbox at retry 0 — see § Cells.

## What landed

- Engine: `findExitTx` dep; `withRecordLock` reports `"ran" | "held"`; `rekeyJournalRecord` split into
  the kv write + `adoptRekey` (session liveness, foreground, id map, runtime carry); `attachAndConsume`
  (exported) — the hash's record lock first, `rekeyRecordWhen` under the journal lock inside it, then
  `runWithdrawConsumeLocked` for the new id in its own error boundary (`surfaceRunFailure(H, e)`);
  `attachExit` replaces the dead `unknown-outcome` branch for send exits: narrates "looking for the
  exit on Aztec", excludes every hash and id the journal holds, and hands the match to
  `attachAndConsume` with the guard (`sameExitSnapshot`, no exit/consume hash, not completed,
  destination free, generation unchanged); "held elsewhere" and "moved" get their notes; without a
  lock API the attach fails closed. `none` / `ambiguous` / `incomplete` notes.
- `useHubExit.ts`: the live exit's re-key + consume goes through `attachAndConsume` (a refused
  handoff means another tab already holds this hash: the provisional copy is discarded);
  `findExitCandidate` adapts the node client (`TxHash.fromString`) and passes the target's identity.
- `record-policy`: `exitAttachable` (FINISH for a hash-less send exit; legacy keeps Discard-only);
  `depositLegRecoverableOf` / `exitAttachableOf` split out for the complexity budget. Card copy.
- L1 fixture: parked holds keep their `perform`; `release()` answers them. Cell 31b flipped to the
  attach; cell 31c added (two tabs, one swallowed exit, a parked portal transaction, one
  `eth_sendTransaction` across both pages).
- Engine tests: attached ⇒ done under the hash with the old id's runtime gone; a throw after the
  re-key reported against the new id; a second FINISH refused by the hash's lock; live exit vs attach
  (held elsewhere); attached but already finished on L1 ⇒ `consumedByOther`; the three notes; a throwing
  search; discarded / identity-moved records never re-keyed; a hash that is already a record refused;
  no lock API ⇒ fail closed while a plain consume runs; an unwired finder keeps today's note; the
  handoff itself (attached, then refused onto an occupied id).

## Lessons

- `runWithdrawConsumeLocked` sat at the complexity ceiling: the hash-less branch lives in
  `recoverExitHash`; `recordState` needed two extractions (`depositLegRecoverableOf`, `exitAttachableOf`)
  and an `idle` alias to stay under 15.
- Arc 3 was re-stacked onto every arc-2 codex fix by plain `git rebase` (local, unpushed); the phase
  ticks quote the FINAL commit hashes once the stack stopped moving.
- The test wallet's per-frame `submitted()` list resets on reload: cell 31b captures the burn's hash
  before the reload and compares the attached record against it afterwards.

## Arc-3 codex loop (post-implementation, `/codex high`, read-only)

**Round 1** — session `01a090dd-d3d5-7fc0-8ba9-489f56db1f8d`, verdict `request-changes` (1 high, 4 medium, 1 low).
Verified against the code, all accepted and fixed in one commit:
- H1 *the live exit discards its provisional record on "held elsewhere", but contention can be
  another tab's attach still awaiting the journal lock — its re-key then finds no source and both
  records are gone* — the provisional record is dropped only once a record with the hash exists.
- M2 *the attach's re-read (`verifyExitTx`) ran outside the search's budget; a hanging node pinned the
  lock and the busy state* — `findVerifiedExitTx` shares one `budgetedReads` with the search
  (`searchExit`); pinned under fake timers.
- M3 *an ordinary FINISH on the already-attached hash (cell 31c's second tab) hit `withRecordLock`'s
  "held" silently* — `withRecordLock` reports `"held-local" | "held-elsewhere"`; both runners' entry
  points note "Another tab is finishing this exit / claiming this deposit - try again in a moment."
  for the cross-tab case only; pinned for the exit and the deposit.
- M4 *no consistent chain snapshot across the scan* — the tip's hash is read before and after; a
  change ⇒ `"incomplete"`.
- M5 *the binary search scans the latest block when every timestamp predates the window* — a tip
  older than the window ⇒ `"incomplete"` (the deposit finder gets the same guard, on arc 2).
- L6 *`token.portal` missing from the re-key guard* — added (the test on it was dropped: the journal
  loader quarantines a record whose portal contradicts its token, so the case cannot be staged).
- Comments: the finder header shortened to index-zero / attribution / incomplete semantics; the
  `adoptRekey` line cut; the handoff doc tightened to lock order, non-reentrancy and error ownership;
  the live exit's comment no longer claims a refusal proves a duplicate.
- Not addressed: "two independent journal instances" (one module instance per test process; the
  browser cell 31c is the two-instance proof).

**Round 2** — resumed, verdict `request-changes` (2 medium, one test-only). Both accepted and fixed
(`63fbd65e`):
- M4 during the re-read: `scanExit` hands `{ pick, assertTipUnchanged }` to its callers; the attach
  compares the tip after the `getTxEffect` re-read, the plain search right after the scan. Pinned with
  a fake whose tip hash flips once an `effect:` read has happened.
- The H1 pin now runs through `useHubExit().exit()` with the hash's runner held in the in-memory lock
  table: the provisional record survives, the hash is not a record, nothing is consumed. Lesson: the
  composable re-wires `locks` from its own (node-absent) adapter, so a test's lock table must be
  connected AFTER `useHubExit()`.

## Cells

- `exits.spec.ts` in full at `cb34fe55`/`4868cb57` (pre-fix build): 27, 28, 29, 30, 31 ✓; 31b and 31c ✘ —
  **"More than one matching exit was found"**: cell 28's two 5-unit private exits to the same L1
  address (one L1 account per spec file) sat inside 31b's window, exactly the documented limitation.
  The attach cells now exit amounts no other cell in the file uses (7 and 9). 31b + 31c alone at
  `f4593d94`+: **2 passed** (3.9 min) — 31b attached, consumed and finished (1.4 min); 31c's second tab
  was told a tab is finishing it, one portal transaction across both (1.7 min).
