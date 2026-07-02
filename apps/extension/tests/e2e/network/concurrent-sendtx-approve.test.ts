import { expect, inject } from "vitest"
import { openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, rejectExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { countInFlight, waitForInFlight } from "../fixtures/journal"
import { holdProofGate, releaseProofGate } from "../fixtures/proof-gate"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Concurrent sendTx — APPROVAL boundary (v3 parallel popups).
 *
 * Companion to concurrent-sendtx.test.ts (which rejects popup #1 and so never
 * exercises the baton release). This test pins the v3 activation: the session
 * FIFO baton is released at popup #1 APPROVAL, so popup #2 opens *while T1 is
 * still executing* — not after T1's full prove+submit.
 *
 * The discriminator vs the pre-v3 behavior is deterministic, not timing-based:
 * at the instant popup #2 opens, T1's journal record must be in an ACTIVE
 * (non-terminal) stage and T2's must still be `queued`. Pre-v3 the baton only
 * advanced at handler completion, so popup #2 could only appear once T1 had
 * already terminalized — the opposite of what we assert here.
 *
 * Cost control (keeps this in the standard matrix): T1 is approved with the
 * sponsored fee and left mid-prove. We assert the boundary, reject popup #2,
 * and let fixture teardown reap T1's in-flight prove. We never await T1's full
 * lifecycle — that (two sequential proves) is concurrent-sendtx-confirm's job.
 * Pre-mint is required so T1's simulate succeeds and it reaches the slow prove
 * phase, staying active long enough for the boundary snapshot.
 */
test.skipIf(!hasConfig)(
	"concurrent-sendtx-approve — popup #2 opens at popup #1 approval, while T1 is still active",
	{ timeout: 180_000 },
	async ({ dappConnectedExtensionWithTransactionCap: ctx }) => {
		const { playgroundPage: page, accountAddress } = ctx

		// Pre-mint public balance so T1's simulate succeeds and it reaches the
		// slow prove phase. Without balance, simulate reverts fast and T1
		// terminalizes before the boundary snapshot. (dev's shared helper.)
		{
			const { mintPublicTokensForAccount } = await import("../fixtures/aztec")
			await mintPublicTokensForAccount(aztecConfig!, accountAddress)
		}

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

		// Arm popup #1 wait BEFORE the clicks so we don't miss it.
		const firstPopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
		await page.evaluate(() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="pg-btn-sendTx-default"]')
			if (!btn) throw new Error("pg-btn-sendTx-default not found")
			btn.click()
			btn.click()
		})
		const firstPopup = await firstPopupP
		await waitForExecuteContent(firstPopup)

		// Gate assertion: while popup #1 is open and UNAPPROVED, popup #2 must NOT exist —
		// the baton is still held by T1's handler. (Pre-v3 this was also true; the difference
		// is what happens AFTER approval, below.) Fail-fast race-detector — poll up to 3s for
		// a 2nd execute target instead of a blind sleep; the held baton should keep it at 1.
		const countExecuteTargets = () =>
			ctx.browser.targets().filter((t) => t.type() === "page" && t.url().includes("#/windows/execute")).length
		let targetsBeforeApproval = countExecuteTargets()
		const noSecondPopupDeadline = Date.now() + 3_000
		while (targetsBeforeApproval <= 1 && Date.now() < noSecondPopupDeadline) {
			await new Promise((r) => setTimeout(r, 200))
			targetsBeforeApproval = countExecuteTargets()
		}
		expect(targetsBeforeApproval).toBe(1)

		// Arm popup #2 wait, then APPROVE popup #1. The baton releases the instant
		// T1 enqueues on the execution mutex (inside acquireExecutionSlot, just
		// after approval), so popup #2 opens promptly — not after T1's prove+submit.
		const secondPopupP = waitForPopup(ctx, "execute", { timeout: 60_000 })
		// Hold the proof gate so T1 parks deterministically at `proving` for the
		// boundary snapshot. No-op under real proving (the slow prove phase keeps
		// T1 active on its own); load-bearing under proverless, where T1 would
		// otherwise blow through prove+submit before the snapshot is read.
		await holdProofGate(firstPopup)
		const tApprove = Date.now()
		await approveExecute(firstPopup, { feeMethod: "sponsored" })

		const secondPopup = await secondPopupP
		await waitForExecuteContent(secondPopup)
		const elapsedMs = Date.now() - tApprove

		// Discriminator read from the JOURNAL (the source of truth), NOT the
		// rendered cards: a freshly-opened popup paints its cards asynchronously,
		// and RecentActivityView unmounts a card the instant its op terminalizes,
		// so a DOM read races both. With T1 held at `proving`, the journal must
		// show >=1 dapp_execute record ACTIVE (T1 claimed its mutex slot) AND >=1
		// still `queued` (T2 blocked behind it on the FIFO baton). Pre-v3, popup #2
		// could only open after T1 terminalized — there'd be no active+queued pair.
		const walletPopup = await openPopup(ctx)
		await waitForInFlight(walletPopup, { minActive: 1, minQueued: 1, timeout: 30_000 })
		const counts = await countInFlight(walletPopup)
		// Keep T1 HELD through the reject+assert below — otherwise (proverless) T1
		// could settle `ok` first and waitForPgResult would catch it instead of
		// T2's error (codex post-impl audit). walletPopup stays open for the release.

		// Two in-flight records at once: T1 active + T2 still queued behind it on
		// the execution mutex. (>= tolerates any stray prior in-flight op.)
		expect(counts.total).toBeGreaterThanOrEqual(2)
		expect(counts.queued).toBeGreaterThanOrEqual(1)
		expect(counts.active).toBeGreaterThanOrEqual(1)

		// Sanity on the wall-clock: popup #2 opened far sooner than a full T1
		// prove+submit (tens of seconds on the sandbox). Generous to absorb CI
		// jitter; the journal assertion above is the load-bearing one.
		expect(elapsedMs).toBeLessThan(30_000)

		// Reject popup #2 while T1 is still held → T2's error is the FIRST sendTx
		// result after seqBefore (T1 hasn't settled), so we can't catch T1's ok by
		// mistake.
		await rejectExecute(secondPopup)
		const r = await waitForPgResult(page, "sendTx", seqBefore, 30_000)
		expect(r.status).toBe("error")

		// Release T1 (cleanup) so it isn't parked until the gate's safety timeout.
		await releaseProofGate(walletPopup)
		await walletPopup.close()
	},
)
