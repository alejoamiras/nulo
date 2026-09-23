import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { buildDirsFor, missingFromNotices, parseMinimum } from "./check-minimum.ts"
import { generateNotices } from "./generate.ts"
import { ALLOWED, FONT_ALLOWED, OVERRIDES, VENDORED } from "./policy.ts"

const empty = generateNotices(
	{ moduleIds: [], assets: [], assetText: {}, assetSha256: {}, builtAssets: [] },
	{
		policy: { allowed: ALLOWED, overrides: [], vendored: [], derived: [], fontAllowed: FONT_ALLOWED, codeAsset: /\.wasm$/ },
		textsDir: ".",
		workspaceRoot: ".",
	},
)
const notices = empty.replace("COMPONENTS (0)", "COMPONENTS (3)\n@scope/pkg@1.2.3\tMIT\nplain@0.1.0-rc.1\tISC\nun versioned\tMIT")

describe("expected-minimum check", () => {
	test("parses names, ignoring comments and blanks", () => {
		expect(parseMinimum("# why\n\n vue \n@scope/pkg\n")).toEqual(["vue", "@scope/pkg"])
	})

	test("compares by name, so a version bump never trips it", () => {
		expect(missingFromNotices(notices, ["@scope/pkg", "plain", "un versioned"])).toEqual([])
		expect(missingFromNotices(notices, ["plain", "gone", "@scope/other"])).toEqual(["gone", "@scope/other"])
	})

	test("a CI target maps to the directories it built, and an unknown one is refused", () => {
		expect(buildDirsFor("chrome", "dist")).toEqual(["dist/chrome"])
		expect(buildDirsFor("both", "dist")).toEqual(["dist/chrome", "dist/firefox"])
		for (const target of ["", "Chrome", "safari", "toString"]) {
			expect(() => buildDirsFor(target, "dist")).toThrow(/unknown build target/)
		}
	})

	test("the checked-in list covers every override group and every vendored component", () => {
		const minimum = new Set(parseMinimum(readFileSync(new URL("../expected-minimum.txt", import.meta.url), "utf8")))
		for (const override of OVERRIDES) {
			expect(
				override.names.some((name) => minimum.has(name)),
				override.names[0],
			).toBe(true)
		}
		for (const component of VENDORED.flatMap((vendored) => vendored.components)) {
			expect(minimum.has(component.name), component.name).toBe(true)
		}
	})
})
