/**
 * Backup-restore integrity on a live sandbox — proves the P1 tx-restore
 * PROVENANCE FILTER end-to-end through real chrome.storage + the real restore
 * pipeline (backup-restore-corruption-fix).
 *
 * A funded wallet exports a real backup; the backup is doctored to carry two
 * schema-valid txs — one for the funded account (imported → must survive) and
 * one for a FOREIGN account not in the backup (must be dropped, or it would
 * surface in the victim profile's activity and, after the chainId-only tx
 * chain-purge subscriber was removed, never be purged). After importing into a
 * FRESH extension, raw chrome.storage must hold the funded-account tx and NOT
 * the foreign one, and the wallet must be on-chain functional.
 *
 * Coverage split (see the plan): P1's cross-profile WIPE is proven through the
 * real service graph in `src/wallet/services/cross-profile-isolation.test.ts`
 * (real Account+Transaction+onAccountDeleted cascade; only chrome.storage is a
 * FakeBrowserApi); P2 index-pairing + P3 composite key are unit-proven — a live
 * network-id collision and multi-node multi-chain restore aren't cheaply
 * forgeable in a single-sandbox e2e. This e2e adds the real-storage proof for
 * the provenance filter + on-chain functionality.
 */
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, launchExtension, openPopup, replaceInputValue, test, waitForHash } from "../fixtures/extension"
import { getAccountAddress, navigateByHash, refreshBalances, switchToLocalNetwork, waitForBalance } from "../fixtures/helpers"
import { armBackupDownloadCapture, readCapturedBackupDownload } from "../helpers/backup-export"
import { gotoPopupImport, importFullBackup, POPUP_IMPORT_SHELL, TEST_PASSWORD, writeBackupToTemp } from "../helpers/import-drivers"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const FOREIGN_ACCOUNT = `0x${"de".repeat(32)}`

// UNCONDITIONAL arming contract (Phase 9): this file runs ONLY via the network
// e2e agent runner, which provisions a live sandbox — so an absent config here
// means the required gate mis-set up and must FAIL, never vacuously skip.
test("agent-runner contract: a live sandbox must be configured (no false skip)", () => {
	expect(hasConfig).toBe(true)
})

test.skipIf(!hasConfig)(
	"import drops a foreign-account tx and keeps the funded-account tx (P1 provenance) + stays on-chain functional",
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

		// ── 2. Doctor: inject a valid + a foreign tx ──────────────────────
		const exported = JSON.parse(exportedJson) as { checksum?: string; data: Record<string, unknown> } & Record<string, unknown>
		const funded = tokenReadyExtension.accountAddress
		const chainId = (exported.data.network as Array<{ chainId: number }>)[0].chainId
		const mkTx = (hash: string, account: string) => ({
			chainId,
			account,
			nonce: "0",
			feePaymentMethod: 0,
			hash,
			createdAt: 1,
			updatedAt: 1,
			status: 1, // non-Pending → the restore-side sync worker never touches it
			origin: { type: "wallet" },
			calls: [{ contract: "0xc0ffee", method: "transfer", args: [] }],
		})
		const VALID_HASH = `0x${"a1".repeat(32)}`
		const FOREIGN_HASH = `0x${"f0".repeat(32)}`
		exported.data.transaction = [mkTx(VALID_HASH, funded), mkTx(FOREIGN_HASH, FOREIGN_ACCOUNT)]

		const { checksum: _stale, ...body } = exported
		const checksum = createHash("sha256").update(JSON.stringify(body)).digest("hex")
		const filePath = writeBackupToTemp(JSON.stringify({ ...body, checksum }))

		// ── 3. Import into a FRESH extension ──────────────────────────────
		const profileDir = mkdtempSync(join(tmpdir(), "nulo-backup-integrity-"))
		const ctx2 = await launchExtension({ userDataDir: profileDir })
		try {
			const page2 = await gotoPopupImport(ctx2)
			await importFullBackup(page2, filePath, TEST_PASSWORD, POPUP_IMPORT_SHELL)

			// ── 4. Provenance assertion via RAW chrome.storage ──────────────
			const txAccounts = await page2.evaluate(async () => {
				const all = await chrome.storage.local.get()
				return Object.entries(all)
					.filter(([k]) => k.startsWith("nulo:core:txs@"))
					.map(([, v]) => (JSON.parse(v as string) as { account: string }).account)
			})
			// The funded-account tx (its account WAS imported) survived; the
			// foreign-account tx was dropped before restore could write it.
			expect(txAccounts).toContain(funded)
			expect(txAccounts).not.toContain(FOREIGN_ACCOUNT)

			// ── 5. On-chain functionality ───────────────────────────────────
			await switchToLocalNetwork(page2)
			expect(await getAccountAddress(page2)).toBe(funded)
			for (let i = 0; i < 40; i++) {
				await refreshBalances(page2)
				const bodyText = await page2.evaluate(() => document.body.innerText)
				if (bodyText.includes("1,000")) break
				await page2
					.waitForFunction(() => document.body.innerText.includes("1,000"), { timeout: 3_000, polling: 500 })
					.catch(() => {})
			}
			await waitForBalance(page2, "1,000", 30_000)

			await page2.close()
		} finally {
			await ctx2.browser.close()
			rmSync(profileDir, { recursive: true, force: true })
			// The doctored file embeds the wallet's REAL (local-chain test) master-key.
			rmSync(dirname(filePath), { recursive: true, force: true })
		}
	},
)
