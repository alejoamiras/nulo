import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { checkTree } from "./check"
import { cleanupRepos, makeRepo } from "./fixture-repo"
import { countByRule, createCtx, ENFORCED, type Env, type Finding, formatFinding, isEnforced, RULE_IDS, verdict, writeSummary } from "./lib"
import { PATH_TOKEN_ALLOWLIST } from "./links"

const ROOT = join(import.meta.dir, "..", "..", "..")
const PULL_REQUEST: Env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request", GITHUB_BASE_REF: "dev" }

afterAll(cleanupRepos)

describe("plan tree gate", () => {
	test("the tree has no finding under an enforced rule; the others are reported", () => {
		const findings = checkTree({ cwd: ROOT })
		writeSummary(findings)
		const counts = Object.entries(countByRule(findings)).filter(([, n]) => n > 0)
		console.log(
			`plans gate: ${findings.length} finding(s)${counts.length ? ` — ${counts.map(([r, n]) => `${r}=${n}`).join(" ")}` : ""}`,
		)
		expect(findings.every((f) => RULE_IDS.includes(f.rule))).toBe(true)
		expect(verdict(findings, process.env), findings.filter(isEnforced).map(formatFinding).join("\n")).toBe("pass")
	}, 60_000)

	test("enforcement fails a pull request or a local run on an enforced finding, and never a push or a reported rule", () => {
		const one: Finding[] = [{ rule: "link-missing", file: "README.md", line: 1, detail: "d", fix: "f" }]
		expect(verdict(one, PULL_REQUEST)).toBe("fail")
		expect(verdict(one, { ...PULL_REQUEST, GITHUB_BASE_REF: "" })).toBe("fail")
		expect(verdict(one, {})).toBe("fail")
		expect(verdict(one, { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_BASE_REF: "dev" })).toBe("pass")
		expect(verdict([], PULL_REQUEST)).toBe("pass")
		expect(verdict([{ ...one[0], rule: "path-token" }], PULL_REQUEST)).toBe("pass")
		expect(RULE_IDS.filter((id) => !ENFORCED.has(id))).toEqual(["path-token", "index-structure", "archive-structure"])
	})

	test("path-token enforces in code and config, and only reports in a document", () => {
		const token = (file: string): Finding[] => [{ rule: "path-token", file, line: 1, detail: "d", fix: "f" }]
		expect(verdict(token("src/a.ts"), PULL_REQUEST)).toBe("fail")
		expect(verdict(token("package.json"), {})).toBe("fail")
		expect(verdict(token("src/a.ts"), { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push" })).toBe("pass")
		expect(verdict(token("docs/notes.md"), PULL_REQUEST)).toBe("pass")
		expect(verdict(token("docs/page.html"), {})).toBe("pass")
	})

	test("every held path-token mention is live, so a repointed one leaves the allowlist", () => {
		const ctx = createCtx({ cwd: ROOT })
		for (const held of PATH_TOKEN_ALLOWLIST) {
			expect(ctx.oids.get(held.file), held.file).toBe(held.blob)
			expect(ctx.read(held.file)).toContain(held.token)
		}
	})

	test("the CLI exits by the same verdict: a push run reports an enforced finding and passes", () => {
		const repo = makeRepo({ "implementations-plan/a/audit-x.md": "x\n" })
		const cli = (env: Env, ...args: string[]) =>
			spawnSync("bun", [join(import.meta.dir, "check.ts"), ...args], {
				cwd: repo,
				env: { ...process.env, GITHUB_EVENT_NAME: "", ...env },
				encoding: "utf8",
			})
		const push = cli({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push" })
		expect(push.status).toBe(0)
		expect(push.stdout).toContain("tracked-artifact implementations-plan/a/audit-x.md")
		expect(cli(PULL_REQUEST).status).toBe(1)
		expect(cli({ GITHUB_ACTIONS: "" }).status).toBe(1)
		expect(cli({ GITHUB_ACTIONS: "" }, "--report").status).toBe(0)
	}, 60_000)
})
