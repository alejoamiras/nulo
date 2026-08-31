/**
 * Pins the token→balance purge cascade: when a token is deleted,
 * `TokenBalanceService.onTokenDeleted` must remove every token-balance row for
 * that token (and emit a delete per row) while leaving other tokens' balances
 * untouched. This is the load-bearing data-integrity hop reached transitively
 * by `NetworkService.purgeChain` → `TokenService.clearChainState` →
 * `onTokenDeleted`; the network coordinator and the `purgeRows` helper are
 * tested elsewhere, but this final hop (a plain loop, not a purgeRows site) had
 * no direct coverage — a broken version would orphan balances from a
 * deleted/purged token. Exercises the REAL handler + REAL BalanceRepository
 * over an in-memory chrome.storage shim (the established repo-test pattern).
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ACCOUNT_SERVICE_NAME } from "@/wallet/services/account/spec"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { EXECUTION_SERVICE_NAME } from "@/wallet/services/execution/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { TASK_SERVICE_NAME } from "@/wallet/services/task/spec"
import { TOKEN_SERVICE_NAME } from "@/wallet/services/token/spec"
import { TRANSACTION_SERVICE_NAME } from "@/wallet/services/transaction/spec"
import { svc } from "../composition-harness"
import { BalanceRepository } from "./balance-repository"
import { TokenBalanceService } from "./service"
import type { TokenBalanceRaw } from "./spec"

const balance = (id: number, token: number, overrides: Partial<TokenBalanceRaw> = {}): TokenBalanceRaw => ({
	id,
	token,
	account: "0xaccount",
	profileId: "A",
	chainId: 1,
	contract: `0xtok${token}`,
	privateBalance: "0",
	publicBalance: "0",
	updatedAt: 0,
	...overrides,
})

// The deletion payload carries the FULL identity (id, profileId, chainId,
// contract) — the handler's delete filter is identity-exact, so the fixture
// must align with `balance()`'s stamps.
const tokenInfo = (id: number) =>
	({ id, profileId: "A", chainId: 1, name: `T${id}`, symbol: `T${id}`, decimals: 18, contract: `0xtok${id}` }) as never

describe("TokenBalanceService.requestBalanceRefresh — missing-pair contract (codex R1 High #4)", () => {
	test("an absent (token, account) balance pair returns {missing:true} (NOT a throw)", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api)
		// Empty repo → no balance row for the pair. The old contract THREW here; the drain could not
		// distinguish that from a transient storage failure and would discard the durable outbox row.
		const result = await service.requestBalanceRefresh(999, "0xnobody")
		expect(result).toEqual({ missing: true })
	})
})

describe("TokenBalanceService.onTokenDeleted purge cascade", () => {
	let service: TokenBalanceService
	let seedRepo: BalanceRepository
	let api: FakeBrowserApi

	beforeEach(() => {
		// One FakeBrowserApi shared by the service's internal repo and the test's
		// seedRepo (same fixed storage key) so the test can seed + assert without
		// reaching into privates.
		api = new FakeBrowserApi()
		api.reset()
		seedRepo = new BalanceRepository(api)
		service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api)
	})

	const invokeDelete = (id: number) =>
		(service as unknown as { onTokenDeleted: (t: ReturnType<typeof tokenInfo>) => Promise<void> }).onTokenDeleted(tokenInfo(id))

	test("removes every balance row for the deleted token, leaves other tokens' rows", async () => {
		await seedRepo.set(balance(1, 1))
		await seedRepo.set(balance(2, 1))
		await seedRepo.set(balance(3, 2))

		await invokeDelete(1)

		const remaining = await seedRepo.getAll()
		expect(remaining.map((b) => b.id).sort()).toEqual([3])
		expect(remaining.every((b) => b.token !== 1)).toBe(true)
	})

	test("emits onTokenBalanceDeleted once per purged row", async () => {
		await seedRepo.set(balance(1, 1))
		await seedRepo.set(balance(2, 1))
		await seedRepo.set(balance(3, 2))

		const emit = vi.spyOn(service as unknown as { emit: (e: string, p: unknown) => void }, "emit")
		await invokeDelete(1)

		const deletes = emit.mock.calls.filter(([e]) => e === "onTokenBalanceDeleted")
		expect(deletes).toHaveLength(2)
	})

	test("deleting a token with no balances is a no-op", async () => {
		await seedRepo.set(balance(3, 2))

		await invokeDelete(1)

		expect((await seedRepo.getAll()).map((b) => b.id)).toEqual([3])
	})

	test("a successor's rows at a RE-MINTED token id survive the departed token's handler (identity filter)", async () => {
		// Numeric token ids are max+1-reallocatable: after A→B, B can re-mint
		// this very id for a DIFFERENT token. The delete filter is identity-exact
		// (profileId + chainId + contract, not just the id), so the departed
		// handler must delete only its own rows and leave the successor's.
		await seedRepo.set(balance(1, 1))
		await seedRepo.set(balance(2, 1, { profileId: "B", contract: "0xreminted" }))

		await invokeDelete(1)

		const remaining = await seedRepo.getAll()
		expect(remaining.map((b) => b.id)).toEqual([2])
		expect(remaining[0].profileId).toBe("B")
	})
})

describe("TokenBalanceService.purgeForTokens — F-B23 raw second pass, profile scoping", () => {
	function bareWorld() {
		const api = new FakeBrowserApi()
		api.reset()
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api)
		// purgeForTokens gates on ensureInitialized; init() wires the projector +
		// event subs, none of which the storage purge touches — flip the flag
		// instead of stubbing seven services for one purge pin.
		;(service as unknown as { initialized: boolean }).initialized = true
		return { api, service, seedRepo: new BalanceRepository(api) }
	}

	test("removes a malformed balance row for a purged token; spares another token's and an unattributable one", async () => {
		const { api, service, seedRepo } = bareWorld()
		await seedRepo.set(balance(1, 5))
		await api.storage.local.set({
			"nulo:core:token-balances@97": JSON.stringify({ token: 5, junk: true }),
			"nulo:core:token-balances@98": JSON.stringify({ token: 5, profileId: "A", junk: true }),
			"nulo:core:token-balances@99": JSON.stringify({ token: 6, profileId: "A", junk: true }),
		})

		await service.purgeForTokens([5], "A")

		const raw = await api.storage.local.get(null)
		// No profileId → unattributable → fail-closed debris, never purge-reachable.
		expect(raw["nulo:core:token-balances@97"]).toBeDefined()
		expect(raw["nulo:core:token-balances@98"]).toBeUndefined()
		expect(raw["nulo:core:token-balances@99"]).toBeDefined()
		expect(await seedRepo.getAll()).toEqual([])
	})

	test("a resumed deletion purging a REUSED token id spares the successor profile's row and live-map entry", async () => {
		const { service, seedRepo } = bareWorld()
		// Profile A died mid-deletion holding token id 5 in its tombstone; profile B
		// later reused id 5. The resume must erase only A's leftovers.
		await seedRepo.set(balance(1, 5))
		await seedRepo.set(balance(2, 5, { profileId: "B", contract: "0xtokB" }))
		const successor = { id: 5, profileId: "B", chainId: 1, contract: "0xtokB", name: "B", symbol: "B", decimals: 18 }
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to the private map
		;(service as any).tokens.set(5, successor)

		await service.purgeForTokens([5], "A")

		expect((await seedRepo.getAll()).map((r) => r.id)).toEqual([2])
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to the private map
		expect(((service as any).tokens as Map<number, unknown>).get(5)).toBe(successor)
	})
})

describe("TokenBalanceService.restore — hostile-row validation (P1)", () => {
	let service: TokenBalanceService
	let seedRepo: BalanceRepository
	let deletionState: ProfileDeletionState
	let rawApi: FakeBrowserApi

	beforeEach(async () => {
		const api = new FakeBrowserApi()
		api.reset()
		rawApi = api
		deletionState = new ProfileDeletionState()
		seedRepo = new BalanceRepository(api)
		// restore() gates on ensureInitialized(), so run the real lifecycle over
		// stub peers. A no-op ticker keeps the balance queue from scheduling a real
		// interval (no open handle / background poll in the unit run).
		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged: new EventHandler(),
				getActiveProfile: async () => undefined,
				getDeletionState: () => deletionState,
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded: new EventHandler(),
				getAccountsRaw: async () => [],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded: new EventHandler(),
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				// restore() derives identity from the profile's OWN token table — the
				// explicit-profileId read, not the (empty pre-activation) active map.
				getTokensRaw: async (profileId: string) =>
					profileId === "p1"
						? ([
								{ id: 1, profileId: "p1", chainId: 1, contract: "0xtok1" },
								{ id: 2, profileId: "p1", chainId: 1, contract: "0xtok2" },
							] as never[])
						: [],
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, {}))
		service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start()
	})

	test("fenced-id incarnation guard: allocation SKIPS ids fenced this lifetime, so a reused id can neither eat a stale write nor stay suppressed", async () => {
		// Simulate: row 5 (the allocator's NEXT id — max existing is 4) was
		// deleted this lifetime and fenced while its old projection is still in
		// flight. A same-lifetime restore must skip PAST it (the ABA/suppression
		// hole: a reused id could eat a stale write or stay suppressed forever).
		await seedRepo.set(balance(4, 1))
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to the private fence
		;(service as any).invalidatedBalanceIds.add(5)

		const [restored] = await service.restore([balance(999, 1)], "p1")
		expect(restored.restoreError).toBeUndefined()
		expect(restored.id).toBe(6) // allocator's 5 was fenced → skipped
		// The new row's own projections are NOT suppressed by the fence.
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to the private fence
		expect(((service as any).invalidatedBalanceIds as Set<number>).has(restored.id)).toBe(false)
	})

	test("records a schema-invalid row as restoreError and never writes it", async () => {
		// account must be a string; a hostile backup row with a non-string account
		// would pass EntityStorage's write but be codec-hidden on read (invisible to
		// a later getValues() cleanup). restore() must parse-reject it up front.
		const bad = { id: 5, token: 1, account: 123, updatedAt: 0 } as unknown as TokenBalanceRaw

		const [restored] = await service.restore([bad], "p1")

		expect(restored.restoreError).toBeTruthy()
		expect(await seedRepo.getAll()).toEqual([])
	})

	test("writes a valid row under a freshly allocated id (input id is ignored)", async () => {
		const [restored] = await service.restore([balance(999, 1)], "p1")

		expect(restored.restoreError).toBeUndefined()
		const all = await seedRepo.getAll()
		expect(all).toHaveLength(1)
		expect(all[0].token).toBe(1)
	})

	test("a malformed row does not abort the batch — the valid sibling still lands", async () => {
		const bad = { id: 5, token: 1, account: 123, updatedAt: 0 } as unknown as TokenBalanceRaw

		const restored = await service.restore([bad, balance(7, 2)], "p1")

		expect(restored[0].restoreError).toBeTruthy()
		expect(restored[1].restoreError).toBeUndefined()
		expect((await seedRepo.getAll()).map((b) => b.token)).toEqual([2])
	})

	test("(N-14) a deleteProfile beginning DURING the restore rejects every later row write", async () => {
		const origSet = rawApi.storage.local.set.bind(rawApi.storage.local)
		let fired = false
		rawApi.storage.local.set = async (items: Record<string, unknown>) => {
			await origSet(items)
			if (!fired) {
				fired = true
				deletionState.beginDeletion("p1")
			}
		}
		const restored = await service.restore([balance(1, 1), balance(2, 2)], "p1")
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toMatch(/deleted/)
		expect((await seedRepo.getAll()).map((b) => b.token)).toEqual([1])
	})

	test("(N-14) fails closed when the created-profile id is missing", async () => {
		await expect(service.restore([balance(1, 1)], undefined as never)).rejects.toThrow(/profile id/)
		expect(await seedRepo.getAll()).toEqual([])
	})

	test("blob-claimed identity fields are overwritten from the profile's own token table", async () => {
		const forged = { ...balance(1, 1), profileId: "evil", chainId: 999, contract: "0xevil" }
		const [restored] = await service.restore([forged], "p1")
		expect(restored.restoreError).toBeUndefined()
		const [row] = await seedRepo.getAll()
		expect(row.profileId).toBe("p1")
		expect(row.chainId).toBe(1)
		expect(row.contract).toBe("0xtok1")
	})

	test("a row referencing a token the profile does not own is rejected, not written", async () => {
		const [restored] = await service.restore([balance(1, 3)], "p1")
		expect(restored.restoreError).toMatch(/does not own/)
		expect(await seedRepo.getAll()).toEqual([])
	})

	test("duplicate (token, account) pairs collapse — the registry only dedupes row ids", async () => {
		const restored = await service.restore([balance(1, 1), balance(2, 1)], "p1")
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toMatch(/duplicate balance pair/)
		expect(await seedRepo.getAll()).toHaveLength(1)
	})
})

describe("TokenBalanceService.onActiveProfileChanged — token-map rebuild generation fence (B-05)", () => {
	const tokenRaw = (id: number, profileId: string) =>
		({ id, profileId, chainId: 1, name: `T${id}`, symbol: `T${id}`, decimals: 18, contract: `0xtok${id}` }) as never

	test("(B-05 PIN) a slow rebuild for a switched-away profile never repopulates the active map", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		const seedRepo = new BalanceRepository(api)
		// Two profiles, one token each; a balance row per token so getTokenBalances
		// (which filters by the in-memory active-token map) can observe the map.
		await seedRepo.set(balance(1, 100)) // profile A's token
		await seedRepo.set(balance(2, 200, { profileId: "B" })) // profile B's token

		// A's raw-token fetch is slow (resolves LAST); B's is immediate. The bug: A's
		// late rebuild sets its token into the map that now belongs to active profile B.
		let resolveA!: (v: unknown) => void
		const getTokensRaw = vi.fn().mockImplementation((profileId?: string) => {
			if (profileId === "A") return new Promise((r) => (resolveA = r))
			if (profileId === "B") return Promise.resolve([tokenRaw(200, "B")])
			return Promise.resolve([])
		})

		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged: new EventHandler(),
				getActiveProfile: async () => undefined,
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded: new EventHandler(),
				getAccountsRaw: async () => [],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded: new EventHandler(),
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw,
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, {}))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start() // active profile undefined → empty map

		const handler = (service as unknown as { onActiveProfileChanged: (p?: { id: string; name: string }) => Promise<void> })
			.onActiveProfileChanged

		const switchA = handler({ id: "A", name: "A" }) // suspends on the slow getTokensRaw(A)
		const switchB = handler({ id: "B", name: "B" }) // resolves immediately → commits {200}
		await switchB
		resolveA([tokenRaw(100, "A")]) // A's stale rebuild resolves after the switch away
		await switchA

		// Active profile is B; the map must hold B's token ONLY — A's late rebuild is fenced out.
		const visible = (await service.getTokenBalances()).map((b) => b.token.id).sort((x, y) => x - y)
		expect(visible).toEqual([200])
	})

	test("(B-05 tail PIN) onTokenAdded aborts after a mid-fan-out profile switch — no cross-context balance persisted", async () => {
		const flush = () => new Promise((r) => setTimeout(r, 0))
		const api = new FakeBrowserApi()
		api.reset()

		// The account fan-out parks here so a switch can land mid-flight.
		let resolveAccounts!: (v: unknown) => void
		const getAccounts = vi.fn().mockImplementation(() => new Promise((r) => (resolveAccounts = r)))
		const onTokenAdded = new EventHandler<never>()
		const onActiveProfileChanged = new EventHandler<never>()

		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged,
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded: new EventHandler(),
				getAccounts,
				getAccountsRaw: async () => [],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded,
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw: async () => [],
				getTokenRaw: async () => tokenRaw(100, "A"),
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask: () => ({ id: "t1" }) }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start() // active profile A, empty token map

		const setSpy = vi.spyOn((service as never as { repo: { set: (...a: unknown[]) => Promise<void> } }).repo, "set")

		// A token is added under A; its account fan-out parks on getAccounts.
		void onTokenAdded.invoke(tokenRaw(100, "A"))
		await flush()
		expect(getAccounts).toHaveBeenCalled()

		// The user switches profile mid-fan-out — bumps the generation.
		void onActiveProfileChanged.invoke({ id: "B", name: "B" } as never)
		await flush()

		// Release the accounts; onTokenAdded resumes and must bail on the generation
		// check before persisting any balance for the now-departed context.
		resolveAccounts([{ address: "0xa", chainId: 1 }])
		await flush()

		expect(setSpy).not.toHaveBeenCalled()
	})

	test("(B-05 createTokenBalance PIN) a switch DURING the balance write skips the emit/enqueue for the departed context", async () => {
		const flush = () => new Promise((r) => setTimeout(r, 0))
		const api = new FakeBrowserApi()
		api.reset()

		const onTokenAdded = new EventHandler<never>()
		const onActiveProfileChanged = new EventHandler<never>()
		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged,
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded: new EventHandler(),
				getAccounts: async () => [{ address: "0xa", chainId: 1 }],
				getAccountsRaw: async () => [],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded,
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw: async () => [],
				getTokenRaw: async () => tokenRaw(100, "A"),
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask: () => ({ id: "t1" }) }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start()

		// Park inside the id ALLOCATION (before repo.set) so a switch lands past the
		// loop-level fence but inside createTokenBalance's own await window.
		let resolveAlloc!: (id: number) => void
		vi.spyOn(
			(service as never as { repo: { allocateIdAvoiding: (avoid: ReadonlySet<number>) => Promise<number> } }).repo,
			"allocateIdAvoiding",
		).mockImplementation(() => new Promise((r) => (resolveAlloc = r as never)))
		const setSpy = vi.spyOn((service as never as { repo: { set: (b: unknown) => Promise<void> } }).repo, "set")

		void onTokenAdded.invoke(tokenRaw(100, "A"))
		await flush() // reaches createTokenBalance, parks in allocateId

		void onActiveProfileChanged.invoke({ id: "B", name: "B" } as never)
		await flush()
		resolveAlloc(5)
		await flush()

		// The context departed mid-allocation: the write must be skipped entirely.
		expect(setSpy).not.toHaveBeenCalled()
	})

	test("boot sweep creates the row a worker death left missing, and re-queues one it never projected", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		const seedRepo = new BalanceRepository(api)
		// Token 100 has no row at all (died before repo.set); token 200 has a row
		// stuck at updatedAt 0 (died before enqueue — the card spins forever).
		await seedRepo.set({
			id: 7,
			token: 200,
			account: "0xa",
			profileId: "A",
			chainId: 1,
			contract: "0xtok200",
			publicBalance: "0",
			privateBalance: "0",
			updatedAt: 0,
		})

		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged: new EventHandler(),
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded: new EventHandler(),
				getAccountsRaw: async () => [{ address: "0xa", chainId: 1, index: 0, profileId: "A" }],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded: new EventHandler(),
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw: async () => [tokenRaw(100, "A"), tokenRaw(200, "A")],
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask: () => ({ id: "t1" }) }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start()

		const rows = await new BalanceRepository(api).getAll()
		// One row per (token, account) — the missing one created, the stale one
		// left in place rather than duplicated.
		expect(rows).toHaveLength(2)
		expect(new Set(rows.map((r) => r.token))).toEqual(new Set([100, 200]))
		expect(rows.find((r) => r.token === 200)?.id).toBe(7)
	})

	test("boot sweep writes NOTHING when every desired row already exists", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		const seedRepo = new BalanceRepository(api)
		await seedRepo.set({
			id: 1,
			token: 100,
			account: "0xa",
			profileId: "A",
			chainId: 1,
			contract: "0xtok100",
			publicBalance: "0",
			privateBalance: "0",
			updatedAt: 123,
		})

		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged: new EventHandler(),
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded: new EventHandler(),
				getAccountsRaw: async () => [{ address: "0xa", chainId: 1, index: 0, profileId: "A" }],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded: new EventHandler(),
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw: async () => [tokenRaw(100, "A")],
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask: () => ({ id: "t1" }) }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)

		// The steady state is what runs on EVERY service-worker wake, so it must
		// cost zero writes.
		const setSpy = vi.spyOn(BalanceRepository.prototype, "set")
		try {
			await services.start()
			expect(setSpy).not.toHaveBeenCalled()
		} finally {
			setSpy.mockRestore()
		}
	})

	test("a key/id mismatched row is hidden and replaced; its physical bytes survive", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		// A valid-shaped row stored under the WRONG key. Served by getAll() before
		// the numeric identity guard, it would suppress repair for that pair.
		await api.storage.local.set({
			"nulo:core:token-balances@99": JSON.stringify({
				id: 1,
				token: 100,
				account: "0xa",
				publicBalance: "0",
				privateBalance: "0",
				updatedAt: 5,
			}),
		})

		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged: new EventHandler(),
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded: new EventHandler(),
				getAccountsRaw: async () => [{ address: "0xa", chainId: 1, index: 0, profileId: "A" }],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded: new EventHandler(),
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw: async () => [tokenRaw(100, "A")],
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask: () => ({ id: "t1" }) }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start()

		// Exactly one VISIBLE canonical row, freshly created and unresolved.
		const visible = await new BalanceRepository(api).getAll()
		expect(visible).toHaveLength(1)
		expect(visible[0].updatedAt).toBe(0)
		expect(String(visible[0].id)).not.toBe("99")
		// The mismatched bytes are retained, not overwritten.
		const raw = await api.storage.local.get("nulo:core:token-balances@99")
		expect(raw["nulo:core:token-balances@99"]).toBeDefined()
	})

	test("a well-formed row at its own key stays visible under the identity guard", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		const repo = new BalanceRepository(api)
		await repo.set({
			id: 1,
			token: 100,
			account: "0xa",
			profileId: "A",
			chainId: 1,
			contract: "0xtok100",
			publicBalance: "0",
			privateBalance: "0",
			updatedAt: 9,
		})
		expect(await repo.getAll()).toHaveLength(1)
	})

	test("two creators racing the SAME pair produce exactly one row", async () => {
		// The lock serializes allocation, but that alone does not stop two holders
		// from each creating the same (token, account): the existence check has to
		// happen inside the same hold as the write. A sweep can be parked on its
		// read while a handler queues for the lock, then both create the pair.
		const flush = () => new Promise((r) => setTimeout(r, 0))
		const api = new FakeBrowserApi()
		api.reset()

		const onTokenAdded = new EventHandler<never>()
		const onAccountAdded = new EventHandler<never>()
		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged: new EventHandler(),
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded,
				getAccounts: async () => [{ address: "0xa", chainId: 1 }],
				// Empty for the boot sweep so the pair does NOT exist when the two
				// handlers race — otherwise both take the already-present skip path
				// and the race window is never entered.
				getAccountsRaw: async () => [],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded,
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw: async () => [tokenRaw(100, "A")],
				getTokenRaw: async () => tokenRaw(100, "A"),
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask: () => ({ id: "t1" }) }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start()

		const repo = service as never as {
			repo: { allocateIdAvoiding: (a: ReadonlySet<number>) => Promise<number> }
		}
		const real = repo.repo.allocateIdAvoiding.bind(repo.repo)
		const allocSpy = vi.spyOn(repo.repo, "allocateIdAvoiding").mockImplementation(async (avoid) => {
			const id = await real(avoid)
			await flush()
			return id
		})

		// Both handlers target token 100 on account 0xa — the SAME pair.
		void onAccountAdded.invoke({ address: "0xa", chainId: 1 } as never)
		void onTokenAdded.invoke(tokenRaw(100, "A") as never)
		for (let i = 0; i < 40; i++) await flush()

		const rows = await new BalanceRepository(api).getAll()
		expect(rows.filter((r) => r.token === 100 && r.account === "0xa")).toHaveLength(1)
		// Exactly one allocation: the second holder must observe the first's write,
		// which only holds if the existence check runs inside the same hold.
		expect(allocSpy).toHaveBeenCalledTimes(1)
	})

	test("a creation parked mid-write cannot survive a token deletion", async () => {
		// Deletion queues behind an in-flight creation, so its snapshot includes
		// and sweeps the completed write.
		const flush = () => new Promise((r) => setTimeout(r, 0))
		const api = new FakeBrowserApi()
		api.reset()

		const onAccountAdded = new EventHandler<never>()
		const onTokenDeleted = new EventHandler<never>()
		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged: new EventHandler(),
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded,
				getAccountsRaw: async () => [],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded: new EventHandler(),
				onTokenUpdated: new EventHandler(),
				onTokenDeleted,
				getTokensRaw: async () => [tokenRaw(100, "A")],
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask: () => ({ id: "t1" }) }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start()

		// Park the creation inside its physical write, then delete the token.
		const repo = service as never as { repo: { set: (b: unknown) => Promise<void> } }
		let releaseWrite!: () => void
		const realSet = repo.repo.set.bind(repo.repo)
		vi.spyOn(repo.repo, "set").mockImplementationOnce(async (b) => {
			await new Promise<void>((r) => (releaseWrite = r))
			return realSet(b)
		})

		void onAccountAdded.invoke({ address: "0xa", chainId: 1 } as never)
		await flush()
		void onTokenDeleted.invoke(tokenRaw(100, "A") as never)
		await flush()
		releaseWrite()
		for (let i = 0; i < 40; i++) await flush()

		// The deletion is serialized behind the creation, so it sweeps the row the
		// creation just wrote — nothing for the deleted token survives.
		const rows = await new BalanceRepository(api).getAll()
		expect(rows.filter((r) => r.token === 100)).toHaveLength(0)
	})

	test("(init fence) a switch while init's token read is parked cannot repopulate the old profile", async () => {
		const flush = () => new Promise((r) => setTimeout(r, 0))
		const api = new FakeBrowserApi()
		api.reset()

		const onActiveProfileChanged = new EventHandler<never>()
		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		let releaseInitRead!: (rows: unknown[]) => void
		let initReadSeen = false
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged,
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded: new EventHandler(),
				getAccountsRaw: async () => [],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded: new EventHandler(),
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw: async (profileId: string) => {
					// Park ONLY init's read (profile A, first call).
					if (!initReadSeen && profileId === "A") {
						initReadSeen = true
						return new Promise((r) => (releaseInitRead = r as never))
					}
					return []
				},
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask: () => ({ id: "t1" }) }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)

		const starting = services.start()
		await flush()
		// Subscriptions are live before init finishes awaiting, so the switch lands
		// mid-init and bumps the generation.
		void onActiveProfileChanged.invoke({ id: "B", name: "B" } as never)
		await flush()
		releaseInitRead([tokenRaw(100, "A")])
		await starting
		for (let i = 0; i < 20; i++) await flush()

		// A's token must not be in the map after the switch to B.
		const balances = service as never as { tokens: Map<number, unknown> }
		expect(balances.tokens.has(100)).toBe(false)
	})

	test("a never-projected row is re-queued at start, not just left alone", async () => {
		// A row that exists but was never projected must be queued for projection
		// at start; row-count assertions alone cannot observe that.
		const api = new FakeBrowserApi()
		api.reset()
		await new BalanceRepository(api).set({
			id: 7,
			token: 100,
			account: "0xa",
			profileId: "A",
			chainId: 1,
			contract: "0xtok100",
			publicBalance: "0",
			privateBalance: "0",
			updatedAt: 0,
		})

		const createNewTask = vi.fn(() => ({ id: "t1" }))
		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged: new EventHandler(),
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded: new EventHandler(),
				getAccountsRaw: async () => [{ address: "0xa", chainId: 1, index: 0, profileId: "A" }],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded: new EventHandler(),
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw: async () => [tokenRaw(100, "A")],
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start()

		// The queue mints one TaskService record per enqueued row, so the task
		// call is the observable proof the stale row was re-queued.
		expect(createNewTask).toHaveBeenCalled()
	})

	test("two concurrent creators never collide on an id — the allocator is serialized", async () => {
		// `allocateIdAvoiding` is max+1 over the live key space, and event
		// subscribers dispatch un-awaited, so an account-added and a token-added
		// handler can interleave. Unserialized they read the same pre-write key
		// space, compute the same id, and the later repo.set silently overwrites
		// the earlier row — a balance disappears with no onTokenBalanceDeleted.
		const flush = () => new Promise((r) => setTimeout(r, 0))
		const api = new FakeBrowserApi()
		api.reset()

		const onTokenAdded = new EventHandler<never>()
		const onAccountAdded = new EventHandler<never>()
		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged: new EventHandler(),
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded,
				getAccounts: async () => [{ address: "0xa", chainId: 1 }],
				getAccountsRaw: async () => [],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded,
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				// Token 100 is already mapped, so the account-added path has work.
				getTokensRaw: async () => [tokenRaw(100, "A")],
				getTokenRaw: async () => tokenRaw(200, "A"),
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask: () => ({ id: "t1" }) }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start()

		const repo = service as never as {
			repo: { allocateIdAvoiding: (a: ReadonlySet<number>) => Promise<number>; set: (b: { id: number }) => Promise<void> }
		}
		// Every allocation resolves on the NEXT tick, so an unserialized second
		// caller has a window to read the same key space before the first writes.
		const real = repo.repo.allocateIdAvoiding.bind(repo.repo)
		vi.spyOn(repo.repo, "allocateIdAvoiding").mockImplementation(async (avoid) => {
			const id = await real(avoid)
			await flush()
			return id
		})
		const written: number[] = []
		const realSet = repo.repo.set.bind(repo.repo)
		vi.spyOn(repo.repo, "set").mockImplementation(async (b) => {
			written.push(b.id)
			return realSet(b)
		})

		// Both creators in flight at once, the way independent RPCs produce them.
		// `invoke` dispatches un-awaited (that is the property under test), so the
		// handlers are drained by flushing rather than by awaiting the invokes.
		void onAccountAdded.invoke({ address: "0xb", chainId: 1 } as never)
		void onTokenAdded.invoke(tokenRaw(200, "A") as never)
		for (let i = 0; i < 40; i++) await flush()

		expect(written).toHaveLength(2)
		expect(new Set(written).size).toBe(2)
		const rows = await new BalanceRepository(api).getAll()
		expect(rows).toHaveLength(2)
		expect(new Set(rows.map((r) => `${r.token}:${r.account}`)).size).toBe(2)
	})
})

describe("TokenBalanceService legacy sweep + schema transition (P1)", () => {
	test("200 legacy rows are swept at init, non-legacy debris survives, the live pair is recreated once, bounded", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		// 200 legacy-shape rows (no identity fields) for ONE live pair, plus two
		// survivors the sweep must NOT touch: a partial-new row (carries profileId —
		// different provenance) and a legacy-shaped row at a mismatched key.
		const seed: Record<string, string> = {}
		for (let i = 1; i <= 200; i++) {
			seed[`nulo:core:token-balances@${i}`] = JSON.stringify({ id: i, token: 100, account: "0xa", updatedAt: 0 })
		}
		seed["nulo:core:token-balances@300"] = JSON.stringify({ id: 300, token: 100, account: "0xa", profileId: "A", updatedAt: 0 })
		seed["nulo:core:token-balances@301"] = JSON.stringify({ id: 999, token: 100, account: "0xa", updatedAt: 0 })
		await api.storage.local.set(seed)

		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged: new EventHandler(),
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded: new EventHandler(),
				getAccountsRaw: async () => [{ address: "0xa", chainId: 1, index: 0, profileId: "A" }],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded: new EventHandler(),
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw: async () => [
					{ id: 100, profileId: "A", chainId: 1, contract: "0xtok100", name: "T", symbol: "T", decimals: 18 } as never,
				],
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask: () => ({ id: "t1" }) }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		const startedAt = Date.now()
		await services.start()
		const elapsed = Date.now() - startedAt

		const raw = await api.storage.local.get(null)
		const balanceKeys = Object.keys(raw).filter((k) => k.startsWith("nulo:core:token-balances@"))
		expect(balanceKeys).toContain("nulo:core:token-balances@300")
		expect(balanceKeys).toContain("nulo:core:token-balances@301")
		for (let i = 1; i <= 200; i++) {
			expect(raw[`nulo:core:token-balances@${i}`]).toBeUndefined()
		}
		const rows = await new BalanceRepository(api).getAll()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ token: 100, account: "0xa", profileId: "A", chainId: 1, contract: "0xtok100" })
		// The whole init (sweep + reconcile + projection enqueue) over a 200-row
		// store must stay interactive.
		expect(elapsed).toBeLessThan(10_000)
	})
})

describe("TokenBalanceService reconcile — identity hardening (P2)", () => {
	// Composition world: real service + repo over seeded rows and stub peers.
	async function startWorld(opts: { rows: TokenBalanceRaw[]; tokens: unknown[] }) {
		const api = new FakeBrowserApi()
		api.reset()
		const seedRepo = new BalanceRepository(api)
		for (const row of opts.rows) await seedRepo.set(row)
		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onActiveProfileChanged: new EventHandler(),
				getActiveProfile: async () => ({ id: "A", name: "A" }),
				getDeletionState: () => new ProfileDeletionState(),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				registerAccountPurgeSubscriber: () => {},
				onAccountAdded: new EventHandler(),
				getAccountsRaw: async () => [{ address: "0xa", chainId: 1, index: 0, profileId: "A" }],
			}),
		)
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded: new EventHandler(),
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw: async () => opts.tokens as never[],
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, { createNewTask: () => ({ id: "t1" }) }))
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start()
		return { api, service, repo: new BalanceRepository(api) }
	}
	const liveToken = { id: 100, profileId: "A", chainId: 1, contract: "0xtok100", name: "T", symbol: "T", decimals: 18 }

	test("a dead incarnation's row at a reused token id is deleted, fenced, and replaced by the canonical pair", async () => {
		const { service, repo } = await startWorld({
			rows: [balance(7, 100, { contract: "0xdeadbeef", updatedAt: 5 })],
			tokens: [liveToken],
		})
		const rows = await repo.getAll()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ token: 100, account: "0xa", contract: "0xtok100" })
		expect(rows[0].id).not.toBe(7)
		// The stale id is fenced: an in-flight projection for it can never write.
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to the private fence
		expect(((service as any).invalidatedBalanceIds as Set<number>).has(7)).toBe(true)
		expect((await service.getTokenBalances()).map((b) => b.id)).toEqual([rows[0].id])
	})

	test("a row whose token id has NO live token is left in place — but never rendered", async () => {
		const { service, repo } = await startWorld({
			rows: [balance(7, 999, { contract: "0xwhatever", updatedAt: 5 })],
			tokens: [liveToken],
		})
		const rows = await repo.getAll()
		// The possibly-codec-hidden-token case: deletion here would destroy
		// recoverable data, so the row survives; identity filtering hides it.
		expect(rows.map((r) => r.id).sort()).toContain(7)
		const visible = await service.getTokenBalances()
		expect(visible.map((b) => b.token.id)).toEqual([100])
	})

	test("shared address across profiles: only the active profile's row renders, the foreign row is untouched", async () => {
		const { service, repo } = await startWorld({
			rows: [
				balance(1, 100, { account: "0xa", updatedAt: 5 }),
				balance(2, 555, { account: "0xa", profileId: "B", contract: "0xtok555", updatedAt: 5 }),
			],
			tokens: [liveToken],
		})
		expect((await service.getTokenBalances()).map((b) => b.id)).toEqual([1])
		expect((await repo.getAll()).map((r) => r.id).sort()).toEqual([1, 2])
	})
})

describe("TokenBalanceService.purgeForAccounts — tuple-scoped account purge (P3)", () => {
	// The purge touches only repo + lock + fence (like purgeForTokens' raw-pass
	// test): flip the init flag instead of stubbing seven services.
	function bareService() {
		const api = new FakeBrowserApi()
		api.reset()
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api)
		;(service as unknown as { initialized: boolean }).initialized = true
		return { api, service, repo: new BalanceRepository(api) }
	}
	const fenced = (service: TokenBalanceService, id: number) =>
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to the private fence
		((service as any).invalidatedBalanceIds as Set<number>).has(id)

	test("spares the sibling profile's rows at the SAME address — bare-address scoping would destroy them", async () => {
		const { service, repo } = bareService()
		await repo.set(balance(1, 100, { account: "0xshared" }))
		await repo.set(balance(2, 200, { account: "0xshared", profileId: "B" }))
		await service.purgeForAccounts([{ chainId: 1, address: "0xshared" }], "A")
		expect((await repo.getAll()).map((r) => r.id)).toEqual([2])
		expect(fenced(service, 1)).toBe(true)
		expect(fenced(service, 2)).toBe(false)
	})

	test("spares the SAME profile's rows on ANOTHER chain — address+profile scoping would destroy them", async () => {
		const { service, repo } = bareService()
		await repo.set(balance(1, 100, { account: "0xaddr" }))
		await repo.set(balance(2, 200, { account: "0xaddr", chainId: 2 }))
		await service.purgeForAccounts([{ chainId: 1, address: "0xaddr" }], "A")
		expect((await repo.getAll()).map((r) => r.id)).toEqual([2])
	})

	test("completes with an EMPTY/foreign active token map — deletes every scoped row, no throw, ids fenced", async () => {
		const { service, repo } = bareService()
		await repo.set(balance(1, 100, { account: "0xa" }))
		await repo.set(balance(2, 300, { account: "0xa" }))
		await service.purgeForAccounts([{ chainId: 1, address: "0xa" }], "A")
		expect(await repo.getAll()).toEqual([])
		expect(fenced(service, 1)).toBe(true)
		expect(fenced(service, 2)).toBe(true)
	})

	test("raw second pass reaps a malformed NEW-SHAPE row in scope; old-shape rows are left to the legacy sweep", async () => {
		const { api, service } = bareService()
		await api.storage.local.set({
			"nulo:core:token-balances@98": JSON.stringify({ profileId: "A", chainId: 1, account: "0xa", junk: true }),
			"nulo:core:token-balances@99": JSON.stringify({ id: 99, token: 5, account: "0xa", updatedAt: 0 }),
		})
		await service.purgeForAccounts([{ chainId: 1, address: "0xa" }], "A")
		const raw = await api.storage.local.get(null)
		expect(raw["nulo:core:token-balances@98"]).toBeUndefined()
		expect(raw["nulo:core:token-balances@99"]).toBeDefined()
	})

	test("a purge racing a parked creation serializes on the shared lock — never a half state", async () => {
		const { service, repo } = bareService()
		const tokenA = { id: 100, profileId: "A", chainId: 1, contract: "0xtok100", name: "T", symbol: "T", decimals: 18 }
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to the private map/lock
		const anyService = service as any
		anyService.tokens.set(100, tokenA)
		await repo.set(balance(1, 100, { account: "0xa" }))
		const purge = service.purgeForAccounts([{ chainId: 1, address: "0xa" }], "A")
		const create = anyService.lock.withLock(() =>
			anyService.ensurePairsHoldingLock([{ token: tokenA, account: { address: "0xa" } }], anyService.profileGeneration),
		)
		await Promise.all([purge, create])
		const rows = await repo.getAll()
		// Either order is valid (purge→recreate leaves one FRESH row; create-noop→purge
		// leaves none). Forbidden: a fenced live row or a duplicate pair.
		expect(rows.length).toBeLessThanOrEqual(1)
		for (const row of rows) {
			expect(row.updatedAt).toBe(0)
			expect(fenced(service, row.id)).toBe(false)
		}
	})
})
