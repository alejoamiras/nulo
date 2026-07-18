import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { poseidon2HashBytes } from "@aztec/foundation/crypto/sync"
import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { loadContractArtifact } from "@aztec/stdlib/abi"
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import { describe, expect, it } from "vitest"

import {
	DOM_SEP__FPC_BRIDGE_SECRET,
	PRIVATE_FPC_ADDRESS,
	PRIVATE_FPC_SALT,
	deriveBridgeSecret,
	privateFeeJuicePayment,
	privateFuelSecretHash,
	privateMintAndPayFee,
} from "./private-fuel"

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
	it("DOM_SEP literal equals the runtime poseidon derivation (drift tripwire) + the Noir constant", () => {
		expect(DOM_SEP__FPC_BRIDGE_SECRET).toBe(3952304070)
		// Re-derive in node (where bb is ready) — the literal in private-fuel.ts must match this.
		const derived = Number(poseidon2HashBytes(Buffer.from("az_dom_sep__fpc_bridge_secret")).toBigInt() & 0xffff_ffffn)
		expect(DOM_SEP__FPC_BRIDGE_SECRET).toBe(derived)
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
			claimer: AztecAddress.fromBigIntUnsafe(2n),
			secret: "0x1b78d208a5751b740d7ace9e08b870abee85b745e7b8681d7dac30f44894bd50",
			secretHash: "0x2a3613114a93cc062e7fe72c31a0d93291b386d9a255522f376febb9a6ad1781",
		},
		{
			salt: new Fr(0x1234567890abcdefn),
			claimer: AztecAddress.fromBigIntUnsafe(0xdeadbeefn),
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

	it("ADDRESS TRIPWIRE — re-deriving from the installed artifact at the CANONICAL salt matches PRIVATE_FPC_ADDRESS", async () => {
		const rawBytes = readFileSync(resolvePackageFile("@alejoamiras/aztec-fee-payment", "target/private_contract-PrivateFPC.json"))
		const artifact = loadContractArtifact(JSON.parse(rawBytes.toString("utf8")))
		const instance = await getContractInstanceFromInstantiationParams(artifact, {
			constructorArgs: [],
			salt: Fr.fromHexString(PRIVATE_FPC_SALT),
			deployer: AztecAddress.ZERO,
		})
		expect(instance.address.toString()).toBe(PRIVATE_FPC_ADDRESS)
	})

	it("CANONICAL DESCRIPTOR — constants, descriptor JSON, and the installed artifact digest all agree", async () => {
		// private-fpc-canonical.json mirrors the publisher's canonical-deployment.json (extended
		// with the artifact digest). This pin makes the pinned identity single-sourced-by-test:
		// the exported constants, the committed descriptor, and the actually-installed artifact
		// bytes cannot drift apart silently. check-fpc-version.ts consumes the same descriptor.
		const descriptor = JSON.parse(
			readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "private-fpc-canonical.json"), "utf8"),
		)
		expect(descriptor.expectedAddress).toBe(PRIVATE_FPC_ADDRESS)
		expect(descriptor.salt).toBe(PRIVATE_FPC_SALT)
		expect(descriptor.deployer).toBe(AztecAddress.ZERO.toString())

		const rawBytes = readFileSync(resolvePackageFile("@alejoamiras/aztec-fee-payment", "target/private_contract-PrivateFPC.json"))
		const digest = createHash("sha256").update(rawBytes).digest("hex")
		expect(digest).toBe(descriptor.artifactSha256)

		const installedVersion = JSON.parse(
			readFileSync(resolvePackageFile("@alejoamiras/aztec-fee-payment", "package.json"), "utf8"),
		).version
		expect(installedVersion).toBe(descriptor.aztecVersion)

		// Compat coherence: the digest-keyed node-compat map must carry an entry for EXACTLY the
		// pinned digest (the gate fails closed on a missing key, so a digest change without fresh
		// human curation trips here first), and the network identity pins must name the Sepolia
		// v5 testnet this descriptor deploys to. The 5.0.0 entry encodes the owner ruling that
		// the 5.0.1 artifact is protocol-compatible with the live 5.0.0 node.
		const compat = descriptor.compatibleNodeVersions[descriptor.artifactSha256]
		expect(Array.isArray(compat)).toBe(true)
		expect(compat).toContain("5.0.0")
		expect(compat).toContain("5.0.1")
		expect(descriptor.network.l1ChainId).toBe(11155111)
		expect(descriptor.network.rollupVersion).toBe(1821665230)
	})
})

describe("privateMintAndPayFee", () => {
	it("builds a method paying via the FPC with a two-call setup payload", async () => {
		const fpc = AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS)
		const method = privateMintAndPayFee(fpc, 1_000n, new Fr(123n), Fr.zero(), new Fr(7n))
		expect((await method.getFeePayer()).toString()).toBe(PRIVATE_FPC_ADDRESS)
		// FeeJuice.claim + PrivateFPC.mint_and_pay_fee, run verbatim by the wallet's EXTERNAL path.
		const payload = await method.getExecutionPayload()
		expect(payload.calls).toHaveLength(2)
	})
})

describe("privateFeeJuicePayment", () => {
	it("pays via the FPC with a SINGLE pay_fee setup call (the manifest-scope assumption)", async () => {
		const fpc = AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS)
		const method = privateFeeJuicePayment(fpc)
		expect((await method.getFeePayer()).toString()).toBe(PRIVATE_FPC_ADDRESS)
		// FPCFeePaymentMethod emits exactly ONE private setup call — PrivateFPC.pay_fee. The faucet
		// manifest therefore scopes `pay_fee` alone; a Wonderland change that adds a setup call would
		// break that scope assumption and is meant to trip here.
		const payload = await method.getExecutionPayload()
		expect(payload.calls).toHaveLength(1)
	})
})
