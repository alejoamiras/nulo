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

## RESULT (spike run, fresh sandbox)
`status=error`. The private NO_FROM failed during the kernelless DISCOVERY
simulation (`simulatePublic=true skipTxValidation=true`) with a Noir constraint
error: **`Cannot satisfy constraint 'self._is_some'`** (functionSelector 851827960).
It never reached an active/proving stage — it dies at simulate.

Read: under DefaultEntrypoint there is no account-contract context, so an
arbitrary `transfer_public_to_private(from=accountAddress, …)` can't satisfy the
token's note/authorization constraints. The kernelless authwit discovery doesn't
fix this — the constraint fails inside the discovery sim itself. Other token
private fns face the same (transfers need notes + from-auth; `mint_to_private` is
minter-gated). NO_FROM/DefaultEntrypoint isn't designed for a user-account token
transfer.

## CONCLUSION → blocked (report, don't thrash)
- The realistic candidate errors BEFORE active → BOTH the confirm test and the
  boundary fallback are infeasible (both need an active stage).
- No obvious NO_FROM-compatible private call that confirms; chasing the Noir
  constraint is open-ended (the "don't thrash" line).
- **Crucially redundant:** the execution mutex is ALREADY e2e-proven on the
  STANDARD path (v3 `concurrent-sendtx-confirm`, merged), and the NO_FROM path
  uses the byte-identical `acquireExecutionSlot(originKey, onEnqueued)` integration
  (unit-tested + codex ship-it). A NO_FROM-specific e2e adds little.
- Per the loop's hard limit (real design fork → STOP + report), and since P1 (the
  actual deliverable) is complete + validated, stop here and report. Recommend
  shipping P1 alone; defer the NO_FROM e2e as a documented follow-up.
