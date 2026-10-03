import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { lockWithVersion, packageVersion, releaseBranch } from "./lock-version"

const lock = (version: string) => `{
  "lockfileVersion": 2,
  "workspaces": {
    "": {
      "name": "nulo",
    },
    "apps/extension": {
      "name": "@nulo/extension",
      "version": "${version}",
      "dependencies": {
        "zod": "^4.0.0",
      },
    },
  },
}
`

describe("lockWithVersion", () => {
	test("on the repository's own bun.lock, changes exactly the extension's version line", () => {
		const real = readFileSync(join(import.meta.dir, "../../bun.lock"), "utf8")
		const next = lockWithVersion(real, "9.9.9-rc.1")
		if (!next.ok || next.value === null) throw new Error(`expected an edit, got ${JSON.stringify(next)}`)
		const before = real.split("\n")
		const changed = next.value.split("\n").flatMap((line, i) => (line === before[i] ? [] : [[before[i], line]]))
		expect(changed).toEqual([[expect.stringMatching(/^ {6}"version": "[^"]+",$/), '      "version": "9.9.9-rc.1",']])
	})

	test("returns null when the lockfile already records the version", () => {
		expect(lockWithVersion(lock("0.31.0"), "0.31.0")).toEqual({ ok: true, value: null })
	})

	test("refuses a version that is not a release version, and a lockfile it cannot place the edit in", () => {
		expect(lockWithVersion(lock("0.30.0"), '0.31.0", "x": "y').ok).toBe(false)
		expect(
			lockWithVersion(
				lock("0.30.0").replace(
					'"name": "@nulo/extension",\n      "version": "0.30.0",',
					'"version": "0.30.0",\n      "name": "@nulo/extension",',
				),
				"0.31.0",
			).ok,
		).toBe(false)
		expect(lockWithVersion(lock("0.30.0").replaceAll("apps/extension", "apps/other"), "0.31.0").ok).toBe(false)
		expect(lockWithVersion("not a lockfile", "0.31.0").ok).toBe(false)
	})
})

describe("releaseBranch and packageVersion", () => {
	test("take release-please's branch and a release version, and refuse anything else", () => {
		expect(releaseBranch('{"headBranchName":"release-please--branches--main","number":1}')).toEqual({
			ok: true,
			value: "release-please--branches--main",
		})
		for (const pr of ['{"headBranchName":"main"}', '{"headBranchName":"dev"}', "{}", "null", ""])
			expect(releaseBranch(pr).ok).toBe(false)
		expect(packageVersion('{"name":"@nulo/extension","version":"0.31.0-rc.1"}')).toEqual({ ok: true, value: "0.31.0-rc.1" })
		for (const pkg of ['{"version":"latest"}', "{}", "[]", "nope"]) expect(packageVersion(pkg).ok).toBe(false)
	})
})
