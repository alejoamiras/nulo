import { describe, expect, test } from "bun:test"
import { type LockIO, runLockVersion } from "./lock-version-run"

const PR = JSON.stringify({ headBranchName: "release-please--branches--main", baseBranchName: "main", number: 7 })
const lock = (version: string) =>
	`{\n  "workspaces": {\n    "apps/extension": {\n      "name": "@nulo/extension",\n      "version": "${version}",\n    },\n  },\n}\n`

function harness(packageVersion: string, lockVersion: string) {
	const calls: string[] = []
	const writes: { path: string; branch: string; text: string; replacing: string; message: string }[] = []
	const files: Record<string, string> = {
		"apps/extension/package.json": JSON.stringify({ name: "@nulo/extension", version: packageVersion }),
		"bun.lock": lock(lockVersion),
	}
	const io: LockIO = {
		async head(branch) {
			calls.push(`head ${branch}`)
			return "c0ffee"
		},
		async read(path, commit) {
			calls.push(`read ${path}@${commit}`)
			return { text: files[path] ?? "", sha: `sha-of-${path}` }
		},
		async write(path, branch, text, replacing, message) {
			writes.push({ path, branch, text, replacing, message })
		},
		log: () => {},
	}
	return { io, calls, writes }
}

describe("runLockVersion", () => {
	test("reads both files from the branch head and writes the PR's version over the lockfile's blob", async () => {
		const h = harness("0.31.0", "0.30.0")
		expect(await runLockVersion(PR, h.io)).toBe(0)
		expect(h.calls).toEqual(["head release-please--branches--main", "read apps/extension/package.json@c0ffee", "read bun.lock@c0ffee"])
		expect(h.writes).toEqual([
			{
				path: "bun.lock",
				branch: "release-please--branches--main",
				text: lock("0.31.0"),
				replacing: "sha-of-bun.lock",
				message: "chore: record 0.31.0 in bun.lock",
			},
		])
	})

	test("writes nothing when the lockfile is already in step", async () => {
		const h = harness("0.31.0", "0.31.0")
		expect(await runLockVersion(PR, h.io)).toBe(0)
		expect(h.writes).toEqual([])
	})

	test("fails without touching GitHub for a branch release-please did not name, and without writing for a bad version", async () => {
		const stranger = harness("0.31.0", "0.30.0")
		expect(await runLockVersion(JSON.stringify({ headBranchName: "main" }), stranger.io)).toBe(1)
		expect(stranger.calls).toEqual([])
		const garbled = harness("next", "0.30.0")
		expect(await runLockVersion(PR, garbled.io)).toBe(1)
		expect(garbled.writes).toEqual([])
	})
})
