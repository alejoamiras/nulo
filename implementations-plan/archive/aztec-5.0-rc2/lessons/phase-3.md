# Phase 3 ✓ — testnet redeploy (ALL LIVE GATES GREEN)

## FINAL: the five live gates
1. **verify-l1 ✓** — all 4 L1 sources Etherscan-verified against the candidate.
2. **verify:deployments ✓** — GREEN on the regenerated pins (dripper landed at EXACTLY the Phase-2-predicted `0x127f76a6…`).
3. **smoke-existing-testnet ✓** — CANDIDATE deposit→claim bridged 100 AZLO end-to-end in **1.9m** → promoted candidate→live (`37ea29a`).
4. **fuel-testnet private-FPC canary ✓** — the headline: `claim SETTLED — one tx claimed tokens AND gas` through the PrivateFPC at the re-pinned `0x0d4b2c…` (actual fee 4.88 FJ vs 7.40 ceiling; public + private runs settled in 6.4m). Recalibrated `l1.fuel.minFuelFj` per the canary: `10170654118143041536` → `29580299742031535464` (4× worst getFeeLimit; the rc.2 fee surface is pricier).
5. **a drip ✓** — 10 NULO dripped to public via a throwaway sponsored account; balance verified on-chain. (Temp canary script deleted after; two iterations: deployments.json is top-level-keyed, and BigInt doesn't JSON.stringify.)

## rc.2 API archaeology (for the next reset)
- `DeployMethod.send()` returns `Promise<DeployResultMined>` — no `.deployed()` chain.
- Codegen'd `Contract.deploy` needs the **EmbeddedWallet itself** as the `Wallet` (the account object lacks `getContractClassMetadata`); the account supplies `from` + fees.
- `deploy-private-fpc-testnet.ts` (committed) universal-deploys the FPC idempotently.

## Pre-flight ✓
- Live testnet CONFIRMED reset: rollupVersion `4239416255` → `2787991301` (nodeVersion reports "dev"); new L1 set — rollup `0xfe6061…`, registry `0xa0bfb1…`, inbox `0x917bb0…`, outbox `0xbd9513…`, **feeJuicePortal `0xb06ac8…` (changed — the fuel-portal-v5-fix failure mode)**; feeJuice `0x762c13…` + feeAssetHandler `0x5602c3…` UNCHANGED.
- New wallet chainId `2793892258` (= 11155111 ^ 2787991301) — cascaded into chain-constants.ts, chain-info.test.ts, extension network/service.ts + ui/utils.ts (all 4 sites, tests green).
- Deployer env: found the standing (byte-identical) `.env`s in the nulo-3/nulo-4 worktrees → copied into this worktree (`packages/bridge-core/.env`, `apps/faucet/.env` — the faucet one moved to the post-restructure path). Gitignored-verified. Deployer `0xFcc22383…`, 9.06 Sepolia ETH.

## Keyless prep ✓ (committed `a0e3c58`)
- `FEE_JUICE_PORTAL` re-pinned to `0xB06AC8156Af9C4b369A7ae3E11708bAAa1990a3A` in DeployBridge.s.sol + DeployFuelLive.s.sol + .env.example + both fork tests.
- The `CandidateManifest.l1.feeJuice` gap (codex-delta HIGH#2) closed: typed field + node-sourced block in the writer (portal/asset/handler fresh from `nodeL1Addresses()`; only the calibrated `minFj` carries from the prior manifest, env-overridable).

## L1 fuel redeploy ✓ (live Sepolia)
`DeployFuelLive` (SEED_AZLO_WETH=false SEED_ETH_FJ=false — pools persist, L1 never reset; dry-run first, then broadcast, ~0.09 ETH):
- **UniswapFuelSwap `0xAb3a9a9FA7215921a46D7ec57F2b0dD5Ff200Eb8`**
- **SwapBridgeRouter `0x4c3fcd14d63e9cB3e76F2e723Ce849eB75204068`** (bound to the NEW feeJuicePortal)

## FOUND + FIXED: latent #186 bug — the portal-fork pin (committed `3b98427`)
The bridge deploy's own guard tripped: `FORKED_PORTAL_KECCAK` mismatched because **the monorepo restructure repathed ONE header-comment line inside `upstream/NuloTokenPortal.sol`** (`packages/bridge-evm/…` → `contracts/bridge/evm/…`) without regenerating the pin — verified: the pre-restructure copy hashes exactly to the old pin; the diff is comment-only, zero code change. Re-pinned the source keccak, regenerated `NuloTokenPortal.build.json` with the pinned solc 0.8.30 against **rc.2's l1-contracts** (new init/runtime code hashes — the `@aztec` interface imports now resolve against rc.2; rc.2's l1-artifacts no longer ships the canonical TokenPortal example, so our fork is the standalone source; the candidate smoke's deposit→claim round-trip is the empirical semantics proof), updated `PORTAL_PIN`.

## L2 bridge deploy — RUNNING (candidate-first)
`deploy-bridge-testnet.ts` with `FUEL_ROUTER`/`FUEL_SWAP` = the fresh pair. Note: the script BY DESIGN deploys a fresh L1 `MintableERC20` (new AZLO `0x457f9c…` so far) — the carried fuel `pools.azloWeth` (keyed on the OLD AZLO `0xA40A2F…`) will be stale, so after this completes: re-run `DeployFuelLive` with `ROUTER_ADDRESS`+`FUEL_SWAP_ADDRESS` (reuse) + `TOKEN_ADDRESS=<new AZLO>` + `SEED_AZLO_WETH=true SEED_ETH_FJ=false` to seed the new token's pool, then patch the candidate's fuel block before the smokes.

## Deploys — ALL LANDED
- **Faucet ✓** — dripper `0x127f76a6…` (EXACTLY the Phase-2-predicted derivation), fresh NULO/OLUN; `deployments.json` regenerated; **`verify:deployments` GREEN** (live gate #1). Ran in PARALLEL with the bridge deploy (independent accounts — no conflict).
- **Bridge ✓ (candidate)** — fresh L1 AZLO `0x457f9c…` + NuloTokenPortal `0x96de81…`; L2 proxy `0x0f8a89…` / token `0x13f5a3…` / bridge `0x11e18e…`; the candidate carries the **`l1.feeJuice` block** (the manifest fix working: new portal `0xb06ac8…`, minFj carried) + the fresh fuel router/swap.
- **PrivateFPC ✓** — universal deploy landed at EXACTLY the pinned `0x0d4b2c…`. Took 3 attempts (rc.2 API archaeology): (1) `send()` returns `Promise<DeployResultMined>` — no `.deployed()` chain; (2) the account object lacks `getContractClassMetadata` → pass the **EmbeddedWallet itself** as the deploy `Wallet` (+ `from` = the account, `universalDeploy: true`) — the same pattern deploy.ts uses. Script committed: `deploy-private-fpc-testnet.ts` (idempotent, for future resets).
- **AZLO/WETH pool seeded for the NEW token** — `DeployFuelLive` re-run with `TOKEN_ADDRESS=<new>` + `ROUTER_ADDRESS`/`FUEL_SWAP_ADDRESS` reuse + `SEED_ETH_FJ=false` (the ETH/FJ pool + all L1 infra persisted — L1 never reset).
- **verify-l1 --config candidate ✓** — all 4 L1 sources Etherscan-verified.

## Remaining
Candidate `smoke-existing-testnet --config` (RUNNING — the real deposit→claim round-trip) → PROMOTE candidate→live → re-pin `bridge-deployments` consumers → live canaries (public settle · `fuel-testnet.ts` private-FPC variant · a drip) → Phase 4.
