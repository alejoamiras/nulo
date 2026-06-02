# P2 phase 5 — NO_FROM concurrency spike

## Investigation
- `buildNoFrom` enforces **exactly ONE call** + **"DefaultEntrypoint only supports
  private functions"** (tx-request-builder.ts). The playground's
  `transfer_public_to_public` is PUBLIC → NO_FROM rejects it. So the existing
  `tx-sendTx-noFrom` (public transfer) can never confirm via NO_FROM — its lenient
  `["ok","error"]` is effectively always-error.
- Token private fns: `transfer_public_to_private`, `transfer_private_to_*`,
  `mint_to_private`, `burn_private`, … Candidate for a confirming NO_FROM:
  **`transfer_public_to_private`** (from = the dApp account with a pre-minted public
  balance → to = recipient private note).
- The UNKNOWN: under DefaultEntrypoint `msg_sender ≠ from`, so the transfer's
  authorization must come from the kernelless authwit discovery in
  `executeNoFromSendTx`. Whether that makes it CONFIRM is empirically unknown —
  hence the spike. (codex: "accepted by DefaultEntrypoint ≠ deterministically
  confirms; verify end-to-end state.")

## Spike setup (this fire)
- Added playground `pg-btn-sendTx-noFrom-private` (transfer_public_to_private via
  NO_FROM); parameterized `buildTransferExec(callCount, fnName)`.
- `noFrom-spike.test.ts` (THROWAWAY, working-tree only — not committed, would run
  in CI): pre-mint public balance, fire the private NO_FROM, approve, log
  status + error, assert ok.
- Run launched on a fresh sandbox; result pending.

## Decision tree (next fire, from the run)
- **status=ok** → expand to 3× confirm; then build the funding fixture +
  `concurrent-sendtx-noFrom-confirm.test.ts`. Replace this spike.
- **reaches an active stage (proving) but fails** → boundary test is viable (active
  is enough); build the NO_FROM approval-boundary test instead.
- **errors before active (build/simulate)** → BOTH confirm + boundary infeasible
  (the plan's boundary fallback assumed an active stage is reachable) → STOP +
  report with the empirical evidence.
