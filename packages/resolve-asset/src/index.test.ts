import { existsSync, realpathSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { assertPackageIdentity, isUnderNodeModules, resolveExportedAsset, resolvePackageAsset, resolvePackageRoot } from "./index"

// Anchors: real workspace manifests, chosen so each resolution runs from the
// workspace that DECLARES the target — the property that keeps these tests
// green under both the hoisted and the isolated linker.
const fromExtension = new URL("../../../apps/extension/package.json", import.meta.url).href
const fromBridgeCore = new URL("../../bridge-core/package.json", import.meta.url).href
const fromAztecRuntime = new URL("../../aztec-runtime/package.json", import.meta.url).href

describe("resolvePackageRoot", () => {
	test("plain package with unblocked package.json (vitest)", () => {
		const root = resolvePackageRoot("vitest", { from: import.meta.url })
		expect(existsSync(`${root}/package.json`)).toBe(true)
		expect(isUnderNodeModules(root)).toBe(true)
	})

	test("patched noir package whose exports map blocks ./package.json but exposes '.' under node (attempt 2)", () => {
		const root = resolvePackageRoot("@aztec/noir-noirc_abi", { from: fromExtension })
		expect(existsSync(`${root}/nodejs/noirc_abi_wasm.js`)).toBe(true)
	})

	test("package with NO '.' export resolves via an entry anchor (@aztec/pxe)", () => {
		const root = resolvePackageRoot("@aztec/pxe", { from: fromAztecRuntime, entry: "./server" })
		expect(existsSync(`${root}/dest/storage/metadata.js`)).toBe(true)
	})

	test("import-condition-only '.' resolves via an entry anchor (@aztec/sqlite3mc-wasm)", () => {
		const root = resolvePackageRoot("@aztec/sqlite3mc-wasm", {
			from: fromExtension,
			entry: "./vendor/jswasm/sqlite3.wasm",
		})
		expect(existsSync(`${root}/vendor/jswasm/sqlite3-opfs-async-proxy.js`)).toBe(true)
	})

	test("exports-blocked package WITHOUT an entry anchor throws the instructive error", () => {
		expect(() => resolvePackageRoot("@aztec/sqlite3mc-wasm", { from: fromExtension })).toThrow(/entry.*anchor/i)
	})

	test("unknown package throws", () => {
		expect(() => resolvePackageRoot("@nulo/does-not-exist-ever", { from: import.meta.url })).toThrow()
	})
})

describe("resolvePackageAsset", () => {
	test("returns an unexported file inside the package (@alejoamiras/private-fee-juice artifact)", () => {
		const artifact = resolvePackageAsset("@alejoamiras/private-fee-juice", "target/private_contract-PrivateFPC.json", {
			from: fromBridgeCore,
		})
		expect(existsSync(artifact)).toBe(true)
	})

	test("missing asset fails loudly at resolve time", () => {
		expect(() => resolvePackageAsset("vitest", "no/such/file.bin", { from: import.meta.url })).toThrow(/does not exist/)
	})
})

describe("resolveExportedAsset", () => {
	test("condition-less exported subpath resolves directly (sqlite3mc wasm)", () => {
		const wasm = resolveExportedAsset("@aztec/sqlite3mc-wasm", "./vendor/jswasm/sqlite3.wasm", {
			from: fromExtension,
		})
		expect(existsSync(wasm)).toBe(true)
		expect(wasm.endsWith("sqlite3.wasm")).toBe(true)
	})
})

describe("assertPackageIdentity", () => {
	test("verifies name + exact version and returns realpath evidence", () => {
		const report = assertPackageIdentity("@aztec/sqlite3mc-wasm", {
			from: fromExtension,
			entry: "./vendor/jswasm/sqlite3.wasm",
			expectVersion: "5.0.1",
		})
		expect(report.realRoot).toBe(realpathSync(report.root))
		expect(report.version).toBe("5.0.1")
	})

	test("wrong expectVersion throws with both versions in the message", () => {
		expect(() =>
			assertPackageIdentity("@aztec/sqlite3mc-wasm", {
				from: fromExtension,
				entry: "./vendor/jswasm/sqlite3.wasm",
				expectVersion: "9.9.9",
			}),
		).toThrow(/5\.0\.1.*9\.9\.9/)
	})

	test("mustContain verifies the patched noir exports marker (the patch's own content)", () => {
		const report = assertPackageIdentity("@aztec/noir-noirc_abi", {
			from: fromExtension,
			mustContain: { file: "package.json", marker: '"node": "./nodejs/noirc_abi_wasm.js"' },
		})
		expect(report.version).toBe("5.0.1")
	})

	test("mustContain with an absent marker throws", () => {
		expect(() =>
			assertPackageIdentity("@aztec/noir-noirc_abi", {
				from: fromExtension,
				mustContain: { file: "package.json", marker: "THIS-MARKER-DOES-NOT-EXIST" },
			}),
		).toThrow(/lacks the expected marker/)
	})

	test("lockstep: direct extension resolution and the kv-store two-hop realpath to the SAME copy", () => {
		const report = assertPackageIdentity("@aztec/sqlite3mc-wasm", {
			from: fromExtension,
			entry: "./vendor/jswasm/sqlite3.wasm",
			expectVersion: "5.0.1",
			lockstepVia: "@aztec/kv-store",
		})
		expect(report.lockstepRealRoot).toBe(report.realRoot)
	})
})
