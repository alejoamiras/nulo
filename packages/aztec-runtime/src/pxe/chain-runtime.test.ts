/**
 * `ProductionPxeFactory` accelerator-required-mode unit tests.
 *
 * Covers the env-gated runtime hard-fail path used by CI's `network-e2e`
 * when `VITE_NULO_ACCELERATOR_REQUIRED=1` is baked into the build. Default
 * mode (no options or `provingMode: "default"`) must preserve the SDK's silent
 * WASM fallback — production end-users without Aztec Accelerator must NOT
 * see any new behavior from this code path.
 *
 * Strategy: mock `@alejoamiras/aztec-accelerator` so we control the
 * `checkAcceleratorStatus` result and capture the `onPhase` callback the
 * factory wires in. We don't exercise real proving here.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { AcceleratorPhase } from "@alejoamiras/aztec-accelerator"

// Plain stand-in for `@aztec/pxe/client/bundle`'s `createPXE` — never
// touched by the required-mode path under test (we throw before reaching
// it) but needed so the import graph is satisfied.
vi.mock("@aztec/pxe/client/bundle", () => ({
	createPXE: vi.fn(async () => ({}) as unknown),
}))

// Same for the simulator + PXE config helpers — irrelevant to these tests
// but pulled in by the SUT's import block.
vi.mock("@aztec/pxe/config", () => ({ getPXEConfig: () => ({}) }))
vi.mock("@aztec/simulator/client", () => ({ WASMSimulator: class {} }))

// AcceleratorProver mock: capture the constructor args (especially
// `onPhase`) and let each test program `checkAcceleratorStatus`'s
// resolved value.
const checkAcceleratorStatusMock = vi.fn()
const acceleratorProverInstances: Array<{
	onPhase: ((phase: AcceleratorPhase) => void) | undefined
	accelerator: { host?: string; port?: number } | undefined
}> = []

vi.mock("@alejoamiras/aztec-accelerator", () => ({
	AcceleratorProver: class {
		public onPhase: ((phase: AcceleratorPhase) => void) | undefined
		public accelerator: { host?: string; port?: number } | undefined
		constructor(opts: {
			onPhase?: (phase: AcceleratorPhase) => void
			accelerator?: { host?: string; port?: number }
		}) {
			this.onPhase = opts.onPhase
			this.accelerator = opts.accelerator
			acceleratorProverInstances.push({
				onPhase: opts.onPhase,
				accelerator: opts.accelerator,
			})
		}
		checkAcceleratorStatus() {
			return checkAcceleratorStatusMock()
		}
	},
}))

import { createPXE } from "@aztec/pxe/client/bundle"
import { ChainRuntime, ChainRuntimeRegistry, ProductionPxeFactory, type PxeFactory } from "./chain-runtime"
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

beforeEach(() => {
	acceleratorProverInstances.length = 0
	checkAcceleratorStatusMock.mockReset()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("ProductionPxeFactory default (production) mode", () => {
	test("constructs AcceleratorProver without onPhase callback", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: false }) // would be ignored
		const factory = new ProductionPxeFactory(fakeNodeFactory)
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		expect(acceleratorProverInstances).toHaveLength(1)
		expect(acceleratorProverInstances[0].onPhase).toBeUndefined()
	})

	test("does NOT invoke checkAcceleratorStatus preflight", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory)
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		expect(checkAcceleratorStatusMock).not.toHaveBeenCalled()
	})

	test("does NOT pass host/port to AcceleratorProver when not configured", async () => {
		const factory = new ProductionPxeFactory(fakeNodeFactory)
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		expect(acceleratorProverInstances[0].accelerator).toBeUndefined()
	})

	test("succeeds even when accelerator is reported unavailable", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: false })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "default" })
		await expect(factory.createChainRuntime(fakeNetwork, fakeStoreKey)).resolves.toBeDefined()
	})
})

describe("ProductionPxeFactory required mode", () => {
	test("preflight throws when checkAcceleratorStatus reports unavailable", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: false })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await expect(factory.createChainRuntime(fakeNetwork, fakeStoreKey)).rejects.toThrow(/accelerator-required.*unavailable/)
	})

	test("preflight does NOT throw when available", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await expect(factory.createChainRuntime(fakeNetwork, fakeStoreKey)).resolves.toBeDefined()
	})

	test("preflight invokes checkAcceleratorStatus exactly once", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		expect(checkAcceleratorStatusMock).toHaveBeenCalledTimes(1)
	})

	test("warns (does NOT throw) when status.needsDownload === true", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		checkAcceleratorStatusMock.mockResolvedValue({ available: true, needsDownload: true, sdkAztecVersion: "4.2.0" })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await expect(factory.createChainRuntime(fakeNetwork, fakeStoreKey)).resolves.toBeDefined()
		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/needsDownload=true/))
	})

	test('onPhase throws on phase="fallback"', async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		const onPhase = acceleratorProverInstances[0].onPhase
		expect(onPhase).toBeDefined()
		expect(() => onPhase?.("fallback")).toThrow(/SDK emitted phase="fallback"/)
	})

	test('onPhase throws on phase="denied"', async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		const onPhase = acceleratorProverInstances[0].onPhase
		expect(() => onPhase?.("denied")).toThrow(/SDK emitted phase="denied"/)
	})

	test("onPhase does NOT throw on benign phases", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		const onPhase = acceleratorProverInstances[0].onPhase
		const benign: AcceleratorPhase[] = ["detect", "serialize", "transmit", "proving", "proved", "receive"]
		for (const p of benign) {
			expect(() => onPhase?.(p)).not.toThrow()
		}
	})

	test('onPhase warns (does NOT throw) on phase="downloading"', async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "required" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		const onPhase = acceleratorProverInstances[0].onPhase
		expect(() => onPhase?.("downloading")).not.toThrow()
		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/phase="downloading"/))
	})

	test("passes host/port through to AcceleratorProver when configured", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, {
			provingMode: "required",
			host: "127.0.0.1",
			port: 59833,
		})
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		expect(acceleratorProverInstances[0].accelerator).toEqual({
			host: "127.0.0.1",
			port: 59833,
		})
	})
})

describe("ProductionPxeFactory proverless mode (e2e-only)", () => {
	test("does NOT construct an AcceleratorProver", async () => {
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "proverless" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		expect(acceleratorProverInstances).toHaveLength(0)
	})

	test("sets proverEnabled:false and omits proverOrOptions (default fakeProofs prover)", async () => {
		const factory = new ProductionPxeFactory(fakeNodeFactory, { provingMode: "proverless" })
		await factory.createChainRuntime(fakeNetwork, fakeStoreKey)
		const lastCall = createPXEMock.mock.calls.at(-1)!
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
