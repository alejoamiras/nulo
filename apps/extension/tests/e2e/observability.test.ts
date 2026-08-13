/**
 * Sandbox-free pins for the e2e observability layer:
 *  - `formatPgMismatch` dumps the branch-CORRECT field, bounded, truncation-marked.
 *  - `RetryErrorReporter` prints the retained first-attempt error of a test that
 *    PASSED on retry (spawned child vitest on a fail-once fixture — the reporter
 *    contract can't be pinned in-process because it hooks the runner itself).
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test } from "vitest"
import { formatPgMismatch } from "./fixtures/playground"

test("formatPgMismatch: error result dumps errorJson (never the undefined resultJson)", () => {
	const out = formatPgMismatch({ seq: 7, method: "grantPublicAuthwit", status: "error", errorJson: { message: "nope" } })
	expect(out).toContain('errorJson={"message":"nope"}')
	expect(out).toContain("grantPublicAuthwit seq=7 status=error")
	expect(out).not.toContain("resultJson")
})

test("formatPgMismatch: ok result dumps resultJson; non-serializable falls back to String", () => {
	expect(formatPgMismatch({ seq: 1, method: "sendTx", status: "ok", resultJson: "0xabc" })).toContain('resultJson="0xabc"')
	const cyclic: Record<string, unknown> = {}
	cyclic.self = cyclic
	expect(formatPgMismatch({ seq: 2, method: "sendTx", status: "ok", resultJson: cyclic })).toContain("resultJson=[object Object]")
})

test("formatPgMismatch: hostile-length payload is truncated with a marker", () => {
	const out = formatPgMismatch({ seq: 3, method: "batch", status: "error", errorJson: { message: "x".repeat(10_000) } })
	expect(out.length).toBeLessThan(2_300)
	expect(out).toMatch(/…\[truncated \d+ chars\]/)
})

test("RetryErrorReporter surfaces the first-attempt error of a retried pass", () => {
	const dir = mkdtempSync(join(tmpdir(), "nulo-retry-reporter-pin-"))
	try {
		const marker = join(dir, "attempt-marker")
		writeFileSync(
			join(dir, "fail-once.test.ts"),
			`import { existsSync, writeFileSync } from "node:fs"
import { expect, test } from "vitest"
test("fails first, passes on retry", () => {
	if (!existsSync(${JSON.stringify(marker)})) {
		writeFileSync(${JSON.stringify(marker)}, "1")
		throw new Error("SYNTHETIC_FIRST_ATTEMPT_FAILURE")
	}
	expect(true).toBe(true)
})
`,
		)
		// cwd = the extension package so the child resolves vitest + the reporter
		// through the real dependency tree; the fixture lives under --root.
		const pkgDir = resolve(__dirname, "../..")
		// The INSTALLED vitest binary + absolute reporter path: bunx could fall
		// back to registry resolution on a runner where the local bin is absent,
		// which would test a different vitest than the suite runs.
		const vitestBin = resolve(pkgDir, "../../node_modules/.bin/vitest")
		const reporterAbs = join(__dirname, "retry-error-reporter.ts")
		const child = spawnSync(vitestBin, ["run", "--root", dir, "--retry", "1", "--reporter", "default", "--reporter", reporterAbs], {
			cwd: pkgDir,
			encoding: "utf8",
			timeout: 120_000,
		})
		const combined = `${child.stdout ?? ""}\n${child.stderr ?? ""}`
		// The synthetic test PASSES on retry, so the child must exit 0 — a nonzero
		// exit means the fixture or reporter itself broke.
		expect(child.status, `child vitest exit ${child.status}; output:\n${combined.slice(0, 3_000)}`).toBe(0)
		expect(combined.split("PASSED ON RETRY").length - 1, "reporter must fire exactly once").toBe(1)
		expect(combined).toContain("SYNTHETIC_FIRST_ATTEMPT_FAILURE")
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}, 150_000)
