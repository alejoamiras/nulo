# private-fuel — draft B (Opus 4.8 planner) — distinctive findings

Deep-research plan (52 tool-uses). Its framing corrections over the brief are the load-bearing contribution; full phase text folded into `plan.md`. Paths here are repo-relative; external repos referenced by name (Wonderland `aztec-fee-payment` clone, Holonym `holonym-aztec-bridge`).

## The big reframe: ~half the wallet work is ALREADY shipped (not this arc)
- The extension **already bundles** the PrivateFPC artifact from the *installed* `215fd08` tarball via vite/vitest alias `@private-fpc-artifact` → `@wonderland/aztec-fee-payment/target/private_contract-PrivateFPC.json` (`packages/extension/vite.config.ts:49-50`, `vitest.config.ts:39`).
- The extension **already auto-registers** the PrivateFPC into its PXE at `salt=Fr.zero(), deployer=AztecAddress.ZERO` and derives its deterministic address (`packages/extension/src/wallet/services/fpc/service.ts:90-101,172-184`). There is `FpcType.PrivateFpc`, a `PrivateFpcHandler`, and a wallet-native `FpcStrategy` (two-step `mint`-then-`pay_fee`).
- The **`derive_bridge_secret` TS↔Noir keystone is ALREADY proven** in an e2e fixture: `poseidon2HashWithSeparator([salt, claimer], DOM_SEP)`, `DOM_SEP = poseidon2HashBytes("az_dom_sep__fpc_bridge_secret") & 0xffffffff === 3952304070` (`packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:24,33,60-61`; Noir `main.nr:38,231`). → P1 is "lift + pin", not "derive from scratch".
- The L1 router already carries `fuelRecipient`/`fuelSecretHash` witness-bound; `SwapBridgeRouter.sol:89` comment literally says "user for public fuel, FPC for private fuel". No Solidity change.

## The scope-collapsing insight (the faucet path)
The faucet does **NOT** use the wallet-native fee strategy. It connects via wallet-sdk and calls aztec.js `bridge.methods.claim_*().send({ fee })` (`packages/faucet/src/composables/useDeposit.ts:202-274`). So `PrivateMintAndPayFeePaymentMethod.getExecutionPayload()` runs **dApp-side** in the faucet, producing the two private calls (`FeeJuice.claim` + `PrivateFPC.mint_and_pay_fee`) with `feePayer=FPC`. The wallet ingests via `detectEmbeddedFeePayment(feePayer, from)` → `feePayer≠from` → `"fpc"` → `EmbeddedStrategy` → `AccountFeePaymentMethodOptions.EXTERNAL` → sends the pre-built calls **verbatim** (`operation-planner.ts:216,234-239`; `embedded-strategy.ts:27-31`; `dapp-send-executor.ts:573`).
→ **The wallet does NOT need a new "private-fjwc" embedded mode for the faucet.** It already honors the embedded EXTERNAL payload (same as the two-step FPC + fjwc embedded paths). Wallet work shrinks to: manifest scope + gas budget + confirm the cold-start payload simulates. (A wallet-native cold-start mode would only be needed for the wallet's OWN Send UI — out of scope.)

## The critical fund-loss bug this arc must fix
`runSwapBridge` hardcodes `fuelSecret = Fr.random()` (`packages/bridge-core/src/flows.ts:251-254`). Random is correct for PUBLIC fuel (recipient-bound claim) but **fatal for private** — the claimer must reconstruct `derive_bridge_secret(salt, claimer)` to rebuild the FeeJuice nullifier inside `mint_and_pay_fee`; a random secret = FJ bridged to the FPC and **permanently unrecoverable**. Fix: make the fuel secret an INJECTED input (`fuelSecret?: Fr`), derived by the caller at the call site where recovery persistence already lives; keep the public path byte-identical.

## The two-salts trap (subtle; fund-loss / double-claim)
- **FPC-ADDRESS salt = `Fr.zero()`** (fixed — must match the wallet's registration `service.ts:88-94`).
- **BRIDGE-SECRET salt = per-deposit `Fr.random()`** (persisted in the journal) — `mint_and_pay_fee`'s nullifier binds `(fpc, amount, salt, claimer, leafIndex, …)` (`main.nr:80-96`); reusing a salt collides the nullifier → second claim reverts. Confusing the two = a fund-loss/duplicate bug. Must be called out in code comments.

## The version trap (THE headline irreversible risk)
Derive the FPC address from the **installed `215fd08` artifact** (the exact one the wallet registers), NOT the rc.2 clone — Wonderland's `yarn compute` uses the clone's bytecode → a *different* address → deposits unrecoverable. Mitigate: runtime-derive in each consumer + a test pinning the address string (drift tripwire) + check live `node_getNodeInfo.nodeVersion` against the tarball's compile version before any fund-moving phase. **Dust canary**: the P4 private variant defaults its first slice to a minimal amount and asserts the credit lands before scaling.

## Phases (Opus structure)
- **P0** Determinism spike: pin FPC address from the installed artifact + reconcile live node version; prove `deriveBridgeSecret` parity vs the existing fixture + Noir; address tripwire test. (No funds moved.)
- **P1** bridge-core: `deriveBridgeSecret`/`privateFuelSecretHash`/`derivePrivateFpcAddress`/`privateMintAndPayFee` wrapper; inject `fuelSecret?: Fr` into `runSwapBridge` (public path byte-identical); add `@wonderland/aztec-fee-payment` to bridge-core; journal `DepositFuelBlock` gains optional `salt?`/`fpc?`.
- **P2** wallet: bridge-manifest scope `FeeJuice.claim` + `PrivateFPC.mint_and_pay_fee` + FPC in `contracts`; explicit FPC registration in the bridge session; gas-cap parity test (dApp-supplied min-fee survives `applyEmbeddedFpcGasCap`). NOT a new strategy.
- **P3** faucet: B-presets (private default), remove the `if(priv) fuelOn=false` guard, gas strictly follows `isPrivate`; no-fuel claim stops forcing Sponsored (guarded cold-start fallback); private-fuel deposit (`fuelRecipient=FPC`, injected derived secret, persist salt+fpc) + cold-start claim with explicit `gasSettings` (min-fee, teardown 0); gate `fuel.received >= estimatedMaxGasCost` pre-send.
- **P4** live private-FJ run (REQUIRED gate): fork `runVariant` → `runPrivateVariant` (register FPC, `fuelRecipient=fpc`, inject derived secret, pay via `PrivateMintAndPayFeePaymentMethod`); assert the user's PUBLIC FJ does NOT increase (privacy proof) + no Sponsored touched it; recalibrate `MIN_FUEL_FJ`. Dust-canary first slice.
- **P5** `/harden security` over bridge+fee surface.

## Opus Asks
1. **Version reconciliation (BLOCKING before P4)**: confirm live testnet `nodeVersion` ↔ the `215fd08` tarball's compile version yields the address the network recognizes; who owns the pin?
2. **No-fuel cold-start**: does the wallet's default (`PREEXISTING_FEE_JUICE`) surface a payable method for a cold zero-FJ account, or must the faucet keep a guarded Sponsored fallback? (Inference: needs the fallback.)
3. **Salt persistence + sealing**: seal the per-deposit bridge-secret salt with the same AES-GCM posture as private token secrets; `salt?`/`fpc?` as schema-2-additive (no bump).
4. **Dust-canary policy**: standing policy to canary any future FPC artifact re-pin.
