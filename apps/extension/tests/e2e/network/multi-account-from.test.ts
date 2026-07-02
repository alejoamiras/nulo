import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { waitForDappExecuteWorked } from "../fixtures/journal"
import { mintPublicTokensForAccount, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #39 — multi-account session: sendTx settles via the first session
 * account when granted up to 2 accounts.
 *
 * KNOWN LIMITATION (codex post-impl finding #1): this test does NOT exercise
 * the "wallet ignores opts.from" claim end-to-end. The playground's
 * `pg-btn-sendTx-default` reads `opts.from = state.selectedAccount`, and
 * `requestCapabilities()` sets `selectedAccount = granted[0]`. So
 * `opts.from === accountAddresses[0]` regardless of how many accounts the
 * fixture grants — the wallet's "always pick the first" matches the dApp's
 * choice by construction. To genuinely characterize the
 * `dispatcher.ts:769 + :335` overwrite, the playground needs a hook to set
 * `selectedAccount = accountAddresses[1]` before the click; tracked as a
 * follow-up (the playground change is small but lives outside this PR).
 *
 * What this test currently pins:
 *   - The cap popup successfully grants up to 2 accounts.
 *   - sendTx with the first granted account reaches an active journal stage.
 *   - The execute popup shows a non-empty `from` address.
 *
 * Uses `dappConnectedExtensionWithFirstTwoAccountsCap` so the cap-popup
 * round-trip (which grants up to 2 accounts) happens during fixture
 * setup (hookTimeout=300s) instead of during the test budget. Tolerates
 * 1-or-2 accounts depending on what the wallet exposed.
 *
 * Asserts on `data-stage` (active stage) instead of the dApp's full
 * sendTx promise. See implementations-plan/journal-stage-restructure/.
 */
test.skipIf(!hasConfig)(
	"multi-account-from — sendTx via first session account reaches active stage",
	{ timeout: 90_000 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const { playgroundPage: page, accountAddresses } = dappConnectedExtensionWithFirstTwoAccountsCap

		// Pre-mint to the first session account only. The playground always uses
		// `selectedAccount` (= the first granted account) as `opts.from`, so the
		// second mint would be dead work until the test grows a real second-account
		// override hook (see docstring).
		await mintPublicTokensForAccount(aztecConfig!, accountAddresses[0]!)

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

		await snapshotResultSeq(page)
		const execPopupP = waitForPopup(dappConnectedExtensionWithFirstTwoAccountsCap, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-default")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)

		// Read the from-account on the op card (testid added in canonical refactor).
		// Just verifies the popup renders a from-account — the equivalence to
		// accountAddresses[0] is incidental given the playground wiring.
		const fromAddress = await execPopup.evaluate(
			() => document.querySelector('[data-testid="execute-op-from-account"]')?.getAttribute("data-account-address") ?? "",
		)
		expect(fromAddress.length).toBeGreaterThan(0)

		await approveExecute(execPopup)

		// Wait for the wallet's journal to enter an active processing stage
		// instead of the dApp's full sendTx promise.
		const walletPopup = await openPopup(dappConnectedExtensionWithFirstTwoAccountsCap)
		await waitForDappExecuteWorked(walletPopup)
	},
)
