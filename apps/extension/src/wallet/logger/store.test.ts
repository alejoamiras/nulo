import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { LoggerStore } from "./store"
import { LogLevel } from "."
import type { IConfig, ConfigProp } from "@/wallet/config"
import { EventHandler } from "@nulo/wallet-core/utils"

// ── Mock IConfig ──────────────────────────────────────────────────────

function mockConfig(debugMode = false, developerMode = false): IConfig {
	return {
		onUpdate: new EventHandler<ConfigProp>(),
		get: ((key: string) => {
			if (key === "debugMode") return debugMode
			if (key === "developerMode") return developerMode
			return undefined
		}) as IConfig["get"],
	}
}

/**
 * A config whose values can change AFTER construction — the production shape, where the store is
 * built on schema defaults and `config.load()` supplies the real values later.
 */
function mutableConfig(initial: { debugMode?: boolean; developerMode?: boolean } = {}) {
	const state = { debugMode: false, developerMode: false, ...initial }
	return {
		onUpdate: new EventHandler<ConfigProp>(),
		get: ((key: string) => state[key as keyof typeof state]) as IConfig["get"],
		/** Stand-in for what `config.load()` → `apply()` does to the in-memory config. */
		set(key: "debugMode" | "developerMode", value: boolean) {
			state[key] = value
		},
	}
}

/** chrome.storage.session double that records what the flush actually wrote. */
function mockSessionStorage(initial?: unknown) {
	const session = {
		get: vi.fn().mockResolvedValue(initial === undefined ? {} : { "nulo:logs": initial }),
		set: vi.fn(),
		remove: vi.fn().mockResolvedValue(undefined),
	}
	// biome-ignore lint/suspicious/noExplicitAny: test setup — mocking chrome.storage.session
	;(globalThis as any).chrome = { storage: { session } }
	return session
}

// print() calls console._debug/_log/_warn/_error (originals saved by console-sniffer).
// In tests, the sniffer hasn't run — provide no-op stubs.
beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test setup — patching undeclared console internals from console-sniffer
	const c = console as any
	c._debug = vi.fn()
	c._log = vi.fn()
	c._warn = vi.fn()
	c._error = vi.fn()
})

// Clean up any globals set by tests (e.g., chrome.storage mock)
afterEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test teardown — removing chrome global mock
	;(globalThis as any).chrome = undefined
})

// ── LoggerStore tests ─────────────────────────────────────────────────

