import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { PXE_DATA_SCHEMA_VERSION_PIN } from "./opfs-store"

function resolvePackageFile(pkg: string, file: string): string {
	const parts = pkg.startsWith("@") ? pkg.split("/").slice(0, 2) : [pkg.split("/")[0]]
	let dir = fileURLToPath(new URL(".", import.meta.url))
	while (dir !== dirname(dir)) {
		const candidate = join(dir, "node_modules", ...parts, file)
		if (existsSync(candidate)) return candidate
		dir = dirname(dir)
	}
	throw new Error(`Cannot find ${pkg}/${file} in any node_modules`)
}

describe("opfs-store upstream pins", () => {
	it("PXE_DATA_SCHEMA_VERSION_PIN matches the installed @aztec/pxe (drift tripwire)", () => {
		// Upstream does not export the constant; the injected-store path must stamp the SAME
		// schema version the PXE writes with, or a future upstream bump would strand every
		// store on a stale stamp (or wipe on every open). A pin mismatch here means: bump the
		// PIN consciously alongside the @aztec upgrade — the wipe-on-mismatch is upstream's
		// designed reset semantics, scoped per-chain by our injection.
		const source = readFileSync(resolvePackageFile("@aztec/pxe", "dest/storage/metadata.js"), "utf8")
		const match = source.match(/PXE_DATA_SCHEMA_VERSION\s*=\s*(\d+)/)
		expect(match).not.toBeNull()
		expect(Number(match?.[1])).toBe(PXE_DATA_SCHEMA_VERSION_PIN)
	})
})
