import { describe, expect, test } from "vitest"
import { REGIMES, V5_REGIME } from "./address-freeze"
import { FROZEN_ACCOUNT_CLASS_ID, FROZEN_ARTIFACT_SHA256 } from "./frozen-artifact"
import { FROZEN_DESCRIPTOR_DIGEST, NULO_DESCRIPTOR_VERSION } from "./instantiation-descriptor"

/**
 * Paired anti-tamper test for the regime record. EVERY entry (not just the newest) is
 * independently hardcoded here as literals — moving any digest requires a coherent edit of the
 * source modules, the record, AND this file, in one reviewed, signed, branch-protected diff.
 * Editing or deleting a historical entry reds this test: never "fix" it by re-pinning; append a
 * new regime + a new extension major instead.
 */
const EXPECTED_REGIMES: Record<string, Record<string, unknown>> = {
	"nulo-v5": {
		id: "nulo-v5",
		artifactSha256: "36562cde36667a43cc9c6d8cbfc18bcf0ac13cdc9f816720273350ee59a92a63",
		classId: "0x0db539838feacc4420c8e33b01ffe733a8bae58bba2c403653691b1ed8d3d0c5",
		descriptorVersion: 1,
		descriptorDigest: "3883065f0d6603d1be25db42348ec25b7a9dc29746d85b925b09efbd2a460605",
		kdf: "nulo-account-kdf-v1",
		ack:
			"I acknowledge that regime nulo-v5 (artifact sha256 " +
			"36562cde36667a43cc9c6d8cbfc18bcf0ac13cdc9f816720273350ee59a92a63, class id " +
			"0x0db539838feacc4420c8e33b01ffe733a8bae58bba2c403653691b1ed8d3d0c5, descriptor v1 " +
			"digest 3883065f0d6603d1be25db42348ec25b7a9dc29746d85b925b09efbd2a460605) fixes every " +
			"Nulo V5 account address; changing any of these inputs rotates all derived addresses " +
			"and ships ONLY as a new extension major with a new appended regime entry.",
	},
}

describe("address-freeze regime record", () => {
	test("every regime entry matches its independently hardcoded expectation exactly", () => {
		expect(REGIMES).toEqual(EXPECTED_REGIMES)
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
