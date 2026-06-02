import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup, waitForSendTxActiveStage } from "../fixtures/popups"
import { mintPublicTokensForAccount, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #29 — sendTx default (account-bound). Always opens /windows/execute
 * (Transactions=5 >= confirmationLevel=5).
 *
 * Flow: tx cap pre-granted by fixture → set inputs → click → /windows/execute
 * opens with FeeSettingsCard (no fee preset) → user accepts default → wallet
 * journal-driven awaiting card transitions to `proving` stage.
 *
 * Uses `dappConnectedExtensionWithTransactionCap` so the cap-popup round-trip
 * happens during fixture setup (hookTimeout=300s) rather than in this test's
 * test budget.
 *
 * Asserts on `data-stage="proving"` instead of waiting on the dApp's full
 * sendTx promise — accelerator-server 1.0.1 only covers `createChonkProof`;
 * init/inner/reset/tail kernel proofs still run in-process via bb.js WASM
 * and exceed puppeteer's protocolTimeout on slow runners. Reaching the
 * `proving` stage validates wallet built + simulated + entered the prove
 * pipeline — exactly what popup-shape tests should check. See
 * implementations-plan/journal-stage-restructure/plan.md.
 */
test.skipIf(!hasConfig)(
	"tx-sendTx-default — popup opens, fee picker shown, confirm reaches journal active stage",
	{ timeout: 60_000 },
	async ({ dappConnectedExtensionWithTransactionCap }) => {
		const { playgroundPage: page, accountAddress } = dappConnectedExtensionWithTransactionCap

		// Pre-mint tokens to the dApp account so simulate succeeds (otherwise
		// the journal goes straight to `failed` and the awaiting card never
		// reaches an active stage — breaks waitForSendTxActiveStage).
		await mintPublicTokensForAccount(aztecConfig!, accountAddress)

		// Set inputs
		await page.evaluate(
			({ token, recipient }: { token: string; recipient: string }) => {
				const setVal = (sel: string, v: string) => {
					const input = document.querySelector<HTMLInputElement>(sel)
					if (!input) return
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
					setter?.call(input, v)
					input.dispatchEvent(new Event("input", { bubbles: true }))
				}
				setVal('[data-testid="pg-input-tokenAddress"]', token)
				setVal('[data-testid="pg-input-recipient"]', recipient)
				setVal('[data-testid="pg-input-amount"]', "1")
			},
			{ token: aztecConfig!.tokenAddress, recipient: aztecConfig!.minterAddress },
		)

		// Fire sendTx + drive the execute popup
		await snapshotResultSeq(page)
		const execPopupP = waitForPopup(dappConnectedExtensionWithTransactionCap, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-default")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)

		// Verify the op card shows aztec_sendTx
		const ops = await execPopup.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('[data-testid="execute-op-item"]')].map((el) => ({
				id: el.getAttribute("data-op-id"),
				kind: el.getAttribute("data-op-kind"),
			})),
		)
		expect(ops.length).toBe(1)
		expect(ops[0].kind).toBe("aztec_sendTx")

		await approveExecute(execPopup)

		// Wait for the wallet's journal to enter `proving` instead of the dApp's
		// full sendTx promise. See waitForSendTxActiveStage for rationale.
		const walletPopup = await openPopup(dappConnectedExtensionWithTransactionCap)
		await waitForSendTxActiveStage(walletPopup)
	},
)
