import type { Page } from "puppeteer"
import { clickByTestId, waitForHash } from "../fixtures/extension"
import { LEGAL_ACCEPTANCE_KEY } from "../fixtures/legal"

const sel = (testid: string) => `[data-testid="${testid}"]`

/** The stored acceptance record, read from any extension page. */
export async function readLegalRecord(page: Page): Promise<Record<string, unknown> | undefined> {
	return page.evaluate(
		async (key) => (await chrome.storage.local.get(key))[key] as Record<string, unknown> | undefined,
		LEGAL_ACCEPTANCE_KEY,
	)
}

export async function isContinueDisabled(page: Page): Promise<boolean> {
	return page.$eval(sel("legal-continue"), (el) => (el as HTMLButtonElement).disabled)
}

/** The gate's URL names where it resumes, so waiting for it also proves the resume target. */
export async function waitForTermsGate(page: Page, resumesAt: "create" | "import"): Promise<void> {
	await waitForHash(page, `#/onboarding/terms?next=${resumesAt}`, 10_000)
	await page.waitForSelector(sel("legal-consent-checkbox"), { visible: true, timeout: 10_000 })
}

/** Tick the consent box and continue, from the onboarding Terms page to wherever it resumes. */
export async function acceptOnboardingTerms(page: Page, resumesAt: "create" | "import"): Promise<void> {
	await waitForTermsGate(page, resumesAt)
	await clickByTestId(page, "legal-consent-checkbox")
	await page.waitForFunction(
		(s) => !(document.querySelector(s) as HTMLButtonElement | null)?.disabled,
		{ timeout: 5_000 },
		sel("legal-continue"),
	)
	await clickByTestId(page, "legal-continue")
	await waitForHash(page, `#/onboarding/${resumesAt}`, 10_000)
}
