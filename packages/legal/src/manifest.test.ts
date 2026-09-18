import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { parseDocumentHeader, parseVersionHistory } from "./document"
import { CONSENT_LABEL, CONTINUE_LABEL, LEGAL_MANIFEST, type LegalDocument, RISK_POINTS } from "./manifest"
import { parseVersion } from "./status"

const legalDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../legal")
const read = (doc: LegalDocument) => readFileSync(resolve(legalDir, `${doc}.md`), "utf8")
const DOCS: LegalDocument[] = ["terms", "privacy"]

describe.each(DOCS)("%s manifest", (doc) => {
	const versions = LEGAL_MANIFEST[doc]

	test("versions are well-formed and strictly increasing", () => {
		const keys = versions.map((entry) => {
			const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(entry.version)
			expect(match, entry.version).not.toBeNull()
			return [Number(match?.[1]), Number(match?.[2]), Number(match?.[3] ?? 0)]
		})
		for (let i = 1; i < keys.length; i++) {
			const [prev, next] = [keys[i - 1] ?? [], keys[i] ?? []]
			const order = (next[0] ?? 0) - (prev[0] ?? 0) || (next[1] ?? 0) - (prev[1] ?? 0) || (next[2] ?? 0) - (prev[2] ?? 0)
			expect(order, `${versions[i]?.version} must follow ${versions[i - 1]?.version}`).toBeGreaterThan(0)
		}
	})

	test("a material version bumps minor or major, so major.minor comparison cannot swallow it", () => {
		versions.forEach((entry, index) => {
			if (!entry.material || index === 0) return
			const [prev, next] = [parseVersion(versions[index - 1]?.version), parseVersion(entry.version)]
			expect(prev && next && (next[0] > prev[0] || next[1] > prev[1]), entry.version).toBe(true)
		})
	})

	test("the first version is material and every material version says what changed", () => {
		expect(versions[0]?.material).toBe(true)
		for (const entry of versions) if (entry.material) expect(entry.changes.length, entry.version).toBeGreaterThan(0)
	})

	test("the head matches the document's version line, placeholder included", () => {
		const header = parseDocumentHeader(read(doc))
		const head = versions[versions.length - 1]
		expect(header.version).toBe(head?.version)
		expect(header.effective).toBe(head?.effective ?? null)
	})

	test("the document's version history lists exactly the manifest versions", () => {
		expect([...parseVersionHistory(read(doc))].sort()).toEqual(versions.map((entry) => entry.version).sort())
	})

	test("every superseded version has an archived copy whose own header agrees", () => {
		for (const entry of versions.slice(0, -1)) {
			const file = resolve(legalDir, "archive", `${doc}-${entry.version}.md`)
			expect(existsSync(file), entry.version).toBe(true)
			expect(parseDocumentHeader(readFileSync(file, "utf8"))).toEqual({ version: entry.version, effective: entry.effective })
		}
	})
})

describe("copy the documents and the owner fixed", () => {
	test("the control labels appear verbatim in Terms § 3", () => {
		const terms = read("terms")
		expect(terms).toContain(`"${CONSENT_LABEL}"`)
		expect(terms).toContain(`selecting ${CONTINUE_LABEL}`)
	})

	test("four risk points, none with an em dash", () => {
		expect(RISK_POINTS).toHaveLength(4)
		for (const point of RISK_POINTS) expect(`${point.lead}${point.body}`).not.toMatch(/[—–]/)
	})
})
