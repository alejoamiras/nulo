import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { LegalDocument, LegalVersion } from "@nulo/legal"
import { describe, expect, test } from "vitest"
import { legalPagePaths, planLegalPages, renderLegalPage } from "./legal-pages"

const v = (version: string, effective: string | null = null): LegalVersion => ({ version, effective, material: true, changes: ["x"] })
const manifest: Record<LegalDocument, readonly LegalVersion[]> = { terms: [v("1.0", "1 January 2027"), v("1.1")], privacy: [v("1.0")] }
const md = (version: string, body = "Body.", effective = "1 January 2027") =>
	`# Terms of Use\n\n**Version ${version} — effective ${effective}**\n\n## 1. Who we are\n\n${body}\n\n| A | B |\n|---|---|\n| 1 | 2 |\n`
const render = (body?: string, effective?: string) =>
	renderLegalPage({ doc: "terms", version: "1.1", markdown: md("1.1", body, effective) }, { permalink: false, manifest })

describe("renderLegalPage", () => {
	test("headings get stable ids and tables survive", () => {
		const html = render()
		expect(html).toContain('<h2 id="1-who-we-are">')
		expect(html).toContain("<table>")
	})

	test("links between the documents point at site paths, anchors kept", () => {
		const html = render("See the [policy](privacy.md) and [§ 3](terms.md#3-eligibility).")
		expect(html).toContain('href="/privacy"')
		expect(html).toContain('href="/terms#3-eligibility"')
		expect(html).not.toMatch(/href="[^"]*\.md/)
	})

	test("any other relative link fails the build instead of shipping a 404", () => {
		expect(() => render("[security](../SECURITY.md)")).toThrow(/unsupported link target/)
	})

	test("raw HTML in the source is rejected, inline code is not", () => {
		expect(() => render("<script>alert(1)</script>")).toThrow(/raw HTML/)
		expect(() => render("<img src=x onerror=alert(1)>")).toThrow(/raw HTML/)
		expect(render("Uses `<Flex>` internally.")).toContain("&lt;Flex&gt;")
	})

	test("a document whose version line disagrees with the manifest entry is rejected", () => {
		expect(() => renderLegalPage({ doc: "terms", version: "1.1", markdown: md("1.0") }, { permalink: false, manifest })).toThrow(
			/says version 1.0/,
		)
	})

	test("placeholders make the page a draft: banner, noindex, marked fills", () => {
		const html = render("Contact «FILL: provider».", "«FILL: effective date»")
		expect(html).toContain('data-legal-banner="draft"')
		expect(html).toContain('content="noindex"')
		expect(html).toContain('<mark class="legal-fill">«FILL: provider»</mark>')
	})

	test("a final canonical page is indexable and carries no banner", () => {
		const html = render()
		expect(html).not.toContain("data-legal-banner")
		expect(html).not.toContain("noindex")
		expect(html).toContain('<link rel="canonical" href="https://nulo.sh/terms" />')
	})

	test("a superseded permalink says so, links forward, and stays out of the index", () => {
		const html = renderLegalPage({ doc: "terms", version: "1.0", markdown: md("1.0") }, { permalink: true, manifest })
		expect(html).toContain('data-legal-banner="superseded"')
		expect(html).toContain("noindex")
		expect(html).toContain('<link rel="canonical" href="https://nulo.sh/terms" />')
	})

	test("lists every version, a missing effective date reading as not yet effective", () => {
		const html = render()
		expect(html).toContain('href="/terms/v1.0/"')
		expect(html).toContain('href="/terms/v1.1/"')
		expect(html).toContain("not yet effective")
	})

	test("ships exactly one script, external, as the CSP requires", () => {
		const scripts = render().match(/<script[^>]*>/g) ?? []
		expect(scripts).toEqual(['<script type="module" src="/src/legal.ts">'])
	})
})

describe("planLegalPages", () => {
	const sources = [
		{ doc: "terms" as const, version: "1.0", markdown: md("1.0") },
		{ doc: "terms" as const, version: "1.1", markdown: md("1.1") },
		{ doc: "privacy" as const, version: "1.0", markdown: md("1.0") },
	]

	test("one canonical page per document plus a permalink per version", () => {
		const paths = planLegalPages(sources, manifest).map((page) => page.path)
		expect([...paths].sort()).toEqual([...legalPagePaths(manifest)].sort())
		expect(paths).toContain("terms/v1.0/index.html")
		expect(paths).toContain("terms.html")
	})

	test("a manifest version without a source is an error", () => {
		expect(() => planLegalPages(sources.slice(1), manifest)).toThrow(/terms v1.0: no markdown source/)
	})
})

describe("the real documents", () => {
	const legalDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../legal")

	test.each(["terms", "privacy"] as const)("%s.md renders against the shipped manifest", (doc) => {
		const markdown = readFileSync(resolve(legalDir, `${doc}.md`), "utf8")
		const version = /\*\*Version (\S+) /.exec(markdown)?.[1] ?? ""
		const html = renderLegalPage({ doc, version, markdown }, { permalink: false })
		expect(html).not.toMatch(/href="[^"]*\.md/)
		expect(html.match(/<script/g)).toHaveLength(1)
	})
})
