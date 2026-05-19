import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup } from "../fixtures/playground"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #14 — batch of meta-only methods is silent.
 *
 * batch is exempt (capability-map.ts:14). The legs we call (getChainInfo ×2 +
 * getAccounts) are all exempt — no capability needed. Returns `{ name,
 * result }[]`. (We avoid getAddressBook here because it requires the `data`
 * cap which isn't granted in this fixture.)
 */
test.skipIf(!hasConfig)(
	"meta-batch — meta-only batch silent, returns named results",
	{ timeout: 60_000, retry: 1 },
	async ({ dappConnectedExtension }) => {
		const result = await callExpectingNoPopup(dappConnectedExtension, dappConnectedExtension.playgroundPage, "batch", async () => {
			await clickByTestId(dappConnectedExtension.playgroundPage, "pg-btn-batch-meta")
		})
		expect(result.status).toBe("ok")
		const arr = result.resultJson as Array<{ name: string }>
		expect(arr.length).toBe(3)
		expect(arr.map((r) => r.name)).toEqual(expect.arrayContaining(["getAccounts", "getChainInfo"]))
	},
)
