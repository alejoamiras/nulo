import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolvePackageAsset } from "@nulo/resolve-asset"

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

/** Resolve a file inside a package WITHOUT its exports map (which blocks ./target/*) —
 *  layout-agnostic via @nulo/resolve-asset, anchored at this declaring workspace. */
function resolvePackageFile(pkg: string, file: string): string {
	return resolvePackageAsset(pkg, file, { from: import.meta.url })
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

	it.each(vectors)(
		"deriveBridgeSecret + secretHash match the pinned vector (salt=$salt)",
		async ({ salt, claimer, secret, secretHash }) => {
			expect(deriveBridgeSecret(salt, claimer).toString()).toBe(secret)
			expect((await privateFuelSecretHash(salt, claimer)).toString()).toBe(secretHash)
		},
	)

	it("ADDRESS TRIPWIRE — re-deriving from the installed artifact at the CANONICAL salt matches PRIVATE_FPC_ADDRESS", async () => {
		const rawBytes = readFileSync(resolvePackageFile("@alejoamiras/private-fee-juice", "target/private_contract-PrivateFPC.json"))
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

		const rawBytes = readFileSync(resolvePackageFile("@alejoamiras/private-fee-juice", "target/private_contract-PrivateFPC.json"))
		const digest = createHash("sha256").update(rawBytes).digest("hex")
		expect(digest).toBe(descriptor.artifactSha256)

		// The RUNTIME-imported copy (dist/target — what PrivateFPCContract loads) must be
		// CORE-equal to the gated artifact; the copies differ legitimately only in the
		// debug file_map (codex audit: a divergent dist copy would execute unchecked bytes).
		const canonicalize = (value: unknown): unknown => {
			if (Array.isArray(value)) return value.map(canonicalize)
			if (value && typeof value === "object") {
				const out: Record<string, unknown> = {}
				for (const key of Object.keys(value as Record<string, unknown>).sort()) {
					out[key] = canonicalize((value as Record<string, unknown>)[key])
				}
				return out
			}
			return value
		}
		const core = (bytes: Buffer): string => {
			const parsed = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>
			delete parsed.file_map
			return createHash("sha256")
				.update(JSON.stringify(canonicalize(parsed)))
				.digest("hex")
		}
		const distBytes = readFileSync(resolvePackageFile("@alejoamiras/private-fee-juice", "dist/target/private_contract-PrivateFPC.json"))
		expect(core(distBytes)).toBe(core(rawBytes))

		const installedVersion = JSON.parse(
			readFileSync(resolvePackageFile("@alejoamiras/private-fee-juice", "package.json"), "utf8"),
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

	it("MAINNET DESCRIPTOR — same identity as testnet (derivation is network-independent), mainnet pins, FAIL-CLOSED compat", () => {
		// check-fpc-version selects the descriptor whose network pins match the live node. The FPC
		// address derives from bytecode + canonical salt + ZERO deployer — network-independent — so
		// the two descriptors MUST agree on identity and differ ONLY in network pins + compat curation.
		const dir = fileURLToPath(new URL(".", import.meta.url))
		const testnet = JSON.parse(readFileSync(join(dir, "private-fpc-canonical.json"), "utf8"))
		const mainnet = JSON.parse(readFileSync(join(dir, "private-fpc-canonical-mainnet.json"), "utf8"))
		expect(mainnet.expectedAddress).toBe(testnet.expectedAddress)
		expect(mainnet.salt).toBe(testnet.salt)
		expect(mainnet.deployer).toBe(testnet.deployer)
		expect(mainnet.artifactSha256).toBe(testnet.artifactSha256)
		expect(mainnet.aztecVersion).toBe(testnet.aztecVersion)
		// Alpha/mainnet identity (verified live 2026-07-24): (1 ^ 4248422647) >>> 0 = 4248422646.
		expect(mainnet.network.l1ChainId).toBe(1)
		expect(mainnet.network.rollupVersion).toBe(4248422647)
		// Owner ruling 2026-07-27: the 5.0.1 artifact is curated compatible with the 5.1.0 Alpha
		// node — and ONLY that. Any other node version (or a new artifact digest) must re-red the
		// gate until freshly curated.
		const compat = mainnet.compatibleNodeVersions[mainnet.artifactSha256]
		expect(compat).toEqual(["5.0.1", "5.1.0"])
	})
})

// Canonical FeeJuice lives at protocol address 3.
const FEE_JUICE_ADDRESS = `0x${"0".repeat(63)}3`

describe("privateMintAndPayFee", () => {
	it("builds a two-call payload whose TARGETS + SELECTORS are pinned (not just the count)", async () => {
		const fpc = AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS)
		const method = privateMintAndPayFee(fpc, 1_000n, new Fr(123n), Fr.zero(), new Fr(7n))
		expect((await method.getFeePayer()).toString()).toBe(PRIVATE_FPC_ADDRESS)
		const payload = await method.getExecutionPayload()
		expect(payload.calls).toHaveLength(2)
		// Pin the exact (to, selector) of each call. Count-only would pass a tampered
		// fee-payment SDK that re-pointed the claim recipient or swapped a selector while
		// keeping two calls (codex ultra-audit HIGH #3). Call 0 = FeeJuice.claim (protocol
		// address 3); call 1 = PrivateFPC.mint_and_pay_fee (our pinned FPC address).
		expect(payload.calls[0].to.toString()).toBe(FEE_JUICE_ADDRESS)
		expect(payload.calls[0].selector.toString()).toBe("0xe8d374b6")
		expect(payload.calls[1].to.toString()).toBe(PRIVATE_FPC_ADDRESS)
		expect(payload.calls[1].selector.toString()).toBe("0xd43b351a")
	})
})

describe("privateFeeJuicePayment", () => {
	it("pays via the FPC with a SINGLE pay_fee call whose target + selector are pinned", async () => {
		const fpc = AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS)
		const method = privateFeeJuicePayment(fpc)
		expect((await method.getFeePayer()).toString()).toBe(PRIVATE_FPC_ADDRESS)
		// FPCFeePaymentMethod emits exactly ONE private setup call — PrivateFPC.pay_fee — targeting
		// the pinned FPC address with the pinned selector. A tampered SDK re-pointing/renaming it,
		// or a Wonderland change adding a setup call, trips here (count + target + selector).
		const payload = await method.getExecutionPayload()
		expect(payload.calls).toHaveLength(1)
		expect(payload.calls[0].to.toString()).toBe(PRIVATE_FPC_ADDRESS)
		expect(payload.calls[0].selector.toString()).toBe("0xb596dfae")
	})
})
