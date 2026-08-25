import { fileURLToPath, URL } from "node:url"
import { resolvePackageAsset } from "@nulo/resolve-asset"
import packageJson from "./package.json"

/**
 * Shared building blocks for the vite/vitest config family
 * (`vite.config.ts`, `vite.{chrome,firefox}.config.mts`, `vitest.config.ts`,
 * `vitest.e2e*.config.ts`). These used to be copy-pasted under "Keep in sync"
 * comments — the sync drifted (the e2e:all config silently lost the noir
 * aliases). Single-owning them here is the fix.
 */
import RetryErrorReporter from "./tests/e2e/retry-error-reporter"

/**
 * Resolve a file inside an npm package, bypassing its `exports` field.
 * Anchored at this workspace via @nulo/resolve-asset, so it holds under both
 * the hoisted and the isolated linker — the package must be a DECLARED
 * dependency of apps/extension (the identity test enforces the sensitive ones).
 */
export function resolvePackageFile(pkg: string, file: string): string {
	return resolvePackageAsset(pkg, file, { from: import.meta.url })
}

/** Absolute path to `apps/extension/src`. */
export const srcDir = fileURLToPath(new URL("./src", import.meta.url))

/** Compile-time `define` constants shared by the build + unit configs. */
export const sharedDefine: Record<string, string> = {
	__VERSION__: JSON.stringify(packageJson.version),
	__AZTEC_VERSION__: JSON.stringify(packageJson.dependencies["@aztec/pxe"] ?? "unknown"),
	__NAME__: JSON.stringify(packageJson.name),
	__DISPLAY_NAME__: JSON.stringify(packageJson.displayName),
}

/** Contract-artifact aliases (bypass each package's `exports`), shared by the
 *  build + unit configs. */
export const artifactAliases: Record<string, string> = {
	"@private-fpc-artifact": resolvePackageFile("@alejoamiras/private-fee-juice", "target/private_contract-PrivateFPC.json"),
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
	"@aztec/noir-acvm_js": resolvePackageFile("@aztec/noir-acvm_js", "nodejs/acvm_js.js"),
	"@aztec/noir-noirc_abi": resolvePackageFile("@aztec/noir-noirc_abi", "nodejs/noirc_abi_wasm.js"),
}

/**
 * Reporter set for every e2e config. Explicit `reporters` SUPPRESSES vitest's
 * auto-added `github-actions` annotation reporter (it is only appended when the
 * resolved list is empty), so it must be re-added by hand on CI or PR
 * annotations silently disappear. RetryErrorReporter surfaces the retained
 * first-attempt errors of retried passes.
 */
export function e2eReporters(): ("default" | "github-actions" | RetryErrorReporter)[] {
	return ["default", ...(process.env.GITHUB_ACTIONS ? (["github-actions"] as const) : []), new RetryErrorReporter()]
}
