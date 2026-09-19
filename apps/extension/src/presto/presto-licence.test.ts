import { readFileSync } from "node:fs"
import { resolvePackageAsset } from "@nulo/resolve-asset"
import { describe, expect, test } from "vitest"

/**
 * The extension bundles all three, and the third-party-notices policy refuses copyleft. Versions
 * before the relicensing declared AGPL-3.0-only, so a pin that drifts backwards must fail here,
 * next to the pin, rather than only in the notices build.
 */
describe("Presto packages", () => {
	test.each(["@alejoamiras/presto", "@alejoamiras/presto-core", "@alejoamiras/presto-banners"])("%s declares the MIT licence", (name) => {
		const manifest = resolvePackageAsset(name, "package.json", { from: import.meta.url })
		const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { license?: unknown }
		expect(pkg.license).toBe("MIT")
	})
})
