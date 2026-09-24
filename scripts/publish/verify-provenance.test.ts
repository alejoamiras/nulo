/**
 * `verify-provenance.sh` against a real attested npm package. It needs the network and an
 * authenticated `gh`, so it is opt-in: `NULO_PROVENANCE_PROBE=1 bun test scripts/publish/verify-provenance.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(import.meta.dir, "verify-provenance.sh")
/** Published by sigstore-js's release workflow from main, with an SLSA v1 bundle on the registry. */
const PROBE = { spec: "@sigstore/core@3.0.0", repo: "sigstore/sigstore-js", workflow: ".github/workflows/release.yml" }

describe.skipIf(!process.env.NULO_PROVENANCE_PROBE)(`verify-provenance.sh against ${PROBE.spec}`, () => {
	const dir = mkdtempSync(join(tmpdir(), "nulo-provenance-"))
	let tarball = ""
	afterAll(() => rmSync(dir, { recursive: true, force: true }))
	beforeAll(() => {
		const pack = Bun.spawnSync(["npm", "pack", PROBE.spec, "--pack-destination", dir, "--json"], { stdout: "pipe", stderr: "pipe" })
		const [info] = JSON.parse(pack.stdout.toString()) as { filename: string }[]
		tarball = join(dir, info?.filename ?? "")
	}, 60_000)

	const verify = (file: string, workflow: string) =>
		Bun.spawnSync([SCRIPT, file, PROBE.repo, workflow], { stdout: "pipe", stderr: "pipe", env: process.env })

	test("accepts the bundle its own workflow signed and prints the attested commit", () => {
		const run = verify(tarball, PROBE.workflow)
		expect({ exit: run.exitCode, stderr: run.exitCode === 0 ? "" : run.stderr.toString() }).toEqual({ exit: 0, stderr: "" })
		expect(run.stdout.toString().trim()).toMatch(/^[0-9a-f]{40}$/)
	}, 120_000)

	// The statement's own claims are untouched here: only the certificate identity can refuse it.
	test("refuses the same bundle for another signer workflow", () => {
		const run = verify(tarball, ".github/workflows/other.yml")
		expect(run.exitCode).not.toBe(0)
		expect(run.stderr.toString()).toMatch(/verifying/i)
	}, 120_000)

	// A changed gzip OS byte keeps the tarball readable, so only the digest check can refuse it.
	test("refuses bytes the bundle does not name", () => {
		const other = join(dir, "other.tgz")
		copyFileSync(tarball, other)
		const bytes = readFileSync(other)
		bytes[9] = (bytes[9] ?? 0) ^ 1
		writeFileSync(other, bytes)
		const run = verify(other, PROBE.workflow)
		expect(run.exitCode).not.toBe(0)
		expect(run.stderr.toString()).toMatch(/verifying/i)
	}, 120_000)
})
