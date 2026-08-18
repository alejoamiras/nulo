/**
 * Cross-profile isolation suite — the STANDING gate for per-profile data privacy.
 * Invariant: with p1 the active profile, no read / mutate / delete / EXPORT may
 * return or touch p2's data; a missing / mismatched / absent owner must DENY,
 * never fall back to all-rows or the active-profile default.
 *
 * Three paths that once leaked across profiles are closed and asserted here:
 *   - token-balance `backup()` scopes its export to the active profile's token ids.
 *   - token by-id getters (`getToken` / `getTokenRaw` / …) reject a foreign row.
 *   - `revokeAuthwits` checks `authwit.account === account` before revoking.
 * The delete cascade is deliberately EXEMPT (an inactive-profile deletion must
 * still purge that profile's rows) — see the cascade test below.
 */

import { beforeEach, describe, expect, test } from "vitest"
import { accountRowId } from "@/wallet/services/account/spec"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceCollection, type IService } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { PROFILE_SERVICE_NAME, type ProfileInfo } from "@/wallet/services/profile/spec"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { svc } from "./composition-harness"
import { ContactService } from "./contact/service"
import { FpcService } from "./fpc/service"
import { AuthRegistryService } from "./auth-registry/service"
import { AccountService } from "./account/service"
import { NetworkService } from "./network/service"
import { OperationJournalService } from "./operation-journal/service"
import { TaskService } from "./task/service"
import { TokenService } from "./token/service"
import type { Token } from "./token/spec"
import { BalanceRepository } from "./token-balance/balance-repository"
import { TokenBalanceService } from "./token-balance/service"
import type { TokenBalanceRaw } from "./token-balance/spec"
import { TransactionService } from "./transaction/service"
import { ExecutionService } from "./execution/service"
import type { BackgroundTickerPort } from "@nulo/wallet-core/ports"

/**
 * Minimal ProfileService fake (golden reference: contact/service.test.ts). Carries
 * `onProfileDeleted` + `onActiveProfileChanged` (some services subscribe to the
 * latter in init) so `services.start()` wires the real subscriptions.
 */
class FakeProfileService implements IService {
	public static readonly name = PROFILE_SERVICE_NAME
	public readonly name = PROFILE_SERVICE_NAME
	public readonly onProfileDeleted = new EventHandler<ProfileInfo>()
	public readonly onActiveProfileChanged = new EventHandler<ProfileInfo | undefined>()
	private active: ProfileInfo | undefined
	// Shared with TransactionService for the D13 execution fence — no deletion is
	// driven in these tests, so a fresh state (epoch 0) is inert here.
	private readonly deletionState = new ProfileDeletionState()
	public async start(): Promise<void> {}
	public async getActiveProfile(): Promise<ProfileInfo | undefined> {
		return this.active
	}
	public getDeletionState(): ProfileDeletionState {
		return this.deletionState
	}
	public setActiveProfile(profile: ProfileInfo | undefined): void {
		this.active = profile
	}
}

const p1: ProfileInfo = { id: "p1", name: "P1", type: "password" }
const p2: ProfileInfo = { id: "p2", name: "P2", type: "password" }
const mkLogger = () => new LoggerStore(new ConfigStore())

/** Raw-storage seed: writes a row under `${root}@${id}` as a JSON string (the EntityStorage layout). */
const seedRow = (api: FakeBrowserApi, root: string, id: string, row: unknown) =>
	api.storage.local.set({ [`${root}@${id}`]: JSON.stringify(row) })

const mkToken = (id: number, profileId: string): Token =>
	({ id, profileId, chainId: 1, contract: `0xtok${id}`, name: `T${id}`, symbol: `T${id}`, decimals: 18 }) as Token

// Sentinel thrown from a stubbed `executeSendTransaction`: lets an ownership-gate
// control prove it reached the send WITHOUT stubbing the node-touching tail.
const EXEC_REACHED = "EXEC_REACHED"
const throwExecReached = (): never => {
	throw new Error(EXEC_REACHED)
}

// A network stub token's init subscribes to; must expose registerChainPurgeSubscriber.
const networkStub = () => svc(NetworkService.name, { registerChainPurgeSubscriber: () => {}, onActiveNetworkChanged: new EventHandler() })

