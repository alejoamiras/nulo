import { describe, expect, it } from "vitest"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { bridgeProxyArtifact } from "../src/artifacts"
import { registerManifestContract, universalDeployInstance } from "./script-l2"

describe("script-l2", () => {
	it("universalDeployInstance reproduces the direct universal-deploy computation", async () => {
		const direct = await getContractInstanceFromInstantiationParams(
			bridgeProxyArtifact as never,
			{
				constructorArgs: [],
				salt: new Fr(1234),
				publicKeys: PublicKeys.default(),
				deployer: AztecAddress.ZERO,
				constructorArtifact: "constructor",
			} as never,
		)
		const viaHelper = await universalDeployInstance(bridgeProxyArtifact, [], "constructor", 1234)
		expect(viaHelper.address.toString()).toBe(direct.address.toString())
	})

	it("registerManifestContract hard-stops on a recorded address that does not recompute", async () => {
		const neverCalled = {
			registerContract: async () => {
				throw new Error("must not register on mismatch")
			},
		}
		await expect(
			registerManifestContract(neverCalled, {
				label: "proxy",
				art: bridgeProxyArtifact,
				args: [],
				ctor: "constructor",
				salt: 1234,
				address: `0x${"11".repeat(32)}`,
			}),
		).rejects.toThrow(/manifest proxy mismatch: recomputed .* != recorded/)
	})
})
