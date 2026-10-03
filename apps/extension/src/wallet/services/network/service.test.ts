/**
 * Unit tests for `NetworkService`'s `NodeFactory` seam.
 *
 * Scope: drive the `nodeFactory.createNode()` → `getNodeInfo()` →
 * chainId derivation path via `addNetwork`, with a `FakeNodeFactory`
 * that returns in-memory stubs. Verifies (a) the factory seam is
 * wired, (b) the chainId calculation preserves today's XOR formula,
 * (c) the localhost special-case still returns 0, (d) getNodeInfo
 * failures bubble as "Failed to fetch node info".
 *
 * POJO-fake caveat (see FakeNodeFactory docstring): these tests do
 * NOT exercise the real `createSafeJsonRpcClient` proxy's param
 * validation or JSON-RPC error marshalling. Any code path whose
 * correctness depends on those surfaces needs a separate integration
 * test against the production adapter.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import type { AztecNode } from "@aztec-labs/stdlib/interfaces/client"
import { CHAIN_IDS, LOCAL_L1_CHAIN_ID } from "@/utils/chain-ids"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { LoggerStore } from "@/wallet/logger"
import { ConfigStore } from "@/wallet/config"
import { FakeNodeFactory } from "@/core/testing/fake-node-factory"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import type { ProfileService } from "@/wallet/services/profile/service"
import { LOCAL_NETWORK_RPC_URL, NetworkService } from "./service"
import { ERR_UNATTENDED_LIVE_CHECK, NodeStatus } from "./spec"
import type { Network, NetworkEndpoint } from "./spec"

type NodeInfo = {
	l1ChainId: number
	rollupVersion: number
}

/** Wire a NetworkService with a fake profile service + a seeded
 *  NodeFactory. Returns the collaborators so tests can drive them. */
function harness(seeded: Record<string, NodeInfo | Error>): {
	service: NetworkService
	factory: FakeNodeFactory
	deletionState: ProfileDeletionState
	browserApi: FakeBrowserApi
} {
	const logger = new LoggerStore(new ConfigStore())

	const factory = new FakeNodeFactory()
	for (const [rpcUrl, result] of Object.entries(seeded)) {
		if (result instanceof Error) {
			factory.setOverrides(rpcUrl, {
				getNodeInfo: vi.fn().mockRejectedValue(result) as unknown as AztecNode["getNodeInfo"],
			})
		} else {
			factory.setOverrides(rpcUrl, {
				getNodeInfo: vi.fn().mockResolvedValue(result) as unknown as AztecNode["getNodeInfo"],
			})
		}
	}

	const browserApi = new FakeBrowserApi()
	browserApi.reset()
	const service = new NetworkService(logger, browserApi, factory)

	// Stub a minimal ProfileService that reports an active profile. ONE shared
	// deletion state: the fence captures + asserts against the same instance.
	const fakeProfile = { id: "p1", name: "p1", type: "password" } as const
	const deletionState = new ProfileDeletionState()
	const fakeProfileService = {
		getActiveProfile: async () => fakeProfile,
		onActiveProfileChanged: { add: vi.fn(), remove: vi.fn() },
		onProfileDeleted: { add: vi.fn(), remove: vi.fn() },
		getDeletionState: () => deletionState,
		captureExecutionFence: async () => ({ profileId: "p1", epoch: deletionState.capture("p1") }),
	} as unknown as ProfileService

	// Reach into the service's protected init via the services map the base
	// class would normally call. Using `as any` access rather than driving
	// the real service bootstrap because we only need the NodeFactory seam
	// tested, not the full lifecycle.
	// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
	;(service as any).profileService = fakeProfileService

	return { service, factory, deletionState, browserApi }
}

describe("NetworkService — addNetwork creation fence", () => {
	test("a deletion completing DURING the probe rejects the write (entry-capture pin)", async () => {
		// begin + RELEASE while the RPC probe is parked: the deletion fully
		// settles, so only a fence captured at the authorizing entry rejects.
		let release!: (v: NodeInfo) => void
		const parked = new Promise<NodeInfo>((resolve) => {
			release = resolve
		})
		const h = harness({})
		h.factory.setOverrides("https://new.example/", {
			getNodeInfo: vi.fn().mockReturnValue(parked) as unknown as AztecNode["getNodeInfo"],
		})
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		;(h.service as any).initialized = true

		const run = h.service.addNetwork("Custom", "https://new.example/")
		await new Promise((r) => setTimeout(r, 0))
		h.deletionState.beginDeletion("p1")
		h.deletionState.release("p1")
		release({ l1ChainId: 5, rollupVersion: 1 })

		await expect(run).rejects.toThrow(/deleted|not current/i)
		const raw = await h.browserApi.storage.local.get(null)
		expect(Object.keys(raw as Record<string, unknown>).some((k) => k.startsWith("nulo:core:networks@"))).toBe(false)
	})

	test("first-run seeding REJECTS (not empty-success) when the deletion lands mid-seed", async () => {
		// The per-seed catch soft-fails one bad seed by design — but it also
		// swallows the deletion compensate's throw, and without the post-loop
		// re-assert the call would return [] as a SUCCESS for a deleted profile.
		const h = harness({})
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		;(h.service as any).initialized = true
		const realSet = h.browserApi.storage.local.set.bind(h.browserApi.storage.local)
		let fired = false
		h.browserApi.storage.local.set = (async (items: Record<string, unknown>) => {
			await realSet(items)
			if (!fired && Object.keys(items).some((k) => k.startsWith("nulo:core:networks@"))) {
				fired = true
				h.deletionState.beginDeletion("p1")
				h.deletionState.release("p1")
			}
		}) as typeof h.browserApi.storage.local.set

		await expect(h.service.getOrInitNetworks()).rejects.toThrow(/deleted|not current/i)
	})
})

describe("NetworkService — seedDefaultsForProfile (full-backup import reseeds a NOT-yet-active profile)", () => {
	function withProfiles(h: ReturnType<typeof harness>, ids: string[]) {
		const internals = h.service as unknown as {
			initialized: boolean
			profileService: { getProfiles: () => Promise<unknown[]> }
			storage: { set: (id: string, row: unknown) => Promise<void> }
		}
		internals.initialized = true
		internals.profileService.getProfiles = async () => ids.map((id) => ({ id, name: id, type: "password" }))
		return { ...h, internals }
	}
	const rowsOf = async (h: ReturnType<typeof harness>, profileId: string) =>
		(await h.service.getNetworksRaw(profileId)).sort((a, b) => a.chainId - b.chainId)

	test("seeds every default for the target profile and writes ITS active pointer, never touching the active profile's node cache", async () => {
		const h = withProfiles(harness({}), ["p1", "p2"])
		const p1 = await h.service.getOrInitNetworks()
		const p1Primary = p1.find((n) => n.chainId === CHAIN_IDS.TESTNET)!
		const p1NodeBefore = await h.service.getNode(p1Primary.chainId)
		const nodesBefore = new Map((h.service as unknown as { nodes: Map<number, unknown> }).nodes)

		const seeded = await h.service.seedDefaultsForProfile("p2")

		expect(seeded.map((n) => n.chainId).sort((a, b) => a - b)).toEqual(p1.map((n) => n.chainId).sort((a, b) => a - b))
		expect(seeded.every((n) => n.profileId === "p2")).toBe(true)
		expect(new Set(seeded.map((n) => n.id)).size).toBe(seeded.length)
		expect(seeded.some((n) => p1.some((m) => m.id === n.id))).toBe(false)
		// The cache is keyed by chainId alone: p1 keeps exactly the node objects it had.
		const nodesAfter = (h.service as unknown as { nodes: Map<number, unknown> }).nodes
		expect(nodesAfter.size).toBe(nodesBefore.size)
		for (const [chainId, node] of nodesBefore) expect(nodesAfter.get(chainId)).toBe(node)
		expect(await h.service.getNode(p1Primary.chainId)).toBe(p1NodeBefore)
		// p2's pointer names p2's primary seed; p1's pointer is untouched.
		const raw = (await h.browserApi.storage.local.get(null)) as Record<string, unknown>
		const p2Primary = seeded.find((n) => n.chainId === CHAIN_IDS.TESTNET)!
		expect(Object.entries(raw).some(([k, v]) => k.includes("p2") && v === p2Primary.id)).toBe(true)
		expect(Object.entries(raw).some(([k, v]) => k.includes("p1") && v === p1Primary.id)).toBe(true)
	})

	test("a repeat call returns the stored rows untouched — no duplicate (profileId, chainId), no endpoint reset", async () => {
		const h = withProfiles(harness({}), ["p2"])
		const first = await h.service.seedDefaultsForProfile("p2")
		const edited = { ...first[0], endpoints: [{ ...first[0].endpoints[0], rpcUrl: "https://edited.example/" }] }
		await h.internals.storage.set(edited.id, edited)

		const again = await h.service.seedDefaultsForProfile("p2")

		expect(again.map((n) => n.id).sort()).toEqual(first.map((n) => n.id).sort())
		expect((await rowsOf(h, "p2")).length).toBe(first.length)
		expect((await h.service.getNetworksRaw("p2")).find((n) => n.id === edited.id)?.endpoints[0].rpcUrl).toBe("https://edited.example/")
	})

	test("rejects a profile that does not exist, and one already under deletion, without writing a row", async () => {
		const h = withProfiles(harness({}), ["p1"])
		await expect(h.service.seedDefaultsForProfile("ghost")).rejects.toThrow(/does not exist/)
		h.deletionState.beginDeletion("p1")
		await expect(h.service.seedDefaultsForProfile("p1")).rejects.toThrow(/deleted|not captured|write rejected/i)
		const raw = (await h.browserApi.storage.local.get(null)) as Record<string, unknown>
		expect(Object.keys(raw).some((k) => k.startsWith("nulo:core:networks@"))).toBe(false)
	})

	test("a deletion landing mid-seed rejects and leaves no orphan rows", async () => {
		const h = withProfiles(harness({}), ["p2"])
		const realSet = h.browserApi.storage.local.set.bind(h.browserApi.storage.local)
		let fired = false
		h.browserApi.storage.local.set = (async (items: Record<string, unknown>) => {
			await realSet(items)
			if (!fired && Object.keys(items).some((k) => k.startsWith("nulo:core:networks@"))) {
				fired = true
				h.deletionState.beginDeletion("p2")
				h.deletionState.release("p2")
			}
		}) as typeof h.browserApi.storage.local.set
		await expect(h.service.seedDefaultsForProfile("p2")).rejects.toThrow(/deleted|not current/i)
		expect(await rowsOf(h, "p2")).toEqual([])
	})
})

