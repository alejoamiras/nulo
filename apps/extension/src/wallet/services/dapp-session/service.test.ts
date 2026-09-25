/**
 * Active-profile guard preservation pins for `DappSessionService` (Q19).
 *
 * This file has three distinct active-profile dispositions in one service, and
 * the requireActiveProfile sweep must preserve each EXACTLY:
 *   - `getDappSessions` throws "Profile locked" (swept → requireActiveProfile()).
 *   - `addDappSession` throws "Wallet is locked" (swept → requireActiveProfile(_, "Wallet is locked")).
 *   - `tryGetDappSessionByOriginAndChain` SILENTLY returns undefined (deliberate
 *     non-thrower; a locked wallet must decline auto-approve, NOT throw — this
 *     site was EXCLUDED from the sweep and must stay silent).
 */
import { CapabilityNotGrantedError, ValidationError } from "@nulo/extension-messaging/errors"
import { authorizationsEffective, projectKnownCapability } from "@nulo/wallet-bridge"
import { EventHandler } from "@nulo/wallet-core/utils"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/service"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { DappSessionService } from "./service"
import { RecoveryModeError } from "@nulo/extension-messaging/errors"
import { asImportedKeysDek, asMasterSecretBytes, deriveDappSessionMacKey } from "@nulo/wallet-crypto"
import { signDappSession } from "./integrity"
import type { CapabilityDecision, DappSession, GrantedCapabilityRecord } from "./spec"

let activeProfile: { id: string } | undefined

/** The REAL wallet-crypto derivation over one SHARED master (a same-phrase sibling pair) and a
 *  per-profile DEK — the exact inputs the isolation property is about. A profile listed in
 *  `recoveryProfiles` derives nothing (open session, no DEK). */
const SHARED_MASTER = asMasterSecretBytes(new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>)
const DEK_BY_PROFILE: Record<string, number> = { p1: 0x11, p2: 0x22 }
const recoveryProfiles = new Set<string>()
const realMacKey = (profileId: string) =>
	deriveDappSessionMacKey(
		SHARED_MASTER,
		asImportedKeysDek(new Uint8Array(32).fill(DEK_BY_PROFILE[profileId] ?? 0x33) as Uint8Array<ArrayBuffer>),
	)

function makeProfileStub() {
	const deletionState = new ProfileDeletionState()
	return {
		name: PROFILE_SERVICE_NAME,
		dependencies: [],
		onProfileDeleted: new EventHandler(),
		getActiveProfile: vi.fn(async () => activeProfile),
		getDeletionState: () => deletionState,
		deletionState,
		captureExecutionFence: vi.fn(async () => {
			if (!activeProfile) throw new Error("Wallet locked")
			return { profileId: activeProfile.id, epoch: deletionState.capture(activeProfile.id) }
		}),
		deriveDappSessionMacKey: vi.fn(async (profileId: string) => {
			if (recoveryProfiles.has(profileId)) throw new RecoveryModeError()
			return realMacKey(profileId)
		}),
		async start() {},
	}
}

async function makeService(): Promise<{
	service: DappSessionService
	profileStub: ReturnType<typeof makeProfileStub>
	browserApi: FakeBrowserApi
}> {
	const logger = new LoggerStore(new ConfigStore())
	const browserApi = new FakeBrowserApi()
	browserApi.reset()
	const service = new DappSessionService(logger, browserApi)
	const collection = new ServiceCollection()
	const profileStub = makeProfileStub()
	collection.add(profileStub as never)
	collection.add(service)
	await collection.start()
	return { service, profileStub, browserApi }
}

beforeEach(() => {
	activeProfile = { id: "p1" }
	recoveryProfiles.clear()
})

const ROW_ROOT = "nulo:core:dappSessions"
const rowFor = (profileId: string): DappSession =>
	({
		id: `${profileId}-row`,
		profileId,
		chainId: "1",
		dappMetadata: { name: "dApp", url: "https://dapp.example" },
		permissions: [],
		accounts: [],
		confirmationLevel: 0,
		expiry: Date.now() + 60_000,
	}) as unknown as DappSession

/** Plant a row signed under `signerProfileId`'s REAL key, exactly as a sibling holding the shared
 *  master would (it derives ITS key; only the DEK differs). */
async function plantRowSignedBy(browserApi: FakeBrowserApi, row: DappSession, signerProfileId: string) {
	const { mac: _drop, ...signable } = row
	const mac = await signDappSession(await realMacKey(signerProfileId), signable)
	await browserApi.storage.local.set({ [`${ROW_ROOT}@${row.id}`]: JSON.stringify({ ...signable, mac }) })
}

