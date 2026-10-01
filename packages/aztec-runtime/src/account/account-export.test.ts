import { GrumpkinScalar } from "@aztec-labs/foundation/curves/grumpkin"
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

/** A V5 build's export of the key-model-v2 reference's first signing-chain row on chain 31337,
 *  checksum included: well-formed in every respect but its regime. */
const V5_EXPORT = {
	format: "nulo-account-export",
	version: 1,
	regime: "nulo-v5",
	artifactSha256: "36562cde36667a43cc9c6d8cbfc18bcf0ac13cdc9f816720273350ee59a92a63",
	classId: "0x0db539838feacc4420c8e33b01ffe733a8bae58bba2c403653691b1ed8d3d0c5",
	descriptorDigest: "3883065f0d6603d1be25db42348ec25b7a9dc29746d85b925b09efbd2a460605",
	kdfDigest: "29eca1a04b7acde8bb95905a2ac630b29f1edcf04d584274e90fd9f81736166d",
	l1ChainId: 31337,
	address: "0x04d7bb8a4a0239077d7d246279076fdab66f5ed6167bd01882fad6131199457a",
	signingKey: "0x2aabed87d5340c673eae6dc5faaa57382b8d773fa38247a80bdafbd5277729e3",
	checksum: "2978e6afcf2e095102f3e1be38a00cae6ed22f8388dc4da0423399a19d7f9736",
}

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

	test("refuses a V5 account file, and a V5 file relabelled as this regime", () => {
		expect(() => parseAccountExport(JSON.stringify(V5_EXPORT))).toThrow(
			"Account export is for a different Nulo regime (regime mismatch)",
		)
		expect(() => parseAccountExport(JSON.stringify({ ...V5_EXPORT, regime: EXPORT_REGIME_DIGESTS.regime }))).toThrow(
			"Account export is for a different Nulo regime (artifactSha256 mismatch)",
		)
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
