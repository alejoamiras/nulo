/**
 * Full-backup round-trip WITH an imported account — the smoke proof of CLONE DIVERGENCE.
 *
 * A backup's imported-key rows are sealed under the SOURCE profile's DEK; the restored profile
 * mints a FRESH DEK and `AccountService.restoreImportedKeys` rewraps every row source→destination
 * through the TTL-bound context. None of that machinery has a user-visible seam — the only
 * end-to-end proof is that an imported account carried THROUGH a backup still decrypts in the
 * restored profile. That is what this file asserts, via the re-export-preview probe (preview
 * re-derives the address from the decrypted key, so a row left sealed to the source DEK, or
 * rewrapped to the wrong key, cannot pass).
 *
 * The restore happens INTO THE SAME EXTENSION that still holds the source profile, which makes
 * the flow double as the duplicate-phrase guard's BACKUP leg: the backup carries profile A's
 * phrase, A still exists, so the warn-and-confirm fires and the CONFIRM path is what proceeds —
 * the seed-path legs live in `duplicate-phrase-import.test.ts`.
 */
import { rmSync } from "node:fs"
import { expect } from "vitest"
import { TEST_PASSWORD } from "./fixtures/constants"
import { clickByTestId, launchExtension, openPopup, registerProfile, replaceInputValue, test, waitForHash } from "./fixtures/extension"
import { acceptConfirmPopup, closeStuckPopup, navigateByHash, reopenAndRecoverAfterImport } from "./fixtures/helpers"
import { confirmImport, exportAccountBody, exportImportedAccountBody, gotoAccounts, previewImport } from "./helpers/account-io"
import { armBackupDownloadCapture, readCapturedBackupDownload } from "./helpers/backup-export"
import { writeBackupToTemp } from "./helpers/import-drivers"

/** The restored profile gets its own password — distinct on purpose, so an assertion passing
 *  with the OLD password would be a real failure, not an ambiguity. */
const RESTORE_PASSWORD = "restored-profile-7"

