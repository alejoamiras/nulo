/**
 * Account-balance orphan closure — the end-to-end proof that a keyless imported account's
 * balance rows die WITH the account, and that re-importing the same key starts fresh.
 *
 * The production defect this pins: a full backup carrying an imported Account row without its
 * key row restores the account's balance rows, then `reconcileImportedAccounts` drops the
 * Account at finalize — pre-fix, the rows were orphaned, and re-importing the key (same key →
 * same address) reattached them silently: `ensurePairsHoldingLock` saw the pair occupied and
 * skipped, so pre-deletion balances rendered until an unscoped refresh happened to run.
 *
 *   1. A donor browser (own master) exports an account file; the token-ready wallet imports it
 *      — the imported account gains a real TST balance row.
 *   2. The wallet exports a full backup; the blob is doctored: the `imported-account-keys`
 *      slice is REMOVED, checksum recomputed (integrity detection, not authentication).
 *   3. A fresh extension imports the doctored backup. The keyless account must be dropped AND
 *      zero balance rows may remain for its (profileId, address) scope — the registered
 *      awaited purge inside `reconcileImportedAccounts` is what this asserts.
 *   4. The same key is re-imported: its balance row must be FRESH (created now), never a
 *      reattached pre-deletion row.
 *
 * Run solo: `bun run e2e:agent tests/e2e/network/account-balance-orphans.test.ts`.
 */
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, launchExtension, openPopup, registerProfile, replaceInputValue, test, waitForHash } from "../fixtures/extension"
import { navigateByHash, reopenAndRecoverAfterImport } from "../fixtures/helpers"
import { confirmImport, exportAccountBody, previewImport } from "../helpers/account-io"
import { armBackupDownloadCapture, readCapturedBackupDownload } from "../helpers/backup-export"
import { TEST_PASSWORD, writeBackupToTemp } from "../helpers/import-drivers"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const BALANCE_ROOT = "nulo:core:token-balances"
const ACCOUNT_ROOT = "nulo:core:accounts"

type BalanceRowView = { account: string; profileId: string; updatedAt: number }

/** All readable balance rows for one on-chain address, parsed from raw storage. */
async function balanceRowsFor(page: import("puppeteer").Page, address: string): Promise<BalanceRowView[]> {
	return await page.evaluate(
		async (root: string, addr: string) => {
			const all = await chrome.storage.local.get(null)
			return Object.entries(all)
				.filter(([k]) => k.startsWith(`${root}@`))
				.map(([, v]) => {
					try {
						return JSON.parse(v as string) as { account?: string; profileId?: string; updatedAt?: number }
					} catch {
						return {}
					}
				})
				.filter((r) => r.account === addr)
				.map((r) => ({
					account: r.account as string,
					profileId: (r.profileId as string) ?? "",
					updatedAt: (r.updatedAt as number) ?? -1,
				}))
		},
		BALANCE_ROOT,
		address,
	)
}

async function accountRowCountFor(page: import("puppeteer").Page, address: string): Promise<number> {
	return await page.evaluate(
		async (root: string, addr: string) => {
			const all = await chrome.storage.local.get(null)
			return Object.entries(all).filter(([k, v]) => k.startsWith(`${root}@`) && typeof v === "string" && (v as string).includes(addr))
				.length
		},
		ACCOUNT_ROOT,
		address,
	)
}

test("agent-runner contract: a live sandbox must be configured (no false skip)", () => {
	if (process.env.E2E_REQUIRE_SETUP === "1") {
		expect(hasConfig).toBe(true)
	}
})

