/** A hand-verified licence record for packages whose own metadata or files cannot carry the notice. */
export interface Override {
	names: readonly string[]
	/** The installed version the record was verified against; any other version fails the build. */
	reviewedVersion: string
	/** SPDX expression the notice is issued under. */
	license: string
	/** The package's own `license` field, acknowledged, when it differs from `license`. */
	declared?: string
	/** Where the licence text was taken from. */
	source: string
	/** Files under `texts/`, required when the package ships no licence file of its own. */
	texts?: readonly string[]
	note: string
}

/** Third-party code the module walk cannot attribute: embedded in another package, or a binary asset. */
export interface VendoredComponent {
	name: string
	version?: string
	license: string
	source: string
	texts: readonly string[]
	note: string
}

export interface Vendored {
	/**
	 * Fires when the named package rendered code, or when an emitted asset matches the pattern. A
	 * package trigger is bound to the version whose contents were inspected.
	 */
	trigger: { package: string; reviewedVersion: string } | { asset: RegExp }
	components: readonly VendoredComponent[]
	/** Packages whose own entry already carries this asset's notice; each must be present. */
	coveredBy?: readonly string[]
	/** For an asset the build itself writes from modules already walked: what writes it. */
	generated?: string
}

export interface Policy {
	allowed: ReadonlySet<string>
	overrides: readonly Override[]
	vendored: readonly Vendored[]
	/** Emitted assets that carry code; each must be claimed by a `vendored` asset trigger. */
	codeAsset: RegExp
}

export const ALLOWED: ReadonlySet<string> = new Set([
	"MIT",
	"Apache-2.0",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"ISC",
	"0BSD",
	"CC0-1.0",
	"Unlicense",
	"BlueOak-1.0.0",
	"MPL-2.0",
	"Zlib",
])

const AZTEC_TAG = "https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0"
const NOIR_COMMIT = "https://github.com/noir-lang/noir/blob/75061fab15986eedee4e7d9104ff87dd9fa4ca10"
const SQLITE3MC_TAG = "https://github.com/utelle/SQLite3MultipleCiphers/blob/v2.3.5"

const SQLITE3MC_NOTE =
	"SQLite3 Multiple Ciphers 2.3.5 over SQLite 3.53.2, compiled with Emscripten 6.0.0. The shipped sqlite3.wasm and sqlite3-opfs-async-proxy.js are byte-identical to the upstream release archive sqlite3mc-2.3.5-sqlite-3.53.2-wasm.zip (sha256 3d0d5ebe4c54a9a22012410726ecef711e4e3e15ec11dffddf09488c72a10670), which @aztec/sqlite3mc-wasm repackages unmodified. SQLite itself is in the public domain; the bundle header reproduced below is upstream's own statement of that and of the Emscripten runtime's terms. Of the cipher code compiled in, the parts that are neither sqlite3mc's own MIT code nor public domain have their own entries: sha2 and libaegis."

const SQLITE3MC_TEXTS = ["sqlite3mc.MIT.txt", "sqlite-wasm-bundle-header.txt", "emscripten.MIT.txt"] as const

export const OVERRIDES: readonly Override[] = [
	{
		names: [
			"@aztec/accounts",
			"@aztec/aztec.js",
			"@aztec/bb-prover",
			"@aztec/blob-lib",
			"@aztec/constants",
			"@aztec/entrypoints",
			"@aztec/ethereum",
			"@aztec/foundation",
			"@aztec/key-store",
			"@aztec/kv-store",
			"@aztec/noir-contracts.js",
			"@aztec/noir-protocol-circuits-types",
			"@aztec/protocol-contracts",
			"@aztec/pxe",
			"@aztec/simulator",
			"@aztec/standard-contracts",
			"@aztec/stdlib",
			"@aztec/wallet-sdk",
		],
		reviewedVersion: "5.2.0",
		license: "Apache-2.0",
		source: `${AZTEC_TAG}/LICENSE`,
		texts: ["aztec-packages.Apache-2.0.txt"],
		note: "Published from the aztec-packages monorepo with no licence field and no licence file; the repository root LICENSE at the release tag governs the tree these packages are built from.",
	},
	{
		names: ["@aztec/bb.js"],
		reviewedVersion: "5.2.0",
		license: "Apache-2.0",
		declared: "MIT",
		source: `${AZTEC_TAG}/barretenberg/LICENSE`,
		texts: ["barretenberg.Apache-2.0.txt"],
		note: "The package manifest declares MIT but ships no licence file; the barretenberg tree it and its wasm are built from carries the Apache-2.0 text reproduced here, the stricter of the two.",
	},
	{
		names: ["@aztec/noir-acvm_js"],
		reviewedVersion: "5.2.0",
		license: "MIT",
		source: `${NOIR_COMMIT}/LICENSE-MIT`,
		texts: ["noir.MIT.txt"],
		note: "Built from the noir submodule commit aztec-packages v5.2.0 pins; the package ships no licence file.",
	},
	{
		names: ["@aztec/noir-noirc_abi"],
		reviewedVersion: "5.2.0",
		license: "(MIT OR Apache-2.0)",
		source: `${NOIR_COMMIT}/LICENSE-MIT`,
		texts: ["noir.MIT.txt", "noir.Apache-2.0.txt"],
		note: "Built from the noir submodule commit aztec-packages v5.2.0 pins; the package ships no licence file.",
	},
	{
		names: ["@aztec/sqlite3mc-wasm"],
		reviewedVersion: "5.2.0",
		license: "MIT",
		source: `${SQLITE3MC_TAG}/LICENSE`,
		texts: SQLITE3MC_TEXTS,
		note: SQLITE3MC_NOTE,
	},
	{
		names: ["hash.js"],
		reviewedVersion: "1.1.7",
		license: "MIT",
		source: "https://github.com/indutny/hash.js/blob/v1.1.7/README.md#license",
		texts: ["hash.js.MIT.txt"],
		note: "Ships no licence file; the text is the LICENSE section of the README the package does ship.",
	},
]

