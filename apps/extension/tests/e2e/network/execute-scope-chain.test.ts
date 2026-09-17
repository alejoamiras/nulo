import { expect, inject } from "vitest"
import type { Page } from "puppeteer"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { assertPgOk, setPgInput, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup, waitForPopupClosed } from "../fixtures/popups"
import { getAccountAddress, switchToNetwork, waitForTxCardByHash } from "../fixtures/helpers"
import { type AztecTestConfig, mintPublicTokensForAccount, waitForTxMined } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const lower = (s: string) => s.toLowerCase()

/** The profile's active network row id, as the network service persists it (one profile here). */
async function readActiveNetworkId(page: Page): Promise<string> {
	return page.evaluate(async () => {
		const all = (await chrome.storage.local.get(null)) as Record<string, unknown>
		const ids = Object.entries(all)
			.filter(([k]) => k.startsWith("nulo:core:active-network@"))
			.map(([, v]) => v)
		if (ids.length !== 1 || typeof ids[0] !== "string")
			throw new Error(`expected one active-network pointer, found ${JSON.stringify(ids)}`)
		return ids[0]
	})
}

/**
 * A dApp connected on Local Network sends while the wallet looks at Testnet. The execute window
 * names the mismatch as a chain one, and confirming moves the wallet's durable pointers — the
 * active network row and the active account — to where the transaction ran, so the next popup
 * opens on Local Network as the signer and shows the transaction, with no manual switching.
 *
 * Every post-confirm assertion reads storage or a freshly opened popup: the wallet has no
 * cross-window propagation, and the popup that did the switching is closed before Confirm, the
 * way the approval window taking focus closes the browser-action popup.
 */
test.skipIf(!hasConfig)(
	"execute-scope-chain — confirming a send on another chain moves the wallet there",
	{ timeout: 420_000, retry: 0 },
	async ({ dappConnectedExtensionWithTransactionCap }) => {
		const ctx = dappConnectedExtensionWithTransactionCap
		const { playgroundPage: page, accountAddress: signer } = ctx
		const config = aztecConfig as AztecTestConfig

		await mintPublicTokensForAccount(config, signer)

		const wallet = await openPopup(ctx)
		await waitForHash(wallet, "#/popup/general", 30_000)
		const localNetworkId = await readActiveNetworkId(wallet)
		await switchToNetwork(wallet, "Testnet")
		const testnetNetworkId = await readActiveNetworkId(wallet)
		expect(testnetNetworkId).not.toBe(localNetworkId)
		// Each chain derives its own default account, so the pointer left the signer behind.
		expect(lower(await getAccountAddress(wallet))).not.toBe(lower(signer))
		await wallet.close()

		await setPgInput(page, "tokenAddress", config.tokenAddress)
		await setPgInput(page, "recipient", config.minterAddress)
		await setPgInput(page, "amount", "1")
		const seq = await snapshotResultSeq(page)
		const execPopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-default")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)
		await execPopup.waitForSelector('[data-testid="execute-scope-banner"][data-state="chain"]', { timeout: 30_000 })

		await approveExecute(execPopup)
		// The window closes only after both pointer writes landed.
		await waitForPopupClosed(execPopup, 60_000)

		const reopened = await openPopup(ctx)
		await waitForHash(reopened, "#/popup/general", 30_000)
		expect(await readActiveNetworkId(reopened)).toBe(localNetworkId)
		expect(lower(await getAccountAddress(reopened))).toBe(lower(signer))
		await reopened.waitForFunction(
			() => document.querySelector('[data-testid="network-button"]')?.textContent?.trim() === "Local Network",
			{ timeout: 30_000, polling: 200 },
		)

		const result = await waitForPgResult(page, "sendTx", seq, 300_000)
		await assertPgOk(page, result, "execute-scope-chain:sendTx")
		const txHash = (result.resultJson as { txHash?: string }).txHash
		expect(typeof txHash).toBe("string")
		await waitForTxMined(config, txHash as string)
		await waitForTxCardByHash(reopened, txHash as string, 120_000)

		expect(ctx.consoleErrors).toEqual([])
	},
)
