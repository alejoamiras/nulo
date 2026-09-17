/**
 * A lock confirmed while a dApp's approved send is still proving cancels that send.
 *
 * The proof gate parks the send at `proving`. The lock button counts it and asks first; confirming
 * ends the session, and the send is cancelled while its proof is still held. Releasing the gate
 * must not revive it: the dApp's pending `sendTx` settles with a typed error, the record stays
 * `cancelled`, and no transaction reaches the activity feed.
 *
 * A deliberate departure from `account-switch-live-session`, where the send finishes: an account
 * switch leaves open the session that approved the send, and a lock ends it.
 *
 * @requires-proverless — the proof gate exists only in a proverless build; the agent runner refuses
 * this file without `NULO_E2E_PROVERLESS=1`. Run it with `NULO_E2E_RETRY=0`: it spends on-chain and
 * PXE state that a retry would find half-consumed.
 */
import { JobCancelledError, SessionEndedError } from "@nulo/extension-messaging/errors"
import { expect, inject } from "vitest"
import { type AztecTestConfig, mintPublicTokensForAccount } from "../fixtures/aztec"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { ensureUnlocked, lockThroughConfirmDialog } from "../fixtures/helpers"
import { type SendRecordView, readSendRecords, waitForSendRecord } from "../fixtures/journal"
import { setPgInput, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { PROOF_GATE_HOLD_MS, holdProofGate, releaseProofGate } from "../fixtures/proof-gate"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test.skipIf(!hasConfig)(
	"lock-cancels-dapp-send — confirming the lock dialog cancels a dApp send that is still proving",
	{ timeout: 240_000, retry: 0 },
	async ({ dappConnectedExtensionWithTransactionCap }) => {
		const ctx = dappConnectedExtensionWithTransactionCap
		const { playgroundPage: dapp, accountAddress } = ctx
		const config = aztecConfig as AztecTestConfig
		// Without a balance the simulation reverts and the send never reaches `proving`.
		await mintPublicTokensForAccount(config, accountAddress)

		const wallet = await openPopup(ctx)
		await waitForHash(wallet, "#/popup/general", 30_000)
		await setPgInput(dapp, "tokenAddress", config.tokenAddress)
		await setPgInput(dapp, "recipient", config.minterAddress)
		await setPgInput(dapp, "amount", "1")
		const seqTx = await snapshotResultSeq(dapp)

		await holdProofGate(wallet)
		let send: SendRecordView
		try {
			const execPopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
			await clickByTestId(dapp, "pg-btn-sendTx-default")
			const execPopup = await execPopupP
			await waitForExecuteContent(execPopup)
			await approveExecute(execPopup, { approvableTimeoutMs: 120_000 })
			send = await waitForSendRecord(wallet, (r) => r.kind === "dapp_execute" && r.stage === "proving")

			expect(await lockThroughConfirmDialog(wallet)).toEqual({
				preTitle: "Running transactions",
				title: "Lock wallet?",
				description: "1 transaction is still running. Locking cancels it.",
				confirm: "Lock anyway",
			})
			await waitForSendRecord(wallet, (r) => r.id === send.id && r.stage === "cancelled", 30_000)
			const gateHoldsUntil = (send.enteredProveAt ?? Number.NaN) + PROOF_GATE_HOLD_MS
			expect(Date.now(), "the lock must cancel the send while the proof gate still holds it").toBeLessThan(gateHoldsUntil)
		} finally {
			await releaseProofGate(wallet)
		}

		const result = await waitForPgResult(dapp, "sendTx", seqTx, 60_000)
		expect(result.status).toBe("error")
		const payload = result.errorJson as string | { message?: string } | undefined
		const message = typeof payload === "string" ? payload : payload?.message
		expect([JobCancelledError.CODE, SessionEndedError.CODE]).toContain(JSON.parse(message ?? "{}").data?.walletErrorCode)

		await ensureUnlocked(wallet)
		await waitForHash(wallet, "#/popup/general", 30_000)
		expect((await readSendRecords(wallet)).find((r) => r.id === send.id)?.stage).toBe("cancelled")
		// The cancelled send renders as a terminal card; a broadcast would have added a transaction card.
		await wallet.waitForSelector('[data-testid="tx-terminal-card"]', { visible: true, timeout: 30_000 })
		expect(await wallet.evaluate(() => document.querySelectorAll('[data-testid="tx-card"]').length)).toBe(0)
	},
)
