# Phase 2 · The check

`LESSONS_FILE=implementations-plan/failed-send-check/lessons/phase-2.md`

## Step 1: the mappers moved first

`transaction/receipt-status.ts` holds `txStatusFromReceipt` and `executionResultFromReceipt`, moved
verbatim with their revert comment. `bun --bun vitest run src/wallet/services/transaction` before
any other edit of this phase: 2 files, 28 passed, exit 0, no test edited.

## Red run (new tests, unbuilt code)

`SendCheck` existed only as a skeleton with its final API (constructor, no-op `start`/`stop`), so
the new cases fail on behaviour, not on a missing module. From `apps/extension`, the four new test
targets: **30 failed, 309 passed**, exit 1.

- `operation-journal/send-check.test.ts`: all 26 cases fail (`expected [] to deeply equal
  [ { id: 'op-1', check: 'sent' } ]`, `expected "vi.fn()" to be called 24 times, but got 0
  times`). Two guard cases first passed vacuously on the skeleton: "deleted while its node is
  looked up" and "settles after `stop()`" asserted only that nothing happened. Both now assert that
  the read began before the event, and fail on the skeleton.
- `runtime.post-start.pins.test.ts`: both pins fail (`check:new`, `check:start`, `check:stop`
  missing from the order log).
- `incoming-transfer/service.scenarios.test.ts`: the failed-row case fails (`expected "vi.fn()"
  to not be called at all, but actually been called 1 times`: the send's own note was recorded as
  incoming).
- `execution/service.composition.test.ts`: the lost-response case fails on `waitFor timeout`
  (nothing answered the row); the file's other cases pass.

## Build notes

- **Test hashes must be field elements.** `TxHash.fromString` parses a BN254 field element, so a
  `0x` + 64 hex value above the modulus (`0xabab…`) throws before any dial. The first build run
  showed every receipt read failing; the tests now use `0x1f…`, `0x2e…` and `0x1e…`.
- **The incoming case sits in `service.scenarios.test.ts`**, beside "dedupe source 3", not in
  `service.test.ts`, which holds only the pure ordering tests and no service harness. Its journal
  stub filters as the journal does. The shared `makeJournalStub` ignores the filter and its rows
  carry no `terminalAt`, so the change reads `getOperations({ profileId })` and skips terminal
  stages other than `failed` in code (`isTerminal(stage)`), which leaves every existing case green.
- **The slow-read case raced once**: the receipt's resolution and the next tick settled in the same
  microtask flush, so the tick still saw the read in flight. Seconds separate them in a real
  worker; the test settles the read before the tick.
- **The lost-response case** asserts the send, the failed row with its hash and endpoint, the
  `sent` answer on the recorded endpoint and the balance refresh. The card's "Sent" joins it in P4,
  once the card renders the outcome. The harness gained two things: `toTx`'s return type widened to
  `string`, and `isFenceLive` returned, so the check gets the same fence functions as the executor.
- **One log shape beyond the plan's two**: `{ journalId, stage: "read-error" }` at debug, for a
  journal read or write that throws. The row stays watched and is read at the next cadence.
- **Wiring**: armed between the reaper and the GC, stopped in the same order; `stop()` is
  synchronous (it bumps the generation, clears the timer, unsubscribes and drops every watch).

## Gate

| Command | Exit | Counts |
|---|---|---|
| `bun --bun vitest run src/wallet/services/operation-journal src/wallet/services/transaction src/wallet/services/incoming-transfer src/wallet/services/execution/service.composition.test.ts src/wallet/runtime.post-start.pins.test.ts src/utils/log-payload-ban.test.ts` (apps/extension) | 0 | 20 files, 511 passed |
| `bun run lint` | 0 | 29 warnings, 3 infos (the base's counts); complexity baseline OK, manifest unchanged |
| `bun run typecheck:all` | 0 | every workspace |
