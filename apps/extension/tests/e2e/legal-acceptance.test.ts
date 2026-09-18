/**
 * The Terms acceptance, end to end against the built extension. Every launch here names the
 * acceptance state it starts from; the rest of the suite runs on the fixture's `current` default
 * and never meets the gate.
 */
import { describe, expect } from "vitest"
import { LEGAL_MANIFEST } from "@nulo/legal"
import { clickByTestId, openOnboarding, replaceInputValue, test, waitForHash } from "./fixtures/extension"
import { CANONICAL_SEED_24, importSeed, ONBOARDING_IMPORT_SHELL, readActiveAccount, TEST_PASSWORD } from "./helpers/import-drivers"
import { acceptOnboardingTerms, isContinueDisabled, readLegalRecord, waitForTermsGate } from "./helpers/legal-drivers"

const CURRENT_TERMS = LEGAL_MANIFEST.terms.at(-1)?.version
const CURRENT_PRIVACY = LEGAL_MANIFEST.privacy.at(-1)?.version

describe("onboarding: the Terms gate", () => {
	test("S1 a fresh install cannot continue unticked; ticking records the manifest version, then create works", async ({
		freshExtensionPerTest: extension,
	}) => {
		const page = await openOnboarding(extension, { legal: "missing" })
		await clickByTestId(page, "onboarding-welcome-create")
		await waitForTermsGate(page, "create")
		expect(await page.$$eval('[data-testid="legal-point"]', (rows) => rows.length)).toBe(4)
		expect(await isContinueDisabled(page)).toBe(true)
		expect(await page.$eval('[data-testid="legal-consent-checkbox"]', (el) => el.getAttribute("aria-checked"))).toBe("false")
		// A click on the disabled button must not record anything.
		await page.$eval('[data-testid="legal-continue"]', (el) => (el as HTMLButtonElement).click())
		expect(await readLegalRecord(page)).toBeUndefined()

		const before = Date.now()
		await acceptOnboardingTerms(page, "create")

		const record = await readLegalRecord(page)
		expect(record).toMatchObject({ termsVersion: CURRENT_TERMS, privacyVersionShown: CURRENT_PRIVACY, surface: "onboarding" })
		expect(record?.acceptedAt).toBeGreaterThanOrEqual(before)
		expect(record?.history).toHaveLength(1)

		await replaceInputValue(page, '[data-testid="onboarding-name-input"]', "Gate Test")
		await replaceInputValue(page, '[data-testid="onboarding-password-input"]', TEST_PASSWORD)
		await replaceInputValue(page, '[data-testid="onboarding-password-confirm"]', TEST_PASSWORD)
		await clickByTestId(page, "onboarding-submit-create")
		await waitForHash(page, "#/onboarding/learn", 30_000)

		expect(extension.pageErrors).toEqual([])
		await page.close()
	}, 90_000)

	test("S2 the gate cannot be skipped by jumping to a later step", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension, { legal: "missing" })
		for (const step of ["create", "import", "learn", "fees", "presto", "done"]) {
			await page.evaluate((hash) => {
				window.location.hash = hash
			}, `#/onboarding/${step}`)
			await waitForTermsGate(page, step === "import" ? "import" : "create")
		}
		expect(await readLegalRecord(page)).toBeUndefined()
		await page.close()
	}, 60_000)

	test("S3 the import path passes the same gate and resumes at import", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension, { legal: "missing" })
		await clickByTestId(page, "onboarding-welcome-import")
		await acceptOnboardingTerms(page, "import")
		expect(await readLegalRecord(page)).toMatchObject({ termsVersion: CURRENT_TERMS, surface: "onboarding" })

		await importSeed(page, CANONICAL_SEED_24, TEST_PASSWORD, ONBOARDING_IMPORT_SHELL)
		expect((await readActiveAccount(page)).startsWith("0x")).toBe(true)

		expect(extension.pageErrors).toEqual([])
		await page.close()
	}, 90_000)
})
