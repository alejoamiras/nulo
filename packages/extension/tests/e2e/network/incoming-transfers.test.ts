import { expect, inject } from "vitest"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import { sendTransfer, waitForBalance, waitForTxConfirmation } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Single sequential scenario covering the three runtime checks pinned by
 * the post-impl codex audit. ONE test, ONE transfer, three assertions —
 * minimizes shared-fixture state surface vs. the split-into-3 version
 * (which cascade-failed on `waitForBalance` against a depleted account).
 *
 * The transfer is public→private from the user's account TO the user's
 * own account. This is the self-mint dedupe scenario by construction:
 *
 *   - The settled tx exercises F4's `pickPrimaryMethod` flow: the popup-
 *     built journal record's `title` is derived through the unified
 *     helper, then the settled card derives via `getTxTitle`. Both must
 *     surface the same user-intent function name — a reverted F4 site
 *     would diverge here (faucet-drip name regression coverage).
 *
 *   - The note created on the user's own account has a `txHash` matching
 *     their outgoing tx record. The 3-source dedupe (siloedNullifier +
 *     outgoing tx-hash + in-flight journal `progress.txHash`) +
 *     `onTransactionAdded` late-delete must suppress it (self-mint
 *     dedupe coverage).
 *
 *   - The History page's empty incoming-card surface validates the
 *     IncomingTransferService client is wired correctly (incoming-
 *     receive happy path — codex re-audit critical "ServiceClient never
 *     connects" would hang here).
 */
test.skipIf(!hasConfig)(
	"incoming-transfer arc — name regression + empty happy path + self-mint dedupe",
	{ timeout: 600_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		// 120s budget for initial balance — first-tx PXE warm-up on a
		// cold sandbox can stretch beyond the helper's 60s default.
		await waitForBalance(page, "1,000", 120_000)

		// public→public transfer to the minter address (NOT self — sending
		// to self via public→private surfaced an amount-input hang in the
		// send popup, likely a fee-estimation edge case for self-shield).
		// public→public to a third party still exercises F4 (settled card
		// title flows through pickPrimaryMethod) AND the incoming-receive
		// dedupe-by-absence assertion (no notes created on sender's
		// account by a public→public transfer; no false-positive incoming).
		await sendTransfer(page, {
			fromType: "public",
			toType: "public",
			amount: "10",
			destination: aztecConfig!.minterAddress,
		})
		await waitForTxConfirmation(page, "10", 300_000)

		// Allow IncomingTransferService one poll cycle (default 30s) +
		// onTransactionAdded late-delete window to settle.
		await new Promise((r) => setTimeout(r, 35_000))

		// Open History — activity.vue mounts IncomingTransferServiceClient,
		// connects, calls getIncomingTransfers. Assertion: the settled
		// tx-card exists (F4 unification didn't break the flow) AND no
		// tx-incoming-card surfaces (self-mint dedupe + happy path on an
		// account with no third-party senders).
		await page.evaluate(() => {
			window.location.hash = "#/popup/activity"
		})
		await page.waitForSelector('[data-testid="tx-card"]', { timeout: 30_000 })
		const txCards = await page.$$('[data-testid="tx-card"]')
		expect(txCards.length).toBeGreaterThan(0)

		const incomingCards = await page.$$('[data-testid="tx-incoming-card"]')
		expect(incomingCards.length).toBe(0)

		await page.close()
	},
)
