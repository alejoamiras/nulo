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
import { poseidon2HashBytes, poseidon2HashWithSeparator } from "@aztec/foundation/crypto/sync"
import type { Fr } from "@aztec/aztec.js/fields"
import type { AztecAddress } from "@aztec/aztec.js/addresses"
import { computeSecretHash } from "@aztec/stdlib/hash"

/**
 * Domain separator: `poseidon2_hash_bytes("az_dom_sep__fpc_bridge_secret") as u32`. Mirrors the
 * Noir constant `DOM_SEP__FPC_BRIDGE_SECRET`. Computed at load (cheap, sync) rather than pinned
 * as a literal so the keystone test's equality assertion is the single drift tripwire.
 */
export const DOM_SEP__FPC_BRIDGE_SECRET = Number(poseidon2HashBytes(Buffer.from("az_dom_sep__fpc_bridge_secret")).toBigInt() & 0xffff_ffffn)

/**
 * The PrivateFPC L2 address — deterministic from the INSTALLED Wonderland artifact
 * (`@wonderland/aztec-fee-payment` 4.2.0-prerelease.215fd08) at `salt=0, deployer=ZERO`, the exact
 * instance the wallet auto-registers (`extension/src/wallet/services/fpc/service.ts:90-94`).
 *
 * Pinned, NOT runtime-derived: the 2.2 MB artifact never enters the browser bundle, and a Wonderland
 * bump that changes the bytecode fails the bridge-core address tripwire (`private-fuel.test.ts`)
 * until this is consciously re-pinned AND re-canaried on the live network. This is strictly
 * fail-closed — the runtime can never deposit to a silently-drifted address.
 *
 * INVARIANT: never deposit private Fee Juice to any address other than this for the pinned version.
 * The address is `@aztec`-version + bytecode specific; see `lessons/phase-0.md` for the version-pin
 * reconciliation (the testnet ran nodeVersion 4.3.1 at pin time vs this 4.2.0 artifact — Ask 1).
 */
export const PRIVATE_FPC_ADDRESS = "0x1b1706cc0947eca1de6527562af65d43e95540f9009a896dcd847afea92ede1e"

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
