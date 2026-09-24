// @vitest-environment node
// Node, not jsdom: bb.js poseidon2 throws std::bad_cast under jsdom.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolvePackageAsset } from "@nulo/resolve-asset"
import { describe, expect, test } from "vitest"
import { derivePrivateFpc } from "./protocol-fpcs"

/** The PrivateFPC's canonical deployment, identical on testnet and mainnet. A red run means the
 *  artifact, the salt or upstream's derivation moved: fix it against the deployed contract, never
 *  by re-pinning these literals alone. */
const CANONICAL_PRIVATE_FPC = {
	salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
	deployer: "0x0000000000000000000000000000000000000000000000000000000000000000",
	address: "0x1a6d21ce5fd80137df0e99632a4ca17e58a42dc8f6c08191a96ca8ae907a1bc0",
}

/** sha256 of the key-sorted `target/` artifact without its debug file map, as reviewed for
 *  `@alejoamiras/private-fee-juice@5.0.1`. */
const REVIEWED_PRIVATE_FPC_ARTIFACT = "7dd0ff19b3767b0296d059d911dd9745502624e2b402a11ae8b35b2299e48f1b"

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
