# private-fuel — draft C (codex planner)

# Private-Fuel Arc Plan

**Scope Guards**
- Branch: `feat/private-fuel`.
- Testnet only; never mainnet.
- Keep Aztec pinned to `4.2.0` across Nulo packages and derive any PrivateFPC address from the shipped Wonderland artifact, not the local clone (`package.json:39-43`; `packages/bridge-core/package.json:17-29`; `packages/faucet/package.json:18-24`; `packages/wallet-bridge/package.json:13-19`; `packages/extension/package.json:31-40,63`; `node_modules/@wonderland/aztec-fee-payment/package.json:2-34`).

**Standard Validation Matrix**
```bash
cd packages/bridge-evm
forge test

cd ../bridge-core
bun run test

cd ../faucet
bun run test

cd ../wallet-bridge
bun run test

cd ../..
bun run audit:vue
```
- Layers: `bridge-evm` for L1 witness/router invariants, `bridge-core` for fuel math and persistence, `faucet` for claim matrix/UI, `wallet-bridge` for serialized fee metadata, `extension` via `audit:vue` for typecheck/unit/lint/build (`packages/bridge-evm/README.md:21-24`; `package.json:16-18,27-31`; `packages/extension/README.md:65-69`).

## Phase 0 — Safety Keystone First
- Goal: lock the irreversible parts before any UX work: deterministic PrivateFPC address, TS↔Noir bridge-secret parity, and persistent record shape.
- Files: `packages/bridge-core/src/fee-juice.ts:1-47`, `packages/bridge-core/src/flows.ts:230-255`, `packages/bridge-core/src/journal.ts:35-37,55-77,97-99,124-160`, `packages/bridge-core/src/backup.ts:107-130`, `packages/extension/src/wallet/services/fpc/service.ts:82-100,132-214`, `packages/extension/vite.config.ts:48-50`, `packages/aztec-runtime/src/pxe/known-artifacts.ts:41-64`, `packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:28-61`.
- Reference anchors: Wonderland says PrivateFPC has no public deployment tx and its address depends on compiled bytecode; wrong bytecode means unrecoverable loss (`the Wonderland aztec-fee-payment clone/README.md:71-90`). Noir defines `DOM_SEP__FPC_BRIDGE_SECRET = 3952304070` and `derive_bridge_secret(salt, claimer)` (`the Wonderland aztec-fee-payment clone/src/nr/private_contract/src/main.nr:35-38,220-231`).
- Work: add one shared `bridge-core` helper for `deriveBridgeSecret`, `computePrivateFuelSecretHash`, and `getProtocolPrivateFpcAddress`; distinguish `fpcAddressSalt = Fr.ZERO` from per-deposit `bridgeSecretSalt`; persist `fuelPrivacy`, `bridgeSecretSalt`, and `fpcAddress`; fix the journal root schema bug while touching this.
- Validation gate: run the standard matrix, plus new keystone tests that compare bridge-core TS outputs against the Noir constant/vector and the existing Nulo e2e helper (`packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:60-61`).
- Pass criteria: `bridge-core` proves TS secret derivation parity; `extension` derives the same protocol PrivateFPC address the PXE auto-discovers; journal/backup reject malformed private-fuel records instead of guessing through them.

## Phase 1 — Bridge-Core Private Fuel Plumbing + Headless Proof
- Goal: make private token bridges automatically use private fuel on L1 without any Solidity change.
- Files: `packages/bridge-core/src/flows.ts:237-275`, `packages/bridge-core/src/l1.ts:25-37,69-152`, `packages/bridge-core/src/router-abi.ts:1-68`, `packages/bridge-core/scripts/fuel-testnet.ts:1-12,171-248`; existing L1 support is already present in `packages/bridge-evm/src/SwapBridgeRouter.sol:83-96,151-238` and tested in `packages/bridge-evm/test/SwapBridgeRouter.t.sol:176-212` and `packages/bridge-evm/test/SwapBridgeRouterPermit2Fork.t.sol:164-206`.
- Work: change only bridge-core inputs. Public token + fuel keeps `fuelRecipient = user` and random fuel secret; private token + fuel sets `fuelRecipient = protocolPrivateFpcAddress` and `fuelSecretHash = computeSecretHash(deriveBridgeSecret(bridgeSecretSalt, claimer))`. Keep using event-derived `fuelReceived` and `fuelLeafIndex` as the only authoritative claim inputs.
- Work: extend `packages/bridge-core/scripts/fuel-testnet.ts` so the public branch stays on `FeeJuicePaymentMethodWithClaim`, while the private branch bridges to PrivateFPC and claims via Wonderland’s cold-start path instead of today’s public-FJ claim (`packages/bridge-core/scripts/fuel-testnet.ts:181-205,240-248`).
- Validation gate: standard matrix, plus:
```bash
cd packages/bridge-core
bun run scripts/fuel-testnet.ts
```
- Pass criteria: headless live testnet run succeeds for both token privacies with real proofs; private run shows `fuelRecipient != user` on L1 and lands enough FJ to self-pay; `MIN_FUEL_FJ` calibration still comes from worst observed real fee (`packages/bridge-core/scripts/fuel-testnet.ts:243-248`).

