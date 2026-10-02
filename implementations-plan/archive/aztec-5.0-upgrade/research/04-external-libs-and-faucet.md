# Research: external libs (accelerator / fee-payment / standards) + faucet

Paths repo-relative.

## Target version matrix (confirmed)
| dep | current | target | install form |
|---|---|---|---|
| `@alejoamiras/aztec-accelerator` | `4.2.0` | `5.0.0-rc.1` | npm version |
| `@wonderland/aztec-fee-payment` | tgz `prerelease-215fd08` (`4.2.0-prerelease.215fd08`) | tgz `prerelease-fb6f196` → `5.0.0-rc.1-prerelease.fb6f196` | GitHub release tgz URL |
| `@defi-wonderland/aztec-standards` | npm `4.2.0-aztecnr-rc.2` | tgz `prerelease-334c38d` → `5.0.0-rc.1-prerelease.334c38d` | **changes from npm version → GitHub tgz URL** |

Both Wonderland tgz built from `chore/v5.0.0` branch (release pages confirm 5.0 alignment). Exact tgz URLs:
- `https://github.com/defi-wonderland/aztec-fee-payment/releases/download/prerelease-fb6f196/wonderland-aztec-fee-payment-5.0.0-rc.1-prerelease.fb6f196.tgz`
- `https://github.com/defi-wonderland/aztec-standards/releases/download/prerelease-334c38d/defi-wonderland-aztec-standards-5.0.0-rc.1-prerelease.334c38d.tgz`

## Accelerator SDK wiring
- `packages/aztec-runtime/src/pxe/chain-runtime.ts:5` import `AcceleratorProver`, `AcceleratorPhase`; `:173` `new AcceleratorProver({simulator, onPhase, accelerator})`; `:180` `checkAcceleratorStatus()`; `:192` passed to `createPXE` as `proverOrOptions`.
- Required mode: `VITE_NULO_ACCELERATOR_REQUIRED=1` → `onPhase` throws on `fallback`/`denied`; eager preflight. Proverless: `VITE_NULO_E2E_PROVERLESS=1` skips prover.
- vite alias `@alejoamiras/aztec-accelerator` → dist (shared vite config).
- RISK: verify `AcceleratorProver` ctor `{simulator,onPhase?,accelerator?}`, `checkAcceleratorStatus()` shape, `AcceleratorPhase` union still exist in 5.0.0-rc.1 SDK. **SDK release ships no server binary** (see infra doc).

## Fee-payment usage
- `packages/bridge-core/src/private-fuel.ts:14,71` `PrivateMintAndPayFeePaymentMethod(fpc, amount, secret, salt, leafIndex)` — verify ctor at fb6f196.
- Pinned `PRIVATE_FPC_ADDRESS = 0x1b17...ede1e` (salt 0, deployer ZERO) + `DOM_SEP__FPC_BRIDGE_SECRET = 3952304070` literal. If recompiled PrivateFPC bytecode drifts, the pinned address breaks → `private-fuel.test.ts` fails (intended tripwire). `check-fpc-version.ts` verifies installed version.
- Artifact alias `@private-fpc-artifact` → `target/private_contract-PrivateFPC.json` inside the tgz — verify path survives in fb6f196.

## Standards usage
- `TokenContractArtifact` (17 imports), `DripperContractArtifact` (3), `TokenContract`/`DripperContract` classes.
- Consumers: faucet (`contracts/deployments.ts`, `composables/useWalletConnection|useFaucetDrip|useTokenBalance|useWithdraw`, `scripts/deploy.ts`), bridge-core scripts, playground sections, extension e2e fixtures, runtime `known-artifacts.ts`/`note-schemas.ts` (alias `@wonderland-token-artifact` → `artifacts/target/token_contract-Token.json`).
- Hardcoded deterministic addresses in `packages/faucet/src/contracts/deployments.json`: Dripper (salt 1337), NULO (4242), OLUN (4243). `scripts/verify-deployments.ts` rebuilds from artifact+salt and asserts equality (gate in root `audit:faucet`). **Recompiled 5.0 artifacts → bytecode drift → addresses change → must redeploy + re-commit `deployments.json`.**
- Note-schema class-ids computed at runtime from bytecode (no hardcoded id pins) → resilient.

## Faucet deploy/account
- `packages/faucet/scripts/deploy.ts:45` `EmbeddedWallet.create(nodeUrl, {pxeConfig:{proverEnabled:true}})` — verify `pxeConfig` vs `pxe` option name at 5.0.
- `:299` `createSchnorrAccount` (own secret → stays). `:159` hardcodes `"NO_FROM"` string (4.2.0 didn't export it; 5.0 may).
- `Contract.deploy(...).send({contractAddressSalt, universalDeploy, wait:{waitForStatus: PROPOSED}})` → DeployMethod construction-time migration.

## Open questions / risks
1. Accelerator SDK 5.0 API surface (CRITICAL) — and the **missing 5.0 server binary** (see 05-infra).
2. Wonderland tgz internal artifact paths for vite aliases (MEDIUM) — verify `target/...json` layout in new tarballs.
3. Standards Noir tag pairing with TS tgz (HIGH) — bridge `token_minter_proxy` Nargo dep.
4. faucet `deployments.json` address re-pin after recompile (MEDIUM, gated by `verify:deployments`).
5. `EmbeddedWallet.create` option name (`pxeConfig`→`pxe`?) (MEDIUM).
