import type { Page } from "puppeteer"
import { reloadExtensionPage } from "../fixtures/browser"
import { clickByTestId, seedLegalAcceptance, waitForHash } from "../fixtures/extension"
import { LEGAL_ACCEPTANCE_KEY, type LegalSeed } from "../fixtures/legal"

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

/**
 * Put an unlocked popup into an acceptance state and reload it, which is what an extension update
 * that ships newer Terms looks like to a running wallet. The session lives in the worker, so the
 * reload lands back on the wallet, not the lock screen.
 */
export async function reloadWithLegalState(page: Page, seed: Exclude<LegalSeed, "keep">): Promise<void> {
	await seedLegalAcceptance(page, seed)
	await page.evaluate(() => chrome.storage.session.remove("nulo:legal:dismissed"))
	await page.evaluate(() => {
		window.location.hash = "#/popup/general"
	})
	await reloadExtensionPage(page)
	await waitForHash(page, "#/popup/general", 30_000)
}

export async function waitForSheet(page: Page, variant: "changed" | "review"): Promise<void> {
	await page.waitForSelector(`${sel("legal-sheet")}[data-variant="${variant}"]`, { visible: true, timeout: 15_000 })
}

export async function isSheetPresent(page: Page): Promise<boolean> {
	return page.evaluate((s) => document.querySelector(s) !== null, sel("legal-sheet"))
}

/**
 * A REAL pointer click at the element's centre, after proving nothing sits on top of it there. A
 * DOM-dispatched click reaches an element under an overlay; this is the proof that no overlay is.
 * `last` picks the last match of the testid — the control of the popup on top of a stack.
 */
export async function pointerClick(page: Page, testid: string, opts: { last?: boolean } = {}): Promise<void> {
	await page.waitForSelector(sel(testid), { visible: true, timeout: 15_000 })
	const point = await page.evaluate(
		(s, last) => {
			const all = document.querySelectorAll(s)
			const el = last ? all[all.length - 1] : all[0]
			if (!el) throw new Error(`${s} not found`)
			el.scrollIntoView({ block: "center" })
			const box = el.getBoundingClientRect()
			const x = box.left + box.width / 2
			const y = box.top + box.height / 2
			const top = document.elementFromPoint(x, y)
			return {
				x,
				y,
				reachable: !!top && (el === top || el.contains(top)),
				covering: top?.getAttribute("data-testid") ?? top?.tagName,
			}
		},
		sel(testid),
		opts.last === true,
	)
	if (!point.reachable) throw new Error(`${testid} is covered at its centre by ${point.covering}`)
	await page.mouse.click(point.x, point.y)
}
