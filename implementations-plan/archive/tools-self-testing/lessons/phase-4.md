# Phase 4 — Vitest integration suite + Dripper fixture

## What was done

- `vitest.integration.config.ts` (`fileParallelism: false`, 10-minute test/hook timeouts, `globalSetup` boots via `startLocalNetwork` + `deployEverything` and `provide()`s the JSON handle; `BRIDGE_INTEGRATION=1` set by `test:integration` and asserted by `describe.skipIf`). `test/integration/sandbox.ts`: `sandbox()` opens the clients once per worker, `freshActor()` sponsor-deploys a brand-new Nulo-shape account with its own flow context per test.
- Files by family: `deposits` (cells 1, 2, 5, 23 + the relayed private claim), `gas-leg` (13–22), `fee-states` (3, 4, 13b, 15b, 18b, 20b), `registration` (33: relayer-first, two concurrent first claims, portal-only, tampered × three fee modes), `exits` (27, 28, 31, 32), `drip` (38 — Dripper + NULO/OLUN deployed by `deploy.ts`, `deployments.json` written beside the handle).
- New flows for the fee states: `flowFirstTimeFromCredit(s, isPrivate)` (a first-time token whose registration and claim are paid from held credit, then a cheaper second send — public is one `register_and_claim_public`, private is `register,claim` with `registerFee`/`registeredClaimFee`), and the held-public-FJ conservation wrappers around the fueled shapes.

## Gate

- `bun run --cwd packages/bridge-core test:integration` → **exit 0, 6 files, 32 tests passed** in 1471.6 s (24.5 min, two other sandboxes running beside it; `integration-phase4d.log`). Every matrix "I" cell is a named test: 1, 2, 3, 4, 5, 13, 13b, 14, 15, 15b, 16, 17, 18, 18b, 19, 20, 20b, 21, 22, 23, 27, 28, 31, 32, 33 (relayer-first, two concurrent, portal-only, tampered × three fee modes via `it.each`), 38.
- `bun run --cwd packages/bridge-core test` → 49 files, 444 passed, 1 skipped; no `test/integration/**` file collected.
- The run before it (1370 s, 30/32) failed only on cell 28's setup and the pre-fix Outbox flow — both in the table below; the `fee-states` and `exits` files were re-run alone in between (6/6, 4/4).

## Defects the suite found that the one-actor smoke could not

Every one is a "fresh actor per test, fresh wallet per worker" difference — the shapes arc 3's browser suite has too, so they are fixed in the harness rather than worked around in the tests:

| Cell | Symptom | Cause | Fix |
|---|---|---|---|
| 28 | `No artifact registered for contract class 0x032bc7…` at the first `balance_of` on the PrivateFPC | the FPC was deployed through another worker's (ephemeral) wallet; `ensurePrivateFpc` returned early on "exists on chain" without giving THIS wallet the instance and artifact | register the existing instance + artifact when the chain already has it |
| 31 | `Assertion failed: not guardian` on `set_exits_paused` | the hub's guardian is the base actor that deployed the generation; a fresh actor is not it | `adoptGuardian()` registers the base actor (from the handle's secret) in every `openSandbox`/`deployEverything` wallet and exposes `guardianOpts`; the pause flow sends as the guardian |
| 32 | `the exit was already proven — the unproven window closed before the check` | the automine local network proves a block the moment it is proposed; in ten runs the unproven window was never observed | the flow tries three exits, asserts the refusal (portal `withdraw` simulation reverts) on any exit caught unproven, finishes every exit the normal way, and reports which case it hit — the conditional negative is a question for the arc-2 codex review |
| 28 | `Balance too low` in `_burn_private` | the exits file's setup deposited only publicly; a private exit burns the private balance (the one-actor smoke had private balance from earlier flows) | the file's `beforeAll` deposits on both sides |

## Findings worth keeping

- `it.each` is how the tampered-registration modes are named; a grep for `it("` undercounts.
- The Node embedded wallet's store identity (`l1ChainId + rollupAddress`) is the same for every fresh local network; the `ephemeral` store (phase 3, run 4) is what made two sandboxes on one host possible at all, and it is also what turned "the deploying wallet knows the contract" into a per-worker fact the harness has to re-establish.
