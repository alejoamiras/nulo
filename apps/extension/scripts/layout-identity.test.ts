import { existsSync } from "node:fs"
import { assertPackageIdentity, resolveExportedAsset, resolvePackageAsset } from "@nulo/resolve-asset"
import { describe, expect, it } from "vitest"

/**
 * Executable form of the layout-migration guarantee: every layout-sensitive
 * asset resolves to the RIGHT file of the RIGHT package from the workspace
 * that DECLARES it — under the hoisted AND the isolated linker. A failure here
 * means a phantom dependency, a split copy, or a patch that didn't apply;
 * never "just a moved directory".
 */

const fromExtension = import.meta.url
const fromBridgeCore = new URL("../../../packages/bridge-core/package.json", import.meta.url).href
const fromAztecRuntime = new URL("../../../packages/aztec-runtime/package.json", import.meta.url).href

describe("layout identity — extension-anchored", () => {
	it("sqlite3mc-wasm: declared pin, in lockstep with the copy @aztec/kv-store consumes", () => {
		const report = assertPackageIdentity("@aztec/sqlite3mc-wasm", {
			from: fromExtension,
			entry: "./vendor/jswasm/sqlite3.wasm",
			expectVersion: "5.0.1",
			lockstepVia: "@aztec/kv-store",
		})
		expect(report.lockstepRealRoot).toBe(report.realRoot)
		for (const asset of ["./vendor/jswasm/sqlite3.wasm", "./vendor/jswasm/sqlite3-opfs-async-proxy.js"]) {
			expect(existsSync(resolveExportedAsset("@aztec/sqlite3mc-wasm", asset, { from: fromExtension }))).toBe(true)
		}
	})

	it("patched noir packages: node-exports patch marker present, nodejs entries resolvable", () => {
		for (const [pkg, entry] of [
			["@aztec/noir-noirc_abi", "nodejs/noirc_abi_wasm.js"],
			["@aztec/noir-acvm_js", "nodejs/acvm_js.js"],
		] as const) {
			assertPackageIdentity(pkg, {
				from: fromExtension,
				expectVersion: "5.0.1",
				mustContain: { file: "package.json", marker: `"node": "./${entry}"` },
			})
			expect(existsSync(resolvePackageAsset(pkg, entry, { from: fromExtension }))).toBe(true)
		}
	})

	it("bb.js wasm inputs resolve from the extension's declared dependency", () => {
		expect(
			existsSync(
				resolvePackageAsset("@aztec/bb.js", "dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz", {
					from: fromExtension,
				}),
			),
		).toBe(true)
	})

	it("contract-artifact aliases resolve from the extension's declared dependencies", () => {
		expect(
			existsSync(
				resolvePackageAsset("@alejoamiras/private-fee-juice", "target/private_contract-PrivateFPC.json", {
					from: fromExtension,
				}),
			),
		).toBe(true)
		expect(
			existsSync(
				resolvePackageAsset("@aztec-foundation/aztec-standards", "artifacts/target/token_contract-Token.json", {
					from: fromExtension,
				}),
			),
		).toBe(true)
	})
})

describe("layout identity — cross-workspace anchors (resolution runs from the DECLARING workspace)", () => {
	it("bridge-core: private-fee-juice artifact + l1-artifacts contract sources", () => {
		expect(
			existsSync(
				resolvePackageAsset("@alejoamiras/private-fee-juice", "target/private_contract-PrivateFPC.json", {
					from: fromBridgeCore,
				}),
			),
		).toBe(true)
		expect(existsSync(resolvePackageAsset("@aztec/l1-artifacts", "l1-contracts/src", { from: fromBridgeCore }))).toBe(true)
	})

	it("aztec-runtime: @aztec/pxe storage metadata via its entry anchor (pxe exports no '.')", () => {
		expect(
			existsSync(
				resolvePackageAsset("@aztec/pxe", "dest/storage/metadata.js", {
					from: fromAztecRuntime,
					entry: "./server",
				}),
			),
		).toBe(true)
	})
})
