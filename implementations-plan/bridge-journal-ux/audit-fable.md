# Fable audit (round 1) — bridge-journal-ux plan v1

Verdict: MAIN, with two grafts from COMPETING — (a) render-time allowance probe as the
chain-truth cross-check behind any "no funds moved" claim, (b) redo-as-fallback for records the
RESUME validators reject.

Concerns (ranked):
1. SEC — cross-tab double L1 deposit: withRecordLock is tab-local (inFlight Set); two tabs both
   pass the depositTxHash re-read and both send. Needs journal-first resumeAttemptAt latch +
   re-read immediately before writeContract.
2. SEC — "depositing, no hash" is NOT fund-safe: a tab killed between wallet-confirm and
   writeContract resolving leaves a broadcast deposit with no hash. Hedged copy + wallet-activity
   interlock; no blind RESUME for that cell.
3. SEC — hostile-field validation: recompute secretHash from journaled secret (and salt+claimer
   for private) and require == record.id (the id IS the secretHash, so tampered fields
   self-invalidate); connected-account equality guard; private records validate against the
   sealed envelope, not the plaintext copy.
4. PHASE — failedStep union needs "signing" (fueled Permit2 leg) or J5 reopens J1.
5. PHASE — J5 traps: re-quote must patch fuel.minOutput (else the journal lies); sealKeys empty
   post-reload means the finalized-envelope re-seal can't run on resumed private deposits —
   accepted degradation, must be documented.
6. ASSUME — fact fixes: deriveDepositStage is journal.ts:259-264; token fuel pre-fields at
   useDeposit.ts:731-743; the APPROVE phase already exists in bridge-steps.ts:52-58 — the real
   J3 bug is the post-reload activeKey fallback to "deposit" (bridge-steps.ts:71).
7. UX — approve() swallows errors into error.value; the new hash exposure must define the
   failure path.

Looks fine: click-only; same-record continuity; additive fields need no migration (loader gates
only id/direction); fuel-first risk split; COMPETING loses standalone (can't distinguish legs,
destroys audit trail).
