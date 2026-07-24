# Phase 7 — Deploy tooling for mainnet

## 7a — Network-aware verify-l1 + circle-proxy skip ✓ (codex post-impl HIGH-4)

**Commit:** `290ff08`.

- Chain id now comes from the manifest's self-declared `l1ChainId` (legacy fallback Sepolia);
  explorer links follow it.
- `token.source === "circle-proxy"` skips the token source-verify with an explicit note — official
  Circle USDC is not our contract and must never be verified as `MintableERC20`; its **identity**
  (canonical address + code readback) is pinned in the deploy/reuse path, not the Etherscan gate.
- Our own permissionless-mint token verifies exactly as before (`maxWholePerTx` only read there).

**Gate evidence (dry-run, no API key needed):**
- Live testnet manifest → all four standard-json builds ✓ (MintableERC20, NuloTokenPortal,
  SwapBridgeRouter, UniswapFuelSwap).
- Placeholder mainnet manifest → token SKIPPED (circle-proxy note), NuloTokenPortal +
  SwapBridgeRouter ✓, UniswapFuelSwap correctly absent (core-only fuel).

## Codex post-impl HIGH fixes rolled into this phase window (commit `05d604a`)
- HIGH-1: mainnet capability grant now = combined manifest minus faucet tokens (keeps PrivateFPC +
  private-fuel scopes; matches the unconditional FPC registration). Test pins the mainnet shape.
- HIGH-2: `VITE_AZTEC_NODE_URL` is dev/e2e-only; prod always uses the committed per-target node.
- HIGH-3: `deploy-bridge-testnet` emits `l1ChainId`/`walletChainId` (read from the node, reset-safe)
  + `token.source`; `CandidateManifest` type extended.

## 7b.1 — Forge mainnet L1 bundle + fork rehearsal ✓ (D21, owner steer)

**Commit:** (this one). Owner asked "wouldn't foundry scripts be better?" — yes, for the mainnet L1
legs: simulate-before-broadcast, `--resume`, `--verify`, and the anvil fork rehearsal. The TS
conductor keeps the L2 half + manifest (cross-domain interleave); the repo already had
`DeployBridge.s.sol`/`DeployFuelLive.s.sol`, so this extends the existing pattern.

- **`src/InertSwapTarget.sol`** — the mainnet swapTarget: no state/owner/selectors; every call
  reverts (`Inert()`). Fills the router's non-zero witness-bound slot while making the dormant
  `bridgeWithFuel` atomically unusable (DP2/DP8).
- **`script/DeployBridgeMainnet.s.sol`** — deploys stub + `SwapBridgeRouter(PERMIT2, feeJuicePortal,
  stub)`. Pre-flight `require`s (fail the SIMULATION, before broadcast): chainid==1; code at
  canonical Permit2 + Circle USDC; USDC identity (decimals 6 + symbol); portal `UNDERLYING()` ==
  fee asset (env-overridable pair, defaults = live node readback 2026-07-24). Post-deploy readbacks:
  router permit2/portal/swapTarget/owner + a staticcall proving the stub reverts.
- **`verify-l1.ts`** — bridge-only manifests now source-verify `InertSwapTarget` at the swapTarget
  (dry-run proven; testnet still verifies UniswapFuelSwap).

**GATE PASSED — anvil mainnet-fork rehearsal (zero real funds):**
`anvil --fork-url ethereum-rpc.publicnode.com` → `forge script DeployBridgeMainnet --broadcast`
(anvil dev key) → ALL pre-flight checks passed against REAL mainnet state (real Circle USDC proxy,
real Permit2, the LIVE Aztec FeeJuicePortal `0xaf73…691c` with `UNDERLYING()` == `0xa27e…62d2`),
stub + router deployed, every readback OK, "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL".
This is the exact Phase-8 L1 bundle, rehearsed. Phase 8 = the same script with the real key +
`--slow --verify` (owner go).

**Live-node facts captured** (read-only `node_getNodeInfo` via the Alpha dRPC):
l1ChainId=1, rollupVersion=4248422647 (⇒ wallet id 4248422646 ✓ matches our pin),
feeJuicePortal `0xaf73dd51d1eb8a079bb097f39c832cdd00ac691c`, feeJuice `0xa27ec0006e59f245217ff08cd52a7e8b169e62d2`,
**nodeVersion 5.1.0** — NOTE: our pinned line is 5.0.1; the FPC compat gate's curated list must gain
a 5.1.0 ruling before mainnet private-fuel deploys (7b.2 / A-check at Phase 8).

**Gotchas:** foundry `lib/` is gitignored external deps — copy from the canonical clone into a fresh
worktree (`cp -r <main>/contracts/bridge/evm/lib …`) before `forge build`. Solidity enforces EIP-55
checksum casing on address literals — paste solc's suggested casing verbatim. `--private-key` does
NOT feed `vm.envUint("PRIVATE_KEY")` — pass the env var (repo convention).

## 7b.2 — REMAINING (code-writable next; live gates need the owner env)
- `deploy-bridge --network` parameterization (NODE_URL / RPC / chain / paths are testnet-hardcoded;
  `PLAN_PINNED_L1_SIGNER` must become network-keyed — fresh mainnet EOA).
- Stable/journaled/network-separated deployer (port `resolveDeployerKeys`).
- Circle-USDC identity pin in the reuse path (canonical `0xA0b8…48` + proxy/code readback).
- `check-fpc-version`: per-network descriptor (the canonical JSON pins testnet identity; add the
  mainnet pin + select by the live node) — mainnet acceptance.
- Full-sequence fee budget (7 L2 txs) sizing in the deploy path.
- Inert swapTarget stub (provably-reverting .sol) + bytecode-hash/revert probe at deploy.
- **Phase-7 gate** (`--network testnet --dry-run` parity; claim provably consumable) requires a live
  node → runs in the owner's env.
