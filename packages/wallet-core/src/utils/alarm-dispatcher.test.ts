import { describe, expect, test, vi } from "vitest"
import type { ILogger } from "../logger/interfaces"
import type { AlarmEvent, AlarmsPort } from "../ports"
import { AlarmDispatcher } from "./alarm-dispatcher"

function fakeAlarms() {
	let listener: ((a: AlarmEvent) => void) | undefined
	const unsubscribe = vi.fn(() => {
		listener = undefined
	})
	const port = {
		onAlarm: vi.fn((cb: (a: AlarmEvent) => void) => {
			listener = cb
			return unsubscribe
		}),
		create: vi.fn(async () => {}),
		clear: vi.fn(async () => true),
	} as unknown as AlarmsPort
	return {
		port,
		unsubscribe,
		fire: (name: string) => listener?.({ name, scheduledTime: 0 }),
		hasListener: () => listener !== undefined,
	}
}

const noopLogger: ILogger = { log: () => {} }

const make = (a: ReturnType<typeof fakeAlarms>, logger: ILogger = noopLogger) =>
	new AlarmDispatcher("nulo:test", { alarms: a.port, logger, logSource: "Test" })

describe("AlarmDispatcher (Q-05)", () => {
	test("create() forwards the caller's schedule shape verbatim (periodic AND when)", async () => {
		const a = fakeAlarms()
		const d = make(a)
		await d.create({ periodInMinutes: 60 })
		expect(a.port.create).toHaveBeenCalledWith("nulo:test", { periodInMinutes: 60 })
		await d.create({ when: 1234 })
		expect(a.port.create).toHaveBeenLastCalledWith("nulo:test", { when: 1234 })
	})

	test("does NOT run any boot tick on its own (boot-run stays with the caller)", async () => {
		const a = fakeAlarms()
		const tick = vi.fn(async () => {})
		make(a).listen(tick)
		await Promise.resolve()
		expect(tick).not.toHaveBeenCalled()
	})

	test("listen() dispatches only a name-matching alarm", async () => {
		const a = fakeAlarms()
		const tick = vi.fn(async () => {})
		make(a).listen(tick)
		a.fire("some:other:alarm")
		expect(tick).not.toHaveBeenCalled()
		a.fire("nulo:test")
		expect(tick).toHaveBeenCalledTimes(1)
	})

	test("a throwing tick is caught + logged and never escapes the alarm callback", async () => {
		const a = fakeAlarms()
		const log = vi.fn()
		make(a, { log }).listen(async () => {
			throw new Error("boom")
		})
		expect(() => a.fire("nulo:test")).not.toThrow()
		await Promise.resolve()
		expect(log).toHaveBeenCalledWith("Test", expect.anything(), "alarm tick threw", expect.anything())
	})

	test("clear() clears without detaching a listen() subscription", async () => {
		const a = fakeAlarms()
		make(a).listen(vi.fn(async () => {}))
		const d = make(a)
		await d.clear()
		expect(a.port.clear).toHaveBeenCalledWith("nulo:test")
		expect(a.hasListener()).toBe(true) // still subscribed
	})

	test("stop() unsubscribes and clears the alarm", async () => {
		const a = fakeAlarms()
		const d = make(a)
		d.listen(vi.fn(async () => {}))
		await d.stop()
		expect(a.unsubscribe).toHaveBeenCalled()
		expect(a.port.clear).toHaveBeenCalledWith("nulo:test")
		expect(a.hasListener()).toBe(false)
	})

	test("stop() with no listen() still clears (idempotent unsubscribe)", async () => {
		const a = fakeAlarms()
		const d = make(a)
		await expect(d.stop()).resolves.toBeUndefined()
		expect(a.port.clear).toHaveBeenCalledWith("nulo:test")
	})
})
