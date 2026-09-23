import { expect, inject } from "vitest"
import type { Page } from "puppeteer"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { assertPgOk, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { waitForDappExecuteWorked } from "../fixtures/journal"
import {
	createTestWallet,
	mintPublicTokensForAccount,
	readPublicFeeJuice,
	readPublicTokenBalance,
	waitForTxMined,
	type AztecTestConfig,
} from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const lower = (s: string) => s.toLowerCase()

async function setPgInputs(page: Page, values: Record<string, string>): Promise<void> {
	await page.evaluate((entries: Array<[string, string]>) => {
		for (const [name, v] of entries) {
			const input = document.querySelector<HTMLInputElement>(`[data-testid="${name}"]`)
			if (!input) throw new Error(`missing ${name}`)
			Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(input, v)
			input.dispatchEvent(new Event("input", { bubbles: true }))
		}
	}, Object.entries(values))
}

/**
 * Test #39 — multi-account session: two accounts granted, two sends.
 *
 * The first test pins the default: with no `from` override the playground sends as its
 * `selectedAccount` (= granted[0]) and the execute popup names a from-account. The second names
 * the SECOND granted account through the playground's `pg-input-from` override (the same
 * `simFrom` hook the simulation section uses, `sections/transactions.ts`) and proves the wallet
 * executed it as that account: account 2's token balance drops by the amount, the recipient's
 * rises, account 1's token balance and Fee Juice never move.
 *
 * Uses `dappConnectedExtensionWithFirstTwoAccountsCap` so the cap-popup round-trip (which grants
 * up to 2 accounts) happens during fixture setup (hookTimeout=300s) instead of during the test
 * budget.
 */
test.skipIf(!hasConfig)(
	"multi-account-from — sendTx via first session account reaches active stage",
	{ timeout: 90_000 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const { playgroundPage: page, accountAddresses } = dappConnectedExtensionWithFirstTwoAccountsCap

		await mintPublicTokensForAccount(aztecConfig!, accountAddresses[0]!)

		await setPgInputs(page, {
			"pg-input-tokenAddress": aztecConfig!.tokenAddress,
			"pg-input-recipient": aztecConfig!.minterAddress,
			"pg-input-amount": "1",
		})

		await snapshotResultSeq(page)
		const execPopupP = waitForPopup(dappConnectedExtensionWithFirstTwoAccountsCap, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-default")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)

		const fromAddress = await execPopup.evaluate(
			() => document.querySelector('[data-testid="execute-op-from-account"]')?.getAttribute("data-account-address") ?? "",
		)
		expect(fromAddress.length).toBeGreaterThan(0)

		await approveExecute(execPopup)

		const walletPopup = await openPopup(dappConnectedExtensionWithFirstTwoAccountsCap)
		await waitForDappExecuteWorked(walletPopup)
		await walletPopup.close()
	},
)

test.skipIf(!hasConfig)(
	"multi-account-from — sendTx from the SECOND granted account is executed by that account",
	{ timeout: 360_000 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const ctx = dappConnectedExtensionWithFirstTwoAccountsCap
		const { playgroundPage: page, accountAddresses } = ctx
		const config = aztecConfig as AztecTestConfig
		expect(accountAddresses).toHaveLength(2)
		const [first, second] = accountAddresses as [string, string]

		await mintPublicTokensForAccount(config, second)
		const { wallet, accounts, cleanup } = await createTestWallet(config.nodeUrl)
		try {
			const reader = accounts[0]
			if (!reader) throw new Error("expected at least one sandbox-deployed test account")
			const token = config.tokenAddress
			const recipient = config.minterAddress
			const token1 = await readPublicTokenBalance(wallet, reader, token, first)
			const token2 = await readPublicTokenBalance(wallet, reader, token, second)
			const tokenR = await readPublicTokenBalance(wallet, reader, token, recipient)
			const fee1 = await readPublicFeeJuice(wallet, reader, first)

			await setPgInputs(page, {
				"pg-input-tokenAddress": token,
				"pg-input-recipient": recipient,
				"pg-input-amount": "1",
				"pg-input-from": second,
			})
			const seqTx = await snapshotResultSeq(page)
			const execPopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
			await clickByTestId(page, "pg-btn-sendTx-default")
			const execPopup = await execPopupP
			await waitForExecuteContent(execPopup)
			const fromShown = await execPopup.evaluate(
				() => document.querySelector('[data-testid="execute-op-from-account"]')?.getAttribute("data-account-address") ?? "",
			)
			expect(lower(fromShown)).toBe(lower(second))
			await approveExecute(execPopup)

			const result = await waitForPgResult(page, "sendTx", seqTx, 300_000)
			await assertPgOk(page, result, "multi-account-from:second")
			const txHash = (result.resultJson as { txHash?: string }).txHash
			expect(typeof txHash).toBe("string")
			await waitForTxMined(config, txHash as string)

			expect(await readPublicTokenBalance(wallet, reader, token, second)).toBe(token2 - 1n)
			expect(await readPublicTokenBalance(wallet, reader, token, recipient)).toBe(tokenR + 1n)
			expect(await readPublicTokenBalance(wallet, reader, token, first)).toBe(token1)
			expect(await readPublicFeeJuice(wallet, reader, first)).toBe(fee1)
		} finally {
			await cleanup()
		}
	},
)
