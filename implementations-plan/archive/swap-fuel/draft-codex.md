**Independent Plan: SDK-first, Dual-Path Fueled Deposits**

This plan keeps the current direct-portal deposit flow as the default and adds a fueled branch only when the user enables fuel. That is the lowest-regression cut because the faucet already ships the direct path end-to-end in `packages/faucet/src/composables/useDeposit.ts:232-309`, while the separate one-tx router path already exists in `packages/bridge-core/src/flows.ts:201-326`. The landmines are real: the deploy/fork path is still hardcoded to fresh 6-dec USDC pools (`packages/bridge-evm/script/DeployBridge.s.sol:141-201`, `packages/bridge-evm/test/SwapBridgeRouterPermit2Fork.t.sol:116-182`), the WETH→ETH unwrap only works at the final route boundary (`packages/bridge-evm/src/UniswapFuelSwap.sol:184-215,266-271`), and zero-gas bootstrap only works if the L2 claim uses `FeeJuicePaymentMethodWithClaim` with the wallet’s embedded-fee cap behavior (`packages/bridge-core/src/fee-juice.ts:24-29`, `packages/extension/src/wallet/services/execution/fee/embedded-fpc-cap.ts:24-33,71-81`).

## 1. Phases

1. **Phase 1: Harden the live-Sepolia contract path before touching UI**
- **Goal:** Replace the script/test assumption of a new 6-dec `MintableERC20("USDC")` with live 18-dec AZLO, derive `currency0/currency1`, `zeroForOne`, `sqrtPriceX96`, and tick bounds from addresses/decimals instead of literals, and keep the two-hop route fixed at `AZLO/WETH -> ETH/FJ`. Today the script and fork tests still seed a fresh 6-dec pool and even require `usdc < WETH` (`packages/bridge-evm/script/DeployBridge.s.sol:154-201`, `packages/bridge-evm/test/DeployBridge.fork.t.sol:49-99`).
- **Files touched:** `packages/bridge-evm/script/DeployBridge.s.sol`, new small price/route helper under `packages/bridge-evm`, `packages/bridge-evm/test/{SwapBridgeRouterPermit2Fork.t.sol,DeployBridge.fork.t.sol,RouteValidation.t.sol}`, likely a new math test.
- **Validation gate:** `cd packages/bridge-evm && forge test --match-path test/RouteValidation.t.sol && forge test --match-path test/DeployBridge.fork.t.sol && forge test --match-path test/SwapBridgeRouterPermit2Fork.t.sol`.

2. **Phase 2: Live deploy, seed, verify, and persist addresses**
- **Goal:** Deploy `UniswapFuelSwap` and `SwapBridgeRouter`, seed ETH/FJ plus AZLO/WETH with realistic liquidity, then extend config and Etherscan verification. The current defaults consume `ETH_SEED=0.5`, `WETH_SEED=2`, `FEE_MINT_COUNT=100` (`packages/bridge-evm/script/DeployBridge.s.sol:146-150,186-201`), so the current deployer balance cannot support the script as-is; top-up or a different funded deployer is required. FJ minting is permissionless at 1000 FJ/call (`implementations-plan/faucet-bridge/research/recon-testnet.md:10-12,20-28`), and the live token exposes a mint surface the app already uses (`packages/faucet/src/composables/useL1Usdc.ts:8-18,98-117`).
- **Files touched:** `packages/bridge-evm/script/DeployBridge.s.sol`, `packages/bridge-core/scripts/verify-l1.ts`, a small config-writer/merge script, `packages/faucet/public/testnet-bridge.json`, `packages/faucet/src/contracts/bridge-deployments.ts`, `packages/faucet/src/components/BridgeFooter.vue`.
- **Validation gate:** `cd packages/bridge-evm && forge script script/DeployBridge.s.sol:DeployBridge --rpc-url $SEPOLIA_RPC_URL --broadcast`; `cd packages/bridge-core && bun run verify:l1 --dry-run && bun run verify:l1`; `jq '.l1' packages/faucet/public/testnet-bridge.json`.

