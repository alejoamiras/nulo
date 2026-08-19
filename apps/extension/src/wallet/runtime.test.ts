/**
 * Prove-first pins for `createWalletRuntime().start()`'s single-flight
 * contract. The first two pins were RED against the `started`-boolean latch:
 *
 *  (a) a concurrent second `start()` void-resolved IMMEDIATELY while the first
 *      boot was still in flight — the price-alarm shim's
 *      `start().then(() => services.get(PriceService))` then raced a
 *      not-yet-registered service and lost the tick;
 *  (b) after a FAILED boot, `started` stayed latched true — every later
 *      `start()` void-resolved against a half-booted runtime and no retry
 *      ever happened for the SW's remaining lifetime.
 *
 * The remaining pins came out of the mid-tier audit (codex blocking findings):
 * retry must not overlap an unfinished first attempt (allSettled quiescence),
 * a Barretenberg failure must veto retry (upstream initSingleton memoizes its
 * REJECTED promise), and a TERMINAL migration block must veto retry while a
 * retryable one stays retryable.
 *
 * Every pin stays inside the PRE-REGISTRATION boot zone — no service is ever
 * constructed.
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

// Swappable migration outcome; `migratorRuns` counts engine invocations. The
// real engine is exercised by its own package tests — these pins only need to
// steer the runtime's blocked-branch classification.
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

const noopLogger = { log: () => {} } as unknown as LoggerStore

/** Minimal chrome.storage-shaped area backed by a Map — enough for the
 *  schema-status writes. */
function makeStorageArea() {
	const data = new Map<string, unknown>()
	return {
		get: async (keys?: string | string[]) => {
			if (keys === undefined) return Object.fromEntries(data)
			const list = Array.isArray(keys) ? keys : [keys]
			return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]))
		},
		set: async (items: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(items)) data.set(k, v)
		},
		remove: async (keys: string | string[]) => {
			for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k)
		},
	}
}

function makeDeps() {
	const browserApi = {
		runtime: { setUninstallURL: async () => {} },
		storage: { local: makeStorageArea(), session: makeStorageArea() },
	} as unknown as BrowserApi
	const clock = {
		now: () => 0,
		setInterval: () => 0,
		clearInterval: () => {},
	} as unknown as ClockPort
	const configLoad = vi.fn(async () => {})
	const config = { load: configLoad } as unknown as ConfigStore
	return { deps: { browserApi, clock, config, logger: noopLogger }, configLoad }
}

const tick = () => new Promise((r) => setTimeout(r, 10))

beforeEach(() => {
	bbImpl = async () => ({})
	migratorImpl = async () => ({ kind: "up-to-date" })
	migratorRuns = 0
})

afterEach(() => {
	vi.clearAllMocks()
})

describe("runtime.start() single-flight contract", () => {
	test("a concurrent second start() awaits the SAME in-flight boot (no resolve-before-ready)", async () => {
		let releaseBb!: () => void
		bbImpl = () => new Promise((r) => (releaseBb = () => r({})))
		void releaseBb // never released — the boot stays in flight for the whole test
		const runtime = createWalletRuntime(makeDeps().deps)

		const p1 = runtime.start()
		p1.catch(() => {})
		await tick()
		const p2 = runtime.start()
		p2.catch(() => {})

		// The second caller must still be PENDING while the boot is in flight —
		// resolving now is exactly the lost-price-tick race.
		const outcome = await Promise.race([p2.then(() => "settled"), tick().then(() => "pending")])
		expect(outcome).toBe("pending")
	})

	test("a failed pre-registration boot permits a real retry (no permanent latch)", async () => {
		const { deps, configLoad } = makeDeps()
		configLoad.mockRejectedValue(new Error("config down"))
		const runtime = createWalletRuntime(deps)

		await expect(runtime.start()).rejects.toThrow("config down")
		expect(configLoad).toHaveBeenCalledTimes(1)

		// The second call must RE-ATTEMPT the boot (and surface its outcome),
		// not void-resolve against the half-booted runtime.
		await expect(runtime.start()).rejects.toThrow("config down")
		expect(configLoad).toHaveBeenCalledTimes(2)
		expect(migratorRuns).toBe(2)
	})

	test("a fast BB rejection does NOT reset the memo while config is still pending (no overlapping retry)", async () => {
		bbImpl = () => Promise.reject(new Error("bb down"))
		const { deps, configLoad } = makeDeps()
		configLoad.mockImplementation(() => new Promise(() => {})) // config never settles
		const runtime = createWalletRuntime(deps)

		const p1 = runtime.start()
		p1.catch(() => {})
		await tick()
		// allSettled holds the boot open until BOTH legs settle — the memo is
		// still in flight, so a second start() must join it, not re-run the
		// migration/config work concurrently with the unfinished first attempt.
		const p2 = runtime.start()
		p2.catch(() => {})
		await tick()
		expect(migratorRuns).toBe(1)
		expect(configLoad).toHaveBeenCalledTimes(1)
		const outcome = await Promise.race([p2.then(() => "settled"), tick().then(() => "pending")])
		expect(outcome).toBe("pending")
	})

	test("a Barretenberg failure vetoes retry — the rejection is memoized for the SW lifetime", async () => {
		let bbCalls = 0
		bbImpl = () => {
			bbCalls++
			return Promise.reject(new Error("bb down"))
		}
		const runtime = createWalletRuntime(makeDeps().deps)

		await expect(runtime.start()).rejects.toThrow("bb down")
		// Upstream initSingleton memoizes its rejected promise — a retry could
		// only re-observe the same error, so the memo must be KEPT.
		await expect(runtime.start()).rejects.toThrow("bb down")
		expect(bbCalls).toBe(1)
		expect(migratorRuns).toBe(1)
	})

	test("a TERMINAL migration block vetoes retry; a RETRYABLE one stays retryable", async () => {
		const { deps } = makeDeps()
		migratorImpl = async () => ({ kind: "needs-recovery", reason: "terminal", retryable: false })
		const runtime = createWalletRuntime(deps)

		await expect(runtime.start()).rejects.toThrow("storage migration blocked")
		await expect(runtime.start()).rejects.toThrow("storage migration blocked")
		// Terminal work must NOT be re-run on every surviving alarm tick.
		expect(migratorRuns).toBe(1)

		// Retryable block on a fresh runtime: the memo resets and a later call
		// re-runs the engine (its next-boot resume is designed for this).
		migratorRuns = 0
		migratorImpl = async () => ({ kind: "needs-recovery", reason: "transient", retryable: true })
		const runtime2 = createWalletRuntime(makeDeps().deps)
		await expect(runtime2.start()).rejects.toThrow("storage migration blocked")
		await expect(runtime2.start()).rejects.toThrow("storage migration blocked")
		expect(migratorRuns).toBe(2)
	})
})