describe("NetworkService — resolveVerifiedL1ChainId single-snapshot", () => {
	test("the probe target and the returned l1ChainId come from one row read", async () => {
		// Two-faced storage: the row is swapped between reads. A split-read
		// implementation validates one row's endpoint against the OTHER row's
		// stored value and throws a spurious mismatch; the single-snapshot
		// implementation probes and returns the same row it read.
		const logger = new LoggerStore(new ConfigStore())
		const factory = new FakeNodeFactory()
		factory.setOverrides("https://rpc-a.example/", {
			getNodeInfo: vi.fn().mockResolvedValue({ l1ChainId: 5, rollupVersion: 1 }) as unknown as AztecNode["getNodeInfo"],
		})
		factory.setOverrides("https://rpc-b.example/", {
			getNodeInfo: vi.fn().mockResolvedValue({ l1ChainId: 7, rollupVersion: 1 }) as unknown as AztecNode["getNodeInfo"],
		})
		const browserApi = new FakeBrowserApi()
		browserApi.reset()
		const service = new NetworkService(logger, browserApi, factory)
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in (no full lifecycle needed)
		;(service as any).initialized = true

		const rowKey = "nulo:core:networks@n1"
		const rowA = {
			id: "n1",
			profileId: "p1",
			chainId: 123,
			l1ChainId: 5,
			name: "A",
			primaryEndpointId: "e1",
			endpoints: [{ id: "e1", rpcUrl: "https://rpc-a.example/" }],
			kind: "custom",
		}
		const rowB = { ...rowA, l1ChainId: 7, endpoints: [{ id: "e1", rpcUrl: "https://rpc-b.example/" }] }
		await browserApi.storage.local.set({ [rowKey]: JSON.stringify(rowA) })

		const realGet = browserApi.storage.local.get.bind(browserApi.storage.local)
		let swapped = false
		browserApi.storage.local.get = (async (key: unknown) => {
			const value = await realGet(key as never)
			if (!swapped && JSON.stringify(value).includes("nulo:core:networks@")) {
				swapped = true
				await browserApi.storage.local.set({ [rowKey]: JSON.stringify(rowB) })
			}
			return value
		}) as typeof browserApi.storage.local.get

		await expect(service.resolveVerifiedL1ChainId("p1", 123)).resolves.toBe(5)
	})
})

describe("NetworkService NodeFactory seam", () => {
	test("getChainId returns the XOR of l1ChainId and rollupVersion for non-localhost", async () => {
		const { service, factory } = harness({
			"https://rpc.example/1": { l1ChainId: 11155111, rollupVersion: 4127419662 },
		})
		// Calls the private probe directly, past the lock and storage.
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		const chainId = await (service as any)._getChainId("https://rpc.example/1")
		expect(chainId).toBe(4138294185)
		expect(factory.created.length).toBe(1)
		expect(factory.created[0]!.rpcUrl).toBe("https://rpc.example/1")
	})

	test("getChainId returns 0 for the localhost:8080 special-case", async () => {
		const { service } = harness({
			"http://localhost:8080": { l1ChainId: 99, rollupVersion: 77 },
		})
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		const chainId = await (service as any)._getChainId("http://localhost:8080")
		expect(chainId).toBe(0)
	})

	test("getChainId(kindHint='local') short-circuits to 0 regardless of URL", async () => {
		// Structural fix for the bug where editing Local Network's endpoint URL
		// away from the seed literal yielded ERR_ENDPOINT_CHAIN_MISMATCH. With
		// kindHint, callers that already know the target's kind bypass URL
		// equality entirely.
		const { service } = harness({
			"http://localhost:18080": { l1ChainId: 1, rollupVersion: 2 },
		})
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		const chainId = await (service as any)._getChainId("http://localhost:18080", "local")
		expect(chainId).toBe(0)
	})

	test("getChainId normalizes localhost URL fallback (trailing slash, case)", async () => {
		// `normalizeRpcUrl` lowercases host + drops the trailing slash for
		// path === "/". The chainId-zero check must compare normalized values
		// so user-typed variants of the seed URL still resolve to 0.
		const { service } = harness({
			"http://LOCALHOST:8080/": { l1ChainId: 1, rollupVersion: 2 },
		})
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		const chainId = await (service as any)._getChainId("http://LOCALHOST:8080/")
		expect(chainId).toBe(0)
	})

	test("getChainId rethrows 'Failed to fetch node info' when getNodeInfo rejects", async () => {
		const { service } = harness({
			"https://bad.example": new Error("ECONNREFUSED"),
		})
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		await expect((service as any)._getChainId("https://bad.example")).rejects.toThrow("Failed to fetch node info")
	})

	test("each getChainId call creates a fresh node — no global cache between URLs", async () => {
		const { service, factory } = harness({
			"https://rpc.example/a": { l1ChainId: 1, rollupVersion: 1 },
			"https://rpc.example/b": { l1ChainId: 2, rollupVersion: 2 },
		})
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		await (service as any)._getChainId("https://rpc.example/a")
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		await (service as any)._getChainId("https://rpc.example/b")
		expect(factory.created.length).toBe(2)
		expect(factory.created[0]!.rpcUrl).toBe("https://rpc.example/a")
		expect(factory.created[1]!.rpcUrl).toBe("https://rpc.example/b")
	})

	test("default ctor wires AztecNodeFactoryAdapter — no-arg constructor works", () => {
		const logger = new LoggerStore(new ConfigStore())
		// Smoke: constructing without an explicit factory should not throw.
		expect(() => new NetworkService(logger, new FakeBrowserApi())).not.toThrow()
	})
})

