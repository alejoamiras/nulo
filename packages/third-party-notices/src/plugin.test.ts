import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import type { OutputBundleLike } from "./collect.ts"
import { noticeNames } from "./generate.ts"
import { NOTICES_FILE, thirdPartyNotices } from "./plugin.ts"
import { ALLOWED } from "./policy.ts"

let root: string

function install(name: string) {
	const dir = join(root, "node_modules", name)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", license: "MIT" }))
	writeFileSync(join(dir, "LICENSE"), `Copyright ${name}`)
	return join(dir, "index.js")
}

const workerBundle = (entry: string, file: string, ...ids: string[]): OutputBundleLike => ({
	[file]: {
		type: "chunk",
		isEntry: true,
		facadeModuleId: entry,
		modules: Object.fromEntries(ids.map((id) => [id, { renderedLength: 1 }])),
	},
})

/** A main bundle: one chunk, plus the worker files Vite hands it as assets. */
const mainBundle = (ids: string[], workerFiles: string[]): OutputBundleLike => ({
	"assets/index.js": { type: "chunk", modules: Object.fromEntries(ids.map((id) => [id, { renderedLength: 1 }])) },
	...Object.fromEntries(workerFiles.map((file) => [file, { type: "asset" as const, source: "/* worker */" }])),
})

function plugins() {
	const policy = { allowed: ALLOWED, overrides: [], vendored: [], codeAsset: /\.js$/ }
	const { main, worker } = thirdPartyNotices({ policy, textsDir: root, workspaceRoot: root })
	const emitted: string[] = []
	const context = { emitFile: (file: { fileName: string; source: string }) => emitted.push(file.source) }
	return {
		worker: (bundle: OutputBundleLike) => worker.generateBundle.call(context, {}, bundle),
		main: (bundle: OutputBundleLike) => {
			main.generateBundle.call(context, {}, bundle)
			return [...noticeNames(emitted.at(-1) ?? "")]
		},
	}
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "notices-plugin-"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("thirdPartyNotices", () => {
	test("the main build emits one file covering its own modules and every worker it ships", () => {
		const build = plugins()
		build.worker(workerBundle("/src/a.worker.ts", "assets/worker-a1.js", install("only-in-worker")))
		expect(build.main(mainBundle([install("in-main")], ["assets/worker-a1.js"]))).toEqual(["in-main", "only-in-worker"])
		expect(NOTICES_FILE).toBe("THIRD-PARTY-NOTICES.txt")
	})

	test("a package stylesheet that a CSS @import inlines is attributed although no chunk lists it", async () => {
		const { main } = thirdPartyNotices({
			policy: { allowed: ALLOWED, overrides: [], vendored: [], codeAsset: /\.js$/ },
			textsDir: root,
			workspaceRoot: root,
		})
		const theme = install("css-theme").replace(/index\.js$/, "theme.css")
		const reset = install("css-reset").replace(/index\.js$/, "reset.css")
		writeFileSync(theme, "@import url(css-reset/reset.css);\nbody { margin: 0 }")
		writeFileSync(reset, "* { box-sizing: border-box }")
		mkdirSync(join(root, "src"), { recursive: true })
		// A script beside the theme: a module resolver picks it for the extensionless import below,
		// while the CSS pipeline inlines theme.css.
		writeFileSync(theme.replace(/\.css$/, ".ts"), "export {}")
		// The partial is imported without its underscore or extension, and imports the package the same way.
		writeFileSync(join(root, "src/_partial.scss"), '@use "~css-theme/theme";')
		const resolved: Record<string, string> = {
			"css-theme/theme": theme.replace(/\.css$/, ".ts"),
			"css-theme/theme.css": theme,
			"css-reset/reset.css": reset,
		}
		const context = { resolve: async (specifier: string) => (resolved[specifier] ? { id: resolved[specifier] } : null) }

		await main.transform.handler.call(
			context,
			'@use "./partial";\n@import url("https://fonts.example/x.css");',
			join(root, "src/app.scss"),
		)
		await main.transform.handler.call(context, "export default 1", join(root, "src/app.ts"))

		const emitted: string[] = []
		main.generateBundle.call(
			{ emitFile: (file: { source: string }) => emitted.push(file.source) },
			{},
			mainBundle([join(root, "src/app.scss")], []),
		)
		expect([...noticeNames(emitted[0] ?? "")]).toEqual(["css-reset", "css-theme"])

		// An import nothing can follow refuses the build instead of slipping past attribution.
		await main.transform.handler.call(context, '@import url(mystery/skin);\n@use "sass:math";', join(root, "src/late.scss"))
		expect(() => main.generateBundle.call({ emitFile: () => undefined }, {}, mainBundle([], []))).toThrow(
			/late\.scss -> mystery\/skin: stylesheet import could not be followed/,
		)
	})

	test("a script asset no recorded worker wrote is refused, whatever it is called", () => {
		const build = plugins()
		expect(() => build.main(mainBundle([install("in-main")], ["assets/worker-hostile.js"]))).toThrow(
			/assets\/worker-hostile\.js: emitted code asset with no VENDORED entry/,
		)
	})

	test("what a worker build copies or imports as an asset still needs its own claim", () => {
		const build = plugins()
		build.worker({
			...workerBundle("/src/a.worker.ts", "assets/worker-a1.js", install("a-dep")),
			"assets/copied.js": { type: "asset", source: "/* third-party */" },
		})
		expect(() => build.main(mainBundle([], ["assets/worker-a1.js", "assets/copied.js"]))).toThrow(
			/assets\/copied\.js: emitted code asset with no VENDORED entry/,
		)
	})

	test("across rebuilds: a changed worker replaces its record, a removed one drops out, a cached one stays", () => {
		const build = plugins()
		build.worker(workerBundle("/src/a.worker.ts", "assets/worker-a1.js", install("a-dep-v1")))
		build.worker(workerBundle("/src/b.worker.ts", "assets/worker-b1.js", install("b-dep")))
		build.main(mainBundle([install("removed-later")], ["assets/worker-a1.js", "assets/worker-b1.js"]))

		// Worker a changed (new hash, new dependency); b was served from Vite's cache and not generated again.
		build.worker(workerBundle("/src/a.worker.ts", "assets/worker-a2.js", install("a-dep-v2")))
		expect(build.main(mainBundle([install("in-main")], ["assets/worker-a2.js", "assets/worker-b1.js"]))).toEqual([
			"a-dep-v2",
			"b-dep",
			"in-main",
		])
		expect(build.main(mainBundle([install("in-main")], ["assets/worker-a2.js"]))).toEqual(["a-dep-v2", "in-main"])
	})

	test("two workers writing the same file names keep separate records", () => {
		const build = plugins()
		build.worker(workerBundle("/src/a.worker.ts", "assets/worker-x.js", install("a-dep")))
		build.worker(workerBundle("/src/b.worker.ts", "assets/worker-x.js", install("b-dep")))
		expect(build.main(mainBundle([], ["assets/worker-x.js"]))).toEqual(["a-dep", "b-dep"])
	})
})
