import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Fr } from "@aztec/foundation/curves/bn254"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import type { ILogger } from "@nulo/wallet-core/logger"
import { describe, expect, test } from "vitest"
import { V5_REGIME } from "./address-freeze"
import { FROZEN_ACCOUNT_CLASS_ID, FROZEN_ARTIFACT_SHA256, FrozenSchnorrAccountArtifact } from "./frozen-artifact"
import { FROZEN_DESCRIPTOR_DIGEST, FROZEN_INSTANTIATION_DESCRIPTOR } from "./instantiation-descriptor"
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
	// produces the regime's identity BEHAVIORALLY, not by comparing constants. A refactor pointing
	// NuloAccount at a different artifact OR a different instantiation descriptor reds HERE:
	//  - artifact: the produced contract class id would no longer equal V5_REGIME.classId;
	//  - descriptor: the produced instance's fixed fields (salt/deployer/immutablesHash) would no
	//    longer match the frozen descriptor (the init-hash tie to the emitted ctor call is the
	//    complementary binding in instantiation-descriptor.test.ts).
	test("the live NuloAccount factory is bound to the V5_REGIME artifact + descriptor", async () => {
		const account = await NuloAccount.new(Fr.fromHexString("0x01"), nullLogger)
		const producedClass = await getContractClassFromArtifact(account.artifact)
		expect(producedClass.id.toString()).toBe(V5_REGIME.classId)
		expect(V5_REGIME.classId).toBe(FROZEN_ACCOUNT_CLASS_ID)

		const instance = (account as unknown as { instance: ContractInstanceWithAddress }).instance
		expect(instance.salt.equals(FROZEN_INSTANTIATION_DESCRIPTOR.salt)).toBe(true)
		expect(instance.deployer.equals(FROZEN_INSTANTIATION_DESCRIPTOR.deployer)).toBe(true)
		expect(instance.immutablesHash.equals(FROZEN_INSTANTIATION_DESCRIPTOR.immutablesHash)).toBe(true)
		// The digest the regime records IS the digest of the frozen descriptor the factory consumes.
		expect(V5_REGIME.descriptorDigest).toBe(FROZEN_DESCRIPTOR_DIGEST)
	})
})
