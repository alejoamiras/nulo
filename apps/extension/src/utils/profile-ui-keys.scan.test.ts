// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the fixtures are code samples fed to the scanner as plain strings; their `${` is what it looks for.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import * as registry from "./profile-ui-keys"

/**
 * A profile deletion removes only the keys `profile-ui-keys.ts` enumerates, so a per-profile UI
 * key built anywhere else outlives its profile. The registry half proves every builder in the
 * module is enumerated; the scan half fails on a `nulo:ui:` key built with `${` or `+` outside
 * the module, and on a `useSyncedRef` key built that way (it prefixes `nulo:ui:` at runtime).
 *
 * Limits: a key assembled through a variable, a helper defined elsewhere, a template literal
 * split across lines, or a UI-key helper other than `useSyncedRef` gets past the scan, and the
 * registry half never sees a builder written outside the module.
 */

const SRC_ROOT = join(__dirname, "..")
const MODULE_PATH = "utils/profile-ui-keys.ts"
const SCANNED_EXT = /\.(ts|js|vue)$/
const SKIPPED_PATH = /(\.test\.(ts|js)$)|(^types\/)/
const COMMENT_LINE = /^(\/\/|\/?\*|<!--)/

const BUILT_KEY: RegExp[] = [
	/`[^`]*nulo:ui:[^`]*\$\{/,
	/\$\{[^`]*\}[^`]*nulo:ui:/,
	/["'`]nulo:ui:[^"'`]*["'`]\s*\+/,
	/\+\s*["'`]nulo:ui:/,
	/useSyncedRef\(\s*[^,)]*(\$\{|\+)/,
]

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) walk(full, out)
		else if (SCANNED_EXT.test(name)) out.push(full)
	}
	return out
}

/** `file:line` for every per-profile-looking UI key built outside the module. */
function findBuiltKeys(files: Array<{ path: string; content: string }>): string[] {
	const offenders: string[] = []
	for (const { path, content } of files) {
		if (path === MODULE_PATH || SKIPPED_PATH.test(path)) continue
		content.split("\n").forEach((line, i) => {
			const trimmed = line.trim()
			if (COMMENT_LINE.test(trimmed)) return
			if (BUILT_KEY.some((re) => re.test(trimmed))) offenders.push(`${path}:${i + 1} → ${trimmed}`)
		})
	}
	return offenders
}

const sourceFiles = () => walk(SRC_ROOT).map((full) => ({ path: relative(SRC_ROOT, full), content: readFileSync(full, "utf8") }))

describe("profile UI keys (registry)", () => {
	const builders = Object.entries(registry).filter(
		(entry): entry is [string, (id: string) => string] => entry[0].endsWith("Key") && typeof entry[1] === "function",
	)

	test("every prefix is a `nulo:ui:` name ending in `@`", () => {
		for (const prefix of registry.PROFILE_UI_KEY_PREFIXES) expect(prefix).toMatch(/^nulo:ui:[A-Za-z]+@$/)
	})

	test("every exported `*Key` builder is its prefix plus the id, and every prefix has one builder", () => {
		const matched = builders.map(([name, build]) => {
			const hits = registry.PROFILE_UI_KEY_PREFIXES.filter((prefix) => build("probe-id") === `${prefix}probe-id`)
			expect(hits, name).toHaveLength(1)
			return hits[0]
		})
		expect([...matched].sort()).toEqual([...registry.PROFILE_UI_KEY_PREFIXES].sort())
	})

	test("`profileUiKeys` names every prefix for exactly that id", () => {
		expect(registry.profileUiKeys("p1")).toEqual(registry.PROFILE_UI_KEY_PREFIXES.map((prefix) => `${prefix}p1`))
		expect(registry.profileUiKeys("p1")).not.toContain(registry.pinnedTokensKey("p10"))
	})
})

describe("profile UI keys (scan)", () => {
	test("no per-profile UI key is built outside the module", () => {
		const files = sourceFiles()
		const registryFile = files.find((f) => f.path === MODULE_PATH)
		// Non-vacuous: the walk reached the module and the module defines the builder.
		expect(registryFile?.content).toContain("export const pinnedTokensKey")
		const offenders = findBuiltKeys(files)
		expect(offenders, `Register the key in ${MODULE_PATH}:\n${offenders.join("\n")}`).toEqual([])
	})

	test("the scan flags each built form and passes fixed keys, comments and the module", () => {
		const flagged = findBuiltKeys([
			{ path: "popup/a.ts", content: "const k = `nulo:ui:recent@${profileId}`" },
			{ path: "popup/b.vue", content: 'storageLocalGet("nulo:ui:recent@" + profileId)' },
			{ path: "stores/c.ts", content: 'const k = profileId + "nulo:ui:x"' },
			{ path: "stores/c2.ts", content: "const k = `${ns}nulo:ui:recent`" },
			{ path: "stores/d.ts", content: "const r = useSyncedRef(`recent@${profileId}`, null)" },
			{ path: "stores/e.ts", content: 'const r = useSyncedRef("recent@" + profileId, null)' },
		])
		expect(flagged).toHaveLength(6)
		const passed = findBuiltKeys([
			{ path: "stores/f.ts", content: 'storageLocalSet({ "nulo:ui:activeAccount": address })' },
			{ path: "stores/g.ts", content: 'const r = useSyncedRef("loggerWindowId", null)' },
			{ path: "stores/h.ts", content: " * `nulo:ui:recent@${profileId}` in a doc comment" },
			{ path: MODULE_PATH, content: "const k = `nulo:ui:pinnedTokens@${profileId}`" },
			{ path: "stores/i.test.ts", content: "const k = `nulo:ui:recent@${profileId}`" },
		])
		expect(passed).toEqual([])
	})
})
