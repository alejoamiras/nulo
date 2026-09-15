/**
 * `ProductionPxeFactory` proving-mode unit tests.
 *
 * Default mode (no options or `provingMode: "default"`) must keep the SDK's silent WASM fallback
 * for end users and must prove over HTTPS only; required mode (`VITE_NULO_PRESTO_REQUIRED=1`, CI)
 * is the env-gated hard-fail path. `@alejoamiras/presto` is mocked to capture the options the
 * factory hands the prover and to program `checkPrestoStatus`; no real proving here.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { PrestoConfig, PrestoPhase, PrestoStatus } from "@alejoamiras/presto"

vi.mock("@aztec/pxe/client/bundle", () => ({
	createPXE: vi.fn(async () => ({}) as unknown),
}))
vi.mock("@aztec/pxe/config", () => ({ getPXEConfig: () => ({}) }))
vi.mock("@aztec/simulator/client", () => ({ WASMSimulator: class {} }))

const checkPrestoStatusMock = vi.fn()
const proverInstances: Array<{
	onPhase: ((phase: PrestoPhase) => void) | undefined
	presto: PrestoConfig | undefined
}> = []

vi.mock("@alejoamiras/presto", () => ({
	PrestoProver: class {
		constructor(opts: { onPhase?: (phase: PrestoPhase) => void; presto?: PrestoConfig }) {
			proverInstances.push({ onPhase: opts.onPhase, presto: opts.presto })
		}
		checkPrestoStatus() {
			return checkPrestoStatusMock()
		}
	},
}))

import { createPXE } from "@aztec/pxe/client/bundle"
import {
	advanceProve,
	ChainRuntime,
	ChainRuntimeRegistry,
	ProductionPxeFactory,
	type ProvePhaseEvent,
	type PxeFactory,
} from "./chain-runtime"
import type { NodeFactory } from "../ports/node-factory-port"

// The injected encrypted store is unit-mocked (real OPFS needs a browser; the production-build
// spike is the empirical proof). The factory only needs open/close handles here.
vi.mock("./opfs-store", () => ({
	openChainStore: vi.fn(async () => ({ close: async () => {}, delete: async () => {} })),
}))

const createPXEMock = vi.mocked(createPXE)

const fakeNodeFactory: NodeFactory = {
	createNode: () => ({ getL1ContractAddresses: async () => ({ rollupAddress: undefined }) }) as never,
	probeChainId: async () => 0,
}

const fakeNetwork = { profileId: "p", chainId: 31337, rpcUrl: "http://node.local" }
const fakeStoreKey = new Uint8Array(32)
const available: PrestoStatus = { available: true, needsDownload: false, protocol: "http" }
const fallbackClass = ["fallback", "denied", "secure-connection-unavailable", "version-mismatch"] as const

beforeEach(() => {
	proverInstances.length = 0
	checkPrestoStatusMock.mockReset()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("ProductionPxeFactory default (production) mode", () => {
	test("passes httpsOnly: true explicitly and no endpoint when none is configured", async () => {
		const factory = new ProductionPxeFactory(fakeNodeFactory)
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		expect(proverInstances).toHaveLength(1)
		expect(proverInstances[0].presto).toEqual({ httpsOnly: true })
	})

	test("does NOT run the preflight", async () => {
		checkPrestoStatusMock.mockResolvedValue(available)
		const factory = new ProductionPxeFactory(fakeNodeFactory)
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		expect(checkPrestoStatusMock).not.toHaveBeenCalled()
	})

	test("onPhase never throws on a fallback-class phase (silent WASM fallback preserved)", async () => {
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "default" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		const onPhase = proverInstances[0].onPhase
		for (const p of fallbackClass) {
			expect(() => onPhase?.(p)).not.toThrow()
		}
	})

	test("succeeds even when Presto is reported unavailable", async () => {
		checkPrestoStatusMock.mockResolvedValue({ available: false, reason: "offline" })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "default" })
		await expect(factory.createChainRuntime(fakeNetwork, fakeStoreKey)).resolves.toBeDefined()
	})
})

describe("ProductionPxeFactory required mode", () => {
	test("derives httpsOnly: false from the mode and passes the endpoint through", async () => {
		checkPrestoStatusMock.mockResolvedValue(available)
		const factory = new ProductionPxeFactory(fakeNodeFactory, {
			provingMode: "required",
			host: "127.0.0.1",
			port: 59833,
			httpsPort: 59834,
		})
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		expect(proverInstances[0].presto).toEqual({ host: "127.0.0.1", port: 59833, httpsPort: 59834, httpsOnly: false })
	})

	test("preflight names the reason when Presto is unavailable", async () => {
		checkPrestoStatusMock.mockResolvedValue({ available: false, reason: "permission-blocked" })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await expect(factory.createChainRuntime(fakeNetwork, fakeStoreKey)).rejects.toThrow(
			/\[presto-required\] presto-server unavailable: reason=permission-blocked/,
		)
	})

	test("preflight names the diagnosis on secure-connection-unavailable", async () => {
		checkPrestoStatusMock.mockResolvedValue({
			available: false,
			reason: "secure-connection-unavailable",
			diagnosis: "https-disabled",
		})
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await expect(factory.createChainRuntime(fakeNetwork, fakeStoreKey)).rejects.toThrow(
			/reason=secure-connection-unavailable diagnosis=https-disabled/,
		)
	})

	test("preflight runs exactly once and does NOT throw when available", async () => {
		checkPrestoStatusMock.mockResolvedValue(available)
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await expect(factory.createChainRuntime(fakeNetwork, fakeStoreKey)).resolves.toBeDefined()
		expect(checkPrestoStatusMock).toHaveBeenCalledTimes(1)
	})

	test("warns (does NOT throw) when status.needsDownload === true", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		checkPrestoStatusMock.mockResolvedValue({ ...available, needsDownload: true, sdkAztecVersion: "5.2.0" })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await expect(factory.createChainRuntime(fakeNetwork, fakeStoreKey)).resolves.toBeDefined()
		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/needsDownload=true/))
	})

	test("onPhase throws on every fallback-class phase", async () => {
		checkPrestoStatusMock.mockResolvedValue(available)
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		const onPhase = proverInstances[0].onPhase
		expect(onPhase).toBeDefined()
		// The last two precede `fallback` on the paths that detect them: redundant, but precise. A
		// legacy health-version mismatch reaches `fallback` without its own phase and is caught there.
		for (const p of fallbackClass) {
			expect(() => onPhase?.(p)).toThrow(new RegExp(`SDK emitted phase="${p}"`))
		}
	})

	test("onPhase does NOT throw on benign phases", async () => {
		checkPrestoStatusMock.mockResolvedValue(available)
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		const onPhase = proverInstances[0].onPhase
		const benign: PrestoPhase[] = ["detect", "serialize", "transmit", "proving", "proved", "receive"]
		for (const p of benign) {
			expect(() => onPhase?.(p)).not.toThrow()
		}
	})

	test('onPhase warns (does NOT throw) on phase="downloading"', async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		checkPrestoStatusMock.mockResolvedValue(available)
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		const onPhase = proverInstances[0].onPhase
		expect(() => onPhase?.("downloading")).not.toThrow()
		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/phase="downloading"/))
	})
})

describe("ProductionPxeFactory prove-phase observer", () => {
	const nativeSequence: PrestoPhase[] = ["detect", "serialize", "transmit", "proving", "proved", "receive"]

	async function runtimeWithObserver(mode: "default" | "required" = "default") {
		const events: ProvePhaseEvent[] = []
		checkPrestoStatusMock.mockResolvedValue(available)
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: mode, onProvePhase: (e) => events.push(e) })
		const runtime = await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		const onPhase = proverInstances[0].onPhase
		if (!onPhase) throw new Error("prover constructed without onPhase")
		return { runtime, events, onPhase }
	}

	test("every phase reaches the observer with the runtime's activeProve evidence, in order", async () => {
		const { runtime, events, onPhase } = await runtimeWithObserver()
		runtime.activeProve = { proveId: "attempt-1", seq: 0 }
		for (const p of nativeSequence) onPhase(p)
		expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6])
		expect(events.every((e) => e.proveId === "attempt-1")).toBe(true)
		expect(events.map((e) => e.backend)).toEqual([undefined, undefined, "presto", "presto", "presto", "presto"])
		expect(runtime.activeProve).toEqual({ proveId: "attempt-1", seq: 6, backend: "presto" })
	})

	test("no phase reaches the observer while activeProve is unset", async () => {
		const { runtime, events, onPhase } = await runtimeWithObserver()
		for (const p of nativeSequence) onPhase(p)
		expect(events).toEqual([])
		expect(runtime.activeProve).toBeUndefined()
	})

	test("a throwing observer does not propagate into the prover (default mode)", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		checkPrestoStatusMock.mockResolvedValue(available)
		const factory = new ProductionPxeFactory(fakeNodeFactory, {
			onProvePhase: () => {
				throw new Error("observer exploded")
			},
		})
		const runtime = await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		runtime.activeProve = { proveId: "a", seq: 0 }
		expect(() => proverInstances[0].onPhase?.("transmit")).not.toThrow()
		expect(runtime.activeProve.seq).toBe(1)
	})

	test("required mode: the guard fires before the observer, so a forbidden phase is never reported", async () => {
		const { runtime, events, onPhase } = await runtimeWithObserver("required")
		runtime.activeProve = { proveId: "a", seq: 0 }
		expect(() => onPhase("fallback")).toThrow(/presto-required/)
		expect(events).toEqual([])
	})

	test("advanceProve: transmit then fallback ends as browser; proved never changes the backend", () => {
		const active = { proveId: "a", seq: 0 }
		expect(advanceProve(active, "transmit").backend).toBe("presto")
		expect(advanceProve(active, "fallback").backend).toBe("browser")
		expect(advanceProve(active, "proved")).toEqual({ proveId: "a", seq: 3, phase: "proved", backend: "browser" })
	})
})

describe("ProductionPxeFactory proverless mode (e2e-only)", () => {
	test("does NOT construct a PrestoProver", async () => {
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "proverless" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		expect(proverInstances).toHaveLength(0)
	})

	test("sets proverEnabled:false and omits proverOrOptions (default fakeProofs prover)", async () => {
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "proverless" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		const lastCall = createPXEMock.mock.calls.at(-1)
		if (!lastCall) throw new Error("createPXE was not called")
		const config = lastCall[1] as { proverEnabled?: boolean }
		const options = lastCall[2] as { proverOrOptions?: unknown; simulator?: unknown }
		expect(config.proverEnabled).toBe(false)
		expect(options.proverOrOptions).toBeUndefined()
		// The simulator is still passed so kernel simulation stays on the
		// bundled WASM path (the MV3 dynamic-import fallback fails offscreen).
		expect(options.simulator).toBeDefined()
	})

	test("proverless + required is unrepresentable in the options union (compile-time guarantee)", () => {
		// The `provingMode` discriminated union makes the previously-illegal combo a
		// TYPE error — stronger than the old runtime throw. The @ts-expect-error IS
		// the assertion: if the union ever allowed both, this line would compile and
		// the directive would become an unused-error.
		// @ts-expect-error - `provingMode: "proverless"` cannot also carry `required`.
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "proverless", required: true })
		expect(factory).toBeDefined()
	})
})

describe("ChainRuntimeRegistry.disposeProfile — allSettled + AggregateError + poisoned re-add (P3 audit fold)", () => {
	const P = "prof-1"
	const net = (chainId: number) => ({ profileId: P, chainId, rpcUrl: `http://n/${chainId}` }) as never

	function runtimeWith(chainId: number, close: () => Promise<void>): ChainRuntime {
		const pxe = { stop: async () => {} } as never
		const node = {} as never
		const store = { close } as never
		return new ChainRuntime(chainId, node, pxe, `http://n/${chainId}`, store)
	}

	test("disposes all, throws AggregateError on a failed close, and re-adds ONLY the poisoned runtime", async () => {
		const ok = runtimeWith(1, async () => {})
		const bad = runtimeWith(2, async () => {
			throw new Error("close failed: lock leaked")
		})
		const factory: PxeFactory = { createChainRuntime: async (n) => (n.chainId === 1 ? ok : bad) }
		const reg = new ChainRuntimeRegistry(factory)
		await reg.ensure(net(1))
		await reg.ensure(net(2))

		await expect(reg.disposeProfile(P)).rejects.toBeInstanceOf(AggregateError)
		// The cleanly-disposed chain is gone; the poisoned one is RETAINED as the retry handle.
		expect(reg.peek(P, 1)).toBeUndefined()
		expect(reg.peek(P, 2)).toBe(bad)
	})

	test("resolves cleanly + clears the registry when every close succeeds", async () => {
		const factory: PxeFactory = { createChainRuntime: async (n) => runtimeWith(n.chainId, async () => {}) }
		const reg = new ChainRuntimeRegistry(factory)
		await reg.ensure(net(1))
		await reg.ensure(net(2))

		await expect(reg.disposeProfile(P)).resolves.toBeUndefined()
		expect(reg.peek(P, 1)).toBeUndefined()
		expect(reg.peek(P, 2)).toBeUndefined()
	})
})

describe("ChainRuntimeRegistry peek/ensure split (#281 D3)", () => {
	const P = "prof-1"
	const netAt = (chainId: number, rpcUrl: string) => ({ profileId: P, chainId, rpcUrl }) as never

	function runtimeAt(chainId: number, rpcUrl: string, close: () => Promise<void> = async () => {}): ChainRuntime {
		const pxe = { stop: async () => {} } as never
		const node = {} as never
		const store = { close } as never
		return new ChainRuntime(chainId, node, pxe, rpcUrl, store)
	}

	test("peekMatching returns the runtime only when the rpcUrl matches; never mutates", async () => {
		const rt = runtimeAt(1, "http://a")
		const reg = new ChainRuntimeRegistry({ createChainRuntime: async () => rt })
		await reg.ensure(netAt(1, "http://a"))

		expect(reg.peekMatching(netAt(1, "http://a"))).toBe(rt)
		// Endpoint switched: a read-path caller gets a miss (it escalates to
		// ensure under the chain WRITE guard) — the live runtime is untouched.
		expect(reg.peekMatching(netAt(1, "http://b"))).toBeUndefined()
		expect(reg.peek(P, 1)).toBe(rt)
	})

	test("ensure rebinds on endpoint switch: disposes the old runtime, binds the new URL", async () => {
		let closed = 0
		const made: ChainRuntime[] = []
		const reg = new ChainRuntimeRegistry({
			createChainRuntime: async (n) => {
				const rt = runtimeAt(n.chainId, n.rpcUrl, async () => {
					closed++
				})
				made.push(rt)
				return rt
			},
		})
		const first = await reg.ensure(netAt(1, "http://a"))
		expect(await reg.ensure(netAt(1, "http://a"))).toBe(first) // idempotent on match

		const second = await reg.ensure(netAt(1, "http://b"))
		expect(second).not.toBe(first)
		expect(closed).toBe(1) // the old runtime was disposed
		expect(reg.peekMatching(netAt(1, "http://b"))).toBe(second)
	})

	test("ensure keeps the old runtime referenced when its dispose fails (retry handle, no double-open)", async () => {
		const bad = runtimeAt(1, "http://a", async () => {
			throw new Error("close failed: lock leaked")
		})
		let factoryCalls = 0
		const reg = new ChainRuntimeRegistry({
			createChainRuntime: async (n) => {
				factoryCalls++
				return n.rpcUrl === "http://a" ? bad : runtimeAt(n.chainId, n.rpcUrl)
			},
		})
		await reg.ensure(netAt(1, "http://a"))
		expect(factoryCalls).toBe(1)

		// The rebind's dispose throws: ensure must NOT init the new URL over a
		// possibly-leaked SAH lock, and must keep the old reference for retry.
		await expect(reg.ensure(netAt(1, "http://b"))).rejects.toThrow("close failed")
		expect(factoryCalls).toBe(1)
		expect(reg.peek(P, 1)).toBe(bad)
	})
})
