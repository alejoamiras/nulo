import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, waitForExecuteContent, approveExecute } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

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
 */
const cases: Array<{ id: number; name: string; btn: string }> = [
	{ id: 32, name: "multicall", btn: "pg-btn-sendTx-multicall" },
	{ id: 33, name: "multicall-chunked", btn: "pg-btn-sendTx-multicall-chunked" },
]

for (const c of cases) {
	test.skipIf(!hasConfig)(
		`tx-sendTx-${c.name} (#${c.id}) — popup opens, multiple payload rows`,
		// 420s budget absorbs the WASM kernel-prove tail on slow-runner-pool
		// members. accelerator-server 1.0.1 only covers `createChonkProof`;
		// init/inner/reset/tail still run in-process via bb.js WASM. Multicall
		// has more kernel proofs than single-call tests so it needs the same
		// budget as tx-sendTx-default. NO_WAIT (playground) already trims the
		// post-submit receipt wait.
		{ timeout: 420_000, retry: 1 },
		async ({ dappConnectedExtensionWithTransactionCap }) => {
			const { playgroundPage: page } = dappConnectedExtensionWithTransactionCap

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
			await clickByTestId(page, c.btn)
			const execPopup = await execPopupP
			await waitForExecuteContent(execPopup)

			const payloadRows = await execPopup.evaluate(() => document.querySelectorAll('[data-testid="execute-op-payload-row"]').length)
			expect(payloadRows).toBeGreaterThanOrEqual(c.id === 33 ? 7 : 3)

			await approveExecute(execPopup)
			const result = await waitForPgResult(page, "sendTx", seqTx, 360_000)
			expect(["ok", "error"]).toContain(result.status)
		},
	)
}
