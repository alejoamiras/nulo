import { inject, expect } from "vitest"
import { test, openPopup, waitForHash, clickByTestId } from "../fixtures/extension"
import {
	sendTransfer,
	waitForBalance,
	waitForTxConfirmation,
	navigateToTokenDetail,
	getTokenDetailBalances,
	waitForTokenDetailBalances,
	clickNavTab,
} from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * One sequential scenario, not eight independent tests.
 *
 * Aztec uses nullifiers, so the 4 transfer txs MUST run in order — each
 * consumes prior state. The original split-into-8-tests version inflated
 * a single mid-flow frame detach into 7 cascade failures because the
 * file-scoped fixture's browser stayed broken for subsequent tests. As
 * one scenario test, a single detach now surfaces as one honest fail.
 *
 * NO retry:1 here on purpose. The file-scoped `tokenReadyExtension`
 * initializes once per file (vitest fixture-scope semantics); a retry
 * would re-run the scenario against partially-mutated on-chain state
 * from the failed attempt, so step 1 ("balance shows 1,000") would fail
 * against a depleted account for a different reason than the original
 * failure. Codex audit session 019e2b9b flagged this. The scenario
 * collapse is the cascade fix on its own; retry on top would be
 * misleading green.
 *
 * Total wall budget: 600s. Empirical full-pass duration is ~140s; the
 * extra headroom absorbs cold-PXE first-tx prove time on slow machines.
 */
test.skipIf(!hasConfig)(
	"transfers scenario — mint, 4 transfer types, token detail, send entry, activity history",
	{ timeout: 600_000 },
	async ({ tokenReadyExtension }) => {
		// ── Step 1: initial balance shows minted tokens ──────────────────
		{
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general")
			await waitForBalance(page, "1,000", 60_000)
			console.log("✓ Initial balance: 1,000 public tokens")
			await page.close()
		}

		// ── Step 2: public → public transfer (10) ────────────────────────
		{
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general")
			await sendTransfer(page, {
				fromType: "public",
				toType: "public",
				amount: "10",
				destination: tokenReadyExtension.accountAddress,
			})
			console.log("✓ Public → Public submitted")
			await waitForTxConfirmation(page, { amount: "10", fromType: "public", toType: "public" })
			console.log("✓ Tx confirmed")
			await page.close()
		}

		// ── Step 3: public → private (shield) transfer (100) ─────────────
		{
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general")
			await sendTransfer(page, {
				fromType: "public",
				toType: "private",
				amount: "100",
				destination: tokenReadyExtension.accountAddress,
			})
			console.log("✓ Public → Private (shield) submitted")
			await waitForTxConfirmation(page, { amount: "100", fromType: "public", toType: "private" })
			console.log("✓ Shield tx confirmed")
			await waitForBalance(page, "Priv", 60_000)
			console.log("✓ Private balance visible")
			await page.close()
		}

		// ── Step 4: private → public (unshield) transfer (50) ────────────
		{
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general")
			await sendTransfer(page, {
				fromType: "private",
				toType: "public",
				amount: "50",
				destination: tokenReadyExtension.accountAddress,
			})
			console.log("✓ Private → Public (unshield) submitted")
			await waitForTxConfirmation(page, { amount: "50", fromType: "private", toType: "public" })
			console.log("✓ Unshield tx confirmed")
			await page.close()
		}

		// ── Step 5: private → private transfer (10) ──────────────────────
		{
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general")
			await sendTransfer(page, {
				fromType: "private",
				toType: "private",
				amount: "10",
				destination: tokenReadyExtension.accountAddress,
			})
			console.log("✓ Private → Private submitted")
			await waitForTxConfirmation(page, { amount: "10", fromType: "private", toType: "private" })
			console.log("✓ Tx confirmed")
			await page.close()
		}

		// ── Step 6: token detail shows correct post-transfer balances ────
		{
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general")
			await navigateToTokenDetail(page)
			// SponsoredFPC: balances aren't affected by gas fees.
			// pub→pub 10 (net 0), pub→priv 100 (-100/+100), priv→pub 50 (+50/-50), priv→priv 10 (net 0)
			// Expected: public=950, private=50.
			// Use waitForTokenDetailBalances to force a refresh + poll past the
			// async TokenBalanceService projection lag under full-suite load.
			const { privateBalance, publicBalance } = await waitForTokenDetailBalances(page, {
				publicContains: "950",
				privateContains: "50",
			})
			console.log(`Token detail balances — public: "${publicBalance}", private: "${privateBalance}"`)
			expect(publicBalance).toContain("950")
			expect(privateBalance).toContain("50")
			console.log("✓ Token detail balances correct (pub=950, priv=50)")
			await page.close()
		}

		// ── Step 7: Send entry from token detail page loads token correctly ──
		{
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general")
			await navigateToTokenDetail(page)
			await page.waitForSelector('[data-testid="actions-send"]', { visible: true, timeout: 10_000 })
			await page.evaluate(() => document.querySelector('[data-testid="actions-send"]')?.scrollIntoView({ block: "center" }))
			await clickByTestId(page, "actions-send")
			// SendPopup mounted — send-from-type proves the token loaded
			// (if the bug were present, we'd see "No available tokens" instead).
			await page.waitForSelector('[data-testid="send-from-type"]', { timeout: 15_000 })
			await clickByTestId(page, "send-from-type")
			const hasAmountInput = await page.evaluate(() => !!document.querySelector('[data-testid="send-amount-input"]'))
			expect(hasAmountInput).toBe(true)
			const bodyText = await page.evaluate(() => document.body.innerText)
			expect(bodyText).not.toContain("No available tokens")
			console.log("✓ Send from token detail page loads token correctly")
			await page.keyboard.press("Escape")
			await page.close()
		}

		// ── Step 8: activity tab lists the 4 transfers ───────────────────
		{
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general")
			await clickNavTab(page, "activity")
			await page.waitForFunction(() => window.location.hash.includes("#/popup/activity"), { timeout: 5_000 })
			await page.waitForSelector('[data-testid="tx-card"]', { visible: true, timeout: 30_000 })
			// At least 4 from the transfer chain (PXE may lag on some).
			const txCount = await page.evaluate(() => document.querySelectorAll('[data-testid="tx-card"]').length)
			console.log(`[activity] Found ${txCount} transaction cards`)
			expect(txCount).toBeGreaterThanOrEqual(4)
			console.log("✓ Transaction history shows completed transfers")
			await page.close()
		}
	},
)
