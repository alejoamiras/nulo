# Phase 1 ✓ (code) — contracts → contracts/bridge/{aztec,evm}

- `git mv` bridge-aztec→`contracts/bridge/aztec`, bridge-evm→`contracts/bridge/evm` (renames preserved).
- `bridge-core/src/artifacts.ts` imports `../../bridge-aztec/` → `../../../contracts/bridge/aztec/` (typecheck ✓ — the LOUD gate green).
- `contracts/bridge/evm/foundry.toml` `@aztec/` remap `../../node_modules` → `../../../node_modules` (depth-correct; target `node_modules/@aztec/l1-artifacts` exists).
- `router-abi.test.ts` ARTIFACT `../../bridge-evm/out` → `../../../contracts/bridge/evm/out`.
- ALL `bridge-core/scripts/*` `join(here,"..","..","bridge-{evm,aztec}")` → `(…,"..","contracts","bridge","{evm,aztec}")`; `faucet/public` → `../../../apps/faucet/public`; `build-portal-artifact.ts` source string + the comment/message refs (`packages/bridge-evm`, `bridge-evm/test`, `bridge-aztec/keystone`) repathed. **bridge-core G9-grep clean.**

## Gates
frozen 0 · `git diff bun.lock` empty (contracts not workspace members) · `typecheck:all` 0 · `bun run --filter '@nulo/bridge-core' test` 0 (127 pass).

## ENV-DEFERRED (not a code issue; pre-existing condition)
`forge build` + the **router-abi-RUNS pin** require the Foundry `lib/` (forge-std / openzeppelin / v4-core — NOT installed in this env; no `.gitmodules`; `out/` not committed) → `router-abi.test.ts` already **SKIPS here, pre-move too** (so the move did not regress it). The `@aztec` remap + the ARTIFACT path are inspection-verified. To exercise these two gates: `forge install` (or vendor the libs) + `forge build` in `contracts/bridge/evm`, then `bun run --filter '@nulo/bridge-core' test` and confirm the `router-abi pin (forge artifact)` describe EXECUTES.

## UPDATE — forge gate VERIFIED + all builds green (2026-06-30, user asked not to defer)
- `forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts Uniswap/v4-core@v4.0.0 --no-git --shallow` then `forge build` in contracts/bridge/evm -> SUCCESS, 74 out/ artifacts -> the `@aztec=../../../node_modules/@aztec/l1-artifacts` remap (depth +1) RESOLVES. No repo pollution (--no-git; lib/ gitignored).
- router-abi pin now RUNS (out/ exists) and PASSES: `bun run --filter @nulo/bridge-core test` = 18 files / **129 passed (was 127 + 2 skipped)** -> the G1 forge build + router-abi-RUNS gate is GREEN, not just inspection-verified.
- All 5 app builds fresh-green: chrome 0, firefox 0, faucet 0, playground 0, landing 0.