/** A ticker that never fires — lets token-balance's init run queue.start() without a poll loop. */
const noopTicker: BackgroundTickerPort = { subscribe: () => ({ cancel: () => {} }) }

const mkBalance = (id: number, token: number, account: string): TokenBalanceRaw =>
	({ id, token, account, privateBalance: "0", publicBalance: "0", updatedAt: 0 }) as TokenBalanceRaw

describe("cross-profile isolation (standing gate)", () => {
	let api: FakeBrowserApi

	beforeEach(() => {
		api = new FakeBrowserApi()
		api.reset()
	})

	describe("contact — profileId-scoped (already correct; regression guard)", () => {
		let profile: FakeProfileService
		let contacts: ContactService

		beforeEach(async () => {
			profile = new FakeProfileService()
			profile.setActiveProfile(p1)
			const services = new ServiceCollection()
			services.add(profile)
			contacts = new ContactService(mkLogger(), api)
			services.add(contacts)
			await services.start()
		})

		test("backup() returns only the active profile's contacts", async () => {
			await contacts.addContact("Alice", "0xa")
			profile.setActiveProfile(p2)
			await contacts.addContact("Bob", "0xb")
			profile.setActiveProfile(p1)

			const backup = await contacts.backup()
			expect(backup).toHaveLength(1)
			expect(backup[0].name).toBe("Alice")
			expect(backup.every((c) => c.profileId === p1.id)).toBe(true)
		})

		test("getContacts() lists p1-only, never p2", async () => {
			await contacts.addContact("Alice", "0xa")
			profile.setActiveProfile(p2)
			await contacts.addContact("Bob", "0xb")
			profile.setActiveProfile(p1)
			expect((await contacts.getContacts()).map((c) => c.name)).toEqual(["Alice"])
		})
	})

	describe("token — backup scoped; by-id getters reject foreign rows", () => {
		let profile: FakeProfileService
		let tokens: TokenService

		beforeEach(async () => {
			profile = new FakeProfileService()
			profile.setActiveProfile(p1)
			const services = new ServiceCollection()
			services.add(profile)
			services.add(networkStub())
			services.add(svc(AccountService.name, {}))
			services.add(svc(TaskService.name, {}))
			services.add(svc(OperationJournalService.name, { purgeForProfile: async () => {} }))
			tokens = new TokenService(mkLogger(), api)
			services.add(tokens)
			await services.start()
			// Seed a token owned by each profile (id is a single global sequence).
			await seedRow(api, "nulo:core:tokens", "1", mkToken(1, p1.id))
			await seedRow(api, "nulo:core:tokens", "2", mkToken(2, p2.id))
		})

		test("backup() returns only the active profile's tokens", async () => {
			const backup = await tokens.backup()
			expect(backup.map((t) => t.id)).toEqual([1])
			expect(backup.every((t) => t.profileId === p1.id)).toBe(true)
		})

		test("getTokens() lists p1-only, never p2", async () => {
			const list = await tokens.getTokens(p1.id)
			expect(list.map((t) => t.id)).toEqual([1])
		})

		test("getToken(foreignId) REJECTS a p2 token while p1 active", async () => {
			// The by-id getters call requireActiveProfile + requireOwnedRow, so a foreign
			// token id throws instead of leaking p2's token.
			await expect(tokens.getToken(2)).rejects.toThrow()
		})

		test("getTokenRaw(foreignId) REJECTS a p2 token while p1 active", async () => {
			await expect(tokens.getTokenRaw(2)).rejects.toThrow()
		})

		test("deleting an INACTIVE profile purges its tokens (cascade must survive the guard-split)", async () => {
			// The active-profile guard lives on the PUBLIC deleteToken RPC, but the
			// profile-delete cascade deletes an explicit, possibly-INACTIVE profile's
			// tokens. This asserts the cascade fully purges an inactive profile: it must
			// route through the internal UNGUARDED delete (a naive guard would throw here
			// on p2's token while p1 is active, orphaning rows).
			profile.setActiveProfile(p1)
			// Profile-delete cleanup is now the coordinator's AWAITED purgeForProfile,
			// not a fire-and-forget onProfileDeleted subscriber (finding D).
			await tokens.purgeForProfile(p2.id)
			expect((await tokens.getTokens(p2.id)).map((t) => t.id)).toEqual([])
			expect((await tokens.getTokens(p1.id)).map((t) => t.id)).toEqual([1])
		})
	})

	describe("token-balance — backup scoped to the active profile's balances", () => {
		let profile: FakeProfileService
		let tbal: TokenBalanceService
		let seedRepo: BalanceRepository

		beforeEach(async () => {
			profile = new FakeProfileService()
			profile.setActiveProfile(p1)
			seedRepo = new BalanceRepository(api)
			const services = new ServiceCollection()
			services.add(profile)
			services.add(svc(NetworkService.name, {}))
			services.add(svc(AccountService.name, { onAccountAdded: new EventHandler() }))
			services.add(
				svc(TokenService.name, {
					onTokenAdded: new EventHandler(),
					onTokenUpdated: new EventHandler(),
					onTokenDeleted: new EventHandler(),
					getTokensRaw: async (pid: string) => (pid === p1.id ? [mkToken(1, p1.id)] : pid === p2.id ? [mkToken(2, p2.id)] : []),
				}),
			)
			services.add(svc(TransactionService.name, { onTransactionUpdated: new EventHandler() }))
			services.add(svc(ExecutionService.name, {}))
			services.add(svc(TaskService.name, {}))
			tbal = new TokenBalanceService(mkLogger(), api, noopTicker)
			services.add(tbal)
			await services.start()
			// p1 owns token 1, p2 owns token 2 (balances are FK'd via `token`, no profileId).
			await seedRepo.set(mkBalance(10, 1, "0xp1acct"))
			await seedRepo.set(mkBalance(20, 2, "0xp2acct"))
		})

		test("backup() returns only the active profile's balances", async () => {
			// backup() scopes the export to balances whose token is owned by the active
			// profile (via tokenService.getTokensRaw), so p2's balance (token 2) never
			// leaks into p1's plaintext backup artifact.
			const backup = await tbal.backup()
			expect(backup.map((b) => b.id)).toEqual([10])
		})

		test("getTokenBalances() SKIPS a balance whose token the active profile doesn't own — never throws", async () => {
			// Balances are FK'd by `token` and carry no profileId, so p2's balance
			// (token 2) lingers in the shared repo while p1 is active. Its token is
			// absent from the active-profile `tokens` map — the display list must skip
			// it, exactly as the balance PROJECTOR skips it, not throw "unknown token"
			// and white-screen the whole account list. A codec-hidden invalid token row
			// can also make a token absent this way.
			const balances = await tbal.getTokenBalances()
			expect(balances.map((b) => b.id)).toEqual([10])
		})
	})

	describe("fpc — by-id getters profileId-guarded via requireOwnedRow", () => {
		let profile: FakeProfileService
		let fpc: FpcService

		beforeEach(async () => {
			profile = new FakeProfileService()
			profile.setActiveProfile(p1)
			const services = new ServiceCollection()
			services.add(profile)
			services.add(networkStub())
			fpc = new FpcService(mkLogger(), api)
			services.add(fpc)
			await services.start()
			await seedRow(api, "nulo:core:fpcs", "fpc-p2", {
				id: "fpc-p2",
				profileId: p2.id,
				chainId: 1,
				type: 1,
				address: "0xfpc2",
				name: "F2",
			})
		})

		test("getFpc(foreignId) rejects a p2 fpc while p1 active", async () => {
			await expect(fpc.getFpc("fpc-p2")).rejects.toThrow(/invalid id/i)
		})
	})

	describe("network — by-id getters profileId-guarded via requireOwnedRow", () => {
		let profile: FakeProfileService
		let network: NetworkService

		beforeEach(async () => {
			profile = new FakeProfileService()
			profile.setActiveProfile(p1)
			const services = new ServiceCollection()
			services.add(profile)
			network = new NetworkService(mkLogger(), api)
			services.add(network)
			await services.start()
			await seedRow(api, "nulo:core:networks", "net-p2", {
				id: "net-p2",
				profileId: p2.id,
				chainId: 1,
				name: "N2",
				primaryEndpointId: "ep0",
				endpoints: [{ id: "ep0", rpcUrl: "http://localhost:8080" }],
			})
		})

		test("getNetwork(foreignId) rejects a p2 network while p1 active", async () => {
			await expect(network.getNetwork("net-p2")).rejects.toThrow(/invalid id/i)
		})
	})

	describe("auth-registry — revokeAuthwits account-scoped", () => {
		let profile: FakeProfileService
		let authRegistry: AuthRegistryService

		beforeEach(async () => {
			profile = new FakeProfileService()
			profile.setActiveProfile(p1)
			const services = new ServiceCollection()
			services.add(profile)
			services.add(svc(NetworkService.name, {}))
			services.add(svc(AccountService.name, { onAccountDeleted: new EventHandler() }))
			// A same-account revoke passes the ownership gate and reaches the send —
			// throw a UNIQUE sentinel there so the control below can prove the gate
			// was crossed WITHOUT stubbing the node-touching prove/sync tail.
			services.add(svc(ExecutionService.name, { executeSendTransaction: async () => throwExecReached() }))
			services.add(svc(TransactionService.name, { onTransactionUpdated: new EventHandler() }))
			services.add(svc(TaskService.name, { startNewTask: () => ({ cancel() {}, fail() {}, complete() {} }) }))
			authRegistry = new AuthRegistryService(mkLogger(), api)
			services.add(authRegistry)
			await services.start()
			// A CODEC-VALID authwit (content present, matching a real producer's
			// `{ kind: "call", … }` shape) owned by 0xACCT-P2. It must survive the row
			// codec and be PRESENT, so the rejection below is the account mismatch —
			// NOT a codec-hidden row (which would pass the assertion tautologically).
			await seedRow(api, "nulo:core:auth-registry", "5", {
				id: 5,
				account: "0xACCT-P2",
				hash: "0xhash",
				content: { kind: "call", contract: "0xregistry" },
			})
		})

		test("revokeAuthwits(otherAccount, [foreignId]) rejects a PRESENT authwit owned by another account", async () => {
			// authwits are FK-scoped by account (no profileId). Without the check a caller
			// passing a foreign id revokes another account's authwit; the fix rejects it as
			// "doesn't exist" (no cross-account existence oracle). The row is codec-valid and
			// present, so the account mismatch — not row absence — is what rejects.
			await expect(authRegistry.revokeAuthwits("net", "0xACCT-P1", [5], {} as never)).rejects.toThrow(/doesn't exist/i)
		})

		test("revokeAuthwits(sameAccount, [ownId]) passes the ownership gate and proceeds to send", async () => {
			// Control: the SAME-account revoke must cross the ownership gate (else the test
			// above would pass even with the check removed, if it rejected everything). It
			// reaches executeSendTransaction, which throws the sentinel — proving the gate
			// admitted the owner rather than treating its own id as "doesn't exist".
			await expect(authRegistry.revokeAuthwits("net", "0xACCT-P2", [5], {} as never)).rejects.toThrow(EXEC_REACHED)
		})
	})

	// P1 (backup-restore-corruption-fix): deleting one profile must NOT wipe
	// another profile's tx history on a shared chain. The buggy chainId-only
	// tx chain-purge subscriber was REMOVED; cleanup now flows through the
	// account-scoped `onAccountDeleted` cascade. This drives the REAL
	// Account→Transaction wiring: a captured chain-purge subscriber (what
	// `NetworkService.purgeChain` invokes) runs `AccountService.clearChainState`,
	// which deletes that profile's accounts + emits `onAccountDeleted`, which
	// `TransactionService` handles to delete only those accounts' txs.
	describe("transaction — profile deletion is account-scoped, never chain-wide (P1)", () => {
		let profile: FakeProfileService
		let txService: TransactionService
		const chainPurgeSubs: Array<(profileId: string, chainId: number, networkId: string) => Promise<void>> = []
		const A1 = "0xa1-p1"
		const A2 = "0xa2-p2"
		const mkAccount = (address: string, profileId: string) =>
			({ profileId, chainId: 1, address, index: 0, type: 0, l1ChainId: 1, name: address, visible: true }) as never
		const mkTx = (hash: string, account: string) =>
			({
				chainId: 1,
				account,
				nonce: "0",
				feePaymentMethod: 0,
				hash,
				createdAt: 0,
				updatedAt: 0,
				status: 1, // non-Pending → the init pending-scan / worker never touches it
				origin: { type: "wallet" },
				calls: [{ contract: "0xc", method: "m", args: [] }],
			}) as never

		beforeEach(async () => {
			chainPurgeSubs.length = 0
			profile = new FakeProfileService()
			profile.setActiveProfile(p1)
			const services = new ServiceCollection()
			services.add(profile)
			// Capturing network stub: purgeChain just forwards to these subscribers.
			services.add(
				svc(NetworkService.name, {
					registerChainPurgeSubscriber: (fn: (p: string, c: number, n: string) => Promise<void>) => chainPurgeSubs.push(fn),
					getNetworks: async () => [],
				}),
			)
			services.add(new AccountService(mkLogger(), api))
			txService = new TransactionService(mkLogger(), api)
			services.add(txService)
			await services.start()
			// Seed AFTER start() so init's pending-scan doesn't ingest the fixtures.
			// Account rows live under their composite id; a row seeded at the bare
			// address is ignored as a stale-shaped leftover.
			await seedRow(api, "nulo:core:accounts", accountRowId(p1.id, 1, A1), mkAccount(A1, p1.id))
			await seedRow(api, "nulo:core:accounts", accountRowId(p2.id, 1, A2), mkAccount(A2, p2.id))
			await seedRow(api, "nulo:core:txs", "h1", mkTx("h1", A1))
			await seedRow(api, "nulo:core:txs", "h2", mkTx("h2", A2))
		})

		test("the buggy chainId-only clearChainState subscriber is GONE", () => {
			expect((txService as unknown as { clearChainState?: unknown }).clearChainState).toBeUndefined()
			expect(chainPurgeSubs.some((fn) => fn.name.includes("clearChainState"))).toBe(false)
		})

		test("deleting profile P2 (shared chain) purges P2's txs and LEAVES P1's intact", async () => {
			// Simulate purgeChain(p2, chain 1) — invoke every captured subscriber
			// (AccountService's cascade is among them).
			for (const fn of chainPurgeSubs) await fn(p2.id, 1, "net-p2")
			await new Promise((r) => setTimeout(r, 0))
			expect((await txService.getTransactions(A2)).map((t) => t.hash)).toEqual([]) // P2 gone
			expect((await txService.getTransactions(A1)).map((t) => t.hash)).toEqual(["h1"]) // P1 survives
		})

		test("a single-network delete on the shared chain still cleans only that profile's txs", async () => {
			// Same subscriber path (deleteNetwork → purgeChain), scoped to P2.
			for (const fn of chainPurgeSubs) await fn(p2.id, 1, "net-p2")
			await new Promise((r) => setTimeout(r, 0))
			expect((await txService.getTransactions(A1)).map((t) => t.hash)).toEqual(["h1"])
		})

		test("(P2/B) restore never overwrites an existing tx — hash-collision is create-only", async () => {
			// h1 already exists (seeded, owned by A1). A crafted backup reuses that
			// hash with a DIFFERENT account; a pre-fix upsert would ERASE the original.
			const [res] = await txService.restore([mkTx("h1", "0xattacker")])
			expect(res.restoreError).toBeDefined()
			expect((await txService.getTransaction("h1")).account).toBe(A1)
		})

		test("(P2/D16) restore rejects a Pending tx — never written, never polled", async () => {
			const pending = {
				chainId: 1,
				account: A1,
				nonce: "0",
				feePaymentMethod: 0,
				hash: "hp",
				createdAt: 0,
				updatedAt: 0,
				status: 0, // Pending — the sync worker would dial its backup-controlled endpoint.
				origin: { type: "wallet" },
				calls: [{ contract: "0xc", method: "m", args: [] }],
			}
			const [res] = await txService.restore([pending as never])
			expect(res.restoreError).toBeDefined()
			await expect(txService.getTransaction("hp")).rejects.toThrow()
			expect((await txService.getTransactions(A1)).map((t) => t.hash)).not.toContain("hp")
		})
	})
})
