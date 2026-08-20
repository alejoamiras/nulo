/**
 * Shared drivers for the per-account Export/Import popups. Extracted from
 * `account-import-export.test.ts` once three suites needed them (that file, the
 * imported-account lifecycle scenario, and the backup-with-imported-account round-trip).
 *
 * Selector discipline: testids only. `account-export-btn` is a PER-ROW testid shared by every
 * row, so it is always clicked through its row's `data-account-name` — a bare `clickByTestId`
 * would silently hit the LAST matching row (see `accounts.test.ts`'s edit-name idiom).
 */
import { expect } from "vitest"
import type { Page } from "puppeteer"
import { TEST_PASSWORD } from "../fixtures/constants"
import { clickByTestId, replaceInputValue } from "../fixtures/extension"
import { closeStuckPopup, navigateByHash } from "../fixtures/helpers"

/** Post-unlock/bootstrap routing can land a LATE `router.push("/popup/general")` that yanks a
 *  just-navigated route back and unmounts the page a caller is waiting for. Proceed only once the
 *  hash has been stable for 1.5s — bounded, so a genuine redirect loop still fails loudly. */
async function waitForRouteStability(page: Page): Promise<void> {
	await page.waitForFunction(
		() => {
			const w = window as unknown as { __nuloRouteStable?: { hash: string; since: number } }
			const cur = window.location.hash
			if (!w.__nuloRouteStable || w.__nuloRouteStable.hash !== cur) {
				w.__nuloRouteStable = { hash: cur, since: Date.now() }
				return false
			}
			return Date.now() - w.__nuloRouteStable.since >= 1_500
		},
		{ timeout: 20_000, polling: 250 },
	)
}

/** Go to the manage-accounts page by HASH. `navigateToSettings` enters through the bottom nav,
 *  which settings SUB-pages don't render — so it only works from /popup/general, and these suites
 *  are usually already on a settings page when they need to navigate again. */
export async function gotoAccounts(page: Page): Promise<void> {
	await waitForRouteStability(page)
	await navigateByHash(page, "#/popup/settings/accounts", 15_000)
	try {
		await page.waitForSelector('[data-testid="manage-accounts-page"]', { visible: true, timeout: 20_000 })
	} catch (err) {
		const diag = await page
			.evaluate(() => ({ hash: window.location.hash, bodySnippet: (document.body.innerText ?? "").slice(0, 160) }))
			.catch((e) => ({ evalFailed: String(e) }))
		throw new Error(`manage-accounts-page never rendered; parked state: ${JSON.stringify(diag)}; original: ${(err as Error).message}`)
	}
}

/** Open the export popup for the row whose account NAME matches. Scoped click — the export
 *  testid repeats per row. */
export async function openExportForAccount(page: Page, accountName: string): Promise<void> {
	// A prior popup can stick mid-leave in headless Chrome (documented repo quirk) and its
	// dimmer then swallows the settings-nav click — clear it before navigating.
	await closeStuckPopup(page)
	await gotoAccounts(page)
	await page.waitForSelector('[data-testid="manage-accounts-row"]', { visible: true, timeout: 15_000 })
	await page.evaluate((name: string) => {
		const row = [...document.querySelectorAll('[data-testid="manage-accounts-row"]')].find(
			(r) => r.getAttribute("data-account-name") === name,
		)
		if (!row) throw new Error(`no account row named ${name}`)
		const btn = row.querySelector('[data-testid="account-export-btn"]')
		if (!btn) throw new Error("row has no export button")
		btn.dispatchEvent(new MouseEvent("click", { bubbles: true }))
	}, accountName)
	await page.waitForSelector('[data-testid="export-account-password-input"]', { visible: true, timeout: 15_000 })
}

/** Open the export popup for the IMPORTED row — the one carrying `account-imported-badge`.
 *  Never match an imported row by name: an import carries the SOURCE profile's account name, so
 *  it routinely collides with the target's own derived row (both are "Account" by default) and a
 *  name-scoped find silently exports the wrong one. */
export async function openExportForImportedAccount(page: Page): Promise<void> {
	await closeStuckPopup(page)
	await gotoAccounts(page)
	await page.waitForSelector('[data-testid="account-imported-badge"]', { visible: true, timeout: 15_000 })
	await page.evaluate(() => {
		const badge = document.querySelector('[data-testid="account-imported-badge"]')
		const row = badge?.closest('[data-testid="manage-accounts-row"]')
		if (!row) throw new Error("no manage-accounts row carries the imported badge")
		const btn = row.querySelector('[data-testid="account-export-btn"]')
		if (!btn) throw new Error("imported row has no export button")
		btn.dispatchEvent(new MouseEvent("click", { bubbles: true }))
	})
	await page.waitForSelector('[data-testid="export-account-password-input"]', { visible: true, timeout: 15_000 })
}

/** Drive an already-open export popup to a revealed file body. `encrypt` toggles the
 *  password-protect switch (default ON in the UI). `password` is the PROFILE password
 *  authenticating the export. */
