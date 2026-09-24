/**
 * The npm publish workflow's security shape. Each assertion is a control the trusted-publisher setup
 * relies on: loosening one should fail here, not surface as a compromised package.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FIRST_VERSION, VERSION_RE } from "../publish/check-digests"
import { PACKAGES } from "../publish/packages"

const ROOT = join(import.meta.dir, "../..")
const FILE = ".github/workflows/publish-packages.yml"
const text = readFileSync(join(ROOT, FILE), "utf8")
// biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
const wf = Bun.YAML.parse(text) as any
// biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
const steps = (job: string): any[] => wf.jobs[job].steps
const runs = (job: string) =>
	steps(job)
		.map((s) => s.run ?? "")
		.join("\n")
const JOBS = ["pack", "publish", "test", "verify"]

describe(FILE, () => {
	test("runs only when dispatched, with a read-only default token", () => {
		expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"])
		expect(wf.permissions).toEqual({ contents: "read" })
	})

	test("only the publish job can mint an OIDC token, and only behind the npm-publish environment after test and pack", () => {
		expect(Object.keys(wf.jobs).sort()).toEqual(JOBS)
		for (const job of ["pack", "test", "verify"]) expect(wf.jobs[job].permissions).toBeUndefined()
		expect(wf.jobs.publish.permissions).toEqual({ contents: "read", "id-token": "write" })
		expect(wf.jobs.publish.environment).toBe("npm-publish")
		expect([...wf.jobs.publish.needs].sort()).toEqual(["pack", "test"])
		expect([...wf.jobs.verify.needs].sort()).toEqual(["pack", "publish"])
		for (const job of ["publish", "verify"]) expect(wf.jobs[job].if).toContain("!inputs.dry_run")
	})

	test("no secret is read and no token is written anywhere", () => {
		expect(text).not.toMatch(/secrets\./)
		expect(text).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/)
		for (const job of JOBS) {
			for (const step of steps(job).filter((s) => s.uses?.startsWith("actions/setup-node@"))) {
				expect(step.with).not.toHaveProperty("registry-url")
			}
		}
	})

	test("every action is pinned to a commit, no checkout keeps its credentials, no setup-node caches", () => {
		const actions = JOBS.flatMap(steps).filter((s) => s.uses !== undefined && !s.uses.startsWith("./"))
		for (const step of actions) expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
		for (const step of actions.filter((s) => s.uses.startsWith("actions/checkout@"))) {
			expect(step.with["persist-credentials"]).toBe(false)
		}
		for (const step of actions.filter((s) => s.uses.startsWith("actions/setup-node@"))) {
			expect(step.with["package-manager-cache"]).toBe(false)
		}
	})

	test("pack makes the bytes from no shared cache and runs no test code or lifecycle script", () => {
		const uses = steps("pack").map((s) => s.uses ?? "")
		expect(uses.filter((u) => u.startsWith("./") || u.startsWith("actions/cache"))).toEqual([])
		expect(steps("pack").find((s) => s.uses?.startsWith("oven-sh/setup-bun@"))?.with["no-cache"]).toBe(true)
		const install = steps("pack").find((s) => /\bbun install\b/.test(s.run ?? ""))
		expect(install.run.trim()).toBe("bun install --frozen-lockfile --ignore-scripts")
		expect(install.env.BUN_INSTALL_CACHE_DIR).toMatch(/^\$\{\{ runner\.temp \}\}\//)
		expect(runs("pack")).not.toMatch(/\btest\b|test:/)
		expect(runs("test")).toContain("bun run test:release")
	})

	test("pack packs every staged package, and publish accepts exactly the PACKAGES names", () => {
		expect(runs("pack")).toContain("bun scripts/publish/stage.ts --all")
		expect(runs("pack")).toContain("for dir in dist-publish/*/; do")
		const expected = steps("publish").find((s) => s.env?.EXPECTED)?.env.EXPECTED
		expect(expected).toBe(
			PACKAGES.map((p) => p.name)
				.sort()
				.join(" "),
		)
	})

	test("publish runs no repository code: a one-file sparse checkout, then only shell over the artifact", () => {
		const checkout = steps("publish").find((s) => s.uses?.startsWith("actions/checkout@"))
		expect(checkout.with["sparse-checkout"].trim()).toBe("/scripts/publish/approved-digests.json")
		for (const job of ["publish", "verify"]) {
			expect(steps(job).filter((s) => s.uses?.startsWith("./"))).toEqual([])
			expect(runs(job)).not.toMatch(/\bbun\b|\bnode\s|npx/)
		}
		expect(steps("verify").filter((s) => s.uses?.startsWith("actions/checkout@"))).toEqual([])
	})

	test("every job uses the same exact Node, which fixes the npm and zlib that produce the approved bytes", () => {
		const nodes = JOBS.map((job) => steps(job).find((s) => s.uses?.startsWith("actions/setup-node@"))?.with["node-version"])
		expect(nodes[0]).toMatch(/^\d+\.\d+\.\d+$/)
		expect(new Set(nodes).size).toBe(1)
	})

	test("the version check accepts exactly what scripts/publish accepts", () => {
		const shell = /\[\[ "\$VERSION" =~ (\S+) \]\]/.exec(runs("pack"))?.[1] ?? ""
		const workflowRe = new RegExp(shell)
		for (const spelling of ["0.1.0", "1.20.3", "00.1.0", "0.01.0", "0.1.00", "v0.1.0", "0.1.0-rc.1", "0.1", "0.1.0.0"]) {
			expect({ spelling, workflow: workflowRe.test(spelling) }).toEqual({ spelling, workflow: VERSION_RE.test(spelling) })
		}
	})

	test("the first version stays bound to approved bytes, and no other version can become the first", () => {
		expect(runs("pack")).toContain("bun scripts/publish/check-digests.ts")
		expect(runs("publish")).toContain(`"$VERSION" = "${FIRST_VERSION}"`)
		expect(runs("publish")).toContain(`if [ "$VERSION" != "${FIRST_VERSION}" ]; then`)
		expect(runs("publish")).toContain(`npm view "$name@${FIRST_VERSION}" version`)
		expect(runs("publish")).toMatch(/npm publish "\$tgz" --provenance --access public --ignore-scripts/)
	})

	test("verify requires provenance naming the bytes, this repository, this file and dev or main", () => {
		const verify = runs("verify")
		expect(verify).toContain(".subject == [{ name: $purl, digest: { sha512: $digest } }]")
		expect(verify).toContain('workflow.repository == "https://github.com/alejoamiras/nulo"')
		expect(verify).toContain(`workflow.path == "${FILE}"`)
		expect(verify).toContain('workflow.ref | IN("refs/heads/dev", "refs/heads/main")')
		expect(verify).toContain("npm audit signatures")
	})
})
