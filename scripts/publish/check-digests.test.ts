import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { checkDigests, FIRST_VERSION, VERSION_RE } from "./check-digests"

const A = "alejoamiras-nulo-wallet-crypto-0.1.0.tgz"
const B = "alejoamiras-nulo-resolve-asset-0.1.0.tgz"
const approved = { [FIRST_VERSION]: { [A]: "aa", [B]: "bb" } }

describe("checkDigests", () => {
	test("passes when the packed set equals the approved set byte for byte", () => {
		expect(
			checkDigests(FIRST_VERSION, approved, [
				{ name: B, sha256: "bb" },
				{ name: A, sha256: "aa" },
			]).ok,
		).toBe(true)
	})

	test("fails on a changed byte, a missing tarball or an extra one", () => {
		expect(
			checkDigests(FIRST_VERSION, approved, [
				{ name: A, sha256: "ab" },
				{ name: B, sha256: "bb" },
			]).failures,
		).toEqual([`${A}: sha256 ab, approved aa`])
		expect(checkDigests(FIRST_VERSION, approved, [{ name: A, sha256: "aa" }]).failures).toEqual([`${B}: approved but not packed`])
		const extra = [
			{ name: A, sha256: "aa" },
			{ name: B, sha256: "bb" },
			{ name: "x.tgz", sha256: "cc" },
		]
		expect(checkDigests(FIRST_VERSION, approved, extra).failures).toEqual(["x.tgz: packed but not approved"])
	})

	test("the first publication cannot proceed unlisted; a later one proceeds with a note", () => {
		expect(checkDigests(FIRST_VERSION, {}, [{ name: A, sha256: "aa" }]).ok).toBe(false)
		const later = checkDigests("0.2.0", approved, [{ name: A, sha256: "zz" }])
		expect(later.ok).toBe(true)
		expect(later.notes).toHaveLength(1)
	})

	test("a non-canonical spelling of a version is refused, so it cannot dodge the first-version binding", () => {
		for (const spelling of ["00.1.0", "0.01.0", "0.1.00", "v0.1.0", "0.1.0-rc.1", " 0.1.0"]) {
			expect({ spelling, ok: checkDigests(spelling, {}, []).ok }).toEqual({ spelling, ok: false })
		}
	})

	test("the committed approvals are well-formed: X.Y.Z → npm tarball name → sha256", () => {
		const committed = JSON.parse(readFileSync(join(import.meta.dir, "approved-digests.json"), "utf8")) as Record<
			string,
			Record<string, string>
		>
		for (const [version, entries] of Object.entries(committed)) {
			expect(version).toMatch(VERSION_RE)
			for (const [name, sha256] of Object.entries(entries)) {
				expect(name).toMatch(new RegExp(`^alejoamiras-nulo-[a-z-]+-${version.replaceAll(".", "\\.")}\\.tgz$`))
				expect(sha256).toMatch(/^[0-9a-f]{64}$/)
			}
		}
	})
})
