// @vitest-environment node
// Node, not jsdom: bb.js poseidon2 throws std::bad_cast under jsdom.
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

function artifactWithoutDebugInfo(file: string): unknown {
	const path = resolvePackageAsset("@alejoamiras/private-fee-juice", file, { from: import.meta.url })
	const { file_map: _debugInfo, ...artifact } = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
	return artifact
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

	// The wallet derives from `target/` (the `@private-fpc-artifact` alias); the package's
	// `PrivateFPCContract` — what the e2e fixtures and dApps register — loads `dist/target/`. The
	// copies may differ only in the debug file map, or the two sides register different contracts.
	test("the package's runtime artifact is the one the wallet derives from", () => {
		expect(artifactWithoutDebugInfo("dist/target/private_contract-PrivateFPC.json")).toStrictEqual(
			artifactWithoutDebugInfo("target/private_contract-PrivateFPC.json"),
		)
	})
})
