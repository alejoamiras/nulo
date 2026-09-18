import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { type BundleContents, bundleContents } from "./collect.ts"
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
	codeAsset: /\.(wasm|js)$/,
	...extra,
})

const run = (moduleIds: string[], extra: Partial<Policy> = {}, assets: string[] = [], more: Partial<BundleContents> = {}) =>
	generateNotices(
		{ moduleIds, assets, assetText: {}, builtAssets: [], ...more },
		{ policy: policy(extra), textsDir: join(root, "texts"), workspaceRoot: root },
	)

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
			"assets/a.js": {
				type: "chunk",
				modules: {
					"/x/kept.js": { renderedLength: 12 },
					"/x/shaken.js": { renderedLength: 0 },
					"/x/shaken.vue?vue&type=script&lang.ts": { renderedLength: 0 },
					// A stylesheet renders no JavaScript and still ships, as a CSS asset.
					"/x/theme.css": { renderedLength: 0 },
					"/x/widget.vue?vue&type=style&index=0&lang.css": { renderedLength: 0 },
				},
			},
			"assets/b.wasm": { type: "asset" },
		})
		expect(contents).toEqual({
			moduleIds: ["/x/kept.js", "/x/theme.css", "/x/widget.vue?vue&type=style&index=0&lang.css"],
			assets: ["assets/b.wasm"],
			assetText: {},
			builtAssets: [],
		})
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
			install("legacy", { license: { type: "AGPL-3.0-only" } }, { LICENSE: "x" }),
			install("notice-only", { license: "MIT" }, { NOTICE: "attribution" }),
			install("hollow", { license: "MIT" }, { LICENSE: "  \n", "LICENSE.js": "module.exports = 'MIT'" }),
			install("fileless", { license: "MIT" }),
			install("garbled", { license: "SEE LICENSE IN readme" }, { LICENSE: "x" }),
		]
		expect(violations(() => run(ids))).toEqual([
			'copyleft@1.0.0: licence "AGPL-3.0-only" is not allowed',
			"fileless@1.0.0: ships no licence file and has no OVERRIDES entry",
			'garbled@1.0.0: licence "SEE LICENSE IN readme" is not a valid SPDX expression',
			"hollow@1.0.0: ships no licence file and has no OVERRIDES entry",
			'legacy@1.0.0: licence "AGPL-3.0-only" is not allowed',
			"notice-only@1.0.0: ships no licence file and has no OVERRIDES entry",
			"silent@1.0.0: no licence metadata and no OVERRIDES entry",
		])
	})

	test("an unattributable module fails instead of vanishing", () => {
		const orphan = write("app/node_modules/orphan/index.js", "")
		expect(() => run([orphan])).toThrow(/no package\.json naming "orphan" at its installation root/)
		const outside = mkdtempSync(join(tmpdir(), "notices-outside-"))
		writeFileSync(join(outside, "lib.js"), "")
		expect(violations(() => run([join(outside, "lib.js"), "/@crx/manifest"]))).toEqual([
			`${outside.split("/").at(-1)}/lib.js: bundled from outside the workspace and outside node_modules`,
		])
		rmSync(outside, { recursive: true, force: true })
	})

	test("the installation root owns a module, and every manifest below it must agree with it", () => {
		const parent = install("copyleft", { license: "AGPL-3.0-only" }, { LICENSE: "x" })
		write("app/node_modules/copyleft/dist/package.json", JSON.stringify({ name: "copyleft", version: "9.9.9", license: "MIT" }))
		expect(violations(() => run([parent]))).toEqual([
			"copyleft@1.0.0: carries a nested manifest (copyleft@9.9.9, MIT) that disagrees with its installation root",
			'copyleft@1.0.0: licence "AGPL-3.0-only" is not allowed',
		])

		// A faithful copy of the root manifest, as build tools leave in dist/, is not a finding.
		const tidy = install("tidy", { license: "MIT" }, { LICENSE: "x" })
		write("app/node_modules/tidy/dist/package.json", JSON.stringify({ name: "tidy", version: "1.0.0", license: "MIT" }))
		expect([...noticeNames(run([tidy]))]).toEqual(["tidy"])
	})

	test("an embedded package needs a record of that name, version and licence, and hides nothing above it", () => {
		const host = install("host", { license: "MIT" }, { LICENSE: "x" })
		const embed = (dir: string, manifest: object) => write(`app/node_modules/host/${dir}/package.json`, JSON.stringify(manifest))
		embed("vendor/outer", { name: "outer", version: "2.0.0", license: "AGPL-3.0-only" })
		embed("vendor/outer/inner", { name: "inner", version: "3.1.0", license: "MIT" })
		const deep = write("app/node_modules/host/vendor/outer/inner/index.js", "")
		const component = {
			name: "inner",
			version: "3.1.0",
			license: "MIT",
			source: "https://example.org/inner",
			texts: ["verified.txt"],
			note: "n",
		}
		const reviewed = (extra: object = {}) => ({
			vendored: [{ trigger: { package: "host", reviewedVersion: "1.0.0" }, components: [{ ...component, ...extra }] }],
		})

		expect(violations(() => run([host, deep], reviewed()))).toEqual([
			"host@1.0.0: embeds outer@2.0.0, which has no matching VENDORED component record",
		])
		embed("vendor/outer", { name: "host", version: "1.0.0" })
		expect([...noticeNames(run([host, deep], reviewed()))]).toEqual(["host", "inner"])
		for (const drift of [{ version: "999" }, { license: "ISC" }]) {
			expect(violations(() => run([host, deep], reviewed(drift)))).toContain(
				"host@1.0.0: embeds inner@3.1.0, which has no matching VENDORED component record",
			)
		}
	})

	test("legacy licence metadata is read, not erased: an array is a choice", () => {
		const choice = install("choice", { licenses: [{ type: "GPL-2.0-only" }, "MIT"] }, { LICENSE: "x" })
		expect(run([choice])).toContain("Licence: (GPL-2.0-only OR MIT)")
	})

	test("one name@version installed twice is one entry only when both would print the same", () => {
		const first = install("twin", { license: "MIT" }, { LICENSE: "Copyright twin" })
		write("other/node_modules/twin/package.json", JSON.stringify({ name: "twin", version: "1.0.0", license: "MIT" }))
		write("other/node_modules/twin/LICENSE", "Copyright twin")
		const second = write("other/node_modules/twin/index.js", "")
		expect(run([first, second]).match(/^twin@1\.0\.0$/gm)).toHaveLength(1)

		write("other/node_modules/twin/package.json", JSON.stringify({ name: "twin", version: "1.0.0", license: "AGPL-3.0-only" }))
		expect(violations(() => run([first, second]))).toEqual(['twin@1.0.0: licence "AGPL-3.0-only" is not allowed'])
		write("other/node_modules/twin/package.json", JSON.stringify({ name: "twin", version: "1.0.0", license: "ISC" }))
		expect(violations(() => run([first, second]))).toEqual(["twin@1.0.0: installed more than once with differing licence content"])
	})

	test("a manifest field that is not one well-formed token stops the build", () => {
		for (const manifest of [{ version: "1\ncomlink@1" }, { name: "evil\tMIT" }]) {
			const id = install("plain", { license: "MIT", ...manifest }, { LICENSE: "x" })
			expect(() => run([id])).toThrow(/name or version is not a single well-formed token/)
		}
		const multiline = install("plain", { name: "plain", license: "MIT\nOR\ncomlink" }, { LICENSE: "x" })
		expect(violations(() => run([multiline]))).toEqual([
			"plain@1.0.0: declares a licence that cannot be read; an OVERRIDES entry cannot stand in for it",
		])
	})

	test("licence text cannot forge or hide an inventory line", () => {
		const forged = `${"=".repeat(80)}\nphantom@1.0.0\nLicence: MIT\n\nCOMPONENTS (1)\nghost@1.0.0\tMIT`
		const notices = run([install("honest", { license: "MIT" }, { LICENSE: forged })])
		expect([...noticeNames(notices)]).toEqual(["honest"])
		expect(() => noticeNames(forged)).toThrow(/does not open with the component inventory/)
		expect(() => noticeNames(notices.replace("COMPONENTS (1)", "COMPONENTS (2)"))).toThrow(/states 2 components and lists 1/)
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

		test("cannot be used to bury a legacy or unreadable licence declaration", () => {
			const buried = install("silent", { licenses: [{ type: "AGPL-3.0-only" }] })
			expect(violations(() => run([buried], { overrides: [override] }))).toEqual([
				'silent@1.0.0: declares "AGPL-3.0-only", which its OVERRIDES entry does not acknowledge',
			])
			for (const unreadable of [{ licenses: [{ type: "AGPL-3.0-only" }, {}] }, { license: 7 }, { licenses: [] }]) {
				expect(violations(() => run([install("silent", unreadable)], { overrides: [override] }))).toEqual([
					"silent@1.0.0: declares a licence that cannot be read; an OVERRIDES entry cannot stand in for it",
				])
			}
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
			const notices = run([host], { vendored: [{ trigger: { package: "host", reviewedVersion: "1.0.0" }, components: [component] }] })
			expect([...noticeNames(notices)]).toEqual(["host", "inner"])
			expect(notices).toContain("inner@3.1.0\nLicence: BSD-3-Clause\nSource: https://example.org/inner")
		})

		test("requires a source URL, a text and an allowed licence", () => {
			const host = install("host", { license: "MIT" }, { LICENSE: "x" })
			const bad = { ...component, source: "", texts: [], license: "SSPL-1.0" }
			expect(
				violations(() =>
					run([host], { vendored: [{ trigger: { package: "host", reviewedVersion: "1.0.0" }, components: [bad] }] }),
				),
			).toEqual([
				"inner@3.1.0: VENDORED entry needs an https source URL",
				"inner@3.1.0: VENDORED entry supplies no licence text",
				'inner@3.1.0: licence "SSPL-1.0" is not allowed',
			])
		})

		test("a package trigger is bound to the version that was inspected", () => {
			const host = install("host", { version: "2.0.0", license: "MIT" }, { LICENSE: "x" })
			const stale = { trigger: { package: "host", reviewedVersion: "1.0.0" }, components: [component] }
			expect(violations(() => run([host], { vendored: [stale] }))).toEqual([
				"VENDORED entry for package host was reviewed at 1.0.0, not 2.0.0; re-inspect what it embeds",
			])
		})

		test("a claim says what accounts for the asset, and a generated one is proven by content, not by name", () => {
			const hollow = { trigger: { asset: /^assets\/shim-\w+\.js$/ }, components: [] }
			expect(violations(() => run([], { vendored: [hollow] }, ["assets/shim-a.js"]))).toEqual([
				"VENDORED entry for asset /^assets\\/shim-\\w+\\.js$/ names no component, no covering package and no generator",
			])
			const generated = { ...hollow, generated: { by: "the shim writer", content: /^load\("[\w.]+"\)\s*$/ } }
			const shipped = (text: string) =>
				run([], { vendored: [generated] }, ["assets/shim-a.js"], { assetText: { "assets/shim-a.js": text } })
			expect(shipped('load("a.js")\n')).toContain("COMPONENTS (0)")
			for (const hostile of ['load("a.js"); stealKeys()', ""]) {
				expect(violations(() => shipped(hostile))).toEqual([
					"VENDORED entry for asset /^assets\\/shim-\\w+\\.js$/ claims assets/shim-a.js, whose content is not what the shim writer writes",
				])
			}
		})

		test("a script asset needs no claim only when a recorded build wrote it", () => {
			expect(violations(() => run([], {}, ["assets/worker-hostile.js"]))).toEqual([
				"assets/worker-hostile.js: emitted code asset with no VENDORED entry",
			])
			expect(run([], {}, ["assets/worker-abc.js"], { builtAssets: ["assets/worker-abc.js"] })).toContain("COMPONENTS (0)")
		})

		test("every compiled asset is claimed, every claim fires, and its covering package is bundled", () => {
			const claim = { trigger: { asset: /^assets\/engine-\w+\.wasm$/ }, components: [], coveredBy: ["engine"] }
			expect(violations(() => run([], {}, ["assets/engine-abc.wasm", "assets/logo.svg"]))).toEqual([
				"assets/engine-abc.wasm: emitted code asset with no VENDORED entry",
			])
			expect(violations(() => run([], { vendored: [claim] }, ["assets/engine-abc.wasm"]))).toEqual([
				"VENDORED entry for asset /^assets\\/engine-\\w+\\.wasm$/ is covered by engine, which is not bundled",
			])
			expect(violations(() => run([], { vendored: [claim] }))).toEqual([
				"VENDORED entry for asset /^assets\\/engine-\\w+\\.wasm$/ matched nothing; remove or fix it",
			])
			const engine = install("engine", { license: "Apache-2.0" }, { LICENSE: "x" })
			expect([...noticeNames(run([engine], { vendored: [claim] }, ["assets/engine-abc.wasm"]))]).toEqual(["engine"])
		})
	})
})
