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

	test("PXE hit short-circuits — node is never called; preimage hydrates current := original", async () => {
		// 5.0.0: the PXE returns the address PREIMAGE. The seam hydrates it through
		// `hydratePreimage`, filling `currentContractClassId` from the original (the documented
		// no-upgrades assumption) — so the returned value is a new object, not the mock itself.
		const originalClassId = { toString: () => "class-original", equals: () => true }
		const pxeInstance = {
			address: { toString: () => "pxe-local" },
			originalContractClassId: originalClassId,
		} as unknown as ContractInstanceWithAddress
		const f = makeFactory({ pxeInstance, nodeBehavior: "throws" })
		const service = makeService(f.factory)

		const result = await service.getContractInstance(network, address)

		expect(result).toEqual({ ...pxeInstance, currentContractClassId: originalClassId })
		expect(result?.currentContractClassId).toBe(originalClassId)
		expect(f.pxeCalls).toBe(1)
		expect(f.nodeCalls).toBe(0)
	})

	test("node hit with an IMMUTABLE contract (current == original) passes through", async () => {
		const classId = { toString: () => "class-a", equals: (o: { toString(): string }) => o.toString() === "class-a" }
		const nodeInstance = {
			address: { toString: () => "node-hit" },
			originalContractClassId: classId,
			currentContractClassId: classId,
		} as unknown as ContractInstanceWithAddress
		const f = makeFactory({ nodeBehavior: "returns-instance", nodeInstance })
		const service = makeService(f.factory)

		const result = await service.getContractInstance(network, address)

		expect(result).toBe(nodeInstance)
		expect(f.nodeCalls).toBe(1)
	})

	test("node hit with an UPGRADED contract (current != original) fails explicitly", async () => {
		// The wallet does not support upgraded contracts: executing against the ORIGINAL
		// artifact would be silently wrong, so the seam rejects at entry (effective-class.ts).
		const original = { toString: () => "class-original", equals: () => false }
		const current = { toString: () => "class-upgraded", equals: (o: { toString(): string }) => o.toString() === "class-upgraded" }
		const nodeInstance = {
			address: { toString: () => "0xupgraded" },
			originalContractClassId: original,
			currentContractClassId: current,
		} as unknown as ContractInstanceWithAddress
		const f = makeFactory({ nodeBehavior: "returns-instance", nodeInstance })
		const service = makeService(f.factory)

		await expect(service.getContractInstance(network, address)).rejects.toThrow(/upgraded/)
		expect(f.nodeCalls).toBe(1)
	})

	test("nodeBestEffort: true does NOT swallow the upgrade rejection into the known-bundle fallback", async () => {
		// The upgrade rejection is a DEFINITIVE node answer, not a hiccup — best-effort must re-throw it
		// (ContractUpgradedError) rather than degrade to a stale known-bundle instance (finding #5).
		const original = { toString: () => "class-original", equals: () => false }
		const current = { toString: () => "class-upgraded", equals: (o: { toString(): string }) => o.toString() === "class-upgraded" }
		const nodeInstance = {
			address: { toString: () => "0xupgraded" },
			originalContractClassId: original,
			currentContractClassId: current,
		} as unknown as ContractInstanceWithAddress
		const f = makeFactory({ nodeBehavior: "returns-instance", nodeInstance })
		const service = makeService(f.factory)
		// A known-bundle hit is available — the bug would serve THIS instead of throwing.
		const knownInstance = { address: { toString: () => "known" } } as unknown as ContractInstanceWithAddress
		;(
			service as unknown as {
				artifacts: { ensureKnown: () => Promise<void>; getKnownInstance: (a: string) => ContractInstanceWithAddress }
			}
		).artifacts = { ensureKnown: async () => {}, getKnownInstance: () => knownInstance }

		await expect(service.getContractInstance(network, address, { nodeBestEffort: true })).rejects.toThrow(/upgraded/)
	})
})

describe("PxeService deletion honesty (finding D)", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", {
			runtime: { onMessage: { addListener: () => {}, removeListener: () => {} }, sendMessage: () => Promise.resolve() },
		})
	})
	afterEach(() => vi.unstubAllGlobals())

	// A fake IDBOpenDBRequest that fires the chosen lifecycle callback async.
	function fireReq(kind: "success" | "error"): unknown {
		const req: Record<string, unknown> = {}
		queueMicrotask(() => {
			if (kind === "success") (req.onsuccess as () => void)?.()
			else {
				req.error = new Error("boom")
				;(req.onerror as () => void)?.()
			}
		})
		return req
	}

	test("clearChainState REJECTS when deleteDatabase errors — no false 'deleted'", async () => {
		const service = makeService(makeFactory({ nodeBehavior: "throws" }).factory)
		;(service as unknown as { registry: unknown }).registry = { dispose: async () => {} }
		vi.stubGlobal("indexedDB", { deleteDatabase: () => fireReq("error") })
		await expect(service.clearChainState("p1", 1)).rejects.toThrow()
	})

	test("clearProfileState deletes the profile's DBs by prefix but KEEPS keyval-store while another profile survives", async () => {
		const service = makeService(makeFactory({ nodeBehavior: "throws" }).factory)
		;(service as unknown as { registry: unknown }).registry = { disposeProfile: async () => {} }
		const deleted: string[] = []
		let dbs = [{ name: "pxe/p1/1" }, { name: "pxe/p2/1" }, { name: "keyval-store" }]
		vi.stubGlobal("indexedDB", {
			databases: async () => dbs,
			deleteDatabase: (name: string) => {
				deleted.push(name)
				dbs = dbs.filter((d) => d.name !== name)
				return fireReq("success")
			},
		})
		await service.clearProfileState("p1")
		expect(deleted).toContain("pxe/p1/1")
		expect(deleted).not.toContain("pxe/p2/1") // another profile's DB — untouched
		expect(deleted).not.toContain("keyval-store") // shared — kept while p2 survives
	})

	test("clearProfileState RETAINS the profile barrier on erase failure, then drops it on a successful retry", async () => {
		const service = makeService(makeFactory({ nodeBehavior: "throws" }).factory)
		const barriers = (service as unknown as { profileBarriers: Map<string, unknown> }).profileBarriers
		let disposeShouldFail = true
		;(service as unknown as { registry: unknown }).registry = {
			disposeProfile: async () => {
				if (disposeShouldFail) throw new AggregateError([new Error("close failed")], "dispose failed")
			},
		}
		vi.stubGlobal("indexedDB", { databases: async () => [], deleteDatabase: () => fireReq("success") })

		// Failed erase: rejects AND keeps the barrier entry so the profile stays fenced for a retry.
		await expect(service.clearProfileState("p1")).rejects.toBeInstanceOf(AggregateError)
		expect(barriers.has("p1")).toBe(true)

		// Same-gen retry now succeeds → the barrier is dropped (the profile is gone).
		disposeShouldFail = false
		await service.clearProfileState("p1")
		expect(barriers.has("p1")).toBe(false)
	})
})
