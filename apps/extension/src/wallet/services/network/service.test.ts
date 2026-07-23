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
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { CHAIN_IDS } from "@/utils/chain-ids"
import { LoggerStore } from "@/wallet/logger"
import { ConfigStore } from "@/wallet/config"
import { FakeNodeFactory } from "@/core/testing/fake-node-factory"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import type { ProfileService } from "@/wallet/services/profile/service"
import { NetworkService } from "./service"
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

	// Stub a minimal ProfileService that reports an active profile.
	const fakeProfile = { id: "p1", name: "p1", type: "password" } as const
	const fakeProfileService = {
		getActiveProfile: async () => fakeProfile,
		onActiveProfileChanged: { add: vi.fn(), remove: vi.fn() },
		onProfileDeleted: { add: vi.fn(), remove: vi.fn() },
	} as unknown as ProfileService

	// Reach into the service's protected init via the services map the base
	// class would normally call. Using `as any` access rather than driving
	// the real service bootstrap because we only need the NodeFactory seam
	// tested, not the full lifecycle.
	// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
	;(service as any).profileService = fakeProfileService

	return { service, factory }
}

describe("NetworkService NodeFactory seam", () => {
	test("getChainId returns the XOR of l1ChainId and rollupVersion for non-localhost", async () => {
		const { service, factory } = harness({
			"https://rpc.example/1": { l1ChainId: 11155111, rollupVersion: 4127419662 },
		})
		// Exercise via addNetwork, which calls getChainId internally (line ~280).
		// Note: we sidestep the lock + storage by calling the private method directly.
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		const chainId = await (service as any)._getChainId("https://rpc.example/1")
		expect(chainId).toBe((11155111 ^ 4127419662) >>> 0)
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
			name: "A",
			primaryEndpointId: "epA",
			endpoints: [{ id: "epA", rpcUrl: "https://rpc.a" }],
		})
		await storage.set("netB", {
			id: "netB",
			profileId: "p2",
			chainId: 7,
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
	// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
	;(service as any).profileService = {
		getActiveProfile: async () => fakeProfile,
		onActiveProfileChanged: { add: vi.fn(), remove: vi.fn() },
		onProfileDeleted: { add: vi.fn(), remove: vi.fn() },
	} as unknown as ProfileService
	// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
	;(service as any).pxeServiceClient = { clearChainState: pxeStub }
	// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in (skip init() wait)
	;(service as any).initialized = true

	return { service, factory, local, session, pxeStub }
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
		// Unit builds set no VITE_NULO_E2E_DEFAULT_NET flag → the primary seed is Alpha (MAINNET).
		test("returns the network matching the primary (isPrimaryActive) seed's chainId, regardless of insertion order", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/other": nodeInfoForChain(999_999),
				"https://rpc.test/mainnet": nodeInfoForChain(CHAIN_IDS.MAINNET),
			})
			await service.addNetwork("Other", "https://rpc.test/other")
			const alpha = await service.addNetwork("Alpha V5", "https://rpc.test/mainnet")
			const primary = await service.getPrimaryNetwork()
			expect(primary?.id).toBe(alpha.id)
			expect(primary?.chainId).toBe(CHAIN_IDS.MAINNET)
		})

		test("returns null when the primary network is absent (e.g. user deleted Alpha)", async () => {
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

	describe("backup / restore", () => {
		test("backup returns the current network array", async () => {
			const { service } = setupServiceWithStorage({
				"https://rpc.test/1": nodeInfoForChain(1),
				"https://rpc.test/2": nodeInfoForChain(2),
			})
			await service.addNetwork("A", "https://rpc.test/1")
			await service.addNetwork("B", "https://rpc.test/2")
			const snapshot = await service.backup()
			expect(snapshot).toHaveLength(2)
			for (const n of snapshot) {
				expect(n.endpoints.length).toBeGreaterThan(0)
				expect(typeof n.primaryEndpointId).toBe("string")
			}
		})

		test("restore rejects old-shape entries (no `endpoints` field) with BACKUP_TOO_OLD", async () => {
			const { service } = setupServiceWithStorage({})
			const oldShape = [
				{
					id: "legacy-1",
					profileId: "p1",
					name: "Legacy",
					rpcUrl: "https://legacy.example",
					chainId: 7,
					isDefault: true,
				},
			]
			const result = await service.restore(oldShape)
			expect(result).toHaveLength(1)
			expect(result[0]!.restoreError).toMatch(/BACKUP_TOO_OLD/)
		})

		test("restore accepts new-shape entries", async () => {
			const { service } = setupServiceWithStorage({})
			const newShape: Network[] = [
				{
					id: "n1",
					profileId: "p1",
					chainId: 1,
					name: "Imported",
					primaryEndpointId: "e1",
					endpoints: [{ id: "e1", rpcUrl: "https://rpc.test/1" }],
				},
			]
			const result = await service.restore(newShape)
			expect(result).toHaveLength(1)
			expect(result[0]!.restoreError).toBeUndefined()
			const fetched = await service.getNetwork("n1")
			expect(fetched.name).toBe("Imported")
		})

		test("restore rejects entries with disallowed RPC schemes (A-04)", async () => {
			// Codex post-impl A-04: pre-fix, restore() only ran a shape check
			// and wrote directly to storage. A malicious backup could re-introduce
			// `javascript:`/`data:`/non-loopback `http:` URLs that the adapter
			// would later reject. Now: NetworkSchema runs on each entry.
			const { service } = setupServiceWithStorage({})
			const evil = [
				{
					id: "n1",
					profileId: "p1",
					chainId: 1,
					name: "Phishing",
					primaryEndpointId: "e1",
					endpoints: [{ id: "e1", rpcUrl: "javascript:alert(1)" }],
				},
				{
					id: "n2",
					profileId: "p1",
					chainId: 2,
					name: "Plain HTTP",
					primaryEndpointId: "e1",
					endpoints: [{ id: "e1", rpcUrl: "http://evil.com" }],
				},
			] as Network[]
			const result = await service.restore(evil)
			expect(result).toHaveLength(2)
			expect(result[0]!.restoreError).toBeDefined()
			expect(result[1]!.restoreError).toBeDefined()
		})

		test("restore rejects entries with userinfo URLs (A-04)", async () => {
			// `https://user@evil.com@safe.com` parses to host=safe.com but the
			// userinfo is the visible part of the URL and a known phishing vector.
			const { service } = setupServiceWithStorage({})
			const evil = [
				{
					id: "n1",
					profileId: "p1",
					chainId: 1,
					name: "Userinfo Phish",
					primaryEndpointId: "e1",
					endpoints: [{ id: "e1", rpcUrl: "https://user@evil.com@safe.com" }],
				},
			] as Network[]
			const result = await service.restore(evil)
			expect(result).toHaveLength(1)
			expect(result[0]!.restoreError).toBeDefined()
		})
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
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
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

		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in
		await service.purgeForProfile("p1")

		expect(pxeStub).toHaveBeenCalledWith("p1", 42)
		expect(pxeStub).not.toHaveBeenCalledWith("p2", 7)
	})
})
