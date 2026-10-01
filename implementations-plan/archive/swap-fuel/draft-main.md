# swap-fuel — draft A (main agent)

Bridge-and-fuel on the live testnet: an L1→L2 AZLO deposit optionally swaps a slice into Fee Juice on L1 (Uniswap V4, two-hop AZLO→WETH→ETH→FJ) inside the same atomic tx, producing a second L1→L2 message the recipient claims as L2 gas. Full privacy parity (`isPrivate` in the witness); fuel is a toggle in the existing deposit form; Playwright excluded; Aztec 4.2.0 pinned.

## What already exists (don't rebuild)

- `packages/bridge-evm`: `SwapBridgeRouter.sol` (Permit2 witness-bound `bridgeWithFuel`, route validation, `setSwapTarget`), `UniswapFuelSwap.sol` (V4 swap + unwrap + native ETH→FJ leg), `MockSwapTarget.sol`, fork suite (`DeployBridge.fork.t.sol`, `SwapBridgeRouterPermit2Fork.t.sol`, `RouteValidation.t.sol`, `WitnessHash.t.sol`) green vs Sepolia fork.
- `script/DeployBridge.s.sol`: `PoolSetupHelper` (permissionless `FeeAssetHandler.mint` batching at 1000 FJ/call, idempotent `pm.initialize`, liquidity via `unlockCallback`, sweep) + deploys fuel-swap/router + seeds ETH(native)/FJ and token/WETH pools. Env-tunable (`FEE_MINT_COUNT`, `ETH_SEED`, `*_LIQUIDITY`).
- `packages/bridge-core`: `l1.ts` witness layer (`BRIDGE_WITNESS_TYPE`, `bridgeWitnessPermitTypedData`, `hashRoute`, `PoolKey` — pinned), `flows.ts` `runSwapBridge` (sign → `bridgeWithFuel` → parse `BridgeWithFuel` event → token+fuel secrets/leaf indices — pinned by `swap.test.ts`), `fee-juice.ts` (`publicFeeJuicePayment` = `FeeJuicePaymentMethodWithClaim`, `feeJuiceClaimArgs` for standalone `claim_and_end_setup`), journal/backup schema-versioned.
- Faucet: deposit flow + stepper + journal + sealed backup/restore; manifest scopes in `packages/faucet/src/lib/capabilities.ts`; config via `public/testnet-bridge.json` → `contracts/bridge-deployments.ts`; `verify:l1` Etherscan pipeline.

## Phases

### P0 — Spikes that gate design (cheap; P0.1 ALREADY RESOLVED)
1. **Wallet fee-method control — ANSWERED (fact)**: the wallet supports dApp-embedded fee payment end-to-end: `wallet-bridge/src/operation.ts:60` carries `embeddedFeePayment?: "fjwc" | "fpc"`, and the extension's `execution/fee/embedded-strategy.ts` maps `"fjwc"` → `AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM` with a 1.0× gas cap designed for `FeeJuicePaymentMethodWithClaim`. No dApp uses it yet. **Design consequence**: PRIMARY claim path = the token-claim tx pays for itself by claiming the fuel in-tx (`fjwc` — true cold-start story); FALLBACK = standalone `claim_and_end_setup` (`feeJuiceClaimArgs`) paid by the wallet's default method (sponsored FPC on testnet). P3 implements primary + fallback; P4 surfaces fallback only on fjwc failure.
2. **Re-probe live constants**: `FeeAssetHandler.mintAmount` still 1000 FJ; FJ portal/asset addresses unchanged vs recon; deployer balances (ETH, AZLO mintability under `maxWholePerTx=1000`).
3. **Router constructor surface**: confirm `SwapBridgeRouter`'s deploy args accept the EXISTING canonical TokenPortal (`0x9c41…11ea`) + FJ portal — the router must orchestrate the same portal the bridge already uses; no new token portal.
**Gate**: answers written to `lessons/phase-0.md`; plan adjusted if any expectation breaks.

