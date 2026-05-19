import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, waitForExecuteContent, approveCapabilities, approveExecute } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Cancel-mid-prove dApp flow. Pins the explicit cancel semantics contract:
 *
 *   1. Wallet emits `{ status: "cancelled" }` from `executeOperations` when
 *      the user cancels.
 *   2. wallet-bridge dispatcher converts to a structured `JobCancelledError`.
 *   3. wallet-sdk handler writes `response.error = { code: 4001, ... }`.
 *   4. Upstream `@aztec/wallet-sdk` (`extension_wallet.ts:181`) collapses
 *      to `new Error(JSON.stringify(response.error))` — the dApp receives
 *      a plain `Error` whose `.message` is the JSON payload.
 *
 * Codex's v3 audit flagged this end-to-end shape needs real integration
 * coverage; a unit test on `background.ts` would miss the SDK collapse.
 *
 * Assertions cover BOTH the raw `err.message` carrier (today's reality) AND
 * the parsed JSON shape (`code === 4001`, `data.walletErrorCode ===
 * "JOB_CANCELLED"`). If the SDK ever stops collapsing, the test still passes
 * because the parsed shape is what dApps actually care about.
 */
test.skipIf(!hasConfig)(
	"cancel-mid-prove — dApp gets structured 4001 cancel signal, not generic failure",
	{ timeout: 240_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		// Grant the transaction capability bundle (includes accounts + transaction).
		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "transaction"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const seqGrant = await snapshotResultSeq(page)
		const capPopupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 15_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		const capPopup = await capPopupP
		await capPopup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 10_000 })
		const accountIds = await capPopup.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('[data-testid="cap-account-item"]')].map((r) => r.getAttribute("data-account-id")),
		)
		await approveCapabilities(capPopup, { accounts: [accountIds[0]!] })
		await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

		// Pre-mint tokens to the dapp's account. Without balance, the wallet's
		// PXE simulate phase reverts BEFORE the prove pipeline even starts
		// ("Assertion failed: attempt to subtract with overflow"), so the
		// operation returns `{ status: "failed" }` and never reaches the
		// `cancelled` branch — the test then asserts against the simulate
		// failure payload instead of the structured 4001 cancel envelope.
		// Minting first lets simulate succeed, prove starts (slow on the
		// local sandbox), and the user's cancel click lands during prove.
		const dappAccountAddress = accountIds[0]!
		{
			const { createTestWallet, createSponsoredFeeOptions, mintPublicTokens } = await import("../fixtures/aztec")
			const { wallet, cleanup } = await createTestWallet(aztecConfig!.nodeUrl)
			try {
				const feeOptions = await createSponsoredFeeOptions(wallet)
				await mintPublicTokens(
					wallet,
					aztecConfig!.tokenAddress,
					dappAccountAddress,
					100n * 10n ** 18n,
					aztecConfig!.minterAddress,
					feeOptions,
				)
			} finally {
				await cleanup()
			}
		}

		// Set inputs for a token transfer.
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

		// Fire sendTx and approve in the execute popup. After approve, the tx
		// is in-flight; the popup closes; the journal carries it.
		const seqTx = await snapshotResultSeq(page)
		const execPopupP = waitForPopup(dappConnectedExtension, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-default")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)
		await approveExecute(execPopup)

		// Open the wallet popup; wait for the in-flight awaiting card to render.
		const walletPopup = await openPopup(dappConnectedExtension)
		await walletPopup.waitForSelector('[data-testid="tx-awaiting-card"]', { timeout: 30_000 })
		// The cancel button is hidden during `submitting` (FSM forbids that
		// transition). It's present during `pending` / `simulating` / `proving`.
		// On a sandbox network the prove phase dominates; this selector should
		// be live well before submit.
		await walletPopup.waitForSelector('[data-testid="tx-awaiting-cancel"]', { visible: true, timeout: 30_000 })
		await clickByTestId(walletPopup, "tx-awaiting-cancel")

		// dApp-side rejection arrives once the SW catches the cancel.
		const result = await waitForPgResult(page, "sendTx", seqTx, 60_000)
		expect(result.status).toBe("error")

		// Codex v3 audit: assert the raw shape SDK collapses to (today's
		// reality) AND the parsed shape (forward-compat). Either passing
		// alone would miss a real regression in one of the two.
		// `errorJson` is what the playground stringifies; it's the
		// `err.message` JSON envelope per @aztec/wallet-sdk's
		// `extension_wallet.ts:181` collapse.
		const errorPayload = result.errorJson as string | { message?: string } | undefined
		const errMessage = typeof errorPayload === "string" ? errorPayload : errorPayload?.message
		expect(typeof errMessage).toBe("string")

		const parsed = JSON.parse(errMessage!)
		expect(parsed.code).toBe(4001)
		expect(parsed.data?.walletErrorCode).toBe("JOB_CANCELLED")
		expect(typeof parsed.data?.jobId).toBe("string")
	},
)
