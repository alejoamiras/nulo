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

## 7b.2 — Per-network FPC descriptor + fail-closed signer pin ✓

**Commit:** `f5c9bc6`.
- `private-fpc-canonical-mainnet.json`: identical FPC identity (derivation is network-independent),
  Alpha pins (1 / 4248422647), **compat list deliberately EMPTY** → the mainnet FPC gate FAILS
  CLOSED until the owner rules on 5.0.1-artifact-vs-5.1.0-node compat (mirrors the 5.0.0 process).
  Unit pin flips when the ruling lands.
- `check-fpc-version` selects the descriptor by the LIVE node's identity — never a flag; no match =
  hard STOP.
- `PLAN_PINNED_L1_SIGNERS` map + `requirePinnedSigner()`: mainnet null (fail-closed) until the owner
  creates the fresh mainnet-only EOA at Phase 8. Testnet consumers unchanged.
- Gates: bridge-core 190 (+1), faucet 517, typecheck 0, lint 0.

## Phase 7 boundary decision (logged per loop protocol)
Everything offline-verifiable is DONE. The remaining items (mainnet conductor's L2 half, full-sequence
fee budget sizing, stable L2 deployer port, Circle-USDC reuse-path pin execution) have their FIRST
meaningful execution in the owner-present Phase 6/8 runs — writing that orchestration with no way to
run any gate here would be plausible-but-unverified code, the exact class this plan's audits exist to
prevent. Declared ✓-to-the-offline-boundary; the operator runbook below is the hand-off.

## Phase 6/8 operator runbook (the owner-present sequence)
**Phase 6 (Sepolia, fake money — owner env: PRIVATE_KEY + SEPOLIA_RPC_URL + ETHERSCAN_API_KEY):**
1. DP7 token: **`TestUsdc.sol` (done, forge 4/4 — 7b.3)** — deploy it (constructor
   `("Test USDC","USDC",6,1000)`), then `deploy-bridge-testnet.ts` with `--reuse-token <it>` → fresh
   portal + L2 trio → candidate (now emits chain identity + source). Wire the conductor's L2 account
   through `resolveDeployerKeys("testnet")` (BRIDGE_DEPLOYER_SECRET_TESTNET in env) replacing the
   two `Fr.random()` at deploy-bridge-testnet.ts:240-242, and size funding via
   `deploySequenceFeeBudget(perTxLimit)` — both landed in 7b.3, wiring is a 5-line change verified
   by the run itself.
2. Gates: `verify-deployments` (BRIDGE_MANIFEST=candidate), `verify-l1 --config candidate`,
   `smoke-swap-existing-testnet --config candidate` (exercises the NEW Permit2 approve fallback —
   the token no longer auto-grants), `fuel-testnet.ts` (public+private, FPC gate inline). Promote.
3. Retire AZLO (D18): heads-up notice; no drain-gate.
**Phase 8 (mainnet, REAL funds — explicit go per tx):**
1. Owner creates the fresh mainnet EOA → pins it in `PLAN_PINNED_L1_SIGNERS.mainnet`; funds ETH +
   $AZTEC. Owner rules on 5.1.0 FPC compat → curates the mainnet descriptor (unit pin flips).
2. L1 bundle: `DeployBridgeMainnet.s.sol` — EXACTLY as fork-rehearsed — `--slow --verify`, with
   FEE_JUICE_PORTAL/FEE_JUICE_ASSET read fresh from the node.
3. NuloTokenPortal + L2 trio + PrivateFPC via the conductor against real USDC (`0xA0b8…48`,
   identity-checked), fee juice budgeted for the FULL ~7-tx sequence (fable NEW-2), claim-in-tx
   (`publicFeeJuicePayment`) for the account deploy.
4. Write `mainnet-bridge.json` (circle-proxy, core-only fuel, chain identity 1/4248422646), promote,
   `verify-l1` (mainnet chain — verifies InertSwapTarget), `verify:build-target mainnet`, ship.
5. Phase 9: owner smoke under Access → renounce router owner (verify owner()==0) → revoke BOTH
   Permit2 approvals. Only then public.