describe("NetworkService transient-node cache (M4.10)", () => {
	test("getNodeForUrl caches per URL — same URL returns same node ref", async () => {
		const { service, factory } = harness({
			"https://rpc.a": { l1ChainId: 1, rollupVersion: 1 },
		})
		// Mark service as initialized — `getNodeForUrl` calls `ensureInitialized`
		// which would otherwise wait for `init()` to set the flag.
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		;(service as any).initialized = true
		// Pre-seed the transient cache so the call is a pure cache hit.
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		const transient: Map<string, { node: unknown; failures: number }> = (service as any).transientNodes
		const stub = { __id: "first" }
		transient.set("https://rpc.a", { node: stub as never, failures: 0 })
		const result = await service.getNodeForUrl("https://rpc.a")
		expect(result).toBe(stub)
		// No new factory call — cache hit.
		expect(factory.created.length).toBe(0)
	})

	test("getNodeForUrl pins a pending tx to its submitting endpoint ACROSS profiles (C3 cross-profile leak fix)", async () => {
		// Leak setup: two profiles, SAME chainId, DIFFERENT rpc endpoints.
		const { service, factory } = setupServiceWithStorage({
			"https://rpc.a": nodeInfoForChain(7),
			"https://rpc.b": nodeInfoForChain(7),
		})
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to seed cross-profile networks
		const storage = (service as any).storage as { set: (id: string, n: Network) => Promise<void> }
		await storage.set("netA", {
			id: "netA",
			profileId: "p1",
			chainId: 7,
			l1ChainId: 0,
			name: "A",
			primaryEndpointId: "epA",
			endpoints: [{ id: "epA", rpcUrl: "https://rpc.a" }],
		})
		await storage.set("netB", {
			id: "netB",
			profileId: "p2",
			chainId: 7,
			l1ChainId: 0,
			name: "B",
			primaryEndpointId: "epB",
			endpoints: [{ id: "epB", rpcUrl: "https://rpc.b" }],
		})
		// Active profile is p2. The old code fell back to p2's node here → A's tx
		// hash sent to p2's RPC. getNodeForUrl now always pins to the submitted URL.
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to switch the active profile
		;(service as any).profileService.getActiveProfile = async () => ({ id: "p2", name: "p2", type: "password" })

		// Poll profile A's still-pending tx (submitted to A's endpoint) while B is active.
		const node = await service.getNodeForUrl("https://rpc.a")

		// The returned node is bound to A's endpoint — NOT a fallback to p2's (rpc.b).
		const createdEntry = factory.created.find((c) => c.node === node)
		expect(createdEntry?.rpcUrl).toBe("https://rpc.a")
		expect(factory.created.map((c) => c.rpcUrl)).not.toContain("https://rpc.b")
	})

	test("getNodeForUrl pins to the submitted URL even when it matches NO configured endpoint (deleted/edited, never falls back to active)", async () => {
		// The endpoint was deleted/edited away from every profile while the tx was
		// still pending. Pinning to the submitted URL (no active-profile fallback)
		// keeps the receipt fetch off the active profile's RPC — the leak is closed
		// here too, not just on a plain profile switch.
		const { service, factory } = setupServiceWithStorage({ "https://rpc.b": nodeInfoForChain(7) })
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to seed the active profile's network
		const storage = (service as any).storage as { set: (id: string, n: Network) => Promise<void> }
		await storage.set("netB", {
			id: "netB",
			profileId: "p1",
			chainId: 7,
			l1ChainId: 0,
			name: "B",
			primaryEndpointId: "epB",
			endpoints: [{ id: "epB", rpcUrl: "https://rpc.b" }],
		})

		// active profile is p1 (harness default, endpoint rpc.b). Poll a URL no
		// profile configures — the submitting endpoint was removed.
		const node = await service.getNodeForUrl("https://rpc.deleted")

		// Pins to the submitted URL; never touches the active profile's node (rpc.b).
		const createdEntry = factory.created.find((c) => c.node === node)
		expect(createdEntry?.rpcUrl).toBe("https://rpc.deleted")
		expect(factory.created.map((c) => c.rpcUrl)).not.toContain("https://rpc.b")
	})

	test("getSingleAttemptNodeForUrl pins the same way, through the factory's one-attempt client, one per URL", async () => {
		const { service, factory } = setupServiceWithStorage({ "https://rpc.b": nodeInfoForChain(7) })
		const node = await service.getSingleAttemptNodeForUrl("https://rpc.deleted")
		expect(await service.getSingleAttemptNodeForUrl("https://rpc.deleted")).toBe(node)
		expect(factory.singleAttempt).toEqual(["https://rpc.deleted"])
		expect(factory.created.find((c) => c.node === node)?.rpcUrl).toBe("https://rpc.deleted")
		expect(factory.created.map((c) => c.rpcUrl)).not.toContain("https://rpc.b")
	})

	test("reportEndpointFailure increments + evicts at threshold 3", () => {
		const { service } = harness({})
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		const transient: Map<string, { node: unknown; failures: number }> = (service as any).transientNodes
		transient.set("https://rpc.x", { node: {} as never, failures: 0 })
		service.reportEndpointFailure("https://rpc.x")
		expect(transient.get("https://rpc.x")?.failures).toBe(1)
		service.reportEndpointFailure("https://rpc.x")
		expect(transient.get("https://rpc.x")?.failures).toBe(2)
		service.reportEndpointFailure("https://rpc.x")
		expect(transient.has("https://rpc.x")).toBe(false)
	})

	test("reportEndpointFailure for unknown URL is a no-op", () => {
		const { service } = harness({})
		expect(() => service.reportEndpointFailure("https://never-cached")).not.toThrow()
	})
})

/**
 * Minimal in-memory chrome.storage area shim. Mirrors the
 * `MinimalStorageArea` shape EntityStorage actually consumes:
 *   - `get(undefined)` returns ALL entries
 *   - `get(string|string[])` returns the requested subset
 *   - `set(items)` merges
 *   - `remove(keys)` deletes the listed keys
 * The fake stores raw values exactly as written — EntityStorage is the
 * piece that does the JSON.stringify/parse round-trip.
 */
class FakeStorageArea {
	public readonly store = new Map<string, unknown>()

	public async get(keys?: string | string[]): Promise<Record<string, unknown>> {
		if (keys === undefined) return Object.fromEntries(this.store)
		const keyList = Array.isArray(keys) ? keys : [keys]
		const out: Record<string, unknown> = {}
		for (const k of keyList) {
			if (this.store.has(k)) out[k] = this.store.get(k)
		}
		return out
	}

	public async set(items: Record<string, unknown>): Promise<void> {
		for (const [k, v] of Object.entries(items)) this.store.set(k, v)
	}

	public async remove(keys: string | string[]): Promise<void> {
		const keyList = Array.isArray(keys) ? keys : [keys]
		for (const k of keyList) this.store.delete(k)
	}
}

/**
 * Beefier harness for tests that exercise the public API end-to-end.
 * Stubs `chrome.storage.local` + `chrome.storage.session` with in-memory
 * fakes BEFORE constructing NetworkService (its `EntityStorage` field is
 * bound at construction time). Bypasses `init()` by reach-in setting
 * `profileService` + marking `initialized = true` + stubbing
 * `pxeServiceClient`. Tests can then drive `addNetwork`/`addEndpoint`/etc
 * naturally.
 */
function setupServiceWithStorage(seeded: Record<string, NodeInfo | Error>): {
	service: NetworkService
	factory: FakeNodeFactory
	local: FakeStorageArea
	session: FakeStorageArea
	pxeStub: ReturnType<typeof vi.fn>
	deletionState: ProfileDeletionState
} {
	const local = new FakeStorageArea()
	const session = new FakeStorageArea()
	// biome-ignore lint/suspicious/noExplicitAny: test stub for chrome.storage
	;(chrome.storage as any).local = local as never
	// biome-ignore lint/suspicious/noExplicitAny: test stub for chrome.storage
	;(chrome.storage as any).session = session as never

	const logger = new LoggerStore(new ConfigStore())
	const factory = new FakeNodeFactory()
	for (const [rpcUrl, result] of Object.entries(seeded)) {
		if (result instanceof Error) {
			factory.setOverrides(rpcUrl, {
				getNodeInfo: vi.fn().mockRejectedValue(result) as unknown as AztecNode["getNodeInfo"],
			})
		} else {
			factory.setOverrides(rpcUrl, {
				getNodeInfo: vi.fn().mockResolvedValue(result) as unknown as AztecNode["getNodeInfo"],
			})
		}
	}

	// The service must read/write the SAME `local` FakeStorageArea the tests seed
	// (via `local.store.set`), so inject it as the browserApi storage port. Network
	// only touches browserApi.storage, so a partial port is sufficient here.
	const browserApi = { storage: { local, session } } as unknown as BrowserApi
	const service = new NetworkService(logger, browserApi, factory)
	const fakeProfile = { id: "p1", name: "p1", type: "password" } as const
	const pxeStub = vi.fn().mockResolvedValue(undefined)
	const deletionState = new ProfileDeletionState()
	// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
	;(service as any).profileService = {
		getActiveProfile: async () => fakeProfile,
		onActiveProfileChanged: { add: vi.fn(), remove: vi.fn() },
		onProfileDeleted: { add: vi.fn(), remove: vi.fn() },
		getDeletionState: () => deletionState,
		captureExecutionFence: async () => ({ profileId: "p1", epoch: deletionState.capture("p1") }),
	} as unknown as ProfileService
	// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
	;(service as any).pxeServiceClient = { clearChainState: pxeStub }
	// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in (skip init() wait)
	;(service as any).initialized = true

	return { service, factory, local, session, pxeStub, deletionState }
}

/** Convenience: seed a single endpoint URL → chainId mapping for tests
 *  that only need one network. */
function nodeInfoForChain(chainId: number): NodeInfo {
	// XOR-decompose chainId into l1ChainId + rollupVersion. Either
	// direction works since `(a ^ b) >>> 0` is symmetric. For non-zero
	// chainIds we pick `(0, chainId)` so the math is obvious in tests.
	return { l1ChainId: 0, rollupVersion: chainId }
}

describe("NetworkService purgeChain coordinator (M4.10)", () => {
	test("invokes subscribers in registration order; PXE clear runs last", async () => {
		const { service } = harness({})
		// Stub the offscreen RPC so we can observe its invocation order.
		const pxeStub = vi.fn().mockResolvedValue(undefined)
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		;(service as any).pxeServiceClient = { clearChainState: pxeStub }

		const calls: string[] = []
		service.registerChainPurgeSubscriber(async () => {
			calls.push("first")
		})
		service.registerChainPurgeSubscriber(async () => {
			calls.push("second")
		})
		service.registerChainPurgeSubscriber(async () => {
			calls.push("third")
		})

		await service.purgeChain("p1", 42, "net-id")

		expect(calls).toEqual(["first", "second", "third"])
		expect(pxeStub).toHaveBeenCalledTimes(1)
		expect(pxeStub).toHaveBeenCalledWith("p1", 42)
	})

	test("subscriber failure runs the whole cascade then PROPAGATES (fail-fast, D)", async () => {
		const { service } = harness({})
		const pxeStub = vi.fn().mockResolvedValue(undefined)
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		;(service as any).pxeServiceClient = { clearChainState: pxeStub }

		const calls: string[] = []
		service.registerChainPurgeSubscriber(async () => {
			calls.push("a")
			throw new Error("boom")
		})
		service.registerChainPurgeSubscriber(async () => {
			calls.push("b")
		})

		await expect(service.purgeChain("p1", 1, "n1")).rejects.toThrow(/boom/)
		expect(calls).toEqual(["a", "b"]) // all subscribers still ran — fail-fast is at the END, not mid-cascade
		expect(pxeStub).toHaveBeenCalledTimes(1)
	})

	test("PXE clear failure PROPAGATES (fail-fast, D)", async () => {
		const { service } = harness({})
		const pxeStub = vi.fn().mockRejectedValue(new Error("offscreen down"))
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		;(service as any).pxeServiceClient = { clearChainState: pxeStub }

		await expect(service.purgeChain("p1", 1, "n1")).rejects.toThrow(/offscreen down/)
		expect(pxeStub).toHaveBeenCalledTimes(1)
	})

	test("subscribers receive (profileId, chainId, networkId) tuple", async () => {
		const { service } = harness({})
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		;(service as any).pxeServiceClient = { clearChainState: vi.fn().mockResolvedValue(undefined) }

		const captured: Array<[string, number, string]> = []
		service.registerChainPurgeSubscriber(async (profileId, chainId, networkId) => {
			captured.push([profileId, chainId, networkId])
		})

		await service.purgeChain("alpha", 99, "net-77")

		expect(captured).toEqual([["alpha", 99, "net-77"]])
	})
})