## Phase 2 — Wallet Private-FJWC Embedded Mode
- Goal: add a dedicated wallet path for private cold-start claims; do not force the Wonderland method through generic `"fpc"`.
- Files: `packages/wallet-bridge/src/operation.ts:59-71`, `packages/extension/src/wallet/services/execution/utils/fee-detection.ts:1-13`, `packages/extension/src/wallet/services/execution/operation-planner.ts:157-241`, `packages/extension/src/wallet/services/execution/fee/embedded-strategy.ts:24-51`, `packages/extension/src/wallet/services/execution/fee/embedded-fpc-cap.ts:39-82`, `packages/extension/src/wallet/services/execution/service.ts:246-258`, `packages/extension/src/wallet/services/execution/dapp-send-executor.ts:336-364,476-493`, `packages/extension/src/popup/components/modules/tx/tx-detail-helpers.ts:67-75`.
- Public precedent to mirror: `fjwc` already has structured claim args in wallet-bridge and a dedicated strategy in the extension (`packages/wallet-bridge/src/fee.ts:7-17`; `packages/extension/src/wallet/services/execution/fee/fee-juice-with-claim-strategy.ts:20-41`; `packages/extension/src/wallet/utils/fee-juice.ts:14-22`).
- Work: add a third embedded mode, e.g. `private_fjwc`, and carry `{ fpcAddress, claimAmount, claimSecret, bridgeSecretSalt, messageLeafIndex }` end-to-end. The current planner only preserves an embedded mode string plus gas settings (`packages/extension/src/wallet/services/execution/operation-planner.ts:213-231`), so the five private args must be added explicitly.
- Work: build `PrivateMintAndPayFeePaymentMethod` from those five args, ensure the protocol PrivateFPC is registered before prove, and extend embedded gas-cap logic to cover this mode. Do not reuse generic `"fpc"` because current detection collapses every `feePayer !== from` into the same external path (`packages/extension/src/wallet/services/execution/utils/fee-detection.ts:8-13`).
- Validation gate: standard matrix.
- Pass criteria: `wallet-bridge` serializes the new embedded mode; `extension` reconstructs Wonderland’s `FeeJuice.claim + mint_and_pay_fee` method (`the Wonderland aztec-fee-payment clone/src/ts/fee-payment-methods/private.ts:13-85`); tx history labels the bridge claim as private gas rather than generic external FPC.

## Phase 3 — Faucet Claim Matrix + B-Presets Redesign
- Goal: ship the product behavior change: privacy presets, private default, fuel no longer withheld on private, and wallet-owned no-fuel fee selection.
- Files: `packages/faucet/src/composables/useDeposit.ts:212-290`, `packages/faucet/src/components/BridgeForm.vue:41-50,109-123,151-153,184-198`, `packages/faucet/src/lib/capabilities.ts:156-179,236-270`, `packages/faucet/src/contracts/bridge-deployments.ts:20-50`.
- Work: replace the current toggle pair with two preset cards `PUBLIC` / `PRIVATE`, default `PRIVATE`, fuller copy, and keep “arrive with gas” as an optional bridge choice whose privacy is implied by the selected card. Remove the `isPrivate => fuelOff` watcher and the `!isPrivate` submit guard.
- Work: change claim fee behavior in `useDeposit`:
  - no fuel: omit dApp fee injection entirely;
  - public fuel: keep `FeeJuicePaymentMethodWithClaim`;
  - private fuel: use the new private embedded mode.
