// @vitest-environment node
// Node, not jsdom: bb.js poseidon2 throws std::bad_cast under jsdom.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolvePackageAsset } from "@nulo/resolve-asset"
import { describe, expect, test } from "vitest"
import { derivePrivateFpc, deriveSponsoredFpc } from "./protocol-fpcs"

/** The PrivateFPC's canonical address, the same on every network: the reviewed artifact under this
 *  salt and deployer. The contract is initializerless and private-only, so no deployment exists to
 *  check against, and unleashed's manifest names this address. A red run means the artifact, the
 *  salt or upstream's derivation moved: review the new artifact, never re-pin these literals alone. */
const CANONICAL_PRIVATE_FPC = {
	salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
	deployer: "0x0000000000000000000000000000000000000000000000000000000000000000",
	address: "0x0b3bc795b5c077b57920d590ecc163af18705554abf7164cb0f8c52850943c08",
}

/** The SponsoredFPC deployed and funded on the testnet, the wallet's default fee sponsor. A red run
 *  means the wallet would sponsor fees through a contract that does not exist there. */
const CANONICAL_SPONSORED_FPC = {
	salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
	deployer: "0x0000000000000000000000000000000000000000000000000000000000000000",
	address: "0x06a9fa0208c78509921b0487a6b5cd5c2e93baf17de1a18d310f65a3cc1d924b",
}

/** sha256 of the key-sorted `target/` artifact without its debug file map, as reviewed for
 *  `@alejoamiras/private-fee-juice@6.0.0-rc.1`. */
const REVIEWED_PRIVATE_FPC_ARTIFACT = "7092f28d73832aeff38bb7e4c01e88ee8b9c15993e869d22d73c74d0916f67c6"

function artifactWithoutDebugInfo(file: string): unknown {
	const path = resolvePackageAsset("@alejoamiras/private-fee-juice", file, { from: import.meta.url })
	const { file_map: _debugInfo, ...artifact } = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
	return artifact
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys)
	if (value === null || typeof value !== "object") return value
	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
	return Object.fromEntries(entries.map(([key, inner]) => [key, sortKeys(inner)]))
}

describe("protocol FPC derivation", () => {
	test("the wallet derives the PrivateFPC's canonical deployment address", async () => {
		const { instance } = await derivePrivateFpc()
		expect({
			salt: instance.salt.toString(),
			deployer: instance.deployer.toString(),
			address: instance.address.toString(),
		}).toEqual(CANONICAL_PRIVATE_FPC)
	})

	test("the wallet derives the deployed SponsoredFPC", async () => {
		const { instance } = await deriveSponsoredFpc()
		expect({
			salt: instance.salt.toString(),
			deployer: instance.deployer.toString(),
			address: instance.address.toString(),
		}).toEqual(CANONICAL_SPONSORED_FPC)
	})

	// The class id leaves out function flags such as `isStatic`, which the wallet copies into the
	// calls it builds, so an artifact change can keep the address above and still alter them. Red
	// means review the new artifact, then re-pin.
	test("the wallet's PrivateFPC artifact is the reviewed one", () => {
		const canonical = JSON.stringify(sortKeys(artifactWithoutDebugInfo("target/private_contract-PrivateFPC.json")))
		expect(createHash("sha256").update(canonical).digest("hex")).toBe(REVIEWED_PRIVATE_FPC_ARTIFACT)
	})

	// The wallet derives from `target/` (the `@private-fpc-artifact` alias); the package's
	// `PrivateFPCContract` — what the e2e fixtures and dApps register — loads `dist/target/`. The
	// copies may differ only in the debug file map, or the two sides register different contracts.
	test("the package's runtime artifact is the one the wallet derives from", () => {
		expect(artifactWithoutDebugInfo("dist/target/private_contract-PrivateFPC.json")).toStrictEqual(
			artifactWithoutDebugInfo("target/private_contract-PrivateFPC.json"),
		)
	})
})
