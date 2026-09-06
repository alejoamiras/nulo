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
import { FPCFeePaymentMethod, PrivateMintAndPayFeePaymentMethod } from "@alejoamiras/private-fee-juice/fee-payment-methods"
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/sync"
import type { Fr } from "@aztec/aztec.js/fields"
import type { AztecAddress } from "@aztec/aztec.js/addresses"
import { computeSecretHash } from "@aztec/stdlib/hash"

/**
 * Domain separator: `poseidon2_hash_bytes("az_dom_sep__fpc_bridge_secret") as u32`. Mirrors the Noir
 * constant `DOM_SEP__FPC_BRIDGE_SECRET`. PINNED as a literal (NOT computed at load): a poseidon call at
 * module-load time crashes non-node consumers — the tools app's jsdom test env throws `std::bad_cast`
 * before Barretenberg is initialized, and merely importing this module would trigger it. The keystone
 * test re-derives this in node (where bb is ready) and asserts equality — that is the drift tripwire.
 */
export const DOM_SEP__FPC_BRIDGE_SECRET = 3952304070

/**
 * The CANONICAL PrivateFPC identity — from 5.0.0 onward the salt is a fixed project constant of the
 * fee-payment package (ecosystem-tooling `canonical-deployment.json`; rc-era pins used
 * operator-local salts and are dead). The address is deterministic from the INSTALLED
 * `@alejoamiras/private-fee-juice@5.0.1` artifact at `salt=PRIVATE_FPC_SALT, deployer=ZERO` — the
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
export const PRIVATE_FPC_ADDRESS = "0x1a6d21ce5fd80137df0e99632a4ca17e58a42dc8f6c08191a96ca8ae907a1bc0"

/** The canonical instance salt (fixed from 5.0.0 onward — see PRIVATE_FPC_ADDRESS). */
export const PRIVATE_FPC_SALT = "0x0000000000000000000000000000000000000000000000000000000000000001"

/**
 * Gas LIMITS for the hub's private claim paid through the PrivateFPC (`claim_private` plus the FPC's
 * `FeeJuice.claim` + `mint_and_pay_fee`, one tx). The FPC asserts the bridged amount covers
 * `getFeeLimit` = Σ gasLimit·maxFee — the LIMIT, not the charge — and a wallet given no limits
 * declares the network's per-tx maximum (6.54M L2 gas on testnet, ≈40 FJ at its 2026-09 fees, far
 * above any sensible fuel slice). The FPC credits `amount − max_gas_cost` and refunds nothing, so
 * every unit of limit above the gas actually used is Fee Juice the claimer forfeits: 2.2× the
 * 909,600 L2 gas a landed testnet claim billed, the headroom kept for an account whose first-ever
 * transaction is this claim (its initialization rides along, unmeasured).
 */
export const PRIVATE_HUB_CLAIM_GAS = { daGas: 100_000, l2Gas: 2_000_000 } as const

/**
 * Gas LIMITS for the hub's `register_token` when it is the transaction that spends the bridged Fee
 * Juice (the FPC's `FeeJuice.claim` + `mint_and_pay_fee` ride in its setup). A registration publishes
 * the derived Token instance and binds it in public, so it is the heavier of a first private claim's
 * two transactions. The same no-refund rule applies: the ceiling is forfeited, not the charge.
 * 2.3× the ≈1,763,000 L2 gas a landed testnet registration billed (JPYC, 2026-09-03), the same
 * headroom policy as the claim; the sum with {@link PRIVATE_HUB_CLAIM_GAS} is what a first-time
 * private fueled bridge must carry. Measured from an account the canary had already deployed — an
 * account whose first-ever transaction is this registration carries its initialization on top, a
 * shape only the extension produces and no canary has billed yet.
 */
export const PRIVATE_HUB_REGISTER_GAS = { daGas: 100_000, l2Gas: 4_000_000 } as const

