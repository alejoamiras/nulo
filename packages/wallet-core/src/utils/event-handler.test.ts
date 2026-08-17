import { describe, expect, test, vi } from "vitest"
import { type ILogger, LogLevel } from "../logger/interfaces"
import { EventHandler } from "./event-handler"

describe("EventHandler", () => {
	test("invoke delivers the payload to every subscriber", () => {
		const eh = new EventHandler<number>()
		const seen: number[] = []
		eh.add((n) => seen.push(n))
		eh.add((n) => seen.push(n * 10))
		eh.invoke(2)
		expect(seen).toEqual([2, 20])
	})

	test("add is idempotent; remove detaches", () => {
		const eh = new EventHandler<void>()
		const cb = vi.fn()
		eh.add(cb)
		eh.add(cb) // duplicate — ignored
		eh.invoke()
		expect(cb).toHaveBeenCalledTimes(1)
		eh.remove(cb)
		eh.invoke()
		expect(cb).toHaveBeenCalledTimes(1) // no further calls
	})

	test("a throwing subscriber does NOT stop its siblings", () => {
		const eh = new EventHandler<void>()
		const after = vi.fn()
		eh.add(() => {
			throw new Error("boom")
		})
		eh.add(after)
		expect(() => eh.invoke()).not.toThrow()
		expect(after).toHaveBeenCalledTimes(1)
	})

	test("(Q-03) with a logger, a throwing subscriber's error is reported (not swallowed silently)", () => {
		const log = vi.fn()
		const logger: ILogger = { log }
		const eh = new EventHandler<void>("onThing", logger)
		const err = new Error("boom")
		eh.add(() => {
			throw err
		})
		eh.invoke()
		expect(log).toHaveBeenCalledWith("event-handler", LogLevel.Error, expect.stringContaining("onThing"), err)
	})

	test("(Q-03) without a logger, a throwing subscriber is silently isolated (back-compat)", () => {
		const eh = new EventHandler<void>()
		const after = vi.fn()
		eh.add(() => {
			throw new Error("boom")
		})
		eh.add(after)
		expect(() => eh.invoke()).not.toThrow()
		expect(after).toHaveBeenCalledTimes(1)
	})

	test("(Q-03) a THROWING logger must not break dispatch", () => {
		const logger: ILogger = {
			log: () => {
				throw new Error("logger down")
			},
		}
		const eh = new EventHandler<void>("onThing", logger)
		const after = vi.fn()
		eh.add(() => {
			throw new Error("boom")
		})
		eh.add(after)
		expect(() => eh.invoke()).not.toThrow()
		expect(after).toHaveBeenCalledTimes(1)
	})
})
