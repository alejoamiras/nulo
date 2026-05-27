/**
 * Cascade contract for `PxeService.getContractInstance`:
 *
 *   pxe.getContractInstance → (if missing) node.getContract → (if missing) known-bundle
 *
 * The `nodeBestEffort` opt softens ONLY the node leg: a transient node throw
 * becomes "not found at node" and the cascade continues to the known-bundle
 * fallback. Without the opt, the node throw propagates. The known-bundle leg's
 * own failures (e.g. a broken `ensureKnown`) MUST still propagate either way.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// Both `known-artifacts.ts` and `note-schemas.ts` pull JSON via vite-only
// aliases (`@wonderland-token-artifact` etc.) that don't resolve in a plain
// vitest run. The cascade tests never reach the loaders, but the loader-return
// shape must match `KnownArtifacts` exactly — a wrong shape would let a future
// caller path silently misbehave during a test that DID exercise it.
vi.mock("./known-artifacts", () => ({
	loadProductionKnownArtifacts: async () => ({ artifacts: new Map(), instances: new Map() }),
}))
vi.mock("./note-schemas", () => ({
	loadProductionNoteSchemas: async () => new Map<string, unknown>(),
}))

import type { PXE } from "@aztec/pxe/client/bundle"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { ILogger } from "@nulo/wallet-core/logger"
import { ChainRuntime, type NetworkInfo, type PxeFactory } from "./chain-runtime"
import { PxeService, type IProfileReader } from "./service"

const noopLogger: ILogger = { log: () => {} }

const noopProfiles: IProfileReader = {
	connect: async () => {},
	getProfiles: async () => [],
	onProfileDeleted: { add: () => {} },
	onActiveProfileChanged: { add: () => {} },
}

const network: NetworkInfo = { profileId: "p1", chainId: 31337, rpcUrl: "http://localhost:8080" }

// `AztecAddress.schema` is a wire schema — it accepts hex strings or buffers,
// not instances. Pass a hex string and let the function-under-test hydrate it.
const addressHex = "0x000000000000000000000000000000000000000000000000000000000000ab12"
const address = addressHex as unknown as AztecAddress

function makeFactory(opts: {
	pxeInstance?: ContractInstanceWithAddress
	nodeBehavior: "returns-undefined" | "returns-instance" | "throws"
	nodeInstance?: ContractInstanceWithAddress
}): { factory: PxeFactory; nodeCalls: number; pxeCalls: number } {
	let nodeCalls = 0
	let pxeCalls = 0
	const factory: PxeFactory = {
		createChainRuntime: async (n) => {
			const pxe = {
				getContractInstance: async () => {
					pxeCalls++
					return opts.pxeInstance
				},
			} as unknown as PXE
			const node = {
				getContract: async () => {
					nodeCalls++
					if (opts.nodeBehavior === "throws") throw new Error("RPC timeout")
					if (opts.nodeBehavior === "returns-instance") return opts.nodeInstance
					return undefined
				},
			} as unknown as AztecNode
			return new ChainRuntime(n.chainId, node, pxe, n.rpcUrl)
		},
	}
	return {
		factory,
		get nodeCalls() {
			return nodeCalls
		},
		get pxeCalls() {
			return pxeCalls
		},
	}
}

function makeService(factory: PxeFactory): PxeService {
	const service = new PxeService(noopProfiles, noopLogger, factory)
	// Bypass Service<Methods>.start() — getContractInstance doesn't touch
	// any state that init() would set up. Mirrors the pattern in
	// extension/.../execution/feesettings-invariant.test.ts.
	;(service as unknown as { initialized: boolean }).initialized = true
	return service
}

describe("PxeService.getContractInstance cascade", () => {
	beforeEach(() => {
		// `Service` constructor calls `chrome.runtime.onMessage.addListener`;
		// `aztec-runtime` has no chrome stub at the package level, so stub here.
		vi.stubGlobal("chrome", {
			runtime: {
				onMessage: { addListener: () => {}, removeListener: () => {} },
				sendMessage: () => Promise.resolve(),
			},
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test("nodeBestEffort: true + node throws + no known instance → returns undefined (no rethrow)", async () => {
		const f = makeFactory({ nodeBehavior: "throws" })
		const service = makeService(f.factory)
		// Stub the known-bundle so the cascade's local fallback returns nothing.
		;(service as unknown as { artifacts: { ensureKnown: () => Promise<void>; getKnownInstance: (a: string) => undefined } }).artifacts =
			{
				ensureKnown: async () => {},
				getKnownInstance: () => undefined,
			}

		const result = await service.getContractInstance(network, address, { nodeBestEffort: true })

		expect(result).toBeUndefined()
		expect(f.pxeCalls).toBe(1)
		expect(f.nodeCalls).toBe(1)
	})

	test("nodeBestEffort: false (default) + node throws → rethrows the node error", async () => {
		const f = makeFactory({ nodeBehavior: "throws" })
		const service = makeService(f.factory)

		await expect(service.getContractInstance(network, address)).rejects.toThrow("RPC timeout")
		expect(f.pxeCalls).toBe(1)
		expect(f.nodeCalls).toBe(1)
	})

	test("nodeBestEffort: true + node throws + known-bundle hit → returns the known instance", async () => {
		const knownInstance = { address: { toString: () => "known" } } as unknown as ContractInstanceWithAddress
		const f = makeFactory({ nodeBehavior: "throws" })
		const service = makeService(f.factory)
		;(
			service as unknown as {
				artifacts: { ensureKnown: () => Promise<void>; getKnownInstance: (a: string) => ContractInstanceWithAddress }
			}
		).artifacts = {
			ensureKnown: async () => {},
			getKnownInstance: () => knownInstance,
		}

		const result = await service.getContractInstance(network, address, { nodeBestEffort: true })

		expect(result).toBe(knownInstance)
		expect(f.pxeCalls).toBe(1)
		expect(f.nodeCalls).toBe(1)
	})

	test("PXE hit short-circuits — node is never called", async () => {
		const pxeInstance = { address: { toString: () => "pxe-local" } } as unknown as ContractInstanceWithAddress
		const f = makeFactory({ pxeInstance, nodeBehavior: "throws" })
		const service = makeService(f.factory)

		const result = await service.getContractInstance(network, address)

		expect(result).toBe(pxeInstance)
		expect(f.pxeCalls).toBe(1)
		expect(f.nodeCalls).toBe(0)
	})
})

describe("PxeService.rebindChain (multi-rpc-failover Phase 2)", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", {
			runtime: { onMessage: { addListener: () => {}, removeListener: () => {} }, sendMessage: () => Promise.resolve() },
		})
	})
	afterEach(() => vi.unstubAllGlobals())

	test("disposes the cached runtime — next read re-creates via factory", async () => {
		const pxeInstance = { address: { toString: () => "pxe-instance" } } as unknown as ContractInstanceWithAddress
		const f = makeFactory({ pxeInstance, nodeBehavior: "returns-undefined" })
		const service = makeService(f.factory)
		;(service as unknown as { artifacts: { ensureKnown: () => Promise<void>; getKnownInstance: (a: string) => undefined } }).artifacts =
			{ ensureKnown: async () => {}, getKnownInstance: () => undefined }

		// First call lazy-inits the runtime.
		await service.getContractInstance(network, address)
		expect(f.pxeCalls).toBe(1)

		// rebindChain disposes the runtime; next call must re-init.
		await service.rebindChain(network.profileId, network.chainId)
		await service.getContractInstance(network, address)
		expect(f.pxeCalls).toBe(2)
	})

	test("does NOT delete IndexedDB (distinct from clearChainState)", async () => {
		// We assert this indirectly: rebindChain never invokes indexedDB at
		// all. Stub `indexedDB.deleteDatabase` globally so we can fail loudly
		// if it gets called.
		const deleteDbSpy = vi.fn()
		// biome-ignore lint/suspicious/noExplicitAny: test-only global stub
		vi.stubGlobal("indexedDB", { deleteDatabase: deleteDbSpy } as any)

		const f = makeFactory({ nodeBehavior: "returns-undefined" })
		const service = makeService(f.factory)
		;(service as unknown as { artifacts: { ensureKnown: () => Promise<void>; getKnownInstance: (a: string) => undefined } }).artifacts =
			{ ensureKnown: async () => {}, getKnownInstance: () => undefined }

		await service.getContractInstance(network, address)
		await service.rebindChain(network.profileId, network.chainId)

		expect(deleteDbSpy).not.toHaveBeenCalled()
	})
})
