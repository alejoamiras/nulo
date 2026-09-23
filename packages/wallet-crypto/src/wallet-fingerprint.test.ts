import { createHash } from "node:crypto"
import { describe, expect, test } from "vitest"
import { asMasterSecretBytes } from "./secret-types"
import { computeWalletFingerprint } from "./wallet-fingerprint"

const MASTER = asMasterSecretBytes(new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>)
const OTHER = asMasterSecretBytes(new Uint8Array(32).fill(8) as Uint8Array<ArrayBuffer>)

describe("wallet fingerprint", () => {
	test("deterministic for the same master; distinct for different masters", async () => {
		expect(await computeWalletFingerprint(MASTER)).toBe(await computeWalletFingerprint(MASTER))
		expect(await computeWalletFingerprint(MASTER)).not.toBe(await computeWalletFingerprint(OTHER))
	})

	test("cross-implementation KAT: node:crypto sha256 over the labeled preimage", async () => {
		const expected = createHash("sha256")
			.update(Buffer.concat([Buffer.from("nulo:wallet-fingerprint:v1", "utf8"), Buffer.from(MASTER)]))
			.digest("hex")
		expect(await computeWalletFingerprint(MASTER)).toBe(expected)
	})

	test("domain-separated: a bare sha256 of the master is NOT the fingerprint", async () => {
		const bare = createHash("sha256").update(Buffer.from(MASTER)).digest("hex")
		expect(await computeWalletFingerprint(MASTER)).not.toBe(bare)
	})

	test("does not mutate the caller's master", async () => {
		const copy = new Uint8Array(MASTER)
		await computeWalletFingerprint(MASTER)
		expect(Array.from(MASTER)).toEqual(Array.from(copy))
	})
})
