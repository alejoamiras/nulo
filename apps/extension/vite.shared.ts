import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, URL } from "node:url"
import packageJson from "./package.json"

/**
 * Shared building blocks for the vite/vitest config family
 * (`vite.config.ts`, `vite.{chrome,firefox}.config.mts`, `vitest.config.ts`,
 * `vitest.e2e*.config.ts`). These used to be copy-pasted under "Keep in sync"
 * comments — the sync drifted (the e2e:all config silently lost the noir
 * aliases). Single-owning them here is the fix.
 *
 * Every path here is resolved relative to THIS file, which lives in
 * `apps/extension/` alongside the configs that import it, so the
 * `import.meta.url` anchors resolve identically to the originals.
 */

/** Resolve a file inside an npm package, bypassing its `exports` field.
 *  Walks up from this config dir to find the package in any node_modules. */
export function resolvePackageFile(pkg: string, file: string): string {
	const parts = pkg.startsWith("@") ? pkg.split("/").slice(0, 2) : [pkg.split("/")[0]]
	let dir = fileURLToPath(new URL(".", import.meta.url))
	while (dir !== dirname(dir)) {
		const candidate = join(dir, "node_modules", ...parts, file)
		if (existsSync(candidate)) return candidate
		dir = dirname(dir)
	}
	throw new Error(`Cannot find ${pkg}/${file} in any node_modules`)
}

/** Absolute path to `apps/extension/src`. */
export const srcDir = fileURLToPath(new URL("./src", import.meta.url))

/** Compile-time `define` constants shared by the build + unit configs. */
export const sharedDefine: Record<string, string> = {
	__VERSION__: JSON.stringify(packageJson.version),
	__SENTINEL__: JSON.stringify(packageJson.sentinel),
	__AZTEC_VERSION__: JSON.stringify(packageJson.dependencies["@aztec/pxe"] ?? "unknown"),
	__NAME__: JSON.stringify(packageJson.name),
	__DISPLAY_NAME__: JSON.stringify(packageJson.displayName),
}

/** Contract-artifact aliases (bypass each package's `exports`), shared by the
 *  build + unit configs. */
export const artifactAliases: Record<string, string> = {
	"@private-fpc-artifact": resolvePackageFile("@alejoamiras/aztec-fee-payment", "target/private_contract-PrivateFPC.json"),
	"@wonderland-token-artifact": resolvePackageFile("@aztec-foundation/aztec-standards", "artifacts/target/token_contract-Token.json"),
}

/**
 * Force the node variant of the noir wasm wrappers. The patched `exports.node`
 * field works for Node's native resolver but vite's SSR bundler picks the
 * `module: "./web/..."` field on darwin arm64 hosts, which throws
 * `__wbindgen_malloc undefined` the first time the simulator runs a private
 * circuit. Direct alias to the nodejs entry sidesteps vite's resolution
 * entirely; on hosts where vite's resolver works (the CI Linux runners) this is
 * a no-op (alias points to the same file the resolver would have picked anyway).
 *
 * Required by every config that runs network e2e (`vitest.e2e.network` +
 * `vitest.e2e.all`); the build config keeps these in `dedupe` instead.
 */
export const noirAliases: Record<string, string> = {
	"@aztec/noir-acvm_js": fileURLToPath(new URL("../../node_modules/@aztec/noir-acvm_js/nodejs/acvm_js.js", import.meta.url)),
	"@aztec/noir-noirc_abi": fileURLToPath(new URL("../../node_modules/@aztec/noir-noirc_abi/nodejs/noirc_abi_wasm.js", import.meta.url)),
}