describe("LoggerStore", () => {
	describe("basic logging", () => {
		test("creates log with correct fields", () => {
			const store = new LoggerStore(mockConfig(true))
			store.log("test-source", LogLevel.Debug, "hello", 42)

			const logs = store.get(10)
			expect(logs).toHaveLength(1)
			expect(logs[0].source).toBe("test-source")
			expect(logs[0].level).toBe(LogLevel.Debug)
			expect(logs[0].context).toBe("sw")
			expect(logs[0].data).toEqual(["hello", 42])
			expect(logs[0].id).toBe(1)
			expect(logs[0].timestamp).toBeGreaterThan(0)
		})

		test("increments id for each log", () => {
			const store = new LoggerStore(mockConfig(true))
			store.log("a", LogLevel.Debug, "first")
			store.log("b", LogLevel.Debug, "second")

			const logs = store.get(10)
			expect(logs[0].id).toBe(1)
			expect(logs[1].id).toBe(2)
		})

		test("emits onLog event", () => {
			const store = new LoggerStore(mockConfig(true))
			const handler = vi.fn()
			store.onLog.add(handler)

			store.log("src", LogLevel.Info, "msg")

			expect(handler).toHaveBeenCalledTimes(1)
			expect(handler.mock.calls[0][0].source).toBe("src")
		})
	})

	describe("level filtering", () => {
		test("debug mode captures all levels", () => {
			const store = new LoggerStore(mockConfig(true))
			store.log("a", LogLevel.Debug, "debug")
			store.log("a", LogLevel.Info, "info")
			store.log("a", LogLevel.Warn, "warn")
			store.log("a", LogLevel.Error, "error")

			expect(store.get(10)).toHaveLength(4)
		})

		test("normal mode filters out debug", () => {
			const store = new LoggerStore(mockConfig(false))
			store.log("a", LogLevel.Debug, "should be filtered")
			store.log("a", LogLevel.Info, "should pass")

			const logs = store.get(10)
			expect(logs).toHaveLength(1)
			expect(logs[0].data).toEqual(["should pass"])
		})

		test("debug mode change via config updates filter", () => {
			const config = mockConfig(false)
			const store = new LoggerStore(config)

			store.log("a", LogLevel.Debug, "filtered")
			expect(store.get(10)).toHaveLength(0)

			// Simulate config change to debug mode
			config.onUpdate.invoke({ key: "debugMode", value: true })

			store.log("a", LogLevel.Debug, "now captured")
			expect(store.get(10)).toHaveLength(1)
		})
	})

	describe("context field", () => {
		test("log() defaults context to sw", () => {
			const store = new LoggerStore(mockConfig(true))
			store.log("src", LogLevel.Debug, "msg")

			expect(store.get(10)[0].context).toBe("sw")
		})

		test("logWithContext() sets explicit context", () => {
			const store = new LoggerStore(mockConfig(true))
			store.logWithContext("offscreen", "pxe", LogLevel.Debug, "msg")

			const log = store.get(10)[0]
			expect(log.context).toBe("offscreen")
			expect(log.source).toBe("pxe")
		})

		test("logWithContext() defaults to sw when context is undefined", () => {
			const store = new LoggerStore(mockConfig(true))
			store.logWithContext(undefined, "src", LogLevel.Debug, "msg")

			expect(store.get(10)[0].context).toBe("sw")
		})

		test("logWithContext() respects level filtering", () => {
			const store = new LoggerStore(mockConfig(false))
			store.logWithContext("popup", "ui", LogLevel.Debug, "filtered")

			expect(store.get(10)).toHaveLength(0)
		})
	})

	describe("get() pagination", () => {
		test("returns logs after fromId", () => {
			const store = new LoggerStore(mockConfig(true))
			store.log("a", LogLevel.Debug, "one")
			store.log("a", LogLevel.Debug, "two")
			store.log("a", LogLevel.Debug, "three")

			const logs = store.get(10, 1) // After id 1
			expect(logs).toHaveLength(2)
			expect(logs[0].data).toEqual(["two"])
			expect(logs[1].data).toEqual(["three"])
		})

		test("limits to count", () => {
			const store = new LoggerStore(mockConfig(true))
			for (let i = 0; i < 10; i++) {
				store.log("a", LogLevel.Debug, `msg-${i}`)
			}

			const logs = store.get(3)
			expect(logs).toHaveLength(3)
		})
	})

	describe("clear()", () => {
		test("removes all logs", () => {
			const store = new LoggerStore(mockConfig(true))
			store.log("a", LogLevel.Debug, "msg")
			store.log("a", LogLevel.Debug, "msg2")

			store.clear()
			expect(store.get(10)).toHaveLength(0)
		})

		test("also drops the persisted copy, so a restart cannot resurrect it", async () => {
			// Emptying only the ring buffer left `nulo:logs` intact and rehydrate() brought the
			// cleared entries straight back — the button looked like it worked.
			const session = mockSessionStorage()
			const store = new LoggerStore(mockConfig(true, true))
			store.log("a", LogLevel.Error, "msg")

			store.clear()
			await new Promise((r) => setTimeout(r, 0))

			expect(session.remove).toHaveBeenCalledWith("nulo:logs")
		})
	})

	describe("circular buffer behavior", () => {
		test("wraps around when capacity exceeded", () => {
			const config = mockConfig(false) // 1000 capacity
			const store = new LoggerStore(config)

			for (let i = 0; i < 1100; i++) {
				store.log("a", LogLevel.Info, `msg-${i}`)
			}

			const logs = store.get(2000)
			expect(logs).toHaveLength(1000)
			// Oldest should be msg-100 (first 100 were evicted)
			expect(logs[0].data).toEqual(["msg-100"])
			expect(logs[999].data).toEqual(["msg-1099"])
		})
	})

	describe("rehydrate()", () => {
		test("gracefully handles missing chrome.storage.session", async () => {
			const store = new LoggerStore(mockConfig(true))
			// chrome.storage.session not defined in test env — should not throw
			await expect(store.rehydrate()).resolves.not.toThrow()
		})

		test("rehydrates from session storage", async () => {
			const savedLogs = [
				{ id: 5, timestamp: 1000, source: "test", level: LogLevel.Info, context: "sw" as const, data: ["saved"] },
				{ id: 10, timestamp: 2000, source: "test", level: LogLevel.Debug, context: "offscreen" as const, data: ["saved2"] },
			]
			mockSessionStorage(savedLogs)

			const store = new LoggerStore(mockConfig(true, true))
			await store.rehydrate()

			const logs = store.get(10)
			expect(logs).toHaveLength(2)
			expect(logs[0].data).toEqual(["saved"])
			expect(logs[1].data).toEqual(["saved2"])

			// nextId should be past the highest rehydrated id
			store.log("new", LogLevel.Debug, "after rehydrate")
			const all = store.get(10)
			expect(all[2].id).toBeGreaterThan(10)
		})
	})

	// Retention is opt-in with developer mode. Without it, captured lines must never outlive this
	// worker — that is what keeps the wide capture surface off a normal user's machine.
	describe("retention gate", () => {
		beforeEach(() => vi.useFakeTimers())
		afterEach(() => vi.useRealTimers())

		test("does NOT persist when developer mode is off", async () => {
			const session = mockSessionStorage()
			const store = new LoggerStore(mockConfig(false, false))

			store.log("a", LogLevel.Error, "sensitive")
			await vi.advanceTimersByTimeAsync(5000)

			expect(session.set).not.toHaveBeenCalled()
		})

		test("persists when developer mode is on", async () => {
			const session = mockSessionStorage()
			const store = new LoggerStore(mockConfig(false, true))

			store.log("a", LogLevel.Error, "diagnostic")
			await vi.advanceTimersByTimeAsync(5000)

			expect(session.set).toHaveBeenCalledTimes(1)
			const written = session.set.mock.calls[0][0]["nulo:logs"] as Array<{ data: unknown[] }>
			expect(written[0].data).toEqual(["diagnostic"])
		})

		test("turning developer mode off purges what was already written", async () => {
			const session = mockSessionStorage()
			const config = mockConfig(false, true)
			const store = new LoggerStore(config)

			store.log("a", LogLevel.Error, "captured while on")
			await vi.advanceTimersByTimeAsync(5000)
			expect(session.set).toHaveBeenCalledTimes(1)

			config.onUpdate.invoke({ key: "developerMode", value: false })
			await vi.runAllTimersAsync()

			expect(session.remove).toHaveBeenCalledWith("nulo:logs")

			// And it must stop writing from here on.
			store.log("a", LogLevel.Error, "after opt-out")
			await vi.advanceTimersByTimeAsync(5000)
			expect(session.set).toHaveBeenCalledTimes(1)
		})

		test("a flush that ALREADY STARTED cannot resurrect the key after a purge", async () => {
			// Cancelling the timer cannot stop a write already in progress; the purge has to be
			// ordered after it, or `set()` lands on top of `remove()`.
			const session = mockSessionStorage()
			let resolveSet: () => void = () => {}
			session.set.mockImplementation(() => new Promise<void>((r) => (resolveSet = r)))

			const config = mockConfig(false, true)
			const store = new LoggerStore(config)
			store.log("a", LogLevel.Error, "queued")

			await vi.advanceTimersByTimeAsync(2500) // the flush FIRES and its set() is now pending
			expect(session.set).toHaveBeenCalledTimes(1)
			expect(session.remove).not.toHaveBeenCalled()

			config.onUpdate.invoke({ key: "developerMode", value: false })
			await Promise.resolve()
			// The purge must still be waiting on the in-flight write.
			expect(session.remove).not.toHaveBeenCalled()

			resolveSet()
			await vi.runAllTimersAsync()
			expect(session.remove).toHaveBeenCalledWith("nulo:logs")
		})

		test("MULTIPLE queued writes cannot outlive a purge", async () => {
			// A single in-flight slot was not enough: the timer clears when a flush STARTS, so a
			// later log could fire a second flush while the first was still pending, and a purge
			// awaiting only the newest promise got overtaken by the older write. The serialized
			// queue also means writes never overlap — each starts only after the last one finishes.
			const session = mockSessionStorage()
			session.set.mockImplementation(() => new Promise<void>((r) => setTimeout(r, 10)))

			const config = mockConfig(false, true)
			const store = new LoggerStore(config)

			store.log("a", LogLevel.Error, "first")
			await vi.advanceTimersByTimeAsync(2500) // flush A fires and completes
			store.log("a", LogLevel.Error, "second")
			await vi.advanceTimersByTimeAsync(2500) // flush B fires and completes
			expect(session.set).toHaveBeenCalledTimes(2)

			config.onUpdate.invoke({ key: "developerMode", value: false })
			await vi.runAllTimersAsync()

			// The removal must be the LAST storage operation — nothing may land on top of it.
			expect(session.remove).toHaveBeenCalledWith("nulo:logs")
			const removeOrder = session.remove.mock.invocationCallOrder[0]
			const lastSetOrder = Math.max(...session.set.mock.invocationCallOrder)
			expect(removeOrder).toBeGreaterThan(lastSetOrder)
		})

		test("a pending flush cannot recreate the file after opt-out", async () => {
			const session = mockSessionStorage()
			const config = mockConfig(false, true)
			const store = new LoggerStore(config)

			store.log("a", LogLevel.Error, "queued")
			// Opt out mid-debounce, before the 2s flush fires.
			config.onUpdate.invoke({ key: "developerMode", value: false })
			await vi.runAllTimersAsync()

			expect(session.set).not.toHaveBeenCalled()
		})
	})

	/**
	 * Production boot order: the store is constructed at module scope on SCHEMA DEFAULTS, then
	 * `rehydrate()` runs, and only later does `config.load()` supply the user's real setting
	 * (inside `runtime.start()`, after migrations — an ordering that must not change). Tests that
	 * inject an already-loaded config cannot see this, which is how the first version of this arc
	 * shipped a bug that wiped every developer's logs on each worker restart.
	 */
	describe("retention across the real boot order", () => {
		beforeEach(() => vi.useFakeTimers())
		afterEach(() => vi.useRealTimers())

		const saved = [{ id: 1, timestamp: 1, source: "s", level: LogLevel.Info, context: "sw" as const, data: ["from-last-lifecycle"] }]

		test("rehydrate restores even though the constructor saw the default", async () => {
			// REGRESSION: gating rehydrate on the constructor's value purged here, before the
			// loaded config could say "developer mode is on".
			mockSessionStorage(saved)
			const config = mutableConfig()
			const store = new LoggerStore(config)

			await store.rehydrate()

			expect(store.get(10)).toHaveLength(1)
		})

		test("a developer's rehydrated logs SURVIVE the config load", async () => {
			const session = mockSessionStorage(saved)
			const config = mutableConfig()
			const store = new LoggerStore(config)
			await store.rehydrate()

			config.set("developerMode", true) // what config.load() does
			await store.applyRetentionPolicy()

			expect(store.get(10)).toHaveLength(1)
			expect(session.remove).not.toHaveBeenCalled()

			// …and persistence resumes.
			store.log("a", LogLevel.Error, "new")
			await vi.advanceTimersByTimeAsync(5000)
			expect(session.set).toHaveBeenCalled()
		})

		test("a non-developer's rehydrated logs are dropped once the config loads", async () => {
			// Covers the case no config-update event can: `apply()` only emits on a CHANGE, so a
			// stored `developerMode: false` matching the default is silent.
			const session = mockSessionStorage(saved)
			const config = mutableConfig()
			const store = new LoggerStore(config)
			await store.rehydrate()
			expect(store.get(10)).toHaveLength(1)

			await store.applyRetentionPolicy()

			expect(store.get(10)).toHaveLength(0)
			expect(session.remove).toHaveBeenCalledWith("nulo:logs")
		})

		test("retention stays off after the load, so nothing is written", async () => {
			const session = mockSessionStorage()
			const config = mutableConfig()
			const store = new LoggerStore(config)
			await store.applyRetentionPolicy()

			store.log("a", LogLevel.Error, "sensitive")
			await vi.advanceTimersByTimeAsync(5000)

			expect(session.set).not.toHaveBeenCalled()
		})
	})
})
