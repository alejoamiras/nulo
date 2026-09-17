/**
 * Auto-lock waits while an approved send is still proving, then locks once the send is done.
 *
 * The proof gate parks a popup Send at `proving`, and an 8 s TTL expires while the proof is held.
 * The session must stay open with its deadline moved forward and its `since` untouched, which is a
 * deferral and not a refresh. Once the gate is released the send succeeds, and the wallet locks at
 * a following deadline.
 *
 * A deliberate departure from `account-switch-live-session`, where the send finishes because nothing
 * ends the session: here the session does end, and it waits only for approved work still running.
 *
 * Timing is read from the persisted row, not from elapsed time. Chrome may deliver a short alarm late
 * or not at all, so the test runs the expiry check itself through a read that does not refresh the
 * session.
 *
 * @requires-proverless — the proof gate exists only in a proverless build; the agent runner refuses
 * this file without `NULO_E2E_PROVERLESS=1`. Run it with `NULO_E2E_RETRY=0`: it spends on-chain and
 * PXE state that a retry would find half-consumed.
 */
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import { peekSession, readSessionRow, refreshBalances, sendTransfer, setSessionTtlMs, waitForLockScreen } from "../fixtures/helpers"
import { type SendRecordView, waitForSendRecord } from "../fixtures/journal"
import { holdProofGate, releaseProofGate } from "../fixtures/proof-gate"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const TTL_MS = 8_000
/** The proof gate releases itself 20 s after it starts holding; this keeps a 2 s margin. */
const GATE_HOLD_MS = 18_000
const LOCK_AFTER_SEND_MS = 30_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

test.skipIf(!hasConfig)(
	"auto-lock-defers-while-proving — an expired session stays open for a proving send, then locks",
	{ timeout: 240_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		const config = aztecConfig as AztecTestConfig
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general", 15_000)
		await refreshBalances(page)

		await holdProofGate(page)
		// Resolves on the "submitted" toast, which only a released proof can produce.
		const sending = sendTransfer(page, { fromType: "public", toType: "public", amount: "1", destination: config.minterAddress })
		sending.catch(() => {})
		let send: SendRecordView
		try {
			send = await waitForSendRecord(page, (r) => r.kind === "transfer" && r.stage === "proving", 180_000)
			// Only now: every popup navigation refreshes the session, and the Send form takes longer
			// than an 8 s TTL between its entry and its submit.
			const row0 = await setSessionTtlMs(page, TTL_MS)
			const gateReleasesAt = (send.enteredProveAt ?? Number.NaN) + GATE_HOLD_MS
			const checkAt = row0.lockedAt + 1_000
			expect(checkAt, "the deadline must pass while the proof gate still holds").toBeLessThanOrEqual(gateReleasesAt)
			await sleep(checkAt - Date.now())

			expect(await peekSession(page)).toMatchObject({ id: row0.profile })
			await page.waitForSelector('[data-testid="tx-awaiting-card"][data-stage="proving"]', { timeout: 5_000 })
			const row1 = await readSessionRow(page)
			expect(row1?.since).toBe(row0.since)
			expect(row1?.lockedAt).toBeGreaterThan(row0.lockedAt)
			expect(Date.now(), "the deferral must be seen before the proof gate releases itself").toBeLessThan(gateReleasesAt)
		} finally {
			await releaseProofGate(page)
		}

		await sending
		await waitForSendRecord(page, (r) => r.id === send.id && r.stage === "succeeded", 60_000)
		const sendDoneAt = Date.now()
		while ((await peekSession(page)) !== undefined) {
			expect(Date.now() - sendDoneAt, "the wallet must lock once no approved send is running").toBeLessThan(LOCK_AFTER_SEND_MS)
			await sleep(2_000)
		}
		await waitForLockScreen(page, LOCK_AFTER_SEND_MS)
	},
)
