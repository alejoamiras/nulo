# Phase 4 · A-27's spoken name (A-27)

- **Red**: in `components/composite/capabilities/DetailsTable.test.ts` the regex case and the
  `test.todo` became one exact case over the wire-shaped fixtures: "Unknown contract 0x0c1e…5a7f:
  simulate, add, transact" and "Unknown contract 0x0643…15fd: add, transact" (O3 (b)). From
  `apps/extension`, `bun --bun vitest run src/components/composite/capabilities/DetailsTable.test.ts`
  → exit 1, 1 failed, 12 passed; received "0x0c1e…5a7f: simulate, add, transact".
- **Change**: `spokenName`'s unknown branch reads `Unknown contract ${shownAddress(address)}`, so
  the name keeps the visible row's sanitised, truncated address. The function now builds its name
  and columns in two lines, and its comment keeps the hidden-head reason and gains the one clause:
  an unknown row's name says so, since a Tab to it skips its sub-header. No e2e reads the name
  (`network/cap-window.test.ts` reads the row's testid and `aria-expanded`).

## Gate

- `bun --bun vitest run src/components/composite/capabilities/DetailsTable.test.ts` → exit 0, 13
  passed, 0 todo.
- `bun run lint` → exit 0 (28 warnings, 3 infos, the base's; complexity-baseline OK). ✓
