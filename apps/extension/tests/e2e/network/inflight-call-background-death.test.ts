/**
 * A dApp call the background's death leaves unanswered fails within seconds, and the dApp
 * reconnects on the same page.
 *
 * The encrypted session lives only in the background's memory. A restarted background knows no
 * session, so the dApp's heartbeat and its calls reach it and are dropped; nothing on the wire says
 * "gone", and the dApp waits out its own 300 s ceiling. The wallet answers a message that names a
 * session the sender's tab does not hold with the SDK's unencrypted `session-disconnected`, and the
 * SDK rejects every in-flight call at once (`Wallet disconnected`).
 *
 * Three shapes. A send parked in proving when the background dies. An idle dApp whose next call is
 * what wakes a cold background: the cold-start relay drops that call, as it drops every pre-attach
 * message but discovery, so the call's own heartbeat is what gets the answer. And an idle dApp
 * calling a background that is already up, held to under one heartbeat interval, so only the
 * message itself can have been answered. Each reconnects WITHOUT reloading the page — a reload
 * would hide a broken same-page reconnect.
 *
 * In the first two nothing is opened between the kill and the answer and every alarm is cleared
 * before it, so the dApp's own traffic is the only thing that can wake a successor. Firefox starts
 * none on its own; there the rejection also proves that traffic wakes it.
 *
 * @requires-proverless — the proof gate parks the send; the agent runner refuses this file without
 * `NULO_E2E_PROVERLESS=1`. Run with `NULO_E2E_RETRY=0`: it spends on-chain and PXE state that a
 * retry would find half-consumed.
 */
import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import { type AztecTestConfig, mintPublicTokensForAccount } from "../fixtures/aztec"
import { backgroundAlive, stopBackground } from "../fixtures/browser"
import { clickByTestId, type ExtensionContext, openPopup, test, waitForHash } from "../fixtures/extension"
import { readLivenessBaseline, unlockAfterBackgroundDeath, waitForWorkerLiveness } from "../fixtures/helpers"
import { waitForSendRecord } from "../fixtures/journal"
import { type PgResult, setPgInput, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup, waitForPopupClosed } from "../fixtures/popups"
import { PROOF_GATE_HOLD_MS, holdProofGate, releaseProofGate } from "../fixtures/proof-gate"
import { reconnectPlayground, sendDefaultTx } from "../fixtures/send"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const SPEC = "inflight-call-background-death"

/** The whole answer — the dApp's next heartbeat, the successor's boot, the reply — must land here. */
const REJECTION_BUDGET_MS = 30_000
/** Under the SDK's 5 s heartbeat interval: a rejection this fast was answered to the call itself. */
const ATTACHED_REJECTION_BUDGET_MS = 3_000

const errorMessageOf = (result: PgResult): string => {
	const payload = result.errorJson as string | { message?: string } | undefined
	return (typeof payload === "string" ? payload : payload?.message) ?? ""
}

/**
 * Clear every alarm, close the last extension page and end the background. The alarms would wake a
 * successor on their own schedule; with them gone and no page opened, only the dApp can. Returns
 * the moment the old instance was seen gone.
 */
async function quietKill(ctx: ExtensionContext, lastExtensionPage: Page): Promise<number> {
	await lastExtensionPage.evaluate(() => chrome.alarms.clearAll())
	await lastExtensionPage.close()
	await stopBackground(ctx)
	return Date.now()
}

/**
 * Wait for the dApp's `method` call to settle as the SDK's disconnect rejection within `budgetMs`
 * of `since`, and return how long it took. The wait gets only what is left of the budget and the
 * elapsed time is asserted, so a slow driver round-trip cannot let a later answer pass for the one
 * under test. A timeout names whether a background runs by then — on the unfixed tree that is the
 * whole diagnosis of what woke it.
 */
async function rejectedWithin(
	ctx: ExtensionContext,
	dapp: Page,
	method: string,
	fromSeq: number,
	since: number,
	budgetMs: number,
): Promise<number> {
	let result: PgResult
	try {
		result = await waitForPgResult(dapp, method, fromSeq, Math.max(since + budgetMs - Date.now(), 1))
	} catch (err) {
		const alive = await backgroundAlive(ctx).catch(
			(probe: unknown) => `unknown (${probe instanceof Error ? probe.message : String(probe)})`,
		)
		throw new Error(
			`[${SPEC}] ${method} did not settle within ${budgetMs} ms (background alive now: ${alive}): ${err instanceof Error ? err.message : String(err)}`,
		)
	}
	const elapsedMs = Date.now() - since
	expect(elapsedMs, `[${SPEC}] ${method} settled ${elapsedMs} ms after the kill; the budget is ${budgetMs} ms`).toBeLessThanOrEqual(
		budgetMs,
	)
	expect(result.status, `[${SPEC}] ${method} settled ok; a dead session must reject`).toBe("error")
	expect(errorMessageOf(result)).toContain("Wallet disconnected")
	await dapp.waitForSelector('[data-testid="pg-status"][data-status="disconnected"]', { timeout: 5_000 })
	console.log(`[${SPEC}] ${method} rejected ${elapsedMs} ms after the kill`)
	return elapsedMs
}