describe("DEK-keyed row integrity (same-master siblings, recovery mode)", () => {
	test("a p2-targeted row signed under p1's real key (same master, other DEK) is REJECTED and dropped under p2; p2's own row verifies", async () => {
		const { service: svc, browserApi } = await makeService()
		await plantRowSignedBy(browserApi, rowFor("p2"), "p1")
		await plantRowSignedBy(browserApi, { ...rowFor("p2"), id: "p2-own" }, "p2")
		activeProfile = { id: "p2" }
		const rows = await svc.getDappSessions()
		expect(rows.map((r) => r.id)).toEqual(["p2-own"])
		// The forgery is quarantine-deleted (tampered), the authentic row stays.
		const raw = (await browserApi.storage.local.get(null)) as Record<string, unknown>
		expect(`${ROW_ROOT}@p2-row` in raw).toBe(false)
		expect(`${ROW_ROOT}@p2-own` in raw).toBe(true)
	})

	test("an authentic p1 row read while p2 is active is HIDDEN, not deleted; p1 re-reads it", async () => {
		const { service: svc, browserApi } = await makeService()
		await plantRowSignedBy(browserApi, rowFor("p1"), "p1")
		activeProfile = { id: "p2" }
		expect(await svc.getDappSessions()).toEqual([])
		expect(`${ROW_ROOT}@p1-row` in ((await browserApi.storage.local.get(null)) as Record<string, unknown>)).toBe(true)
		activeProfile = { id: "p1" }
		expect((await svc.getDappSessions()).map((r) => r.id)).toEqual(["p1-row"])
	})

	test("an OPEN session with no DEK (recovery mode) throws RecoveryModeError from the derivation: rows are hidden, never deleted", async () => {
		const { service: svc, browserApi, profileStub } = await makeService()
		await plantRowSignedBy(browserApi, rowFor("p1"), "p1")
		recoveryProfiles.add("p1")
		expect(await svc.getDappSessions()).toEqual([])
		await expect(profileStub.deriveDappSessionMacKey("p1")).rejects.toBeInstanceOf(RecoveryModeError)
		expect(`${ROW_ROOT}@p1-row` in ((await browserApi.storage.local.get(null)) as Record<string, unknown>)).toBe(true)
		// A healthy re-unlock verifies the surviving row again.
		recoveryProfiles.delete("p1")
		expect((await svc.getDappSessions()).map((r) => r.id)).toEqual(["p1-row"])
	})
})

describe("DappSessionService active-profile guards (Q19 preservation pins)", () => {
	test('getDappSessions throws "Profile locked" when the wallet is locked', async () => {
		const { service: svc } = await makeService()
		activeProfile = undefined
		await expect(svc.getDappSessions()).rejects.toThrow("Profile locked")
	})

	test('addDappSession throws "Wallet is locked" when the wallet is locked', async () => {
		const { service: svc } = await makeService()
		activeProfile = undefined
		await expect(svc.addDappSession({} as never, [], [], 0 as never, "1")).rejects.toThrow("Wallet is locked")
	})

	test("tryGetDappSessionByOriginAndChain SILENTLY returns undefined when locked (deliberate non-thrower, NOT swept)", async () => {
		const { service: svc } = await makeService()
		activeProfile = undefined
		await expect(svc.tryGetDappSessionByOriginAndChain("https://dapp.example", "1")).resolves.toBeUndefined()
	})

	test("addDappSession: a deletion completing DURING the expiry sweep rejects the write (entry-capture pin)", async () => {
		// begin + RELEASE while the sweep's storage read is parked: the deletion
		// fully settles, so only an entry-captured fence still rejects — an
		// orphan dApp-session row would be a dormant permission grant.
		const { service: svc, profileStub, browserApi } = await makeService()
		const realGet = browserApi.storage.local.get.bind(browserApi.storage.local)
		let parked: (() => void) | null = null
		let armed = true
		browserApi.storage.local.get = (async (key: unknown) => {
			if (armed) {
				armed = false
				await new Promise<void>((resolve) => {
					parked = resolve
				})
			}
			return realGet(key as never)
		}) as typeof browserApi.storage.local.get

		const run = svc.addDappSession({ url: "https://dapp.example" } as never, [], [], 0 as never, "1")
		await new Promise((r) => setTimeout(r, 0))
		profileStub.deletionState.beginDeletion("p1")
		profileStub.deletionState.release("p1")
		;(parked as (() => void) | null)?.()

		await expect(run).rejects.toThrow(/deleted|not current/i)
		browserApi.storage.local.get = realGet as typeof browserApi.storage.local.get
		const raw = await browserApi.storage.local.get(null)
		expect(Object.keys(raw as Record<string, unknown>).some((k) => k.startsWith("nulo:core:dappSessions@"))).toBe(false)
	})
})

