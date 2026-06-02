import { expect, inject } from "vitest"
import { openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, rejectExecute, waitForExecuteContent, waitForPopup, waitForSendTxActiveStage } from "../fixtures/popups"
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

		// Gate assertion: while popup #1 is open and UNAPPROVED, popup #2 must
		// NOT exist — the baton is still held by T1's handler. (Pre-v3 this was
		// also true; the difference is what happens AFTER approval, below.)
		await new Promise((r) => setTimeout(r, 3_000))
		const targetsBeforeApproval = ctx.browser.targets().filter((t) => t.type() === "page" && t.url().includes("#/windows/execute"))
		expect(targetsBeforeApproval.length).toBe(1)

		// Arm popup #2 wait, then APPROVE popup #1. The baton releases the instant
		// T1 enqueues on the execution mutex (inside acquireExecutionSlot, just
		// after approval), so popup #2 opens promptly — not after T1's prove+submit.
		const secondPopupP = waitForPopup(ctx, "execute", { timeout: 60_000 })
		const tApprove = Date.now()
		await approveExecute(firstPopup, { feeMethod: "sponsored" })

		const secondPopup = await secondPopupP
		await waitForExecuteContent(secondPopup)
		const elapsedMs = Date.now() - tApprove

		// Discriminator, read via the journal-stage convention dev standardized:
		// each in-flight awaiting card exposes its stage as `data-stage`. Open the
		// wallet and wait until a card reaches an active stage — i.e. T1 claimed
		// its mutex slot and is mid-execution (this also skips the sub-second
		// window where T1 is briefly still `queued` right after popup #2 opens).
		// Pre-v3, popup #2 could only open AFTER T1 terminalized, so T1 would be in
		// history (not an awaiting card) and only T2's queued card would be in
		// flight — the opposite of the two-card state asserted below.
		const walletPopup = await openPopup(ctx)
		await waitForSendTxActiveStage(walletPopup)
		const stages = await walletPopup.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('[data-testid="tx-awaiting-card"]')].map(
				(el) => el.getAttribute("data-stage") ?? "?",
			),
		)
		await walletPopup.close()

		// Two in-flight cards at once: T1 active + T2 still queued behind it on the
		// execution mutex. (≥2 tolerates any stray prior in-flight op.)
		expect(stages.length).toBeGreaterThanOrEqual(2)
		expect(stages).toContain("queued")
		const activeStages = new Set(["pending", "simulating", "proving", "submitting"])
		expect(stages.some((s) => activeStages.has(s))).toBe(true)

		// Sanity on the wall-clock: popup #2 opened far sooner than a full T1
		// prove+submit (tens of seconds on the sandbox). Generous to absorb CI
		// jitter; the journal assertion above is the load-bearing one.
		expect(elapsedMs).toBeLessThan(30_000)

		// Reject popup #2 → T2's dApp promise settles as an error. T1 is left
		// mid-prove and reaped at teardown (see header).
		await rejectExecute(secondPopup)
		const r = await waitForPgResult(page, "sendTx", seqBefore, 30_000)
		expect(r.status).toBe("error")
	},
)
