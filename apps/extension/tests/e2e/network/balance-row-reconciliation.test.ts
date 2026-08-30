/**
 * A token whose balance row is gone must come back on the next service-worker
 * boot, and must get a real projection — not just a placeholder row.
 *
 * The gap this repairs is produced in production by an MV3 worker death inside
 * `createTokenBalance`, between the token row landing and its balance backfill.
 * Seeding the gap directly is deliberate: parking a worker mid-write and killing
 * it there proves MV3 nondeterminism, not the recovery that actually shipped.
 *
 * Two false-passes this spec is built to avoid:
 *  - `waitForFreshBalanceRow` re-kicks `refreshBalances` unless `maxRefreshes: 0`,
 *    so without that the assertion proves an explicit refresh rather than the
 *    boot enqueue.
 *  - `TokensView` does not refetch on the balance client's reconnect, so an
 *    already-open popup keeps rendering its pre-deletion card. The popup is
 *    reopened before the card is asserted.
 */

import { expect, inject } from "vitest"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import { stopServiceWorker, waitForFreshBalanceRow, waitForTokenCardAmount } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const BALANCE_ROOT = "nulo:core:token-balances"

test.skipIf(!hasConfig)(
	"a token whose balance row vanished is repaired and re-projected on the next worker boot",
	{ timeout: 240_000 },
	async ({ tokenReadyExtension }) => {
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")

		// The fixture minted 1000 tokens and imported them, so a projected row
		// exists before anything is deleted.
		await waitForTokenCardAmount(page, "1,000", "TST", 60_000)

		const deleted = await page.evaluate(async (root: string) => {
			const all = await chrome.storage.local.get(null)
			const keys = Object.keys(all).filter((k) => k.startsWith(`${root}@`))
			await chrome.storage.local.remove(keys)
			return keys.length
		}, BALANCE_ROOT)
		expect(deleted, "fixture should have left at least one balance row to delete").toBeGreaterThan(0)

		// Prove the gap is real before relying on the repair.
		const remaining = await page.evaluate(async (root: string) => {
			const all = await chrome.storage.local.get(null)
			return Object.keys(all).filter((k) => k.startsWith(`${root}@`)).length
		}, BALANCE_ROOT)
		expect(remaining).toBe(0)

		await page.close()
		await stopServiceWorker(tokenReadyExtension)

		// Opening the popup wakes the worker; init's sweep runs before any balance
		// RPC can resolve, because the service is not marked initialized until it
		// completes.
		const reopened = await openPopup(tokenReadyExtension)
		await waitForHash(reopened, "#/popup/general")

		const accountAddress = tokenReadyExtension.accountAddress
		// maxRefreshes: 0 — the row must be projected by the boot enqueue alone.
		await waitForFreshBalanceRow(reopened, {
			account: accountAddress,
			tokenContract: aztecConfig!.tokenAddress,
			expectedPublicRaw: (1000n * 10n ** 18n).toString(),
			baselineUpdatedAt: 0,
			maxRefreshes: 0,
			timeoutMs: 90_000,
		})

		// Exactly one row for the pair — the sweep must repair, not duplicate.
		const rowCount = await reopened.evaluate(async (root: string) => {
			const all = await chrome.storage.local.get(null)
			return Object.keys(all).filter((k) => k.startsWith(`${root}@`)).length
		}, BALANCE_ROOT)
		expect(rowCount).toBe(1)

		await waitForTokenCardAmount(reopened, "1,000", "TST", 60_000)
		expect(tokenReadyExtension.pageErrors).toEqual([])
	},
)
