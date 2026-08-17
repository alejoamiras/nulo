import { describe, expect, test, vi } from "vitest"
import type { ILogger } from "../logger/interfaces"
import type { AlarmEvent, AlarmsPort } from "../ports"
import { AlarmBackedTask } from "./alarm-backed-task"

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
		clear: vi.fn(async () => {}),
	} as unknown as AlarmsPort
	return { port, unsubscribe, fire: (name: string) => listener?.({ name } as AlarmEvent), hasListener: () => listener !== undefined }
}

const noopLogger: ILogger = { log: () => {} }

const make = (a: ReturnType<typeof fakeAlarms>, tick: () => Promise<void>, opts?: { runOnStart?: boolean; logger?: ILogger }) =>
	new AlarmBackedTask({
		name: "nulo:test",
		periodInMinutes: 5,
		tick,
		alarms: a.port,
		logger: opts?.logger ?? noopLogger,
		logSource: "Test",
		runOnStart: opts?.runOnStart,
	})

describe("AlarmBackedTask (Q-05)", () => {
	test("start() creates the alarm, subscribes, and runs the boot tick", async () => {
		const a = fakeAlarms()
		const tick = vi.fn(async () => {})
		await make(a, tick).start()
		expect(a.port.create).toHaveBeenCalledWith("nulo:test", { periodInMinutes: 5 })
		expect(a.hasListener()).toBe(true)
		expect(tick).toHaveBeenCalledTimes(1) // boot run
	})

	test("runOnStart:false skips the boot tick", async () => {
		const a = fakeAlarms()
		const tick = vi.fn(async () => {})
		await make(a, tick, { runOnStart: false }).start()
		expect(tick).not.toHaveBeenCalled()
		expect(a.port.create).toHaveBeenCalled()
	})

	test("only a name-matching alarm dispatches the tick", async () => {
		const a = fakeAlarms()
		const tick = vi.fn(async () => {})
		await make(a, tick, { runOnStart: false }).start()
		a.fire("some:other:alarm")
		expect(tick).not.toHaveBeenCalled()
		a.fire("nulo:test")
		expect(tick).toHaveBeenCalledTimes(1)
	})

	test("a throwing boot tick is caught + logged; start() does not reject", async () => {
		const a = fakeAlarms()
		const log = vi.fn()
		const task = make(
			a,
			async () => {
				throw new Error("boom")
			},
			{ logger: { log } },
		)
		await expect(task.start()).resolves.toBeUndefined()
		expect(log).toHaveBeenCalledWith("Test", expect.anything(), expect.stringContaining("boot"), expect.anything())
	})

	test("a throwing dispatch tick is caught + logged (never escapes the alarm callback)", async () => {
		const a = fakeAlarms()
		const log = vi.fn()
		await make(
			a,
			async () => {
				throw new Error("boom")
			},
			{ runOnStart: false, logger: { log } },
		).start()
		expect(() => a.fire("nulo:test")).not.toThrow()
		await Promise.resolve()
		expect(log).toHaveBeenCalledWith("Test", expect.anything(), "tick threw", expect.anything())
	})

	test("stop() unsubscribes and clears the alarm", async () => {
		const a = fakeAlarms()
		const task = make(
			a,
			vi.fn(async () => {}),
			{ runOnStart: false },
		)
		await task.start()
		await task.stop()
		expect(a.unsubscribe).toHaveBeenCalled()
		expect(a.port.clear).toHaveBeenCalledWith("nulo:test")
		expect(a.hasListener()).toBe(false)
	})
})
