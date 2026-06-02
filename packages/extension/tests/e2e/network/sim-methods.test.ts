import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup } from "../fixtures/playground"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Tests #23-#25 — canonical simulation methods (simulateTx, profileTx,
 * executeUtility) are silent on default sessions (PrivateData=4 < confLevel=5).
 *
 * Each parametrized case: set token + recipient inputs, click the method's
 * button, assert callExpectingNoPopup result.
 *
 * Uses `dappConnectedExtensionWithAccountsCap` so the cap-popup round-trip
 * happens during fixture setup (hookTimeout=300s) rather than during this
 * test's budget. Mirrors the pattern landed in `register-token.test.ts`
 * (PR #63). Pre-fix, sim-profileTx (#24) was the residual cap-popup-class
 * flake observed during PR #67's first CI run — the fixture migration is
 * the structural fix per accelerator-server-ci/lessons/phase-1.md.
 */
const cases: Array<{ id: number; name: string; method: string; btn: string }> = [
	{ id: 23, name: "simulateTx", method: "simulateTx", btn: "pg-btn-simulateTx-transfer" },
	{ id: 24, name: "profileTx", method: "profileTx", btn: "pg-btn-profileTx" },
	{ id: 25, name: "executeUtility", method: "executeUtility", btn: "pg-btn-executeUtility-balance" },
]

for (const c of cases) {
	test.skipIf(!hasConfig)(
		`sim-${c.name} (#${c.id}) — silent path returns ok or error`,
		{ timeout: 60_000 },
		async ({ dappConnectedExtensionWithAccountsCap }) => {
			const { playgroundPage: page } = dappConnectedExtensionWithAccountsCap

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

			const result = await callExpectingNoPopup(dappConnectedExtensionWithAccountsCap, page, c.method, async () => {
				await clickByTestId(page, c.btn)
			})
			expect(["ok", "error"]).toContain(result.status)
		},
	)
}
