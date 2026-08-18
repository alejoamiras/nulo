/**
 * Shared machinery for the crash-truth surface:
 * `network/backup-restore-sw-restart.test.ts` (mid-restore SW kill; proverless
 * rendezvous) and `network/profile-reimport-matrix.test.ts` (the no-crash
 * delete + same-id re-import matrix, prover-capable — it imports
 * `readProfileGen` for its generation pin). Extracted so no test file ever
 * imports another test module and nothing is duplicated.
 */
import type { Page } from "puppeteer"
import { clickByTestId, openPopup, replaceInputValue, waitForHash, withTimeoutMessage, type ExtensionContext } from "../fixtures/extension"
import { getActiveProfileName, navigateByHash } from "../fixtures/helpers"
import { armBackupDownloadCapture, readCapturedBackupDownload } from "./backup-export"
import { POPUP_IMPORT_SHELL, TEST_PASSWORD, setInputs, submitWhenEnabled, writeBackupToTemp } from "./import-drivers"

// The rollback/delete budget is STRUCTURAL, not sampled: the page's catch
// entry is bounded by the in-flight RPC's own 60s transport timeout, and
// `deleteProfile` against a cold-booting worker carries its own 60s ceiling.
// 60s + 60s + 30s margin. Shared: the reset ritual rides the same
// deleteProfile purge.
export const ROLLBACK_BUDGET_MS = 150_000

export async function readStage(page: Page): Promise<string> {
	return await page
		.evaluate(() => document.querySelector("[data-restore-stage]")?.getAttribute("data-restore-stage") ?? "<unbound>")
		.catch(() => "<unreadable>")
}

/** The sole profile row's identity + pxe generation — the pair the offscreen
 *  lifecycle fence keys on. Null when no profile row exists. */
export async function readProfileGen(page: Page): Promise<{ id: string; gen: string | null } | null> {
	return await page.evaluate(async () => {
		const all = await chrome.storage.local.get()
		for (const [k, v] of Object.entries(all)) {
			if (!k.startsWith("nulo:core:profiles@")) continue
			try {
				const row = JSON.parse(v as string) as { id?: string; pxeGeneration?: string }
				return { id: row.id ?? k.slice("nulo:core:profiles@".length), gen: row.pxeGeneration ?? null }
			} catch {
				// Malformed row: skip.
			}
		}
		return null
	})
}

/** Drive the reset page's deliberate-delete ritual (3 acknowledgements + the
 *  profile name typed back) and wait for the register route — the page must
 *  already be AT `#/popup/settings/security/reset`. */
export async function completeResetRitual(page: Page): Promise<void> {
	await page.waitForSelector('[data-testid="reset-checkbox-permanent"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "reset-checkbox-permanent")
	await clickByTestId(page, "reset-checkbox-undone")
	await clickByTestId(page, "reset-checkbox-sure")
	const profileName = await getActiveProfileName(page)
	await page.evaluate((expectedName: string) => {
		const input = document.querySelector<HTMLInputElement>('[data-testid="reset-confirm-input"] input')
		if (!input) throw new Error("reset-confirm-input not found")
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
		setter?.call(input, expectedName)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}, profileName)
	await submitWhenEnabled(page, "reset-submit-btn")
	// The delete rides deleteProfile's full awaited purge; reset.vue routes to
	// register once no profiles remain.
	await waitForHash(page, "#/popup/register", ROLLBACK_BUDGET_MS)
}

/** Hash-navigate to the popup import screen and run a full-backup import to a
 *  TERMINAL state: clean auto-route, or the skip-errors summary (which never
 *  auto-routes — Continue is a user step). Ends on the success route; returns
 *  the summary screen's text ("" for a clean finish). */
export async function reimportToTerminal(page: Page, filePath: string): Promise<string> {
	await page.evaluate(() => {
		window.location.hash = "#/popup/import"
	})
	await waitForHash(page, "#/popup/import", 5_000)
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), {
		timeout: 15_000,
		polling: 500,
	})
	await driveImportToSubmit(page, filePath)
	await withTimeoutMessage(
		page.waitForFunction(
			(successHash: string) => {
				// A clean, fast import can flip `finished` and AUTO-ROUTE between
				// two polls — the stage attribute unmounts with the page, so
				// "already routed" must itself count as terminal or the wait
				// starves against a completed import (fence-fix evidence run).
				if (window.location.hash === successHash) return true
				if (document.querySelector('[data-testid="import-full-backup-continue-btn"]')) return true
				const s = document.querySelector("[data-restore-stage]")?.getAttribute("data-restore-stage")
				return s === "finished"
			},
			{ timeout: 300_000, polling: 250 },
			POPUP_IMPORT_SHELL.successHash,
		),
		async () => `re-import never reached a terminal state (stage=${await readStage(page)})`,
	)
	let summaryText = ""
	if (await page.$('[data-testid="import-full-backup-continue-btn"]')) {
		summaryText = await page.evaluate(() => (document.body.innerText ?? "").replace(/\s+/g, " ").slice(0, 600))
		await clickByTestId(page, "import-full-backup-continue-btn")
	}
	await waitForHash(page, POPUP_IMPORT_SHELL.successHash, 60_000)
	return summaryText
}

/** Stage 1: export a REAL backup from the funded wallet once per test file
 *  and reuse the file (module-level cache — each vitest file gets its own
 *  module registry, so the two crash-truth files each export once). */
let exported: { filePath: string; funded: string } | null = null
export async function exportFundedBackup(
	ctx: ExtensionContext & { accountAddress: string },
): Promise<{ filePath: string; funded: string }> {
	if (exported) return exported
	const page = await openPopup(ctx)
	await waitForHash(page, "#/popup/general")
	await navigateByHash(page, "#/popup/settings/security/export/full")
	await clickByTestId(page, "agree-continue-btn")
	await page.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 10_000 })
	await replaceInputValue(page, '[data-testid="unlock-password-input"]', TEST_PASSWORD)
	await clickByTestId(page, "unlock-submit-btn")
	await page.waitForFunction(
		() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="download-backup-btn"]')
			return !!btn && !btn.disabled
		},
		{ timeout: 120_000, polling: 250 },
	)
	await armBackupDownloadCapture(page)
	await clickByTestId(page, "download-backup-btn")
	const exportedJson = await readCapturedBackupDownload(page)
	await page.close()
	exported = { filePath: writeBackupToTemp(exportedJson), funded: ctx.accountAddress }
	return exported
}

/** Drive the popup import flow up to (and including) submit, WITHOUT the
 *  success wait. */
export async function driveImportToSubmit(page: Page, filePath: string): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-full-backup"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-full-backup")
	await page.waitForSelector('[data-testid="import-full-backup-pick-file"]', { visible: true, timeout: 10_000 })
	const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10_000 }), clickByTestId(page, "import-full-backup-pick-file")])
	await chooser.accept([filePath])
	await page.waitForSelector(`[data-testid="${POPUP_IMPORT_SHELL.submitTestId("full-backup")}"]`, {
		visible: true,
		timeout: 10_000,
	})
	await setInputs(page, {
		'[data-testid="import-full-backup-password-input"] input': TEST_PASSWORD,
		'[data-testid="import-full-backup-password-confirm-input"] input': TEST_PASSWORD,
	})
	await submitWhenEnabled(page, POPUP_IMPORT_SHELL.submitTestId("full-backup"))
}
