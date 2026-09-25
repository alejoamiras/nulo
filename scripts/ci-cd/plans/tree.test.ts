import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { checkTree } from "./check"
import { countByRule, type Env, type Finding, formatFinding, RULE_IDS, verdict, writeSummary } from "./lib"

const ROOT = join(import.meta.dir, "..", "..", "..")
/** The tree still holds the findings its cleanup removes, so every mode only reports until they are gone. */
const REPORT_ONLY = true
const PULL_REQUEST: Env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request", GITHUB_BASE_REF: "dev" }

describe("plan tree gate", () => {
	test("the tree's findings are reported, and would fail a pull request once enforced", () => {
		const findings = checkTree({ cwd: ROOT })
		writeSummary(findings)
		const counts = Object.entries(countByRule(findings)).filter(([, n]) => n > 0)
		console.log(
			`plans gate: ${findings.length} finding(s)${counts.length ? ` — ${counts.map(([r, n]) => `${r}=${n}`).join(" ")}` : ""}`,
		)
		expect(findings.every((f) => RULE_IDS.includes(f.rule))).toBe(true)
		expect(verdict(findings, process.env, REPORT_ONLY), findings.map(formatFinding).join("\n")).toBe("pass")
		expect(verdict(findings, PULL_REQUEST, false)).toBe(findings.length > 0 ? "fail" : "pass")
	}, 60_000)

	test("enforcement fails a pull request or a local run on any finding, and never a push", () => {
		const one: Finding[] = [{ rule: "link-missing", file: "README.md", line: 1, detail: "d", fix: "f" }]
		expect(verdict(one, PULL_REQUEST, false)).toBe("fail")
		expect(verdict(one, { ...PULL_REQUEST, GITHUB_BASE_REF: "" }, false)).toBe("fail")
		expect(verdict(one, {}, false)).toBe("fail")
		expect(verdict(one, { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_BASE_REF: "dev" }, false)).toBe("pass")
		expect(verdict([], PULL_REQUEST, false)).toBe("pass")
		expect(verdict(one, PULL_REQUEST, REPORT_ONLY)).toBe("pass")
	})
})
