import { describe, expect, test } from "bun:test"
import {
	RESOLVE_ALLOWLIST,
	RESOLVE_SPECS,
	type RunRecord,
	type SoakSummary,
	buildInventory,
	canonicalExecPath,
	compactSummary,
	compareSummaries,
	createCanonicalizer,
	digestStatuses,
	findReservedFlag,
	isFailedRun,
	parseFlippedScript,
	parseVitestJson,
	percentile,
} from "./lib"

const canon = createCanonicalizer({ repoRoot: "/repo", wsDir: "/repo/apps/x", tmpDirs: ["/tmp/soak-abc"], home: "/opt/someone-home" })

const vitestJson = {
	success: true,
	numTotalTests: 3,
	testResults: [
		{
			name: "/repo/apps/x/src/a.test.ts",
			status: "passed",
			assertionResults: [
				{ fullName: "a passes", status: "passed" },
				{ fullName: "a skipped", status: "pending" },
				{ fullName: "a todo", status: "todo" },
			],
		},
	],
}

function run(partial: Partial<RunRecord> = {}): RunRecord {
	return {
		exitCode: 0,
		signal: null,
		wallMs: 100,
		timedOut: false,
		missingJson: false,
		success: true,
		runtime: { execPath: "<node>", versions: { node: "24.18.0" } },
		collected: 1,
		passed: 1,
		failed: 0,
		skipped: 0,
		todo: 0,
		failing: [],
		failureMessages: {},
		inventoryDigest: "d",
		hookFailed: false,
		...partial,
	}
}

function summary(side: "node" | "bun", overrides: Partial<SoakSummary["meta"]> = {}, runs = 2): SoakSummary {
	const runtime =
		side === "bun"
			? { execPath: "<bun>", versions: { bun: "1.4.0", node: "26.3.0" } }
			: { execPath: "<node>", versions: { node: "24.18.0" } }
	const statuses = new Map([["src/a.test.ts :: a passes", "passed"]])
	const built = buildInventory(Array.from({ length: runs }, () => statuses))
	const resolves = Object.fromEntries(RESOLVE_SPECS.map((spec) => [spec, { esm: `<repo>/node_modules/${spec}/index.js` }]))
	return {
		meta: {
			tool: "test-soak@1",
			argv: ["soak"],
			cwd: "apps/x",
			script: "test",
			runtimeMode: side === "bun" ? "script" : "node",
			filters: [],
			gitSha: "abc",
			gitDirty: false,
			lockfileSha256: "lock",
			vitestVersion: "4.1.10",
			pool: "forks",
			maxWorkers: null,
			runs,
			timeoutMin: 20,
			resolverEngine: side,
			resolves,
			...overrides,
		},
		runs: Array.from({ length: runs }, () => run({ runtime })),
		inventory: built.inventory,
		inventoryDigest: built.digest,
		failedRuns: 0,
	}
}

describe("canonicalization", () => {
	test("rewrites file URLs, temp dirs, the repo root and the home dir", () => {
		expect(canon.text("file:///repo/node_modules/zod/index.js")).toBe("<repo>/node_modules/zod/index.js")
		expect(canon.text("/tmp/soak-abc/results.json")).toBe("<tmp>/results.json")
		expect(canon.text("/opt/someone-home/.bun/bin/bun")).toBe("<home>/.bun/bin/bun")
	})
	test("test ids are workspace-relative", () => {
		expect(canon.relFile("/repo/apps/x/src/a.test.ts")).toBe("src/a.test.ts")
		expect(canon.relFile("file:///repo/packages/y/src/b.test.ts")).toBe("<repo>/packages/y/src/b.test.ts")
	})
	test("execPath collapses to the engine name", () => {
		expect(canonicalExecPath("/opt/someone-home/.bun/bin/bun", canon)).toBe("<bun>")
		expect(canonicalExecPath("/usr/bin/node", canon)).toBe("<node>")
	})
})

