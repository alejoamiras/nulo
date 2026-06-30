import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup } from "../fixtures/playground"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #38 — scope + cap rejection paths (parameterized).
 *
 * Cases covered:
 *   - capability not granted at all (e.g. simulateTx without simulation cap)
 *   - account not authorized (sendTx-style call without accounts cap)
 *
 * dispatcher.ts:553-568 throws "Capability X not granted" before the popup
 * decision, so these resolve as `error` SILENTLY — no /windows/execute opens.
 *
 * Scope-violation tests (e.g. transaction-scoped + out-of-scope call) need
 * a transaction cap with a specific scope — those are TODO for follow-up
 * since they require more elaborate playground bundle wiring per call.
 */
const cases: Array<{ id: string; name: string; method: string; btn: string }> = [
	{ id: "no-cap-simulateTx", name: "simulateTx without simulation cap", method: "simulateTx", btn: "pg-btn-simulateTx-transfer" },
	{
		id: "no-cap-executeUtility",
		name: "executeUtility without simulation cap",
		method: "executeUtility",
		btn: "pg-btn-executeUtility-balance",
	},
]

for (const c of cases) {
	test.skipIf(!hasConfig)(`err-${c.id} (#38) — silent error before popup`, { timeout: 60_000 }, async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		// Set inputs (some methods need them even to fail cleanly)
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

		// No capability granted yet — call should error before any popup
		const result = await callExpectingNoPopup(dappConnectedExtension, page, c.method, async () => {
			await clickByTestId(page, c.btn)
		})
		expect(result.status).toBe("error")
	})
}
