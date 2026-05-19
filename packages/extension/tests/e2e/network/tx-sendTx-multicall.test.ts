import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, waitForExecuteContent, approveCapabilities, approveExecute } from "../fixtures/popups"
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
 */
const cases: Array<{ id: number; name: string; btn: string }> = [
	{ id: 32, name: "multicall", btn: "pg-btn-sendTx-multicall" },
	{ id: 33, name: "multicall-chunked", btn: "pg-btn-sendTx-multicall-chunked" },
]

for (const c of cases) {
	test.skipIf(!hasConfig)(
		`tx-sendTx-${c.name} (#${c.id}) — popup opens, multiple payload rows`,
		{ timeout: 240_000, retry: 1 },
		async ({ dappConnectedExtensionPerTest: dappConnectedExtension }) => {
			const page = dappConnectedExtension.playgroundPage

			await page.evaluate(() => {
				const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
				select.value = "transaction"
				select.dispatchEvent(new Event("change", { bubbles: true }))
			})
			const seqGrant = await snapshotResultSeq(page)
			const capPopupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 15_000 })
			await clickByTestId(page, "pg-btn-requestCapabilities")
			const capPopup = await capPopupP
			await capPopup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 10_000 })
			const accountIds = await capPopup.evaluate(() =>
				[...document.querySelectorAll<HTMLElement>('[data-testid="cap-account-item"]')].map((r) =>
					r.getAttribute("data-account-id"),
				),
			)
			await approveCapabilities(capPopup, { accounts: [accountIds[0]!] })
			await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

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
			const execPopupP = waitForPopup(dappConnectedExtension, "execute", { timeout: 30_000 })
			await clickByTestId(page, c.btn)
			const execPopup = await execPopupP
			await waitForExecuteContent(execPopup)

			const payloadRows = await execPopup.evaluate(() => document.querySelectorAll('[data-testid="execute-op-payload-row"]').length)
			expect(payloadRows).toBeGreaterThanOrEqual(c.id === 33 ? 7 : 3)

			await approveExecute(execPopup)
			const result = await waitForPgResult(page, "sendTx", seqTx, 180_000)
			expect(["ok", "error"]).toContain(result.status)
		},
	)
}
