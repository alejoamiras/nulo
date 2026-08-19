/**
 * Prove-first pins for `createWalletRuntime().start()`'s single-flight
 * contract. Both pins were RED against the `started`-boolean latch:
 *
 *  (a) a concurrent second `start()` void-resolved IMMEDIATELY while the first
 *      boot was still in flight — the price-alarm shim's
 *      `start().then(() => services.get(PriceService))` then raced a
 *      not-yet-registered service and lost the tick;
 *  (b) after a FAILED boot, `started` stayed latched true — every later
 *      `start()` void-resolved against a half-booted runtime and no retry
 *      ever happened for the SW's remaining lifetime.
 *
 * Both pins stay inside the PRE-REGISTRATION boot zone (uninstall URL →
 * migration → config/BB init) by hanging or failing the mocked
 * BarretenbergSync — no service is ever constructed, which is also the zone
 * where retry is safe (see the single-flight-start helper).
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

import { createWalletRuntime } from "./runtime"
import type { ConfigStore } from "./config"

const noopLogger = { log: () => {} } as unknown as LoggerStore

/** Minimal chrome.storage-shaped area backed by a Map — enough for the
 *  Migrator's fresh-install stamp and the schema-status writes. */
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
		let bbCalls = 0
		bbImpl = () => {
			bbCalls++
			return Promise.reject(new Error("bb down"))
		}
		const { deps, configLoad } = makeDeps()
		const runtime = createWalletRuntime(deps)

		await expect(runtime.start()).rejects.toThrow("bb down")
		expect(bbCalls).toBe(1)

		// The second call must RE-ATTEMPT the boot (and surface its outcome),
		// not void-resolve against the half-booted runtime.
		await expect(runtime.start()).rejects.toThrow("bb down")
		expect(bbCalls).toBe(2)
		expect(configLoad).toHaveBeenCalledTimes(2)
	})
})
