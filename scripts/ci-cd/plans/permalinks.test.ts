import { afterAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { cleanupRepos, commitAll, findings, git, makeRepo, tempDir, writeFiles } from "./fixture-repo"
import { BASES_FILE } from "./permalinks"

afterAll(cleanupRepos)

const SHA = "9f11de70b13933be2d54c3eb79622b1ff2719aba"
const OTHER = "0123456789abcdef0123456789abcdef01234567"
const url = (rest: string) => `https://github.com/alejoamiras/nulo/${rest}`
const bases = (...shas: string[]) => ({
	[BASES_FILE]: `${JSON.stringify(Object.fromEntries(shas.map((s) => [s, "fixture"])), null, "\t")}\n`,
})

describe("permalink-shape", () => {
	test("a short SHA, a fork owner and a pathless blob fail", () => {
		const repo = makeRepo({
			...bases(SHA),
			"README.md": [
				`[short](${url("blob/9f11de70/CLAUDE.md")})`,
				`[fork](https://github.com/evil/nulo/blob/${SHA}/CLAUDE.md)`,
				`[pathless](${url(`blob/${SHA}`)})`,
			].join("\n"),
		})
		expect(findings(repo, "permalink-shape").map((f) => f.line)).toEqual([1, 2, 3])
	})

	test("a file, a line range anchor and the repository root at a full SHA pass; other repos are not candidates", () => {
		const repo = makeRepo({
			...bases(SHA),
			"README.md": `[f](${url(`blob/${SHA}/CLAUDE.md#L12`)}) [root](${url(`tree/${SHA}`)}) [other](https://github.com/AztecProtocol/aztec-packages/blob/next/README.md)\n`,
		})
		expect(findings(repo, "permalink-shape")).toEqual([])
	})
})

describe("permalink-shape: the URL a browser follows", () => {
	test("dot segments, raw or percent-encoded, and empty segments fail even behind an allowlisted SHA", () => {
		const repo = makeRepo({
			...bases(SHA),
			"README.md": [
				`[swap](${url(`blob/${SHA}/../../blob/${OTHER}/README.md`)})`,
				`[escape](${url(`blob/${SHA}/../../../../evil/x/blob/${OTHER}/README.md`)})`,
				`[dot](${url(`blob/${SHA}/./README.md`)})`,
				`[pct](${url(`blob/${SHA}/%2e%2e/README.md`)})`,
				`[empty](${url(`blob/${SHA}//README.md`)})`,
				`[tree](${url(`tree/${SHA}/..`)})`,
			].join("\n"),
		})
		expect(findings(repo, "permalink-shape").map((f) => f.line)).toEqual([1, 2, 3, 4, 5, 6])
	})

	test("protocol-relative, backslash, http, www and case variants of GitHub are candidates; only the canonical form passes", () => {
		const repo = makeRepo({
			...bases(SHA),
			"README.md": [
				`[pr](//github.com/alejoamiras/nulo/blob/${OTHER}/README.md)`,
				`<a href="/\\github.com/alejoamiras/nulo/blob/${OTHER}/README.md">bs</a>`,
				`[http](http://github.com/alejoamiras/nulo/blob/${SHA}/README.md)`,
				`[www](https://www.github.com/alejoamiras/nulo/blob/${SHA}/README.md)`,
				`[host](https://GitHub.com./alejoamiras/nulo/blob/${SHA}/README.md)`,
				`[repo](https://github.com/alejoamiras/Nulo/blob/${SHA}/README.md)`,
				`[ok](${url(`blob/${SHA}/README.md`)})`,
			].join("\n"),
		})
		expect(findings(repo, "permalink-shape").map((f) => f.line)).toEqual([1, 2, 3, 4, 5, 6])
	})

	test("bare-URL autolinks are checked like any other link", () => {
		const repo = makeRepo({
			...bases(SHA),
			"README.md": `See https://github.com/alejoamiras/nulo/blob/${OTHER}/README.md and www.github.com/alejoamiras/nulo/tree/${SHA}.\n`,
		})
		expect(findings(repo, "permalink-base").map((f) => f.detail)).toEqual([`${OTHER} is not in ${BASES_FILE}`])
		expect(findings(repo, "permalink-shape")).toHaveLength(1)
	})
})

describe("permalink-base", () => {
	test("a full SHA outside the allowlist fails; an allowlisted one passes", () => {
		const repo = makeRepo({ ...bases(SHA), "README.md": `[ok](${url(`blob/${SHA}/a.md`)})\n[no](${url(`blob/${OTHER}/a.md`)})\n` })
		expect(findings(repo, "permalink-base").map((f) => `${f.line} ${f.detail}`)).toEqual([`2 ${OTHER} is not in ${BASES_FILE}`])
	})
})

describe("permalink-ancestry (local)", () => {
	test("an entry on dev passes; an entry only on a side branch fails", () => {
		const repo = makeRepo({ "README.md": "r\n" })
		const onDev = git(repo, "rev-parse", "HEAD")
		git(repo, "switch", "-q", "-c", "side")
		writeFiles(repo, { "side.md": "s\n" })
		const onSide = commitAll(repo)
		git(repo, "switch", "-q", "dev")
		writeFiles(repo, bases(onDev, onSide))
		commitAll(repo)
		git(repo, "update-ref", "refs/remotes/origin/dev", "HEAD")
		expect(findings(repo, "permalink-ancestry").map((f) => f.detail)).toEqual([`${onSide} is not an ancestor of dev`])
	})

	test("without origin/dev locally it asks for a fetch", () => {
		const repo = makeRepo({ "README.md": "r\n" })
		writeFiles(repo, bases(git(repo, "rev-parse", "HEAD")))
		commitAll(repo)
		expect(findings(repo, "permalink-ancestry").map((f) => f.fix)).toEqual(["git fetch origin dev"])
	})
})

describe("permalink-ancestry (a shallow pull-request checkout)", () => {
	/** An origin whose `pr` branch merges a feature into an unmerged parent arc, as refs/pull/N/merge does. */
	function stackedOrigin(): { origin: string; onDev: string; onParent: string } {
		const origin = makeRepo({ "README.md": "r\n" })
		git(origin, "config", "uploadpack.allowFilter", "true")
		const onDev = git(origin, "rev-parse", "HEAD")
		writeFiles(origin, { "dev.md": "d\n" })
		commitAll(origin)
		git(origin, "switch", "-q", "-c", "parent")
		writeFiles(origin, { "parent.md": "p\n" })
		const onParent = commitAll(origin)
		git(origin, "switch", "-q", "-c", "feature")
		writeFiles(origin, bases(onDev, onParent))
		commitAll(origin)
		git(origin, "switch", "-q", "-c", "pr", "parent")
		git(origin, "merge", "-q", "--no-ff", "feature", "-m", "merge feature into parent")
		git(origin, "switch", "-q", "dev")
		return { origin, onDev, onParent }
	}

	function shallowClone(origin: string): string {
		const work = join(tempDir(), "work")
		git(tempDir(), "clone", "-q", "--depth", "1", "--branch", "pr", `file://${origin}`, work)
		return work
	}

	const PR_RUN = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request", GITHUB_BASE_REF: "parent" }

	test("the gate fetches dev by name: a dev ancestor passes, the parent arc's commit fails", () => {
		const { origin, onParent } = stackedOrigin()
		const work = shallowClone(origin)
		expect(git(work, "rev-parse", "--is-shallow-repository")).toBe("true")
		expect(findings(work, "permalink-ancestry", PR_RUN).map((f) => f.detail)).toEqual([`${onParent} is not reachable from dev here`])
	}, 30_000)

	test("an unreachable origin fails closed", () => {
		const { origin } = stackedOrigin()
		const work = shallowClone(origin)
		git(work, "remote", "set-url", "origin", `file://${origin}-gone`)
		const found = findings(work, "permalink-ancestry", PR_RUN)
		expect(found).toHaveLength(1)
		expect(found[0].detail).toStartWith("cannot fetch dev")
	}, 30_000)

	test("a pull request with an empty base ref still fetches dev, and fails closed", () => {
		const { origin } = stackedOrigin()
		const work = shallowClone(origin)
		git(work, "remote", "set-url", "origin", `file://${origin}-gone`)
		const found = findings(work, "permalink-ancestry", { ...PR_RUN, GITHUB_BASE_REF: "" })
		expect(found.map((f) => f.detail.split(":")[0])).toEqual(["cannot fetch dev"])
	}, 30_000)

	test("a push, nightly or release run never fetches and only reports, even with a base ref set", () => {
		const { origin } = stackedOrigin()
		const work = shallowClone(origin)
		git(work, "remote", "set-url", "origin", `file://${origin}-gone`)
		for (const event of ["push", "schedule", "workflow_dispatch"]) {
			const env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: event, GITHUB_BASE_REF: "dev" }
			expect(findings(work, "permalink-ancestry", env)).toEqual([])
		}
	}, 30_000)
})
