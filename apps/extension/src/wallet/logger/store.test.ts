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

		test("does NOT persist when developer mode is off", () => {
			const session = mockSessionStorage()
			const store = new LoggerStore(mockConfig(false, false))

			store.log("a", LogLevel.Error, "sensitive")
			vi.advanceTimersByTime(5000)

			expect(session.set).not.toHaveBeenCalled()
		})

		test("persists when developer mode is on", () => {
			const session = mockSessionStorage()
			const store = new LoggerStore(mockConfig(false, true))

			store.log("a", LogLevel.Error, "diagnostic")
			vi.advanceTimersByTime(5000)

			expect(session.set).toHaveBeenCalledTimes(1)
			const written = session.set.mock.calls[0][0]["nulo:logs"] as Array<{ data: unknown[] }>
			expect(written[0].data).toEqual(["diagnostic"])
		})

		test("turning developer mode off purges what was already written", async () => {
			const session = mockSessionStorage()
			const config = mockConfig(false, true)
			const store = new LoggerStore(config)

			store.log("a", LogLevel.Error, "captured while on")
			vi.advanceTimersByTime(5000)
			expect(session.set).toHaveBeenCalledTimes(1)

			config.onUpdate.invoke({ key: "developerMode", value: false })
			await vi.runAllTimersAsync()

			expect(session.remove).toHaveBeenCalledWith("nulo:logs")

			// And it must stop writing from here on.
			store.log("a", LogLevel.Error, "after opt-out")
			vi.advanceTimersByTime(5000)
			expect(session.set).toHaveBeenCalledTimes(1)
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

		test("rehydrate drops a stale persisted copy when retention is off", async () => {
			// The flag can be turned off while this worker is dead, so the disable-time purge never
			// ran — boot must not import those entries back into memory.
			const stale = [{ id: 1, timestamp: 1, source: "s", level: LogLevel.Info, context: "sw" as const, data: ["stale"] }]
			const session = mockSessionStorage(stale)

			const store = new LoggerStore(mockConfig(false, false))
			await store.rehydrate()

			expect(store.get(10)).toHaveLength(0)
			expect(session.remove).toHaveBeenCalledWith("nulo:logs")
		})
	})
})
