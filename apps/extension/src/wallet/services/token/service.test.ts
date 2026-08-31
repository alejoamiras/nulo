/**
 * Unit pins for `TokenService.addToken`'s journal/lock machinery (F-Q09
 * characterization — this path had no unit coverage; the composition layer
 * excludes it because the real `fetchTokenMetadata` calls `simulate(...)`).
 * The private fetch is stubbed via the repo's established test-only reach-in,
 * which is legitimate HERE (a unit file) but would violate the composition
 * layer's boundary rules — see COMPOSITION-TESTS.md.
 */

import { EventHandler } from "@nulo/wallet-core/utils"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { describe, expect, test, vi } from "vitest"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { AccountService } from "@/wallet/services/account/service"
import { svc } from "@/wallet/services/composition-harness"
import { NetworkService } from "@/wallet/services/network/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { TaskService } from "@/wallet/services/task/service"
import { TokenService } from "./service"
import type { TokenInterface } from "./spec"

const NETWORK = { id: "net1", chainId: 1, primaryEndpointId: "ep1", endpoints: [{ id: "ep1", rpcUrl: "http://fake" }] }

const ti = (contract: string): TokenInterface =>
	({
		chainId: 1,
		contract,
		getNameFn: { name: "get_name", impl: 1 },
		getSymbolFn: { name: "get_symbol", impl: 1 },
		getDecimalsFn: { name: "get_decimals", impl: 1 },
		isComplete: true,
	}) as unknown as TokenInterface

async function makeHarness() {
	const api = new FakeBrowserApi()
	api.reset()
	const deletionState = new ProfileDeletionState()
	const logger = new LoggerStore(new ConfigStore())
	const journal = {
		createOperation: vi.fn(async () => ({ id: "op-1" })),
		transitionOperation: vi.fn(async () => {}),
		setOperationMeta: vi.fn(async () => {}),
	}
	const collection = new ServiceCollection()
	collection.add(
		svc(ProfileService.name, {
			getActiveProfile: async () => ({ id: "p1" }),
			onProfileDeleted: { add: () => {} },
			onActiveProfileChanged: new EventHandler(),
			getDeletionState: () => deletionState,
			captureExecutionFence: async () => ({ profileId: "p1", epoch: deletionState.capture("p1") }),
		}),
	)
	collection.add(
		svc(NetworkService.name, {
			getNetwork: async () => NETWORK,
			registerChainPurgeSubscriber: () => {},
			onActiveNetworkChanged: new EventHandler(),
			isNetworkLive: async () => true,
		}),
	)
	collection.add(svc(AccountService.name, {}))
	collection.add(svc(TaskService.name, {}))
	collection.add(svc(OperationJournalService.name, journal))
	const tokenService = new TokenService(logger, api)
	collection.add(tokenService)
	await collection.start()

	const fetchStub = vi.fn(async (): Promise<[string, string, number]> => ["Fetched Name", "FTCH", 9])
	// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to stub the private simulate-backed fetch
	;(tokenService as any).fetchTokenMetadata = fetchStub
	return { tokenService, journal, fetchStub, api, deletionState }
}

