import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
	BASELINED_RULES,
	installedBiomeVersion,
	scanFileWideSuppressions,
	scanSuppressions,
} from "../complexity-baseline/scan"
import manifest from "../complexity-baseline/manifest.json"

// The complexity-budget baseline is shrink-only: grandfathered suppressions may be
// removed (with a manifest regeneration in the same PR), never added. Full protocol
// in CLAUDE.md § Complexity budgets.
describe("complexity baseline", () => {
	test("manifest pins the installed Biome version", () => {
		const rootPkg = JSON.parse(readFileSync("package.json", "utf8"))
		expect(
			manifest.biomeVersion,
			"Biome version changed — suppression scores drift between releases. Regenerate the baseline " +
				"in this PR: `bun run baseline:complexity` (it re-derives every allowance under the new version).",
		).toBe(installedBiomeVersion(rootPkg))
	})

	test("suppression counts match the manifest exactly (shrink-only ratchet)", () => {
		const actual = scanSuppressions()
		for (const rule of BASELINED_RULES) {
			const pinned = manifest.rules[rule] as Record<string, number>
			const files = new Set([...Object.keys(pinned), ...Object.keys(actual[rule])])
			const grew: string[] = []
			const shrank: string[] = []
			for (const file of files) {
				const was = pinned[file] ?? 0
				const now = actual[rule][file] ?? 0
				if (now > was) grew.push(`${file}: ${was} → ${now}`)
				else if (now < was) shrank.push(`${file}: ${was} → ${now}`)
			}
			expect(
				grew,
				`New ${rule} suppression(s) added — the baseline only shrinks. Refactor the function under ` +
					"the budget instead of suppressing. (Grandfathered directives are pre-existing debt, not a pattern to copy.)",
			).toEqual([])
			expect(
				shrank,
				`${rule} offender(s) fixed — record the progress: rerun \`bun run baseline:complexity\` ` +
					"in this PR so the manifest matches the shrunken baseline.",
			).toEqual([])
		}
	})

	test("no file-wide suppressions of any complexity-budget rule", () => {
		expect(
			scanFileWideSuppressions(),
			"File-wide biome-ignore-all suppressions of complexity-budget rules are never allowed — " +
				"suppress per function (baseline regeneration) or refactor.",
		).toEqual([])
	})
})
