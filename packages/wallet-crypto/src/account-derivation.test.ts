import { Fr } from "@aztec/foundation/curves/bn254"
import { describe, expect, test } from "vitest"
import { deriveSigningKeyFromSeed } from "./account-derivation"

/**
 * NULO-ACCOUNT-KDF v1 known-answer vectors — REFERENCE-GENERATED, never regenerate from this
 * implementation. Source of truth: `implementations-plan/aztec-5.0.0-stable/reference/`
 * (regime A = upstream 5.0.0-rc.2 `deriveSigningKey`, the construction this module reuses
 * verbatim; regime B independently reproduced the same values from the published 5.0.0
 * primitives). If a vector fails, the CONSTRUCTION drifted — stop and investigate; do not
 * re-pin. The downstream chain (secretKey/address, poseidon2-dependent — not runnable under
 * jsdom) is pinned by `packages/aztec-runtime/src/account/derivation-vectors.test.ts`.
 */
const VECTORS = [
	{
		seed: "0x0000000000000000000000000000000000000000000000000000000000000042",
		signingKey: "0x14a31cb4d33a144675e70634830292153f78e8318e51f26a2f212783eb0a3cbc",
	},
	{
		seed: "0x0000000000000000000000000000000000000000000000000000000000001337",
		signingKey: "0x06de3315eea486fed5f27be5016611ce072c662c1a6700cb59f7f7454cba261b",
	},
]

describe("NULO-ACCOUNT-KDF v1 — seed→signingKey known answers", () => {
	for (const { seed, signingKey } of VECTORS) {
		test(`deriveSigningKeyFromSeed(${seed.slice(0, 10)}…) matches the reference vector`, () => {
			expect(deriveSigningKeyFromSeed(Fr.fromHexString(seed)).toString()).toBe(signingKey)
		})
	}
})