describe("TokenService.addToken — journal/lock machinery (characterization)", () => {
	test("journals the import (dapp origin + subtitle), backfills the title with the fetched symbol, succeeds", async () => {
		const { tokenService, journal } = await makeHarness()
		const emitted: unknown[] = []
		tokenService.onTokenAdded.add((t) => {
			emitted.push(t)
			return Promise.resolve()
		})

		const info = await tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xc0ffee"), {
			origin: "dapp",
			dappOrigin: "https://app.example",
		})

		expect(info.symbol).toBe("FTCH")
		expect(journal.createOperation).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "token_import",
				origin: "dapp",
				title: undefined,
				subtitle: "Requested by https://app.example",
			}),
		)
		expect(journal.setOperationMeta).toHaveBeenCalledWith("op-1", { title: "FTCH" })
		expect(journal.transitionOperation).toHaveBeenLastCalledWith("op-1", { stage: "succeeded" })
		expect(emitted).toHaveLength(1)
	})

	test("idempotency short-circuit: a repeat add returns the existing row and creates NO journal op", async () => {
		const { tokenService, journal, fetchStub } = await makeHarness()
		await tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xc0ffee"), { origin: "popup" })
		journal.createOperation.mockClear()
		fetchStub.mockClear()

		const again = await tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xc0ffee"), { origin: "popup" })

		expect(again.symbol).toBe("FTCH")
		expect(journal.createOperation).not.toHaveBeenCalled()
		expect(fetchStub).not.toHaveBeenCalled()
	})

	test("a failed fetch journals 'failed' and rethrows", async () => {
		const { tokenService, journal, fetchStub } = await makeHarness()
		fetchStub.mockRejectedValueOnce(new Error("metadata boom"))

		await expect(tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xbad"), { origin: "popup" })).rejects.toThrow("metadata boom")

		expect(journal.transitionOperation).toHaveBeenLastCalledWith("op-1", { stage: "failed" }, expect.anything())
	})

	test("the metadata fetch runs INSIDE the token lock — a queued token op waits for a blocked fetch", async () => {
		const { tokenService, fetchStub } = await makeHarness()
		let releaseFetch!: (v: [string, string, number]) => void
		fetchStub.mockReturnValueOnce(new Promise((r) => (releaseFetch = r)))

		const adding = tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xslow"), { origin: "popup" })
		// Give addToken time to enter the lock and block on the fetch.
		await new Promise((r) => setTimeout(r, 20))

		let restored = false
		const restoring = tokenService.restore([]).then((r) => {
			restored = true
			return r
		})
		await new Promise((r) => setTimeout(r, 20))
		expect(restored).toBe(false) // queued behind the lock the fetch holds

		releaseFetch(["Slow", "SLW", 6])
		await adding
		await restoring
		expect(restored).toBe(true)
	})

	test("seeded persistence never backfills a title (no setOperationMeta)", async () => {
		const { tokenService, journal } = await makeHarness()

		await tokenService.addSeededToken({
			profileId: "p1",
			networkId: NETWORK.id,
			accountAddress: "0xacc",
			tokenInterface: ti("0x5eed"),
			name: "Seeded",
			symbol: "SEED",
			decimals: 18,
		})

		expect(journal.createOperation).toHaveBeenCalledWith(
			expect.objectContaining({ origin: "seed", title: "SEED", subtitle: "Default token" }),
		)
		expect(journal.setOperationMeta).not.toHaveBeenCalled()
	})
})

describe("TokenService.restore — per-row allocation (N-20 boundary)", () => {
	test("a hostile MAX_SAFE_INTEGER key is never overwritten — each row re-allocates instead of id++", async () => {
		// A shared `id++` cursor assumed forward-contiguous free space: with a
		// physical key at MAX_SAFE_INTEGER the allocator gap-fills DOWNWARD, and
		// the old increment then stepped onto (and overwrote) the occupied
		// boundary key. Per-row re-allocation always lands on free keys.
		const { tokenService, api } = await makeHarness()
		const max = String(Number.MAX_SAFE_INTEGER)
		const junk = JSON.stringify({ junk: true })
		await api.storage.local.set({ [`nulo:core:tokens@${max}`]: junk })

		const mk = (contract: string) => ({
			id: 0,
			profileId: "p1",
			chainId: 1,
			contract,
			name: "T",
			symbol: "T",
			decimals: 9,
		})
		const restored = await tokenService.restore([mk("0xaaa"), mk("0xbbb")])
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toBeUndefined()
		// Both landed on fresh keys; the hostile key's raw bytes are intact.
		const raw = await api.storage.local.get(null)
		expect(raw[`nulo:core:tokens@${max}`]).toBe(junk)
		expect(restored[0].id).not.toBe(restored[1].id)
	})
})

describe("TokenService.restore — deletion fence (N-14)", () => {
	const mk = (contract: string) => ({ id: 0, profileId: "p1", chainId: 1, contract, name: "T", symbol: "T", decimals: 9 })

	test("a deleteProfile beginning DURING the restore rejects every later row write", async () => {
		const { tokenService, api, deletionState } = await makeHarness()
		const origSet = api.storage.local.set.bind(api.storage.local)
		let fired = false
		api.storage.local.set = async (items: Record<string, unknown>) => {
			await origSet(items)
			if (!fired) {
				fired = true
				deletionState.beginDeletion("p1")
			}
		}
		const restored = await tokenService.restore([mk("0xaaa"), mk("0xbbb")])
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toMatch(/deleted/)
		const raw = await api.storage.local.get(null)
		expect(Object.values(raw).filter((v) => typeof v === "string" && v.includes("0xbbb"))).toHaveLength(0)
	})

	test("positive control: no deletion → both rows land", async () => {
		const { tokenService } = await makeHarness()
		const restored = await tokenService.restore([mk("0xaaa"), mk("0xbbb")])
		expect(restored.every((r) => r.restoreError === undefined)).toBe(true)
	})
})

