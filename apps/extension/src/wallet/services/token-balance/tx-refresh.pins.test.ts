/**
 * Pre-extraction pins for `TokenBalanceService.onTransactionUpdated` — its first
 * direct coverage (the settle → balance-refresh hook was wired as an inert stub in
 * every other suite). Frozen contract: pending is ignored; a UI-origin tx with
 * transfer info narrows to the (party account, called-contract token) rows and
 * NEVER falls through to the broad refresh; a UI tx without transfer info takes
 * exactly ONE broad refresh; a non-UI tx takes the broad refresh; identity
 * (rowMatchesToken) gates every narrowed enqueue.
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
import { OriginType, TRANSACTION_SERVICE_NAME, TxStatus } from "@/wallet/services/transaction/service"
import { svc } from "../composition-harness"
import { BalanceRepository } from "./balance-repository"
import { TokenBalanceService } from "./service"
import type { TokenBalanceRaw } from "./spec"

const A = "0xalice"
const B = "0xbob"
const C = "0xcarol"

const row = (id: number, token: number, account: string, overrides: Partial<TokenBalanceRaw> = {}): TokenBalanceRaw => ({
	id,
	token,
	account,
	profileId: "A",
	chainId: 1,
	contract: `0xtok${token}`,
	privateBalance: "0",
	publicBalance: "0",
	updatedAt: 0,
	...overrides,
})

const token = (id: number) =>
	({ id, profileId: "A", chainId: 1, name: `T${id}`, symbol: `T${id}`, decimals: 18, contract: `0xtok${id}` }) as never

type Call = { contract?: string; transfers?: Array<{ from: string; to: string }> }
const tx = (origin: OriginType, account: string, calls: Call[], status: TxStatus = TxStatus.Finalized) =>
	({ status, origin: { type: origin }, account, calls }) as never

// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to privates
type Priv = any

describe("onTransactionUpdated pins", () => {
	let service: TokenBalanceService
	let seedRepo: BalanceRepository
	let enqueue: ReturnType<typeof vi.fn>
	let broad: ReturnType<typeof vi.spyOn>

	beforeEach(async () => {
		const api = new FakeBrowserApi()
		api.reset()
		seedRepo = new BalanceRepository(api)
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
				getTokensRaw: async () => [],
			}),
		)
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TASK_SERVICE_NAME, {}))
		service = new TokenBalanceService(new LoggerStore(new ConfigStore()), api, noopTicker)
		services.add(service)
		await services.start()

		// Identity map the handler consults; rows seeded against it.
		;(service as Priv).tokens.set(1, token(1))
		;(service as Priv).tokens.set(2, token(2))
		await seedRepo.set(row(1, 1, A))
		await seedRepo.set(row(2, 1, C))
		await seedRepo.set(row(3, 2, A))
		await seedRepo.set(row(4, 1, B))
		enqueue = vi.fn()
		;(service as Priv).queue.enqueue = enqueue
		broad = vi.spyOn(service, "refreshAccountBalances")
	})

	const fire = (t: unknown) => (service as Priv).onTransactionUpdated(t) as Promise<void>
	const enqueuedIds = () => enqueue.mock.calls.map(([b]) => (b as TokenBalanceRaw).id).sort()

	test("a pending tx is ignored — no narrowed enqueue, no broad refresh", async () => {
		await fire(tx(OriginType.UI, A, [{ contract: "0xtok1", transfers: [{ from: A, to: B }] }], TxStatus.Pending))
		expect(enqueue).not.toHaveBeenCalled()
		expect(broad).not.toHaveBeenCalled()
	})

	test("UI tx with transfer info narrows to (party account × called-contract token) rows and never refreshes broadly", async () => {
		await fire(tx(OriginType.UI, A, [{ contract: "0xtok1", transfers: [{ from: A, to: B }] }]))
		// Row 2 (tok1 but non-party C) and row 3 (party A but tok2 not called) are excluded.
		expect(enqueuedIds()).toEqual([1, 4])
		expect(broad).not.toHaveBeenCalled()
	})

	test("UI tx without transfer info takes exactly ONE broad refresh of tx.account", async () => {
		await fire(tx(OriginType.UI, A, [{ contract: "0xtok1" }]))
		expect(broad).toHaveBeenCalledTimes(1)
		expect(broad).toHaveBeenCalledWith(A)
	})

	test("non-UI origin takes the broad refresh, never the narrowed path", async () => {
		await fire(tx(OriginType.DAPP, A, [{ contract: "0xtok1", transfers: [{ from: A, to: B }] }]))
		expect(broad).toHaveBeenCalledTimes(1)
		expect(broad).toHaveBeenCalledWith(A)
		// The broad refresh's own enqueues are the real method's — only A's identity-valid rows.
		expect(enqueuedIds()).toEqual([1, 3])
	})

	test("UI transfers naming an UNKNOWN contract refresh NOTHING (narrow path with no matching token)", async () => {
		await fire(tx(OriginType.UI, A, [{ contract: "0xunknown", transfers: [{ from: A, to: B }] }]))
		expect(enqueue).not.toHaveBeenCalled()
		expect(broad).not.toHaveBeenCalled()
	})

	test("identity gate: a re-minted token id whose contract differs is not enqueued", async () => {
		await seedRepo.set(row(5, 1, A, { contract: "0xreminted" }))
		await fire(tx(OriginType.UI, A, [{ contract: "0xtok1", transfers: [{ from: A, to: B }] }]))
		expect(enqueuedIds()).toEqual([1, 4])
	})
})
