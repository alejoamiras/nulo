/**
 * The npm publish workflow's security shape. Each assertion is a control the trusted-publisher setup
 * relies on: loosening one should fail here, not surface as a compromised package.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FIRST_VERSION } from "../publish/check-digests"

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

describe(FILE, () => {
	test("runs only when dispatched, with a read-only default token", () => {
		expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"])
		expect(wf.permissions).toEqual({ contents: "read" })
	})

	test("only the publish job can mint an OIDC token, and only behind the npm-publish environment", () => {
		expect(Object.keys(wf.jobs).sort()).toEqual(["build", "publish"])
		expect(wf.jobs.build.permissions).toBeUndefined()
		expect(wf.jobs.publish.permissions).toEqual({ contents: "read", "id-token": "write" })
		expect(wf.jobs.publish.environment).toBe("npm-publish")
		expect(wf.jobs.publish.needs).toBe("build")
		expect(wf.jobs.publish.if).toContain("!inputs.dry_run")
	})

	test("no secret is read and no token is written anywhere", () => {
		expect(text).not.toMatch(/secrets\./)
		expect(text).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/)
		for (const job of ["build", "publish"]) {
			for (const step of steps(job).filter((s) => s.uses?.startsWith("actions/setup-node@"))) {
				expect(step.with).not.toHaveProperty("registry-url")
			}
		}
	})

	test("every action is pinned to a commit and no checkout keeps its credentials", () => {
		for (const job of ["build", "publish"]) {
			for (const step of steps(job).filter((s) => s.uses !== undefined)) {
				if (step.uses.startsWith("./")) continue
				expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
				if (step.uses.startsWith("actions/checkout@")) expect(step.with["persist-credentials"]).toBe(false)
			}
		}
	})

	test("publish runs no repository code: a one-file sparse checkout, then only shell over the artifact", () => {
		const checkout = steps("publish").find((s) => s.uses?.startsWith("actions/checkout@"))
		expect(checkout.with["sparse-checkout"].trim()).toBe("/scripts/publish/approved-digests.json")
		expect(steps("publish").filter((s) => s.uses?.startsWith("./"))).toEqual([])
		expect(runs("publish")).not.toMatch(/\bbun\b|\bnode\s|npx/)
	})

	test("both jobs use the same exact Node, which fixes the npm and zlib that produce the approved bytes", () => {
		const nodes = ["build", "publish"].map(
			(job) => steps(job).find((s) => s.uses?.startsWith("actions/setup-node@"))?.with["node-version"],
		)
		expect(nodes[0]).toMatch(/^\d+\.\d+\.\d+$/)
		expect(nodes[1]).toBe(nodes[0])
	})

	test("publication is attested and the first version stays bound to approved bytes in both jobs", () => {
		expect(runs("build")).toContain("bun scripts/publish/check-digests.ts")
		expect(runs("publish")).toContain(`"$VERSION" = "${FIRST_VERSION}"`)
		expect(runs("publish")).toMatch(/npm publish "\$tgz" --provenance --access public --ignore-scripts/)
	})
})
