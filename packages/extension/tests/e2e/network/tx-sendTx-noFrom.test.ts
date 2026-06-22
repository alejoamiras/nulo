import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #30 — sendTx with `from: "NO_FROM"` routes through DefaultEntrypoint
 * instead of the account contract. dispatcher.ts:82-88,334-348 sets
 * executionMode: "default_entrypoint", which makes the popup show the
 * "fee set by app" badge (no fee picker; embedded paymentMethod).
 *
 * Uses `dappConnectedExtensionWithTransactionCap` so the cap-popup
 * round-trip happens in fixture setup (hookTimeout=300s).
 *
 * Unlike the other restructured sendTx tests, this one does NOT wait on a
 * journal stage. The playground's `pg-btn-sendTx-noFrom` calls
 * `transfer_public_to_public` (a PUBLIC function), and `buildNoFrom` throws
 * `DefaultEntrypoint only supports private functions` (tx-request-builder.ts:429).
 * The journal moves simulating → failed in seconds; the awaiting card unmounts
 * before `openPopup` finishes loading, making a `data-stage` poll impossible.
 *
 * The test's actual intent is the popup-shape (fee-set badge appears). The
 * tolerant `waitForPgResult` matches the pre-restructure pattern (PR #46) and
 * confirms the wallet returned a sendTx response (ok OR error — both indicate
 * the wallet processed the click).
 */
test.skipIf(!hasConfig)(
	"tx-sendTx-noFrom — popup shows fee-set badge, no fee picker",
	{ timeout: 60_000 },
	async ({ dappConnectedExtensionWithTransactionCap }) => {
		const page = dappConnectedExtensionWithTransactionCap.playgroundPage

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

		const seqTx = await snapshotResultSeq(page)
		const execPopupP = waitForPopup(dappConnectedExtensionWithTransactionCap, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-noFrom")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)

		// Fee-set badge should be present (executionMode: default_entrypoint)
		const hasFeeBadge = await execPopup.evaluate(() => !!document.querySelector('[data-testid="execute-op-fee-set-badge"]'))
		expect(hasFeeBadge).toBe(true)

		await approveExecute(execPopup)

		// Tolerant wait: NO_FROM with a public function throws fast during
		// build. Either an "ok" (unlikely with public fn) or "error" status
		// confirms the wallet processed the request.
		const result = await waitForPgResult(page, "sendTx", seqTx, 30_000)
		expect(["ok", "error"]).toContain(result.status)
	},
)
