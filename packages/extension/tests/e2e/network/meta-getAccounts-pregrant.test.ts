import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup } from "../fixtures/playground"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #11 — getAccounts before any accounts cap is granted returns [].
 *
 * `dispatcher.ts:240` returns [] when the dApp session has no accounts.
 * Verifies the silent-path behavior + the empty-array contract.
 */
test.skipIf(!hasConfig)(
	"meta-getAccounts-pregrant — empty array before accounts cap granted",
	{ timeout: 60_000, retry: 1 },
	async ({ dappConnectedExtension }) => {
		const result = await callExpectingNoPopup(
			dappConnectedExtension,
			dappConnectedExtension.playgroundPage,
			"getAccounts",
			async () => {
				await clickByTestId(dappConnectedExtension.playgroundPage, "pg-btn-getAccounts")
			},
		)
		expect(result.status).toBe("ok")
		expect(Array.isArray(result.resultJson)).toBe(true)
		expect((result.resultJson as unknown[]).length).toBe(0)
	},
)
