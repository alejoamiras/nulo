import { expect, inject } from "vitest"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResults } from "../fixtures/playground"
import { waitForPopup, waitForExecuteContent, rejectExecute } from "../fixtures/popups"
import { readDappExecuteRecords, waitForInFlight } from "../fixtures/journal"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Concurrent sendTx — two requests on the same dApp session serialize FIFO
 * and BOTH settle. Pin for the "only one pending tx shown" bug fixed via
 * queued-stage journal records + per-session FIFO baton + journal-layer mutex.
 *
 * Bug before fix: dispatcher's interaction lock blocked the second sendTx
 * from creating its journal record / opening its popup, so the dApp's second
 * promise hung forever and the user saw a single record in Recent Activity.
 * Both popups failing to appear and both promises settling is the smallest
 * end-to-end signal that the FIFO + queued-record path works.
 *
 * Strategy:
 *   1. Fire two sendTx-default calls in rapid succession (no await between).
 *   2. First execute popup opens — reject (avoids paying the prove budget).
 *   3. Second execute popup opens (FIFO release after first reject).
 *   4. Reject second.
 *   5. Both dApp promises settle as `error` with structured 4001
 *      `JOB_CANCELLED`. The presence of TWO distinct settled result rows on
 *      the playground is the direct contradiction of the "lost second tx" bug.
 *
 * Uses `dappConnectedExtensionWithTransactionCap` so the cap-grant cost is
 * paid in the fixture's 300s hookTimeout, not the test budget. Reject path
 * avoids the full prove pipeline so the test stays well under the network
 * shard's per-file wall-time budget.
 *
 * TODO(follow-up: dapp-interaction-lock-fix-v3 — parallel popups):
 *   This test exercises the popup-serialization + queued-record invariants
 *   but does NOT exercise the FIFO baton release at `onExecutionEnqueued`
 *   — popup #1 is rejected BEFORE approval, so the wallet's
 *   `buildAndEstimateTxRequest` never runs. The baton-release boundary
 *   (background.ts: queued → pending → baton.release) is unverified at
 *   e2e level. The approval-path companion is concurrent-sendtx-approve.test.ts.
 */
