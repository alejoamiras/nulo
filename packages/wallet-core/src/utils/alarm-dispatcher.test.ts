import { describe, expect, test, vi } from "vitest"
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

const make = (a: ReturnType<typeof fakeAlarms>) => new AlarmDispatcher("nulo:test", a.port)
const noop = () => {}

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
		make(a).listen(tick, noop)
		await Promise.resolve()
		expect(tick).not.toHaveBeenCalled()
	})

	test("listen() dispatches only a name-matching alarm", async () => {
		const a = fakeAlarms()
		const tick = vi.fn(async () => {})
		make(a).listen(tick, noop)
		a.fire("some:other:alarm")
		expect(tick).not.toHaveBeenCalled()
		a.fire("nulo:test")
		expect(tick).toHaveBeenCalledTimes(1)
	})

	test("a rejecting tick routes to the caller's onError (dispatcher owns no diagnostic)", async () => {
		const a = fakeAlarms()
		const onError = vi.fn()
		const err = new Error("boom")
		make(a).listen(async () => {
			throw err
		}, onError)
		expect(() => a.fire("nulo:test")).not.toThrow()
		await Promise.resolve()
		expect(onError).toHaveBeenCalledWith(err)
	})

	test("clear() clears without detaching a listen() subscription", async () => {
		const a = fakeAlarms()
		make(a).listen(
			vi.fn(async () => {}),
			noop,
		)
		const d = make(a)
		await d.clear()
		expect(a.port.clear).toHaveBeenCalledWith("nulo:test")
		expect(a.hasListener()).toBe(true) // still subscribed
	})

	test("stop() unsubscribes and clears the alarm", async () => {
		const a = fakeAlarms()
		const d = make(a)
		d.listen(
			vi.fn(async () => {}),
			noop,
		)
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
