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

## 7b — REMAINING (code-writable next; live gates need the owner env)
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
