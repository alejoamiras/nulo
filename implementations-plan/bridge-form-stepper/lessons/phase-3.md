# P3 — wallet chips + rename + gates (lessons)

## 2026-06-10 — P3 COMPLETE (`e0e856c`)
- Both wallet panels restyled to one-row chips (`[ETHEREUM · addr ✕]` / `[AZTEC · addr ✕]`) — ALL logic untouched (connect, wrong-chain switch inside the L1 chip, the Aztec verification modal + intermediate states as wider status chips); ✕ carries the existing disconnect testids + aria-label. `BridgeView .wallets` → wrapping flex row.
- "IN-FLIGHT BRIDGES" → "PENDING BRIDGES" + honest sub-copy + "Nothing pending." empty state.
- Gates: `bun run audit:faucet` exit=0 · `bun run audit:vue` exit=0 (both in the transcript). Suites: faucet 228 ✓ · smoke 9 ✓ · build ✓.

LESSONS_FILE=implementations-plan/bridge-form-stepper/lessons/phase-3.md

## 2026-06-10 — post-impl
/code-review max --fix: sealed-envelope patch verification (`212078c`, separate commit). Codex post-impl: reject (rekey foreground orphan) → fixed `332b27b` (form reads engine activeFlowId; CAS-only releases; rekey pin) → flip: **approve** (file:line-verified). Suites 229 ✓ smoke 9 ✓.

LESSONS_FILE=implementations-plan/bridge-form-stepper/lessons/phase-3.md

## 2026-06-10 - manual-test feedback round (`0b9520d`)
- **Claim stuck at "Confirming" forever (user report, both surfaces): ROOT CAUSE = Aztec 4.2.0 `TxStatus` has NO `success` value.** The enum is block-finalization state: `dropped | pending | proposed | checkpointed | proven | finalized`. A confirmed claim reads `checkpointed` then `proven` for epochs before `finalized`; our matcher accepted only `success|finalized`, so confirmed claims polled as "pending" until the 10-round cap. Fix: inclusion = `checkpointed|proven|finalized` (plus legacy `success|mined`), with the separate `TxReceipt.executionResult` carrying the revert signal. Added per-check `receipt check {id, checkNo, status}` logging + the lookup-failure message so the next anomaly diagnoses from the console.
- Wallet chips: 999px pills violated the brutalist system (the extension is `border-radius: 0` everywhere) - chips now sharp; the privacy toggle's round knob is functional and untouched.
- Em-dashes dropped from all faucet copy (mechanical sweep, 45 files, tests included).

## 2026-06-10 - confirmation-policy round (user report: "couldn't be verified" dead-ends)
- Two compounding causes: (1) the checkpointed fix made receipts flip "success" at the EARLIEST inclusion state, while the message probe verifies through the wallet's lagging PXE - simulate still saw the message ⇒ false/null ⇒ scary note; (2) the "press CLAIM" escape hatch was a TRAP for already-claimed records: a consumed message throws the SAME "no message found" wording as a not-yet-synced one, so the gate looped forever.
- Owner policy (user decision): **a checkpointed receipt IS confirmation.** Local-provenance sends complete with no probe; rediscovered records get a best-effort probe that can only DELAY (probe false ⇒ keep polling with "waiting for your wallet to sync") - null/unverifiable completes on the receipt. Residual risk accepted + documented in-code: forging a checkpointed claimTxHash needs localStorage write, which already owns the journal.
- Pins reworked: ⑰ local-provenance completes despite PXE lag; ⑰a rediscovered+still-claimable keeps polling to the soft cap with NO attention; ⑰b rediscovered private completes prompt-free (0 signatures, no auto-unseal); ⑰c explicit-CLAIM single-signature verify unchanged.

## 2026-06-10 - sync countdown round (raven research fold)
- Researched raven-bridge-frontend (subagent): their "blocks remaining" is a FIXED-MARGIN countdown - snapshot `node.getBlockNumber()` when the L1 deposit confirms, target = snapshot + 3, poll + render the delta. No message-awareness, no PXE check; they claim blind at zero.
- Combined theirs + ours: `depositL2Block` snapshot persisted on the record (optional field, backward-compatible); the SYNC phase first counts down "Aztec block X of Y - Z until your funds arrive" WITHOUT touching the PXE (no simulate churn), then hands to the claim-simulate gate with honest copy "message arrived - waiting for your wallet to sync it (check N)". The gate stays the consumability authority; the countdown can only pace, never green-light. Fallbacks: missing snapshot/dep/node ⇒ straight to the gate with the old copy.
- Pins: countdown defers simulates (order-log assert: 4 block polls before the first simulate, completes after); missing snapshot ⇒ zero block polls, gate immediately.

## 2026-06-10 - L2-balance "-" RESOLVED: stale extension build (user environment)
- The raw error ("Scope violation: executeUtility.opts.scopes ... not in session's approved accounts") came from an OLD wallet build loaded in the browser - predating the branch's scope-tolerance fixes. Reloading the current build fixed balances with no app change.
- KEPT from the hunt (real improvements): `useTokenBalance` settles public/private independently (one failing path never blanks the other) + stores/logs RAW per-path errors (`normalizeError` toast copy had masked every failure as "Something went wrong"); BridgeForm renders "balances unavailable - retrying" instead of an eternal silent "-". The diagnosis took exactly one console paste once the masking was gone.

## 2026-06-10 - dopamine round (waiting-UX research applied, both surfaces)
- Research basis: NN/g progress indicators + visibility heuristic, HBS labor illusion / operational transparency, goal-gradient + anticipation dopamine, queue-psychology countdowns (overestimate), Kahneman peak-end.
- ONE shared `BridgePhaseRail` (full for the stepper, compact strip for the journal cards) over the same mapper - cards now show the identical phase glyphs, live detail, bars, and clocks. Card testids `journalRail`/`journalPhase` kept distinct from the stepper's (one-surface pins must not collide); `journalStep` testid preserved on the rail's detail line.
- Labor record: `lib/phase-clock.ts` (module clock, display-only, shared across surfaces; reload degrades honestly) - completed phases keep "✓ DEPOSIT - 14s"; active phases tick a live timer + deliberately OVERESTIMATED eta hints; mapper gains `progress` (SYNC blocks via new runtime.syncBlock; PROVE proven blocks - NEVER fabricated elsewhere) rendered as ▓░ bars.
- Peak-end: receipt opens with a stamped BRIDGED ✓ / RELEASED ✓ banner + "Xm Ys end to end" (from persisted createdAt/completedAt - survives reloads); done cards show the same stamp + mint flash during their 8s grace; every phase completion plays a 220ms stamp-in.
- Gotchas: vitest fake-timer cross-test contamination - zombie mounted components keep ticking into later tests and share the module phase-clock when record ids repeat (unique ids + unmount per test); `advanceTimersByTimeAsync` also advances `Date.now`.
