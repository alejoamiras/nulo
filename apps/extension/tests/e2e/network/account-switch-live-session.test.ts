import { expect, inject } from "vitest"
import type { Page } from "puppeteer"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { getAccountAddress, switchAccountByAddress } from "../fixtures/helpers"
import { assertPgOk, callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
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

/** The playground's inputs are re-rendered from state, so values are set through the native setter. */
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
 * An ACCOUNT switch under a live dApp session (not a profile switch). The popup moves its active
 * account from A to B while the playground stays connected with both granted: `getAccounts` still
 * answers the same two in the same order, and a `sendTx` naming A as `from` is executed by A — A's
 * token balance drops by the amount, the recipient's rises, B's token and Fee Juice balances never
 * move. The fee method is whatever the execute popup defaults to (self-paid or sponsored), so A's
 * Fee Juice is asserted not to rise, never to fall by a particular amount.
 */
test.skipIf(!hasConfig)(
	"account-switch-live-session — the popup's active account moves to B; a sendTx from A is still executed by A",
	{ timeout: 360_000 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const ctx = dappConnectedExtensionWithFirstTwoAccountsCap
		const { playgroundPage: page, accountAddresses } = ctx
		const config = aztecConfig as AztecTestConfig
		expect(accountAddresses).toHaveLength(2)
		const [a, b] = accountAddresses as [string, string]

		await mintPublicTokensForAccount(config, a)

		// The fixture's second account is created (and thereby activated) during setup: make A the
		// active account explicitly, so the switch below is a real transition.
		const setup = await openPopup(ctx)
		await switchAccountByAddress(setup, a)
		expect(lower(await getAccountAddress(setup))).toBe(lower(a))
		await setup.close()

		const before = await callExpectingNoPopup(ctx, page, "getAccounts", () => clickByTestId(page, "pg-btn-getAccounts"))
		await assertPgOk(page, before, "live-session:getAccounts-before")
		const listedBefore = (before.resultJson as Array<{ item: string }>).map((x) => lower(x.item))
		expect(listedBefore).toEqual([lower(a), lower(b)])

		// The switch happens in the wallet's own UI, with the dApp connected the whole time.
		const popup = await openPopup(ctx)
		await switchAccountByAddress(popup, b)
		expect(lower(await getAccountAddress(popup))).toBe(lower(b))
		await popup.close()

		const after = await callExpectingNoPopup(ctx, page, "getAccounts", () => clickByTestId(page, "pg-btn-getAccounts"))
		await assertPgOk(page, after, "live-session:getAccounts-after")
		expect((after.resultJson as Array<{ item: string }>).map((x) => lower(x.item))).toEqual(listedBefore)

		const { wallet, accounts, cleanup } = await createTestWallet(config.nodeUrl)
		try {
			const reader = accounts[0]
			if (!reader) throw new Error("expected at least one sandbox-deployed test account")
			const token = config.tokenAddress
			const recipient = config.minterAddress
			const tokenA0 = await readPublicTokenBalance(wallet, reader, token, a)
			const tokenB0 = await readPublicTokenBalance(wallet, reader, token, b)
			const tokenR0 = await readPublicTokenBalance(wallet, reader, token, recipient)
			const feeA0 = await readPublicFeeJuice(wallet, reader, a)
			const feeB0 = await readPublicFeeJuice(wallet, reader, b)

			await setPgInputs(page, {
				"pg-input-tokenAddress": token,
				"pg-input-recipient": recipient,
				"pg-input-amount": "1",
				"pg-input-from": a,
			})
			const seqTx = await snapshotResultSeq(page)
			const execPopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
			await clickByTestId(page, "pg-btn-sendTx-default")
			const execPopup = await execPopupP
			await waitForExecuteContent(execPopup)
			const fromShown = await execPopup.evaluate(
				() => document.querySelector('[data-testid="execute-op-from-account"]')?.getAttribute("data-account-address") ?? "",
			)
			expect(lower(fromShown)).toBe(lower(a))
			await approveExecute(execPopup)

			const result = await waitForPgResult(page, "sendTx", seqTx, 300_000)
			await assertPgOk(page, result, "live-session:sendTx")
			const txHash = (result.resultJson as { txHash?: string }).txHash
			expect(typeof txHash).toBe("string")
			await waitForTxMined(config, txHash as string)

			expect(await readPublicTokenBalance(wallet, reader, token, a)).toBe(tokenA0 - 1n)
			expect(await readPublicTokenBalance(wallet, reader, token, recipient)).toBe(tokenR0 + 1n)
			expect(await readPublicTokenBalance(wallet, reader, token, b)).toBe(tokenB0)
			expect(await readPublicFeeJuice(wallet, reader, b)).toBe(feeB0)
			expect(await readPublicFeeJuice(wallet, reader, a)).toBeLessThanOrEqual(feeA0)
		} finally {
			await cleanup()
		}
	},
)