export const VENDORED: readonly Vendored[] = [
	{
		trigger: { package: "vite-plugin-node-polyfills", reviewedVersion: "0.28.0" },
		components: [
			{
				name: "buffer",
				version: "6.0.3",
				license: "MIT",
				source: "https://github.com/feross/buffer/blob/v6.0.3/LICENSE",
				texts: ["buffer.MIT.txt"],
				note: "Compiled into vite-plugin-node-polyfills' Buffer shim, which is injected into every module that names Buffer.",
			},
			{
				name: "base64-js",
				license: "MIT",
				source: "https://github.com/beatgammit/base64-js/blob/v1.5.1/LICENSE",
				texts: ["base64-js.MIT.txt"],
				note: "A dependency of buffer, compiled into the same shim.",
			},
			{
				name: "ieee754",
				license: "BSD-3-Clause",
				source: "https://github.com/feross/ieee754/blob/v1.2.1/LICENSE",
				texts: ["ieee754.BSD-3-Clause.txt"],
				note: "A dependency of buffer, compiled into the same shim.",
			},
		],
	},
	{
		trigger: { asset: /^assets\/sqlite3(-[\w-]+)?\.wasm$/ },
		coveredBy: ["@aztec/sqlite3mc-wasm"],
		components: [
			{
				name: "sha2 by Olivier Gay",
				license: "BSD-3-Clause",
				source: `${SQLITE3MC_TAG}/src/sha2.c`,
				texts: ["sqlite3mc-sha2.BSD-3-Clause.txt"],
				note: "Compiled into sqlite3.wasm by SQLite3 Multiple Ciphers, which uses it for key derivation. The text is the file's own header.",
			},
			{
				name: "libaegis",
				license: "MIT",
				source: "https://github.com/jedisct1/libaegis/blob/b4e81fbf6bcb87308cc164bfce7f382882c41aec/LICENSE",
				texts: ["libaegis.MIT.txt"],
				note: "SQLite3 Multiple Ciphers vendors Frank Denis's AEGIS implementation under src/aegis, each file marked MIT; its tree carries no separate licence file, so the text is libaegis's own.",
			},
		],
	},
	{
		trigger: { asset: /^assets\/sqlite3-opfs-async-proxy\.js$/ },
		components: [],
		coveredBy: ["@aztec/sqlite3mc-wasm"],
	},
	{
		trigger: { asset: /^assets\/(main\.worker|thread\.worker|worker)-[\w-]+\.js$/ },
		components: [],
		generated: "Vite worker bundles, whose modules the worker plugin records",
	},
	{
		trigger: { asset: /^assets\/[\w.-]+-loader-[\w-]+\.js$/ },
		components: [],
		generated: "content-script loaders written by @crxjs/vite-plugin",
	},
	{
		trigger: { asset: /^assets\/barretenberg(-threads)?\.wasm\.gz$/ },
		components: [],
		coveredBy: ["@aztec/bb.js"],
	},
	{
		trigger: { asset: /^assets\/acvm_js_bg-[\w-]+\.wasm$/ },
		components: [],
		coveredBy: ["@aztec/noir-acvm_js"],
	},
	{
		trigger: { asset: /^assets\/noirc_abi_wasm_bg-[\w-]+\.wasm$/ },
		components: [],
		coveredBy: ["@aztec/noir-noirc_abi"],
	},
]

export const POLICY: Policy = {
	allowed: ALLOWED,
	overrides: OVERRIDES,
	vendored: VENDORED,
	codeAsset: /\.(wasm(\.gz)?|[cm]?js)$/,
}
