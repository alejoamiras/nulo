import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { waitForDappExecuteWorked } from "../fixtures/journal"
import { mintPublicTokensForAccount, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Tests #32 + #33 — sendTx multi-call variants.
 *
 * #32 multicall (3 calls): standard BatchCall pattern.
 * #33 multicall >5 (7 calls): triggers nulo-account.ts recursive chunking
 *     (CLAUDE.md mentions 5-call chunk wrapping). Verifies the popup still
 *     renders + the wallet handles the chunked authwit path.
 *
 * Uses `dappConnectedExtensionWithTransactionCap` so the cap-popup round-trip
 * happens during fixture setup (hookTimeout=300s) rather than during this
 * test's budget. Mirrors register-token.test.ts (PR #63) + tx-sendTx-default
 * (PR #64). The fixture grants the transaction bundle for a single account;
 * multicall does N calls FROM THAT ONE ACCOUNT, not N accounts.
 *
 * Asserts on `data-stage="proving"` (wallet popup) instead of the dApp's
 * full sendTx promise. See implementations-plan/journal-stage-restructure/.
 * Per-test retry removed (per audit "zero retries" acceptance gate).
 */
const cases: Array<{ id: number; name: string; btn: string }> = [
	{ id: 32, name: "multicall", btn: "pg-btn-sendTx-multicall" },
	{ id: 33, name: "multicall-chunked", btn: "pg-btn-sendTx-multicall-chunked" },
]

for (const c of cases) {
	test.skipIf(!hasConfig)(
		`tx-sendTx-${c.name} (#${c.id}) — popup opens, multiple payload rows, reaches active stage`,
		{ timeout: 90_000 },
		async ({ dappConnectedExtensionWithTransactionCap }) => {
			const { playgroundPage: page, accountAddress } = dappConnectedExtensionWithTransactionCap

			// Pre-mint enough tokens to cover the multicall (3 or 7 × 1-token transfers).
			await mintPublicTokensForAccount(aztecConfig!, accountAddress)

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

			await snapshotResultSeq(page)
			const execPopupP = waitForPopup(dappConnectedExtensionWithTransactionCap, "execute", { timeout: 30_000 })
			await clickByTestId(page, c.btn)
			const execPopup = await execPopupP
			await waitForExecuteContent(execPopup)

			const payloadRows = await execPopup.evaluate(() => document.querySelectorAll('[data-testid="execute-op-payload-row"]').length)
			expect(payloadRows).toBeGreaterThanOrEqual(c.id === 33 ? 7 : 3)

			await approveExecute(execPopup)

			// Wait for the wallet's journal to enter `proving` — fast (<10s)
			// even for the chunked variant, since the kernel-prove tail (which
			// dominates) doesn't gate this stage transition.
			const walletPopup = await openPopup(dappConnectedExtensionWithTransactionCap)
			await waitForDappExecuteWorked(walletPopup)
		},
	)
}