describe("NetworkService public API (M4.10)", () => {
	beforeEach(() => {
		// Reset chrome.storage stubs between tests so prior FakeStorageArea
		// instances don't leak across cases.
	})

	describe("F-011: RPC URL scheme allowlist", () => {
		test("rejects javascript: URL", async () => {
			const { service } = setupServiceWithStorage({})
			await expect(service.addNetwork("Evil", "javascript:alert(1)")).rejects.toThrow()
		})

		test("rejects data: URL", async () => {
			const { service } = setupServiceWithStorage({})
			await expect(service.addNetwork("Evil", "data:text/html,<script>alert(1)</script>")).rejects.toThrow()
		})

		test("rejects file:// URL", async () => {
			const { service } = setupServiceWithStorage({})
			await expect(service.addNetwork("Evil", "file:///etc/passwd")).rejects.toThrow()
		})

		test("rejects http://attacker.example.com (non-loopback HTTP)", async () => {
			const { service } = setupServiceWithStorage({})
			await expect(service.addNetwork("Bad", "http://attacker.example.com:8080")).rejects.toThrow()
		})

		test("accepts https://anywhere.example.com", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.example.com": nodeInfoForChain(999),
			})
			const network = await service.addNetwork("HTTPS", "https://rpc.example.com")
			expect(network.chainId).toBe(999)
		})

		test("accepts http://localhost:8888", async () => {
			const { service } = setupServiceWithStorage({
				"http://localhost:8888": nodeInfoForChain(31337),
			})
			const network = await service.addNetwork("Local", "http://localhost:8888")
			expect(network.chainId).toBe(31337)
		})

		test("accepts http://127.0.0.1:8888", async () => {
			const { service } = setupServiceWithStorage({
				"http://127.0.0.1:8888": nodeInfoForChain(31337),
			})
			const network = await service.addNetwork("Local-v4", "http://127.0.0.1:8888")
			expect(network.chainId).toBe(31337)
		})

		test("accepts http://[::1]:8888 (IPv6 loopback, WHATWG-URL form)", async () => {
			const { service } = setupServiceWithStorage({
				"http://[::1]:8888": nodeInfoForChain(31337),
			})
			const network = await service.addNetwork("Local-v6", "http://[::1]:8888")
			expect(network.chainId).toBe(31337)
		})
	})

	describe("addNetwork", () => {
		test("creates a Network with one initial endpoint and emits onNetworkAdded", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(123),
			})
			const events: Network[] = []
			service.onNetworkAdded.add((n) => {
				events.push(n)
				return Promise.resolve()
			})

			const network = await service.addNetwork("My Chain", "https://rpc.test/1")

			expect(network.profileId).toBe("p1")
			expect(network.chainId).toBe(123)
			expect(network.name).toBe("My Chain")
			expect(network.kind).toBe("custom")
			expect(network.endpoints).toHaveLength(1)
			expect(network.endpoints[0]!.rpcUrl).toBe("https://rpc.test/1")
			expect(network.primaryEndpointId).toBe(network.endpoints[0]!.id)
			expect(events).toHaveLength(1)
			expect(events[0]!.id).toBe(network.id)
		})

		test("rejects with DUPLICATE_CHAIN when chainId already present in profile", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(123),
				"https://rpc.test/2": nodeInfoForChain(123),
			})
			await service.addNetwork("First", "https://rpc.test/1")
			await expect(service.addNetwork("Second", "https://rpc.test/2")).rejects.toThrow(/DUPLICATE_CHAIN/)
		})

		test("rejects when name is already in use", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(123),
				"https://rpc.test/2": nodeInfoForChain(456),
			})
			await service.addNetwork("Same Name", "https://rpc.test/1")
			await expect(service.addNetwork("Same Name", "https://rpc.test/2")).rejects.toThrow(/already in use/)
		})

		test("normalizes the rpcUrl host (lowercase) but preserves path", async () => {
			const { service } = setupServiceWithStorage({
				"https://RPC.Test.com/Path?KEY=Value": nodeInfoForChain(7),
			})
			const network = await service.addNetwork("MixedCase", "https://RPC.Test.com/Path?KEY=Value")
			// host lowercased
			expect(network.endpoints[0]!.rpcUrl).toContain("rpc.test.com")
			// path + query preserved verbatim
			expect(network.endpoints[0]!.rpcUrl).toContain("/Path")
			expect(network.endpoints[0]!.rpcUrl).toContain("KEY=Value")
		})
	})

	describe("renameNetwork", () => {
		test("updates the name and emits onNetworkUpdated", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
			})
			const created = await service.addNetwork("Old", "https://rpc.test/1")

			const updates: Network[] = []
			service.onNetworkUpdated.add((n) => {
				updates.push(n)
				return Promise.resolve()
			})

			const renamed = await service.renameNetwork(created.id, "New")
			expect(renamed.name).toBe("New")
			expect(updates).toHaveLength(1)
			expect(updates[0]!.name).toBe("New")
		})

		test("rejects collision with another network's name", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
				"https://rpc.test/2": nodeInfoForChain(2),
			})
			await service.addNetwork("Alpha", "https://rpc.test/1")
			const beta = await service.addNetwork("Beta", "https://rpc.test/2")
			await expect(service.renameNetwork(beta.id, "Alpha")).rejects.toThrow(/already in use/)
		})

		test("no-op when name is unchanged (no event)", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
			})
			const created = await service.addNetwork("Same", "https://rpc.test/1")
			const updates: Network[] = []
			service.onNetworkUpdated.add((n) => {
				updates.push(n)
				return Promise.resolve()
			})
			const result = await service.renameNetwork(created.id, "Same")
			expect(result.id).toBe(created.id)
			expect(updates).toHaveLength(0)
		})
	})

	describe("addEndpoint", () => {
		test("appends a new endpoint when chainId matches", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
				"https://rpc.test/2": nodeInfoForChain(50),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			const ep = await service.addEndpoint(network.id, "Backup", "https://rpc.test/2")
			expect(ep.label).toBe("Backup")
			expect(ep.rpcUrl).toContain("rpc.test/2")

			const updated = await service.getNetwork(network.id)
			expect(updated.endpoints).toHaveLength(2)
			// primary unchanged
			expect(updated.primaryEndpointId).toBe(network.primaryEndpointId)
		})

		test("rejects ENDPOINT_CHAIN_MISMATCH when probed chainId differs", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
				"https://rpc.other": nodeInfoForChain(99),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			await expect(service.addEndpoint(network.id, "Wrong", "https://rpc.other")).rejects.toThrow(/ENDPOINT_CHAIN_MISMATCH/)
		})

		test("rejects DUPLICATE_ENDPOINT when rpcUrl already exists in this Network", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			await expect(service.addEndpoint(network.id, "Dup", "https://rpc.test/1")).rejects.toThrow(/DUPLICATE_ENDPOINT/)
		})

		test("Local Network accepts a non-seed endpoint URL via the kindHint short-circuit", async () => {
			// Locks the structural fix: with `kind: "local"`, the chainId probe
			// returns 0 even if the URL doesn't match the seed literal. Without
			// kindHint we'd reject with ENDPOINT_CHAIN_MISMATCH because the
			// fake node reports chainId XOR != 0.
			const { service, local } = setupServiceWithStorage({
				"http://localhost:18080": nodeInfoForChain(42),
			})
			const localNet = {
				id: "local-1",
				profileId: "p1",
				chainId: 0,
				// Matches the fake probe's l1ChainId (nodeInfoForChain reports l1=0) so the
				// endpoint mutation's exact-L1 equality check passes alongside the composite
				// short-circuit under test.
				l1ChainId: 0,
				name: "Local Network",
				kind: "local" as const,
				primaryEndpointId: "ep-1",
				endpoints: [{ id: "ep-1", rpcUrl: "http://localhost:8080" }],
			}
			local.store.set("nulo:core:networks@local-1", JSON.stringify(localNet))

			const ep = await service.addEndpoint(localNet.id, "Custom Port", "http://localhost:18080")
			expect(ep.rpcUrl).toContain("localhost:18080")
			const fetched = await service.getNetwork(localNet.id)
			expect(fetched.endpoints).toHaveLength(2)
		})
	})

	describe("updateEndpoint", () => {
		// Characterization pins (F-Q09): this method had ZERO coverage — every
		// branch below is pinned as-is before any structural refactor touches it.
		test("replaces the endpoint in place — same id, new url + label, array length unchanged; emits onNetworkUpdated", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
				"https://rpc.test/2": nodeInfoForChain(50),
				"https://rpc.test/3": nodeInfoForChain(50),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			const ep = await service.addEndpoint(network.id, "Backup", "https://rpc.test/2")
			const updates: Network[] = []
			service.onNetworkUpdated.add((n) => {
				updates.push(n)
				return Promise.resolve()
			})

			const updated = await service.updateEndpoint(network.id, ep.id, "Renamed", "https://rpc.test/3")

			expect(updated.id).toBe(ep.id)
			expect(updated.label).toBe("Renamed")
			expect(updated.rpcUrl).toContain("rpc.test/3")
			const after = await service.getNetwork(network.id)
			expect(after.endpoints).toHaveLength(2)
			expect(after.endpoints.find((e) => e.id === ep.id)?.rpcUrl).toContain("rpc.test/3")
			expect(updates).toHaveLength(1)
		})

		test("an unchanged URL does NOT collide with itself (self-excluding predicate)", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
				"https://rpc.test/2": nodeInfoForChain(50),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			const ep = await service.addEndpoint(network.id, "Backup", "https://rpc.test/2")

			const updated = await service.updateEndpoint(network.id, ep.id, "Label only", "https://rpc.test/2")

			expect(updated.label).toBe("Label only")
			expect(updated.rpcUrl).toContain("rpc.test/2")
		})

		test("rejects DUPLICATE_ENDPOINT when ANOTHER endpoint of this network uses the URL", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
				"https://rpc.test/2": nodeInfoForChain(50),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			const ep = await service.addEndpoint(network.id, "Backup", "https://rpc.test/2")
			await expect(service.updateEndpoint(network.id, ep.id, "Steal", "https://rpc.test/1")).rejects.toThrow(/DUPLICATE_ENDPOINT/)
		})

		test("rejects on an invalid endpoint id", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			await expect(service.updateEndpoint(network.id, "nope", "X", "https://rpc.test/1")).rejects.toThrow(/Invalid endpoint id/)
		})

		test("rejects ENDPOINT_CHAIN_MISMATCH when the new URL probes a different chain", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
				"https://rpc.other": nodeInfoForChain(99),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			await expect(service.updateEndpoint(network.id, network.primaryEndpointId, "Wrong", "https://rpc.other")).rejects.toThrow(
				/ENDPOINT_CHAIN_MISMATCH/,
			)
		})

		test("evicts the transient-node cache for the OLD url unconditionally", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
				"https://rpc.test/2": nodeInfoForChain(50),
				"https://rpc.test/3": nodeInfoForChain(50),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			const ep = await service.addEndpoint(network.id, "Backup", "https://rpc.test/2")
			// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
			const transients = (service as any).transientNodes as Map<string, unknown>
			const oldUrl = ep.rpcUrl
			transients.set(oldUrl, { node: {}, failures: 0 })

			await service.updateEndpoint(network.id, ep.id, "Moved", "https://rpc.test/3")

			expect(transients.has(oldUrl)).toBe(false)
		})

		test("evicts the chain node cache ONLY when the edited endpoint is the primary", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
				"https://rpc.test/2": nodeInfoForChain(50),
				"https://rpc.test/3": nodeInfoForChain(50),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			const ep = await service.addEndpoint(network.id, "Backup", "https://rpc.test/2")
			await service.getNode(50)
			// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
			const nodes = (service as any).nodes as Map<number, unknown>
			expect(nodes.has(50)).toBe(true)

			// Non-primary edit: chain node cache retained.
			await service.updateEndpoint(network.id, ep.id, "Moved", "https://rpc.test/3")
			expect(nodes.has(50)).toBe(true)

			// Primary edit: chain node cache evicted.
			await service.updateEndpoint(network.id, network.primaryEndpointId, "Primary moved", "https://rpc.test/2")
			expect(nodes.has(50)).toBe(false)
		})

		test("evictions happen BEFORE onNetworkUpdated fires (subscribers observe post-eviction caches)", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
				"https://rpc.test/2": nodeInfoForChain(50),
				"https://rpc.test/3": nodeInfoForChain(50),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			const ep = await service.addEndpoint(network.id, "Backup", "https://rpc.test/2")
			// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
			const transients = (service as any).transientNodes as Map<string, unknown>
			transients.set(ep.rpcUrl, { node: {}, failures: 0 })

			let transientAtEmit: boolean | undefined
			service.onNetworkUpdated.add(() => {
				transientAtEmit = transients.has(ep.rpcUrl)
				return Promise.resolve()
			})

			await service.updateEndpoint(network.id, ep.id, "Moved", "https://rpc.test/3")

			expect(transientAtEmit).toBe(false)
		})

		test("guard precedence: unknown endpoint id + wrong-chain URL throws CHAIN_MISMATCH, not invalid id", async () => {
			// The chain-mismatch guard runs BEFORE the endpoint-id lookup; a shared
			// pipeline that hoists idx-resolution would flip this precedence.
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(50),
				"https://rpc.other": nodeInfoForChain(99),
			})
			const network = await service.addNetwork("Chain50", "https://rpc.test/1")
			await expect(service.updateEndpoint(network.id, "nope", "X", "https://rpc.other")).rejects.toThrow(/ENDPOINT_CHAIN_MISMATCH/)
		})
	})

	describe("setPrimaryEndpoint", () => {
		test("updates primary, emits event, evicts AztecNode cache for that chainId", async () => {
			const { service, factory } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(7),
				"https://rpc.test/2": nodeInfoForChain(7),
			})
			const network = await service.addNetwork("X", "https://rpc.test/1")
			const ep2 = await service.addEndpoint(network.id, "B", "https://rpc.test/2")

			// Prime the AztecNode cache via getNode().
			await service.getNode(7)
			// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
			expect(((service as any).nodes as Map<number, unknown>).has(7)).toBe(true)
			const before = factory.created.length

			const events: { networkId: string; endpointId: string }[] = []
			service.onPrimaryEndpointChanged.add((evt) => {
				events.push(evt)
				return Promise.resolve()
			})

			await service.setPrimaryEndpoint(network.id, ep2.id)

			// Cache evicted.
			// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
			expect(((service as any).nodes as Map<number, unknown>).has(7)).toBe(false)
			// Event fired.
			expect(events).toEqual([{ networkId: network.id, endpointId: ep2.id }])
			// Next getNode creates a fresh node bound to the new URL.
			await service.getNode(7)
			expect(factory.created.length).toBeGreaterThan(before)
		})

		test("no-op when endpointId already primary (no event)", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
			})
			const network = await service.addNetwork("X", "https://rpc.test/1")
			const events: unknown[] = []
			service.onPrimaryEndpointChanged.add((evt) => {
				events.push(evt)
				return Promise.resolve()
			})
			await service.setPrimaryEndpoint(network.id, network.primaryEndpointId)
			expect(events).toHaveLength(0)
		})
	})

	describe("deleteEndpoint", () => {
		test("rejects PRIMARY_ENDPOINT", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
				"https://rpc.test/2": nodeInfoForChain(1),
			})
			const network = await service.addNetwork("X", "https://rpc.test/1")
			await service.addEndpoint(network.id, "B", "https://rpc.test/2")
			await expect(service.deleteEndpoint(network.id, network.primaryEndpointId)).rejects.toThrow(/PRIMARY_ENDPOINT/)
		})

		test("rejects LAST_ENDPOINT when only one endpoint exists", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
			})
			const network = await service.addNetwork("X", "https://rpc.test/1")
			await expect(service.deleteEndpoint(network.id, network.primaryEndpointId)).rejects.toThrow(/LAST_ENDPOINT/)
		})

		test("removes a non-primary endpoint and emits onNetworkUpdated", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
				"https://rpc.test/2": nodeInfoForChain(1),
			})
			const network = await service.addNetwork("X", "https://rpc.test/1")
			const ep = await service.addEndpoint(network.id, "B", "https://rpc.test/2")
			const updates: Network[] = []
			service.onNetworkUpdated.add((n) => {
				updates.push(n)
				return Promise.resolve()
			})
			const removed: NetworkEndpoint = await service.deleteEndpoint(network.id, ep.id)
			expect(removed.id).toBe(ep.id)
			const after = await service.getNetwork(network.id)
			expect(after.endpoints).toHaveLength(1)
			expect(updates).toHaveLength(1)
		})
	})

	describe("setActiveNetwork", () => {
		test("does NOT mutate primaryEndpointId; emits onActiveNetworkChanged", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
				"https://rpc.test/2": nodeInfoForChain(2),
			})
			const a = await service.addNetwork("A", "https://rpc.test/1")
			const b = await service.addNetwork("B", "https://rpc.test/2")
			const events: Network[] = []
			service.onActiveNetworkChanged.add((n) => {
				events.push(n)
				return Promise.resolve()
			})
			await service.setActiveNetwork(b.id)
			const re = await service.getNetwork(b.id)
			expect(re.primaryEndpointId).toBe(b.primaryEndpointId)
			expect(events).toHaveLength(1)
			expect(events[0]!.id).toBe(b.id)
			// Ensure A's primary still untouched too.
			const reA = await service.getNetwork(a.id)
			expect(reA.primaryEndpointId).toBe(a.primaryEndpointId)
		})
	})

	describe("getActiveNetwork", () => {
		test("returns null before any setActiveNetwork", async () => {
			const { service } = setupServiceWithStorage({})
			const result = await service.getActiveNetwork()
			expect(result).toBeNull()
		})

		test("returns the most recently activated network", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
			})
			const network = await service.addNetwork("A", "https://rpc.test/1")
			await service.setActiveNetwork(network.id)
			const got = await service.getActiveNetwork()
			expect(got?.id).toBe(network.id)
		})
	})

	describe("getPrimaryNetwork", () => {
		test("returns the network matching the primary (isPrimaryActive) seed's chainId, regardless of insertion order", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/other": nodeInfoForChain(999_999),
				"https://rpc.test/testnet": nodeInfoForChain(CHAIN_IDS.TESTNET),
			})
			await service.addNetwork("Other", "https://rpc.test/other")
			const testnet = await service.addNetwork("Testnet", "https://rpc.test/testnet")
			const primary = await service.getPrimaryNetwork()
			expect(primary?.id).toBe(testnet.id)
			expect(primary?.chainId).toBe(CHAIN_IDS.TESTNET)
		})

		test("returns null when the primary network is absent (e.g. the user deleted the Testnet)", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/other": nodeInfoForChain(999_999),
			})
			await service.addNetwork("Other", "https://rpc.test/other")
			expect(await service.getPrimaryNetwork()).toBeNull()
		})
	})

	describe("setActiveForProfile (item 1b — restore active selection before finalizeRestore)", () => {
		// The harness's profileService returns profile "p1"; addNetwork stamps rows with p1.
		test("writes the active pointer for a profile-owned network without an active session", async () => {
			const { service } = setupServiceWithStorage({ "https://rpc.test/1": nodeInfoForChain(1) })
			const net = await service.addNetwork("A", "https://rpc.test/1")
			const written = await service.setActiveForProfile("p1", net.id)
			expect(written).toBe(net.id)
			expect((await service.getActiveNetwork())?.id).toBe(net.id)
		})

		test("rejects a hostile/unowned networkId (requireOwnedRow)", async () => {
			const { service } = setupServiceWithStorage({ "https://rpc.test/1": nodeInfoForChain(1) })
			const net = await service.addNetwork("A", "https://rpc.test/1")
			// A network owned by p1, but a DIFFERENT profileId → rejected.
			await expect(service.setActiveForProfile("someone-else", net.id)).rejects.toThrow()
			// A networkId that doesn't exist at all → rejected.
			await expect(service.setActiveForProfile("p1", "no-such-network")).rejects.toThrow()
		})
	})

	describe("deleteNetwork", () => {
		test("rejects ACTIVE_NETWORK when target is the current active id", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
			})
			const network = await service.addNetwork("X", "https://rpc.test/1")
			await service.setActiveNetwork(network.id)
			await expect(service.deleteNetwork(network.id)).rejects.toThrow(/ACTIVE_NETWORK/)
		})

		test("calls purgeChain (subscribers + PXE) before deleting the row", async () => {
			const { service, pxeStub } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
				"https://rpc.test/2": nodeInfoForChain(2),
			})
			const a = await service.addNetwork("A", "https://rpc.test/1")
			const b = await service.addNetwork("B", "https://rpc.test/2")
			// Make B active so we can delete A.
			await service.setActiveNetwork(b.id)
			const subscriberCalls: Array<[string, number, string]> = []
			service.registerChainPurgeSubscriber(async (profileId, chainId, networkId) => {
				subscriberCalls.push([profileId, chainId, networkId])
			})
			const deleted: Network[] = []
			service.onNetworkDeleted.add((n) => {
				deleted.push(n)
				return Promise.resolve()
			})

			await service.deleteNetwork(a.id)

			expect(subscriberCalls).toEqual([["p1", a.chainId, a.id]])
			expect(pxeStub).toHaveBeenCalledWith("p1", a.chainId)
			expect(deleted.map((n) => n.id)).toEqual([a.id])
			// Row really gone.
			await expect(service.getNetwork(a.id)).rejects.toThrow(/Invalid id/)
		})
	})
})

