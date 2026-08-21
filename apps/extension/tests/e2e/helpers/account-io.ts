/**
 * Shared drivers for the per-account export/import PAGE flows (the popup drivers this file used
 * to hold died with the popups in the account-file UX redesign).
 *
 * Export drives `settings/security/export/account`: picker (or the Manage Accounts deep-link that
 * skips it), agree gate, unlock, then the ready stage where the file is DOWNLOADED, never shown.
 * The body is captured in-page with the same `chrome.downloads` stub the backup suites use —
 * account files are uncompressed, so the capture reads the blob as plain text.
 *
 * Import drives `settings/accounts/import`: the file picker row (the page is file-only — bodies
 * are delivered by writing a temp file and accepting it through the chooser), the protected-file
 * password when the body sniffs encrypted, preview, confirm.
 *
 * Selector discipline: testids only.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect } from "vitest"
import type { Page } from "puppeteer"
import { TEST_PASSWORD } from "../fixtures/constants"
import { clickByTestId, replaceInputValue } from "../fixtures/extension"
import { closeStuckPopup, navigateByHash, waitForToast } from "../fixtures/helpers"

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

/** Arm the in-page download capture. Account files are UNCOMPRESSED (unlike gzipped backups), so
 *  the stub reads the blob as plain text. Two-phase like `backup-export.ts`: arm BEFORE the
 *  download CTA, read after. */
async function armAccountDownloadCapture(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as { __accountCapture?: Promise<string> }
		w.__accountCapture = new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("account download was not captured within 30s")), 30_000)
			const c = chrome as unknown as {
				downloads: { download: (opts: { url: string }, cb: (id: number) => void) => void }
			}
			c.downloads = {
				download: (opts, cb) => {
					fetch(opts.url)
						.then((r) => r.text())
						.then((text) => {
							clearTimeout(timer)
							resolve(text)
							cb(1)
						})
						.catch((err) => {
							clearTimeout(timer)
							reject(err instanceof Error ? err : new Error(String(err)))
						})
				},
			}
		})
		// Swallow the (test-only) unhandled rejection if the click never fires.
		w.__accountCapture.catch(() => {})
	})
}

async function readAccountDownloadCapture(page: Page): Promise<string> {
	return await page.evaluate(() => (window as unknown as { __accountCapture: Promise<string> }).__accountCapture)
}

/** Drive the export page from its unlock stage to a captured file body. Assumes the page is
 *  already showing the agree gate (account selected). */
async function runExportStages(page: Page, encrypt: boolean, password: string): Promise<string> {
	await page.waitForSelector('[data-testid="agree-continue-btn"]', { visible: true, timeout: 15_000 })
	await clickByTestId(page, "agree-continue-btn")

	await page.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 15_000 })
	await replaceInputValue(page, '[data-testid="unlock-password-input"]', password)
	await clickByTestId(page, "unlock-submit-btn")

	// Ready stage: a wrong password shakes inline instead — surface that as a real error.
	await page.waitForFunction(
		() =>
			!!document.querySelector('[data-testid="account-file-ready-banner"]') ||
			!!document.querySelector('[data-testid="unlock-error-text"]'),
		{ timeout: 30_000, polling: 250 },
	)
	const wrongPassword = await page.evaluate(() => !!document.querySelector('[data-testid="unlock-error-text"]'))
	if (wrongPassword) throw new Error("export unlock rejected the password")

	if (encrypt) {
		await clickByTestId(page, "account-protect-btn")
		await page.waitForSelector('[data-testid="account-file-protected-banner"]', { visible: true, timeout: 30_000 })
	}

	await armAccountDownloadCapture(page)
	await clickByTestId(page, "account-download-btn")
	const body = await readAccountDownloadCapture(page)
	expect(body.length).toBeGreaterThan(0)
	return body
}

