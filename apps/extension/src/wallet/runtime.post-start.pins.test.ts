/**
 * Helper-seam pins (codex condition, round-2 plan 5): the post-start work fires
 * in the boot's exact order — deletion resume → reaper construct+start → GC
 * construct+start → storage probe — with ZERO awaits between them (the
 * instances `stop()` reads exist before the caller's next tick), and `stop()`
 * clears heartbeat → reaper → GC in that order. The runtime harness stops
 * pre-registration by design, so these are pinned at the helper seam.
 */
import { describe, expect, test, vi } from "vitest"

const log: string[] = []
vi.mock("./services/operation-journal/reaper", () => ({
	JournalReaper: class {
		constructor() {
			log.push("reaper:new")
		}
		start() {
			log.push("reaper:start")
			return Promise.resolve()
		}
		stop() {
			log.push("reaper:stop")
			return Promise.resolve()
		}
	},
}))
vi.mock("./services/operation-journal/gc", () => ({
	JournalGC: class {
		constructor() {
			log.push("gc:new")
		}
		start() {
			log.push("gc:start")
			return Promise.resolve()
		}
		stop() {
			log.push("gc:stop")
			return Promise.resolve()
		}
	},
}))

import { armPostStartWork, type RuntimeState, stopRuntime } from "./runtime"

const noopLogger = { log: () => {} } as never

describe("runtime post-start seam", () => {
	test("resume → reaper new/start → gc new/start → probe, all before the caller's next microtask", async () => {
		log.length = 0
		const services = { get: () => ({ kind: "journal" }) } as never
		const deps = {
			browserApi: {
				alarms: {},
				storage: {
					local: {
						get: async () => {
							log.push("probe:get")
							return { "nulo:journal@1": {}, other: 1 }
						},
					},
				},
			},
			logger: noopLogger,
		} as never
		const deletionCoordinator = {
			resumePending: (cutoff: number) => {
				log.push(`resume:${cutoff}`)
				return Promise.resolve()
			},
		} as never

		const armed = armPostStartWork(services, deps, deletionCoordinator, 4242)
		// Synchronous view — nothing has yielded yet.
		expect(log).toEqual(["resume:4242", "reaper:new", "reaper:start", "gc:new", "gc:start", "probe:get"])
		expect(armed.reaper).toBeDefined()
		expect(armed.journalGc).toBeDefined()
		await Promise.resolve()
	})

	test("stopRuntime clears heartbeat → reaper → GC, and a second stop is a no-op", () => {
		log.length = 0
		const clock = { clearInterval: (h: unknown) => log.push(`clearInterval:${String(h)}`) } as never
		const stopper = (label: string) => ({
			stop: () => {
				log.push(label)
				return Promise.resolve()
			},
		})
		const state: RuntimeState = {
			heartbeatHandle: 7 as never,
			reaper: stopper("reaper:stop") as never,
			journalGc: stopper("gc:stop") as never,
			retrySafe: false,
		}
		stopRuntime(state, clock, noopLogger)
		expect(log).toEqual(["clearInterval:7", "reaper:stop", "gc:stop"])
		expect(state.heartbeatHandle).toBeUndefined()
		expect(state.reaper).toBeUndefined()
		expect(state.journalGc).toBeUndefined()
		stopRuntime(state, clock, noopLogger)
		expect(log).toEqual(["clearInterval:7", "reaper:stop", "gc:stop"])
	})
})
