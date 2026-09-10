# Phase 4 — the accounts cells

Commit `9718f2cf` (arc 2).

## What landed

- Fixtures: `l1-wallet.ts` `holdNext(kind, { to })` (a hold narrowed to the router, so the ERC-20
  approval before the deposit goes through), `calls(method)` per-method counters, `permits()`
  (every Permit2 `PermitWitnessTransferFrom` as signed, with the wallet's clock — used by arc 3);
  `test.ts` `spares` and `tokenList` worker options; `egress.ts` answers the community list from
  the chosen fixture; `connect.ts` `reconnectedAs` (fails if the chooser appears; asserts the chip)
  and a `grantedAccounts` that does not toggle an already-open menu.
- `specs/accounts.spec.ts` (`family: "accounts", cells: 8, l1Index: 8`): 41 widening, 42 the other
  account's record (SWITCH TO, nothing sent under B, CLAIM after the switch), 43 the switch refused
  under a held Ethereum leg (native `disabled`, the busy hint), 44 the gas gate re-read (stand-down,
  `none`, back under A the token-only card is enabled and the review re-opens), 45 a reload
  remembers a non-first account. `specs/accounts-single.spec.ts` (`cells: 1, spares: 0`): 46.
- Readiness § 5's cells 2 and 4 are one cell here (42): same fixture shape, the feed assertion is a
  by-product of the ownership rule.

## Gate (retry 0)

| Command | SHA (tree) | Result |
|---|---|---|
| `bun run e2e:tools -- specs/accounts.spec.ts specs/accounts-single.spec.ts` (own sandbox) | `4a5908ef` + the Phase 4 tree | 6 passed (3.8 min), exit 0 |
| `bun run --cwd apps/tools typecheck` (app + browser suite) | `9718f2cf` | exit 0 |
| `bun run lint` | `9718f2cf` | 0 errors |

The first run of the file failed cell 41 only, at `grantedAccounts` after "Add accounts…": the
button is disabled while the wallet answers, focus leaves the menu, and the Escape the helper sent
went to `body` — the menu stayed open and the next chip click toggled it closed. Fixed in the
helper (close from the chip, assert hidden) and in `grantedAccounts` (never toggle an open menu);
the rerun was 6/6 at retry 0.

## Lessons

- A worktree needs `contracts/bridge/evm/lib` (gitignored forge deps) before the tools sandbox can
  boot; the pinned `forge install` from `contracts/bridge/evm/README.md` (or a copy from a sibling
  worktree at the same pins) is a setup step, not a test failure.
- The `[bridge:deposit] private FJ balance read failed (fail-closed → null)` page log under the
  `plain` profile is pre-existing noise, not a cell failure.