async function revealExportBody(page: Page, encrypt: boolean, password: string): Promise<string> {
	if (!encrypt) await clickByTestId(page, "export-account-encrypt-toggle")
	await replaceInputValue(page, '[data-testid="export-account-password-input"] input', password)
	await clickByTestId(page, "export-account-submit")
	await page.waitForSelector('[data-testid="export-account-reveal"]', { visible: true, timeout: 20_000 })
	const body = await page.evaluate(() => {
		const scope = document.querySelector('[data-testid="export-account-reveal"]')
		const input = scope?.querySelector("input") as HTMLInputElement | null
		return input?.value ?? ""
	})
	expect(body.length).toBeGreaterThan(0)
	// Close the popup (Done), then force-clear any stuck <Transition> remnants so the next
	// navigation isn't blocked by a lingering dimmer.
	await clickByTestId(page, "export-account-submit")
	await closeStuckPopup(page)
	return body
}

/** Export the row matched by NAME to a revealed file body. */
export async function exportAccountBody(
	page: Page,
	accountName: string,
	encrypt: boolean,
	password: string = TEST_PASSWORD,
): Promise<string> {
	await openExportForAccount(page, accountName)
	return revealExportBody(page, encrypt, password)
}

/** Export the IMPORTED (badge-carrying) row to a revealed file body. */
export async function exportImportedAccountBody(page: Page, encrypt: boolean, password: string = TEST_PASSWORD): Promise<string> {
	await openExportForImportedAccount(page)
	return revealExportBody(page, encrypt, password)
}

/**
 * Close the import popup PROPERLY, through its header close button — never by clearing DOM.
 * `popupStore.open()` on a key that is still open is not a reactive change, so a popup whose DOM
 * was force-removed while its store entry survived (the `closeStuckPopup` failure mode) can never
 * be reopened: the button goes permanently dead. Callers that ran a preview WITHOUT confirming
 * must close through here before driving anything else.
 */
export async function closeImportPopup(page: Page): Promise<void> {
	const hasPopup = await page.evaluate(() => !!document.querySelector('[data-testid="import-account-body-input"]'))
	if (!hasPopup) return
	await page.evaluate(() => {
		// Several stacked popups can each render a close button — scope to the import popup's card.
		const input = document.querySelector('[data-testid="import-account-body-input"]')
		const buttons = [...document.querySelectorAll('[data-testid="popup-close-btn"]')]
		const scoped = buttons.find((b) => {
			const card = b.closest("[class*='card'i]") ?? b.parentElement?.parentElement?.parentElement
			return card?.contains(input) ?? false
		})
		;((scoped ?? buttons[buttons.length - 1]) as HTMLElement | undefined)?.click()
	})
	await page.waitForFunction(() => !document.querySelector('[data-testid="import-account-body-input"]'), {
		timeout: 10_000,
		polling: 200,
	})
}

/** Paste a file body into the import popup and run the PREVIEW step. Returns the previewed
 *  address, or null when the popup surfaced an error instead. The popup is LEFT OPEN — a caller
 *  that confirms clicks `import-account-submit` next; a caller that does not MUST
 *  `closeImportPopup` before driving anything else (see its note). */
export async function previewImport(page: Page, body: string, filePassword?: string): Promise<string | null> {
	await closeStuckPopup(page)
	await gotoAccounts(page)
	// Kick-until-rendered (the `setActiveSendType` idiom): a single click can be swallowed by a
	// popup-system transition that is still settling, so re-dispatch it each poll until the
	// popup's body input actually exists.
	try {
		await page.waitForFunction(
			() => {
				if (document.querySelector('[data-testid="import-account-body-input"]')) return true
				document
					.querySelector('[data-testid="accounts-import-btn"]')
					?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
				return false
			},
			{ timeout: 20_000, polling: 500 },
		)
	} catch (err) {
		const diag = await page
			.evaluate(() => ({ hash: window.location.hash, bodySnippet: (document.body.innerText ?? "").slice(0, 160) }))
			.catch((e) => ({ evalFailed: String(e) }))
		throw new Error(`import popup never opened; parked state: ${JSON.stringify(diag)}; original: ${(err as Error).message}`)
	}
	await replaceInputValue(page, '[data-testid="import-account-body-input"] input', body)
	if (filePassword) await replaceInputValue(page, '[data-testid="import-account-password-input"] input', filePassword)
	await clickByTestId(page, "import-account-submit")
	// Either the confirm block renders (with the recomputed address) or an error does.
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="import-account-preview-address"]') !== null ||
			document.querySelector('[data-testid="import-account-error"]') !== null,
		{ timeout: 30_000, polling: 200 },
	)
	return await page.evaluate(() => {
		const addr = document.querySelector('[data-testid="import-account-preview-address"]')
		return addr ? (addr.textContent ?? "").trim() : null
	})
}