test.skipIf(!hasConfig)(
	"concurrent-sendtx — two queued sendTx requests serialize FIFO and both settle",
	{ timeout: 90_000 },
	async ({ dappConnectedExtensionWithTransactionCap: ctx }) => {
		const { playgroundPage: page } = ctx

		// Inputs — a valid transfer payload. Reject before approval so simulate
		// never runs; we don't need to pre-mint balance.
		await page.evaluate(
			({ token, recipient }: { token: string; recipient: string }) => {
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
			},
			{ token: aztecConfig!.tokenAddress, recipient: aztecConfig!.minterAddress },
		)

		const seqBefore = await snapshotResultSeq(page)

		// Arm popup wait BEFORE the clicks so we don't miss the first target.
		const firstPopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })

		// Fire two clicks in rapid succession from in-page. Two synchronous
		// dispatchEvent calls — both safe(method, fn) handlers start their
		// own sendTx promise concurrently before either has done any async
		// work. This is exactly the shape that reproduced the lost-second-tx
		// bug pre-fix.
		await page.evaluate(() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="pg-btn-sendTx-default"]')
			if (!btn) throw new Error("pg-btn-sendTx-default not found")
			btn.click()
			btn.click()
		})

		const firstPopup = await firstPopupP
		await waitForExecuteContent(firstPopup)

		// FIFO assertion #1: while popup #1 is still open, popup #2 must NOT
		// exist as a target. The bug pre-fix would have either dropped the
		// second sendTx silently (no popup ever) or raced into a duplicate
		// popup. Allow a generous settle window — if popup #2 is going to
		// appear early, it shows up within 2-3s of the second click landing.
		await new Promise((r) => setTimeout(r, 3_000))
		const executeTargetsDuringFirst = ctx.browser.targets().filter((t) => t.type() === "page" && t.url().includes("#/windows/execute"))
		expect(executeTargetsDuringFirst.length).toBe(1)

		// Journal-state assertion (the source of truth): BEFORE rejecting popup #1,
		// the journal must hold both records (a single record = the pre-fix lost-tx
		// bug). Wait on the journal so we don't race record-creation ordering.
		const walletPopup = await openPopup(ctx)
		await waitForHash(walletPopup, "#/popup/general", 30_000)
		// Pre-approval BOTH records are `queued` (the queued->pending claim happens at
		// execution start, not popup-open), so assert >=2 in-flight + >=1 queued, NOT
		// an active record. The approval-boundary variant (concurrent-sendtx-approve)
		// is where one record reaches an active stage.
		await waitForInFlight(walletPopup, { minInFlight: 2, minQueued: 1, timeout: 30_000 })
		const journalRecords = await readDappExecuteRecords(walletPopup)

		// UI cross-check (secondary to the journal above): RecentActivityView must
		// render a `tx-awaiting-card` per in-flight op, so the fix is user-visible
		// in the wallet UI, not just in storage. The journal is the primary oracle;
		// this only confirms the render projection. Generous wait — the cards paint
		// from the journal subscription that waitForInFlight already confirmed.
		await walletPopup.waitForFunction(() => document.querySelectorAll('[data-testid="tx-awaiting-card"]').length >= 2, {
			timeout: 15_000,
			polling: 200,
		})
		const awaitingCardCount = await walletPopup.evaluate(() => document.querySelectorAll('[data-testid="tx-awaiting-card"]').length)
		await walletPopup.close()

		// Two dapp_execute records, both bound to the same dApp session. At least
		// one must be `queued` (FIFO blocked); the other is a live-claim stage.
		expect(journalRecords.length).toBeGreaterThanOrEqual(2)
		const sessionIds = new Set(journalRecords.map((r) => r.sessionId).filter(Boolean))
		expect(sessionIds.size).toBe(1)
		const stages = journalRecords.map((r) => r.stage).sort()
		expect(stages).toContain("queued")
		// Older records from prior fixture activity may add extras, so use >= not exact.
		expect(awaitingCardCount).toBeGreaterThanOrEqual(2)

		// Arm wait for SECOND popup BEFORE rejecting the first. preExisting
		// snapshot will include the first popup's URL (the requestIds differ),
		// so the second popup's distinct URL won't be filtered out.
		const secondPopupP = waitForPopup(ctx, "execute", { timeout: 60_000 })
		await rejectExecute(firstPopup)

		const secondPopup = await secondPopupP
		await waitForExecuteContent(secondPopup)
		await rejectExecute(secondPopup)

		// Both dApp promises must settle. The two sendTx run CONCURRENTLY, so their
		// reject results can land on the playground in EITHER seq order — collect
		// both with seq > seqBefore regardless of order (returned ascending), then
		// assert. The previous `waitForPgResult` twice ("wait for seq > r1.seq")
		// deadlocked when the higher seq settled first: r1 grabbed it, r2 then
		// waited for an even-higher seq that never came. Distinct seqs = two settled
		// rows = direct refutation of "only one tx visible".
		const [r1, r2] = await waitForPgResults(page, "sendTx", seqBefore, 2, 30_000)
		expect(r1.status).toBe("error")
		expect(r2.status).toBe("error")
		expect(r2.seq).toBeGreaterThan(r1.seq)

		// Both errors should carry the reject signal back to the dApp. The
		// reject-popup path (clicking the popup's Reject button) routes
		// through `rejectViaInteractionService("User rejected")` — distinct
		// from cancel-mid-prove (which produces structured 4001
		// JOB_CANCELLED, pinned in cancel-mid-prove.test.ts). The shape that
		// matters here is that BOTH calls error, neither hangs — the seq
		// distinctness above already proves both surfaced separately.
		// Sample one error payload as a stringified non-empty diagnostic.
		const errorPayload = r1.errorJson as string | { message?: string } | undefined
		const errMessage = typeof errorPayload === "string" ? errorPayload : errorPayload?.message
		expect(typeof errMessage).toBe("string")
		expect(errMessage!.length).toBeGreaterThan(0)
	},
)
