import { describe, expect, test } from "vitest"
import { LEGAL_MANIFEST, type LegalAcceptanceRecord } from "@nulo/legal"
import { legalAboutRow } from "./legal-about"

const TERMS = LEGAL_MANIFEST.terms.at(-1)?.version as string
const PRIVACY = LEGAL_MANIFEST.privacy.at(-1)?.version as string
const record = (over: Partial<LegalAcceptanceRecord> = {}): LegalAcceptanceRecord => ({
	termsVersion: TERMS,
	privacyVersionShown: PRIVACY,
	acceptedAt: Date.UTC(2027, 2, 14, 19, 4),
	surface: "onboarding",
	history: [],
	...over,
})

describe("legalAboutRow", () => {
	test("accepted: names the Terms version and when, and never claims the policy was accepted", () => {
		const row = legalAboutRow("current", record(), "en-GB")
		expect(row).toMatchObject({ accepted: true, title: "You accepted the Terms", privacyUpdated: false })
		expect(row.description).toContain(`Terms v${TERMS} · 14 Mar 2027`)
		expect(`${row.title} ${row.description}`).not.toMatch(/privacy/i)
	})

	test.each(["missing", "stale"] as const)("%s reads as not accepted, with the version that is waiting", (status) => {
		expect(legalAboutRow(status, status === "stale" ? record({ termsVersion: "0.9" }) : null)).toMatchObject({
			accepted: false,
			title: "Not accepted",
			description: `Terms v${TERMS}. Review`,
		})
	})

	test("a current status with no readable record is not shown as accepted", () => {
		expect(legalAboutRow("current", null).accepted).toBe(false)
	})

	test("loading claims nothing either way", () => {
		expect(legalAboutRow("loading", null)).toMatchObject({ accepted: false, description: "" })
	})

	test("a policy newer than the one last shown is flagged, without touching acceptance", () => {
		const row = legalAboutRow("current", record({ privacyVersionShown: "0.9" }))
		expect(row).toMatchObject({ accepted: true, privacyUpdated: true })
	})

	test("a privacy patch is flagged too, though a patch never asks for the Terms again", () => {
		const patched = {
			...LEGAL_MANIFEST,
			privacy: [...LEGAL_MANIFEST.privacy, { version: `${PRIVACY}.1`, effective: null, material: false, changes: ["Typo."] }],
		}
		expect(legalAboutRow("current", record(), undefined, patched)).toMatchObject({ accepted: true, privacyUpdated: true })
		expect(legalAboutRow("current", record({ privacyVersionShown: `${PRIVACY}.1` }), undefined, patched).privacyUpdated).toBe(false)
	})

	test("no em dash in any variant", () => {
		for (const row of [legalAboutRow("current", record()), legalAboutRow("missing", null)]) {
			expect(`${row.title}${row.description}`).not.toContain("—")
		}
	})
})
