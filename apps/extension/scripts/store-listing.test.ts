import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import manifest from "../manifest/manifest.config"
import firefoxManifest from "../manifest/manifest.firefox.config"
import packageJson from "../package.json"

const ROOT = resolve(__dirname, "..")
const REPO = resolve(ROOT, "../..")
const listing = readFileSync(resolve(ROOT, "store/listing.md"), "utf8")
const remoteCode = readFileSync(resolve(ROOT, "store/remote-code.md"), "utf8")
const privacy = readFileSync(resolve(REPO, "legal/privacy.md"), "utf8")

const headings = [...listing.matchAll(/^#### (.+)$/gm)].map((m) => m[1])
const hasHeading = (needle: string) => headings.some((h) => h.includes(`\`${needle}\``))

type Manifest = { permissions: string[]; host_permissions: string[]; content_scripts: { matches: string[] }[] }
const chrome = manifest as unknown as Manifest
const firefox = (firefoxManifest as unknown as (env: { command: string; mode: string }) => Manifest)({
	command: "build",
	mode: "production",
})

const section = (doc: string, from: string, to: string) => doc.slice(doc.indexOf(from), doc.indexOf(to))
const tableCell = (line: string) => line.split("|")[1]?.trim() ?? ""
const tableValue = (name: string) => {
	const row = listing.split("\n").find((l) => l.startsWith(`| ${name} |`))
	return row?.split("|")[2]?.trim()
}

describe("store listing", () => {
	test("every permission and host permission of both builds has a justification heading", () => {
		for (const m of [chrome, firefox]) {
			for (const p of [...m.permissions, ...m.host_permissions]) expect(hasHeading(p), p).toBe(true)
			for (const cs of m.content_scripts) for (const pattern of cs.matches) expect(hasHeading(pattern), pattern).toBe(true)
		}
	})

	// The policy's permission table and the listing must name the same surface: a permission added
	// to one and not the other is a false public statement somewhere.
	test("every permission row of the privacy policy § 6 has a counterpart", () => {
		const rows = section(privacy, "## 6. Browser permissions", "## 7.")
			.split("\n")
			.filter((l) => l.startsWith("| ") && !l.startsWith("| Permission") && !l.startsWith("|---"))
		expect(rows.length).toBeGreaterThan(5)
		for (const row of rows) {
			const cell = tableCell(row)
			const tokens = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1])
			if (tokens.length > 0) for (const t of tokens) expect(hasHeading(t) || headings.some((h) => h.includes(t)), cell).toBe(true)
			else
				expect(
					headings.some((h) => h.startsWith(cell)),
					cell,
				).toBe(true)
		}
	})

	test("Chrome title and summary are the manifest's name and description, within the store caps", () => {
		expect(tableValue("Title")).toBe(packageJson.displayName)
		expect((tableValue("Title") as string).length).toBeLessThanOrEqual(75)
		expect(tableValue("Summary")).toBe(packageJson.description)
		expect(packageJson.description.length).toBeLessThanOrEqual(132)
		expect(listing).toContain("| Privacy policy URL | https://nulo.sh/privacy |")
	})

	test("Firefox name and summary fit AMO's caps, with no URL in the summary", () => {
		const firefoxPart = listing.slice(listing.indexOf("## Firefox Add-ons"))
		const name = firefoxPart
			.split("\n")
			.find((l) => l.startsWith("| Name |"))
			?.split("|")[2]
			?.trim() as string
		const summary = firefoxPart
			.split("\n")
			.find((l) => l.startsWith("| Summary |"))
			?.split("|")[2]
			?.trim() as string
		expect(name.length).toBeLessThanOrEqual(50)
		expect(summary.length).toBeLessThanOrEqual(250)
		expect(summary).not.toMatch(/https?:\/\/|www\./)
	})

	test("the Firefox data-collection declaration in the listing equals the manifest's", () => {
		const declared = listing
			.match(/### Data collection declaration[\s\S]*?```\n([\s\S]*?)```/)?.[1]
			.trim()
			.split("\n")
		const built = (
			firefox as unknown as { browser_specific_settings: { gecko: { data_collection_permissions: { required: string[] } } } }
		).browser_specific_settings.gecko.data_collection_permissions.required
		expect(declared).toEqual(built)
	})

	test("the reviewer-notes block exists, is non-empty and sits between the two markers", () => {
		const start = listing.indexOf("<!-- reviewer-notes:start -->")
		const end = listing.indexOf("<!-- reviewer-notes:end -->")
		expect(start).toBeGreaterThan(0)
		expect(end).toBeGreaterThan(start)
		expect(listing.slice(start + "<!-- reviewer-notes:start -->".length, end).trim().length).toBeGreaterThan(200)
	})
})

// `@aztec/<pkg>/src/...` citations point into the installed package; under the isolated linker the
// only stable location is the store's `<pkg>@<version>` directory, so any installed version counts.
function resolveCited(path: string): string | null {
	if (path.startsWith("@aztec/")) {
		const [, pkg, ...rest] = path.split("/")
		const store = resolve(REPO, "node_modules/.bun")
		const dir = readdirSync(store).find((d) => d.startsWith(`@aztec+${pkg}@`))
		return dir ? join(store, dir, "node_modules/@aztec", pkg, ...rest) : null
	}
	const candidates = [resolve(REPO, path), resolve(ROOT, path), resolve(ROOT, "src", path)]
	return candidates.find((c) => existsSync(c)) ?? null
}

describe("remote-code note", () => {
	const citations = [...remoteCode.matchAll(/`([\w@./-]+\.[a-z]+):(\d+)(?:-(\d+))?`/g)].map((m) => ({
		path: m[1],
		from: Number(m[2]),
		to: Number(m[3] ?? m[2]),
	}))

	test("cites at least the artifact, VM, oracle and confirmation sites", () => {
		expect(citations.length).toBeGreaterThanOrEqual(10)
	})

	test("every path:line citation resolves to an existing file with that many lines", () => {
		for (const { path, from, to } of citations) {
			const file = resolveCited(path)
			expect(file, path).not.toBeNull()
			const lines = readFileSync(file as string, "utf8").split("\n").length
			expect(from, path).toBeLessThanOrEqual(to)
			expect(to, `${path}:${to}`).toBeLessThanOrEqual(lines)
		}
	})
})
