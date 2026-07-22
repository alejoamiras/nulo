/**
 * Phase 5 behavioral ship gate for implementations-plan/incoming-public-transfers.
 *
 * A second account (the token minter) delivers PUBLIC receipts to the wallet account and the
 * extension must, WITHOUT a manual refresh:
 *   1. pub→pub (`transfer_public_to_public`)  → a `tx-incoming-card` row with the "Public → Public"
 *      kind chip, AND the token's PUBLIC balance auto-updates (the D4 outbox-drain pin).
 *   2. priv→pub (`transfer_private_to_public`) → a "Private → Public" chip (`from == MAGIC`).
 *   3. pub→priv to us (`transfer_public_to_private`) → the private note arm shows "Received
 *      privately", sender redacted (D7 dropped — no public receipt, since the public leg is `to ==
 *      MAGIC`).
 *
 * Receipt assertions get a >=120s budget — the default 30s test timeout EQUALS the scheduler
 * interval, so a receipt could time out on the very first idle tick.
 */
import { expect, inject } from "vitest"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import { getAccountAddress, getTokenDetailBalances, navigateByHash, navigateToTokenDetail, switchToLocalNetwork } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const D = 10n ** 18n

/** Poll the activity feed for an incoming card whose kind chip equals `label` (no manual refresh). */
async function waitForKindChip(page: Awaited<ReturnType<typeof openPopup>>, label: string, timeout = 180_000): Promise<void> {
	await navigateByHash(page, "#/popup/activity")
	await page.waitForSelector('[data-testid="tx-incoming-card"]', { visible: true, timeout }).catch(() => {})
	await page.waitForFunction(
		(lbl) => [...document.querySelectorAll('[data-testid="tx-incoming-kind-chip"]')].some((c) => (c.textContent || "").trim() === lbl),
		{ timeout, polling: 1_000 },
		label,
	)
}

test.skipIf(!hasConfig)(
	"incoming PUBLIC receipts: pub→pub (+ auto balance), priv→pub, and pub→priv (Received privately)",
	{ timeout: 900_000 },
	async ({ tokenReadyExtension }) => {
		if (!aztecConfig) throw new Error("unreachable — skipIf guards")
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		await switchToLocalNetwork(page)
		const walletAddress = await getAccountAddress(page)

		// ── Node-side setup: the minter (external second account) gets both public + private balance.
		const {
			createTestWallet,
			createSponsoredFeeOptions,
			mintPublicTokens,
			mintPrivateTokens,
			transferPublicTokens,
			transferPrivateToPublicTokens,
			transferPublicToPrivateTokens,
		} = await import("../fixtures/aztec")
		const { wallet, node, cleanup } = await createTestWallet(aztecConfig.nodeUrl)
		try {
			const feeOptions = await createSponsoredFeeOptions(wallet)
			const minter = aztecConfig.minterAddress
			await mintPublicTokens(wallet, aztecConfig.tokenAddress, minter, 500n * D, minter, feeOptions)
			await mintPrivateTokens(wallet, node, aztecConfig.tokenAddress, minter, 500n * D, minter, feeOptions)

			// ── Case 1: pub→pub → "Public → Public" chip + auto public-balance refresh (D4).
			await transferPublicTokens(wallet, aztecConfig.tokenAddress, minter, walletAddress, 10n * D, feeOptions)
			await waitForKindChip(page, "Public → Public")
			console.log("✓ pub→pub receipt row + 'Public → Public' chip")

			// The wallet started at 1000 public (tokenReadyExtension). D4: it auto-refreshes to 1010
			// with NO manual refresh click — just the scheduler's scan → outbox → drain.
			await navigateToTokenDetail(page)
			await page.waitForFunction(
				() => {
					const el = document.querySelector('[data-testid="public-balance-value"]')
					return (el?.textContent || "").replace(/[,\s]/g, "").includes("1010")
				},
				{ timeout: 180_000, polling: 1_000 },
			)
			const balances = await getTokenDetailBalances(page)
			expect(balances.publicBalance.replace(/[,\s]/g, "")).toBe("1010")
			console.log("✓ D4: public balance auto-refreshed 1000 → 1010 without a manual refresh")

			// ── Case 2: priv→pub → "Private → Public" chip (from == MAGIC).
			await transferPrivateToPublicTokens(wallet, node, aztecConfig.tokenAddress, minter, walletAddress, 20n * D, feeOptions)
			await waitForKindChip(page, "Private → Public")
			console.log("✓ priv→pub receipt row + 'Private → Public' chip")

			// ── Case 3: pub→priv to us → the note arm shows "Received privately" (no public receipt).
			await transferPublicToPrivateTokens(wallet, node, aztecConfig.tokenAddress, minter, walletAddress, 30n * D, feeOptions)
			await waitForKindChip(page, "Received privately")
			console.log("✓ pub→priv receipt shown as 'Received privately' (sender redacted, D7 dropped)")
		} finally {
			await cleanup()
			await page.close()
		}
	},
)
