import { createHash } from "node:crypto"
import { describe, expect, test } from "vitest"
import { NULO_KDF_DIGEST, NULO_KDF_SPEC, REGIMES, V5_REGIME } from "./address-freeze"
import { FROZEN_ACCOUNT_CLASS_ID, FROZEN_ARTIFACT_SHA256 } from "./frozen-artifact"
import { FROZEN_DESCRIPTOR_DIGEST, NULO_DESCRIPTOR_VERSION } from "./instantiation-descriptor"

/**
 * Paired anti-tamper test for the regime record. EVERY entry (not just the newest) is
 * independently hardcoded here as literals — moving any digest requires a coherent edit of the
 * source modules, the record, AND this file, in one reviewed, signed, branch-protected diff.
 * Editing or deleting a historical entry reds this test: never "fix" it by re-pinning; append a
 * new regime + a new extension major instead. (The nulo-v5 baseline was redefined in place inside
 * the pre-launch carve-out WINDOW — KDF v1→v2 (`implementations-plan/key-model-v2/`) and the
 * passkey-branch spec extension (`implementations-plan/key-model-v2-hardening/`) — owner-ratified
 * both times; the window closes permanently at V5's first shipped build.)
 */
const EXPECTED_KDF_DIGEST = "29eca1a04b7acde8bb95905a2ac630b29f1edcf04d584274e90fd9f81736166d"

const EXPECTED_REGIMES: Record<string, Record<string, unknown>> = {
	"nulo-v5": {
		id: "nulo-v5",
		artifactSha256: "36562cde36667a43cc9c6d8cbfc18bcf0ac13cdc9f816720273350ee59a92a63",
		classId: "0x0db539838feacc4420c8e33b01ffe733a8bae58bba2c403653691b1ed8d3d0c5",
		descriptorVersion: 1,
		descriptorDigest: "3883065f0d6603d1be25db42348ec25b7a9dc29746d85b925b09efbd2a460605",
		kdf: "nulo-account-kdf-v2",
		kdfDigest: EXPECTED_KDF_DIGEST,
		ack:
			"I acknowledge that regime nulo-v5 (artifact sha256 " +
			"36562cde36667a43cc9c6d8cbfc18bcf0ac13cdc9f816720273350ee59a92a63, class id " +
			"0x0db539838feacc4420c8e33b01ffe733a8bae58bba2c403653691b1ed8d3d0c5, descriptor v1 " +
			"digest 3883065f0d6603d1be25db42348ec25b7a9dc29746d85b925b09efbd2a460605, kdf " +
			`nulo-account-kdf-v2 digest ${EXPECTED_KDF_DIGEST}) fixes every ` +
			"Nulo V5 account address; changing any of these inputs rotates all derived addresses " +
			"and ships ONLY as a new extension major with a new appended regime entry.",
	},
}

describe("address-freeze regime record", () => {
	test("every regime entry matches its independently hardcoded expectation exactly", () => {
		expect(REGIMES).toEqual(EXPECTED_REGIMES)
	})

	test("kdfDigest is the sha256 of the canonical KDF spec (the mechanical KDF tripwire)", () => {
		expect(createHash("sha256").update(NULO_KDF_SPEC, "utf8").digest("hex")).toBe(EXPECTED_KDF_DIGEST)
		expect(NULO_KDF_DIGEST).toBe(EXPECTED_KDF_DIGEST)
	})

	test("the KDF spec pins the v2 constructions verbatim", () => {
		// Independent literals — a drive-by edit to the spec text cannot survive this file.
		expect(NULO_KDF_SPEC).toContain("PBKDF2-HMAC-SHA512")
		expect(NULO_KDF_SPEC).toContain("2048, 64B")
		expect(NULO_KDF_SPEC).toContain("Fr.fromBufferReduce")
		expect(NULO_KDF_SPEC).toContain("2720999938")
		expect(NULO_KDF_SPEC).toContain("914717451")
		expect(NULO_KDF_SPEC).toContain("deriveSecretKeyFromSigningKey")
	})

	test("the KDF spec pins the passkey branch verbatim (the branch it was previously blind to)", () => {
		// Byte-precise passkey clause: PRF ikm, label-salted SHA-256, HKDF-SHA256, the 64-byte
		// low-skew expand, and the reduce. Any drift in the passkey derivation must red this.
		expect(NULO_KDF_SPEC).toContain(
			"passkeyMaster = Fr.fromBufferReduce(HKDF-SHA256(ikm=prfBytes, salt=SHA-256(UTF8('nulo:kdf:v1')||credentialIdBytes), info=UTF8('nulo:master:v1'), 64B))",
		)
	})

	test("regime ids are unique and equal their record keys", () => {
		const ids = Object.values(REGIMES).map((r) => r.id)
		expect(new Set(ids).size).toBe(ids.length)
		for (const [key, regime] of Object.entries(REGIMES)) {
			expect(regime.id).toBe(key)
		}
	})

	test("each ack embeds its own entry's digests (unbound acks are red)", () => {
		for (const regime of Object.values(REGIMES)) {
			expect(regime.ack).toContain(regime.id)
			expect(regime.ack).toContain(regime.artifactSha256)
			expect(regime.ack).toContain(regime.classId)
			expect(regime.ack).toContain(regime.descriptorDigest)
			expect(regime.ack).toContain(`descriptor v${regime.descriptorVersion}`)
			expect(regime.ack).toContain(regime.kdfDigest)
		}
	})

	test("the nulo-v5 entry is consistent with the live freeze modules", () => {
		const v5 = REGIMES["nulo-v5"]
		expect(v5.artifactSha256).toBe(FROZEN_ARTIFACT_SHA256)
		expect(v5.classId).toBe(FROZEN_ACCOUNT_CLASS_ID)
		expect(v5.descriptorVersion).toBe(NULO_DESCRIPTOR_VERSION)
		expect(v5.descriptorDigest).toBe(FROZEN_DESCRIPTOR_DIGEST)
	})

	test("this extension major binds to exactly the nulo-v5 regime", () => {
		expect(V5_REGIME).toBe(REGIMES["nulo-v5"])
	})
})