- Work: widen the manifest so the wallet can simulate/send `FeeJuice.claim` and `PrivateFPC.mint_and_pay_fee`; today it only scopes `claim_and_end_setup` and the sponsored FPC path (`packages/faucet/src/lib/capabilities.ts:163-179,247-265`). Holonym scopes the needed methods already (`the Holonym holonym-aztec-bridge reference/frontend/src/utils/walletCapabilities.ts:62-75`).
- Validation gate: standard matrix.
- Pass criteria: the UI no longer makes private fuel impossible; public/private gas privacy follows the card by construction; no-fuel claims stop hardwiring `SponsoredFeePaymentMethod`.

## Phase 4 — Integrated Dev-Merge Gate
- Goal: prove the full matrix together before merging to `dev`.
- Files: `packages/bridge-core/scripts/fuel-testnet.ts:1-12,171-248`, `packages/extension/tests/e2e/fixtures/aztec.ts:373-446`, `packages/extension/tests/e2e/network/fee-methods.test.ts:117-177`, plus the new bridge-core/faucet/wallet-bridge/unit coverage from earlier phases.
- Work: add targeted tests for the new serialized private-fuel mode, faucet claim branching, journal round-trips, and extension strategy selection. Keep the headless script as the required gate; manual click-through remains a `dev -> main` promote gate, not a `dev` merge gate.
- Validation gate: standard matrix, plus the live script from Phase 1.
- Pass criteria: `bridge-evm`, `bridge-core`, `faucet`, `wallet-bridge`, and `extension` are green; live public-fuel baseline still passes; live private-fuel path passes with real proofs; no manual-only step is required for merge to `dev`.

## Phase 5 — `/harden security` Close-Out
- Goal: harden the bridge+fee surface after functionality is stable.
- Files: touch only the files already changed in Phases 0-4, plus any focused threat-model notes.
- Work: add fail-closed guards so private token + public gas is impossible below the UI; enforce testnet-only/version/address checks around PrivateFPC; minimize capability scope; re-audit journal recovery, dropped-claim recovery, and gas-cap correctness; add negative tests for stale node version, wrong FPC address snapshot, wrong bridge-secret salt, dropped embedded claim, and malformed backup data.
- Validation gate: standard matrix, plus a final rerun of `bun run scripts/fuel-testnet.ts`.
- Pass criteria: every adversarial case either blocks before funds move, or leaves a recoverable state without privacy downgrade.

## Decision Points
- Do not use the local Wonderland clone as the address authority. The repo ships `@wonderland/aztec-fee-payment@4.2.0-prerelease.215fd08`, while the local clone is `4.2.0-aztecnr-rc.2`; only the shipped artifact should derive the live testnet PrivateFPC address (`node_modules/@wonderland/aztec-fee-payment/package.json:2-34`; `the Wonderland aztec-fee-payment clone/package.json:2-4,48-59,74-76`).
- Do not overload generic `"fpc"`. Current extension logic treats every `feePayer !== from` as generic external FPC (`packages/extension/src/wallet/services/execution/utils/fee-detection.ts:8-13`), which is too weak for a cold-start claim that needs five bridge-specific args.
- Do not just delete the sponsored fallback in the faucet and call it done. The dApp must stop forcing sponsor, but the wallet’s real no-fuel behavior must still be proven in the bridge claim flow.
- Do not duplicate Holonym’s server-only secret route verbatim. Nulo should centralize the derivation in `bridge-core` and reuse it everywhere, including the live script and extension tests.
- Do not start with the Vue preset redesign. The first spike must be address/version/secret correctness, because those are the fund-loss edges.

