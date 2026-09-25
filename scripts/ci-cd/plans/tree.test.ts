import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { checkTree } from "./check"
import { countByRule, RULE_IDS, writeSummary } from "./lib"

const ROOT = join(import.meta.dir, "..", "..", "..")

describe("plan tree gate (report-only)", () => {
	test("the tree's findings are reported, not enforced", () => {
		const findings = checkTree({ cwd: ROOT })
		writeSummary(findings)
		const counts = Object.entries(countByRule(findings)).filter(([, n]) => n > 0)
		console.log(
			`plans gate: ${findings.length} finding(s)${counts.length ? ` — ${counts.map(([r, n]) => `${r}=${n}`).join(" ")}` : ""}`,
		)
		expect(findings.every((f) => RULE_IDS.includes(f.rule))).toBe(true)
	}, 60_000)
})
