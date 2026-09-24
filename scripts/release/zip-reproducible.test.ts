import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listFiles, zipReproducible } from "./zip-reproducible"

const EPOCH = 1_758_650_000

/** One private scratch root per test run, so parallel worktrees never share an archive path. */
const scratch = mkdtempSync(join(tmpdir(), "zip-repro-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
const fresh = (name: string) => mkdtempSync(join(scratch, `${name}-`))

const FILES: [string, string][] = [
	["manifest.json", '{"version":"0.28.0.0"}'],
	["assets/b.js", "console.log('b')"],
	["assets/a.js", "console.log('a')"],
	["assets/icons/16.png", "\u0089PNG"],
	["Zeta.txt", "sorts after lower-case names in code-unit order"],
]

/** The same tree written in a different order with different mtimes: what a fresh artifact download looks like. */
function tree(order: "forward" | "reverse", mtime: number) {
	const dir = fresh("tree")
	for (const [rel, body] of order === "forward" ? FILES : [...FILES].reverse()) {
		mkdirSync(join(dir, rel, ".."), { recursive: true })
		writeFileSync(join(dir, rel), body)
		utimesSync(join(dir, rel), mtime, mtime)
	}
	return dir
}

const sha256 = (path: string) => new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex")
const unzip = (...args: string[]) => Bun.spawnSync(["unzip", ...args]).stdout.toString()

describe("zip-reproducible", () => {
	test("lists regular files in code-unit order, without directories", () => {
		expect(listFiles(tree("reverse", EPOCH))).toEqual(["Zeta.txt", "assets/a.js", "assets/b.js", "assets/icons/16.png", "manifest.json"])
	})

	test("two trees with the same content, in other write orders and mtimes, zip to the same bytes", () => {
		const zipA = join(fresh("out"), "a.zip")
		const zipB = join(fresh("out"), "b.zip")
		zipReproducible(tree("forward", EPOCH - 86_400), zipA, EPOCH)
		zipReproducible(tree("reverse", EPOCH + 86_400), zipB, EPOCH)
		expect(sha256(zipA)).toBe(sha256(zipB))
		expect(unzip("-Z1", zipA).trim().split("\n")).toEqual(["Zeta.txt", "assets/a.js", "assets/b.js", "assets/icons/16.png", "manifest.json"])
	})

	test("every entry carries the epoch as its timestamp, in UTC", () => {
		const zip = join(fresh("out"), "stamped.zip")
		zipReproducible(tree("forward", EPOCH), zip, EPOCH)
		// `unzip -Z -T` prints one `-rw-…` line per entry with its stored time as `YYYYMMDD.HHMMSS`;
		// the epoch is 2025-09-23 17:53:20 UTC.
		const stamps = unzip("-Z", "-T", zip)
			.split("\n")
			.filter((l) => l.startsWith("-"))
			.map((l) => l.split(/\s+/)[6])
		expect(stamps).toHaveLength(FILES.length)
		expect(new Set(stamps)).toEqual(new Set(["20250923.175320"]))
	})

	test("the archive extracts to the source tree, byte for byte", () => {
		const src = tree("forward", EPOCH)
		const zip = join(fresh("out"), "roundtrip.zip")
		zipReproducible(src, zip, EPOCH)
		const out = fresh("extracted")
		expect(Bun.spawnSync(["unzip", "-q", zip, "-d", out]).exitCode).toBe(0)
		for (const rel of listFiles(src)) expect(readFileSync(join(out, rel))).toEqual(readFileSync(join(src, rel)))
		expect(unzip("-p", zip, "manifest.json")).toBe('{"version":"0.28.0.0"}')
	})

	test("refuses a malformed epoch, an empty tree, a symlink and a name outside printable ASCII", () => {
		const src = tree("forward", EPOCH)
		const out = join(fresh("out"), "x.zip")
		expect(() => zipReproducible(src, out, Number.NaN)).toThrow("SOURCE_DATE_EPOCH")
		expect(() => zipReproducible(src, out, 0)).toThrow("SOURCE_DATE_EPOCH")
		expect(() => zipReproducible(fresh("empty"), out, EPOCH)).toThrow("nothing to zip")
		const linked = tree("forward", EPOCH)
		symlinkSync("manifest.json", join(linked, "link.json"))
		expect(() => zipReproducible(linked, out, EPOCH)).toThrow("not a regular file")
		const odd = tree("forward", EPOCH)
		writeFileSync(join(odd, "line\nbreak.txt"), "x")
		expect(() => zipReproducible(odd, out, EPOCH)).toThrow("printable ASCII")
		// zip reads a listed `-` as stdin and stores it empty, with exit status zero.
		const dash = tree("forward", EPOCH)
		writeFileSync(join(dash, "-"), "not stdin")
		expect(() => zipReproducible(dash, out, EPOCH)).toThrow('"-"')
	})
})
