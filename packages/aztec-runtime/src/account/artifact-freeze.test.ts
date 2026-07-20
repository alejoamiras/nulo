import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import { describe, expect, test } from "vitest"
import { FROZEN_ACCOUNT_CLASS_ID, FROZEN_ARTIFACT_SHA256, FrozenSchnorrAccountArtifact } from "./frozen-artifact"

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
})