describe("applyCapabilityDecision requiresGrant", () => {
	const accountsGrant = { capability: { type: "accounts" as const, canGet: true, canCreateAuthWit: false, accounts: [] }, grantedAt: 1 }
	const widen = (requiresGrant?: string[]) => ({
		addAccounts: ["aztec:1:0xbb"],
		aliasPatch: { "aztec:1:0xbb": "second" },
		grantRecords: [],
		replaceTypes: [],
		approvedTypes: ["accounts"],
		rejectedTypes: [],
		...(requiresGrant ? { requiresGrant } : {}),
	})

	async function sessionWithGrant() {
		const { service: svc } = await makeService()
		await svc.addDappSession({ url: "https://dapp.example" } as never, [], [], 0 as never, "1")
		const session = await svc.tryGetDappSessionByOriginAndChain("https://dapp.example", "1", "p1")
		await svc.applyCapabilityDecision(session!.id, {
			addAccounts: ["aztec:1:0xaa"],
			aliasPatch: {},
			grantRecords: [accountsGrant as never],
			replaceTypes: [],
			approvedTypes: ["accounts"],
			rejectedTypes: [],
		})
		return { svc, id: session!.id }
	}

	test("satisfied → the decision applies", async () => {
		const { svc, id } = await sessionWithGrant()
		const next = await svc.applyCapabilityDecision(id, widen(["accounts"]))
		expect(next.accounts).toEqual(["aztec:1:0xaa", "aztec:1:0xbb"])
	})

	test("the grant is gone → CapabilityNotGrantedError and the row is untouched", async () => {
		const { svc, id } = await sessionWithGrant()
		await svc.setCapabilityGrants(id, [])
		await expect(svc.applyCapabilityDecision(id, widen(["accounts"]))).rejects.toBeInstanceOf(CapabilityNotGrantedError)
		const row = await svc.getDappSession(id)
		expect(row.accounts).toEqual(["aztec:1:0xaa"])
		expect(row.accountAliases ?? {}).toEqual({})
	})
})

describe("tryGetDappSessionByOriginAndChain anchoring", () => {
	test("forProfileId filters to the given profile and bypasses the live-profile read (silently revertible without this pin)", async () => {
		const { service: svc, profileStub } = await makeService()
		await svc.addDappSession({ url: "https://dapp.example" } as never, [], [], 0 as never, "1")

		profileStub.getActiveProfile.mockClear()
		const anchored = await svc.tryGetDappSessionByOriginAndChain("https://dapp.example", "1", "p1")
		expect(anchored?.profileId).toBe("p1")
		// The anchored path must never consult the live profile — that read is
		// exactly the switch-race the anchor exists to close.
		expect(profileStub.getActiveProfile).not.toHaveBeenCalled()

		const foreign = await svc.tryGetDappSessionByOriginAndChain("https://dapp.example", "1", "p2")
		expect(foreign).toBeUndefined()
	})
})

