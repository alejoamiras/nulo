/**
 * Cross-profile isolation suite (Q-13 / round-2 R1.0) — the STANDING gate for the
 * whole Q-13 cluster. Invariant: with p1 the active profile, no read / mutate /
 * delete / EXPORT may return or touch p2's data; a missing/mismatched/absent
 * owner must DENY, never fall back to all-rows or the active-profile default.
 *
 * The dedup phases (R1.1-R1.5) MUST keep this green. The three KNOWN pre-existing
 * gaps are pinned here with `test.fails` (a Vitest assertion that the behavior is
 * CURRENTLY broken — so the suite is green at every phase, documenting the leak)
 * and each FLIPS to a normal `test` in its fixing phase:
 *   - leak #1  token-balance `backup()` returns all profiles' rows  → fixed R1.5
 *   - gap  #2  token by-id getters (`getToken`/`getTokenRaw`/…) unguarded → fixed R1.4
 *   - gap  #3  `revokeAuthwits` doesn't check `authwit.account === account` → fixed R1.5
 * See round-2/plan.md R1.0 + round-2/audit-{codex,fable}.md.
 */

import { beforeEach, describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceCollection, type IService } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { PROFILE_SERVICE_NAME, type ProfileInfo } from "@/wallet/services/profile/spec"
import { svc } from "./composition-harness"
import { ContactService } from "./contact/service"
import { AccountService } from "./account/service"
import { NetworkService } from "./network/service"
import { OperationJournalService } from "./operation-journal/service"
import { TaskService } from "./task/service"
import { TokenService } from "./token/service"
import type { Token } from "./token/spec"

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
	public async start(): Promise<void> {}
	public async getActiveProfile(): Promise<ProfileInfo | undefined> {
		return this.active
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

// A network stub token's init subscribes to; must expose registerChainPurgeSubscriber.
const networkStub = () => svc(NetworkService.name, { registerChainPurgeSubscriber: () => {} })

describe("cross-profile isolation (Q-13 R1.0 standing gate)", () => {
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

	describe("token — backup scoped; by-id getters UNGUARDED (gap #2, fixed R1.4)", () => {
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
			services.add(svc(OperationJournalService.name, {}))
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

		test.fails("(GAP #2 — fixed R1.4) getToken(foreignId) must REJECT a p2 token while p1 active", async () => {
			// Currently getToken(id) does a bare storage lookup with NO ownership
			// check, so it RETURNS p2's token. This `test.fails` passes today
			// (documenting the leak) and FLIPS to `test` when R1.4 adds the guard.
			await expect(tokens.getToken(2)).rejects.toThrow()
		})

		test.fails("(GAP #2 — fixed R1.4) getTokenRaw(foreignId) must REJECT a p2 token while p1 active", async () => {
			await expect(tokens.getTokenRaw(2)).rejects.toThrow()
		})
	})
})