3. **Phase 3: Wire the L1 fueled branch in SDK + faucet without regressing non-fuel deposits**
- **Goal:** Leave non-fuel deposits on the existing portal path (`packages/faucet/src/composables/useDeposit.ts:232-277`) and send only fuel-enabled deposits through `runSwapBridge`, which already persists both secrets before broadcast and returns both leaf indices from the `BridgeWithFuel` event (`packages/bridge-core/src/flows.ts:230-326`). Build the route in code from addresses, not constants, because `_validateRoute` only tolerates the native unwrap at the last boundary (`packages/bridge-evm/src/UniswapFuelSwap.sol:228-274`, `packages/bridge-evm/test/RouteValidation.t.sol:85-109`).
- **Files touched:** `packages/bridge-core/src/{l1.ts,flows.ts}` plus a new quote/route helper, `packages/faucet/src/composables/useDeposit.ts`, probably a Permit2 allowance helper.
- **Validation gate:** `cd packages/bridge-core && bun run test && bun run typecheck`.

4. **Phase 4: Make the L2 claim zero-gas-capable and upgrade persistence**
- **Goal:** Claim FeeJuice inside the token-claim tx by default, not in a separate tx. That is the only path that bootstraps a zero-gas account cleanly on 4.2.0 (`packages/bridge-core/src/fee-juice.ts:24-29`; `implementations-plan/faucet-bridge/research/aztec-4.2.0-portals-fees.md:103-139`), while the current faucet claim path is still hardwired to `SponsoredFeePaymentMethod` (`packages/faucet/src/composables/useDeposit.ts:85-110`). The journal and backup formats must become v2 because they are currently v1-only and have no fuel fields (`packages/bridge-core/src/journal.ts:26-37,54-72,85-87,97-133`; `packages/bridge-core/src/backup.ts:14-27,43-45,71-120`).
- **Files touched:** `packages/bridge-core/src/{journal.ts,backup.ts,fee-juice.ts}`, `packages/faucet/src/composables/{useDeposit.ts,useBridgeJournal.ts}`, `packages/faucet/src/lib/capabilities.ts`, optionally a small sponsored standalone FJ-claim recovery helper.
- **Validation gate:** `cd packages/bridge-core && bun run test`; `cd packages/faucet && bun run test && bun run typecheck`.

5. **Phase 5: Add the fuel UX inside the existing deposit form and stepper**
- **Goal:** Keep one form, one journal record, one receipt path, but add a fuel toggle and AZLO fuel-slice input on L1→L2 only. `BridgeForm.vue` already owns the unified form/stepper handoff (`packages/faucet/src/components/BridgeForm.vue:39-146,222-339`), while the current step model has no fuel phase (`packages/faucet/src/lib/bridge-steps.ts:42-99`). The “fuel phase” should narrate the extra typed-data signature + router swap; the actual L2 claim remains one Aztec tx that claims fuel and token together.
- **Files touched:** `packages/faucet/src/components/BridgeForm.vue`, `packages/faucet/src/lib/bridge-steps.ts`, likely `BridgeStepper.vue`, `BridgeReceipt.vue`, and pending-record cards.
- **Validation gate:** `cd packages/faucet && bun run test && bun run typecheck`; keep `packages/faucet/src/components/BridgeForm.18dec.test.ts:5-19,58-70` as the precision guard and add fueled-form specs beside it.

6. **Phase 6: Verify with fork tests, SDK smoke, component tests, and manual testnet runs**
- **Goal:** Prove the contract path on fork, the SDK path in headless TS, and the user path manually on live testnet. `bridge-core` already treats `runSwapBridge` as a supported flow (`packages/bridge-core/README.md:12-18,29-33`) and already has a live direct-deposit smoke script (`packages/bridge-core/scripts/deposit-testnet.ts:180-236`); add a fueled sibling rather than relying only on UI clicks.
- **Files touched:** tests across `packages/bridge-evm`, `packages/bridge-core`, `packages/faucet`, plus a new `packages/bridge-core/scripts/swap-bridge-testnet.ts` or extension of the existing smoke script.
- **Validation gate:** `cd packages/bridge-evm && forge test`; `cd packages/bridge-core && bun run test && bun run typecheck`; `cd packages/faucet && bun run test && bun run typecheck`; `cd packages/faucet && bun run dev` for manual live checks.

