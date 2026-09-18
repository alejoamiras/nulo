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

const chunk = (file: string, ...ids: string[]): OutputBundleLike => ({
	[file]: { type: "chunk", modules: Object.fromEntries(ids.map((id) => [id, { renderedLength: 1 }])) },
})

function plugins() {
	const policy = { allowed: ALLOWED, overrides: [], vendored: [], codeAsset: /\.wasm$/ }
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
	test("the main build emits one file covering its own modules and every worker's", () => {
		const build = plugins()
		build.worker(chunk("assets/worker-a.js", install("only-in-worker")))
		expect(build.main(chunk("assets/index.js", install("in-main")))).toEqual(["in-main", "only-in-worker"])
		expect(NOTICES_FILE).toBe("THIRD-PARTY-NOTICES.txt")
	})

	test("a rebuild forgets main modules that left, and keeps a worker Vite did not bundle again", () => {
		const build = plugins()
		build.worker(chunk("assets/worker-a.js", install("only-in-worker")))
		build.main(chunk("assets/index.js", install("removed-later")))
		expect(build.main(chunk("assets/index.js", install("in-main")))).toEqual(["in-main", "only-in-worker"])

		// The same worker output generated again replaces its record rather than adding to it.
		build.worker(chunk("assets/worker-a.js", install("worker-dep-v2")))
		expect(build.main(chunk("assets/index.js", install("in-main")))).toEqual(["in-main", "worker-dep-v2"])
	})
})
