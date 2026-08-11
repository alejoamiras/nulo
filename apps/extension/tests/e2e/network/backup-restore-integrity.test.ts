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
 * The provenance filter is address-scoped across every account-owned slice, so
 * the doctored backup also carries a foreign-account AUTHWIT and a
 * foreign-account TOKEN-BALANCE row (both must be dropped) plus a funded-account
 * authwit (must survive).
 *
 * Finally it drives a delete → re-add round-trip (finding D): resetting the
 * profile fires the awaited deletion coordinator, which must purge every
 * account-owned root AND clear its durable tombstone (proving the cascade is
 * awaited to completion, not fire-and-forget), and a freshly-registered profile
 * must not resurrect the deleted account's tx.
 *
 * Coverage split (see the plan): P1's cross-profile WIPE is proven through the
 * real service graph in `src/wallet/services/cross-profile-isolation.test.ts`
 * (real Account+Transaction+onAccountDeleted cascade; only chrome.storage is a
 * FakeBrowserApi); P2 index-pairing + P3 composite key are unit-proven — a live
 * network-id collision and multi-node multi-chain restore aren't cheaply
 * forgeable in a single-sandbox e2e. This e2e adds the real-storage proof for
 * the provenance filter + deletion cascade + on-chain functionality.
 */
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, launchExtension, openPopup, registerProfile, replaceInputValue, test, waitForHash } from "../fixtures/extension"
import {
	captureBalanceBaseline,
	captureSoleProfileId,
	getAccountAddress,
	navigateByHash,
	reopenAndRecoverAfterImport,
	resetProfile,
	switchToLocalNetwork,
	waitForFreshBalanceRow,
	waitForProfilePurged,
	waitForTokenCardAmount,
} from "../fixtures/helpers"
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
	{ timeout: 900_000 },
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
		// The wallet seeds several networks and the funded account lives on exactly
		// ONE of them (NOT necessarily network[0]). Key the doctored tx to the
		// FUNDED ACCOUNT's own chainId so it matches the provenance allow-set's
		// (chainId, address) tuple — network[0] would be a different chain and the
		// tx would be (correctly) dropped as cross-chain.
		const backupAccounts = exported.data.account as Array<{ address: string; chainId: number }>
		const chainId =
			backupAccounts.find((a) => a.address === funded)?.chainId ?? (exported.data.network as Array<{ chainId: number }>)[0].chainId
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

		// A funded-account authwit must survive; a foreign-account one must be
		// dropped — auth-registry rows are address-scoped in the provenance filter.
		exported.data["auth-registry"] = [
			{ id: 1, account: funded, hash: `0x${"b2".repeat(32)}`, content: { kind: "call" } },
			{ id: 2, account: FOREIGN_ACCOUNT, hash: `0x${"c3".repeat(32)}`, content: { kind: "call" } },
		]
		// A foreign-account token-balance must be dropped. Append it (don't clobber
		// the wallet's real funded-account balances the export already carries).
		const existingBalances = (exported.data["token-balance"] as Array<Record<string, unknown>> | undefined) ?? []
		const someTokenId = (exported.data.token as Array<{ id: number }> | undefined)?.[0]?.id ?? 1
		exported.data["token-balance"] = [
			...existingBalances,
			{ id: 999_001, token: someTokenId, account: FOREIGN_ACCOUNT, publicBalance: "5", updatedAt: 1 },
		]

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

			// Authwit + token-balance provenance via RAW chrome.storage: a foreign
			// account's auth/balance rows were dropped before restore wrote them.
			const readAccounts = (prefix: string) =>
				page2.evaluate(async (p) => {
					const all = await chrome.storage.local.get()
					return Object.entries(all)
						.filter(([k]) => k.startsWith(p))
						.map(([, v]) => (JSON.parse(v as string) as { account: string }).account)
				}, prefix)
			const authAccounts = await readAccounts("nulo:core:auth-registry@")
			expect(authAccounts).toContain(funded)
			expect(authAccounts).not.toContain(FOREIGN_ACCOUNT)
			const balanceAccounts = await readAccounts("nulo:core:token-balances@")
			expect(balanceAccounts).not.toContain(FOREIGN_ACCOUNT)

			// ── 5. On-chain functionality ───────────────────────────────────
			// The imported backup already CARRIES the funded balance rows with a
			// nonzero updatedAt, so a value-only wait would pass with zero
			// post-import sync. Gate on FRESHNESS (updatedAt past the imported
			// baseline) + the exact raw value, then prove projection→render with a
			// card-scoped display assert. Same total envelope the old 40× spam +
			// text-scan spent (~150s); ≤5 refreshes, each only after the previous
			// projection observably finished.
			await switchToLocalNetwork(page2)
			expect(await getAccountAddress(page2)).toBe(funded)
			const importedBaseline = await captureBalanceBaseline(page2, funded)
			await waitForFreshBalanceRow(page2, {
				account: funded,
				expectedPublicRaw: (1000n * 10n ** 18n).toString(),
				baselineUpdatedAt: importedBaseline,
				timeoutMs: 150_000,
			})
			await waitForTokenCardAmount(page2, "1,000")

			// ── 5b. Realistic-recovery leg ──────────────────────────────────
			// Model the strict-mode + MV3-worker-restart path: the in-memory master
			// is dropped and re-derived on unlock, which re-provisions the encrypted
			// per-chain PXE store key and re-opens the OPFS store. Prove the store
			// re-opened (never wiped — refuse-and-preserve) by a FRESH post-reopen
			// re-projection of the SAME on-chain balance (baseline recaptured after
			// the reopen so step 5's projection can't satisfy this leg).
			await reopenAndRecoverAfterImport(page2)
			expect(await getAccountAddress(page2)).toBe(funded)
			const reopenBaseline = await captureBalanceBaseline(page2, funded)
			await waitForFreshBalanceRow(page2, {
				account: funded,
				expectedPublicRaw: (1000n * 10n ** 18n).toString(),
				baselineUpdatedAt: reopenBaseline,
				timeoutMs: 90_000,
			})
			await waitForTokenCardAmount(page2, "1,000")

			// ── 6. Delete → re-add round-trip (finding D) ──────────────────────
			// The reset UI AWAITS the coordinator's full purge before navigating
			// (reset.vue handleReset awaits deleteProfile), so observe the purge
			// itself FIRST — profile row (proven to exist pre-submit) + exact
			// tombstone + owned roots all cleared — and only then assert the
			// redirect, which is prompt once the awaited delete resolved. The old
			// shape waited on the route while the purge ran, racing an awaited
			// cascade with a wait budgeted for a navigation.
			const deletedProfileId = await captureSoleProfileId(page2)
			await resetProfile(page2)
			await waitForProfilePurged(page2, deletedProfileId, {
				ownedRoots: ["nulo:core:txs", "nulo:core:accounts", "nulo:core:tokens"],
				timeoutMs: 75_000,
			})
			await page2.waitForFunction(() => window.location.hash.includes("/popup/register"), { timeout: 15_000 })
			await page2.close()

			// Re-add a fresh profile; the deleted funded-account tx must not reappear.
			await registerProfile(ctx2)
			const page3 = await openPopup(ctx2)
			const resurrectedTx = await page3.evaluate(async () => {
				const all = await chrome.storage.local.get()
				return Object.keys(all).some((k) => k.startsWith("nulo:core:txs@"))
			})
			expect(resurrectedTx).toBe(false)
			await page3.close()
		} finally {
			await ctx2.browser.close()
			rmSync(profileDir, { recursive: true, force: true })
			// The doctored file embeds the wallet's REAL (local-chain test) master-key.
			rmSync(dirname(filePath), { recursive: true, force: true })
		}
	},
)