describe("NetworkService default seeding", () => {
	test("seeds Testnet and Local Network only; the dRPC endpoint carries the 'dRPC' label", async () => {
		// Settings renders `endpoint.label || endpoint.rpcUrl` as the row title — the label is what
		// keeps the raw provider URL out of the UI. Local Network is not dRPC-backed, so no label.
		const { service } = setupServiceWithStorage({})
		const networks = await service.getOrInitNetworks()
		const byName = new Map(networks.map((n) => [n.name, n]))
		expect([...byName.keys()].sort()).toEqual(["Local Network", "Testnet"])
		expect(byName.get("Testnet")?.endpoints[0]?.label).toBe("dRPC")
		expect(byName.get("Local Network")?.endpoints[0]?.label).toBeUndefined()
	})
})

describe("NetworkService.servesChain (a dApp asking to connect)", () => {
	const V5_TESTNET_CHAIN = 1816023401

	test("a profile not seeded yet serves exactly the chains its default seeds will create", async () => {
		const { service } = setupServiceWithStorage({})

		expect(await service.servesChain("p1", CHAIN_IDS.TESTNET)).toBe(true)
		expect(await service.servesChain("p1", 0)).toBe(true)
		expect(await service.servesChain("p1", V5_TESTNET_CHAIN)).toBe(false)
	})

	test("while the first activation writes the defaults one by one, every default counts", async () => {
		const { service, local } = setupServiceWithStorage({})
		const set = local.set.bind(local)
		let releaseWrite: (() => void) | undefined
		local.set = async (items) => {
			if (!releaseWrite && JSON.stringify(items).includes("Local Network")) {
				await new Promise<void>((resolve) => {
					releaseWrite = resolve
				})
			}
			return set(items)
		}

		const seeding = service.getOrInitNetworks()
		await vi.waitFor(() => expect(releaseWrite).toBeDefined())

		expect((await service.getNetworksRaw("p1")).map((n) => n.chainId)).toEqual([CHAIN_IDS.TESTNET])
		expect(await service.servesChain("p1", 0)).toBe(true)
		expect(await service.servesChain("p1", V5_TESTNET_CHAIN)).toBe(false)
		releaseWrite?.()
		await seeding
		expect(await service.servesChain("p1", 0)).toBe(true)
	})

	test("a seeded profile serves only its live rows: not a removed network, nor one mid-deletion", async () => {
		const { service } = setupServiceWithStorage({ "https://rpc.test/7": nodeInfoForChain(7) })
		const local = (await service.getOrInitNetworks()).find((n) => n.chainId === 0)!
		const seven = await service.addNetwork("Seven", "https://rpc.test/7")
		let releasePurge: (() => void) | undefined
		service.registerChainPurgeSubscriber(
			(_profileId, chainId) =>
				new Promise<void>((resolve) => {
					if (chainId === 7) releasePurge = resolve
					else resolve()
				}),
		)

		await service.deleteNetwork(local.id)
		const deleting = service.deleteNetwork(seven.id)
		await vi.waitFor(() => expect(releasePurge).toBeDefined())

		expect(await service.servesChain("p1", 0)).toBe(false)
		expect(await service.servesChain("p1", 7)).toBe(false)
		expect(await service.servesChain("p1", CHAIN_IDS.TESTNET)).toBe(true)
		expect(await service.servesChain("p1", V5_TESTNET_CHAIN)).toBe(false)
		releasePurge?.()
		await deleting
	})
})

