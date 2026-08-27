# Blackhat audit — faucet→bridge contracts (pre-production)

Adversarial review of `contracts/bridge/evm` (Solidity) and `contracts/bridge/aztec` (Noir):
Permit2 usage, the L1↔L2 bridging path, and the Noir circuits. Method: full read of every
contract + deploy conductor, then exploit PoCs written as forge tests. All PoCs live in
`contracts/bridge/evm/test/BlackhatAudit.t.sol` + `test/BlackhatV4Fork.t.sol` (Arc 1).

Baseline at audit time: 54 forge tests green; Noir keystone 6/6 on the pinned 5.0.1 toolchain;
bridge-core 227/227 under vitest.

## H-1 — HIGH (conditional): portal first-initialization is front-runnable

`NuloTokenPortal.initialize` has no deployer restriction, and the deploy conductor broadcasts
**deploy** and **initialize** as two separate transactions. An attacker front-running the first
`initialize` with their own registry:

1. bricks the deployment (`AlreadyInitialized` forever), and
2. if the poisoned address were ever published, becomes full custodian: their fake rollup
   supplies both inbox and outbox, so `withdraw` releases every deposited token to them.

Proven end-to-end in `test_FA_portalInitFrontRun_bricksAndDrains` (PoC includes the drain).

Operational mitigations already present reduce this to griefing in practice: the conductor
pre-checks `l2Bridge == 0` before init and STOPs on drift, and the address is published only
after init + readbacks. **Fix (Arc 2): move initialization into the constructor.**

## M-1 — MEDIUM: `_validateRoute` accepts a route it cannot settle

The route `[{X/native}, {native/FJ}]` passes validation — the mid-path native hop looks
"continuous" because `outI == inNext == address(0)` — but Case-C settlement assumes the
pre-final output is WETH and calls `take(WETH, …)` against a currency that never entered the
PoolManager → reserve underflow / `CurrencyNotSettled`. Fail-closed, self-DoS only.

Context that shapes the fix: V4 pools are NOT ETH-only (this repo itself seeds USDC/WETH; the
mainnet fuel route rides USDC→WETH→unwrap→native→AZTEC), so banning mid native pools outright
would be over-restrictive. In flash accounting the mid-path native deltas cancel to zero and
need no settlement at all — the defect is settlement assuming WETH, not the route shape.
**Fix (Arc 3): delta-driven settlement derived from each hop's returned BalanceDelta.**
Proven in `BlackhatV4Fork.t.sol`: validation accepts the shape ([F-G]) and execution fails
closed today; a legit single-hop native route executes fine through the same harness.

## Low / informational

- **L-1** `minFuelOutput=0` is signable — the contract enforces no slippage floor of its own
  ([F-H]). The frontend always injects one (manifest `slippageBps: 300`); keep that invariant.
- **L-2** Fee-on-transfer tokens revert the whole bridge ([F-E]) — acceptable for Circle USDC;
  document as unsupported.
- **L-3** `setSwapTarget` migration invalidates all pending signatures ([F-F]) — fail-closed by
  design (witness binds the current target); announce migrations to avoid stranded intents.
- **L-4** `MintableERC20.allowance` hardwires Permit2→max: holders cannot revoke via
  `approve(0)`. No theft path (each transfer still needs a Permit2 signature); testnet-only.
- **L-5** `claim_public` lacks the zero-recipient assert its private sibling has.

## Verified sound (attacks attempted, defenses held)

- **Donation/prefund griefing neutralized** [F-B]: all router accounting is delta-based;
  prefunded tokens/FJ neither break nor redirect a user's bridge.
- **Inflated swap reports caught** [F-C]: reported output vs actual balance-delta check.
- **Prefunded-target-without-consumption caught** [F-C]: strict fuel-slice consumption check
  closes the residue-theft vector.
- **Reentrancy blocked** [F-D]: swap-target reentry into the router dies on the guard.
- **No witness replay**: every bridge parameter is bound in the EIP-712 witness and Permit2
  nonces are single-use; cross-function replay changes the witness hash.
- **Content-hash keystone independently verified**: recomputed
  `sha256(selector ++ abi.encode(args)) >> 8` from first principles — matches ALL pinned vectors
  on both toolchains (`ContentHash.t.sol`, Noir keystone). The reduction matches the installed
  `@aztec/l1-artifacts` `Hash.sha256ToField` (`bytes32(0x00 ++ bytes31(digest))`).
- **TS↔Solidity witness pinning**: `l1.ts` struct/typehash byte-matches the router; pinned by
  `WitnessHash.t.sol` ↔ `l1.test.ts`.
- **Sole-consumer invariant**: `check-sole-consumer.sh` guards the recipient-commitment
  property with a self-test covering five bearer regressions.
- **Claim-secret derivation sound**: poseidon2 with a dedicated domain separator over
  `(salt, recipient)`; salt-entropy requirement documented and tested (recipient privacy).

## Environment notes

- v4-core must be installed at exactly `@v4.0.0` (README pin); latest (1.0.2) moves structs and
  breaks the build.
- `SwapBridgeRouterPermit2Fork` positive flows need maintained testnet state (live pools/
  balances) and fail against fresh public-RPC forks; replay/tamper/deadline variants pass
  anywhere. Worth one run against the maintained testnet.
- The real upstream portal only compiles in-project with `allow_paths` reaching the repo-root
  `node_modules` (+ the `@aztec-blob-lib` remap); landed with Arc 1.
