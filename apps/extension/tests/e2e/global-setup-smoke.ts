import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import { execSync } from "node:child_process"
import type { TestProject } from "vitest/node"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// `EXTENSION_PATH` env var lets the release workflow point the smoke suite at a
// freshly-unzipped artifact instead of the repo's `dist/chrome/`. Falls back to
// the local build for ordinary `bun run test:e2e` runs.
const EXTENSION_PATH = process.env.EXTENSION_PATH ? path.resolve(process.env.EXTENSION_PATH) : path.resolve(__dirname, "../../dist/chrome")

/**
 * Kill orphan Chrome test processes started by THIS extension build only.
 *
 * Scoping by extension path lets a parallel impl in a different folder run its
 * own Chromes without us murdering each other's test runs.
 */
function cleanupOrphanChromeProcesses() {
	try {
		execSync(`pkill -f "chrome.*--load-extension=${EXTENSION_PATH}" 2>/dev/null || true`, { stdio: "ignore" })
	} catch {
		// Ignore errors — processes may not exist
	}
}

/** Smoke test global setup — validates the extension build and cleans up stale Chrome processes. */
/** Same vitest contract as global-setup.ts: with a default export present, the named `teardown`
 *  is IGNORED - it must be the default's return value (review CONFIRMED the identical bug here). */
export default async function setupWithTeardown(project: TestProject): Promise<() => Promise<void>> {
	await setup(project)
	return teardown
}

export async function setup(project: TestProject) {
	cleanupOrphanChromeProcesses()

	const manifest = path.join(EXTENSION_PATH, "manifest.json")
	if (!fs.existsSync(manifest)) {
		throw new Error(`Extension not found at ${EXTENSION_PATH}\nRun "bun run build" or "bun run dev" first.`)
	}
	project.provide("extensionPath", EXTENSION_PATH)
}

export async function teardown() {
	cleanupOrphanChromeProcesses()
}

declare module "vitest" {
	export interface ProvidedContext {
		extensionPath: string
	}
}
