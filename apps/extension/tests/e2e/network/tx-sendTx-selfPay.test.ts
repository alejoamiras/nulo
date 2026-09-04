import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { waitForDappExecuteWorked } from "../fixtures/journal"
import {
	createTestWallet,
	fundPublicFeeJuice,
	mintPublicTokensForAccount,
	readPublicFeeJuice,
	type AztecTestConfig,
} from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * A dApp payload that names the ACCOUNT ITSELF as payer with no fee call asks to pay from the
 * Fee Juice the account already holds. The wallet must build it as preexisting Fee Juice (a
 * claim-in-setup build never ends setup and is invalid), show the fee card LOCKED to Fee Juice —
 * no "fee set by the app" badge (the payload carries no payment) and no picker (a picker's
 * default on a gasless account is the sponsored FPC) — and the account's own public Fee Juice
 * must fall once the transaction lands.
 */
test.skipIf(!hasConfig)(
	"tx-sendTx-selfPay — the account named as its own payer pays from the Fee Juice it holds",
	{ timeout: 300_000 },
	async ({ dappConnectedExtensionWithTransactionCap }) => {
		const { playgroundPage: page, accountAddress } = dappConnectedExtensionWithTransactionCap
		const config = aztecConfig as AztecTestConfig

		await mintPublicTokensForAccount(config, accountAddress)
		const { wallet, accounts, node, cleanup } = await createTestWallet(config.nodeUrl)
		try {
			const scriptAccount = accounts[0]
			if (!scriptAccount) throw new Error("expected at least one sandbox-deployed test account")
			await fundPublicFeeJuice(wallet, node, scriptAccount, config, accountAddress)
			const before = await readPublicFeeJuice(wallet, scriptAccount, accountAddress)
			expect(before).toBeGreaterThan(0n)

			await page.evaluate(
				({ token, recipient, feePayer }: { token: string; recipient: string; feePayer: string }) => {
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
					setVal('[data-testid="pg-input-feePayer"]', feePayer)
				},
				{ token: config.tokenAddress, recipient: config.minterAddress, feePayer: accountAddress },
			)

			await snapshotResultSeq(page)
			const execPopupP = waitForPopup(dappConnectedExtensionWithTransactionCap, "execute", { timeout: 30_000 })
			await clickByTestId(page, "pg-btn-sendTx-feePayer")
			const execPopup = await execPopupP
			await waitForExecuteContent(execPopup)

			// Locked to Fee Juice: the row the dApp asked for, no badge, no picker.
			await execPopup.waitForSelector('[data-testid="send-fee-locked"]', { visible: true, timeout: 30_000 })
			const surfaces = await execPopup.evaluate(() => ({
				badge: !!document.querySelector('[data-testid="execute-op-fee-set-badge"]'),
				selector: !!document.querySelector('[data-testid="send-fee-method-trigger"]'),
			}))
			expect(surfaces).toEqual({ badge: false, selector: false })

			// The estimate has to land (the account's balance is read) before Confirm is approvable.
			await approveExecute(execPopup, { approvableTimeoutMs: 90_000 })

			const walletPopup = await openPopup(dappConnectedExtensionWithTransactionCap)
			await waitForDappExecuteWorked(walletPopup)

			// The account paid: its public Fee Juice falls once the transaction lands.
			await expect
				.poll(() => readPublicFeeJuice(wallet, scriptAccount, accountAddress), { timeout: 150_000, interval: 5_000 })
				.toBeLessThan(before)
		} finally {
			await cleanup()
		}
	},
)