describe("NetworkService.onProfileDeleted cascade", () => {
	test("purges every chain of the deleted profile (covers sender cleanup via PXE clear)", async () => {
		// This test locks the cascade ContactService.onProfileDeleted's docstring
		// references: when a profile is deleted, every network of that profile
		// gets purgeChain → pxeServiceClient.clearChainState, which wipes the
		// PXE IndexedDB (`pxe/${profileId}/${chainId}`) including its sender list.
		// So senders for deleted profiles are cleaned up here, not in
		// ContactService. If this contract ever changes, the orphan-senders
		// bug returns and ContactService needs its own cleanup path.
		const { service, pxeStub } = setupServiceWithStorage({
			"https://rpc.test/a": nodeInfoForChain(42),
			"https://rpc.test/b": nodeInfoForChain(99),
		})
		const a = await service.addNetwork("A", "https://rpc.test/a")
		const b = await service.addNetwork("B", "https://rpc.test/b")
		expect(a.profileId).toBe("p1")
		expect(b.profileId).toBe("p1")

		// Fire the private cascade handler directly (the EventHandler wiring is
		// stubbed in the harness; we assert the handler's behavior in isolation).
		await service.purgeForProfile("p1")

		expect(pxeStub).toHaveBeenCalledWith("p1", 42)
		expect(pxeStub).toHaveBeenCalledWith("p1", 99)
		expect(pxeStub).toHaveBeenCalledTimes(2)
	})

	test("only purges chains owned by the deleted profile, not other profiles' chains", async () => {
		const { service, pxeStub, local } = setupServiceWithStorage({
			"https://rpc.test/a": nodeInfoForChain(42),
		})
		// p1's network created via the public API
		await service.addNetwork("A", "https://rpc.test/a")

		// Manually inject a network owned by p2 directly into storage so we can
		// assert it's NOT purged when p1 is deleted. (addNetwork would block on
		// the profileService stub which only returns p1.)
		const p2Network = {
			id: "n-p2",
			profileId: "p2",
			chainId: 7,
			name: "P2",
			kind: "custom" as const,
			primaryEndpointId: "ep-p2",
			endpoints: [{ id: "ep-p2", rpcUrl: "https://rpc.test/c" }],
		}
		local.store.set("nulo:core:networks@n-p2", JSON.stringify(p2Network))

		await service.purgeForProfile("p1")

		expect(pxeStub).toHaveBeenCalledWith("p1", 42)
		expect(pxeStub).not.toHaveBeenCalledWith("p2", 7)
	})
})

