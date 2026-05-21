import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup } from "../fixtures/playground"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * `getAccounts` pre-grant now throws `CapabilityNotGrantedError` (EIP-1193 4100)
 * instead of silently returning []. This test pins ONLY the error-surface side
 * of that contract — that the dApp gets a recognisable failure rather than a
 * silent empty result. It does NOT exercise the downstream
 * `requestCapabilities()` fallback path; that's covered separately by the
 * existing `meta-getAccounts.test.ts` (post-grant fast-path).
 *
 * The match below is intentionally loose because the wallet-sdk wraps
 * `response.error` in `new Error(JSON.stringify(error))` at
 * `extension_wallet.ts:181`. The playground fixture may surface this as a
 * string-typed error, an object with `.code`, or a JSON-parseable message —
 * accept any of them. The exact wire shape is pinned at the unit level
 * (error-envelope.test.ts: "envelope round-trips through new Error(...)").
 */
test.skipIf(!hasConfig)(
	"meta-getAccounts-pregrant — throws CAPABILITY_NOT_GRANTED (4100) before accounts cap granted",
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

		expect(result.status).toBe("error")
		// Flexible match for the wire-wrapping reality. See the comment block above.
		expect(JSON.stringify(result)).toMatch(/4100|CAPABILITY_NOT_GRANTED/)
	},
)
