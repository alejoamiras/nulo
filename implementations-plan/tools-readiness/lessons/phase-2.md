# Phase 2 — extension e2e: widening, the live-session switch, the second-account send

Commits `a0b80872` (the three files + `readPublicTokenBalance`), then the arc-1 codex loop's fixes
`4d353925` and `4cb608f4` (arc 1 tip).

## What landed

- `tests/e2e/network/cap-widening.test.ts`: the first grant is driven by the test with a distinctive
  per-dApp alias (`dapp-alias-A`); a second wallet account → the repeat request lists two rows, the
  held one `data-granted` + pre-selected and inert to a click; approve → `getAccounts` returns both,
  the first's alias intact; a third account → a decline keeps the grant, its `canCreateAuthWit`,
  both aliases and the stored session row exactly as they were.
- `account-switch-live-session.test.ts`: A is made active explicitly (storage-asserted), the popup
  switches to B under the live session, `getAccounts` answers the same two in order, a `sendTx`
  with `from: A` is executed by A — the execute popup names A, A's token balance −1, the
  recipient's +1, B's token and Fee Juice untouched, A's Fee Juice not risen.
- `multi-account-from.test.ts`: the stale "known limitation" docstring is gone; a second test sends
  from the SECOND granted account through `pg-input-from` and proves it by balances.
- `fixtures/aztec.ts`: `readPublicTokenBalance` beside `readPublicFeeJuice`; `tests/e2e/README.md`
  lists both and the widening popup's `data-granted` contract.

## Gate (retry 0)

| Command | SHA | Result |
|---|---|---|
| `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/cap-widening.test.ts` | `a0b80872` | 1/1 passed (18.6 s) |
| `… tests/e2e/network/account-switch-live-session.test.ts` | `a0b80872` | 1/1 passed |
| `… tests/e2e/network/multi-account-from.test.ts` | `a0b80872` | 2/2 passed |
| `bun run --cwd apps/playground typecheck` | `a0b80872` | exit 0 |
| armed smoke: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:chrome` + `NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e` | `a0b80872` | 31 files passed, 1 skipped; 116 tests passed, 6 skipped; exit 0 |
| `bun run test:ci-gating` | `a0b80872` | 100 pass, 0 fail |
| **arc-1 boundary**: `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent` (whole, alone) | `4cb608f4` | _pending — recorded below when it lands_ |

## Codex loop (arc 1) — converged at round 3

| Round | Verdict | Findings → call |
|---|---|---|
| 1 | conditional approve | (1) `accountsAdditions` trusted the popup echo's identities — bound to the picker's rows, aliases to the additions, hostile-echo pin; (2) live-session switch never established A — activated and asserted first; (3) alias pin started from the default name — distinctive alias; (4) revoked-meanwhile pinned for membership-only only — parameterized over both shapes; (5) two comments narrated/overstated — tightened. All adopted, `4d353925`. |
| 2 | conditional approve | a re-spelled (mixed-case) echo passed the allowlist yet was stored under the echo's spelling — mapped back to the wallet's CAIP spelling, held identities compared case-blind, aliases keyed canonically, pin extended. Adopted, `4cb608f4`. |
| 3 | **approve** | — |

Session `01a08cbf-f3ca-7741-ae64-7911ea785a87` (transcripts in this session's CODEX_DIR).

## Lessons

- An interrupted smoke run (the host restarted mid-suite) leaves no summary line; the log is the
  only evidence, so a rerun is the honest answer, not a tally reconstructed from ticks.
- The extension network runner needs `NULO_E2E_RETRY=0` for an honest tally: its config retries
  twice by default.
