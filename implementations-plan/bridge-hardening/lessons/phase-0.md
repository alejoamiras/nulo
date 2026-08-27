# P0 — honest baseline

Re-establishing what this arc actually passes, because no number recorded in any of the ten PR
bodies had ever been reproduced by CI or by a second machine.

## Finding 1 (blocking): the forge suite does not build from a clean checkout

`forge build` fails at the bottom of the stack with:

```
Unable to resolve imports:
  "@aztec-blob-lib/BlobLib.sol" in .../l1-contracts/src/core/libraries/rollup/FeeLib.sol
  "@aztec-blob-lib/BlobLib.sol" in .../l1-contracts/src/core/libraries/rollup/ProposeLib.sol
```

**Cause.** This repo sets `linker = "isolated"` (`bunfig.toml:14`), so there is no root
`node_modules/@aztec/` — `@aztec/l1-artifacts` resolves under
`packages/bridge-core/node_modules/`. `contracts/bridge/evm/foundry.toml` carries two static
hoisted-layout remaps (`@aztec/` and `@aztec-blob-lib/`), and `gen-remappings.ts` exists precisely
to override them with linker-correct paths — but it only emitted `@aztec/`. The
`@aztec-blob-lib/` alias, added alongside `allow_paths` so the suite could compile the REAL
upstream portal in-project, kept its hoisted TOML value and pointed at a directory that does not
exist under this repo's own linker.

`assertEffectiveRemapping` did not catch it: it validated only the `@aztec/` line, so the guard
reported "remappings OK" on a tree that cannot compile.

**Fix.** `gen-remappings.ts` now emits `@aztec-blob-lib/` derived from the same resolved
`@aztec/l1-artifacts` root, and the assertion loops over both aliases instead of one. Landed at
the bottom of the stack so every arc inherits it.

**Why it went unnoticed.** Nothing under `contracts/` runs in CI or in `audit:vue`, so the only
signal was a local run on a machine that still had a hoisted `node_modules` from before the
isolated-linker migration. This is the concrete cost of the ungated-contracts gap that P4 closes:
a build-breaking regression survived ten PRs and a codex pass.

## Baseline runs

Measured at the bottom of the stack (`hardening/blackhat-tests`, 3b0a402c) once the remap fix
above made the project compile at all.

| Suite | Command | Result |
|---|---|---|
| forge (hermetic) | `forge test --no-match-contract Fork` | **46 passed / 0 failed**, 9 suites |
| forge (fork) | needs `SEPOLIA_RPC_URL` | not run |
| TXE | `contracts/bridge/aztec/scripts/run-txe-tests.sh` | pending |
| keystone | `aztec-nargo test` | pending |
| halmos | `halmos --contract FormalRouterTest` | pending |

**Count correction.** #435's body and its test-plan checkbox claim "50 passed"; the real hermetic
figure is 46 (`BlackhatAudit` 8, `SwapBridgeRouter` 10, `MintableERC20` 7, `RouteValidation` 7,
`SwapBridgeRouterFuzz` 5, `TestUsdc` 4, `ContentHash` 3, `PortalReinit` 1, `WitnessHash` 1). The
same PR also claims 4 `BlackhatV4Fork` tests where 3 exist — a debug probe with no assertions was
dropped in the branch's last commit and neither number was refreshed. Treat every self-reported
count in this arc as unverified until re-run.

Toolchain on this host: forge 1.7.1, aztec-nargo 5.0.1 available, node v24.18.0. `halmos` was not
installed; it is a clean `pip install halmos` and the suite runs in seconds.
