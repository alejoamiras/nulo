import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult, assertPgOk } from "../fixtures/playground"
import { approveExecute, waitForPopup } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * registerToken (Nulo-custom RPC) — happy path.
 *
 * Validates:
 *   - The runtime schema patch in `@nulo/wallet-sdk-schema-patch` makes the
 *     method reachable through `@aztec/wallet-sdk`'s ExtensionWallet proxy.
 *   - The dispatcher routes `registerToken` through DappInteractionService.execute()
 *     (the BLOCKER fix from the opus/codex audits — previously it bypassed the
 *     popup gate).
 *   - The execute popup renders the resolved token name + symbol + decimals
 *     pre-fetched via parseTokenInterface (D7 — anti-phishing surface).
 *   - User Allow → tokenService.addToken with origin "dapp" + dappOrigin set.
 *
 * Drives via the playground rather than the tools app because the playground
 * helpers are mature.
 *
 * Uses `dappConnectedExtensionWithAccountsCap` so the cap-popup round-trip
 * happens during fixture setup (hookTimeout=300s) rather than during this
 * test's 60s budget. Pre-fix, stacking the cap popup + the execute popup +
 * the token-metadata prefetch in a single test exceeded any reasonable
 * timeout on cold-shard CI — see audit-codex-shard-vs-serial.md and
 * implementations-plan/e2e-stabilization/plan.md §6.
 */
test.skipIf(!hasConfig)(
	"registerToken — happy path: popup shows resolved metadata, approve persists token",
	{ timeout: 60_000 },
	async ({ dappConnectedExtensionWithAccountsCap }) => {
		const { playgroundPage: page, accountAddress } = dappConnectedExtensionWithAccountsCap

		await page.evaluate(
			({ token, account }: { token: string; account: string }) => {
				const setVal = (sel: string, v: string) => {
					const input = document.querySelector<HTMLInputElement>(sel)
					if (!input) return
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
					setter?.call(input, v)
					input.dispatchEvent(new Event("input", { bubbles: true }))
				}
				setVal('[data-testid="pg-input-tokenAddress"]', token)
				setVal('[data-testid="pg-input-accountAddress"]', account)
			},
			{ token: aztecConfig!.tokenAddress, account: accountAddress },
		)

		// Click registerToken — expect execute popup to open (not silent —
		// the explicit `register_token` branch in `isConfirmationNeeded`).
		const seqRegister = await snapshotResultSeq(page)
		const execPopupP = waitForPopup(dappConnectedExtensionWithAccountsCap, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-registerToken")
		const execPopup = await execPopupP

		// The popup MUST show the pre-fetched metadata before the user can
		// approve. The Confirm button is disabled until metadata loads.
		await execPopup.waitForSelector('[data-testid="register-token-symbol"]', { visible: true, timeout: 30_000 })
		const symbol = await execPopup.$eval(
			'[data-testid="register-token-symbol"]',
			(el: Element) => (el as HTMLElement).textContent?.trim() ?? "",
		)
		expect(symbol.length).toBeGreaterThan(0)

		// Address must always render alongside the metadata (defense against
		// phishing tokens that return misleading name/symbol strings).
		const addressDisplayed = await execPopup.$('[data-testid="register-token-address"]')
		expect(addressDisplayed).not.toBeNull()

		// Approve via approveExecute: it gates on the confirm button's live
		// disabled state (initComplete + tokenMetadataLoading + operations, all
		// async) PLUS the CSS-only loading state, and carries the timeout
		// diagnostics + timing telemetry the suite standardized — a bare
		// clickByTestId waits on the same disabled bit but loses all of that.
		await approveExecute(execPopup)
		const result = await waitForPgResult(page, "registerToken", seqRegister, 30_000)
		await assertPgOk(page, result, "register-token:result")

		expect(dappConnectedExtensionWithAccountsCap.consoleErrors).toEqual([])
		expect(dappConnectedExtensionWithAccountsCap.pageErrors).toEqual([])
	},
)
