/**
 * The plan-tree gate's library and this plan's own directory, both found from this file's location, so the
 * tools still run, on the archived copy's data, once this directory moves under `archive/`.
 */
import { existsSync } from "node:fs"
import { dirname, join, relative } from "node:path"

function gateDir(from: string): string {
	for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) {
		const candidate = join(dir, "scripts/ci-cd/plans")
		if (existsSync(join(candidate, "lib.ts"))) return candidate
	}
	throw new Error(`no scripts/ci-cd/plans/lib.ts above ${from}`)
}

const GATE = gateDir(import.meta.dir)
/** This plan's directory, repo-relative. */
export const OWN = relative(dirname(dirname(dirname(GATE))), dirname(import.meta.dir))

export const lib: typeof import("../../../scripts/ci-cd/plans/lib") = await import(join(GATE, "lib.ts"))
export const links: typeof import("../../../scripts/ci-cd/plans/links") = await import(join(GATE, "links.ts"))
export const html: typeof import("../../../scripts/ci-cd/plans/html") = await import(join(GATE, "html.ts"))
export const structure: typeof import("../../../scripts/ci-cd/plans/structure") = await import(join(GATE, "structure.ts"))
export const fixtures: typeof import("../../../scripts/ci-cd/plans/fixture-repo") = await import(join(GATE, "fixture-repo.ts"))
export const BASES_FILE = "scripts/ci-cd/plans/permalink-bases.json"
