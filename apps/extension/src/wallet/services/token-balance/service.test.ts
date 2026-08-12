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

	beforeEach(() => {
		// One FakeBrowserApi shared by the service's internal repo and the test's
		// seedRepo (same fixed storage key) so the test can seed + assert without
		// reaching into privates.
		const api = new FakeBrowserApi()
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
})

describe("TokenBalanceService.restore — hostile-row validation (P1)", () => {
	let service: TokenBalanceService
	let seedRepo: BalanceRepository

	beforeEach(async () => {
		const api = new FakeBrowserApi()
		api.reset()
		seedRepo = new BalanceRepository(api)
		// restore() gates on ensureInitialized(), so run the real lifecycle over
		// stub peers. A no-op ticker keeps the balance queue from scheduling a real
		// interval (no open handle / background poll in the unit run).
		const noopTicker = { subscribe: () => ({ cancel: () => {} }) } as never
		const services = new ServiceCollection()
		services.add(svc(PROFILE_SERVICE_NAME, { onActiveProfileChanged: new EventHandler(), getActiveProfile: async () => undefined }))
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
		// flight. A same-lifetime restore must skip PAST it (codex iteration r2
		// — the ABA/suppression hole).
		await seedRepo.set(balance(4, 1))
		// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to the private fence
		;(service as any).invalidatedBalanceIds.add(5)

		const [restored] = await service.restore([balance(999, 1)])
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

		const [restored] = await service.restore([bad])

		expect(restored.restoreError).toBeTruthy()
		expect(await seedRepo.getAll()).toEqual([])
	})

	test("writes a valid row under a freshly allocated id (input id is ignored)", async () => {
		const [restored] = await service.restore([balance(999, 1)])

		expect(restored.restoreError).toBeUndefined()
		const all = await seedRepo.getAll()
		expect(all).toHaveLength(1)
		expect(all[0].token).toBe(1)
	})

	test("a malformed row does not abort the batch — the valid sibling still lands", async () => {
		const bad = { id: 5, token: 1, account: 123, updatedAt: 0 } as unknown as TokenBalanceRaw

		const restored = await service.restore([bad, balance(7, 2)])

		expect(restored[0].restoreError).toBeTruthy()
		expect(restored[1].restoreError).toBeUndefined()
		expect((await seedRepo.getAll()).map((b) => b.token)).toEqual([2])
	})
})