describe("parseVitestJson", () => {
	test("keys tests by relative file and full name, normalizes pending to skipped", () => {
		const parsed = parseVitestJson(vitestJson, canon)
		expect(parsed.collected).toBe(3)
		expect(parsed.passed).toBe(1)
		expect(parsed.skipped).toBe(1)
		expect(parsed.todo).toBe(1)
		expect(parsed.statuses.get("src/a.test.ts :: a skipped")).toBe("skipped")
		expect(digestStatuses(parsed.statuses)).toHaveLength(64)
	})
	test("identically named tests in one file get occurrence suffixes instead of collapsing", () => {
		const parsed = parseVitestJson(
			{
				success: true,
				numTotalTests: 3,
				testResults: [
					{
						name: "/repo/apps/x/src/dup.test.ts",
						status: "passed",
						assertionResults: [
							{ fullName: "same name", status: "passed" },
							{ fullName: "same name", status: "passed" },
							{ fullName: "same name", status: "skipped" },
							{ fullName: "same name #2", status: "passed" },
						],
					},
				],
			},
			canon,
		)
		expect([...parsed.statuses.keys()]).toEqual([
			"src/dup.test.ts :: same name",
			"src/dup.test.ts :: same name #2",
			"src/dup.test.ts :: same name #3",
			"src/dup.test.ts :: same name ##2",
		])
		expect(parsed.collected).toBe(4)
	})
	test("a file that failed to load becomes a failed <file> entry", () => {
		const parsed = parseVitestJson(
			{
				success: false,
				numTotalTests: 0,
				testResults: [
					{
						name: "/repo/apps/x/src/broken.test.ts",
						status: "failed",
						message: "boom at /repo/apps/x/src/broken.test.ts",
						assertionResults: [],
					},
				],
			},
			canon,
		)
		expect(parsed.failing).toEqual(["src/broken.test.ts :: <file>"])
		expect(parsed.failureMessages["src/broken.test.ts :: <file>"]).toBe("boom at <repo>/apps/x/src/broken.test.ts")
	})
})

describe("isFailedRun", () => {
	test("every failure mode counts", () => {
		expect(isFailedRun(run())).toBe(false)
		expect(isFailedRun(run({ exitCode: 1 }))).toBe(true)
		expect(isFailedRun(run({ missingJson: true }))).toBe(true)
		expect(isFailedRun(run({ success: false }))).toBe(true)
		expect(isFailedRun(run({ timedOut: true }))).toBe(true)
		expect(isFailedRun(run({ runtime: null }))).toBe(true)
		expect(isFailedRun(run({ hookFailed: true }))).toBe(true)
	})
})

describe("script grammar and reserved flags", () => {
	test("accepts only the flipped shape", () => {
		expect(parseFlippedScript("bun --bun vitest run")).toEqual([])
		expect(parseFlippedScript("bun --bun vitest run --passWithNoTests")).toEqual(["--passWithNoTests"])
		expect(parseFlippedScript("vitest run")).toBeNull()
		expect(parseFlippedScript("bun --bun vitest run && echo hi")).toBeNull()
		expect(parseFlippedScript("bun --bun vitest run $(id)")).toBeNull()
	})
	test("reserved flags are rejected in any spelling", () => {
		expect(findReservedFlag(["src/foo"])).toBeNull()
		expect(findReservedFlag(["--retry=2"])).toBe("--retry=2")
		expect(findReservedFlag(["--reporter", "json"])).toBe("--reporter")
		expect(findReservedFlag(["--poolOptions.threads.singleThread"])).toBe("--poolOptions.threads.singleThread")
	})
})

describe("inventory", () => {
	test("counts observations and failures per id", () => {
		const built = buildInventory([new Map([["t", "passed"]]), new Map([["t", "failed"]])])
		expect(built.inventory.t).toEqual({ statuses: { passed: 1, failed: 1 }, observations: 2, failures: 1 })
	})
	test("percentile picks the nearest-rank element", () => {
		expect(percentile([5, 1, 3], 50)).toBe(3)
		expect(percentile([5, 1, 3], 95)).toBe(5)
		expect(percentile([], 50)).toBe(0)
	})
})

