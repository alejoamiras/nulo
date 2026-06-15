import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
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
	"tx-sendTx-default — popup opens, fee picker shown, confirm submits with real proof (prover-ON canary)",
	{ timeout: 360_000 },
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
		const seqTx = await snapshotResultSeq(page)
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

		// Prover-ON canary (this file runs in the real-proving canary job, NOT the
		// proverless pool): wait through the REAL prove to submit and assert the
		// node accepted the real proof. The playground hard-codes `wait: "NO_WAIT"`
		// (transactions.ts), so the dApp result settles at submit — `txHash`
		// present is the direct signal the node validated a real BB proof at
		// `node.sendTx` (block-mine is not awaited). 300s budget covers the real
		// prove on a dedicated runner. Under proverless this still passes (fast
		// submit) — that's the local assertion-logic check; the real-prove timing
		// is exercised in CI.
		const result = await waitForPgResult(page, "sendTx", seqTx, 300_000)
		expect(result.status).toBe("ok")
		expect(typeof (result.resultJson as { txHash?: string } | undefined)?.txHash).toBe("string")
	},
)
