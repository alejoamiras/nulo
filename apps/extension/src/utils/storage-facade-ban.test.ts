import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"

/**
 * Static ban: UI code must touch `chrome.storage.local` ONLY through the
 * migration-aware facade (`@/utils/storage`). A raw access can read a row
 * mid-migration and write the pre-migration shape back, corrupting the
 * transform — the exact race the facade's barrier exists to close. Biome can't
 * ban a member path (`noRestrictedGlobals` only bans whole globals, and UI
 * legitimately uses `chrome.runtime`/`chrome.tabs`), so this test IS the ban:
 * it fails the unit gate — and CI — listing every offending file:line.
 */

const SRC_ROOT = join(__dirname, "..")

/** Contexts allowed to touch `chrome.storage.local` raw, and why. */
const ALLOWLIST: RegExp[] = [
	// The facade itself — the one place the barrier wait lives.
	/^utils\/storage\.ts$/,
	// Composition-root adapter: implements the StoragePort the SW runs on.
	/^core\/adapters\/chrome-browser-api\.ts$/,
	// Service-worker context: owns the migrator + journal; the barrier is FOR
	// the UI contexts racing it, not for the SW itself. Service CLIENTS are
	// excluded from this allowance — they execute in popup/onboarding pages,
	// so a raw access there would bypass the barrier (see DENYLIST).
	/^wallet\//,
	// The barrier component observes the reserved `nulo:schema:*` keys; going
	// through the facade would deadlock on the very marker it displays.
	/^components\/MigrationBarrier\.vue$/,
	// Build-time-excluded e2e instrumentation (proof-gate pattern).
	/^e2e\//,
	// Tests may exercise storage directly.
	/\.test\.(ts|js)$/,
	// Generated type shims.
	/^types\//,
]

/** Overrides the allowlist: paths that run in UI contexts despite living under
 *  an allowlisted prefix. */
const DENYLIST: RegExp[] = [/^wallet\/services\/[^/]+\/client/]

const SCANNED_EXT = /\.(ts|js|vue)$/

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) walk(full, out)
		else if (SCANNED_EXT.test(name)) out.push(full)
	}
	return out
}

/** Returns `file:line` for every raw `chrome.storage.local` outside the allowlist. */
function findRawStorageAccess(files: Array<{ path: string; content: string }>): string[] {
	const offenders: string[] = []
	for (const { path, content } of files) {
		if (!DENYLIST.some((re) => re.test(path)) && ALLOWLIST.some((re) => re.test(path))) continue
		content.split("\n").forEach((line, i) => {
			const trimmed = line.trim()
			// Comments may legitimately mention the API; only code lines count.
			if (/^(\/\/|\/?\*|<!--)/.test(trimmed)) return
			if (trimmed.includes("chrome.storage.local")) offenders.push(`${path}:${i + 1} → ${trimmed}`)
		})
	}
	return offenders
}

describe("storage-facade ban (static)", () => {
	test("no raw chrome.storage.local outside the facade/allowlist", () => {
		const files = walk(SRC_ROOT).map((full) => ({
			path: relative(SRC_ROOT, full),
			content: readFileSync(full, "utf8"),
		}))
		const offenders = findRawStorageAccess(files)
		expect(offenders, `Raw chrome.storage.local access found — route through @/utils/storage:\n${offenders.join("\n")}`).toEqual([])
	})

	test("the scanner actually catches a violation (self-test)", () => {
		const offenders = findRawStorageAccess([
			{ path: "popup/pages/example.vue", content: "const x = await chrome.storage.local.get('k')" },
		])
		expect(offenders).toHaveLength(1)
		expect(offenders[0]).toContain("popup/pages/example.vue:1")
	})

	test("comment lines mentioning the API are not violations", () => {
		const offenders = findRawStorageAccess([
			{
				path: "popup/pages/example.vue",
				content: "// Persisted to chrome.storage.local so tabs agree\n * chrome.storage.local docs",
			},
		])
		expect(offenders).toEqual([])
	})

	test("the allowlist admits the facade and the SW context", () => {
		const offenders = findRawStorageAccess([
			{ path: "utils/storage.ts", content: "chrome.storage.local.get(k)" },
			{ path: "wallet/services/foo/service.ts", content: "chrome.storage.local.set(x)" },
			{ path: "components/MigrationBarrier.vue", content: "chrome.storage.local.get(keys)" },
		])
		expect(offenders).toEqual([])
	})

	test("service CLIENTS are denied despite the wallet/ allowance (they run in UI pages)", () => {
		const offenders = findRawStorageAccess([{ path: "wallet/services/foo/client.ts", content: "chrome.storage.local.get(k)" }])
		expect(offenders).toHaveLength(1)
	})
})
