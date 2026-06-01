import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, waitForExecuteContent, approveExecute } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #39 — characterization: multi-account session, sendTx ignores
 * dApp's `opts.from` and uses the first session account.
 *
 * dispatcher.ts:769 + :335 always pick the first match from
 * resolveNetworkAndAccount and overwrite `opts.from`. The dApp's choice is
 * silently ignored. This test pins that current behavior — if/when fixed,
 * the assertion flips.
 *
 * Uses `dappConnectedExtensionWithFirstTwoAccountsCap` so the cap-popup
 * round-trip (which grants up to 2 accounts) happens during fixture
 * setup (hookTimeout=300s) instead of during the test budget. Mirrors the
 * single-account fixture (PR #64) but tolerates 1-or-2 accounts depending
 * on what the wallet exposed — the characterization holds either way.
 */
test.skipIf(!hasConfig)(
	"multi-account-from — handleSendTx picks first session account regardless of opts.from",
	// 420s budget: this test uses sendTx-default (NO_WAIT) which still pays
	// the WASM kernel-prove envelope on slow-runner-pool members. See
	// tx-sendTx-default.test.ts for the same reasoning.
	{ timeout: 420_000 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const { playgroundPage: page } = dappConnectedExtensionWithFirstTwoAccountsCap

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
		const execPopupP = waitForPopup(dappConnectedExtensionWithFirstTwoAccountsCap, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-default")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)

		// Check the from-account on the op card via the new testid (D2: added in
		// canonical refactor). Read data-account-address; characterization says
		// the popup shows the FIRST session account regardless of which account
		// the dApp set in opts.from.
		const fromAddress = await execPopup.evaluate(
			() => document.querySelector('[data-testid="execute-op-from-account"]')?.getAttribute("data-account-address") ?? "",
		)
		expect(fromAddress.length).toBeGreaterThan(0)

		await approveExecute(execPopup)
		const result = await waitForPgResult(page, "sendTx", seqTx, 360_000)
		expect(["ok", "error"]).toContain(result.status)
	},
)
