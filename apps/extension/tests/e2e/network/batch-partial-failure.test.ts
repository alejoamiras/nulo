import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup } from "../fixtures/playground"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * One failing leg aborts the whole batch and propagates. The wallet-sdk batch
 * return type is a closed `discriminatedUnion("name", …)` over per-method return
 * schemas — there is no per-leg error variant — so any substituted "empty" leg
 * Zod-fails on the dApp side. Throwing is the only contract-compatible signal.
 */
test.skipIf(!hasConfig)(
	"batch-partial-failure — one failing leg aborts the whole batch",
	{ timeout: 60_000 },
	async ({ dappConnectedExtension }) => {
		const result = await callExpectingNoPopup(dappConnectedExtension, dappConnectedExtension.playgroundPage, "batch", async () => {
			await clickByTestId(dappConnectedExtension.playgroundPage, "pg-btn-batch-partial-failure")
		})
		expect(result.status).toBe("error")
		// `errorJson.message` is the dApp-visible payload. The wallet-sdk wire wraps
		// the envelope error via `new Error(jsonStringify(error))`, so the inner
		// message arrives JSON-encoded — the substring match tolerates the quoting.
		const msg = (result.errorJson as { message?: string } | null)?.message ?? ""
		expect(msg).toMatch(/Unsupported wallet method.*thisMethodDoesNotExist/i)
	},
)
