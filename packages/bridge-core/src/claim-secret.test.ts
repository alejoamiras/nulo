import { poseidon2HashBytes } from "@aztec/foundation/crypto/sync"
import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { describe, expect, it } from "vitest"

import { DOM_SEP__FPC_BRIDGE_SECRET } from "./private-fuel"
import { DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET, deriveTokenClaimSecret, tokenClaimSecretHash } from "./claim-secret"

/**
 * KEYSTONE — the second irreversible-loss gate (recipient-committed private claims). These vectors are
 * the single source of truth that the TS `deriveTokenClaimSecret` byte-matches the Noir
 * `claim_secret_lib::derive_claim_secret` (asserted against the SAME literals in
 * contracts/bridge/aztec/keystone/src/main.nr). A change to `@aztec`'s poseidon, the domain string, or
 * the field ordering breaks one of these — the intended tripwire, since a drift strands every private
 * deposit made against the derivation.
 */
describe("claim-secret keystone", () => {
	// The protocol secret-hash separator computeSecretHash uses (DOM_SEP__SECRET_HASH) — our DS must differ.
	const SECRET_HASH_SEP = 4199652938

	it("DOM_SEP literal equals the runtime poseidon derivation + differs from the FPC/secret-hash separators", () => {
		expect(DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET).toBe(3140354885)
		const derived = Number(poseidon2HashBytes(Buffer.from("nulo_dom_sep__token_bridge_private_claim_secret")).toBigInt() & 0xffff_ffffn)
		expect(DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET).toBe(derived)
		// Cross-protocol-secret-reuse tripwire: distinct from the private-fuel derivation and the outer hash.
		expect(DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET).not.toBe(DOM_SEP__FPC_BRIDGE_SECRET)
		expect(DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET).not.toBe(SECRET_HASH_SEP)
	})

	// Fixed (salt, recipient) → (secret, secretHash) vectors, byte-identical to the Noir keystone.
	const vectors: { salt: Fr; recipient: AztecAddress; secret: string; secretHash: string }[] = [
		{
			salt: Fr.zero(),
			recipient: AztecAddress.ZERO,
			secret: "0x1bcb2e97aaeb9788f9b23d331c90b0e138b8fa84890f1fb045c4c260b26e1a4f",
			secretHash: "0x087647b3c1976bde1cf12bfa5213c1d619f4f0b9a0bae6e1000d7030fcb9d5fc",
		},
		{
			salt: new Fr(1n),
			recipient: AztecAddress.fromBigIntUnsafe(2n),
			secret: "0x12e754c717173c3dd6f22932580bf8332274034b2c4a6a8ec8d682b482e104a5",
			secretHash: "0x23d9fa16980e66c10886f09780ea412bd1c942a0a6e588d838ea05d7228c6754",
		},
		{
			salt: new Fr(0x1234567890abcdefn),
			recipient: AztecAddress.fromBigIntUnsafe(0xdeadbeefn),
			secret: "0x02c856f2079a8e1cc126d02e81cd409c7ee02e0c4c7cd2dd9450edaa8c681e7d",
			secretHash: "0x2a636f84225eec69e412ed5dffd735f1ac8ff6d28b24dac5d796f0c2a648ac1c",
		},
	]

	it.each(vectors)("derives the pinned secret + secretHash for (salt=$salt)", async ({ salt, recipient, secret, secretHash }) => {
		expect(deriveTokenClaimSecret(salt, recipient).toString()).toBe(secret)
		expect((await tokenClaimSecretHash(salt, recipient)).toString()).toBe(secretHash)
	})
})

/**
 * PRIVACY INVARIANT tripwire (solidity+noir classics audit FN-I1 / FS-I3): the private deposit's
 * `secret_hash` is L1-public and the amount is public, so recipient-privacy rests ENTIRELY on the salt
 * being full-entropy-random. These pin that (a) the salt genuinely varies the secret_hash — so two
 * random-salt deposits to the SAME recipient are unlinkable — and (b) the entropy MUST come from the
 * salt, since the derivation is otherwise deterministic in (salt, recipient). A future "deterministic /
 * recoverable salt" refactor (which would let an observer brute-force the recipient pre-claim) turns
 * the first test red.
 */
describe("claim-secret privacy invariant (salt entropy)", () => {
	const recipient = AztecAddress.fromBigIntUnsafe(0xc0ffeen)

	it("two DIFFERENT salts → DIFFERENT secretHash for the same recipient (unlinkable with a random salt)", async () => {
		const a = await tokenClaimSecretHash(Fr.random(), recipient)
		const b = await tokenClaimSecretHash(Fr.random(), recipient)
		expect(a.toString()).not.toBe(b.toString())
	})

	it("derivation is deterministic in (salt, recipient) — so entropy MUST come from the salt", async () => {
		const salt = Fr.random()
		const a = await tokenClaimSecretHash(salt, recipient)
		const b = await tokenClaimSecretHash(salt, recipient)
		expect(a.toString()).toBe(b.toString())
	})
})
