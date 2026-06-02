import { expect, inject } from "vitest"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import { sendTransfer, waitForBalance, waitForTxConfirmation } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Single sequential scenario covering three runtime checks pinned by the
 * post-impl codex audit. ONE test, not three independent tests — Aztec
 * uses nullifiers, so a token-balance scenario MUST run in order, each
 * step consuming prior state. The split-into-3-tests version inflated
 * a single shared-fixture mid-flow timeout into 2 cascade failures
 * (state-dependent `waitForBalance` against the wrong amount), the same
 * cascade pattern the `transfers.test.ts` collapse documented.
 *
 * Checks (executed in order):
 *
 *   1. **faucet-drip name regression** — F4's `pickPrimaryMethod`
 *      unification across the 7 sites must not break the card title
 *      flow. After a public→public transfer settles, the History page
 *      shows a `tx-card` row. The card's title is derived via the
 *      shared helper that filters FEE_METHODS — a reverted site would
 *      surface the wallet's fee-payment method name in the title.
 *
 *   2. **incoming-receive happy path** — IncomingTransferService's
 *      popup-side client is reachable + returns the expected empty
 *      list when the user has received no third-party notes. Validates
 *      the codex re-audit critical (ServiceClient never connects)
 *      doesn't regress.
 *
 *   3. **self-mint dedupe** — public→private self-transfer creates a
 *      private note on the user's own account; its txHash matches the
 *      outgoing tx record. The 3-source dedupe + onTransactionAdded
 *      late-delete must suppress it. After the tx settles + one poll
 *      cycle, the History page must NOT show a `tx-incoming-card`
 *      for this tx.
 */
test.skipIf(!hasConfig)(
	"incoming-transfer arc — name regression + empty happy path + self-mint dedupe",
	{ timeout: 600_000 },
	async ({ tokenReadyExtension }) => {
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		await waitForBalance(page, "1,000", 60_000)

		// ── Check 1: outgoing public→public transfer settles + History
		//             shows the tx-card row (faucet-drip name regression).
		await sendTransfer(page, {
			fromType: "public",
			toType: "public",
			amount: "5",
			destination: aztecConfig!.minterAddress,
		})
		await waitForTxConfirmation(page, "5", 180_000)

		await page.evaluate(() => {
			window.location.hash = "#/popup/activity"
		})
		await page.waitForSelector('[data-testid="tx-card"]', { timeout: 30_000 })
		const txCards = await page.$$('[data-testid="tx-card"]')
		expect(txCards.length).toBeGreaterThan(0)

		// ── Check 2: no incoming-receive rows on a fresh profile
		//             (incoming-receive happy path — IncomingTransferService
		//             client is reachable and reports an empty list because
		//             no third party has sent to this account).
		const incomingCardsHappy = await page.$$('[data-testid="tx-incoming-card"]')
		expect(incomingCardsHappy.length).toBe(0)

		// ── Check 3: drive a public→private self-transfer. The note that
		//             lands on the user's own account has a txHash matching
		//             the outgoing tx record; dedupe must suppress it.
		await page.evaluate(() => {
			window.location.hash = "#/popup/general"
		})
		await waitForHash(page, "#/popup/general")
		await sendTransfer(page, {
			fromType: "public",
			toType: "private",
			amount: "10",
			destination: tokenReadyExtension.accountAddress,
		})
		await waitForTxConfirmation(page, "10", 180_000)

		// Allow IncomingTransferService one full poll cycle (default 30s)
		// + late-delete-on-onTransactionAdded reconciliation. If the dedupe
		// regresses, an incoming-card would be inserted then deleted; the
		// 35s window covers both edges.
		await new Promise((r) => setTimeout(r, 35_000))

		await page.evaluate(() => {
			window.location.hash = "#/popup/activity"
		})
		await new Promise((r) => setTimeout(r, 2_000))
		const incomingCardsDedupe = await page.$$('[data-testid="tx-incoming-card"]')
		expect(incomingCardsDedupe.length).toBe(0)

		await page.close()
	},
)
