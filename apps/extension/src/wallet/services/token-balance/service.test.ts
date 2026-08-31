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
	privateBalance: "0",
	publicBalance: "0",
	updatedAt: 0,
	...overrides,
})

// A token deletion only needs a shape carrying `id` (the filter key) plus the
// fields the projection embeds; the handler is passed the token so
// getTokenBalanceInfo never reaches into the tokens map.
const tokenInfo = (id: number) => ({ id, chainId: 1, name: `T${id}`, symbol: `T${id}`, decimals: 18, contract: `0xtok${id}` }) as never

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

	test("a profile switch mid-purge ABORTS the row deletes and suppresses the UI emits", async () => {
		await seedRepo.set(balance(1, 1))
		await seedRepo.set(balance(2, 1))

		// Bump the generation from inside the handler's first storage read — the
		// switch lands during the parked `getAll`. Numeric token ids are
		// max+1-reallocatable, so `token === 1` rows may already belong to the
		// successor context: the handler must NOT delete them (stranding the
		// departed profile's rows is the safe direction), and must not emit.
		const svc = service as unknown as { profileGeneration: number; emit: (e: string, p: unknown) => void }
		const realGet = api.storage.local.get.bind(api.storage.local)
		let bumped = false
		api.storage.local.get = (async (key: unknown) => {
			const value = await realGet(key as never)
			if (!bumped) {
				bumped = true
				svc.profileGeneration += 1
			}
			return value
		}) as typeof api.storage.local.get
		const emit = vi.spyOn(svc, "emit")

		await invokeDelete(1)

		expect((await seedRepo.getAll()).map((b) => b.id).sort()).toEqual([1, 2])
		expect(emit.mock.calls.filter(([e]) => e === "onTokenBalanceDeleted")).toHaveLength(0)
	})
})

describe("TokenBalanceService.purgeForTokens — F-B23 raw second pass", () => {
	test("removes a malformed balance row for a purged token; spares another token's malformed row", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		const seedRepo = new BalanceRepository(api)
		const service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api)
		// purgeForTokens gates on ensureInitialized; init() wires the projector +
		// event subs, none of which the storage purge touches — flip the flag
		// instead of stubbing seven services for one purge pin.
		;(service as unknown as { initialized: boolean }).initialized = true
		await seedRepo.set(balance(1, 5))
		await api.storage.local.set({
			"nulo:core:token-balances@98": JSON.stringify({ token: 5, junk: true }),
			"nulo:core:token-balances@99": JSON.stringify({ token: 6, junk: true }),
		})

		await service.purgeForTokens([5])

		const raw = await api.storage.local.get(null)
		expect(raw["nulo:core:token-balances@98"]).toBeUndefined()
		expect(raw["nulo:core:token-balances@99"]).toBeDefined()
		expect(await seedRepo.getAll()).toEqual([])
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
		services.add(svc(ACCOUNT_SERVICE_NAME, { onAccountAdded: new EventHandler() }))
		services.add(
			svc(TOKEN_SERVICE_NAME, {
				onTokenAdded: new EventHandler(),
				onTokenUpdated: new EventHandler(),
				onTokenDeleted: new EventHandler(),
				getTokensRaw: async () => [],
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
		await seedRepo.set(balance(2, 200)) // profile B's token

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
		services.add(svc(ACCOUNT_SERVICE_NAME, { onAccountAdded: new EventHandler() }))
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
		services.add(svc(ACCOUNT_SERVICE_NAME, { onAccountAdded: new EventHandler(), getAccounts }))
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
			svc(ACCOUNT_SERVICE_NAME, { onAccountAdded: new EventHandler(), getAccounts: async () => [{ address: "0xa", chainId: 1 }] }),
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
})
