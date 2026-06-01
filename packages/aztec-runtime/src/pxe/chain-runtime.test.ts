/**
 * `ProductionPxeFactory` accelerator-required-mode unit tests.
 *
 * Covers the env-gated runtime hard-fail path used by CI's `network-e2e`
 * when `VITE_NULO_ACCELERATOR_REQUIRED=1` is baked into the build. Default
 * mode (no options or `required: false`) must preserve the SDK's silent
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

import { ProductionPxeFactory } from "./chain-runtime"
import type { NodeFactory } from "../ports/node-factory-port"

const fakeNodeFactory: NodeFactory = {
	createNode: () => ({}) as never,
}

const fakeNetwork = { profileId: "p", chainId: 31337, rpcUrl: "http://node.local" }

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
		await factory.createChainRuntime(fakeNetwork)
		expect(acceleratorProverInstances).toHaveLength(1)
		expect(acceleratorProverInstances[0].onPhase).toBeUndefined()
	})

	test("does NOT invoke checkAcceleratorStatus preflight", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory)
		await factory.createChainRuntime(fakeNetwork)
		expect(checkAcceleratorStatusMock).not.toHaveBeenCalled()
	})

	test("does NOT pass host/port to AcceleratorProver when not configured", async () => {
		const factory = new ProductionPxeFactory(fakeNodeFactory)
		await factory.createChainRuntime(fakeNetwork)
		expect(acceleratorProverInstances[0].accelerator).toBeUndefined()
	})

	test("succeeds even when accelerator is reported unavailable", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: false })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { required: false })
		await expect(factory.createChainRuntime(fakeNetwork)).resolves.toBeDefined()
	})
})

describe("ProductionPxeFactory required mode", () => {
	test("preflight throws when checkAcceleratorStatus reports unavailable", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: false })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { required: true })
		await expect(factory.createChainRuntime(fakeNetwork)).rejects.toThrow(/accelerator-required.*unavailable/)
	})

	test("preflight does NOT throw when available", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { required: true })
		await expect(factory.createChainRuntime(fakeNetwork)).resolves.toBeDefined()
	})

	test("preflight invokes checkAcceleratorStatus exactly once", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { required: true })
		await factory.createChainRuntime(fakeNetwork)
		expect(checkAcceleratorStatusMock).toHaveBeenCalledTimes(1)
	})

	test("warns (does NOT throw) when status.needsDownload === true", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		checkAcceleratorStatusMock.mockResolvedValue({ available: true, needsDownload: true, sdkAztecVersion: "4.2.0" })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { required: true })
		await expect(factory.createChainRuntime(fakeNetwork)).resolves.toBeDefined()
		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/needsDownload=true/))
	})

	test('onPhase throws on phase="fallback"', async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { required: true })
		await factory.createChainRuntime(fakeNetwork)
		const onPhase = acceleratorProverInstances[0].onPhase
		expect(onPhase).toBeDefined()
		expect(() => onPhase?.("fallback")).toThrow(/SDK emitted phase="fallback"/)
	})

	test('onPhase throws on phase="denied"', async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { required: true })
		await factory.createChainRuntime(fakeNetwork)
		const onPhase = acceleratorProverInstances[0].onPhase
		expect(() => onPhase?.("denied")).toThrow(/SDK emitted phase="denied"/)
	})

	test("onPhase does NOT throw on benign phases", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { required: true })
		await factory.createChainRuntime(fakeNetwork)
		const onPhase = acceleratorProverInstances[0].onPhase
		const benign: AcceleratorPhase[] = ["detect", "serialize", "transmit", "proving", "proved", "receive"]
		for (const p of benign) {
			expect(() => onPhase?.(p)).not.toThrow()
		}
	})

	test('onPhase warns (does NOT throw) on phase="downloading"', async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, { required: true })
		await factory.createChainRuntime(fakeNetwork)
		const onPhase = acceleratorProverInstances[0].onPhase
		expect(() => onPhase?.("downloading")).not.toThrow()
		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/phase="downloading"/))
	})

	test("passes host/port through to AcceleratorProver when configured", async () => {
		checkAcceleratorStatusMock.mockResolvedValue({ available: true })
		const factory = new ProductionPxeFactory(fakeNodeFactory, {
			required: true,
			host: "127.0.0.1",
			port: 59833,
		})
		await factory.createChainRuntime(fakeNetwork)
		expect(acceleratorProverInstances[0].accelerator).toEqual({
			host: "127.0.0.1",
			port: 59833,
		})
	})
})
