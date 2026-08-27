import { Fr } from "@aztec/foundation/curves/bn254"
import { describe, expect, test, vi } from "vitest"
import { deriveBip39Seed } from "./mnemonic-master"
import { PasskeyCredential } from "./passkey-credential"

/**
 * Executable entropy accounting for the one lossy step in NULO-ACCOUNT-KDF v2: reducing a
 * uniformly random byte string into the BN254 scalar field (`Fr.fromBufferReduce`).
 *
 * Reduction mod `p` is never perfectly uniform when the input range is not a multiple of `p`:
 * some residues get one more preimage than others, so the most likely master is slightly more
 * likely than the least. How much that costs is ARITHMETIC, not judgement — and it is the number
 * that decides how wide the reduce input has to be. Every other statement of it in this codebase
 * is prose in a comment, which is exactly the kind of claim that rots silently. This computes it.
 *
 * The figures are derived here from `p` and the input width, then pinned. Narrowing any reduce
 * input reds this file with the exact bit loss, rather than shipping a quietly weaker master.
 */

/** BN254 scalar field modulus. NOT trusted from memory or from a library constant — the first test
 *  proves it is the modulus the implementation actually reduces by. */
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

/** Big-endian fixed-width buffer, the encoding `Fr.fromBufferReduce` reads. */
function beBuffer(value: bigint, byteLength: number): Buffer<ArrayBuffer> {
	const out = Buffer.alloc(byteLength) as Buffer<ArrayBuffer>
	let v = value
	for (let i = byteLength - 1; i >= 0; i--) {
		out[i] = Number(v & 0xffn)
		v >>= 8n
	}
	return out
}

/** log2 of an arbitrarily large integer, accurate to ~1e-15 relative: take the top 53 significant
 *  bits (all a double can hold) and add back the shift. `Number(huge)` alone would round away the
 *  very difference this file exists to measure. */
function log2BigInt(x: bigint): number {
	const bits = x.toString(2).length
	if (bits <= 53) return Math.log2(Number(x))
	const shift = bits - 53
	return Math.log2(Number(x >> BigInt(shift))) + shift
}

/**
 * Exact min-entropy of `uniform({0,1}^(8·byteLength)) mod p`.
 *
 * Splitting `2^N = q·p + rem`: `rem` residues have `q+1` preimages and the rest have `q`. The
 * adversary's best guess is a maximal-preimage residue, so min-entropy is `N − log2(q+1)`.
 */
function reductionEntropy(byteLength: number) {
	const inputBits = 8 * byteLength
	const space = 1n << BigInt(inputBits)
	const q = space / P
	const rem = space % P
	const maxPreimages = rem > 0n ? q + 1n : q
	return {
		inputBits,
		minPreimages: q,
		maxPreimages,
		/** Bits of min-entropy actually delivered into the field. */
		minEntropy: inputBits - log2BigInt(maxPreimages),
		/** What a perfectly uniform field element would carry. */
		idealEntropy: log2BigInt(P),
		/** How much more likely the most likely residue is than the least. */
		relativeSkew: Number(maxPreimages - q) / Number(q < 2n ** 53n ? q : 1n),
	}
}

describe("field-reduction entropy accounting", () => {
	test("P is the modulus the implementation actually reduces by (verified, not assumed)", () => {
		// If P were wrong by even one, neither of these would hold — so the arithmetic below is
		// anchored to the deployed field, not to a constant someone typed from memory.
		expect(Fr.fromBufferReduce(beBuffer(P, 32)).toString()).toBe(Fr.ZERO.toString())
		expect(Fr.fromBufferReduce(beBuffer(P + 1n, 32)).toString()).toBe(new Fr(1n).toString())
		expect(Fr.fromBufferReduce(beBuffer(P + 42n, 32)).toString()).toBe(new Fr(42n).toString())
		expect(P.toString(2).length).toBe(254)
	})

	test("a 64-byte reduce input is bias-free to below double precision (the SHIPPED width)", () => {
		const r = reductionEntropy(64)
		expect(r.idealEntropy).toBeCloseTo(253.596691355, 9)
		// The loss is not merely small, it is unrepresentable in a double: 2^512 is ~2^258 times
		// the field size, so the residue counts differ by 1 part in ~2^258.
		expect(r.idealEntropy - r.minEntropy).toBeLessThan(1e-9)
		expect(r.maxPreimages - r.minPreimages).toBe(1n)
		expect(r.minPreimages.toString(2).length).toBeGreaterThanOrEqual(250)
	})

	test("a 32-byte reduce input loses measurable entropy (why the width was widened)", () => {
		const r = reductionEntropy(32)
		// 2^256 is only ~5.29× the field size, so residues have FIVE or SIX preimages — a 20%
		// spread between the most and least likely master.
		expect(r.minPreimages).toBe(5n)
		expect(r.maxPreimages).toBe(6n)
		expect(r.relativeSkew).toBeCloseTo(0.2, 12)
		expect(r.minEntropy).toBeCloseTo(253.415037499, 9)
		expect(r.idealEntropy - r.minEntropy).toBeGreaterThan(0.18)
	})

	test("the mnemonic path feeds the reduce 64 bytes", async () => {
		const seed = await deriveBip39Seed("abandon ".repeat(23).concat("about").split(" "))
		expect(seed.length).toBe(64)
	})

	test("the passkey path asks HKDF for 512 bits before reducing", async () => {
		// Binds the arithmetic above to the code: this is the exact parameter that was 256 before
		// the entropy fix, and nothing else in the type system would notice it changing back.
		const spy = vi.spyOn(globalThis.crypto.subtle, "deriveBits")
		try {
			const credential = await PasskeyCredential.create({
				id: "dGVzdC1jcmVkZW50aWFsLWlk",
				prf: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
			})
			await credential.deriveMasterSecret()
			const widths = spy.mock.calls.map((call) => call[2])
			expect(widths).toContain(512)
			expect(widths).not.toContain(256)
		} finally {
			spy.mockRestore()
		}
	})
})