test.skipIf(!hasConfig)(
	"a keyless import's balance rows are purged with the account, and re-importing the key starts fresh",
	{ timeout: 900_000 },
	async ({ tokenReadyExtension }) => {
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

		// ── Stage 1: the token-ready wallet imports the account; a balance row appears ──
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general", 30_000)
		const importedAddress = (await previewImport(page, foreignBody))!
		expect(importedAddress).toBeTruthy()
		await confirmImport(page)
		// The pair backfill (`onAccountAdded` → ensure) is async — wait for the row.
		await page.waitForFunction(
			async (root: string, addr: string) => {
				const all = await chrome.storage.local.get(null)
				return Object.entries(all).some(
					([k, v]) => k.startsWith(`${root}@`) && typeof v === "string" && (v as string).includes(addr),
				)
			},
			{ timeout: 60_000, polling: 500 },
			BALANCE_ROOT,
			importedAddress,
		)

		// ── Stage 2: export a REAL full backup ──
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
		const backupJson = await readCapturedBackupDownload(page)
		await page.close()

		// ── Stage 3: doctor — strip the key slice, keep the Account row + balance rows ──
		const exported = JSON.parse(backupJson) as { checksum?: string; data: Record<string, unknown> } & Record<string, unknown>
		expect((exported.data["imported-account-keys"] as unknown[]).length).toBe(1)
		// The doctored premise must be real: the blob carries balance row(s) for the account.
		const blobBalances = (exported.data["token-balance"] as Array<{ account?: string }>).filter((b) => b.account === importedAddress)
		expect(blobBalances.length).toBeGreaterThan(0)
		delete exported.data["imported-account-keys"]
		const { checksum: _stale, ...body } = exported
		const checksum = createHash("sha256").update(JSON.stringify(body)).digest("hex")
		const filePath = writeBackupToTemp(JSON.stringify({ ...body, checksum }), "doctored-keyless-import.json")

		// ── Stage 4: a FRESH extension imports the doctored backup ──
		const profileDir = mkdtempSync(join(tmpdir(), "nulo-orphan-e2e-"))
		const ctx2 = await launchExtension({ userDataDir: profileDir })
		try {
			const page2 = await openPopup(ctx2)
			await navigateByHash(page2, "#/popup/import", 15_000)
			await page2.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), { timeout: 15_000, polling: 300 })
			await page2.waitForSelector('[data-testid="import-option-full-backup"]', { visible: true, timeout: 15_000 })
			await clickByTestId(page2, "import-option-full-backup")
			const [chooser] = await Promise.all([
				page2.waitForFileChooser({ timeout: 10_000 }),
				clickByTestId(page2, "import-full-backup-pick-file"),
			])
			await chooser.accept([filePath])
			await page2.waitForSelector('[data-testid="import-full-backup-password-input"] input', { visible: true, timeout: 30_000 })
			await replaceInputValue(page2, '[data-testid="import-full-backup-password-input"]', TEST_PASSWORD)
			await replaceInputValue(page2, '[data-testid="import-full-backup-password-confirm-input"]', TEST_PASSWORD)
			await page2.waitForFunction(
				() => {
					const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-full-backup-submit-btn"]')
					return !!btn && !btn.disabled
				},
				{ timeout: 10_000 },
			)
			await clickByTestId(page2, "import-full-backup-submit-btn")

			// Settle via the actionable-screen idiom: general/auth are terminal; a
			// finished-with-errors screen is acknowledged via Continue.
			await page2.waitForFunction(
				() => {
					const h = window.location.hash
					if (h.includes("/popup/general") || h.includes("/popup/auth")) return true
					return !!document.querySelector('[data-testid="import-full-backup-continue-btn"]')
				},
				{ timeout: 300_000, polling: 250 },
			)
			if (await page2.evaluate(() => !!document.querySelector('[data-testid="import-full-backup-continue-btn"]'))) {
				await clickByTestId(page2, "import-full-backup-continue-btn")
				await page2.waitForFunction(
					() => window.location.hash.includes("/popup/general") || window.location.hash.includes("/popup/auth"),
					{ timeout: 60_000, polling: 250 },
				)
			}
			await reopenAndRecoverAfterImport(page2)

			// ── Stage 5: THE pin — the keyless account is gone AND so are its balance rows ──
			expect(await accountRowCountFor(page2, importedAddress)).toBe(0)
			const orphans = await balanceRowsFor(page2, importedAddress)
			// Pre-fix, the doctored restore left these rows behind (the orphan). The
			// registered awaited purge inside reconcileImportedAccounts removes them
			// BEFORE the Account row is deleted.
			expect(orphans).toEqual([])

			// ── Stage 6: re-import the same key — balances must start FRESH ──
			const beforeReimport = Date.now()
			const reviewed = await previewImport(page2, foreignBody)
			expect(reviewed).toBe(importedAddress)
			await confirmImport(page2)
			await page2.waitForFunction(
				async (root: string, addr: string) => {
					const all = await chrome.storage.local.get(null)
					return Object.entries(all).some(
						([k, v]) => k.startsWith(`${root}@`) && typeof v === "string" && (v as string).includes(addr),
					)
				},
				{ timeout: 60_000, polling: 500 },
				BALANCE_ROOT,
				importedAddress,
			)
			const fresh = await balanceRowsFor(page2, importedAddress)
			expect(fresh.length).toBeGreaterThan(0)
			for (const row of fresh) {
				// A reattached pre-deletion row would carry the OLD projection timestamp.
				expect(row.updatedAt === 0 || row.updatedAt >= beforeReimport).toBe(true)
			}

			expect(ctx2.pageErrors.filter((e) => !e.message.includes("Client disconnected"))).toEqual([])
		} finally {
			await ctx2.browser.close()
			rmSync(profileDir, { recursive: true, force: true })
			// The doctored file embeds the wallet's REAL (local-chain test) master key —
			// never leave it in the temp dir.
			rmSync(dirname(filePath), { recursive: true, force: true })
		}
	},
)