/**
 * Gas LIMITS for the hub's `exit_to_l1_private` paid through the PrivateFPC's `pay_fee` from held
 * credit, under the same no-refund ceiling (the sandbox smoke proves it: the credit drops by exactly
 * `getFeeLimit`, never by the fee). 2.3× the 826,543 L2 gas the smoke's private exit billed on a
 * 5.2.0 local network (`deploy-sandbox.ts --smoke`, 2026-09-06; the landed fee at its block's price
 * agrees with the simulation to the gas unit) — the register's headroom rather than the claim's,
 * because that exit spent ONE credit note and `pay_fee`'s note selection grows with the notes an
 * account has accumulated. DA is 29× the 1,696 the same exit billed (a burn, an L2→L1 message and
 * the FPC's change note are its whole data footprint) and sits under the 55,882 a local network
 * admits per transaction — a network that admits less than a declared limit refuses the transaction
 * outright (`assertGasLimitsWithinNetworkLimits`), which is why the claim's 100,000 DA is not reused.
 */
export const PRIVATE_HUB_EXIT_GAS = { daGas: 50_000, l2Gas: 1_900_000 } as const

/** The PrivateFPC's committed ceiling for a claim — `getFeeLimit` = Σ gasLimit[d]·maxFee[d]. */
export const privateFpcFeeLimit = (gas: { daGas: number; l2Gas: number }, maxFees: { feePerDaGas: bigint; feePerL2Gas: bigint }): bigint =>
	BigInt(gas.l2Gas) * maxFees.feePerL2Gas + BigInt(gas.daGas) * maxFees.feePerDaGas

/**
 * Gas LIMITS for the hub's PUBLIC claims when the PrivateFPC pays them from gas the account already
 * holds (`pay_fee`), under the same no-refund ceiling. Neither has been billed through the FPC by a
 * canary yet: both are derived from landed public-lane fees at their block's L2 price — a plain
 * `claim_public` at 2.585 FJ beside a 909,600-gas private claim at 1.786 FJ ≈ 1,320,000 L2 gas;
 * EURC's `register_and_claim_public` at 4.621 FJ beside a 2.845 FJ private claim ≈ 1,480,000 —
 * with the claim's 2.3× headroom. A first-ever transaction's account initialization rides on top,
 * unmeasured, and the DA limit is the private lanes' figure, not a public-lane reading. PROVISIONAL
 * until an extension-billed sample of each shape exists: a fee ratio tracks L2 gas only while both
 * samples share a fee vector and the DA share stays negligible. Re-derive from those samples.
 */
export const PUBLIC_HUB_CLAIM_GAS = { daGas: 100_000, l2Gas: 3_000_000 } as const
export const PUBLIC_HUB_REGISTER_CLAIM_GAS = { daGas: 100_000, l2Gas: 3_500_000 } as const

export type HubGas = { readonly daGas: number; readonly l2Gas: number }
/** A hub claim paid from held gas, by what it sends: `registers` when the hub does not know the token yet. */
export type HubClaimShape = { isPrivate: boolean; registers: boolean }

/** The transaction(s) a hub claim paid from held gas makes, with the limits each commits to: a
 *  public claim registers inside its own transaction, a private first-time token sends a
 *  registration ahead of the claim. */
export function ownGasTxs(shape: HubClaimShape): { claim: HubGas; register?: HubGas } {
	if (!shape.isPrivate) return { claim: shape.registers ? PUBLIC_HUB_REGISTER_CLAIM_GAS : PUBLIC_HUB_CLAIM_GAS }
	return shape.registers ? { claim: PRIVATE_HUB_CLAIM_GAS, register: PRIVATE_HUB_REGISTER_GAS } : { claim: PRIVATE_HUB_CLAIM_GAS }
}

/** The private Fee Juice a claim from held gas sets aside: the FPC's ceiling of every transaction it makes. */
export function ownGasCeiling(shape: HubClaimShape, maxFees: { feePerDaGas: bigint; feePerL2Gas: bigint }): bigint {
	const txs = ownGasTxs(shape)
	return privateFpcFeeLimit(txs.claim, maxFees) + (txs.register ? privateFpcFeeLimit(txs.register, maxFees) : 0n)
}

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
 * tools + the headless script both build it through this one wrapper (the only Wonderland coupling).
 */
export const privateMintAndPayFee = (
	fpc: AztecAddress,
	amount: bigint,
	secret: Fr,
	salt: Fr,
	leafIndex: Fr,
): PrivateMintAndPayFeePaymentMethod => new PrivateMintAndPayFeePaymentMethod(fpc, amount, secret, salt, leafIndex)

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
export const privateFeeJuicePayment = (fpc: AztecAddress): FPCFeePaymentMethod => new FPCFeePaymentMethod(fpc)