describe("NetworkService.probeNodeStatus (bounded probe)", () => {
	test("Active when the probe answers the row's chainId", async () => {
		const { service } = setupServiceWithStorage({ "https://rpc.example.com": nodeInfoForChain(7) })
		const network = await service.addNetwork("Seven", "https://rpc.example.com")
		expect(await service.probeNodeStatus(network.id, 5_000)).toBe(NodeStatus.Active)
	})

	test("InvalidChain when the endpoint answers for a different chain", async () => {
		const { service, factory } = setupServiceWithStorage({ "https://rpc.example.com": nodeInfoForChain(7) })
		const network = await service.addNetwork("Seven", "https://rpc.example.com")
		factory.setOverrides("https://rpc.example.com", {
			getNodeInfo: vi.fn().mockResolvedValue(nodeInfoForChain(9)) as unknown as AztecNode["getNodeInfo"],
		})
		expect(await service.probeNodeStatus(network.id, 5_000)).toBe(NodeStatus.InvalidChain)
	})

	test("Inactive when the probe throws (refused / timed out)", async () => {
		const { service, factory } = setupServiceWithStorage({ "https://rpc.example.com": nodeInfoForChain(7) })
		const network = await service.addNetwork("Seven", "https://rpc.example.com")
		factory.setOverrides("https://rpc.example.com", {
			getNodeInfo: vi
				.fn()
				.mockRejectedValue(
					new Error("Request to https://rpc.example.com timed out after 5000ms"),
				) as unknown as AztecNode["getNodeInfo"],
		})
		expect(await service.probeNodeStatus(network.id, 5_000)).toBe(NodeStatus.Inactive)
	})

	test("rejects an out-of-range timeout at the schema boundary", async () => {
		const { service } = setupServiceWithStorage({ "https://rpc.example.com": nodeInfoForChain(7) })
		const network = await service.addNetwork("Seven", "https://rpc.example.com")
		await expect(service.probeNodeStatus(network.id, 999_999)).rejects.toThrow()
		await expect(service.probeNodeStatus(network.id, 1)).rejects.toThrow()
	})
})

describe("NetworkService.readPublicStorageOnce", () => {
	test("reads at the passed row's primary endpoint, never another network's or the active profile's row for that chain", async () => {
		const { service, factory } = setupServiceWithStorage({})
		const chainOf: Record<string, number> = {
			"https://a.example": 7,
			"https://a2.example": 7,
			"https://b.example": 9,
			"https://p2.example": 7,
		}
		const storageAt = new Map<string, ReturnType<typeof vi.fn>>()
		for (const [i, [url, chainId]] of Object.entries(chainOf).entries()) {
			const read = vi.fn(async () => new Fr(BigInt(100 + i)))
			storageAt.set(url, read)
			factory.setOverrides(url, {
				getNodeInfo: vi.fn().mockResolvedValue(nodeInfoForChain(chainId)) as unknown as AztecNode["getNodeInfo"],
				getPublicStorageAt: read as unknown as AztecNode["getPublicStorageAt"],
			})
		}
		const a = await service.addNetwork("A", "https://a.example")
		const second = await service.addEndpoint(a.id, "Two", "https://a2.example")
		const row = await service.setPrimaryEndpoint(a.id, second.id)
		await service.addNetwork("B", "https://b.example")
		// Another profile's row on the same chain: the active profile's own row for chain 7 is `row`.
		const foreign: Network = {
			...row,
			id: "net-p2",
			profileId: "p2",
			endpoints: [{ id: "ep-p2", rpcUrl: "https://p2.example" }],
			primaryEndpointId: "ep-p2",
		}
		const once = vi.spyOn(factory, "readPublicStorageOnce")
		const contract = AztecAddress.fromNumberUnsafe(5)
		const slot = new Fr(9n)

		expect((await service.readPublicStorageOnce(row, contract, slot, 5_000)).toBigInt()).toBe(101n)
		expect((await service.readPublicStorageOnce(foreign, contract, slot, 5_000)).toBigInt()).toBe(103n)

		expect(once.mock.calls).toEqual([
			["https://a2.example", contract, slot, 5_000],
			["https://p2.example", contract, slot, 5_000],
		])
		expect(storageAt.get("https://a2.example")).toHaveBeenCalledWith("latest", contract, slot)
		expect(storageAt.get("https://a.example")).not.toHaveBeenCalled()
		expect(storageAt.get("https://b.example")).not.toHaveBeenCalled()
	})
})

describe("NetworkService lock configuration", () => {
	test("the service lock's watchdog is DISABLED — deleteNetwork's 30-min clearChainState drain is a by-design hold", () => {
		const logger = new LoggerStore(new ConfigStore())
		const service = new NetworkService(logger, new FakeBrowserApi())
		// A force-release mid-cascade would admit a concurrent network mutator
		// into the purge pipeline; queueing behind it is the correct semantic.
		const lock = (service as unknown as { lock: { maxHoldMs: number | null } }).lock
		expect(lock.maxHoldMs).toBeNull()
	})
})

describe("NetworkService — resolveVerifiedL1ChainId unattended", () => {
	function makeService(getNodeInfo: ReturnType<typeof vi.fn>) {
		const factory = new FakeNodeFactory()
		factory.setOverrides("https://rpc-a.example/", { getNodeInfo: getNodeInfo as unknown as AztecNode["getNodeInfo"] })
		const browserApi = new FakeBrowserApi()
		browserApi.reset()
		const service = new NetworkService(new LoggerStore(new ConfigStore()), browserApi, factory)
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in (no full lifecycle needed)
		;(service as any).initialized = true
		return { service, browserApi }
	}
	const row = (kind: string, l1ChainId: number) => ({
		id: "n1",
		profileId: "p1",
		chainId: 123,
		l1ChainId,
		name: "A",
		primaryEndpointId: "e1",
		endpoints: [{ id: "e1", rpcUrl: "https://rpc-a.example/" }],
		kind,
	})

	test("a custom row is refused with ERR_UNATTENDED_LIVE_CHECK and the node is never contacted", async () => {
		const getNodeInfo = vi.fn().mockResolvedValue({ l1ChainId: 5, rollupVersion: 1 })
		const { service, browserApi } = makeService(getNodeInfo)
		await browserApi.storage.local.set({ "nulo:core:networks@n1": JSON.stringify(row("custom", 5)) })
		await expect(service.resolveVerifiedL1ChainId("p1", 123, { unattended: true })).rejects.toThrow(ERR_UNATTENDED_LIVE_CHECK)
		expect(getNodeInfo).not.toHaveBeenCalled()
	})

	test("a seeded row resolves offline under unattended exactly as attended", async () => {
		const getNodeInfo = vi.fn()
		const { service, browserApi } = makeService(getNodeInfo)
		await browserApi.storage.local.set({ "nulo:core:networks@n1": JSON.stringify(row("local", LOCAL_L1_CHAIN_ID)) })
		await expect(service.resolveVerifiedL1ChainId("p1", 123, { unattended: true })).resolves.toBe(LOCAL_L1_CHAIN_ID)
		expect(getNodeInfo).not.toHaveBeenCalled()
	})
})

const NON_SEED_LOCAL_URL = "http://localhost:18080"

function storeRow(local: FakeStorageArea, over: Partial<Network> & { id: string }): Network {
	const row: Network = {
		profileId: "p1",
		chainId: 0,
		l1ChainId: 0,
		name: over.id,
		primaryEndpointId: "e1",
		endpoints: [{ id: "e1", rpcUrl: NON_SEED_LOCAL_URL }],
		kind: "custom",
		...over,
	}
	local.store.set(`nulo:core:networks@${row.id}`, JSON.stringify(row))
	return row
}

/** Both status methods on one network: which transport each used, and what each answered. */
async function bothStatuses(service: NetworkService, factory: FakeNodeFactory, networkId: string) {
	const probe = vi.spyOn(factory, "probeChainId")
	const createdBefore = factory.created.length
	const get = await service.getNodeStatus(networkId)
	const getUsedProbe = probe.mock.calls.length > 0
	const getCreated = factory.created.length - createdBefore
	const probed = await service.probeNodeStatus(networkId, 5_000)
	return { get, probed, getUsedProbe, getCreated, probeCalls: probe.mock.calls }
}