## 2. Security & Adversarial Considerations

- The router owner can retarget swaps at any time via `setSwapTarget` (`packages/bridge-evm/src/SwapBridgeRouter.sol:141-147`), and both contracts can sweep balances (`packages/bridge-evm/src/SwapBridgeRouter.sol:276-291`, `packages/bridge-evm/src/UniswapFuelSwap.sol:285-303`). Treat ownership as an operational trust boundary, not a cosmetic admin field.
- `minFuelOutput` is the only on-chain price bound during the public-pool swap (`packages/bridge-evm/src/SwapBridgeRouter.sol:189-195`, `packages/bridge-evm/src/UniswapFuelSwap.sol:79-115`). With dust liquidity, a third party can move price enough to underfund the gas packet even if the L1 tx still succeeds. The UI needs a quoter-based estimate, slippage bound, and a “predicted FJ must exceed current min fee with margin” guard.
- Witness replay/tamper is mostly solved already: nonce/deadline come from Permit2, and the witness binds token portal, amounts, both recipients/secrets, `routeHash`, and `isPrivate` (`packages/bridge-evm/src/SwapBridgeRouter.sol:52-56,161-181,295-340`; `packages/bridge-core/src/l1.ts:10-15,39-59,75-152`). Keep the fork tests that prove nonce replay and expired signatures revert (`packages/bridge-evm/test/SwapBridgeRouterPermit2Fork.t.sol:239-264`).
- Content-hash drift still strands funds cross-chain. The repo already calls this out explicitly (`packages/bridge-evm/test/ContentHash.t.sol:7-12,24-40`). Any new claim helper or standalone FeeJuice rescue path must be pinned against canonical selectors/args.
- The fixed two-hop route hides a sharp edge: WETH/native ETH discontinuity is only settleable on the final boundary (`packages/bridge-evm/src/UniswapFuelSwap.sol:184-215,266-271`; `packages/bridge-evm/test/RouteValidation.t.sol:95-109`). Do not generalize to arbitrary multi-hop V4 routing in this arc.
- Least privilege matters because the wallet enforces granted scope hard (`packages/faucet/src/lib/capabilities.ts:122-169,191-258`; `packages/wallet-bridge/src/scope-enforcement.ts:104-140`). Add only FeeJuice + exact claim/balance methods; do not widen to generic protocol contracts.
- Refund/retry semantics must stay honest. The L1 swap+bridge is atomic, so swap failure reverts the whole deposit (`packages/bridge-evm/src/SwapBridgeRouter.sol:184-230`). After L1 success, token and fuel are separate L1→L2 messages (`implementations-plan/faucet-bridge/research/holonym-l2-and-fee-juice.md:22-28`); a failed token claim does not mean the FeeJuice message was consumed, and the journal has to model that precisely.
- Backup parsing is intentionally strict today (`packages/bridge-core/src/backup.ts:29-63,71-120`). Keep that posture in v2; malformed or partial fuel metadata should reject restore, not be guessed through.

## 3. Assumptions

