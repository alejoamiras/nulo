import { describe, expect, test, vi } from "vitest"
import { createProvePhaseSink } from "./prove-phase-sink"

describe("createProvePhaseSink", () => {
	test("delivers each event to every subscriber; an event before any subscriber is dropped", () => {
		const sink = createProvePhaseSink()
		const event = { proveId: "p", seq: 1, phase: "transmit" as const, backend: "presto" as const }
		sink.emit(event)
		const a = vi.fn()
		const b = vi.fn()
		sink.subscribe(a)
		sink.subscribe(b)
		sink.emit(event)
		expect(a).toHaveBeenCalledExactlyOnceWith(event)
		expect(b).toHaveBeenCalledExactlyOnceWith(event)
	})
})