describe("compareSummaries", () => {
	test("a clean same-commit pair passes and prints the pinned allowlist", () => {
		const result = compareSummaries(summary("node"), summary("bun"))
		expect(result.problems).toEqual([])
		expect(result.ok).toBe(true)
		expect(result.report).toContain("resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios")
	})
	test("dirty trees, drifted provenance and swapped roles fail", () => {
		expect(compareSummaries(summary("node", { gitDirty: true }), summary("bun")).problems).toContain(
			"reference summary was produced on a dirty tree",
		)
		expect(compareSummaries(summary("node", { gitSha: "other" }), summary("bun")).problems.join("\n")).toContain("meta.gitSha differs")
		expect(compareSummaries(summary("node", { lockfileSha256: "x" }), summary("bun")).problems.join("\n")).toContain(
			"meta.lockfileSha256 differs",
		)
		expect(compareSummaries(summary("bun"), summary("node")).ok).toBe(false)
	})
	test("engine identity is checked per run", () => {
		const b = summary("bun")
		b.runs[1] = run({ runtime: { execPath: "<node>", versions: { node: "24.18.0" } } })
		const result = compareSummaries(summary("node"), b)
		expect(result.problems.join("\n")).toContain("run 1 ran on Node, expected Bun")
		expect(result.problems.join("\n")).toContain("inconsistent")
	})
	test("any failed run, missing observation or extra failure fails", () => {
		const b = summary("bun")
		b.failedRuns = 1
		expect(compareSummaries(summary("node"), b).problems).toContain("candidate: failedRuns=1, expected 0")
		const missing = summary("bun")
		missing.inventory["src/a.test.ts :: a passes"] = { statuses: { passed: 1 }, observations: 1, failures: 0 }
		expect(compareSummaries(summary("node"), missing).problems.join("\n")).toContain("observed 1/2 runs")
		const regressed = summary("bun")
		regressed.inventory["src/a.test.ts :: a passes"] = { statuses: { passed: 1, failed: 1 }, observations: 2, failures: 1 }
		expect(compareSummaries(summary("node"), regressed).problems.join("\n")).toContain("candidate failed 1× vs reference 0×")
	})
	test("a stored failedRuns of 0 is never trusted over the rows", () => {
		const b = summary("bun")
		b.runs[1] = run({ runtime: { execPath: "<bun>", versions: { bun: "1.4.0", node: "26.3.0" } }, exitCode: 1, timedOut: true })
		const result = compareSummaries(summary("node"), b)
		expect(result.ok).toBe(false)
		expect(result.problems.join("\n")).toContain("1 run row(s) fail the gate")
		expect(result.problems.join("\n")).toContain("failedRuns=0 disagrees with 1 failing row(s)")
	})
	test("status counts are compared exactly, not just their names", () => {
		const b = summary("bun")
		const id = "src/a.test.ts :: a passes"
		const a = summary("node")
		a.inventory[id] = { statuses: { passed: 1, skipped: 1 }, observations: 2, failures: 0 }
		b.inventory[id] = { statuses: { passed: 1, skipped: 1 }, observations: 2, failures: 0 }
		expect(compareSummaries(a, b).ok).toBe(true)
		b.inventory[id] = { statuses: { skipped: 1, passed: 1 }, observations: 2, failures: 0 }
		expect(compareSummaries(a, b).ok).toBe(true)
		a.inventory[id] = { statuses: { passed: 2 }, observations: 2, failures: 0 }
		expect(compareSummaries(a, b).problems.join("\n")).toContain(`"${id}": statuses`)
	})
	test("inventory membership must be identical", () => {
		const b = summary("bun")
		b.inventory["src/extra.test.ts :: only on bun"] = { statuses: { passed: 2 }, observations: 2, failures: 0 }
		expect(compareSummaries(summary("node"), b).problems.join("\n")).toContain("inventories differ")
	})
	test("resolution differences pass only inside the pinned allowlist", () => {
		const allowed = summary("bun")
		allowed.meta.resolves.isows = { esm: "<repo>/node_modules/isows/_esm/bun.js" }
		const okResult = compareSummaries(summary("node"), allowed)
		expect(okResult.ok).toBe(true)
		expect(okResult.report).toContain("resolution differs (allowed): isows")
		const disallowed = summary("bun")
		disallowed.meta.resolves.zod = { esm: "<repo>/node_modules/zod/bun.js" }
		expect(compareSummaries(summary("node"), disallowed).problems).toContain(
			'"zod" resolves differently and is not in the pinned allowlist',
		)
		const evidenceless = summary("bun")
		const { vue: _omitted, ...withoutVue } = evidenceless.meta.resolves
		evidenceless.meta.resolves = withoutVue
		expect(compareSummaries(summary("node"), evidenceless).problems.join("\n")).toContain('no resolution evidence for "vue"')
	})
	test("the allowlist is exactly the four bun-condition packages", () => {
		expect([...RESOLVE_ALLOWLIST].sort()).toEqual(["@logtape/logtape", "axios", "isows", "msgpackr"])
	})
})

describe("compactSummary", () => {
	test("drops the inventory and failure messages, keeps failing counts", () => {
		const full = summary("bun")
		full.inventory["src/f.test.ts :: flaky"] = { statuses: { passed: 1, failed: 1 }, observations: 2, failures: 1 }
		full.runs[0] = run({ failureMessages: { "src/f.test.ts :: flaky": "stack" } })
		const compact = compactSummary(full)
		expect("inventory" in compact).toBe(false)
		expect(compact.failing).toEqual({ "src/f.test.ts :: flaky": 1 })
		expect("failureMessages" in (compact.runs[0] as object)).toBe(false)
		expect(compact.inventoryDigest).toBe(full.inventoryDigest)
	})
})
