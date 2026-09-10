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
| the six cells again after the codex-loop fixes (`holdsArmed`, `refuseChooser`, the paused dropped-account branch): `bun run e2e:tools -- --shard=1/2` (own sandbox, retry 0) | `1d5c7d18` (arc-2 tip `55846712` + arc 3, which touches none of these files) | cells 41–46: 6/6 passed (arc-2 boundary) |

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

## Codex loop (arc 2) — converged at round 4 (one past the three-round stop; surfaced to the owner)

| Round | Verdict | Findings → call |
|---|---|---|
| 1 | reject | (1) a re-grant answered while an operation ran reached `applySelection` past the switch gate — completion re-checks the gate; (2) the cap truncated before the selection check — `parseAccountList(…, { keep })`; (3) additions past the cap reported "No accounts were added" — outcome counts hidden accounts; (4) cell 43 waited for one `eth_sendTransaction` (could be the approval) — waits for the router hold to be consumed (`holdsArmed`); (5) cell 46 / `reconnectedAs` answered an unexpected chooser — `refuseChooser` inside the driving helper; (6) two narrating comments — compressed. All adopted, `91d8231b`. |
| 2 | reject | (1) a deferred reply that DROPPED the active account still moved the selection under the gate, and a multi-account chooser's confirm bypassed it — quiet path keeps the selection, `confirmAccountChoice` gated; (2) `keep` protected refreshes only — the quiet re-grant passes the active account too, tested via `retryCapabilities`; (3) hidden aliases were sanitized — count first, sanitize displayed slots only. All adopted, `da1213b0`. |
| 3 | reject | the kept-but-dropped selection stayed `connected` after the gate opened, so a later send could capture a revoked account — the drop now enters the PAUSED chooser (single/remembered auto-apply skipped under the gate), `selectAccount` refused, confirm refused until the gate opens; the test runs through release and the confirm. Adopted, `878f7d2a`. |
| 4 | **approve** | — |

Round 3 was still material at the protocol's stop, so the loop ran one more round rather than
shipping a known-open blocking finding; the owner is told in the final report. Transcripts in this
session's CODEX_DIR (`response.md` … `response-3.md`).