test("a full backup carries an imported account; restoring it (dup-confirmed) rewraps the key and it still decrypts", {
	timeout: 600_000,
}, async ({ registeredExtension }) => {
	// ── Stage 0: a genuinely foreign account file (second browser, own master) ──
	let foreignBody: string
	{
		const donor = await launchExtension()
		try {
			await registerProfile(donor)
			const donorPage = await openPopup(donor)
			await waitForHash(donorPage, "#/popup/general", 30_000)
			foreignBody = await exportAccountBody(donorPage, "Account", false)
		} finally {
			await donor.browser.close()
		}
	}

	// ── Stage 1: profile A imports the account ──
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general", 30_000)
	const importedAddress = await previewImport(page, foreignBody)
	expect(importedAddress).toBeTruthy()
	await confirmImport(page)
	await gotoAccounts(page)
	await page.waitForSelector('[data-testid="account-imported-badge"]', { visible: true, timeout: 20_000 })

	// ── Stage 2: export a PLAIN full backup (the imported-key slice rides along) ──
	await navigateByHash(page, "#/popup/settings/security/export/full")
	await clickByTestId(page, "agree-continue-btn")
	await page.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 10_000 })
	await replaceInputValue(page, '[data-testid="unlock-password-input"]', TEST_PASSWORD)
	await clickByTestId(page, "unlock-submit-btn")
	// The multi-service backup chain is slow on hosted runners (same budget as
	// backup-roundtrip.test.ts).
	await page.waitForFunction(
		() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="download-backup-btn"]')
			return !!btn && !btn.disabled
		},
		{ timeout: 120_000, polling: 250 },
	)
	await armBackupDownloadCapture(page)
	await clickByTestId(page, "download-backup-btn")
	const backupJson = await readCapturedBackupDownload(page)
	expect(backupJson.trim().startsWith("{")).toBe(true)
	// The backup genuinely carries the imported-key slice — without this, the restore stages
	// below would "pass" by restoring nothing.
	const parsedBackup = JSON.parse(backupJson) as { data?: Record<string, unknown> }
	expect(Array.isArray(parsedBackup.data?.["imported-account-keys"])).toBe(true)
	expect((parsedBackup.data?.["imported-account-keys"] as unknown[] | undefined)?.length).toBe(1)

	const filePath = writeBackupToTemp(backupJson, "backup-with-imported-account.json")
	try {
		// ── Stage 3: import the backup into the SAME extension → dup-phrase warn → confirm ──
		await navigateByHash(page, "#/popup/import", 15_000)
		await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), { timeout: 15_000, polling: 300 })
		await page.waitForSelector('[data-testid="import-option-full-backup"]', { visible: true, timeout: 15_000 })
		await clickByTestId(page, "import-option-full-backup")
		const [chooser] = await Promise.all([
			page.waitForFileChooser({ timeout: 10_000 }),
			clickByTestId(page, "import-full-backup-pick-file"),
		])
		await chooser.accept([filePath])
		await page.waitForSelector('[data-testid="import-full-backup-password-input"] input', { visible: true, timeout: 30_000 })
		await replaceInputValue(page, '[data-testid="import-full-backup-password-input"]', RESTORE_PASSWORD)
		await replaceInputValue(page, '[data-testid="import-full-backup-password-confirm-input"]', RESTORE_PASSWORD)
		await page.waitForFunction(
			() => {
				const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-full-backup-submit-btn"]')
				return !!btn && !btn.disabled
			},
			{ timeout: 10_000 },
		)
		await clickByTestId(page, "import-full-backup-submit-btn")

		// The guard fires on the BACKUP path: profile A holds this exact phrase.
		await page.waitForSelector('[data-testid="confirm-submit"]', { visible: true, timeout: 60_000 })
		const dialogText = await page.evaluate(() => document.body.textContent ?? "")
		expect(dialogText).toMatch(/recovery phrase/i)
		await acceptConfirmPopup(page)

		// ── Stage 4: settle into the restored profile (backup-roundtrip's actionable-screen
		// idiom: general/auth are terminal; the finished-with-errors screen is acknowledged
		// via Continue, exactly as a real user proceeds) ──
		await page.waitForFunction(
			() => {
				const h = window.location.hash
				if (h.includes("/popup/general") || h.includes("/popup/auth")) return true
				return !!document.querySelector('[data-testid="import-full-backup-continue-btn"]')
			},
			{ timeout: 120_000, polling: 250 },
		)
		const continueVisible = await page.evaluate(() => !!document.querySelector('[data-testid="import-full-backup-continue-btn"]'))
		if (continueVisible) {
			await clickByTestId(page, "import-full-backup-continue-btn")
			await page.waitForFunction(
				() => {
					const h = window.location.hash
					return h.includes("/popup/general") || h.includes("/popup/auth")
				},
				{ timeout: 60_000, polling: 250 },
			)
		}
		await closeStuckPopup(page)
		await reopenAndRecoverAfterImport(page, RESTORE_PASSWORD)

		// Both profiles exist — the restore added one, replaced none.
		const profileCount = await page.evaluate(async () => {
			const all = await chrome.storage.local.get(null)
			return Object.keys(all).filter((k) => k.startsWith("nulo:core:profiles@")).length
		})
		expect(profileCount).toBe(2)

		// ── Stage 5: THE rewrap proof — the imported account decrypts in the restored profile ──
		await gotoAccounts(page)
		await page.waitForSelector('[data-testid="account-imported-badge"]', { visible: true, timeout: 30_000 })
		const reExported = await exportImportedAccountBody(page, false, RESTORE_PASSWORD)
		const reviewed = await previewImport(page, reExported)
		expect(reviewed).toBe(importedAddress)
	} finally {
		rmSync(filePath, { force: true })
	}
})
