# Phase 8 lessons — mainnet swap-fuel enablement (pre-deploy, no funds spent)

## D23 mainnet leg: discover, never seed (2026-07-27)

Owner reversed the swap-fuel retirement (D22): fuel ships everywhere. Mainnet's difference from
testnet is WHERE liquidity comes from — testnet seeds its own pools per token generation; mainnet
rides existing canonical Uniswap V4 liquidity, so the pipeline step is DISCOVERY + PROOF, not
seeding.

### Canonical pins (docs.uniswap.org/contracts/v4/deployments, verified on-chain 2026-07-27)
- PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90`, V4Quoter
  `0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203` — code-checked AND re-proven by live quotes.
- Fee asset: portal `0xaf73…691c` UNDERLYING == `$AZTEC 0xA27E…62D2` (symbol AZTEC, 18 dec) ✓.

### Discovery findings (`discover-mainnet-fuel.ts`, read-only)
- **Winner: USDC/WETH 500/10 → native-ETH/AZTEC 10000/200.** 1 USDC → 55.99 AZTEC.
- The 500- and 3000-tier ETH/AZTEC pools are INITIALIZED but quote-dead — slot0 alone proves
  nothing; the quoter dust-probe is the only ground truth. **Lesson: initialized ≠ liquid.**
- NO WETH/AZTEC pool exists — the router's fixed route shape (unwrap → native final hop) is the
  only viable topology, and it works.
- Depth: 25 USDC ≈ 3.02% impact vs 1 USDC (the AZTEC pool is a 1%-fee tier). Phase-8 must
  calibrate mainnet's slippageBps / UI fuel cap to its own curve — do NOT copy testnet's numbers.

### Executing proof (`MainnetFuel.fork.t.sol`, opt-in via ETH_RPC_URL)
Public + private `bridgeWithFuel` executed on a mainnet fork against the canonical pools and the
REAL live FeeJuicePortal — the genuine Aztec Inbox accepted the message (MessageSent, checkpoint
14386). Floors are quoted LIVE in-test (canonical prices move; hardcoded FJ floors would rot).
Circle USDC has no Permit2 auto-allowance — the test mirrors the app's one-time approve.

### Gotcha: forge deterministic deploy addresses carry real mainnet balance on forks
The swap target's "ETH residue" failure (5.77e14 wei) was pre-existing dust AT THE DEPLOY ADDRESS
on live mainnet (verified via cast balance — exact match). Residue assertions on fork tests must be
balance DELTAS from setUp, never absolutes.

### Still owner-gated (Phase 8 proper — REAL money, explicit go per tx)
Pin fresh mainnet EOA (PLAN_PINNED_L1_SIGNERS.mainnet) + fund; FPC compat ruling (DP6); the actual
`DeployBridgeMainnet` broadcast; manifest swap block written from deployed addresses + calibrated
slippageBps/minFuelFj.