describe("TokenService.addToken — creation fences", () => {
	function _deferred<T>() {
		let resolve!: (v: T) => void
		const promise = new Promise<T>((res) => {
			resolve = res
		})
		return { promise, resolve }
	}

	async function tokenRowCount(api: { storage: { local: { get: (k: null) => Promise<Record<string, unknown>> } } }): Promise<number> {
		const raw = await api.storage.local.get(null)
		return Object.keys(raw).filter((k) => k.startsWith("nulo:core:tokens@")).length
	}

	test("addToken for a profile that is not the active one fails closed (authority-match pin)", async () => {
		// Token ops are not switch-blocked: a post-approval profile switch must
		// make the write fail rather than land under the wrong profile (F11 —
		// the register_token cross-profile write).
		const { tokenService, api } = await makeHarness()
		await expect(
			tokenService.addToken("other-profile", NETWORK.id, "0xacc", ti("0xdead"), { origin: "dapp", dappOrigin: "https://x" }),
		).rejects.toThrow(/unauthorized/)
		expect(await tokenRowCount(api)).toBe(0)
	})

	test("a THREADED fence from a settled-out authorization is honored, not re-minted (F11 ABA pin)", async () => {
		// The dApp dispatch threads the fence captured at authorization; if the
		// profile is deleted AND the deletion settles (release) before the token
		// write runs, a fresh mint would observe the settled epoch and land the
		// row — only honoring the CALLER's stale capture rejects the ABA. The
		// assert must also beat the idempotent short-circuit, so it fires with
		// ZERO rows present.
		const { tokenService, api, deletionState } = await makeHarness()
		const staleFence = { profileId: "p1", epoch: deletionState.capture("p1") }
		deletionState.beginDeletion("p1")
		deletionState.release("p1")

		await expect(
			tokenService.addTokenAuthorized(staleFence, "p1", NETWORK.id, "0xacc", ti("0xdead"), {
				origin: "dapp",
				dappOrigin: "https://x",
			}),
		).rejects.toThrow(/deleted|not current/i)
		expect(await tokenRowCount(api)).toBe(0)
	})

	test("a stale authorization cannot exit through the idempotent short-circuit either (F11)", async () => {
		// With the row ALREADY present, the fast path would return it as a
		// success for the deleted incarnation's flow — the fence assert must
		// come before every exit, not just the write.
		const { tokenService, deletionState } = await makeHarness()
		await tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xdead"), { origin: "popup" })
		const staleFence = { profileId: "p1", epoch: deletionState.capture("p1") }
		deletionState.beginDeletion("p1")
		deletionState.release("p1")

		await expect(
			tokenService.addTokenAuthorized(staleFence, "p1", NETWORK.id, "0xacc", ti("0xdead"), { origin: "popup" }),
		).rejects.toThrow(/deleted|not current/i)
	})

	test("a deletion completing DURING the metadata fetch rejects the write (entry-capture pin)", async () => {
		// begin + RELEASE while parked: the deletion fully settles, so only a
		// fence captured at the AUTHORIZING entry still rejects — a fence minted
		// at commit would observe the settled epoch and land the orphan row.
		const { tokenService, fetchStub, api, deletionState } = await makeHarness()
		const gate = _deferred<[string, string, number]>()
		fetchStub.mockReturnValueOnce(gate.promise)

		const run = tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xdead"), { origin: "popup" })
		await new Promise((r) => setTimeout(r, 0))
		deletionState.beginDeletion("p1")
		deletionState.release("p1")
		gate.resolve(["Name", "SYM", 9])

		await expect(run).rejects.toThrow(/deleted|not current/i)
		expect(await tokenRowCount(api)).toBe(0)
	})

	test("a chain deleted during the metadata fetch rejects the write (liveness-at-commit pin)", async () => {
		const { tokenService, fetchStub, api } = await makeHarness()
		const gate = _deferred<[string, string, number]>()
		fetchStub.mockReturnValueOnce(gate.promise)
		const networks = (tokenService as unknown as { networks: { isNetworkLive: (id: string) => Promise<boolean> } }).networks

		const run = tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xdead"), { origin: "popup" })
		await new Promise((r) => setTimeout(r, 0))
		networks.isNetworkLive = async () => false
		gate.resolve(["Name", "SYM", 9])

		await expect(run).rejects.toThrow(/network deleted/)
		expect(await tokenRowCount(api)).toBe(0)
	})

	test("a deletion landing DURING the row write is compensated away before any emit", async () => {
		const { tokenService, api, deletionState } = await makeHarness()
		const emitted: unknown[] = []
		tokenService.onTokenAdded.add((t) => emitted.push(t))
		const realSet = api.storage.local.set.bind(api.storage.local)
		let fired = false
		api.storage.local.set = (async (items: Record<string, unknown>) => {
			await realSet(items)
			if (!fired && Object.keys(items).some((k) => k.startsWith("nulo:core:tokens@"))) {
				fired = true
				deletionState.beginDeletion("p1")
			}
		}) as typeof api.storage.local.set

		await expect(tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xbeef"), { origin: "popup" })).rejects.toThrow(/deleted/)
		expect(await tokenRowCount(api)).toBe(0)
		expect(emitted).toHaveLength(0)
	})
})
