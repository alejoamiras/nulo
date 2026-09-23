/**
 * The Terms wall against a real node. With the accepted version behind the current one, a dApp's
 * read and a dApp's send are both refused with the typed code before any window opens, and no
 * transaction row is written; accepting through the real sheet lets the same two calls through.
 *
 * The wallet's own send is proved refused at its surface (banner, disabled submit) because the UI
 * cannot submit while blocked; the broadcast line itself is pinned by the execution-coordinator and
 * composition suites, and `transfers.test.ts` is the wallet send succeeding under an acceptance.
 *
 * Mutates on-chain state: run zero-retry (`NULO_E2E_RETRY=0`). Proverless or proving, both work.
 */
import { expect, inject } from "vitest"
import { LEGAL_MANIFEST } from "@nulo/legal"
import { reloadExtensionPage } from "../fixtures/browser"
import { clickByTestId, openPopup, seedLegalAcceptance, test, waitForHash } from "../fixtures/extension"
import { navigateByHash } from "../fixtures/helpers"
import { assertPgOk, callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { mintPublicTokensForAccount, type AztecTestConfig } from "../fixtures/aztec"
import { pointerClick, readLegalRecord, waitForSheet } from "../helpers/legal-drivers"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined
const TERMS_CODE = "TERMS_ACCEPTANCE_REQUIRED"

test.skipIf(!hasConfig)(
	"N1 stale Terms: dApp read and send are refused with the typed code and write no tx row; accepting lets both through",
	{ timeout: 480_000 },
	async ({ dappConnectedExtensionWithTransactionCap: ctx }) => {
		const { playgroundPage: dapp, accountAddress } = ctx
		await mintPublicTokensForAccount(aztecConfig!, accountAddress)
		await dapp.evaluate(
			({ token, recipient }: { token: string; recipient: string }) => {
				const setVal = (sel: string, v: string) => {
					const input = document.querySelector<HTMLInputElement>(sel)
					if (!input) throw new Error(`${sel} not found`)
					Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(input, v)
					input.dispatchEvent(new Event("input", { bubbles: true }))
				}
				setVal('[data-testid="pg-input-tokenAddress"]', token)
				setVal('[data-testid="pg-input-recipient"]', recipient)
				setVal('[data-testid="pg-input-amount"]', "1")
			},
			{ token: aztecConfig!.tokenAddress, recipient: aztecConfig!.minterAddress },
		)

		const wallet = await openPopup(ctx)
		await waitForHash(wallet, "#/popup/general", 30_000)
		const txRows = () =>
			wallet.evaluate(
				async () => Object.keys(await chrome.storage.local.get(null)).filter((key) => key.startsWith("nulo:core:txs@")).length,
			)
		const rowsBefore = await txRows()
		await seedLegalAcceptance(wallet, "stale")

		// ── Refused: a read, then a send. Neither opens a window. ──────────
		for (const [method, button] of [
			["getChainInfo", "pg-btn-getChainInfo"],
			["sendTx", "pg-btn-sendTx-default"],
		] as const) {
			const refused = await callExpectingNoPopup(ctx, dapp, method, () => clickByTestId(dapp, button))
			expect(refused.status).toBe("error")
			expect(JSON.stringify(refused.errorJson)).toContain(TERMS_CODE)
		}
		expect(await txRows()).toBe(rowsBefore)

		// ── The wallet's own Send says why, and cannot submit. ─────────────
		await reloadExtensionPage(wallet)
		await waitForHash(wallet, "#/popup/general", 30_000)
		await waitForSheet(wallet, "changed")
		await pointerClick(wallet, "legal-sheet-not-now")
		await waitForHash(wallet, "#/popup/legal/declined", 10_000)
		await navigateByHash(wallet, "#/popup/send", 15_000)
		await wallet.waitForSelector('[data-testid="send-legal-banner"]', { visible: true, timeout: 15_000 })
		expect(await wallet.$eval('[data-testid="send-submit"]', (el) => (el as HTMLButtonElement).disabled)).toBe(true)

		// ── Accept through the real sheet. ─────────────────────────────────
		await pointerClick(wallet, "send-legal-review")
		await waitForSheet(wallet, "changed")
		await pointerClick(wallet, "legal-consent-checkbox")
		await pointerClick(wallet, "legal-continue")
		await wallet.waitForFunction(() => !document.querySelector('[data-testid="legal-sheet"]'), { timeout: 10_000 })
		expect(await readLegalRecord(wallet)).toMatchObject({ termsVersion: LEGAL_MANIFEST.terms.at(-1)?.version, surface: "popup" })
		await wallet.waitForFunction(() => !document.querySelector('[data-testid="send-legal-banner"]'), { timeout: 10_000 })

		// ── Served: the same read, then the same send. ─────────────────────
		const read = await callExpectingNoPopup(ctx, dapp, "getChainInfo", () => clickByTestId(dapp, "pg-btn-getChainInfo"))
		await assertPgOk(dapp, read, "legal-wall:getChainInfo")

		const seqTx = await snapshotResultSeq(dapp)
		const execPopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
		await clickByTestId(dapp, "pg-btn-sendTx-default")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)
		await approveExecute(execPopup)
		const sent = await waitForPgResult(dapp, "sendTx", seqTx, 300_000)
		await assertPgOk(dapp, sent, "legal-wall:sendTx")
		expect(typeof (sent.resultJson as { txHash?: string } | undefined)?.txHash).toBe("string")
		expect(await txRows()).toBeGreaterThan(rowsBefore)
	},
)
