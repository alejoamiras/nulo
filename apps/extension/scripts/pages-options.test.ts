import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { PageContext } from "vite-plugin-pages"
import { PAGES_OPTIONS } from "./pages-options"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const TEST_MODULE = /\.(test|spec)\.[^./]+$/

function filesUnder(dir: string): string[] {
	if (!existsSync(join(root, dir))) return []
	return readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).map((file) => join(dir, file))
}

async function routedFiles(options: typeof PAGES_OPTIONS | Pick<typeof PAGES_OPTIONS, "dirs">): Promise<string[]> {
	const context = new PageContext(options, root)
	await context.searchGlob()
	return [...context.pageRouteMap.keys()]
}

describe("the Pages route scan", () => {
	const colocatedTests = PAGES_OPTIONS.dirs.flatMap(({ dir }) => filesUnder(dir)).filter((file) => TEST_MODULE.test(file))

	test("test modules do sit inside the scanned directories", () => {
		expect(colocatedTests.length).toBeGreaterThan(0)
	})

	test("the configured scan drops exactly the test modules the defaults would route", async () => {
		const byDefault = await routedFiles({ dirs: PAGES_OPTIONS.dirs })
		const configured = await routedFiles(PAGES_OPTIONS)
		expect(byDefault.filter((file) => TEST_MODULE.test(file)).length).toBeGreaterThan(0)
		expect(configured.toSorted()).toEqual(byDefault.filter((file) => !TEST_MODULE.test(file)).toSorted())
	})
})
