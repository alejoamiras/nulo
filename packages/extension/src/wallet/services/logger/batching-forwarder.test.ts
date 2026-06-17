import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { LogLevel } from "@/wallet/logger"
import { type BatchEntry, createBatchingForwarder } from "./batching-forwarder"

describe("createBatchingForwarder", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test("buffers Info and flushes one batch after the debounce", () => {
		const batches: BatchEntry[][] = []
		const f = createBatchingForwarder((b) => batches.push(b), { flushMs: 50 })
		f.forward("pxe", LogLevel.Info, "a")
		f.forward("pxe", LogLevel.Info, "b")
		expect(batches).toHaveLength(0)
		vi.advanceTimersByTime(50)
		expect(batches).toHaveLength(1)
		expect(batches[0].map((e) => e.data[0])).toEqual(["a", "b"])
	})

	test("Warn flushes immediately, ordered AFTER prior buffered Info", () => {
		const batches: BatchEntry[][] = []
		const f = createBatchingForwarder((b) => batches.push(b), { flushMs: 50 })
		f.forward("pxe", LogLevel.Info, "i1")
		f.forward("pxe", LogLevel.Warn, "w1")
		expect(batches).toHaveLength(1) // no timer advance — immediate
		expect(batches[0].map((e) => e.data[0])).toEqual(["i1", "w1"])
	})

	test("Error flushes immediately", () => {
		const batches: BatchEntry[][] = []
		const f = createBatchingForwarder((b) => batches.push(b))
		f.forward("pxe", LogLevel.Error, "boom")
		expect(batches).toHaveLength(1)
		expect(batches[0][0].level).toBe(LogLevel.Error)
	})

	test("flushes when the buffer reaches maxBatch", () => {
		const batches: BatchEntry[][] = []
		const f = createBatchingForwarder((b) => batches.push(b), { maxBatch: 3, flushMs: 9999 })
		f.forward("pxe", LogLevel.Info, 1)
		f.forward("pxe", LogLevel.Info, 2)
		expect(batches).toHaveLength(0)
		f.forward("pxe", LogLevel.Info, 3)
		expect(batches).toHaveLength(1)
		expect(batches[0]).toHaveLength(3)
	})

	test("drops oldest beyond maxBuffer and reports the dropped count on flush", () => {
		const batches: BatchEntry[][] = []
		const f = createBatchingForwarder((b) => batches.push(b), { maxBuffer: 2, maxBatch: 99, flushMs: 50 })
		f.forward("pxe", LogLevel.Info, 1)
		f.forward("pxe", LogLevel.Info, 2)
		f.forward("pxe", LogLevel.Info, 3) // 3 > maxBuffer(2) → drop oldest (1)
		vi.advanceTimersByTime(50)
		expect(batches).toHaveLength(1)
		const b = batches[0]
		expect(b.map((e) => e.data[0])).toEqual([2, 3, expect.stringContaining("dropped 1")])
		expect(b[2].level).toBe(LogLevel.Warn)
	})

	test("dispose flushes the remaining buffer", () => {
		const batches: BatchEntry[][] = []
		const f = createBatchingForwarder((b) => batches.push(b), { flushMs: 9999 })
		f.forward("pxe", LogLevel.Info, "x")
		f.dispose()
		expect(batches).toHaveLength(1)
		expect(batches[0][0].data[0]).toBe("x")
	})

	test("empty flush is a no-op (no sink call)", () => {
		const batches: BatchEntry[][] = []
		const f = createBatchingForwarder((b) => batches.push(b))
		f.flush()
		expect(batches).toHaveLength(0)
	})

	test("separate debounce windows produce separate batches", () => {
		const batches: BatchEntry[][] = []
		const f = createBatchingForwarder((b) => batches.push(b), { flushMs: 50 })
		f.forward("pxe", LogLevel.Info, "a")
		vi.advanceTimersByTime(50)
		f.forward("pxe", LogLevel.Info, "b")
		vi.advanceTimersByTime(50)
		expect(batches).toHaveLength(2)
	})
})
