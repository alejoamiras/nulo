# P3 · The Details table on the check's key

## What changed

`rowFor` keys a contract with `fieldAddressKey(contract) ?? contract.toLowerCase()`, imported from
`@nulo/wallet-bridge` (the window already imports values from it, `permission-rows.ts:7`). For a
valid address the key is the string the old `toLowerCase()` produced, so no row moves; what the
change buys is that the table and the check now read one definition. The name lookup
(`details-table.ts:34-37`) keys the same way as before, since the known-contracts list is
lower-cased at its source.

A held value spelled `0X…` is not a field address, so it keys by its lower case and shares the row
of its `0x…` spelling while the check refuses it: an overstatement, never less reach, as § Security
already says of held malformed values, and as the comment states.

## Gate

- `bun run lint`: exit 0, 29 warnings and 3 infos (unchanged), `complexity-baseline check OK`.
- `bun run typecheck:all`: exit 0, all 15 workspace typechecks.
- `bun --bun vitest run src/popup/windows/capabilities/` in `apps/extension`: exit 0, 8 files,
  144 tests passed. Among them: the parity test ("two valid spellings share a row exactly when the
  check lets a scope of one reach the other"), its malformed half ("a held value that is not an
  address keeps its lower-cased row, and the check refuses it everywhere"), the `build-items` case
  ("private events held in another case add no row: only the address book is new"), the existing
  case-blind test ("a contract appears once, matched case-blind, …") and `index.test.ts`'s 35
  tests, which the diff leaves untouched.
- `bun run test:all`: exit 0, the same counts as P2 (extension 7842 passed, 4 skipped, 8 todo;
  wallet-bridge 478; no workspace red).

As the plan predicts, these tests already passed on P2's code alone: the gate proves the behaviour,
and the shared import is what review checks (Outcome 3).
