import { expect, inject } from "vitest"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, rejectExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
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
		// slow prove phase (mirrors cancel-mid-prove). Without balance, simulate
		// reverts fast and T1 terminalizes before the boundary snapshot.
		{
			const { createTestWallet, createSponsoredFeeOptions, mintPublicTokens } = await import("../fixtures/aztec")
			const { wallet, cleanup } = await createTestWallet(aztecConfig!.nodeUrl)
			try {
				const feeOptions = await createSponsoredFeeOptions(wallet)
				await mintPublicTokens(
					wallet,
					aztecConfig!.tokenAddress,
					accountAddress,
					100n * 10n ** 18n,
					aztecConfig!.minterAddress,
					feeOptions,
				)
			} finally {
				await cleanup()
			}
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

		// Deterministic discriminator: at popup #2 open, T1 must be ACTIVE
		// (non-terminal) and T2 still `queued`. Pre-v3, popup #2 could only open
		// after T1 had terminalized — so an active T1 here is the activation.
		const walletPopup = await openPopup(ctx)
		await waitForHash(walletPopup, "#/popup/general", 30_000)
		const readRecords = () =>
			walletPopup.evaluate(async () => {
				const all = (await chrome.storage.session.get(null)) as Record<string, unknown>
				return Object.keys(all)
					.filter((k) => k.startsWith("nulo:journal@"))
					.map((k) => {
						const raw = all[k]
						try {
							return typeof raw === "string"
								? (JSON.parse(raw) as { kind: string; progress?: { stage?: string }; sessionId?: string })
								: null
						} catch {
							return null
						}
					})
					.filter(
						(r): r is { kind: string; progress?: { stage?: string }; sessionId?: string } => !!r && r.kind === "dapp_execute",
					)
					.map((r) => ({ stage: r.progress?.stage ?? "?", sessionId: r.sessionId }))
			})

		// T1 claims its record (queued → pending → simulating) the moment it wins
		// the uncontended mutex slot — a tick or two after popup #2 opened. Poll
		// until that's visible so we don't snapshot the sub-second window where T1
		// is briefly still `queued` alongside T2.
		const activeStages = new Set(["pending", "simulating", "proving", "submitting"])
		let records = await readRecords()
		const deadline = Date.now() + 30_000
		while (!records.some((r) => activeStages.has(r.stage)) && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 200))
			records = await readRecords()
		}
		await walletPopup.close()

		expect(records.length).toBeGreaterThanOrEqual(2)
		const sessionIds = new Set(records.map((r) => r.sessionId).filter(Boolean))
		expect(sessionIds.size).toBe(1)
		const stages = records.map((r) => r.stage)
		// Exactly one record still queued (T2, gated behind T1 on the execution mutex).
		expect(stages.filter((s) => s === "queued").length).toBe(1)
		// At least one record active (T1 mid-execution) — it claimed and progressed.
		expect(stages.some((s) => activeStages.has(s))).toBe(true)
		// Nothing terminal yet: popup #2 opened WHILE T1 was running, not after it
		// finished (the pre-v3 behavior).
		const terminal = new Set(["succeeded", "failed", "cancelled"])
		expect(stages.some((s) => terminal.has(s))).toBe(false)

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
