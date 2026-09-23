import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin"
import type { ILogger } from "@nulo/wallet-core/logger"
import { describe, expect, test } from "vitest"
import {
	buildAccountExport,
	decryptAccountExport,
	encryptAccountExport,
	EXPORT_REGIME_DIGESTS,
	parseAccountExport,
	serializeAccountExport,
} from "./account-export"
import { NuloAccount } from "./nulo-account"

const nullLogger: ILogger = { log: () => {} }
const SIGNING_KEY = GrumpkinScalar.fromString("0x000000000000000000000000000000000000000000000000000000000000002a")
const L1 = 31337

describe("NuloAccount.fromSigningKey", () => {
	test("builds a usable account whose address is a pure function of the signing key", async () => {
		const a = await NuloAccount.fromSigningKey(SIGNING_KEY, nullLogger)
		const b = await NuloAccount.fromSigningKey(SIGNING_KEY, nullLogger)
		expect(a.address.toString()).toBe(b.address.toString())
		expect(a.address.toString()).toMatch(/^0x[0-9a-f]{64}$/)
	})
})

describe("account-export envelope (NULO-ACCOUNT-EXPORT v1)", () => {
	test("build → serialize → parse round-trips the signing key + l1ChainId, and recomputes the address", async () => {
		const account = await NuloAccount.fromSigningKey(SIGNING_KEY, nullLogger)
		const exp = buildAccountExport(SIGNING_KEY, L1, account.address.toString())
		const parsed = parseAccountExport(serializeAccountExport(exp))
		expect(parsed.signingKey.toString()).toBe(SIGNING_KEY.toString())
		expect(parsed.l1ChainId).toBe(L1)
		// The claimed address recomputes from the signing key (the import-side authenticity check).
		const recomputed = await NuloAccount.fromSigningKey(parsed.signingKey, nullLogger)
		expect(recomputed.address.toString()).toBe(parsed.claimedAddress)
	})

	test("the file embeds this build's frozen regime digests", () => {
		const exp = buildAccountExport(SIGNING_KEY, L1, "0xabc")
		expect(exp.artifactSha256).toBe(EXPORT_REGIME_DIGESTS.artifactSha256)
		expect(exp.kdfDigest).toBe(EXPORT_REGIME_DIGESTS.kdfDigest)
	})

	test("rejects a foreign regime, a bad checksum, and a non-canonical signing key", () => {
		const exp = buildAccountExport(SIGNING_KEY, L1, "0xabc")
		expect(() => parseAccountExport(serializeAccountExport({ ...exp, kdfDigest: "deadbeef", checksum: exp.checksum }))).toThrow(
			/different Nulo regime/,
		)
		expect(() => parseAccountExport(serializeAccountExport({ ...exp, address: "0xTAMPERED" }))).toThrow(/checksum mismatch/)
		// A signing key ≥ the Fq modulus must be rejected, never reduced.
		const overModulus = "0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001"
		const forged = { ...exp, signingKey: overModulus }
		expect(() => parseAccountExport(JSON.stringify({ ...forged, checksum: "whatever" }))).toThrow()
	})

	test("encrypted variant: round-trips under the right password, fails closed otherwise", async () => {
		const account = await NuloAccount.fromSigningKey(SIGNING_KEY, nullLogger)
		const exp = buildAccountExport(SIGNING_KEY, L1, account.address.toString())
		const blob = await encryptAccountExport(exp, "hunter2")
		const back = parseAccountExport(await decryptAccountExport(blob, "hunter2"))
		expect(back.signingKey.toString()).toBe(SIGNING_KEY.toString())
		await expect(decryptAccountExport(blob, "wrong-pass")).rejects.toThrow()
	})
})
