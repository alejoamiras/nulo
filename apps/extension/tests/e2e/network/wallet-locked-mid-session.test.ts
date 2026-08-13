import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { callExpectingNoPopup, snapshotResultSeq, waitForPgResult, assertPgOk } from "../fixtures/playground"
import { lockWallet } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #44 — wallet locked mid-session causes the next silent-path method
 * to error.
 *
 * Codex audit: sendTx (Transactions=5) goes popup-path even when locked,
 * because isConfirmationNeeded checks profile mismatch FIRST and returns
 * true. So we use a SILENT op (getChainInfo) to actually exercise the
 * silentInteraction path's profile-mismatch error at service.ts:201-205.
 */
test.skipIf(!hasConfig)(
	"wallet-locked-mid-session — silent op errors when wallet locks mid-flow",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		// Sanity: getChainInfo works while unlocked
		const beforeSeq = await snapshotResultSeq(page)
		await clickByTestId(page, "pg-btn-getChainInfo")
		const before = await waitForPgResult(page, "getChainInfo", beforeSeq, 15_000)
		await assertPgOk(page, before, "wallet-locked-mid-session:before")

		// Lock the wallet via the popup UI
		const popupPage = await openPopup(dappConnectedExtension)
		await waitForHash(popupPage, "#/popup/general")
		await lockWallet(popupPage)
		await popupPage.close()

		// Re-fire getChainInfo — silent path errors with "Wallet locked".
		// callExpectingNoPopup also asserts no popup opened.
		const result = await callExpectingNoPopup(dappConnectedExtension, page, "getChainInfo", async () => {
			await clickByTestId(page, "pg-btn-getChainInfo")
		})
		expect(result.status).toBe("error")
	},
)
