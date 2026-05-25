import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * registerToken (Nulo-custom RPC) — happy path.
 *
 * Validates:
 *   - The runtime schema patch in `wallet-sdk/nulo-schema-patch.ts` makes the
 *     method reachable through `@aztec/wallet-sdk`'s ExtensionWallet proxy.
 *   - The dispatcher routes `registerToken` through DappInteractionService.execute()
 *     (the BLOCKER fix from the opus/codex audits — previously it bypassed the
 *     popup gate).
 *   - The execute popup renders the resolved token name + symbol + decimals
 *     pre-fetched via parseTokenInterface (D7 — anti-phishing surface).
 *   - User Allow → tokenService.addToken with origin "dapp" + dappOrigin set.
 *   - User Deny → 4001 error envelope back to dApp.
 *
 * Drives via the playground rather than the faucet because the playground
 * helpers are mature; the faucet-driven e2e (using FAUCET_DEV_PORT +
 * faucetUrl fixture) is a separate spec.
 */
test.skipIf(!hasConfig)(
	"registerToken — happy path: popup shows resolved metadata, approve persists token",
	{ timeout: 60_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		// Grant the `accounts` capability (required by registerToken per
		// capability-map). The basic bundle covers it. We need the resolved
		// account address afterward, so we read it from the popup's
		// `cap-account-item` rows before approving.
		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "basic"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const seqGrant = await snapshotResultSeq(page)
		const capPopupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		const capPopup = await capPopupP
		await capPopup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 30_000 })
		const accountIds = await capPopup.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('[data-testid="cap-account-item"]')].map((r) => r.getAttribute("data-account-id")),
		)
		const accountAddress = accountIds[0]
		if (!accountAddress) throw new Error("capabilities popup returned no accounts")
		await approveCapabilities(capPopup, { accounts: [accountAddress] })
		await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

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
		const execPopupP = waitForPopup(dappConnectedExtension, "execute", { timeout: 30_000 })
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

		// Approve and wait for the dApp's promise to settle. Use clickByTestId
		// (NOT raw page.click) so we wait for the Confirm button to become
		// enabled — dev's :disabled gate is initComplete + tokenMetadataLoading
		// + operations.length, all async. Raw click races the init and the
		// approve() handler silently no-ops on the missing guards.
		await clickByTestId(execPopup, "execute-confirm-btn")
		const result = await waitForPgResult(page, "registerToken", seqRegister, 30_000)
		expect(result.status).toBe("ok")

		expect(dappConnectedExtension.consoleErrors).toEqual([])
		expect(dappConnectedExtension.pageErrors).toEqual([])
	},
)
