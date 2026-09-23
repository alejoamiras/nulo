import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runOnce } from "./cli"
import { isFailedRun, parseFlippedScript } from "./lib"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../../..")
// Fixtures run through a workspace that DECLARES vitest: the root declares none, so a root-anchored
// launch would not resolve the bin under the isolated linker.
const landing = join(repoRoot, "apps/landing")
const fixtures = join(here, "fixtures")

function launcher(engine: "node" | "bun", fixture: string): string[] {
	return [
		"bun",
		"--no-install",
		"run",
		...(engine === "bun" ? ["--bun"] : []),
		"--cwd",
		landing,
		"vitest",
		"run",
		"--root",
		join(fixtures, fixture),
	]
}

async function runFixture(engine: "node" | "bun", fixture: string, timeoutMs = 60_000) {
	return runOnce({ launcher: launcher(engine, fixture), spawnCwd: repoRoot, timeoutMs, repoRoot, wsDir: join(fixtures, fixture) })
}

const BUN_TEST_DISCOVERY = /(\.|_)(test|spec)\.[cm]?[jt]sx?$/

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) walk(full, out)
		else out.push(full)
	}
	return out
}

test("no fixture file can be discovered by `bun test` (a crash or hang fixture would take CI down)", () => {
	const discoverable = walk(fixtures).filter((file) => BUN_TEST_DISCOVERY.test(file))
	expect(discoverable).toEqual([])
})

test("the node reference mode only accepts the flipped script shape", () => {
	expect(parseFlippedScript("bun --bun vitest run")).toEqual([])
	expect(parseFlippedScript("vitest run")).toBeNull()
})

for (const engine of ["node", "bun"] as const) {
	describe(`fixtures on ${engine}`, () => {
		test("passing: zero failed runs and the engine is recorded per run", async () => {
			const { run, statuses } = await runFixture(engine, "passing")
			expect(isFailedRun(run)).toBe(false)
			expect(run.runtime?.execPath).toBe(engine === "bun" ? "<bun>" : "<node>")
			expect(Boolean(run.runtime?.versions.bun)).toBe(engine === "bun")
			expect(run.collected).toBe(3)
			expect(run.passed).toBe(1)
			expect(run.skipped).toBe(1)
			expect(run.todo).toBe(1)
			expect(statuses.get("passing.fixture.ts :: passes")).toBe("passed")
		})

		test("crash: a killed worker is a failed run", async () => {
			const { run } = await runFixture(engine, "crash")
			expect(isFailedRun(run)).toBe(true)
			expect(run.exitCode === 0).toBe(false)
		})

		test("hang: the tool's timeout kills the process group, marks the run timed out, leaves no survivor", async () => {
			const { run } = await runFixture(engine, "hang", 8_000)
			expect(run.timedOut).toBe(true)
			expect(run.missingJson).toBe(true)
			expect(isFailedRun(run)).toBe(true)
			const survivors = spawnSync("pgrep", ["-f", join(fixtures, "hang")], { encoding: "utf8" })
			expect(survivors.stdout.trim()).toBe("")
		}, 30_000)

		test("no-json: a run that ends without a report (launcher killed) is a failed run, not a timeout", async () => {
			const { run } = await runFixture(engine, "no-json")
			expect(run.missingJson).toBe(true)
			expect(run.timedOut).toBe(false)
			expect(isFailedRun(run)).toBe(true)
		})

		test("unhandled rejection: the exit code carries it (vitest's JSON `success` does not)", async () => {
			const { run } = await runFixture(engine, "unhandled-rejection")
			expect(run.exitCode).not.toBe(0)
			expect(run.success).toBe(true)
			expect(isFailedRun(run)).toBe(true)
		})

		test("sourcemap: the failure names the exact source line", async () => {
			const { run } = await runFixture(engine, "sourcemap")
			expect(isFailedRun(run)).toBe(true)
			expect(run.failing).toEqual(["sourcemap.fixture.ts :: fails on a known line"])
			expect(run.failureMessages["sourcemap.fixture.ts :: fails on a known line"]).toContain("sourcemap.fixture.ts:5")
		})
	})
}