## Security & Adversarial
- Wrong artifact or wrong node version means wrong PrivateFPC address and unrecoverable deposits; mitigate with shipped-artifact derivation, checked-in version/address snapshot, and a dust canary before larger deposits (`the Wonderland aztec-fee-payment clone/README.md:90-95`).
- Secret-derivation drift strands fuel permanently; mitigate with one shared helper and TS↔Noir↔existing-helper keystone tests (`packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:28-61`; `the Wonderland aztec-fee-payment clone/src/nr/private_contract/src/main.nr:220-231`).
- Gas-padding mistakes can make `mint_and_pay_fee` revert by exceeding the bridged budget; mitigate with a dedicated private embedded mode and explicit gas-cap tests (`packages/extension/src/wallet/services/execution/fee/embedded-fpc-cap.ts:8-33,39-82`).
- Journal loss of `bridgeSecretSalt` is a fund-loss bug, not a UX bug; private fuel needs a stricter schema than the current public-fuel block (`packages/bridge-core/src/journal.ts:55-77`).
- Private token + public gas must be impossible at the API layer, not just hidden in Vue; reject it in bridge-core/faucet/wallet serialization.
- Capability overscope is unnecessary attack surface; scope only the methods needed for `claim`, `claim_and_end_setup`, `mint`, `mint_and_pay_fee`, and recovery.

## Assumptions

**Facts**
- `bridgeWithFuel` already binds `fuelRecipient` and `fuelSecretHash` in both TS and Solidity, and the router deposits Fee Juice to that arbitrary L2 recipient (`packages/bridge-core/src/l1.ts:25-37,69-152`; `packages/bridge-core/src/router-abi.ts:1-68`; `packages/bridge-evm/src/SwapBridgeRouter.sol:83-96,206-238`).
- The current headless script still routes all fuel to the user address and self-pays private token claims with public `FeeJuicePaymentMethodWithClaim` (`packages/bridge-core/scripts/fuel-testnet.ts:181-205,217-248`).
- The faucet claim builder currently starts sponsored and only upgrades fueled records to public FJWC (`packages/faucet/src/composables/useDeposit.ts:212-290`).
- The faucet UI is public-by-default and forcibly disables fuel on private (`packages/faucet/src/components/BridgeForm.vue:43-50,151-153,195-198`).
- `wallet-bridge` only recognizes embedded `fjwc | fpc`, and the extension maps `feePayer === from` to `fjwc`, else `fpc` (`packages/wallet-bridge/src/operation.ts:59-71`; `packages/extension/src/wallet/services/execution/utils/fee-detection.ts:8-13`; `packages/extension/src/wallet/services/execution/operation-planner.ts:234-239`).
- The popup owns non-embedded dApp fee selection; embedded ops bypass that UI (`packages/extension/src/popup/windows/execute/index.vue:239-250`; `packages/extension/src/popup/windows/execute/operation-validation.ts:30-56`; `packages/extension/src/wallet/services/dapp-interaction/materialize.ts:115-123`).
- The wallet fee UI auto-selects sponsored when a protocol sponsored FPC is available, while public/private FJ options disable on zero balance (`packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:241-251`; `packages/extension/src/popup/components/modules/send/fee-helpers.ts:78-98,146-183`).
- Nulo already auto-discovers protocol PrivateFPC from the bundled Wonderland artifact with `salt = Fr.zero()` and `deployer = ZERO` (`packages/extension/src/wallet/services/fpc/service.ts:82-100,132-214`).
- Holonym’s working private-fuel flow sets `fuelRecipient = PRIVATE_FPC_ADDRESS`, overrides `fuelSecretHash`, and pays the L2 claim with `PrivateMintAndPayFeePaymentMethod` (`the Holonym holonym-aztec-bridge reference/frontend/src/hooks/bridge/bridgeL1ToL2.ts:994-1052`; `the Holonym holonym-aztec-bridge reference/frontend/src/hooks/useL1Operations.ts:881-963`).

**Inferences**
- The shipped tarball, not the local clone, must be the canonical bytecode source for any real testnet deposit.
- The bridge journal needs a real schema bump, not a one-field patch, because private fuel adds a per-deposit bridge salt and the current root serializer/parser are already inconsistent.
- Private cold-start needs its own embedded mode because current generic `"fpc"` metadata is too lossy.
- The no-fuel first-claim path is probably viable today because the wallet auto-selects sponsored when available, but that must be proven in the actual bridge claim flow before the faucet stops injecting sponsor.

**Asks**
- Should the verified testnet PrivateFPC address live in deployment config, or in a generated snapshot/test artifact only?
- Is the dust canary required on every promotion, or only when the Aztec node version / Wonderland artifact changes?
- If a no-fuel first claim lands on the wallet’s auto-selected sponsored FPC, is that acceptable as “wallet-owned fee strategy,” or should the popup force an explicit confirmation for that first sponsored choice?