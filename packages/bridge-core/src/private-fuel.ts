/**
 * Private Fee Juice (Wonderland PrivateFPC) — the L1→L2 deposit-secret derivation and the
 * pinned FPC address. The mechanism: a PRIVATE token bridge funds gas by depositing Fee Juice
 * on L1 with `fuelRecipient = PRIVATE_FPC_ADDRESS` and a claimer-bound `secretHash`; on L2 the
 * claimer calls `PrivateFPC.mint_and_pay_fee`, which re-derives the same secret from
 * `msg_sender` and credits the gas — so nothing on L2 links the gas to the user.
 *
 * The derivation MUST byte-match the Noir `derive_bridge_secret` in
 * `private_contract/src/main.nr` and the proven e2e fixture
 * (`extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts`); the keystone test
 * (`private-fuel.test.ts`) pins both against fixed vectors so an `@aztec` crypto change
 * can never silently strand funds.
 */
import { FPCFeePaymentMethod, PrivateMintAndPayFeePaymentMethod } from "@alejoamiras/aztec-fee-payment/fee-payment-methods"
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/sync"
import type { Fr } from "@aztec/aztec.js/fields"
import type { AztecAddress } from "@aztec/aztec.js/addresses"
import { computeSecretHash } from "@aztec/stdlib/hash"

/**
 * Domain separator: `poseidon2_hash_bytes("az_dom_sep__fpc_bridge_secret") as u32`. Mirrors the Noir
 * constant `DOM_SEP__FPC_BRIDGE_SECRET`. PINNED as a literal (NOT computed at load): a poseidon call at
 * module-load time crashes non-node consumers — the faucet's jsdom test env throws `std::bad_cast`
 * before Barretenberg is initialized, and merely importing this module would trigger it. The keystone
 * test re-derives this in node (where bb is ready) and asserts equality — that is the drift tripwire.
 */
export const DOM_SEP__FPC_BRIDGE_SECRET = 3952304070

/**
 * The CANONICAL PrivateFPC identity — from 5.0.0 onward the salt is a fixed project constant of the
 * fee-payment package (ecosystem-tooling `canonical-deployment.json`; rc-era pins used
 * operator-local salts and are dead). The address is deterministic from the INSTALLED
 * `@alejoamiras/aztec-fee-payment@5.0.0` artifact at `salt=PRIVATE_FPC_SALT, deployer=ZERO` — the
 * exact instance the wallet auto-registers (`extension/src/wallet/services/fpc/service.ts`, which
 * MUST use the same salt).
 *
 * Pinned, NOT runtime-derived: the 2.2 MB artifact never enters the browser bundle, and an artifact
 * bump that changes the bytecode fails the bridge-core address tripwire (`private-fuel.test.ts`,
 * which also digest-asserts the artifact against `private-fpc-canonical.json`) until this is
 * consciously re-pinned AND re-canaried on the live network. This is strictly fail-closed — the
 * runtime can never deposit to a silently-drifted address.
 *
 * INVARIANT: never deposit private Fee Juice to any address other than this for the pinned version.
 * The address is `@aztec`-version + bytecode specific. `check-fpc-version.ts` gates any live deploy
 * on exact-version + artifact-digest + live-class agreement; the live re-canary (a private fueled
 * claim settling against this instance, pre-promotion) is the redeploy's gate.
 */
export const PRIVATE_FPC_ADDRESS = "0x257aa8701e8801b2c03a6b03cdf385c4fa9200efda1dc41f94a905980efc86e9"

/** The canonical instance salt (fixed from 5.0.0 onward — see PRIVATE_FPC_ADDRESS). */
export const PRIVATE_FPC_SALT = "0x0000000000000000000000000000000000000000000000000000000000000001"

/**
 * The bridge secret a private-fuel L1 deposit binds to: `poseidon2([salt, claimer], DOM_SEP)`.
 * The claimer reconstructs it from `msg_sender` inside `PrivateFPC.mint_and_pay_fee`, so a RANDOM
 * secret would strand the Fee Juice forever — `flows.ts` MUST inject this for private fuel and never
 * fall back to `Fr.random()` (which stays correct for the recipient-bound PUBLIC fuel path).
 */
export const deriveBridgeSecret = (salt: Fr, claimer: AztecAddress): Fr =>
	poseidon2HashWithSeparator([salt, claimer], DOM_SEP__FPC_BRIDGE_SECRET)

/** The `secretHash` for the L1 `depositToAztecPublic` call — `computeSecretHash` of the bridge secret. */
export const privateFuelSecretHash = (salt: Fr, claimer: AztecAddress): Promise<Fr> => computeSecretHash(deriveBridgeSecret(salt, claimer))

/**
 * The L2 fee-payment method for a private-fuel claim: Wonderland's `PrivateMintAndPayFeePaymentMethod`,
 * whose `getExecutionPayload()` bundles two PRIVATE setup calls in one tx — `FeeJuice.claim(fpc, …)`
 * then `PrivateFPC.mint_and_pay_fee(amount, salt, leafIndex)` — and whose `getFeePayer()` is the FPC.
 * `secret` is the bridge secret ({@link deriveBridgeSecret}); `salt` is the per-deposit bridge-secret
 * salt (NOT the FPC-address salt). The wallet runs this verbatim via the EXTERNAL embedded path; the
 * faucet + the headless script both build it through this one wrapper (the only Wonderland coupling).
 */
export const privateMintAndPayFee = (
	fpc: AztecAddress,
	amount: bigint,
	secret: Fr,
	salt: Fr,
	leafIndex: Fr,
	// 5.0.0-typed seam: @alejoamiras/aztec-fee-payment pins @aztec 5.0.0 (no 5.0.1 published)
): PrivateMintAndPayFeePaymentMethod =>
	new PrivateMintAndPayFeePaymentMethod(fpc as never, amount, secret as never, salt as never, leafIndex as never)

/**
 * Pay a tx's gas from an EXISTING private Fee Juice balance already held at the PrivateFPC — the
 * "spend the gas you earned" path. Wonderland's `FPCFeePaymentMethod` emits one private `pay_fee`
 * setup call with `getFeePayer()` = the FPC, so the extension routes it through the embedded path
 * exactly like {@link privateMintAndPayFee}. Use this (not `privateMintAndPayFee`) when there is no
 * fresh L1→L2 Fee-Juice claim to consume — e.g. a no-fuel bridge claim funded by the remainder a
 * prior private fuel claim credited to the user's FPC balance.
 *
 * INVARIANT (no refund): `FPCFeePaymentMethod` deducts the FULL `max_gas_cost`
 * (`gasLimits·maxFeesPerGas`) and does NOT refund the unused portion. Commit a tight, inclusion-safe
 * `maxFeesPerGas` and gate on `maxGasCostFor` against the same gas settings, or the caller overpays.
 */
// biome-ignore-start lint/correctness/noUnusedVariables: (none) — seam comment anchor
// 5.0.0-typed seam as above.
// biome-ignore-end lint/correctness/noUnusedVariables: anchor
export const privateFeeJuicePayment = (fpc: AztecAddress): FPCFeePaymentMethod => new FPCFeePaymentMethod(fpc as never)
