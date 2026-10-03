import { describe, expect, test } from "bun:test"
import { ATTEMPTS, type LockIO, runLockVersion } from "./lock-version-run"

const BRANCH = "release-please--branches--main"
const PR = JSON.stringify({ headBranchName: BRANCH, baseBranchName: "main", number: 7 })
const lock = (version: string) =>
	`{\n  "workspaces": {\n    "apps/extension": {\n      "name": "@nulo/extension",\n      "version": "${version}",\n    },\n  },\n}\n`
const pkg = (version: string) => JSON.stringify({ name: "@nulo/extension", version })

/** The branch at successive heads: each commit attempt moves it on, and a commit lands only on the newest. */
function harness(heads: { packageVersion: string; lockVersion: string }[]) {
	const calls: string[] = []
	const commits: { expectedHead: string; text: string; message: string }[] = []
	let attempts = 0
	const io: LockIO = {
		async head(branch) {
			calls.push(`head ${branch}`)
			return `h${Math.min(attempts, heads.length - 1)}`
		},
		async read(path, commit) {
			calls.push(`read ${path}@${commit}`)
			const at = heads[Number(commit.slice(1))]
			if (!at) throw new Error(`no head ${commit}`)
			return path === "bun.lock" ? lock(at.lockVersion) : pkg(at.packageVersion)
		},
		async commit(_branch, expectedHead, _path, text, message) {
			attempts++
			if (expectedHead !== `h${heads.length - 1}`) return false
			commits.push({ expectedHead, text, message })
			return true
		},
		log: () => {},
	}
	return { io, calls, commits }
}

describe("runLockVersion", () => {
	test("reads both files at the branch head and commits the PR's version onto that head", async () => {
		const h = harness([{ packageVersion: "0.31.0", lockVersion: "0.30.0" }])
		expect(await runLockVersion(PR, h.io)).toBe(0)
		expect(h.calls).toEqual([`head ${BRANCH}`, "read apps/extension/package.json@h0", "read bun.lock@h0"])
		expect(h.commits).toEqual([{ expectedHead: "h0", text: lock("0.31.0"), message: "chore: record 0.31.0 in bun.lock" }])
	})

	test("when the version moves under the write while bun.lock stays, it rereads and writes the new version", async () => {
		const h = harness([
			{ packageVersion: "0.31.0", lockVersion: "0.30.0" },
			{ packageVersion: "0.32.0", lockVersion: "0.30.0" },
		])
		expect(await runLockVersion(PR, h.io)).toBe(0)
		expect(h.commits).toEqual([{ expectedHead: "h1", text: lock("0.32.0"), message: "chore: record 0.32.0 in bun.lock" }])
	})

	test("writes nothing when bun.lock is in step, and gives up on a branch that never holds still", async () => {
		const still = harness([{ packageVersion: "0.31.0", lockVersion: "0.31.0" }])
		expect(await runLockVersion(PR, still.io)).toBe(0)
		expect(still.commits).toEqual([])
		const restless = harness([{ packageVersion: "0.31.0", lockVersion: "0.30.0" }])
		restless.io.commit = async () => false
		expect(await runLockVersion(PR, restless.io)).toBe(1)
		expect(restless.calls.filter((c) => c.startsWith("head"))).toHaveLength(ATTEMPTS)
	})

	test("fails without touching GitHub for a branch release-please did not name, and without committing for a bad version", async () => {
		const stranger = harness([{ packageVersion: "0.31.0", lockVersion: "0.30.0" }])
		expect(await runLockVersion(JSON.stringify({ headBranchName: "main" }), stranger.io)).toBe(1)
		expect(stranger.calls).toEqual([])
		const garbled = harness([{ packageVersion: "next", lockVersion: "0.30.0" }])
		expect(await runLockVersion(PR, garbled.io)).toBe(1)
		expect(garbled.commits).toEqual([])
	})
})
