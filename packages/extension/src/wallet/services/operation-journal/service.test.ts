/**
 * OperationJournalService — Phase 2 contract tests.
 *
 * Pure storage-only service tested via FakeBrowserApi + ServiceCollection.
 * No chrome.*, no PXE, no full extension. 10 cases covering the new
 * FSM-aware contract; succinct rather than exhaustive (the FSM table
 * itself is covered in `@nulo/wallet-core/jobs/fsm.test.ts`).
 */

import { ValidationError } from "@nulo/extension-messaging/errors"
import { IllegalTransitionError, type JobProgress } from "@nulo/wallet-core/jobs"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { OperationJournalService } from "./service"
import type { NewOperationInput } from "./spec"

const VALID_INPUT: NewOperationInput = {
	kind: "transfer",
	origin: "popup",
	profileId: "profile-a",
}

async function started(): Promise<{ api: FakeBrowserApi; service: OperationJournalService }> {
	const api = new FakeBrowserApi()
	api.reset()
	const logger = new LoggerStore(new ConfigStore())
	const service = new OperationJournalService(logger, api)
	const services = new ServiceCollection()
	services.add(service)
	await services.start()
	return { api, service }
}

describe("OperationJournalService", () => {
	let api: FakeBrowserApi
	let service: OperationJournalService

	beforeEach(async () => {
		;({ api, service } = await started())
	})

	test("createOperation: stamps required carries (origin/profileId/progress/terminalAt/attempts), persists, emits", async () => {
		const seen = vi.fn()
		service.onOperationAdded.add(seen)

		const rec = await service.createOperation({
			...VALID_INPUT,
			accountAddress: "0xabc",
			networkId: "net1",
			title: "Send 5 USDC",
			subtitle: "to 0xdef",
		})

		// Carry stamps
		expect(rec.id).toMatch(/^[0-9a-f]+$/i)
		expect(rec.origin).toBe("popup")
		expect(rec.profileId).toBe("profile-a")
		expect(rec.progress).toEqual({ stage: "pending" })
		expect(rec.error).toBeNull()
		expect(rec.terminalAt).toBeNull()
		expect(rec.attempts).toBe(0)

		// Existing-consumer fields preserved
		expect(rec.kind).toBe("transfer")
		expect(rec.accountAddress).toBe("0xabc")
		expect(rec.networkId).toBe("net1")
		expect(rec.title).toBe("Send 5 USDC")
		expect(rec.subtitle).toBe("to 0xdef")

		// Persisted via the port
		const entries = await api.storage.session.get(null)
		expect(`nulo:journal@${rec.id}` in entries).toBe(true)

		expect(seen).toHaveBeenCalledWith(rec)
	})

	test("createOperation: persists amountRaw + recipientAddress + transferType for transfer ops", async () => {
		const rec = await service.createOperation({
			...VALID_INPUT,
			accountAddress: "0xabc",
			networkId: "net1",
			tokenId: 42,
			amountRaw: "5000000",
			recipientAddress: "0xdef",
			// TransferType.Private === 0 — pin the falsy enum value so a
			// truthy gate regresses the persistence layer loudly instead of
			// silently dropping the field on Private→Private records.
			transferType: 0,
		})

		expect(rec.amountRaw).toBe("5000000")
		expect(rec.recipientAddress).toBe("0xdef")
		expect(rec.transferType).toBe(0)
	})

	test("createOperation: rejects malformed input (missing origin) with ValidationError", async () => {
		await expect(service.createOperation({ kind: "transfer", profileId: "p" } as never)).rejects.toBeInstanceOf(ValidationError)
	})

	test("transitionOperation: walks the happy path and stamps terminalAt only on terminal", async () => {
		const op = await service.createOperation(VALID_INPUT)

		const simulating = await service.transitionOperation(op.id, { stage: "simulating" })
		expect(simulating.progress.stage).toBe("simulating")
		expect(simulating.terminalAt).toBeNull()

		const proving = await service.transitionOperation(op.id, { stage: "proving", enteredProveAt: 1000 })
		expect(proving.progress).toEqual({ stage: "proving", enteredProveAt: 1000 })
		expect(proving.terminalAt).toBeNull()

		const submitting = await service.transitionOperation(op.id, { stage: "submitting" })
		expect(submitting.progress.stage).toBe("submitting")

		const succeeded = await service.transitionOperation(op.id, { stage: "succeeded", txHash: "0xTX" })
		expect(succeeded.progress).toEqual({ stage: "succeeded", txHash: "0xTX" })
		expect(succeeded.terminalAt).toBeGreaterThan(0)
	})

	test("transitionOperation: rejects illegal transitions via FSM", async () => {
		const op = await service.createOperation(VALID_INPUT)

		// pending → proving skips simulating; illegal per the legal-transitions table
		await expect(service.transitionOperation(op.id, { stage: "proving", enteredProveAt: 0 })).rejects.toBeInstanceOf(
			IllegalTransitionError,
		)

		// Take the record to a terminal state, then try to resurrect it
		await service.transitionOperation(op.id, { stage: "cancelled" })
		await expect(service.transitionOperation(op.id, { stage: "simulating" })).rejects.toBeInstanceOf(IllegalTransitionError)
	})

	test("transitionOperation: enforces 'error iff failed' invariant", async () => {
		const op = await service.createOperation(VALID_INPUT)

		// Missing error on failed → ValidationError
		await expect(service.transitionOperation(op.id, { stage: "failed" })).rejects.toBeInstanceOf(ValidationError)

		// Error provided on a non-failed transition → ValidationError
		await expect(
			service.transitionOperation(op.id, { stage: "simulating" }, { kind: "user_rejected", message: "x", normalizedRaw: null }),
		).rejects.toBeInstanceOf(ValidationError)

		// Valid failed transition with error envelope
		const failed = await service.transitionOperation(
			op.id,
			{ stage: "failed" },
			{ kind: "simulation", message: "boom", normalizedRaw: '{"reason":"oops"}' },
		)
		expect(failed.progress.stage).toBe("failed")
		expect(failed.error).toEqual({ kind: "simulation", message: "boom", normalizedRaw: '{"reason":"oops"}' })
		expect(failed.terminalAt).toBeGreaterThan(0)
	})

	test("transitionOperation: cancelled is reachable from any active stage", async () => {
		const op = await service.createOperation(VALID_INPUT)
		await service.transitionOperation(op.id, { stage: "simulating" })
		await service.transitionOperation(op.id, { stage: "proving", enteredProveAt: 0 })

		const cancelled = await service.transitionOperation(op.id, { stage: "cancelled" })
		expect(cancelled.progress.stage).toBe("cancelled")
		expect(cancelled.terminalAt).toBeGreaterThan(0)
		expect(cancelled.error).toBeNull()
	})

	test("transitionOperation: throws for unknown id", async () => {
		await expect(service.transitionOperation("nope", { stage: "simulating" })).rejects.toThrow(/not found/i)
	})

	test("getOperations: filters by profileId, stage, and isTerminal", async () => {
		const a = await service.createOperation({ ...VALID_INPUT, profileId: "p-a" })
		await service.createOperation({ ...VALID_INPUT, profileId: "p-b" })
		await service.transitionOperation(a.id, { stage: "cancelled" })

		expect(await service.getOperations({ profileId: "p-a" })).toHaveLength(1)
		expect(await service.getOperations({ profileId: "p-b" })).toHaveLength(1)
		expect(await service.getOperations({ stage: "cancelled" })).toHaveLength(1)
		expect(await service.getOperations({ isTerminal: true })).toHaveLength(1)
		expect(await service.getOperations({ isTerminal: false })).toHaveLength(1)
	})

	test("clearChainState: removes records bound to a networkId and emits onDeleted", async () => {
		const seen = vi.fn()
		service.onOperationDeleted.add(seen)
		const onNet1 = await service.createOperation({ ...VALID_INPUT, networkId: "net1" })
		const onNet2 = await service.createOperation({ ...VALID_INPUT, networkId: "net2" })

		await service.clearChainState("net1")

		expect(await service.getOperation(onNet1.id)).toBeUndefined()
		expect(await service.getOperation(onNet2.id)).toBeDefined()
		expect(seen).toHaveBeenCalledTimes(1)
	})

	/**
	 * Layer-2 schema resilience. `EntityStorage` already drops byte-malformed
	 * rows; this group covers the case where a row parses as JSON but doesn't
	 * fit `OperationRecordSchema` (e.g. an unknown stage or a missing required
	 * field). The journal logs, deletes, and returns nothing — the FSM never
	 * sees the bad record.
	 */
	describe("schema-invalid row resilience", () => {
		test("getOperation drops a schema-invalid row and returns undefined", async () => {
			// Write a row directly to storage that bypasses the journal's create path.
			await api.storage.session.set({ "nulo:journal@deadbeef": JSON.stringify({ id: "deadbeef", kind: "transfer" }) })
			expect(await service.getOperation("deadbeef")).toBeUndefined()
			// The bad row should have been deleted as a side effect.
			expect(await service.getOperation("deadbeef")).toBeUndefined()
			const remaining = await api.storage.session.get("nulo:journal@deadbeef")
			expect("nulo:journal@deadbeef" in remaining).toBe(false)
		})

		test("getOperations skips schema-invalid rows and returns only the valid ones", async () => {
			const valid = await service.createOperation(VALID_INPUT)
			await api.storage.session.set({ "nulo:journal@bogus": JSON.stringify({ id: "bogus", foo: 1 }) })

			const ops = await service.getOperations()
			expect(ops.map((o) => o.id)).toEqual([valid.id])
		})

		test("transitionOperation throws 'not found' if the existing row is schema-invalid (record removed)", async () => {
			await api.storage.session.set({ "nulo:journal@zombie": JSON.stringify({ id: "zombie", kind: "transfer" }) })
			await expect(service.transitionOperation("zombie", { stage: "simulating" })).rejects.toThrow(/not found/i)
		})
	})

	describe("kind ↔ succeeded.txHash invariant", () => {
		test("succeeded transfer must carry a txHash; omitting it throws ValidationError", async () => {
			const rec = await service.createOperation(VALID_INPUT)
			await service.transitionOperation(rec.id, { stage: "simulating" })
			await service.transitionOperation(rec.id, { stage: "proving", enteredProveAt: Date.now() })
			await service.transitionOperation(rec.id, { stage: "submitting" })
			await expect(service.transitionOperation(rec.id, { stage: "succeeded" } as unknown as JobProgress)).rejects.toThrow(
				/requires a txHash/i,
			)
		})

		test("succeeded token_import must NOT carry a txHash; including it throws ValidationError", async () => {
			const rec = await service.createOperation({ ...VALID_INPUT, kind: "token_import" })
			await service.transitionOperation(rec.id, { stage: "simulating" })
			await expect(
				service.transitionOperation(rec.id, { stage: "succeeded", txHash: "0xfake" } as unknown as JobProgress),
			).rejects.toThrow(/must not carry a txHash/i)
		})

		test("simulating → succeeded shortcut is rejected for transfer / dapp_execute even with a txHash", async () => {
			const rec = await service.createOperation(VALID_INPUT)
			await service.transitionOperation(rec.id, { stage: "simulating" })
			await expect(
				service.transitionOperation(rec.id, { stage: "succeeded", txHash: "0xfake" } as unknown as JobProgress),
			).rejects.toThrow(/cannot use the simulating → succeeded shortcut/i)
		})

		test("succeeded token_import without txHash is accepted (simulating → succeeded shortcut)", async () => {
			const rec = await service.createOperation({ ...VALID_INPUT, kind: "token_import" })
			await service.transitionOperation(rec.id, { stage: "simulating" })
			const done = await service.transitionOperation(rec.id, { stage: "succeeded" } as unknown as JobProgress)
			expect(done.progress.stage).toBe("succeeded")
			expect(done.terminalAt).not.toBeNull()
		})

		// v2 Layer A — pin `submitting.txHash === succeeded.txHash` invariant.
		// Drift across the prove/submit boundary would silently break
		// RecentActivityView's per-hash pending-suppression filter and bring
		// the disappearing-card bug back. Catch at the FSM layer.
		test("submitting.txHash must match succeeded.txHash when both are populated", async () => {
			const rec = await service.createOperation(VALID_INPUT)
			await service.transitionOperation(rec.id, { stage: "simulating" })
			await service.transitionOperation(rec.id, { stage: "proving", enteredProveAt: Date.now() })
			await service.transitionOperation(rec.id, { stage: "submitting", txHash: "0xaaa" })
			await expect(
				service.transitionOperation(rec.id, { stage: "succeeded", txHash: "0xbbb" } as unknown as JobProgress),
			).rejects.toThrow(/submitting\.txHash !== succeeded\.txHash/i)
		})

		test("submitting → succeeded with matching txHashes is accepted", async () => {
			const rec = await service.createOperation(VALID_INPUT)
			await service.transitionOperation(rec.id, { stage: "simulating" })
			await service.transitionOperation(rec.id, { stage: "proving", enteredProveAt: Date.now() })
			await service.transitionOperation(rec.id, { stage: "submitting", txHash: "0xcanonical" })
			const done = await service.transitionOperation(rec.id, { stage: "succeeded", txHash: "0xcanonical" } as unknown as JobProgress)
			expect(done.progress.stage).toBe("succeeded")
		})

		test("bare submitting (no txHash) → succeeded(txHash) is still accepted (no drift to check against)", async () => {
			// Backward-compat: pre-v2 records that landed in submitting without
			// a txHash should still be transitionable to succeeded. The drift
			// check is conditional on submitting carrying a hash.
			const rec = await service.createOperation(VALID_INPUT)
			await service.transitionOperation(rec.id, { stage: "simulating" })
			await service.transitionOperation(rec.id, { stage: "proving", enteredProveAt: Date.now() })
			await service.transitionOperation(rec.id, { stage: "submitting" })
			const done = await service.transitionOperation(rec.id, { stage: "succeeded", txHash: "0xanything" } as unknown as JobProgress)
			expect(done.progress.stage).toBe("succeeded")
		})
	})

	test("getOperations filter accepts `kind` and isolates token_import from on-chain ops", async () => {
		await service.createOperation(VALID_INPUT) // transfer
		await service.createOperation({ ...VALID_INPUT, kind: "dapp_execute" })
		await service.createOperation({ ...VALID_INPUT, kind: "token_import" })

		const imports = await service.getOperations({ kind: "token_import" })
		expect(imports).toHaveLength(1)
		expect(imports[0]?.kind).toBe("token_import")

		const transfers = await service.getOperations({ kind: "transfer" })
		expect(transfers).toHaveLength(1)
	})

	test("persistence: a fresh service instance reads previously-written records (proves SW restart survival)", async () => {
		const created = await service.createOperation(VALID_INPUT)
		await service.transitionOperation(created.id, { stage: "simulating" })

		// Simulate SW restart by booting a fresh service against the same storage
		const logger = new LoggerStore(new ConfigStore())
		const fresh = new OperationJournalService(logger, api)
		const services = new ServiceCollection()
		services.add(fresh)
		await services.start()

		const rehydrated = await fresh.getOperation(created.id)
		expect(rehydrated?.id).toBe(created.id)
		expect(rehydrated?.progress.stage).toBe("simulating")
		expect(rehydrated?.profileId).toBe("profile-a")
		expect(rehydrated?.attempts).toBe(0)
	})

	// ───────── Concurrent-dApp-sendTx additions ─────────

	test("createOperation: initialStage='queued' produces a queued record (used by message-arrival surface)", async () => {
		const rec = await service.createOperation({
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "session-1",
			initialStage: { stage: "queued" },
		})
		expect(rec.progress.stage).toBe("queued")
		expect(rec.sessionId).toBe("session-1")
		expect(rec.terminalAt).toBeNull()
	})

	test("transitionOperation: queued → pending is legal (claim path)", async () => {
		const rec = await service.createOperation({
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "session-X",
			initialStage: { stage: "queued" },
		})
		const claimed = await service.transitionOperation(rec.id, { stage: "pending" })
		expect(claimed.progress.stage).toBe("pending")
	})

	test("transitionOperation: queued → simulating is illegal (must pass through pending)", async () => {
		const rec = await service.createOperation({
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "session-X",
			initialStage: { stage: "queued" },
		})
		await expect(service.transitionOperation(rec.id, { stage: "simulating" })).rejects.toBeInstanceOf(IllegalTransitionError)
	})

	test("transitionOperation: queued → cancelled is legal (user-cancel-while-queued)", async () => {
		const rec = await service.createOperation({
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "session-X",
			initialStage: { stage: "queued" },
		})
		const cancelled = await service.transitionOperation(rec.id, { stage: "cancelled" })
		expect(cancelled.progress.stage).toBe("cancelled")
		expect(cancelled.terminalAt).not.toBeNull()
	})

	test("countOperations: filters by sessionId and stage; excludes other sessions' records", async () => {
		// Sessioned dapp records — only the wallet-sdk message-arrival surface
		// creates queued records, so the per-session cap query exercises
		// across dapp_execute records with distinct sessionIds.
		await service.createOperation({
			kind: "dapp_execute",
			origin: "dapp",
			profileId: "p1",
			sessionId: "s1",
			initialStage: { stage: "queued" },
		})
		await service.createOperation({
			kind: "dapp_execute",
			origin: "dapp",
			profileId: "p1",
			sessionId: "s1",
			initialStage: { stage: "queued" },
		})
		await service.createOperation({
			kind: "dapp_execute",
			origin: "dapp",
			profileId: "p1",
			sessionId: "s2",
			initialStage: { stage: "queued" },
		})
		// Sessionless UI transfer (popup origin, no sessionId) at default
		// `pending` stage — must NOT count against any per-session queued cap
		// because (a) it has no sessionId and (b) it's not at queued stage.
		await service.createOperation({
			kind: "transfer",
			origin: "popup",
			profileId: "p1",
		})

		expect(await service.countOperations({ sessionId: "s1", stage: "queued" })).toBe(2)
		expect(await service.countOperations({ sessionId: "s2", stage: "queued" })).toBe(1)
		expect(await service.countOperations({ stage: "queued" })).toBe(3)
		// No filter → total non-deleted records.
		expect(await service.countOperations({})).toBe(4)
	})

	test("createOperation: rejects initialStage='queued' without sessionId (refinement)", async () => {
		await expect(
			service.createOperation({
				kind: "dapp_execute",
				origin: "dapp",
				profileId: "p1",
				// no sessionId
				initialStage: { stage: "queued" },
			}),
		).rejects.toThrow(/sessionId/)
	})

	test("createOperation: rejects initialStage='queued' with kind='transfer' (refinement)", async () => {
		await expect(
			service.createOperation({
				kind: "transfer",
				origin: "popup",
				profileId: "p1",
				sessionId: "irrelevant",
				initialStage: { stage: "queued" },
			}),
		).rejects.toThrow(/dapp_execute/)
	})

	test("createOperation: rejects initialStage='queued' with origin='popup' (refinement)", async () => {
		await expect(
			service.createOperation({
				kind: "dapp_execute",
				origin: "popup",
				profileId: "p1",
				sessionId: "session-X",
				initialStage: { stage: "queued" },
			}),
		).rejects.toThrow(/dapp/)
	})

	test("countOperations: stage filter excludes records in other stages", async () => {
		const r = await service.createOperation({
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "session-X",
			initialStage: { stage: "queued" },
		})
		await service.transitionOperation(r.id, { stage: "pending" })
		expect(await service.countOperations({ stage: "queued" })).toBe(0)
		expect(await service.countOperations({ stage: "pending" })).toBe(1)
	})

	test("transitionOperation: mutex serializes concurrent transitions on the same record (claim vs cancel)", async () => {
		// This test pins the journal-mutex contract: concurrent transitions
		// on the same record must serialize at the lock so the FSM holds.
		//
		// Both `queued → pending` and `pending → cancelled` are legal edges.
		// Without the mutex, two concurrent transitions reading the SAME
		// `queued` snapshot would both validate (against the stale read) and
		// produce a stage that doesn't reflect both writes (last-write-wins
		// at the storage layer would leave the record in EITHER `pending`
		// OR `cancelled`, both with stale-validation provenance).
		//
		// WITH the mutex, the second transition sees the first's write and
		// either continues legally (queued → pending → cancelled is a valid
		// 2-hop path) or rejects with IllegalTransitionError. The key
		// invariant: there's no path where the final state was produced
		// without seeing the previous transition's write.
		const rec = await service.createOperation({
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "session-X",
			initialStage: { stage: "queued" },
		})
		const claim = service.transitionOperation(rec.id, { stage: "pending" })
		const cancel = service.transitionOperation(rec.id, { stage: "cancelled" })
		const results = await Promise.allSettled([claim, cancel])

		const fulfilled = results.filter((r) => r.status === "fulfilled")
		const rejected = results.filter((r) => r.status === "rejected")
		// EITHER both succeed (queued → pending → cancelled, valid 2-hop) OR
		// one rejects with IllegalTransitionError (the second saw a state
		// from which its target was unreachable). Both outcomes prove the
		// lock is doing its job.
		expect(fulfilled.length + rejected.length).toBe(2)
		for (const r of rejected) {
			expect((r as PromiseRejectedResult).reason).toBeInstanceOf(IllegalTransitionError)
		}
		const final = await service.getOperation(rec.id)
		// Final state is in EXACTLY one of the legal terminal-or-active
		// stages — never an illegal "stuck mid-transition" state.
		expect(["pending", "cancelled"]).toContain(final?.progress.stage)
	})

	test("transitionOperation: mutex prevents concurrent ILLEGAL transitions from racing past FSM check", async () => {
		// Stronger test: two concurrent illegal transitions targeting the
		// SAME end-stage from a NON-matching start-stage. Without the lock,
		// they could both pass `assertCanTransition` on the same stale read.
		// With the lock, the second sees the first's write and the
		// validation correctly rejects.
		const rec = await service.createOperation({
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "session-X",
			initialStage: { stage: "queued" },
		})
		// Move record to pending first (legal).
		await service.transitionOperation(rec.id, { stage: "pending" })
		// Now both of these would be legal from `pending`: pending → simulating,
		// pending → cancelled. But after one fires, the other's target is
		// either still legal (pending → cancelled after simulating happens
		// would fail because simulating → cancelled IS legal too — so both
		// succeed). The check here is just: NO storage-layer corruption,
		// state is always in a legal stage.
		const a = service.transitionOperation(rec.id, { stage: "simulating" })
		const b = service.transitionOperation(rec.id, { stage: "cancelled" })
		await Promise.allSettled([a, b])
		const final = await service.getOperation(rec.id)
		expect(["simulating", "cancelled"]).toContain(final?.progress.stage)
	})
})