/** Unlock on `popup` (the death locked the wallet), reconnect on the same dApp page and land a fresh send. */
async function recoverAndSend(ctx: ExtensionContext, popup: Page, dapp: Page, label: string): Promise<void> {
	await unlockAfterBackgroundDeath(popup)
	await reconnectPlayground(ctx, dapp, "transaction", `${SPEC}:${label}:caps`)
	await sendDefaultTx(ctx, dapp, aztecConfig as AztecTestConfig, `${SPEC}:${label}:send`, { popupTimeoutMs: 180_000 })
}

test.skipIf(!hasConfig)(
	`${SPEC} — a send parked in proving is rejected within seconds of the kill, then reconnects on the same page`,
	{ timeout: 600_000, retry: 0 },
	async ({ dappConnectedExtensionWithTransactionCap: ctx }) => {
		const { playgroundPage: dapp, accountAddress } = ctx
		const config = aztecConfig as AztecTestConfig
		await mintPublicTokensForAccount(config, accountAddress)

		const wallet = await openPopup(ctx)
		await waitForHash(wallet, "#/popup/general", 30_000)
		await setPgInput(dapp, "tokenAddress", config.tokenAddress)
		await setPgInput(dapp, "recipient", config.minterAddress)
		await setPgInput(dapp, "amount", "1")
		const seqTx = await snapshotResultSeq(dapp)

		await holdProofGate(wallet)
		const execPopupP = waitForPopup(ctx, "execute", { timeout: 60_000 })
		await clickByTestId(dapp, "pg-btn-sendTx-default")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup, 60_000)
		await approveExecute(execPopup, { approvableTimeoutMs: 120_000 })
		await waitForPopupClosed(execPopup, 15_000)
		const send = await waitForSendRecord(wallet, (r) => r.kind === "dapp_execute" && r.stage === "proving")

		const killedAt = await quietKill(ctx, wallet)
		const gateHoldsUntil = (send.enteredProveAt ?? Number.NaN) + PROOF_GATE_HOLD_MS
		expect(killedAt, "the kill must land while the proof gate still holds the send").toBeLessThan(gateHoldsUntil)

		await rejectedWithin(ctx, dapp, "sendTx", seqTx, killedAt, REJECTION_BUDGET_MS)

		const popup = await openPopup(ctx)
		// The held gate key outlives the background in `storage.session`; a fresh send would park on it.
		await releaseProofGate(popup)
		await recoverAndSend(ctx, popup, dapp, "in-flight")
		// The successor's boot sweep declared the parked send lost; the activity feed shows it interrupted.
		expect((await waitForSendRecord(popup, (r) => r.id === send.id && r.stage === "failed")).stage).toBe("failed")
		await popup.waitForSelector('[data-testid="tx-terminal-card"] [data-color="amber"]', { visible: true, timeout: 30_000 })
	},
)

test.skipIf(!hasConfig)(
	`${SPEC} — an idle dApp's call that wakes a cold background is rejected within seconds, then reconnects on the same page`,
	{ timeout: 480_000, retry: 0 },
	async ({ dappConnectedExtensionWithTransactionCap: ctx }) => {
		const { playgroundPage: dapp, accountAddress } = ctx
		await mintPublicTokensForAccount(aztecConfig as AztecTestConfig, accountAddress)
		const wallet = await openPopup(ctx)
		await waitForHash(wallet, "#/popup/general", 30_000)

		const killedAt = await quietKill(ctx, wallet)
		const seq = await snapshotResultSeq(dapp)
		await clickByTestId(dapp, "pg-btn-getChainInfo")
		await rejectedWithin(ctx, dapp, "getChainInfo", seq, killedAt, REJECTION_BUDGET_MS)

		await recoverAndSend(ctx, await openPopup(ctx), dapp, "idle-cold")
	},
)

test.skipIf(!hasConfig)(
	`${SPEC} — an idle dApp's call to a background that is already up is rejected at once, then reconnects on the same page`,
	{ timeout: 480_000, retry: 0 },
	async ({ dappConnectedExtensionWithTransactionCap: ctx }) => {
		const { playgroundPage: dapp, accountAddress } = ctx
		await mintPublicTokensForAccount(aztecConfig as AztecTestConfig, accountAddress)
		const wallet = await openPopup(ctx)
		await waitForHash(wallet, "#/popup/general", 30_000)

		await quietKill(ctx, wallet)
		// The popup wakes a successor. Its first liveness write follows the content listener's
		// attachment, so a strictly newer heartbeat means the wrapper is in place — the popup's own
		// screens render on services that come up earlier, and would not.
		const popup = await openPopup(ctx)
		const baseline = await readLivenessBaseline(popup)
		await waitForWorkerLiveness(popup, baseline, { timeoutMs: 60_000 })

		const seq = await snapshotResultSeq(dapp)
		const askedAt = Date.now()
		await clickByTestId(dapp, "pg-btn-getChainInfo")
		await rejectedWithin(ctx, dapp, "getChainInfo", seq, askedAt, ATTACHED_REJECTION_BUDGET_MS)

		await recoverAndSend(ctx, popup, dapp, "idle-up")
	},
)
