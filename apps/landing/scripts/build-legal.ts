#!/usr/bin/env bun
/**
 * Writes the legal pages the manifest implies into the landing root, where Vite picks them up as
 * HTML entries. The markdown under `legal/` stays the only source; these files are gitignored.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { LEGAL_MANIFEST } from "@nulo/legal"
import { LEGAL_DOCUMENTS, type LegalSource, planLegalPages } from "./legal-pages"

const here = dirname(fileURLToPath(import.meta.url))
const landingRoot = resolve(here, "..")
const legalDir = resolve(here, "../../../legal")

const sources: LegalSource[] = LEGAL_DOCUMENTS.flatMap((doc) => {
	const versions = LEGAL_MANIFEST[doc]
	return versions.map((entry, index) => {
		const isHead = index === versions.length - 1
		const file = isHead ? resolve(legalDir, `${doc}.md`) : resolve(legalDir, "archive", `${doc}-${entry.version}.md`)
		return { doc, version: entry.version, markdown: readFileSync(file, "utf8") }
	})
})

const pages = planLegalPages(sources)
for (const page of pages) {
	const target = resolve(landingRoot, page.path)
	mkdirSync(dirname(target), { recursive: true })
	writeFileSync(target, page.html)
}
writeFileSync(
	resolve(landingRoot, "src/generated/legal-pages.json"),
	`${JSON.stringify(
		pages.map((page) => page.path),
		null,
		2,
	)}\n`,
)
console.log(`[build-legal] wrote ${sources.length} document version(s)`)
