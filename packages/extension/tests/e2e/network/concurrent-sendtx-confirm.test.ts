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
 * Concurrent sendTx — two APPROVED sends serialize on the execution mutex; T1
 * fully confirms (v3 parallel popups, heavy).
 *
 * Fire two sendTx, approve popup #1 (baton releases → popup #2 opens), approve
 * popup #2. The per-(profileId, chainId) execution mutex runs them one-at-a-time:
 * with T1 held at `proving`, the journal shows T1 `proving` while T2 is `queued`
 * behind it — the deterministic serialization signal. Releasing T1 lets it
 * complete its full prove + submit.
 *
 * ARCHITECTURAL LIMIT (codex-confirmed — see lessons/mode-4-local-repro.md): two
 * concurrent SAME-spend-source sends cannot BOTH succeed. The mutex releases at
 * submit (not mine) and the PXE's pending-nullifier cache is per-execution, so T2
 * simulates against pre-T1-mine state and hits "duplicate siloed nullifier". That
 * is a real, proving-time-masked property — NOT a test bug. So this test asserts
 * only the mutex serialization (ordering) + T1's full confirm, NOT that T2 also
 * confirms. (Making T2's case succeed is product/design work — pending-aware
 * simulate or hold-until-mine — tracked as a follow-up, not patched here.)
 *
 * Cost: T1's full prove on the sandbox. HEAVY — runs in the dedicated network-e2e
 * job, not the standard shard matrix.
 */
test.skipIf(!hasConfig)(
	"concurrent-sendtx-confirm — two approved sends serialize on the mutex; T1 fully confirms",
	{ timeout: 360_000 },
	async ({ dappConnectedExtensionWithTransactionCap: ctx }) => {
		const { playgroundPage: page, accountAddress } = ctx

		// Pre-mint enough public balance for the transfers. (dev's shared helper.)
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

		// Fire two sendTx in rapid succession; both start their dApp promise before
		// either does async work — the concurrent shape.
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

		// Deterministic ordering assert, read from the JOURNAL (source of truth):
		// with T1 held by the proof gate, the journal must hold a `dapp_execute`
		// record at `proving` (T1) AND one at `queued` (T2 behind it on the mutex)
		// — the non-timing signal that serialization holds.
		const orderingPopup = await openPopup(ctx)
		await waitForDappExecuteStagesPresent(orderingPopup, ["proving", "queued"], { timeout: 30_000 })
		const orderingStages = (await readDappExecuteRecords(orderingPopup)).map((r) => r.stage)
		expect(orderingStages).toContain("proving")
		expect(orderingStages).toContain("queued")

		// Release T1 → it completes its full prove + submit. We assert only what the
		// architecture provides (see the ARCHITECTURAL LIMIT note above): the mutex
		// SERIALIZED the two approved sends (ordering above) AND T1 fully confirms.
		// We do NOT assert T2 also settles `ok` — for two same-spend-source
		// concurrent sends it cannot (submit-vs-mine + per-execution pending cache).
		await releaseProofGate(orderingPopup)
		await orderingPopup.close()

		const r1 = await waitForPgResult(page, "sendTx", seqBefore, 300_000)
		expect(r1.status).toBe("ok")
	},
)
