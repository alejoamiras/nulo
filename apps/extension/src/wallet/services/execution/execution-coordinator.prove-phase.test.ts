/**
 * `ExecutionCoordinator.onProvePhase` — attribution by `proveId`, the sequence
 * check, the source-copied backend, and the two memory records. The loss model
 * these pin: a dropped or reordered event leaves evidence stale, never wrong.
 */

import { describe, expect, test, vi } from "vitest"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import type { IPXE } from "@/wallet/services/pxe/client"
import type { TaskService, WrappedTask } from "@/wallet/services/task/service"
import { ExecutionCoordinator, ProvePhaseEventSchema } from "./execution-coordinator"

const fakeTask = { complete: vi.fn(), fail: vi.fn(), startSubtask: vi.fn() } as unknown as WrappedTask
;(fakeTask.startSubtask as ReturnType<typeof vi.fn>).mockReturnValue(fakeTask)
const tasks = { startNewTask: () => fakeTask } as unknown as TaskService

type Phase = ReturnType<typeof ProvePhaseEventSchema.parse>["phase"]
type Backend = "presto" | "browser"

/** A coordinator plus a fake PXE whose `proveTx` parks until `finish()`, exposing the minted proveId. */
function harness(opts: { journalRejects?: boolean } = {}) {
	const journal: Array<[string, Backend]> = []
	let journalRejects = opts.journalRejects === true
	const setJournalRejects = (rejects: boolean) => {
		journalRejects = rejects
	}
	const updateProvingBackend = vi.fn(async (id: string, backend: Backend) => {
		if (journalRejects) throw new Error("journal closed")
		journal.push([id, backend])
	})
	const coordinator = new ExecutionCoordinator(tasks, new LoggerStore(new ConfigStore()), { assertCurrent: async () => {} }, undefined, {
		updateProvingBackend,
	})
	const pending: Array<{ proveId: string; finish: () => void }> = []
	const pxe = {
		proveTx: vi.fn(
			(_req: unknown, _scopes: unknown, proveId: string) =>
				new Promise((resolve) => {
					pending.push({ proveId, finish: () => resolve({ marker: "proved" }) })
				}),
		),
	} as unknown as IPXE
	const dispatch = async (journalId: string | undefined) => {
		const done = coordinator.proveTxTask(pxe, {} as never, [], fakeTask, journalId)
		await Promise.resolve()
		const attempt = pending.pop()
		if (!attempt) throw new Error("proveTx was not called")
		return { proveId: attempt.proveId, finish: attempt.finish, done }
	}
	const emit = (proveId: string, seq: number, phase: Phase, backend?: Backend) =>
		coordinator.onProvePhase({ proveId, seq, phase, backend })
	return { coordinator, journal, updateProvingBackend, setJournalRejects, dispatch, emit }
}

