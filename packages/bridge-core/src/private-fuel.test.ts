import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { loadContractArtifact } from "@aztec/stdlib/abi"
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import { describe, expect, it } from "vitest"

import { DOM_SEP__FPC_BRIDGE_SECRET, PRIVATE_FPC_ADDRESS, deriveBridgeSecret, privateFuelSecretHash } from "./private-fuel"

/**
 * KEYSTONE — the irreversible-loss gate. These vectors are the single source of truth that the
 * TS derivation byte-matches the Noir `derive_bridge_secret` and the proven e2e fixture. A change
 * to `@aztec`'s poseidon, the domain string, or the artifact bytecode breaks one of these, which
 * is the intended tripwire: re-pinning is a CONSCIOUS act (re-derive + re-canary on the live net),
 * never a silent drift that strands or misroutes Fee Juice.
 */

/** Resolve a file inside a package WITHOUT its exports map (which blocks ./target/*) — same
 *  node_modules walk the extension's `resolvePackageFile` uses. */
function resolvePackageFile(pkg: string, file: string): string {
	const parts = pkg.startsWith("@") ? pkg.split("/").slice(0, 2) : [pkg.split("/")[0]]
	let dir = fileURLToPath(new URL(".", import.meta.url))
	while (dir !== dirname(dir)) {
		const candidate = join(dir, "node_modules", ...parts, file)
		if (existsSync(candidate)) return candidate
		dir = dirname(dir)
	}
	throw new Error(`Cannot find ${pkg}/${file} in any node_modules`)
}

describe("private-fuel keystone", () => {
	it("DOM_SEP matches the Noir constant DOM_SEP__FPC_BRIDGE_SECRET", () => {
		expect(DOM_SEP__FPC_BRIDGE_SECRET).toBe(3952304070)
	})

	// Fixed (salt, claimer) → (secret, secretHash) vectors. Regenerated only by a conscious re-pin.
	const vectors: { salt: Fr; claimer: AztecAddress; secret: string; secretHash: string }[] = [
		{
			salt: Fr.zero(),
			claimer: AztecAddress.ZERO,
			secret: "0x17aeb8912036181798c953f336542b69b7cbb99ae3cbf0fc5df63dc156ea9159",
			secretHash: "0x3009900559ae81285122db7395c3e50c0e74e0904b27014b5a8b9cef951b9476",
		},
		{
			salt: new Fr(1n),
			claimer: AztecAddress.fromBigInt(2n),
			secret: "0x1b78d208a5751b740d7ace9e08b870abee85b745e7b8681d7dac30f44894bd50",
			secretHash: "0x2a3613114a93cc062e7fe72c31a0d93291b386d9a255522f376febb9a6ad1781",
		},
		{
			salt: new Fr(0x1234567890abcdefn),
			claimer: AztecAddress.fromBigInt(0xdeadbeefn),
			secret: "0x2f346ff7ed39809df5f2e20e99164bf87c1bff13be2dc50f66731d1eb87381f6",
			secretHash: "0x024a50704521695145e0e6531986c89e55596bfeede2d5b2229fd30ed3ac7ab0",
		},
	]

	it.each(vectors)("deriveBridgeSecret + secretHash match the pinned vector (salt=$salt)", async ({
		salt,
		claimer,
		secret,
		secretHash,
	}) => {
		expect(deriveBridgeSecret(salt, claimer).toString()).toBe(secret)
		expect((await privateFuelSecretHash(salt, claimer)).toString()).toBe(secretHash)
	})

	it("ADDRESS TRIPWIRE — re-deriving from the installed artifact matches PRIVATE_FPC_ADDRESS", async () => {
		const rawJson = JSON.parse(
			readFileSync(resolvePackageFile("@wonderland/aztec-fee-payment", "target/private_contract-PrivateFPC.json"), "utf8"),
		)
		const artifact = loadContractArtifact(rawJson)
		const instance = await getContractInstanceFromInstantiationParams(artifact, {
			constructorArgs: [],
			salt: Fr.zero(),
			deployer: AztecAddress.ZERO,
		})
		expect(instance.address.toString()).toBe(PRIVATE_FPC_ADDRESS)
	})
})