### P1 — Deploy/seed script: AZLO adaptation (bridge-evm)
- Parameterize the token side: `TOKEN_ADDRESS` env (reuse live AZLO `0xa40a…2c68`; no fresh MintableERC20 on live runs), 18-dec aware pool constants. V4 orders currencies by address: AZLO (`0xa40a…`) < WETH (`0xfFf9…`) → currency0 = AZLO. Recompute `sqrtPriceX96` + tick bounds for an 18/18 pair at the chosen rate (Ask: default 1000 AZLO/WETH) — the current constants encode a 6-dec/18-dec ratio and are WRONG for AZLO.
- AZLO liquidity sourced by deployer mints (`maxWholePerTx` 1000 → loop mints like the FJ side).
- Fork tests updated to the AZLO parameterization; keep a 6-dec regression vector only if cheap.
**Gate**: `forge test` fork suite green with AZLO params (pool init + seed + two-hop quote through both pools).

### P2 — Live Sepolia: deploy, seed, verify, plumb config
- **Budget decision (Ask)**: defaults want `ETH_SEED=0.5` vs ~0.168 held. Options: top up the deployer, or shrink (`ETH_SEED≈0.05`, proportional liquidity). Shallow pools are acceptable for testnet demo: fuel slices are small; document the price-impact tradeoff.
- Run `DeployBridge.s.sol` against live Sepolia (PRIVATE_KEY from `packages/bridge-core/.env`, never printed). Idempotent: pool init try/catch tolerates re-runs.
- Record into `testnet-bridge.json`: `l1.swap = { router, fuelSwap, pools: { tokenWeth: PoolKey, ethFj: PoolKey } }` (+ constructor args for verification); export from `bridge-deployments.ts`.
- Extend `verify-l1.ts`: SwapBridgeRouter + UniswapFuelSwap (our foundry root; constructor args from the json). Bridge footer gains the router link.
**Gate**: cast probes (pools initialized, liquidity > 0, router’s portal/fuelSwap wiring), Etherscan verified ✓, faucet `verify:deployments`-style offline check green.

### P3 — bridge-core: fueled deposit + fuel claim + persistence
- Route builder: construct the two-hop route from config `PoolKey`s (typed, no hand-built hex at call sites); quote helper for the fuel estimate + `minFuelOut` slippage bound (default tolerance parameterized, e.g. 5% on testnet).
- Wire `runSwapBridge` into the deposit flow API for BOTH `isPrivate` variants (witness parity exists).
- Fuel claim, two modes (per P0.1): PRIMARY — the token claim carries `fee.embeddedFeePayment: "fjwc"` with the FJWC payment built from the fuel claim (`publicFeeJuicePayment`), so ONE L2 tx claims fuel AND token, gas paid from the claimed fuel. FALLBACK — standalone `claim_and_end_setup` via `feeJuiceClaimArgs` + wallet default fee. Both gated PXE-aware (simulate-based readiness, the existing claim-gate pattern).
- Journal: deposit record schema bump (fuel fields: `fuelAmount`, `fuelSecret`, `fuelSecretHashHex`, `fuelLeafIndex`, fuel status); schema-1 records load unchanged (fuel absent = no fuel). Sealed backup includes the fuel secret (bearer!) — backup schema bump + restore compat tests both directions.
**Gate**: `bun test` bridge-core — witness/route/quote pins, journal+backup migration pins (old → new loads, new round-trips).

### P4 — Faucet frontend: toggle, stepper, scopes
- `capabilities.ts`: add the canonical FeeJuice address (`feeJuiceAddress` constant) + `claim_and_end_setup` to transaction AND simulation scopes. Existing sessions re-consent via the contracts field-diff path (already shipped). Copy: name the fuel claim in consent copy.
- `BridgeForm`: fuel toggle (default off) + slice control with quoted FJ estimate ("~N FJ"); validation (slice < amount; min slice covering claim gas); fuel UI identical for public/private.
- `useDeposit`: branch to the fueled flow; journal writes fuel fields.
- Stepper/journal: new FUEL phase on the rail (after SYNC, before/with CLAIM per P3 ordering); journal cards + restore flow surface fuel status + claim-fuel action; backup button copy unchanged (file format bump invisible).
- testids for everything new (future Playwright arc selects only by testid).
**Gate**: component tests (form fuel matrix, rail fuel phase, journal fuel states), faucet suite + `audit:faucet`-equivalent, smoke `test:e2e` green.

