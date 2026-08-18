import { Fr } from "@aztec/foundation/curves/bn254"
import { deriveKeys } from "@aztec/stdlib/keys"
import { deriveNuloAccountKeys, deriveSigningKeyFromSeed } from "@nulo/wallet-crypto"
import type { ILogger } from "@nulo/wallet-core/logger"
import { describe, expect, test } from "vitest"
import referenceVectors from "../../../../implementations-plan/key-model-v2/reference/vectors.json"
import { NuloAccount } from "./nulo-account"

/**
 * Full-chain known-answer test for the signing-key-root inversion (NULO-ACCOUNT-KDF v2).
 *
 * The expected values are REFERENCE-GENERATED from the published 5.0.1 packages by a committed
 * script that never touches this repo's helpers (`implementations-plan/key-model-v2/reference/
 * derive-vectors.ts`; the address comes from upstream's own `getSchnorrAccountContractAddress`
 * oracle; the v1 predecessor vectors remain archived under `aztec-5.0.0-stable/reference/`).
 * Equality is the gate — a mismatch means OUR derivation diverged; stop and investigate, never
 * re-pin from the implementation under test.
 */
const nullLogger: ILogger = { log: () => {} }

describe("NULO-ACCOUNT-KDF v2 — full chain vs the reference vectors", () => {
	for (const vector of referenceVectors.signingChain) {
		const seed = Fr.fromHexString(vector.seed)

		test(`seed ${vector.seed.slice(0, 10)}… derives the reference signing/secret keys`, async () => {
			const { signingKey, secretKey } = await deriveNuloAccountKeys(seed)
			expect(signingKey.toString()).toBe(vector.signingKey)
			expect(deriveSigningKeyFromSeed(seed).toString()).toBe(vector.signingKey)
			expect(secretKey.toString()).toBe(vector.secretKey)
		})

		test(`seed ${vector.seed.slice(0, 10)}… derives the reference AccountPrivacyKeys wire value`, async () => {
			const { secretKey, signingKey } = await deriveNuloAccountKeys(seed)
			const keys = await deriveKeys(secretKey)
			// The exact struct the offscreen seam hands to pxe.registerAccount: four privacy
			// SECRETS + two PUBLIC keys. Provably derived material — and provably NOT the seed
			// nor the signing key (the hygiene pin).
			const wire = {
				masterNullifierHidingSecretKey: keys.masterNullifierHidingSecretKey.toString(),
				masterIncomingViewingSecretKey: keys.masterIncomingViewingSecretKey.toString(),
				masterOutgoingViewingSecretKey: keys.masterOutgoingViewingSecretKey.toString(),
				masterTaggingSecretKey: keys.masterTaggingSecretKey.toString(),
				masterMessageSigningPublicKey: keys.masterMessageSigningPublicKey.toString(),
				masterFallbackPublicKey: keys.masterFallbackPublicKey.toString(),
			}
			expect(wire).toEqual(vector.accountPrivacyKeys)
			for (const value of Object.values(wire)) {
				expect(value).not.toBe(seed.toString())
				expect(value).not.toBe(signingKey.toString())
			}
		})

		test(`seed ${vector.seed.slice(0, 10)}… NuloAccount derives the reference address`, async () => {
			const account = await NuloAccount.new(seed, nullLogger)
			expect(account.address.toString()).toBe(vector.address)
			const complete = await account.getCompleteAddress()
			expect(complete.address.toString()).toBe(vector.completeAddress.address)
			expect(complete.partialAddress.toString()).toBe(vector.completeAddress.partialAddress)
			expect(complete.publicKeys.toString()).toBe(vector.completeAddress.publicKeys)
		})
	}
})