describe("NetworkService node status: getNodeStatus and probeNodeStatus", () => {
	test("a matching endpoint is Active on both; getNodeStatus builds a node, probeNodeStatus probes once with its budget", async () => {
		const { service, factory } = setupServiceWithStorage({ "https://rpc.example.com": nodeInfoForChain(7) })
		const network = await service.addNetwork("Seven", "https://rpc.example.com")
		const r = await bothStatuses(service, factory, network.id)
		expect(r).toMatchObject({ get: NodeStatus.Active, probed: NodeStatus.Active, getUsedProbe: false, getCreated: 1 })
		expect(r.probeCalls).toEqual([["https://rpc.example.com", 5_000]])
	})

	test("an endpoint answering for another chain is InvalidChain on both", async () => {
		const { service, factory } = setupServiceWithStorage({ "https://rpc.example.com": nodeInfoForChain(7) })
		const network = await service.addNetwork("Seven", "https://rpc.example.com")
		factory.setOverrides("https://rpc.example.com", {
			getNodeInfo: vi.fn().mockResolvedValue(nodeInfoForChain(9)) as unknown as AztecNode["getNodeInfo"],
		})
		const r = await bothStatuses(service, factory, network.id)
		expect([r.get, r.probed]).toEqual([NodeStatus.InvalidChain, NodeStatus.InvalidChain])
	})

	test("an unreachable endpoint is Inactive on both", async () => {
		const { service, factory } = setupServiceWithStorage({ "https://rpc.example.com": nodeInfoForChain(7) })
		const network = await service.addNetwork("Seven", "https://rpc.example.com")
		factory.setOverrides("https://rpc.example.com", {
			getNodeInfo: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as AztecNode["getNodeInfo"],
		})
		const r = await bothStatuses(service, factory, network.id)
		expect([r.get, r.probed]).toEqual([NodeStatus.Inactive, NodeStatus.Inactive])
	})

	test("(BUG PIN) a local-kind network on a non-seed URL: getNodeStatus ignores the kind and reads InvalidChain", async () => {
		// getNodeStatus passes no kind hint, so only the seeded-URL carve-out applies there;
		// probeNodeStatus applies the kind too. Aligning them changes a visible status and what a
		// backup captures (account-state's node-status gate), which is an owner call.
		const { service, factory, local } = setupServiceWithStorage({ [NON_SEED_LOCAL_URL]: nodeInfoForChain(42) })
		storeRow(local, { id: "loc", kind: "local" })
		const r = await bothStatuses(service, factory, "loc")
		expect([r.get, r.probed]).toEqual([NodeStatus.InvalidChain, NodeStatus.Active])
	})

	test("a local-kind network whose node is down is Inactive on both: the carve-out never runs before the probe", async () => {
		const { service, factory, local } = setupServiceWithStorage({ [NON_SEED_LOCAL_URL]: new Error("ECONNREFUSED") })
		storeRow(local, { id: "loc", kind: "local" })
		const r = await bothStatuses(service, factory, "loc")
		expect([r.get, r.probed]).toEqual([NodeStatus.Inactive, NodeStatus.Inactive])
	})

	test("a custom network on the seeded local URL takes the URL carve-out on both", async () => {
		const { service, factory, local } = setupServiceWithStorage({ [LOCAL_NETWORK_RPC_URL]: nodeInfoForChain(42) })
		storeRow(local, { id: "seedurl", endpoints: [{ id: "e1", rpcUrl: LOCAL_NETWORK_RPC_URL }] })
		const r = await bothStatuses(service, factory, "seedurl")
		expect([r.get, r.probed]).toEqual([NodeStatus.Active, NodeStatus.Active])
	})

	test("a dangling primaryEndpointId is Inactive on both, with no node built and no probe", async () => {
		const { service, factory, local } = setupServiceWithStorage({ [NON_SEED_LOCAL_URL]: nodeInfoForChain(0) })
		storeRow(local, { id: "dang", primaryEndpointId: "gone" })
		const r = await bothStatuses(service, factory, "dang")
		expect(r).toMatchObject({ get: NodeStatus.Inactive, probed: NodeStatus.Inactive, getCreated: 0 })
		expect(r.probeCalls).toEqual([])
		expect(factory.created).toHaveLength(0)
	})
})

describe("NetworkService endpoint identity guard (add and update)", () => {
	const COMPOSITE = "ENDPOINT_CHAIN_MISMATCH: This RPC reports chainId 99, but this network is chain 50."
	const L1 = "ENDPOINT_CHAIN_MISMATCH: This RPC reports L1 chain 2, but this network is L1 chain 0."
	const BOTH = "ENDPOINT_CHAIN_MISMATCH: This RPC reports chainId 0, but this network is chain 50."
	const ROWS: [string, NodeInfo, string][] = [
		["a different composite", nodeInfoForChain(99), COMPOSITE],
		["the same composite from another L1", { l1ChainId: 2, rollupVersion: 48 }, L1],
		["both different: the composite is checked first", { l1ChainId: 3, rollupVersion: 3 }, BOTH],
	]

	test.each(ROWS)("addEndpoint refuses %s", async (_name, info, message) => {
		const { service } = setupServiceWithStorage({ "https://rpc.test/1": nodeInfoForChain(50), "https://rpc.other": info })
		const network = await service.addNetwork("Chain50", "https://rpc.test/1")
		await expect(service.addEndpoint(network.id, "X", "https://rpc.other")).rejects.toThrow(new Error(message))
	})

	test.each(ROWS)("updateEndpoint refuses %s", async (_name, info, message) => {
		const { service } = setupServiceWithStorage({ "https://rpc.test/1": nodeInfoForChain(50), "https://rpc.other": info })
		const network = await service.addNetwork("Chain50", "https://rpc.test/1")
		await expect(service.updateEndpoint(network.id, network.primaryEndpointId, "X", "https://rpc.other")).rejects.toThrow(
			new Error(message),
		)
	})
})

describe("NetworkService endpoint labels", () => {
	const LABELS: [string | undefined, string | undefined][] = [
		["  x  ", "x"],
		["   ", undefined],
		[undefined, undefined],
	]

	test.each(LABELS)("addEndpoint and updateEndpoint store %j as %j", async (label, stored) => {
		const { service } = setupServiceWithStorage({
			"https://rpc.test/1": nodeInfoForChain(50),
			"https://rpc.test/2": nodeInfoForChain(50),
			"https://rpc.test/3": nodeInfoForChain(50),
		})
		const network = await service.addNetwork("Chain50", "https://rpc.test/1")
		const added = await service.addEndpoint(network.id, label, "https://rpc.test/2")
		expect(added.label).toBe(stored)
		const updated = await service.updateEndpoint(network.id, added.id, label, "https://rpc.test/3")
		expect(updated.label).toBe(stored)
	})
})

describe("NetworkService missing-primary policies", () => {
	test("getNetworkInfo projects the primary endpoint", async () => {
		const { service } = setupServiceWithStorage({ "https://rpc.example.com": nodeInfoForChain(7) })
		const network = await service.addNetwork("Seven", "https://rpc.example.com")
		await expect(service.getNetworkInfo(network.id)).resolves.toEqual({
			profileId: "p1",
			chainId: 7,
			rpcUrl: "https://rpc.example.com",
		})
	})

	test("getNetworkInfo rejects a dangling primaryEndpointId", async () => {
		const { service, local } = setupServiceWithStorage({})
		storeRow(local, { id: "dang", primaryEndpointId: "gone" })
		await expect(service.getNetworkInfo("dang")).rejects.toThrow(new Error("Network dang has no primary endpoint"))
	})

	test("getNode rejects a dangling primaryEndpointId, building no node", async () => {
		const { service, factory, local } = setupServiceWithStorage({})
		storeRow(local, { id: "dang", chainId: 77, primaryEndpointId: "gone" })
		await expect(service.getNode(77)).rejects.toThrow(new Error("Network dang has no primary endpoint"))
		expect(factory.created).toHaveLength(0)
	})

	test("setActiveNetwork on a dangling primaryEndpointId still activates and emits, caching no node", async () => {
		const { service, factory, local } = setupServiceWithStorage({})
		storeRow(local, { id: "dang", chainId: 77, primaryEndpointId: "gone" })
		const events: string[] = []
		service.onActiveNetworkChanged.add((n) => {
			events.push(n.id)
			return Promise.resolve()
		})
		await expect(service.setActiveNetwork("dang")).resolves.toMatchObject({ id: "dang" })
		expect(events).toEqual(["dang"])
		expect(factory.created).toHaveLength(0)
		expect((await service.getActiveNetwork())?.id).toBe("dang")
	})

	test("resolveVerifiedL1ChainId on a custom network with a dangling primary probes the first endpoint", async () => {
		const { service, factory, local } = setupServiceWithStorage({
			"https://first.example": { l1ChainId: 5, rollupVersion: 1 },
			"https://second.example": { l1ChainId: 9, rollupVersion: 1 },
		})
		storeRow(local, {
			id: "c",
			chainId: 123,
			l1ChainId: 5,
			primaryEndpointId: "gone",
			endpoints: [
				{ id: "e1", rpcUrl: "https://first.example" },
				{ id: "e2", rpcUrl: "https://second.example" },
			],
		})
		await expect(service.resolveVerifiedL1ChainId("p1", 123)).resolves.toBe(5)
		expect(factory.created.map((c) => c.rpcUrl)).toEqual(["https://first.example"])
	})
})
