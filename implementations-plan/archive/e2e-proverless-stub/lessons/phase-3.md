# Phase 3 — confirm ordering assert + reclassification + drop authwit gate ✓

## Delivered
- **`concurrent-sendtx-confirm`**: added the deterministic ordering assert — hold T1
  at `proving` via the gate, then snapshot two in-flight cards (T1 `proving` + T2
  `queued`), release, both confirm `ok` with `r2.seq > r1.seq`. The non-timing signal
  that the execution mutex serializes T2 behind T1.
- **Reclassification**: `multi-account-from` → PLAIN (D7, Phase 0); `tx-sendTx-noFrom`
  → PLAIN (never proves). The full prover-ON canary set is finalized in Phase 4.

## Bug found + fixed (timing)
First run failed: `expected ['queued','simulating'] to include 'proving'`.
`waitForSendTxActiveStage` returns at the FIRST active stage (`simulating`), so the
snapshot landed BEFORE T1 reached the gate-held `proving` stage. Fix: `waitForFunction`
polling for a card at `data-stage="proving"` before snapshotting (same pattern as
cancel-mid-prove's prove-entered wait). Passes after the fix.

## Flake note
One run failed earlier in the fixture (`connectPlayground:awaitVerifyPopup — detached
Frame` → `ctx` undefined), unrelated to proverless or my code — a known dApp-connect
handshake flake, cleared on re-run. (Same fixture passes for concurrent-sendtx-approve.)

## Deferred (cross-arc)
- **Drop `RUN_AUTHWIT_E2E` gate**: N/A on this branch. The gate + `authwit-consume-smoke`
  / `authwit-lifecycle` tests live on the unmerged authwit arc (PR #85), NOT on `dev`.
  This branch is off `dev`, where only `authwit-variants.test.ts` exists (standard
  `skipIf(!hasConfig)`, no proverless-relevant gate). When the authwit arc lands on dev
  and this branch rebases, drop the gate then (or fold into the authwit arc). The
  proverless build already makes those tests fast — no gate to remove here.

## Gate — met
- `bun run lint` ✓ · `bun run typecheck` ✓.
- `concurrent-sendtx-confirm` proverless green (ordering assert + both confirm).
  (cancel-mid-prove + concurrent-sendtx-approve covered in Phase 0/2.)

LESSONS_FILE=implementations-plan/e2e-proverless-stub/lessons/phase-3.md
