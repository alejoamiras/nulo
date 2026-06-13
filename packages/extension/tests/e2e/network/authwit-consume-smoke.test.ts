import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { mintPublicTokensForAccount, waitForTxMined, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined
// These tests run many proofs serially; on the shared shard pool they
// exhaust puppeteer's protocolTimeout under proving load AND add enough
// contention to flake neighbors. Opt-in only (idle box / dedicated job).
// Revoke + registry-toggle behavioral coverage stays the manual-QA gate
// (resolved Ask A4). Run with: RUN_AUTHWIT_E2E=1 bun run e2e:agent <file>.
const authwitE2eEnabled = process.env.RUN_AUTHWIT_E2E === "1"

/**
 * Phase-2 gate smoke: the public-authwit GRANT surface works end-to-end
 * once, and the granted approval is CONSUMABLE by the named caller.
 *
 *   1. Account A grants caller B a public authwit for
 *      `transfer_public_to_public(A, B, 1, nonce)` via the Nulo-custom
 *      `grantPublicAuthwit` RPC (approval popup → on-chain
 *      `set_authorized` → wallet `trackAuthwit`).
 *   2. After the grant MINES (the consume's public simulation reads the
 *      registry), account B sends the transfer-from AS B. The build's
 *      public simulation passing the registry check IS the consumption
 *      proof at smoke level — a missing/false approval reverts the
 *      simulation and the dApp gets an error row instead of ok.
 *
 * The full lifecycle (fresh-grant-per-step, revoke, registry toggle,
 * non-vacuity) is authwit-lifecycle.test.ts (Phase 3).
 */
test.skipIf(!hasConfig || !authwitE2eEnabled)(
	"authwit-consume-smoke — grant public authwit, then consume as the named caller",
	{ timeout: 600_000 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const ctx = dappConnectedExtensionWithFirstTwoAccountsCap
		const { playgroundPage: page, accountAddresses } = ctx
		// The fixture creates + grants a second account; the consume flow is
		// meaningless without it.
		expect(accountAddresses.length).toBe(2)
		const [ownerA, callerB] = accountAddresses as [string, string]
		const step = (m: string) => console.log(`[authwit-smoke] ${m}`)

		step("minting to owner")
		// Owner needs public balance to transfer from.
		await mintPublicTokensForAccount(aztecConfig!, ownerA)

		await page.evaluate(
			({ token, owner, caller }: { token: string; owner: string; caller: string }) => {
				const setVal = (sel: string, v: string) => {
					const input = document.querySelector<HTMLInputElement>(sel)
					if (!input) return
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
					setter?.call(input, v)
					input.dispatchEvent(new Event("input", { bubbles: true }))
				}
				setVal('[data-testid="pg-input-tokenAddress"]', token)
				setVal('[data-testid="pg-input-authwitOwner"]', owner)
				setVal('[data-testid="pg-input-authwitCaller"]', caller)
				setVal('[data-testid="pg-input-authwitAmount"]', "1")
				setVal('[data-testid="pg-input-authwitNonce"]', "1")
			},
			{ token: aztecConfig!.tokenAddress, owner: ownerA, caller: callerB },
		)

		step("inputs set; clicking grant")
		// ── Grant (as A — the fixture's selectedAccount is granted[0]) ──
		const seqGrant = await snapshotResultSeq(page)
		const grantPopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-grantPublicAuthwit")
		const grantPopup = await grantPopupP
		await waitForExecuteContent(grantPopup)
		await approveExecute(grantPopup)
		step("grant popup approved; awaiting grant result")
		const grantResult = await waitForPgResult(page, "grantPublicAuthwit", seqGrant, 120_000)
		expect(grantResult.status).toBe("ok")

		// The RPC resolves at SUBMIT; the consume's public simulation reads
		// the registry, so the grant must be MINED first.
		// resultJson is the raw attribute string — a tx hash is a plain `0x…`
		// (not JSON-encoded), so strip surrounding quotes if present rather than JSON.parse.
		const grantTxHash = String(grantResult.resultJson).replace(/^"(.*)"$/, "$1")
		expect(grantTxHash).toMatch(/^0x/)
		step(`grant result ${grantResult.status}; mining ${grantTxHash}`)
		await waitForTxMined(aztecConfig!, grantTxHash)

		// ── Consume (as B — switch the acting account) ──
		await page.evaluate((caller: string) => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-select-account"]')
			if (!select) throw new Error("pg-select-account not present")
			select.value = caller
			select.dispatchEvent(new Event("change", { bubbles: true }))
		}, callerB)

		step("grant mined; switched to caller; clicking consume")
		const seqConsume = await snapshotResultSeq(page)
		const consumePopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-consumeAuthwit")
		const consumePopup = await consumePopupP
		await waitForExecuteContent(consumePopup)
		await approveExecute(consumePopup)
		step("consume popup approved; awaiting consume result")
		const consumeResult = await waitForPgResult(page, "sendTx", seqConsume, 240_000)
		// ok ⇒ the build's public simulation passed the AuthRegistry check —
		// the approval existed and B was the authorized caller.
		expect(consumeResult.status).toBe("ok")
	},
)
