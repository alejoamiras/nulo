/**
 * Pre-extraction pin (codex condition, round-2 plan 5): a migration-blocked
 * outcome vetoes in-lifetime retry BEFORE its blocked-status write is awaited —
 * so a REJECTED status write still leaves the single-flight memo rejected and
 * a second `start()` never re-runs the engine. A helper that only returned the
 * veto after a successful write would re-permit the retry on exactly this path.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { BrowserApi, ClockPort } from "@nulo/wallet-core/ports"
import type { LoggerStore } from "@/wallet/logger"

let bbImpl: () => Promise<unknown>
vi.mock("@aztec/bb.js", () => ({
	BarretenbergSync: {
		initSingleton: (..._args: unknown[]) => bbImpl(),
	},
}))

let migratorImpl: () => Promise<unknown>
let migratorRuns = 0
vi.mock("@nulo/wallet-core/migration", async (importOriginal) => ({
	...(await importOriginal<object>()),
	Migrator: class {
		run() {
			migratorRuns++
			return migratorImpl()
		}
	},
}))

import { createWalletRuntime } from "./runtime"
import type { ConfigStore } from "./config"

const noopLogger = { log: () => {}, applyRetentionPolicy: async () => {} } as unknown as LoggerStore

function makeStorageArea(setImpl?: (items: Record<string, unknown>) => Promise<void>) {
	const data = new Map<string, unknown>()
	return {
		get: async (keys?: string | string[]) => {
			if (keys === undefined) return Object.fromEntries(data)
			const list = Array.isArray(keys) ? keys : [keys]
			return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]))
		},
		set: async (items: Record<string, unknown>) => {
			if (setImpl) await setImpl(items)
			for (const [k, v] of Object.entries(items)) data.set(k, v)
		},
		remove: async (keys: string | string[]) => {
			for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k)
		},
	}
}

beforeEach(() => {
	bbImpl = async () => ({})
	migratorRuns = 0
})

afterEach(() => {
	vi.clearAllMocks()
})

describe("runtime blocked-migration persistence failure", () => {
	test("a REJECTED blocked-status write still vetoes retry — the memo stays rejected, the engine runs once", async () => {
		migratorImpl = async () => ({ kind: "failed", version: 1, breaking: true, reason: "boom", attempts: 1, terminal: false })
		const blockedWrites: number[] = []
		const local = makeStorageArea(async (items) => {
			// The ONLY write on the blocked path is the blocked-status set; reject it.
			if (Object.keys(items).some((k) => k.includes("blocked"))) {
				blockedWrites.push(1)
				throw new Error("blocked-status write failed")
			}
		})
		const browserApi = {
			runtime: { setUninstallURL: async () => {} },
			storage: { local, session: makeStorageArea() },
		} as unknown as BrowserApi
		const clock = { now: () => 0, setInterval: () => 0, clearInterval: () => {} } as unknown as ClockPort
		const config = { load: vi.fn(async () => {}) } as unknown as ConfigStore
		const runtime = createWalletRuntime({ browserApi, clock, config, logger: noopLogger, manifestVersion: "0.0.0-test" })

		await expect(runtime.start()).rejects.toThrow("blocked-status write failed")
		expect(blockedWrites).toHaveLength(1)
		// Second start(): the SAME rejection, no second engine run, no second write attempt.
		await expect(runtime.start()).rejects.toThrow("blocked-status write failed")
		expect(migratorRuns).toBe(1)
		expect(blockedWrites).toHaveLength(1)
	})
})
