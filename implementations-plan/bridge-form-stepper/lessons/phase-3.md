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
