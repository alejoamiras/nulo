# Phase 3 · The popup waits and says what it knows

`LESSONS_FILE=implementations-plan/failed-send-check/lessons/phase-3.md`

## Red run (new and updated tests, unbuilt code)

From `apps/extension`, the four gate files: **34 failed, 68 passed**, exit 1.

- `execution/client.test.ts` (new): the three deadline cases fail. At 61 s the transfer is already
  rejected (`expected 'rejected' to be 'pending'`: the base's 60 s `RpcTimeoutError`); the sixty-
  minute case fails at its first expectation for the same reason; the reopened client times out
  at 60 s too. The three pins pass on the base, as the plan says they must: a dropped port rejects
  with the plain `Error("Client disconnected")`, `disconnect()` leaves no pending entry, timer or
  port listener, and `estimateTransferFee` ends at 60 s.
- `send-submit.test.ts`: every new variant and every updated pin fails on the base's single
  "Send failed · Simulation failed, transaction not sent" (`transferFailureSnack` and the new copy
  constants do not exist yet, so the expected strings read `undefined`).
- `transfer-failure-copy.test.ts`: all six cases fail (`transferFailureSnack is not a function`).
- `send.test.ts`: the updated pin fails (`Send failed` where `Send status unknown` is expected).

## Build notes

- **A lost answer needs no branch of its own.** A timeout, a send-time port failure and a dropped
  port are raised in the popup and never name a journal record, so the record-less path already
  reads them as "Send status unknown". The three cases are pinned in `send-submit.test.ts`
  (`RpcTimeoutError`, `RpcDisconnectedError`, the plain disconnect `Error`), with no journal read.
- **The Details fixture gained a stage.** A failed record with no `from` now reads "Send status
  unknown" without Details, so the suite's default record is failed from `proving`, as every row
  the journal writes now is. Records without `from` predate the change (realism 5) and have their
  own case.
- The Terms refusal keeps its words and its Details even when its record is checkable: the Terms
  check sits before `node.sendTx`, and the ledger's realism 2 covers the record's conservative
  reading.
- `transferFailureCopy` became `transferFailureSnack(err, record)`, returning label, sub and
  whether Details may show. `TRANSFER_FAILED_COPY` ("Simulation failed, transaction not sent") left
  the tree: O4 (b) is built on its capture branch only.
- The client's deadline is a module constant, and the test states sixty minutes itself, so a
  changed constant fails it.

## Gate

| Command | Exit | Counts |
|---|---|---|
| `bun --bun vitest run src/wallet/services/execution/client.test.ts src/popup/pages/send-submit.test.ts src/popup/pages/send.test.ts src/popup/utils/transfer-failure-copy.test.ts` (apps/extension) | 0 | 4 files, 102 passed |
| `bun run lint` | 0 | 29 warnings, 3 infos (the base's counts); complexity baseline OK |
| `bun run typecheck:all` | 0 | every workspace |
