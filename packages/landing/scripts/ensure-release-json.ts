#!/usr/bin/env bun
/**
 * Writes a placeholder src/generated/release.json if one isn't already
 * present. Lets `bun run typecheck` and `bun run test` succeed without
 * a prior `prebuild` (which fetches the real release info). The build
 * itself uses prebuild to overwrite this with real data.
 */

import { existsSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, "../src/generated/release.json")

if (!existsSync(target)) {
	const stub = {
		status: "no-release",
		releaseUrl: "https://github.com/alejoamiras/nulo/releases",
	}
	writeFileSync(target, `${JSON.stringify(stub, null, 2)}\n`)
	console.log("[ensure-release-json] wrote no-release stub")
}
