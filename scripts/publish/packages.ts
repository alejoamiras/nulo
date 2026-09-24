/** The workspace packages staged for npm, and the public surface each one ships. */

export interface PublishedEntry {
	/** Subpath in the published `exports` map. */
	subpath: "." | `./${string}`
	/** Source file, relative to the workspace package root. */
	source: `src/${string}.ts`
	/** Importing the entry is the point (it mutates a shared singleton), so bundlers must never drop it. */
	sideEffect?: true
}

export interface PublishedPackage {
	/** Directory under `packages/`. */
	dir: string
	/** npm name. The workspace keeps its private `@nulo/*` name, which never reaches a registry. */
	name: `@alejoamiras/nulo-${string}`
	description: string
	/** `browser` entries may not import `node:*`; `resolve-asset` is a Node/Bun build helper by contract. */
	target: "browser" | "node"
	entries: readonly PublishedEntry[]
}

export const PACKAGES: readonly PublishedPackage[] = [
	{
		dir: "wallet-crypto",
		name: "@alejoamiras/nulo-wallet-crypto",
		description: "Nulo wallet account-key derivation and password-based encryption.",
		target: "browser",
		entries: [{ subpath: ".", source: "src/public.ts" }],
	},
	{
		dir: "resolve-asset",
		name: "@alejoamiras/nulo-resolve-asset",
		description: "Resolve files inside installed packages from the caller's location, on any node_modules layout.",
		target: "node",
		entries: [{ subpath: ".", source: "src/index.ts" }],
	},
	{
		dir: "wallet-sdk-schema-patch",
		name: "@alejoamiras/nulo-wallet-sdk-schema-patch",
		description: "Adds the Nulo wallet's custom RPC methods to @aztec/aztec.js's WalletSchema.",
		target: "browser",
		entries: [
			{ subpath: "./apply", source: "src/apply.ts" },
			{ subpath: "./register", source: "src/register.ts", sideEffect: true },
		],
	},
]

export function packageByDir(dir: string): PublishedPackage {
	const pkg = PACKAGES.find((p) => p.dir === dir)
	if (!pkg) throw new Error(`not a published package: ${dir} (one of: ${PACKAGES.map((p) => p.dir).join(", ")})`)
	return pkg
}
