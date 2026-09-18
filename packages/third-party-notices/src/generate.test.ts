import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { bundleContents } from "./collect.ts"
import { generateNotices, NoticesPolicyError, noticeNames } from "./generate.ts"
import { ALLOWED, type Policy } from "./policy.ts"

let root: string

function write(path: string, body: string) {
	const file = join(root, path)
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, body)
	return file
}

/** Installs a fake package and returns the id of one module inside it. */
function install(name: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) {
	const dir = `app/node_modules/${name}`
	write(`${dir}/package.json`, JSON.stringify({ name, version: "1.0.0", ...manifest }))
	for (const [file, body] of Object.entries(files)) write(`${dir}/${file}`, body)
	return write(`${dir}/dist/index.js`, "")
}

const policy = (extra: Partial<Policy> = {}): Policy => ({
	allowed: ALLOWED,
	overrides: [],
	vendored: [],
	binaryAsset: /\.wasm$/,
	...extra,
})

const run = (moduleIds: string[], extra: Partial<Policy> = {}, assets: string[] = []) =>
	generateNotices({ moduleIds, assets }, { policy: policy(extra), textsDir: join(root, "texts") })

function violations(act: () => unknown): readonly string[] {
	try {
		act()
	} catch (error) {
		if (error instanceof NoticesPolicyError) return error.violations
		throw error
	}
	throw new Error("expected a NoticesPolicyError")
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "notices-"))
	write("texts/verified.txt", "Copyright (c) Someone\r\nPermission is granted.\n\n")
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("bundleContents", () => {
	test("keeps rendered modules and assets, drops tree-shaken modules", () => {
		const contents = bundleContents({
			"assets/a.js": { type: "chunk", modules: { "/x/kept.js": { renderedLength: 12 }, "/x/shaken.js": { renderedLength: 0 } } },
			"assets/b.wasm": { type: "asset" },
		})
		expect(contents).toEqual({ moduleIds: ["/x/kept.js"], assets: ["assets/b.wasm"] })
	})
})