**Facts**
- `isPrivate` is already part of the Solidity and TS Permit2 witness shapes, so “private deposit + public fuel” does not require a witness redesign: `packages/bridge-evm/src/SwapBridgeRouter.sol:52-56,113-125`, `packages/bridge-core/src/l1.ts:11-15,25-37,87-99`.
- The current Sepolia deploy/fork path is still 6-dec USDC-shaped, not AZLO-shaped: `packages/bridge-evm/script/DeployBridge.s.sol:141-201`, `packages/bridge-evm/test/SwapBridgeRouterPermit2Fork.t.sol:154-183`, `packages/bridge-evm/test/DeployBridge.fork.t.sol:84-99`.
- Live faucet config already points at 18-dec AZLO and the current portal/L2 bridge deployment: `packages/faucet/public/testnet-bridge.json:3-35`, `packages/faucet/src/contracts/bridge-deployments.ts:17-27`.
- `runSwapBridge` already exists and returns both secrets and both leaf indices from `BridgeWithFuel`: `packages/bridge-core/src/flows.ts:221-326`.
- The faucet still deposits directly to the portal and only tracks one token-side leaf index/secret: `packages/faucet/src/composables/useDeposit.ts:177-191,232-309`.
- Journal and backup persistence are v1-only and fuel-unaware: `packages/bridge-core/src/journal.ts:26-37,54-72,85-87`, `packages/bridge-core/src/backup.ts:16-27,71-120`.
- The wallet manifest currently omits FeeJuice methods, and the wallet will reject out-of-scope tx/sim calls: `packages/faucet/src/lib/capabilities.ts:122-169,191-258`, `packages/wallet-bridge/src/scope-enforcement.ts:104-140`.
- Aztec is pinned to 4.2.0 across the relevant packages: `packages/bridge-core/package.json:17-29`, `packages/faucet/package.json:18-37`, `packages/bridge-evm/README.md:3-6`.

**Inferences**
- The safest implementation is a dual-path deposit: direct portal when fuel is off, router when fuel is on. Forcing all deposits through Permit2/router would expand regression surface for no product gain.
- Extension code likely does not need structural changes for the happy path, because the wallet already knows `claim_and_end_setup` and already has the embedded fee-cap fix (`packages/extension/src/wallet/utils/fee-juice.ts:14-22`, `packages/extension/src/wallet/services/execution/fee/embedded-fpc-cap.ts:24-33,71-81`). The main work is manifest scope plus app orchestration.
- The user-facing fuel control should be “AZLO slice with estimated FJ output,” not “target FeeJuice amount.” The contract swaps an exact AZLO input; target-FJ UX adds inverse quoting and more failure modes.
- Meaningful pool depth is a security requirement, not just an ops preference. A tiny pool makes quoting, slippage, and “arrive with gas” materially unreliable.

**Asks**
- Pick the initial AZLO/WETH price and tick width to seed. The old 2100-USDC/WETH constants are not portable to 18-dec AZLO without an explicit target price.
- Approve the live deploy budget and owner model: top up the current deployer or switch deployer, and choose the long-term owner for `setSwapTarget`/`sweep`.
- Decide the default fuel presets and max cap in UX: fixed AZLO presets, percent-of-deposit presets, or raw numeric input only.
- Decide the rescue UX for an underfunded gas packet: expose an in-app sponsored fallback path in this arc, or accept a manual operator recovery runbook.

## 4. Decision Points Where I Disagree With the Obvious Approach

- **Do not route every L1→L2 deposit through `SwapBridgeRouter`.** The obvious simplification is “one contract path for everything,” but the repo already has a proven direct deposit flow (`packages/faucet/src/composables/useDeposit.ts:232-309`) and a separate fueled flow (`packages/bridge-core/src/flows.ts:230-326`). Replacing the default path would buy symmetry and cost reliability.
- **Do not model fuel as a separate default L2 tx.** The obvious interpretation of “stepper gains a fuel phase” is “claim fuel, then claim token.” That strands zero-gas users. The correct default is one Aztec claim tx paid by `FeeJuicePaymentMethodWithClaim`; the “fuel phase” is narration, not a second normal user action.
- **Do not solve the budget shortfall by dust-seeding the pools first.** That is the cheapest deploy, but it makes price manipulation and underfunded-gas failures more likely. For public pools, thin liquidity is a product bug, not just poor ops.
- **Do not hand-edit AZLO/WETH sqrt-price and tick constants.** The current USDC values are already the proof that magic numbers rot (`packages/bridge-evm/script/DeployBridge.s.sol:141-145`). Add a deterministic helper and a test that computes the live constants from one human price input.
- **Do not ask users for desired FeeJuice output.** The tempting UX is “How much gas do you want?” but the swap is exact-input on AZLO, and the real risk is underfunding due to price movement. An AZLO slice with live estimated FJ, min output, and fee sufficiency messaging is simpler and more honest.