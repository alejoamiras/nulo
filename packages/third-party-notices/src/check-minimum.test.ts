import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { missingFromNotices, parseMinimum } from "./check-minimum.ts"
import { OVERRIDES, VENDORED } from "./policy.ts"

const RULE = "=".repeat(80)
const notices = ["HEADER", RULE, "@scope/pkg@1.2.3", "Licence: MIT", RULE, "plain@0.1.0-rc.1", RULE, "unversioned"].join("\n")

describe("expected-minimum check", () => {
	test("parses names, ignoring comments and blanks", () => {
		expect(parseMinimum("# why\n\n vue \n@scope/pkg\n")).toEqual(["vue", "@scope/pkg"])
	})

	test("compares by name, so a version bump never trips it", () => {
		expect(missingFromNotices(notices, ["@scope/pkg", "plain", "unversioned"])).toEqual([])
		expect(missingFromNotices(notices, ["plain", "gone", "@scope/other"])).toEqual(["gone", "@scope/other"])
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
