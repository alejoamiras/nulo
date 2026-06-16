import { expect, inject } from "vitest"
import { openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { readDappExecuteRecords, waitForDappExecuteStagesPresent } from "../fixtures/journal"
import { holdProofGate, releaseProofGate } from "../fixtures/proof-gate"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Concurrent sendTx — both APPROVED, both CONFIRM (v3 parallel popups, heavy).
 *
 * The end-to-end happy path the v3 activation targets: fire two sendTx, approve
 * popup #1 (baton releases → popup #2 opens), approve popup #2, and BOTH txs
 * settle `ok`. Underneath, the per-(profileId, chainId) execution mutex runs
 * them one-at-a-time, so T2 waits for T1 before touching shared state.
 *
 * This doubles as the mutex correctness pin: both transfers draw down the SAME
 * public balance. Serialized (mutex), T1 spends then T2 spends and both land.
 * Without the mutex, two concurrent builds would simulate against the same
 * pre-T1 balance and one would be rejected on-chain — so two `ok` results is
 * the direct signal that the lifecycle serialization holds.
 *
 * Cost: two sequential proves on the sandbox. This is a HEAVY test — it runs in
 * the dedicated network-e2e job, NOT the standard shard matrix. (Deviation from
 * the "standard matrix" intent, justified by the double-prove wall-time.)
 */
test.skipIf(!hasConfig)(
	"concurrent-sendtx-confirm — two approved sendTx prove sequentially and both confirm",
	{ timeout: 360_000 },
	async ({ dappConnectedExtensionWithTransactionCap: ctx }) => {
		const { playgroundPage: page, accountAddress } = ctx

		// Pre-mint enough public balance for two transfers of 1. (dev's shared helper.)
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

		// Fire two sendTx in rapid succession; both start their dApp promise
		// before either does async work — the concurrent shape.
		const firstPopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
		await page.evaluate(() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="pg-btn-sendTx-default"]')
			if (!btn) throw new Error("pg-btn-sendTx-default not found")
			btn.click()
			btn.click()
		})

		// Approve popup #1 → baton releases → popup #2 opens.
		const firstPopup = await firstPopupP
		await waitForExecuteContent(firstPopup)
		const secondPopupP = waitForPopup(ctx, "execute", { timeout: 60_000 })
		// Hold the proof gate first so T1 parks at `proving`, making the ordering
		// snapshot below deterministic (no-op under real proving).
		await holdProofGate(firstPopup)
		await approveExecute(firstPopup, { feeMethod: "sponsored" })

		// Approve popup #2 → T2 queues behind T1 on the execution mutex.
		const secondPopup = await secondPopupP
		await waitForExecuteContent(secondPopup)
		await approveExecute(secondPopup, { feeMethod: "sponsored" })

		// Deterministic ordering assert, read from the JOURNAL (source of truth),
		// not the rendered cards: with T1 held by the proof gate, the journal must
		// hold a `dapp_execute` record at `proving` (T1) AND one at `queued` (T2
		// behind it on the execution mutex) — the non-timing signal that
		// serialization holds. Waiting on the specific `proving` stage (where the
		// gate parks T1) is why we can't use the generic "reached active" wait.
		const orderingPopup = await openPopup(ctx)
		await waitForDappExecuteStagesPresent(orderingPopup, ["proving", "queued"], { timeout: 30_000 })
		const orderingStages = (await readDappExecuteRecords(orderingPopup)).map((r) => r.stage)
		expect(orderingStages).toContain("proving")
		expect(orderingStages).toContain("queued")
		// Release T1 → it completes, T2 dequeues and proves, both settle.
		await releaseProofGate(orderingPopup)
		await orderingPopup.close()

		// Both dApp promises must settle ok, as two distinct result rows. The
		// long timeout covers two sequential proves on a loaded runner.
		const r1 = await waitForPgResult(page, "sendTx", seqBefore, 300_000)
		const r2 = await waitForPgResult(page, "sendTx", r1.seq, 300_000)
		expect(r1.status).toBe("ok")
		expect(r2.status).toBe("ok")
		expect(r2.seq).toBeGreaterThan(r1.seq)
	},
)