describe("generateNotices", () => {
	test("attributes modules to their package, dedupes, and skips first-party and virtual ids", () => {
		const left = install("left", { license: "MIT" }, { LICENSE: "Copyright (c) Left", "NOTICE.md": "Left notice" })
		// A nested module marker is not the owning manifest.
		const nested = write("app/node_modules/left/dist/esm/package.json", '{"type":"module"}')
		const scoped = install("@scope/right", { license: "(MIT OR GPL-3.0-only)" }, { "LICENCE.txt": "Copyright (c) Right" })
		const firstParty = write("packages/design/src/index.ts", "")
		const notices = run([left, `${dirname(nested)}/deep.js?v=1`, `\0${scoped}`, firstParty, "\0rolldown/runtime.js", "virtual:pages"])

		expect([...noticeNames(notices)]).toEqual(["@scope/right", "left"])
		expect(notices.match(/^left@1\.0\.0$/gm)).toHaveLength(1)
		expect(notices).toContain("Licence: (MIT OR GPL-3.0-only)")
		expect(notices).toContain("[LICENSE]\n\nCopyright (c) Left")
		expect(notices).toContain("[NOTICE.md]\n\nLeft notice")
		expect(notices).not.toContain(root)
	})

	test("is byte-stable across input order", () => {
		const ids = ["b", "a", "c"].map((name) => install(name, { license: "ISC" }, { LICENSE: `Copyright ${name}` }))
		expect(run(ids)).toBe(run([...ids].reverse()))
		expect(run(ids).endsWith("Copyright c\n")).toBe(true)
	})

	test("refuses disallowed, unlicensed, fileless and malformed packages, naming each", () => {
		const ids = [
			install("copyleft", { license: "AGPL-3.0-only" }, { LICENSE: "x" }),
			install("silent", {}, { LICENSE: "x" }),
			install("legacy", { license: { type: "MIT" } }, { LICENSE: "x" }),
			install("fileless", { license: "MIT" }),
			install("garbled", { license: "SEE LICENSE IN readme" }, { LICENSE: "x" }),
		]
		expect(violations(() => run(ids))).toEqual([
			'copyleft@1.0.0: licence "AGPL-3.0-only" is not allowed',
			"fileless@1.0.0: ships no licence file and has no OVERRIDES entry",
			'garbled@1.0.0: licence "SEE LICENSE IN readme" is not a valid SPDX expression',
			"legacy@1.0.0: no licence metadata and no OVERRIDES entry",
			"silent@1.0.0: no licence metadata and no OVERRIDES entry",
		])
	})

	test("an unattributable module fails instead of vanishing", () => {
		const orphan = write("app/node_modules/orphan/index.js", "")
		expect(() => run([orphan])).toThrow(/no owning package\.json found for bundled module orphan\/index\.js/)
	})

	describe("OVERRIDES", () => {
		const override = {
			names: ["silent"],
			reviewedVersion: "1.0.0",
			license: "MIT",
			source: "https://example.org/LICENSE",
			texts: ["verified.txt"],
			note: "Checked by hand.",
		}

		test("supplies licence, source, note and normalised text", () => {
			const notices = run([install("silent", {})], { overrides: [override] })
			expect(notices).toContain(
				"silent@1.0.0\nLicence: MIT\nSource: https://example.org/LICENSE\nNote: Checked by hand.\n" +
					`${"-".repeat(80)}\n[verified.txt]\n\nCopyright (c) Someone\nPermission is granted.\n`,
			)
		})

		test("never launders a disallowed licence", () => {
			const found = violations(() => run([install("silent", {})], { overrides: [{ ...override, license: "GPL-3.0-only" }] }))
			expect(found).toEqual(['silent@1.0.0: licence "GPL-3.0-only" is not allowed'])
		})

		test("goes stale on a version bump, a metadata change, or upstream fixing itself", () => {
			const bumped = install("silent", { version: "2.0.0" })
			expect(violations(() => run([bumped], { overrides: [override] }))).toEqual([
				"silent@2.0.0: OVERRIDES entry was reviewed at 1.0.0; re-verify it for this version",
			])
			const relicensed = install("silent", { license: "ISC" })
			expect(violations(() => run([relicensed], { overrides: [override] }))).toEqual([
				'silent@1.0.0: declares "ISC", which its OVERRIDES entry does not acknowledge',
			])
			expect(run([relicensed], { overrides: [{ ...override, declared: "ISC" }] })).toContain("Licence: MIT")
			const fixed = install("silent", { license: "MIT" }, { LICENSE: "x" })
			expect(violations(() => run([fixed], { overrides: [override] }))).toEqual([
				"silent@1.0.0: now ships licence metadata and a licence file; remove its stale OVERRIDES entry",
			])
		})

		test("needs a text when the package ships none, an https source, and a bundled target", () => {
			const bare = { ...override, texts: undefined, source: "example.org" }
			expect(violations(() => run([install("silent", {})], { overrides: [bare] }))).toEqual([
				"silent@1.0.0: OVERRIDES entry needs an https source URL",
				"silent@1.0.0: ships no licence file and its OVERRIDES entry supplies no text",
			])
			expect(violations(() => run([], { overrides: [override] }))).toEqual([
				"silent: OVERRIDES entry matches nothing bundled; remove it",
			])
		})
	})

	describe("VENDORED", () => {
		const component = {
			name: "inner",
			version: "3.1.0",
			license: "BSD-3-Clause",
			source: "https://example.org/inner",
			texts: ["verified.txt"],
			note: "Compiled into host.",
		}

		test("adds components when the host package rendered code", () => {
			const host = install("host", { license: "MIT" }, { LICENSE: "x" })
			const notices = run([host], { vendored: [{ trigger: { package: "host" }, components: [component] }] })
			expect([...noticeNames(notices)]).toEqual(["host", "inner"])
			expect(notices).toContain("inner@3.1.0\nLicence: BSD-3-Clause\nSource: https://example.org/inner")
		})

		test("requires a source URL, a text and an allowed licence", () => {
			const host = install("host", { license: "MIT" }, { LICENSE: "x" })
			const bad = { ...component, source: "", texts: [], license: "SSPL-1.0" }
			expect(violations(() => run([host], { vendored: [{ trigger: { package: "host" }, components: [bad] }] }))).toEqual([
				"inner@3.1.0: VENDORED entry needs an https source URL",
				"inner@3.1.0: VENDORED entry supplies no licence text",
				'inner@3.1.0: licence "SSPL-1.0" is not allowed',
			])
		})

		test("every compiled asset is claimed, every claim fires, and its covering package is bundled", () => {
			const claim = { trigger: { asset: /^assets\/engine-\w+\.wasm$/ }, components: [], coveredBy: ["engine"] }
			expect(violations(() => run([], {}, ["assets/engine-abc.wasm", "assets/logo.svg"]))).toEqual([
				"assets/engine-abc.wasm: compiled asset with no VENDORED entry",
			])
			expect(violations(() => run([], { vendored: [claim] }, ["assets/engine-abc.wasm"]))).toEqual([
				"asset /^assets\\/engine-\\w+\\.wasm$/ is covered by engine, which is not bundled",
			])
			expect(violations(() => run([], { vendored: [claim] }))).toEqual([
				"VENDORED entry for asset /^assets\\/engine-\\w+\\.wasm$/ matched nothing; remove or fix it",
			])
			const engine = install("engine", { license: "Apache-2.0" }, { LICENSE: "x" })
			expect([...noticeNames(run([engine], { vendored: [claim] }, ["assets/engine-abc.wasm"]))]).toEqual(["engine"])
		})
	})
})
