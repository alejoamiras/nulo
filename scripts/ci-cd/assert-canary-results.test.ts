/**
 * Behavioural pin for the canary results assertion — what makes a canary lane evidence.
 *
 * The reports are captured from real prover-ON runs of the four-file canary job on both browsers,
 * plus one scratch run with `describe.skip` on the passkey canary (the checkout's path rewritten to
 * `/repo` in each). The remaining cases are derived from the clean report in-test, the way an
 * edit would produce them: a listed file the run never reached, and a canary's own entry gone
 * while its setup-contract test still passes.
 *
 * Wired into CI via the root `test:ci-gating` script in `_unit-tests.yml`.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type CanaryReport, canaryProblems, loadExpectations } from "./assert-canary-results"

const ROOT = join(import.meta.dir, "..", "..")
const FIXTURES = join(import.meta.dir, "fixtures", "canary-results")
const SCRIPT = join(import.meta.dir, "assert-canary-results.ts")
const CANARY_JOB_FILES = [
	"tests/e2e/network/transfers.test.ts",
	"tests/e2e/network/tx-sendTx-default.test.ts",
	"tests/e2e/network/frozen-account-canary.test.ts",
	"tests/e2e/network/passkey-execution-canary.test.ts",
]
const PASSKEY = "tests/e2e/network/passkey-execution-canary.test.ts"
const CONTRACT_TEST = "agent-runner contract: a live sandbox must be configured (no false skip)"

const report = (name: string): CanaryReport => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"))
const expectations = loadExpectations()
const [PASSKEY_TITLE] = expectations[PASSKEY] ?? []

describe("assert-canary-results", () => {
	test.each(["clean-chrome.json", "clean-firefox.json"])("a clean four-file run passes: %s", (name) => {
		expect(canaryProblems(report(name), CANARY_JOB_FILES, expectations)).toEqual([])
	})

	test("a describe.skip on a canary is named, file and test — the file count alone would pass it", () => {
		const skipped = report("skipped-chrome.json")
		expect(skipped.testResults.map((result) => result.status)).toEqual(["passed"])
		expect(canaryProblems(skipped, [PASSKEY], expectations)).toEqual([
			`${PASSKEY}: "${CONTRACT_TEST}" skipped`,
			`${PASSKEY}: "${PASSKEY_TITLE}" skipped`,
		])
	})

	test("a listed file the run never reached is named", () => {
		const problems = canaryProblems(report("skipped-chrome.json"), CANARY_JOB_FILES, expectations)
		for (const file of CANARY_JOB_FILES.filter((file) => file !== PASSKEY)) {
			expect(problems).toContain(`${file}: absent from the report — it never ran`)
		}
	})

	test("a canary whose own entry is gone fails while its contract test still passes", () => {
		const clean = report("clean-chrome.json")
		const file = clean.testResults.find((result) => result.name.endsWith(`/${PASSKEY}`))
		if (!file) throw new Error("the clean report carries the passkey canary")
		file.assertionResults = file.assertionResults.filter((test) => test.title !== PASSKEY_TITLE)
		expect(file.assertionResults.map((test) => [test.title, test.status])).toEqual([[CONTRACT_TEST, "passed"]])
		expect(canaryProblems(clean, CANARY_JOB_FILES, expectations)).toEqual([
			`${PASSKEY}: "${PASSKEY_TITLE}" not reported — the canary is gone`,
		])
	})

	test("an empty file list, a file with no expectation and a file with no tests fail closed", () => {
		const clean = report("clean-chrome.json")
		expect(canaryProblems(clean, [], expectations)).toHaveLength(1)
		expect(canaryProblems(clean, [PASSKEY], {})).toEqual([`${PASSKEY}: no entry in canary-expectations.json`])
		const file = clean.testResults.find((result) => result.name.endsWith(`/${PASSKEY}`))
		if (!file) throw new Error("the clean report carries the passkey canary")
		file.assertionResults = []
		expect(canaryProblems(clean, [PASSKEY], expectations)).toEqual([
			`${PASSKEY}: "${PASSKEY_TITLE}" not reported — the canary is gone`,
			`${PASSKEY}: reported no tests`,
		])
	})

	test("the CLI exits 0 on a clean report and 1 naming the file on anything else", () => {
		const run = (fixture: string, files: string[]) =>
			Bun.spawnSync(["bun", SCRIPT, join(FIXTURES, fixture), ...files], { stdout: "pipe", stderr: "pipe" })
		expect(run("clean-chrome.json", CANARY_JOB_FILES).exitCode).toBe(0)
		const red = run("skipped-chrome.json", CANARY_JOB_FILES)
		expect(red.exitCode).toBe(1)
		expect(red.stderr.toString()).toContain(`::error::canary results: ${PASSKEY}: "${PASSKEY_TITLE}" skipped`)
		expect(run("no-such-report.json", CANARY_JOB_FILES).exitCode).toBe(1)
		expect(run("clean-chrome.json", []).exitCode).toBe(1)
	})
})

describe("canary-expectations.json", () => {
	test("every expected title is in its spec's source — a rename updates both in one commit", () => {
		for (const [file, titles] of Object.entries(expectations)) {
			const source = readFileSync(join(ROOT, "apps/extension", file), "utf8")
			expect(titles.length, `${file} names a substantive test`).toBeGreaterThan(0)
			for (const title of titles) expect(source, `${file} holds "${title}"`).toContain(title)
		}
	})

	test("every canary on disk, and every file in a canary job's list, has an entry", () => {
		const onDisk = readdirSync(join(ROOT, "apps/extension/tests/e2e/network"))
			.filter((name) => name.endsWith("-canary.test.ts"))
			.map((name) => `tests/e2e/network/${name}`)
		expect(onDisk.length).toBeGreaterThan(0)
		for (const file of onDisk) expect(expectations[file], file).toBeDefined()
		for (const workflow of ["pr-extension-network-e2e.yml", "pr-extension-network-e2e-firefox.yml", "nightly.yml"]) {
			// biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
			const { jobs } = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows", workflow), "utf8")) as any
			// biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
			for (const [name, job] of Object.entries(jobs) as [string, any][]) {
				if (!String(job.with?.shard_label ?? "").startsWith("canary")) continue
				for (const file of String(job.with.test_files).split(/\s+/).filter(Boolean)) {
					expect(expectations[file], `${workflow} → ${name}: ${file}`).toBeDefined()
				}
			}
		}
	})

	test("the e2e reporter set writes the json report the lane is asserted on", () => {
		const shared = readFileSync(join(ROOT, "apps/extension/vite.shared.ts"), "utf8")
		expect(shared).toContain("process.env.NULO_E2E_RESULTS_FILE")
		expect(shared).toContain('"json"')
	})
})
