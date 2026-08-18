import { Fr } from "@aztec/foundation/curves/bn254"
import { describe, expect, test } from "vitest"
import vectors from "../../../implementations-plan/key-model-v2/reference/vectors.json"
import { deriveSigningKeyFromSeed } from "./account-derivation"

/**
 * NULO-ACCOUNT-KDF v2 known-answer vectors — REFERENCE-GENERATED, never regenerate from this
 * implementation. Source of truth: `implementations-plan/key-model-v2/reference/` (published
 * 5.0.1 tarballs; the construction is upstream's removed `deriveSigningKey` under the Nulo
 * separator, provenance in `nulo-separators.ts`). If a vector fails, the CONSTRUCTION drifted —
 * stop and investigate; do not re-pin. The downstream chain (secretKey/address,
 * poseidon2-dependent — not runnable under jsdom) is pinned by
 * `packages/aztec-runtime/src/account/derivation-vectors.test.ts`.
 */
describe("NULO-ACCOUNT-KDF v2 — seed→signingKey known answers", () => {
	for (const { seed, signingKey } of vectors.signingChain) {
		test(`deriveSigningKeyFromSeed(${seed.slice(0, 10)}…) matches the reference vector`, () => {
			expect(deriveSigningKeyFromSeed(Fr.fromHexString(seed)).toString()).toBe(signingKey)
		})
	}
})
