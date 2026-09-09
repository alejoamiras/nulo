# Phase 5 — CI job for the suite (+ TXE attempt)

## What was done

- `_bridge-contracts.yml` gained `integration` (setup-bun → `setup-aztec` at the pin `packages/bridge-core/package.json` declares for `@aztec/aztec.js` — its own cache key, distinct from the hub crate's Nargo pin — → Foundry 1.7.1 + the same pinned forge libraries as the `forge` job → `gen-remappings` + `forge build` → `bun run --cwd packages/bridge-core test:integration`; `timeout-minutes: 45`; sandbox logs uploaded on failure) and `txe` (`setup-aztec` at the `Nargo.toml` pin → `contracts/bridge/aztec/scripts/run-txe-tests.sh`).
- `bridge-contracts.yml`'s `changes` filter lists every dependency literally per the guard: `contracts/bridge/**`, `packages/bridge-core/**`, `packages/{wallet-crypto,wallet-core,resolve-asset}/src/**` + their `package.json`, `apps/tools/public/*-bridge.json`, `patches/**`, `bun.lock`, `package.json`, `bunfig.toml`, the two workflow files, `setup-aztec` and `setup-bun`. `scripts/ci-cd/behavior-gating.test.ts` pins the bridge graph.

## Gate

- `bun run lint:actions` → exit 0.
- `bun run test:ci-gating` → 93 pass, 0 fail (8 files).
- CI proof at Delivery: `integration` green on the arc-2 PR at retry 0.

## Arc-2 codex loop

**Round 1** (GPT-6 Astra, `high`, arc-2 diff `036709d8..8da0ecc7` + plan + ledger + the adversarial ask) — verdict **"Not ready for PR"**, 13 findings. Verified against the repo:

| # | Finding | Call |
|---|---|---|
| 1 | cells 1/2/27 ride the sponsor, not their advertised payer | real → `ClaimPayer` (`credit` charges the exact ceiling, inventory told), `ExitPlan.payer: "own"` (authwit + exit fees = the public FJ drop) |
| 2 | `deploy:sandbox` alias imports `cli.ts` whose `import.meta.main` is false | real → exported `main()`, called from both entrypoints |
| 3 | exit reaper signals recycled pgids | real → `hasExited()` guard |
| 4 | deposits/exits share one actor across tests | real → an actor per test (`funded()` helper for exits) |
| 5 | the promised shared-signer mutex is absent | real cross-process only: in-process every flow awaits each L1 write and the one concurrent shape uses two keys, so no serializer is needed — documented at `handle.ts` as one writer per key per process. viem's `nonceManager` was tried first and REVERTED: it counts past a send that reverts at gas estimation (cell 17 reverts on purpose), and the next send failed with "nonce higher than expected" |
| 6 | cells 20/21 have no private half | real → `mintPrivateGasVia` (fuel to the PrivateFPC, `FeeJuice.claim` + `fpc.mint`) shared by identity/swapped/WETH |
| 7 | tampering always tested under sponsorship | real → the tampered `register_token` rides the mode's fee (a rejection is a simulation failure, nothing is spent) |
| 8 | routeless refusal fires on the zero floor | real → `minFuelOutput: MIN_FJ`, assert `empty route`; cell 17 asserts the router's `insufficient fuel` |
| 9 | cell 32 cannot claim negative coverage on an automine network | real → positive-only `flowOutboxRoundTrip`; plan row + ledger updated |
| 10 | race test assumes the winner | real → unordered regex |
| 11 | forge artifacts never rebuilt | real → incremental `forge build` every boot |
| 12 | uploaded logs never written | real → `SANDBOX_LOG_DIR` files, CI path updated; "printed admin key" not real (nothing prints one) |
| 13 | workflow-history comments | real → three headers rewritten |

Decisions taken without the owner (plan § Autonomy): cell 32's scope (positive-only) and the nonce-manager-instead-of-mutex call — both logged here and in the ledger.

## TXE attempt

`contracts/bridge/aztec/scripts/run-txe-tests.sh` with the installed 5.0.1 toolchain: **65 tests passed, exit 0** (`txe-phase5.log`) — the oracle server boots from the committed `txe-server` mini-project and the hub crate's whole `src/test/` suite runs. The `txe` job stays in `_bridge-contracts.yml`; if it fails on the runner for toolchain reasons the evidence goes here and the job is dropped in the fix loop.

## Findings worth keeping

- The measured suite: 32 tests in ≈23 min on this host with two other sandboxes running beside it (≈14 min alone for the 26 pre-fee-state tests); the 45-minute job budget covers a slower runner plus the ≈2-minute boot and the forge build.
- Two Aztec toolchains in one workflow are fine as long as each job's `setup-aztec` cache key carries its own version; the `integration` job must never share the `noir`/`txe` jobs' 5.0.1 install.
