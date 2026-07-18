/**
 * The P3 fold from P2's diagnosis: an MV3 service-worker restart MID-RESTORE is
 * production-plausible, and contract registrations applied during the restore
 * must survive it — after the user's natural recovery (reopen + unlock), the
 * imported wallet must be fully on-chain functional (account address intact,
 * real token balance syncs), which is only possible if the account + token
 * contracts are (re)registered against the encrypted PXE store.
 *
 * The kill lands deterministically MID-restore: after the import submit, the
 * test waits for the restored profile ROW to appear in raw chrome.storage
 * (restore started) and kills the SW before the import page's success
 * navigation (restore not finished). If the restore wins the race and finishes
 * first, the test degenerates to the plain reopen-recovery leg — still a valid
 * pass, logged for visibility.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import {
	clickByTestId,
	launchExtension,
	openPopup,
	replaceInputValue,
	test,
	waitForHash,
	type ExtensionContext,
} from "../fixtures/extension"
import {
	ensureUnlocked,
	getAccountAddress,
	navigateByHash,
	refreshBalances,
	switchToLocalNetwork,
	waitForBalance,
} from "../fixtures/helpers"
import { armBackupDownloadCapture, readCapturedBackupDownload } from "../helpers/backup-export"
import {
	gotoPopupImport,
	POPUP_IMPORT_SHELL,
	TEST_PASSWORD,
	setInputs,
	submitWhenEnabled,
	writeBackupToTemp,
} from "../helpers/import-drivers"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test("agent-runner contract: a live sandbox must be configured (no false skip)", () => {
	if (process.env.E2E_REQUIRE_SETUP === "1") {
		expect(hasConfig).toBe(true)
	}
})

// Mirrors sw-restart-network.test.ts — kept inline per that file's precedent.
async function stopServiceWorker(ctx: ExtensionContext): Promise<void> {
	const swTarget = await ctx.browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(ctx.extensionId), {
		timeout: 5_000,
	})
	const swSession = await swTarget.createCDPSession()
	try {
		await swSession.send("Runtime.terminateExecution")
	} catch {
		// Session dies along with the SW; swallow disconnect noise.
	}
}

test.skipIf(!hasConfig)(
	"a SW restart mid-restore does not lose contract registrations — recovery reaches a synced on-chain balance",
	{ timeout: 600_000 },
	async ({ tokenReadyExtension }) => {
		// ── 1. Export a REAL backup from the funded wallet ────────────────
		const page = await openPopup(tokenReadyExtension)
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
		const funded = tokenReadyExtension.accountAddress
		const filePath = writeBackupToTemp(exportedJson)

		// ── 2. Import into a FRESH extension, killing the SW mid-restore ──
		const profileDir = mkdtempSync(join(tmpdir(), "nulo-sw-restart-restore-"))
		const ctx2 = await launchExtension({ userDataDir: profileDir })
		try {
			const page2 = await gotoPopupImport(ctx2)
			// Inlined importFullBackup WITHOUT its success wait — the kill must
			// land before the success navigation.
			await page2.waitForSelector('[data-testid="import-option-full-backup"]', { visible: true, timeout: 10_000 })
			await clickByTestId(page2, "import-option-full-backup")
			await page2.waitForSelector('[data-testid="import-full-backup-pick-file"]', { visible: true, timeout: 10_000 })
			const [chooser] = await Promise.all([
				page2.waitForFileChooser({ timeout: 10_000 }),
				clickByTestId(page2, "import-full-backup-pick-file"),
			])
			await chooser.accept([filePath])
			await page2.waitForSelector(`[data-testid="${POPUP_IMPORT_SHELL.submitTestId("full-backup")}"]`, {
				visible: true,
				timeout: 10_000,
			})
			await setInputs(page2, {
				'[data-testid="import-full-backup-password-input"] input': TEST_PASSWORD,
				'[data-testid="import-full-backup-password-confirm-input"] input': TEST_PASSWORD,
			})
			await submitWhenEnabled(page2, POPUP_IMPORT_SHELL.submitTestId("full-backup"))

			// Mid-restore marker: the restored profile ROW exists (restore started)
			// but the page hasn't navigated to success (restore not finished).
			const midRestore = await page2
				.waitForFunction(
					async () => {
						if (window.location.hash.includes("general")) return "finished"
						const all = await chrome.storage.local.get()
						return Object.keys(all).some((k) => k.startsWith("nulo:core:profiles@")) ? "mid" : false
					},
					{ timeout: 60_000, polling: 100 },
				)
				.then((h) => h.jsonValue())

			if (midRestore === "finished") {
				// The restore outran the marker poll — the kill degrades to a plain
				// post-import restart. Still a valid recovery exercise; make it visible.
				console.warn("[sw-restart-restore] restore finished before the kill; running the degenerate post-import leg")
			}
			await stopServiceWorker(ctx2)
			await page2.close()

			// ── 3. The user's natural recovery: reopen + unlock ─────────────
			const page3 = await openPopup(ctx2)
			await page3.waitForFunction(() => window.location.hash.length > 2, { timeout: 30_000 })
			await ensureUnlocked(page3, TEST_PASSWORD)
			await page3.waitForFunction(() => window.location.hash.includes("/popup/general"), { timeout: 60_000 })

			// ── 4. Contracts survived: the imported account syncs its REAL balance ──
			await switchToLocalNetwork(page3)
			expect(await getAccountAddress(page3)).toBe(funded)
			for (let i = 0; i < 40; i++) {
				await refreshBalances(page3)
				if ((await page3.evaluate(() => document.body.innerText)).includes("1,000")) break
				await page3
					.waitForFunction(() => document.body.innerText.includes("1,000"), { timeout: 3_000, polling: 500 })
					.catch(() => {})
			}
			await waitForBalance(page3, "1,000", 30_000)
		} finally {
			await ctx2.browser.close().catch(() => {})
			rmSync(profileDir, { recursive: true, force: true })
		}
	},
)
