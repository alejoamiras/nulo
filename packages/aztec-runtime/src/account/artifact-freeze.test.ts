import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Fr } from "@aztec/foundation/curves/bn254"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import type { ILogger } from "@nulo/wallet-core/logger"
import { describe, expect, test } from "vitest"
import { V5_REGIME } from "./address-freeze"
import { FROZEN_ACCOUNT_CLASS_ID, FROZEN_ARTIFACT_SHA256, FrozenSchnorrAccountArtifact } from "./frozen-artifact"
import { FROZEN_DESCRIPTOR_DIGEST } from "./instantiation-descriptor"
import { NuloAccount } from "./nulo-account"

const nullLogger: ILogger = { log: () => {} }

/**
 * Pins for the vendored account artifact. A red run here means the address-bearing artifact (or
 * upstream's interpretation of it) moved — that changes every derived account address. Never
 * re-pin to make it green: rotation ships only as a new extension major (regime record).
 */
describe("frozen account artifact pins", () => {
	test("vendored SchnorrAccount.json bytes match FROZEN_ARTIFACT_SHA256", () => {
		const path = fileURLToPath(new URL("./artifacts/SchnorrAccount.json", import.meta.url))
		const digest = createHash("sha256").update(readFileSync(path)).digest("hex")
		expect(digest).toBe(FROZEN_ARTIFACT_SHA256)
	})

	test("loaded artifact's contract class id matches FROZEN_ACCOUNT_CLASS_ID", async () => {
		const contractClass = await getContractClassFromArtifact(FrozenSchnorrAccountArtifact)
		expect(contractClass.id.toString()).toBe(FROZEN_ACCOUNT_CLASS_ID)
	})

	// Closes the "V5_REGIME is a paper binding" gap: assert the LIVE account factory actually
	// produces the regime's pinned identity. A refactor pointing NuloAccount at a different
	// artifact/descriptor while REGIMES still references the frozen constants reds HERE, not just
	// in the (constant-vs-constant) regime consistency test.
	test("the live NuloAccount factory produces the V5_REGIME class id + descriptor digest", async () => {
		const account = await NuloAccount.new(Fr.fromHexString("0x01"), nullLogger)
		const producedClass = await getContractClassFromArtifact(account.artifact)
		expect(producedClass.id.toString()).toBe(V5_REGIME.classId)
		expect(V5_REGIME.classId).toBe(FROZEN_ACCOUNT_CLASS_ID)
		expect(V5_REGIME.descriptorDigest).toBe(FROZEN_DESCRIPTOR_DIGEST)
	})
})
