import { expect, inject } from "vitest"
import { type AztecTestConfig, mintPublicTokensForAccount } from "../fixtures/aztec"
import { BROWSER } from "../fixtures/browser"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { PRESTO_AWAITING_CARD, waitForAwaitingCardBackend, waitForDappExecuteWorked } from "../fixtures/journal"
import { assertPgOk, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, getExecuteOps, waitForExecuteContent, waitForPopup } from "../fixtures/popups"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined

/** Probe 3 is only evidence under a build that may prove nowhere but Presto. */
const prestoRequired = process.env.VITE_NULO_PRESTO_REQUIRED === "1"

/**
 * PROBE 2 — is an `execute` window reachable and drivable the way the approval windows are?
 * PROBE 3 — does a Presto-required build prove one transaction end to end?
 *
 * One flow, two verdicts, because Probe 3 cannot start without everything Probe 2 measures. On
 * Firefox there is no offscreen document: PXE and the prover live in a stand-in window the wallet
 * opens for itself, so a `txHash` from a required-mode build is proof that window booted, reached
 * Presto over loopback and had its proof accepted by the node. The runner additionally checks the
 * Presto server's own log, since a card label is the wallet's word and the log is the prover's.
 */
test.skipIf(aztecConfig === undefined)(
	"PROBE 2 + 3 — a dApp transaction through the execute window",
	{ timeout: 420_000 },
	async ({ dappConnectedExtensionWithTransactionCap: ctx }) => {
		const config = aztecConfig as AztecTestConfig
		const { playgroundPage: page, accountAddress } = ctx
		await mintPublicTokensForAccount(config, accountAddress)

		for (const [field, value] of [
			["tokenAddress", config.tokenAddress],
			["recipient", config.minterAddress],
			["amount", "1"],
		]) {
			await page.evaluate(
				({ field, value }: { field: string; value: string }) => {
					const input = document.querySelector<HTMLInputElement>(`[data-testid="pg-input-${field}"]`)
					if (!input) throw new Error(`no playground input for ${field}`)
					Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(input, value)
					input.dispatchEvent(new Event("input", { bubbles: true }))
				},
				{ field, value },
			)
		}

		const seq = await snapshotResultSeq(page)
		const opening = waitForPopup(ctx, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-default")
		const execute = await opening
		await waitForExecuteContent(execute)
		expect((await getExecuteOps(execute)).map((op) => op.kind)).toEqual(["aztec_sendTx"])
		await approveExecute(execute)
		console.log(`PROBE 2 PASS (${BROWSER})`)

		const wallet = await openPopup(ctx)
		await waitForDappExecuteWorked(wallet)
		if (prestoRequired) await waitForAwaitingCardBackend(wallet, [PRESTO_AWAITING_CARD])

		const result = await waitForPgResult(page, "sendTx", seq, 300_000)
		await assertPgOk(page, result, "probe-3:result")
		expect(typeof (result.resultJson as { txHash?: string } | undefined)?.txHash).toBe("string")
		console.log(prestoRequired ? `PROBE 3 PASS (${BROWSER})` : `PROBE 3 SKIPPED (${BROWSER}): not a Presto-required build`)
	},
)