### P5 — Fork-test hardening + manual testnet validation
- Fork pins against the REAL seeded pools: two-hop swap through live addresses, `minFuelOut` violation reverts atomically (no partial bridge), witness replay rejected (Permit2 nonce), non-canonical route rejected (`_validateRoute` hop continuity), `setSwapTarget` only-owner.
- Manual checklist (user): public+fuel end-to-end (deposit → fuel claim → token claim), private+fuel (token private, FJ public), fuel-off regression, restore of an in-flight fueled bridge from sealed backup, old pending bridges still render.
**Gate**: fork suite green; checklist printed for the user; lessons + index updated.

## Security & Adversarial Considerations
- **Owner-settable `setSwapTarget`** (router): a compromised deployer key can redirect the fuel slice to a malicious target. Mitigations: event-emitting setter (verify), frontend pins the expected fuelSwap address from config and the witness binds the route — verify the contract enforces route-target consistency; testnet posture documented, mainnet would need timelock/multisig (out of scope, recorded).
- **Public pools**: anyone can trade/manipulate price → fuel slice yields less FJ. `minFuelOut` enforced in-contract (verify revert path is atomic — no token deposit without fuel when fuel requested). Sandwich risk small (testnet, small slices) but the bound must exist.
- **Witness replay/substitution**: Permit2 nonce + witness binds amounts, route hash, recipients, `isPrivate` — pinned by `WitnessHash.t.sol` + `l1.test.ts`; extend if any field is added.
- **Content-hash mismatch strands funds**: 3-toolchain keystone tests exist; fuel side uses the canonical FJ portal hash (`claim_helper` binds `(to, amount)`); no custom hashing added by this arc.
- **Bearer secrets**: the fuel claim secret is theft-grade for the FJ amount; it joins the sealed backup (AES-GCM via `@nulo/wallet-crypto`, existing pattern); never logged — same redaction discipline as token secrets.
- **Native-ETH handling**: `UniswapFuelSwap` unwraps WETH and settles native against the PoolManager; verify no stranded ETH path (sweep) and reentrancy posture on `receive()`.
- **Approvals**: Permit2 signature-transfer only; no standing ERC20 allowance to the router (verify).
- **Deployer key**: env-only, never printed/persisted beyond `.env`; script runs locally, no CI secret.
- **Frontend**: fuel estimate is display-only (quote), never trusted for the on-chain bound; input validation on slice amount at the form boundary.

## Assumptions
**Facts** (verified): existing surfaces + addresses as listed above (file cites in the final plan); recon facts (FeeAssetHandler permissionless, 1000 FJ/call; testnet 4.2.0-compatible); deployer ~0.168 ETH; AZLO 18-dec `maxWholePerTx` 1000; pool constants currently 6-dec-shaped (`DeployBridge.s.sol` constants block).
**Inferences** (attack these): the `fjwc` embedded path works for a tx whose MAIN call is the token claim (the strategy was built for it but no dApp has exercised it); sponsored FPC remains available on testnet as the fallback's fee method; the existing fork-test RPC approach works for the AZLO parameterization; the FJWC claim call inside the payload needs the FeeJuice contract scoped in the session manifest (verify scope enforcement against embedded-payload calls).
**Asks**: budget (top up deployer vs shrink seeds); AZLO/WETH target rate (default 1000/1); fuel slice UX default (fixed suggestion vs free input).

## Out of scope
Playwright flows (separate arc), private FJ *gas payment* (Wonderland FPC), mainnet hardening of owner powers, faucet-tab changes.