/** Export the account named `accountName` via the full page flow (picker included). */
export async function exportAccountBody(
	page: Page,
	accountName: string,
	encrypt: boolean,
	password: string = TEST_PASSWORD,
): Promise<string> {
	await closeStuckPopup(page)
	await waitForRouteStability(page)
	// Route via the backup landing first: navigating to a hash the page is ALREADY on is a no-op,
	// so a second consecutive export would find the page still parked on the prior run's ready
	// stage (state deliberately dies on unmount, not on re-entry).
	await navigateByHash(page, "#/popup/settings/security/export", 15_000)
	await navigateByHash(page, "#/popup/settings/security/export/account", 15_000)
	try {
		await page.waitForSelector('[data-testid="export-account-row"]', { visible: true, timeout: 20_000 })
	} catch (err) {
		const diag = await page
			.evaluate(() => ({ hash: window.location.hash, bodySnippet: (document.body.innerText ?? "").slice(0, 200) }))
			.catch((e) => ({ evalFailed: String(e) }))
		throw new Error(`export picker never rendered; parked state: ${JSON.stringify(diag)}; original: ${(err as Error).message}`)
	}
	await page.evaluate((name: string) => {
		const row = [...document.querySelectorAll('[data-testid="export-account-row"]')].find(
			(r) => r.getAttribute("data-account-name") === name,
		)
		if (!row) throw new Error(`no export row named ${name}`)
		row.dispatchEvent(new MouseEvent("click", { bubbles: true }))
	}, accountName)
	return runExportStages(page, encrypt, password)
}

/** Export the IMPORTED account via the Manage Accounts row deep-link — the row is found by its
 *  badge, never by name (an import carries the SOURCE profile's account name, so it routinely
 *  collides with the target's own derived row). The deep-link also proves the preselect path. */
export async function exportImportedAccountBody(page: Page, encrypt: boolean, password: string = TEST_PASSWORD): Promise<string> {
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
	// The deep-link preselects the account, so the page opens on the agree gate directly.
	return runExportStages(page, encrypt, password)
}

/** Open the import page and feed `body` through the FILE picker (the page is file-only now —
 *  the paste path died with the redesign refinements). Runs the PREVIEW step ("Continue", or
 *  "Unlock File" for protected bodies). Returns the previewed address, or null when the page
 *  surfaced an error instead. The page is left on the confirm step; `confirmImport` completes it. */
export async function previewImport(page: Page, body: string, filePassword?: string): Promise<string | null> {
	await closeStuckPopup(page)
	await waitForRouteStability(page)
	await navigateByHash(page, "#/popup/settings/accounts/import", 15_000)
	await page.waitForSelector('[data-testid="import-account-pick-file"]', { visible: true, timeout: 20_000 })

	// Deliver the body as a real file: write it to a temp path and accept it through the chooser.
	const dir = mkdtempSync(join(tmpdir(), "nulo-e2e-account-io-"))
	const filePath = join(dir, "account-import.json")
	writeFileSync(filePath, body)
	try {
		const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10_000 }), clickByTestId(page, "import-account-pick-file")])
		await chooser.accept([filePath])
		// The row's description reflects the picked file once the page has read it.
		await page.waitForFunction(
			() => (document.querySelector('[data-testid="import-account-pick-file"]')?.textContent ?? "").includes("account-import.json"),
			{ timeout: 15_000, polling: 200 },
		)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}

	if (filePassword) {
		await page.waitForSelector('[data-testid="import-account-password-input"] input', { visible: true, timeout: 15_000 })
		await replaceInputValue(page, '[data-testid="import-account-password-input"] input', filePassword)
	}
	await clickByTestId(page, "import-account-submit")
	// Either the confirm step renders (with the recomputed address) or an error does.
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="import-account-preview"]') !== null ||
			document.querySelector('[data-testid="import-account-error"]') !== null,
		{ timeout: 30_000, polling: 200 },
	)
	return await page.evaluate(() => {
		const row = document.querySelector('[data-testid="import-account-preview"]')
		return row ? (row.getAttribute("data-account-address") ?? "").trim() || null : null
	})
}

/** Complete an import the caller previewed: click the confirm CTA and wait for the toast. The
 *  page returns to Manage Accounts on success (history-aware back). */
export async function confirmImport(page: Page): Promise<void> {
	await clickByTestId(page, "import-account-submit")
	await waitForToast(page, "Account imported")
}
