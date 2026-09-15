import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

/**
 * The onboarding and popup pages talk to Presto through `presto-core` alone, and onboarding
 * loads before any wallet exists — an `@aztec/*` dependency there would pull megabytes of WASM
 * into a page that never proves anything.
 */
describe("@alejoamiras/presto-core", () => {
	test("declares no @aztec dependency", () => {
		const require = createRequire(import.meta.url)
		const pkg = require("@alejoamiras/presto-core/package.json") as {
			dependencies?: Record<string, string>
			peerDependencies?: Record<string, string>
			optionalDependencies?: Record<string, string>
		}
		const declared = Object.keys({
			...pkg.dependencies,
			...pkg.peerDependencies,
			...pkg.optionalDependencies,
		})
		expect(declared.filter((name) => name.startsWith("@aztec/"))).toEqual([])
	})
})
