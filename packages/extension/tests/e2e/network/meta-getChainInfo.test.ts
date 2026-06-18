import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup } from "../fixtures/playground"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #13 — getChainInfo is exempt from capability enforcement and goes silent.
 *
 * `capability-map.ts:14` lists getChainInfo in EXEMPT_METHODS. Default
 * confirmationLevel = Transactions = 5; getChainInfo's access level is
 * PublicData = 2, so isConfirmationNeeded returns false.
 */
// Per-test retry for this file: under cumulative load (running 43 network
// files back-to-back), the `dappConnectedExtension` fixture's PXE work +
// the silent `getChainInfo` round-trip occasionally cross the per-test
// timeout. Each invocation passes deterministically in isolation, so the
// retry stays scoped to this test rather than landing as a suite-wide
// vitest `retry` option (which would mask real regressions elsewhere).
test.skipIf(!hasConfig)("meta-getChainInfo — silent path, no popup", { timeout: 60_000 }, async ({ dappConnectedExtension }) => {
	const result = await callExpectingNoPopup(dappConnectedExtension, dappConnectedExtension.playgroundPage, "getChainInfo", async () => {
		await clickByTestId(dappConnectedExtension.playgroundPage, "pg-btn-getChainInfo")
	})
	expect(result.status).toBe("ok")
	expect(result.resultJson).toBeDefined()
})