describe("the authorizations consent", () => {
	const A = `0x${"0a".repeat(32)}`
	const grant = (capability: Record<string, unknown>) => ({ capability, grantedAt: 1 }) as GrantedCapabilityRecord
	const withAuthWit = grant({ type: "accounts", canGet: true, canCreateAuthWit: true })
	const withoutAuthWit = grant({ type: "accounts", canGet: true, canCreateAuthWit: false })
	const listed = grant({ type: "transaction", scope: [{ contract: A, function: "transfer" }] })
	const anyContract = grant({ type: "transaction", scope: "*" })
	const decision = (patch: Partial<CapabilityDecision> = {}): CapabilityDecision => ({
		addAccounts: [],
		aliasPatch: {},
		grantRecords: [],
		replaceTypes: [],
		approvedTypes: [],
		rejectedTypes: [],
		...patch,
	})
	const widenToAnyContract = decision({ grantRecords: [anyContract], replaceTypes: ["transaction"], approvedTypes: ["transaction"] })
	const effective = (row: DappSession) =>
		authorizationsEffective(
			row.authorizationsWithoutAsking,
			(row.capabilityGrants ?? []).map((g) => g.capability),
		)

	async function holding(grants: GrantedCapabilityRecord[], consent?: { broad: boolean }) {
		const made = await makeService()
		await made.service.addDappSession({ url: "https://dapp.example" } as never, [], [], 0 as never, "1")
		const id = (await made.service.tryGetDappSessionByOriginAndChain("https://dapp.example", "1", "p1"))?.id as string
		await made.service.setCapabilityGrants(id, grants)
		if (consent) await made.service.applyCapabilityDecision(id, decision({ authorizations: consent }))
		return { ...made, svc: made.service, id }
	}

	test("a decision's object sets the consent, null deletes it and absent keeps it", async () => {
		const { svc, id } = await holding([withAuthWit, listed])
		expect((await svc.applyCapabilityDecision(id, decision({ authorizations: { broad: false } }))).authorizationsWithoutAsking).toEqual(
			{
				broad: false,
			},
		)
		expect((await svc.getDappSession(id)).authorizationsWithoutAsking).toEqual({ broad: false })
		expect((await svc.applyCapabilityDecision(id, decision())).authorizationsWithoutAsking).toEqual({ broad: false })
		expect((await svc.applyCapabilityDecision(id, decision({ authorizations: null }))).authorizationsWithoutAsking).toBeUndefined()
	})

	test("a decision leaving the accounts grant without canCreateAuthWit deletes the consent", async () => {
		const { svc, id } = await holding([withAuthWit, listed], { broad: false })
		const next = await svc.applyCapabilityDecision(
			id,
			decision({ grantRecords: [withoutAuthWit], replaceTypes: ["accounts"], approvedTypes: ["accounts"] }),
		)
		expect(next.authorizationsWithoutAsking).toBeUndefined()
	})

	test("a consent the decision cannot read is refused before any write", async () => {
		const { svc, id } = await holding([withAuthWit, listed])
		const malformed = decision({ addAccounts: ["aztec:1:0xaa"], authorizations: { broad: "yes" } as never })
		await expect(svc.applyCapabilityDecision(id, malformed)).rejects.toBeInstanceOf(ValidationError)
		const row = await svc.getDappSession(id)
		expect(row.accounts).toEqual([])
		expect(row.authorizationsWithoutAsking).toBeUndefined()
	})

	test.each([
		["the narrow On lands last", true],
		["the broad widening lands last", false],
	])("a narrow On and a concurrent widening to any contract read as ask: %s", async (_name, onLast) => {
		const { svc, id } = await holding([withAuthWit, listed])
		const narrowOn = decision({ authorizations: { broad: false }, requiresGrant: ["accounts"] })
		const [first, second] = onLast ? [widenToAnyContract, narrowOn] : [narrowOn, widenToAnyContract]
		await svc.applyCapabilityDecision(id, first)
		const row = await svc.applyCapabilityDecision(id, second)
		expect(row.authorizationsWithoutAsking).toEqual({ broad: false })
		expect(effective(row)).toBe(false)
	})

	test("a widening to any contract through setCapabilityGrants reads as ask", async () => {
		const { svc, id } = await holding([withAuthWit, listed], { broad: false })
		expect(effective(await svc.getDappSession(id))).toBe(true)
		expect(effective(await svc.setCapabilityGrants(id, [withAuthWit, anyContract]))).toBe(false)
	})

	test("an explicit broad On survives an unrelated decision", async () => {
		const { svc, id } = await holding([withAuthWit, anyContract], { broad: true })
		const data = grant({ type: "data", addressBook: true })
		const row = await svc.applyCapabilityDecision(id, decision({ grantRecords: [data], approvedTypes: ["data"] }))
		expect(row.authorizationsWithoutAsking).toEqual({ broad: true })
		expect(effective(row)).toBe(true)
	})

	test("a consent given against an accounts grant revoked meanwhile is refused", async () => {
		const { svc, id } = await holding([withAuthWit, listed])
		await svc.setCapabilityGrants(id, [listed])
		const late = decision({ authorizations: { broad: false }, requiresGrant: ["accounts"] })
		await expect(svc.applyCapabilityDecision(id, late)).rejects.toBeInstanceOf(CapabilityNotGrantedError)
		expect((await svc.getDappSession(id)).authorizationsWithoutAsking).toBeUndefined()
	})

	test("a revoke through setCapabilityGrants deletes the consent, and a re-grant starts from ask", async () => {
		const { svc, id } = await holding([withAuthWit, listed], { broad: false })
		expect((await svc.setCapabilityGrants(id, [withoutAuthWit, listed])).authorizationsWithoutAsking).toBeUndefined()
		const regranted = await svc.setCapabilityGrants(id, [withAuthWit, listed])
		expect(regranted.authorizationsWithoutAsking).toBeUndefined()
		expect(effective(regranted)).toBe(false)
	})

	test("the Settings switch stores broad from the current grants and emits the update", async () => {
		const { svc, id } = await holding([withAuthWit, anyContract])
		const updates: DappSession[] = []
		svc.onDappSessionUpdated.add((row) => updates.push(row))
		expect((await svc.setAuthorizationsWithoutAsking(id, true)).authorizationsWithoutAsking).toEqual({ broad: true })
		await svc.setCapabilityGrants(id, [withAuthWit, listed])
		expect((await svc.setAuthorizationsWithoutAsking(id, true)).authorizationsWithoutAsking).toEqual({ broad: false })
		expect((await svc.setAuthorizationsWithoutAsking(id, false)).authorizationsWithoutAsking).toBeUndefined()
		expect(updates.map((row) => row.authorizationsWithoutAsking)).toEqual([
			{ broad: true },
			{ broad: true },
			{ broad: false },
			undefined,
		])
	})

	test("the Settings switch refuses On without canCreateAuthWit and a non-boolean; Off always succeeds", async () => {
		const { svc, id } = await holding([withoutAuthWit, listed])
		await expect(svc.setAuthorizationsWithoutAsking(id, true)).rejects.toBeInstanceOf(CapabilityNotGrantedError)
		await expect(svc.setAuthorizationsWithoutAsking(id, "true" as never)).rejects.toBeInstanceOf(ValidationError)
		expect((await svc.getDappSession(id)).authorizationsWithoutAsking).toBeUndefined()
		expect((await svc.setAuthorizationsWithoutAsking(id, false)).authorizationsWithoutAsking).toBeUndefined()
		await svc.setCapabilityGrants(id, [])
		await expect(svc.setAuthorizationsWithoutAsking(id, false)).resolves.toMatchObject({ id })
	})

	test.each([
		["a decision, then Settings", "settings"],
		["Settings, then a decision", "decision"],
	])("a Settings write and a window decision leave the later one: %s", async (_name, last) => {
		const { svc, id } = await holding([withAuthWit, anyContract])
		const stale = decision({ authorizations: { broad: false }, requiresGrant: ["accounts"] })
		const writes =
			last === "settings"
				? [svc.applyCapabilityDecision(id, stale), svc.setAuthorizationsWithoutAsking(id, true)]
				: [svc.setAuthorizationsWithoutAsking(id, true), svc.applyCapabilityDecision(id, stale)]
		await Promise.all(writes)
		const expected = last === "settings" ? { broad: true } : { broad: false }
		expect((await svc.getDappSession(id)).authorizationsWithoutAsking).toEqual(expected)
	})

	test("a tampered consent fails the MAC and the row is dropped", async () => {
		const { svc, id, browserApi } = await holding([withAuthWit, anyContract], { broad: false })
		const key = `${ROW_ROOT}@${id}`
		const stored = JSON.parse((await browserApi.storage.local.get(key))[key] as string)
		await browserApi.storage.local.set({ [key]: JSON.stringify({ ...stored, authorizationsWithoutAsking: { broad: true } }) })
		expect(await svc.tryGetDappSessionByOriginAndChain("https://dapp.example", "1", "p1")).toBeUndefined()
	})

	test("a signed consent the schema refuses hides the row", async () => {
		const { service: svc, browserApi } = await makeService()
		await plantRowSignedBy(browserApi, { ...rowFor("p1"), authorizationsWithoutAsking: { broad: "yes" } } as never, "p1")
		expect(await svc.tryGetDappSessionByOriginAndChain("https://dapp.example", "1", "p1")).toBeUndefined()
		await plantRowSignedBy(browserApi, { ...rowFor("p1"), authorizationsWithoutAsking: { broad: true } }, "p1")
		expect((await svc.tryGetDappSessionByOriginAndChain("https://dapp.example", "1", "p1"))?.authorizationsWithoutAsking).toEqual({
			broad: true,
		})
	})

	test("a projected grant verifies its MAC after a round trip", async () => {
		const { svc, id, browserApi } = await holding([withAuthWit])
		const projected = [
			{ type: "contracts", contracts: [`0x${"0aBc".repeat(16)}`], canRegister: true, extra: 1 },
			{ type: "simulation", transactions: { scope: [{ contract: "*", function: "transfer" }] }, utilities: { scope: "*" } },
		].map((cap) => grant(projectKnownCapability(cap) as Record<string, unknown>))
		await svc.applyCapabilityDecision(id, decision({ grantRecords: projected, approvedTypes: ["contracts", "simulation"] }))
		const reader = new DappSessionService(new LoggerStore(new ConfigStore()), browserApi)
		const collection = new ServiceCollection()
		collection.add(makeProfileStub() as never)
		collection.add(reader)
		await collection.start()
		const row = await reader.getDappSession(id)
		expect(row.capabilityGrants?.slice(1)).toEqual(projected)
	})
})
