/**
 * The plan-tree gate's library, found from this file's location rather than a fixed relative path, so
 * the tools still run once this plan directory is archived one level deeper.
 */
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

function gateDir(from: string): string {
	for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) {
		const candidate = join(dir, "scripts/ci-cd/plans")
		if (existsSync(join(candidate, "lib.ts"))) return candidate
	}
	throw new Error(`no scripts/ci-cd/plans/lib.ts above ${from}`)
}

const GATE = gateDir(import.meta.dir)

export const lib: typeof import("../../../scripts/ci-cd/plans/lib") = await import(join(GATE, "lib.ts"))
export const links: typeof import("../../../scripts/ci-cd/plans/links") = await import(join(GATE, "links.ts"))
export const html: typeof import("../../../scripts/ci-cd/plans/html") = await import(join(GATE, "html.ts"))
export const fixtures: typeof import("../../../scripts/ci-cd/plans/fixture-repo") = await import(join(GATE, "fixture-repo.ts"))
export const BASES_FILE = "scripts/ci-cd/plans/permalink-bases.json"
