import { readFileSync } from "node:fs"
import { join } from "node:path"
import { assertPackageIdentity } from "@nulo/resolve-asset"
import { describe, expect, test } from "vitest"

const from = import.meta.url

/**
 * The extension bundles all three and must not ship copyleft code. Versions before the
 * relicensing declared AGPL-3.0-only, so a pin that drifts backwards fails here, next to the pin.
 * The lockstep rows matter as much as the licence: a second, older copy reached through another
 * package would be bundled too and would never be read by a direct resolution.
 */
describe("Presto packages", () => {
	test.each([
		["@alejoamiras/presto", "@nulo/aztec-runtime"],
		["@alejoamiras/presto-core", "@alejoamiras/presto"],
		["@alejoamiras/presto-banners", undefined],
	])("%s is one MIT-licensed copy", (name, lockstepVia) => {
		const { realRoot } = assertPackageIdentity(name, { from, lockstepVia })
		const pkg = JSON.parse(readFileSync(join(realRoot, "package.json"), "utf8")) as { license?: unknown }
		expect(pkg.license).toBe("MIT")
	})
})