describe("ExecutionCoordinator prove-phase attribution", () => {
	test("transmit → fallback ends as browser; the journal receives each change once", async () => {
		const h = harness()
		const a = await h.dispatch("op-1")
		await h.emit(a.proveId, 1, "detect")
		await h.emit(a.proveId, 2, "serialize")
		await h.emit(a.proveId, 3, "transmit", "presto")
		await h.emit(a.proveId, 4, "proving", "presto")
		await h.emit(a.proveId, 5, "fallback", "browser")
		expect(h.journal).toEqual([
			["op-1", "presto"],
			["op-1", "browser"],
		])
		expect(h.coordinator.getLastProveOutcome().outcome).toMatchObject({ phase: "fallback", backend: "browser" })
		a.finish()
		await a.done
	})

	test("transmit seen, fallback dropped, then proved{browser}: journal browser, denial untouched", async () => {
		const h = harness()
		const a = await h.dispatch("op-1")
		await h.emit(a.proveId, 3, "transmit", "presto")
		await h.emit(a.proveId, 6, "proved", "browser")
		expect(h.journal.at(-1)).toEqual(["op-1", "browser"])
		expect(h.coordinator.getLastProveOutcome().denial).toBeNull()
		a.finish()
		await a.done
	})

	test("a reordered lower-seq transmit after fallback is rejected", async () => {
		const h = harness()
		const a = await h.dispatch("op-1")
		await h.emit(a.proveId, 5, "fallback", "browser")
		await h.emit(a.proveId, 3, "transmit", "presto")
		expect(h.journal).toEqual([["op-1", "browser"]])
		expect(h.coordinator.getLastProveOutcome().outcome?.phase).toBe("fallback")
		a.finish()
		await a.done
	})

	test("events after the attempt finished, for an unknown proveId, or malformed, are ignored", async () => {
		const h = harness()
		const a = await h.dispatch("op-1")
		a.finish()
		await a.done
		await h.emit(a.proveId, 1, "transmit", "presto")
		await h.emit("00000000-0000-4000-8000-000000000000", 1, "transmit", "presto")
		await h.coordinator.onProvePhase({ proveId: "not-a-uuid", seq: 1, phase: "transmit" })
		await h.coordinator.onProvePhase({ proveId: a.proveId, seq: -1, phase: "transmit" })
		await h.coordinator.onProvePhase({ proveId: a.proveId, seq: 1, phase: "teleport" })
		await h.coordinator.onProvePhase("garbage")
		expect(h.journal).toEqual([])
		expect(h.coordinator.getLastProveOutcome()).toEqual({ outcome: null, denial: null })
	})

	test("malformed events for a live attempt change nothing and do not consume the sequence number", async () => {
		const h = harness()
		const a = await h.dispatch("op-1")
		await h.emit(a.proveId, 1, "detect")
		await h.coordinator.onProvePhase({ proveId: a.proveId, seq: 2, phase: "teleport" })
		await h.coordinator.onProvePhase({ proveId: a.proveId, seq: 2, phase: "transmit", backend: "native" })
		await h.coordinator.onProvePhase({ proveId: a.proveId, seq: 2.5, phase: "transmit", backend: "presto" })
		await h.coordinator.onProvePhase({ proveId: a.proveId, seq: -1, phase: "transmit", backend: "presto" })
		expect(h.journal).toEqual([])
		expect(h.coordinator.getLastProveOutcome().outcome?.phase).toBe("detect")
		await h.emit(a.proveId, 2, "transmit", "presto")
		expect(h.journal).toEqual([["op-1", "presto"]])
		a.finish()
		await a.done
	})

	test("a journal write that fails once is retried by the next event carrying that backend", async () => {
		const h = harness()
		const a = await h.dispatch("op-1")
		await h.emit(a.proveId, 3, "transmit", "presto")
		h.setJournalRejects(true)
		await h.emit(a.proveId, 5, "fallback", "browser")
		expect(h.journal).toEqual([["op-1", "presto"]])
		h.setJournalRejects(false)
		await h.emit(a.proveId, 6, "proving", "browser")
		await h.emit(a.proveId, 7, "proved", "browser")
		expect(h.journal).toEqual([
			["op-1", "presto"],
			["op-1", "browser"],
		])
		expect(h.updateProvingBackend).toHaveBeenCalledTimes(3)
		a.finish()
		await a.done
	})

	test("two concurrent attempts attribute independently; an attempt without a journal row is not mapped", async () => {
		const h = harness()
		const a = await h.dispatch("op-a")
		const b = await h.dispatch("op-b")
		const c = await h.dispatch(undefined)
		expect(new Set([a.proveId, b.proveId, c.proveId]).size).toBe(3)
		await h.emit(a.proveId, 3, "transmit", "presto")
		await h.emit(b.proveId, 5, "fallback", "browser")
		await h.emit(c.proveId, 3, "transmit", "presto")
		expect(h.journal).toEqual([
			["op-a", "presto"],
			["op-b", "browser"],
		])
		for (const x of [a, b, c]) {
			x.finish()
			await x.done
		}
	})

	test("denied → fallback → proving → proved → receive leaves the denial set; a native proved clears it", async () => {
		const h = harness()
		const a = await h.dispatch("op-1")
		await h.emit(a.proveId, 3, "denied", "browser")
		await h.emit(a.proveId, 4, "fallback", "browser")
		await h.emit(a.proveId, 5, "proving", "browser")
		await h.emit(a.proveId, 6, "proved", "browser")
		await h.emit(a.proveId, 7, "receive", "browser")
		expect(h.coordinator.getLastProveOutcome()).toMatchObject({ outcome: { phase: "receive" }, denial: { at: expect.any(Number) } })
		a.finish()
		await a.done

		const b = await h.dispatch("op-2")
		await h.emit(b.proveId, 3, "transmit", "presto")
		await h.emit(b.proveId, 4, "proving", "presto")
		await h.emit(b.proveId, 5, "proved", "presto")
		expect(h.coordinator.getLastProveOutcome().denial).toBeNull()
		b.finish()
		await b.done
	})

	test("attempt A's delayed native proved arriving after attempt B's denial does not clear it", async () => {
		const h = harness()
		const a = await h.dispatch("op-a")
		const b = await h.dispatch("op-b")
		await h.emit(a.proveId, 3, "transmit", "presto")
		await h.emit(b.proveId, 3, "denied", "browser")
		await h.emit(a.proveId, 5, "proved", "presto") // Presto approved A before it denied B
		expect(h.coordinator.getLastProveOutcome().denial).not.toBeNull()
		for (const x of [a, b]) {
			x.finish()
			await x.done
		}
	})

	test("a rejected journal write is caught; the memory records still update", async () => {
		const h = harness({ journalRejects: true })
		const a = await h.dispatch("op-1")
		await expect(h.emit(a.proveId, 3, "transmit", "presto")).resolves.toBeUndefined()
		expect(h.updateProvingBackend).toHaveBeenCalledOnce()
		expect(h.coordinator.getLastProveOutcome().outcome).toMatchObject({ phase: "transmit", backend: "presto" })
		a.finish()
		await a.done
	})

	test("proveTxTask hands the minted id to pxe.proveTx and unmaps it on throw as well", async () => {
		const h = harness()
		const pxe = { proveTx: vi.fn(async () => Promise.reject(new Error("boom"))) } as unknown as IPXE
		await expect(h.coordinator.proveTxTask(pxe, {} as never, [], fakeTask, "op-1")).rejects.toThrow("boom")
		const proveId = (pxe.proveTx as ReturnType<typeof vi.fn>).mock.calls[0][2] as string
		expect(ProvePhaseEventSchema.safeParse({ proveId, seq: 1, phase: "transmit" }).success).toBe(true)
		await h.emit(proveId, 1, "transmit", "presto")
		expect(h.journal).toEqual([])
	})
})
