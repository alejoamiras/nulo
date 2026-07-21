/**
 * Integration tests for the `ProfileService` facade.
 *
 * Exercises concurrency invariants that unit tests of collaborators
 * cannot: the phase-1/2/3 lock dance must serialize writers while
 * keeping the slow middle phase (PBKDF2 / WebAuthn) unlocked. Drives
 * the real facade with `FakeBrowserApi` for storage + a minimal
 * `PasskeyService` stub, hits methods in overlapping orders, and
 * asserts the facade never ends up with a stuck lock or a corrupt
 * persisted session.
 *
 * Real crypto (`EncryptionKey` PBKDF2 + AES-GCM) runs — ~1s per unseal.
 * Tests pay that cost rather than dropping iteration counts; scenarios
 * stay small (1–2 PBKDF2 runs each) so the suite stays under ~30s total.
 */

import { describe, expect, test, vi } from "vitest"
import type { ConfigProp, IConfig } from "@/wallet/config"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { LoggerStore } from "@/wallet/logger"
import { ServiceCollection } from "@/wallet/base"
import { Service } from "@nulo/extension-messaging/background"
import { EventHandler } from "@nulo/wallet-core/utils"
import { AccountAddressInconsistencyError, InvalidPasswordError, ProfileIdConflictError } from "@nulo/extension-messaging/errors"
import { AccountIntegrityBlockedRepository } from "../account-integrity/blocked-repository"
import {
	asBase64CredentialId,
	asBase64MasterSecret,
	asBase64SecretPrf,
	asHexUserHandle,
	type PasskeyCredential,
	type PasskeyCredentialData,
	type SessionWrappedSecret,
} from "@nulo/wallet-crypto"
import { PasskeyService } from "@/wallet/services/passkey/service"
import { flushPromises } from "@vue/test-utils"
import { ProfileService } from "./service"
import { SESSION_STORAGE_ROOT, SESSION_TTL_ALARM_NAME } from "./session-manager"

/** Fake `IConfig` with `sessionTtl` + `strictSecurityMode`. Default is
 *  `strictSecurityMode = false` so the bearer-cache tests preserve
 *  their semantics; strict-mode tests opt in via `init.strict` or call
 *  `config.set("strictSecurityMode", true)` mid-test. */
function fakeConfig(init: { sessionTtl?: number; strict?: boolean; debugMode?: boolean } = {}): IConfig & {
	set: <K extends "sessionTtl" | "strictSecurityMode" | "debugMode">(key: K, value: K extends "sessionTtl" ? number : boolean) => void
} {
	const onUpdate = new EventHandler<ConfigProp>()
	let sessionTtl = init.sessionTtl ?? 1_800_000
	let strictSecurityMode = init.strict ?? false
	let debugMode = init.debugMode ?? false
	return {
		onUpdate,
		get: ((key: string) => {
			if (key === "sessionTtl") return sessionTtl
			if (key === "strictSecurityMode") return strictSecurityMode
			if (key === "debugMode") return debugMode
			return undefined
		}) as IConfig["get"],
		set: (key, value) => {
			if (key === "sessionTtl") sessionTtl = value as number
			else if (key === "strictSecurityMode") strictSecurityMode = value as boolean
			else if (key === "debugMode") debugMode = value as boolean
			onUpdate.invoke({ key, value } as ConfigProp)
		},
	}
}

/** Minimal PasskeyService stub — createKey/getKey return a deterministic
 *  credential. Extends the real Service so it satisfies ServiceCollection's
 *  IService shape; createKey/getKey override the real (chrome.windows-using)
 *  implementations. */
class FakePasskeyService extends Service<Record<string, never>> {
	protected readonly rpcMethods = new Set<string>()

	public constructor(logger: LoggerStore) {
		super(PasskeyService.name, logger)
	}

	protected override async init(): Promise<void> {
		// no-op — no upstream deps
	}

	public override async start(services: ServiceCollection): Promise<void> {
		await super.start(services)
	}

	/** Records the name PATH B threads in, so a service-level test can assert
	 *  the credential label was derived from the right profile name. */
	public lastCreateKeyName?: string

	public async createKey(userHandle: string, name?: string): Promise<PasskeyCredential> {
		this.lastCreateKeyName = name
		return this.credential(`cred-${userHandle}`, userHandle)
	}

	public async getKey(credentialId?: string): Promise<PasskeyCredential> {
		return this.credential(credentialId ?? "cred-discovered", "user-handle")
	}

	/** Path A entry — mirrors `PasskeyService.materializeCredential`, used
	 *  by `PasskeyRecoveryCoordinator.recoverFromCredentialData`. Returns
	 *  the same deterministic shape as `createKey`/`getKey` so a credential
	 *  written via Path B is indistinguishable from one materialized via
	 *  Path A (same `deriveMasterSecret` output). */
	public async materializeCredential(data: { id: string; userHandle?: string }): Promise<PasskeyCredential> {
		return this.credential(data.id, data.userHandle ?? "user-handle")
	}

	private credential(id: string, userHandle: string): PasskeyCredential {
		const secret = new Uint8Array(32)
		for (let i = 0; i < 32; i++) secret[i] = (i + 1) & 0xff
		return {
			id,
			userHandle,
			deriveMasterSecret: async () => {
				const { Fr } = await import("@aztec/foundation/curves/bn254")
				return Fr.fromBufferReduce(Buffer.from(secret)).toBuffer() as Buffer<ArrayBuffer>
			},
		} as unknown as PasskeyCredential
	}
}

/** Build a `PasskeyCredentialData` payload matching the FakePasskeyService's
 *  deterministic credential shape. `prf` is a placeholder — the fake
 *  ignores it because `materializeCredential` doesn't actually run HKDF;
 *  it just returns the canned credential object. */
function fakeCredentialData(credentialId: string, userHandle?: string): PasskeyCredentialData {
	return {
		id: asBase64CredentialId(credentialId),
		prf: asBase64SecretPrf("AAAA"),
		userHandle: userHandle === undefined ? undefined : asHexUserHandle(userHandle),
	}
}

async function makeService(ttlOrInit: number | { sessionTtl?: number; strict?: boolean } = 1_800_000): Promise<{
	api: FakeBrowserApi
	config: ReturnType<typeof fakeConfig>
	logger: LoggerStore
	service: ProfileService
	passkeys: FakePasskeyService
}> {
	const init = typeof ttlOrInit === "number" ? { sessionTtl: ttlOrInit } : ttlOrInit
	const api = new FakeBrowserApi()
	api.reset()
	const config = fakeConfig(init)
	const logger = new LoggerStore(config)
	const passkeys = new FakePasskeyService(logger)

	const services = new ServiceCollection()
	services.add(passkeys)

	const service = new ProfileService(config, logger, api)
	services.add(service)

	await services.start()
	// deleteProfile now requires the coordinator delegate (finding D); these tests
	// exercise the profile lifecycle, not the purge cascade → no-op delegate.
	service.setDeletionDelegate({ snapshot: async () => ({ addresses: [], tokenIds: [], networkIds: [] }), runFor: async () => {} })
	return { api, config, logger, service, passkeys }
}

/** Constructs a fresh `ProfileService` bound to a pre-existing
 *  `FakeBrowserApi` — simulates an MV3 SW restart that observes the
 *  prior persisted state. Used by strict-mode tests to verify
 *  `restore()` behavior across config-only upgrades (legacy passhash
 *  present + strict ON). */
async function makeServiceFromExistingApi(
	api: FakeBrowserApi,
	init: { sessionTtl?: number; strict?: boolean } = {},
): Promise<{
	config: ReturnType<typeof fakeConfig>
	logger: LoggerStore
	service: ProfileService
}> {
	const config = fakeConfig(init)
	const logger = new LoggerStore(config)
	const passkeys = new FakePasskeyService(logger)

	const services = new ServiceCollection()
	services.add(passkeys)

	const service = new ProfileService(config, logger, api)
	services.add(service)

	await services.start()
	service.setDeletionDelegate({ snapshot: async () => ({ addresses: [], tokenIds: [], networkIds: [] }), runFor: async () => {} })
	return { config, logger, service }
}

describe("ProfileService integration", () => {
	describe("Change 2 — unlockProfile phase-1/2/3", () => {
		test("concurrent unlock + changeProfilePassword: either unlock succeeds or throws InvalidPasswordError", async () => {
			const { service } = await makeService()
			const profile = await service.createProfile("P", "oldpass")
			await service.lockActiveProfile()

			// Kick off unlock with OLD password. Phase-2 PBKDF2 is in flight.
			const unlockPromise = service.unlockProfile(profile.id, "oldpass")
			// Race with changeProfilePassword. For change we need an active
			// session first, so bounce: re-unlock quickly via a second path
			// is tricky — instead, we accept that changeProfilePassword
			// requires an unlocked profile, so drive the race via a second
			// "already unlocked" setup. Skip: instead run change after
			// unlock completes but BEFORE a second unlock.
			const result = await unlockPromise
			expect(result.id).toBe(profile.id)

			// Now run the real race: lock, then fire a fresh unlock
			// concurrently with changeProfilePassword (which needs the
			// active session from the completed unlock above — we didn't
			// lock yet, so changeProfilePassword proceeds).
			const [unlock2, changed] = await Promise.allSettled([
				service.unlockProfile(profile.id, "oldpass"),
				service.changeProfilePassword(profile.id, "oldpass", "newpass"),
			])

			// Change must succeed.
			expect(changed.status).toBe("fulfilled")

			// Unlock either:
			//  (a) ran phases 1/2/3 before change completed phase-3 write → succeed
			//  (b) ran phase 3 after change wrote → encrypted bytes mismatch → `InvalidPasswordError`
			if (unlock2.status === "rejected") {
				expect(unlock2.reason).toBeInstanceOf(InvalidPasswordError)
			}

			// Regardless of order, the profile should now be unlockable with
			// the NEW password — proves no stuck lock, no storage corruption.
			await service.lockActiveProfile()
			const final = await service.unlockProfile(profile.id, "newpass")
			expect(final.id).toBe(profile.id)
		}, 30_000)

		test("concurrent unlock + deleteProfile: delete wins → unlock throws 'Invalid profile id'", async () => {
			const { service } = await makeService()
			const profile = await service.createProfile("P", "pass1234")
			// Don't lock — deleteProfile can run without the profile being locked.
			// But we need the profile locked to exercise unlock. So:
			await service.lockActiveProfile()

			const [unlockRes, deleteRes] = await Promise.allSettled([
				service.unlockProfile(profile.id, "pass1234"),
				service.deleteProfile(profile.id),
			])

			// Delete always succeeds (does not depend on password).
			expect(deleteRes.status).toBe("fulfilled")

			// Unlock either races ahead and succeeds (session opens, then delete
			// closes it), or races behind and finds profile missing.
			if (unlockRes.status === "rejected") {
				expect(unlockRes.reason.message).toMatch(/Invalid profile id/)
			}

			// Active session must be clear and profile must be gone.
			expect(await service.getActiveProfile()).toBeUndefined()
			const all = await service.getProfiles()
			expect(all.find((p) => p.id === profile.id)).toBeUndefined()
		}, 30_000)

		test("two parallel unlocks with correct password both succeed serially", async () => {
			const { service } = await makeService()
			const profile = await service.createProfile("P", "pass1234")
			await service.lockActiveProfile()

			const [a, b] = await Promise.all([service.unlockProfile(profile.id, "pass1234"), service.unlockProfile(profile.id, "pass1234")])
			expect(a.id).toBe(profile.id)
			expect(b.id).toBe(profile.id)
			// Final state: unlocked.
			expect(await service.getActiveProfile()).toBeDefined()
		}, 30_000)

		test("unlock + concurrent lockActiveProfile: facade stays consistent", async () => {
			const { service } = await makeService()
			const profile = await service.createProfile("P", "pass1234")
			await service.lockActiveProfile()

			const [unlockRes] = await Promise.allSettled([service.unlockProfile(profile.id, "pass1234"), service.lockActiveProfile()])

			// Unlock itself must not throw a lock-related error. Either it
			// runs before the racing lock (session open, then lock closes it)
			// or it runs after (session opens fresh on top). Either way, the
			// facade must remain responsive.
			expect(unlockRes.status).toBe("fulfilled")

			// Re-query — no stuck lock.
			await service.getProfiles() // would hang if lock leaked
		}, 30_000)
	})

	describe("Change 3 — confirmProfileOperation point-in-time", () => {
		test("confirm runs fully unlocked from phase 2 onwards", async () => {
			const { service } = await makeService()
			const profile = await service.createProfile("P", "pass1234")

			// Kick off confirm; meanwhile change password. confirm should see
			// the OLD password as valid because its snapshot predates change.
			// Actually — race ordering is timing-dependent; what we must
			// assert is that confirm + change together complete without
			// deadlock and without leaving a stuck lock.
			const [confirmRes, changeRes] = await Promise.allSettled([
				service.confirmProfileOperation(profile.id, "pass1234"),
				service.changeProfilePassword(profile.id, "pass1234", "newpass"),
			])

			expect(changeRes.status).toBe("fulfilled")
			// confirm with the OLD password: either succeeded (snapshot before
			// change) or threw wrapped "Invalid password" (snapshot after change).
			if (confirmRes.status === "rejected") {
				expect(confirmRes.reason.message).toMatch(/Invalid profile password/)
			}

			// No stuck lock: subsequent op returns.
			const info = await service.getActiveProfile()
			expect(info?.id).toBe(profile.id)
		}, 30_000)
	})

	describe("Change 4 — exportPlain single PBKDF2", () => {
		test("exportPlain for password profile returns raw secret under correct password", async () => {
			const { service } = await makeService()
			const profile = await service.createProfile("P", "pass1234")
			const exported = await service.exportPlain(profile.id, "pass1234")
			expect(exported).toBeDefined()
			expect(exported.length).toBeGreaterThan(0)
		}, 30_000)

		test("exportPlain with wrong password throws with InvalidPasswordError's legacy message", async () => {
			const { service } = await makeService()
			const profile = await service.createProfile("P", "pass1234")
			await expect(service.exportPlain(profile.id, "wrong")).rejects.toThrow(/Invalid profile password/)
		}, 30_000)

		test("(audit C1) exportPlain + exportMnemonic REJECT a tombstoned profile — no secret exfil mid-delete", async () => {
			const { service } = await makeService()
			const profile = await service.createProfile("P", "pass1234")
			// Simulate a delete beginning: the id is reserved (+ epoch bumped) while
			// the row/session still linger (the SW-died-mid-delete window).
			service.getDeletionState().beginDeletion(profile.id)
			await expect(service.exportPlain(profile.id, "pass1234")).rejects.toThrow(/Invalid profile id/)
			await expect(service.exportMnemonic(profile.id, "pass1234")).rejects.toThrow(/Invalid profile id/)
		}, 30_000)

		test("(audit D13) captureExecutionFence captures the current epoch, then rejects once reserved (atomic)", async () => {
			const { service } = await makeService()
			await service.createProfile("P", "pass1234")
			const fence = await service.captureExecutionFence()
			expect(fence.epoch).toBe(0)
			service.getDeletionState().beginDeletion(fence.profileId)
			await expect(service.captureExecutionFence()).rejects.toThrow(/Wallet locked/)
		}, 30_000)

		test("exportPlain for passkey profile returns credentialId", async () => {
			const { service } = await makeService()
			const profile = await service.createPasskeyProfile("PK")
			// Post-Path-A migration: passkey export requires the popup-supplied
			// `credentialData`. The FakePasskeyService materializes any
			// `{ id }` into a canned credential that round-trips through the
			// credentialId-binding check; we just need the id to match what
			// the profile actually stores (FakePasskeyService formula:
			// `cred-${userHandle}`).
			const credData = fakeCredentialData(`cred-${profile.id}`, profile.id)
			const exported = await service.exportPlain(profile.id, undefined, credData)
			expect(exported).toMatch(/^cred-/)
		}, 30_000)

		test("PATH B threads the profile name through to createKey for the label", async () => {
			// createPasskeyProfile with no credentialData drives PATH B:
			// acquireRecovery → createForNewProfile → createKey(id, name). Pin
			// that the profile NAME (not the id) reaches createKey, so the
			// nulo-{name}-{id} label is derived from the right value.
			const { service, passkeys } = await makeService()
			await service.createPasskeyProfile("My Wallet")
			expect(passkeys.lastCreateKeyName).toBe("My Wallet")
		}, 30_000)

		test("exportPlain passkey rejects credentialData for a different credential", async () => {
			// Bind safety: if the popup hands back a `PasskeyCredentialData`
			// whose id doesn't match the profile's stored credentialId, the
			// service must throw rather than return whichever credentialId
			// happens to be in storage. Locks in codex's P0 from the v2 audit.
			const { service } = await makeService()
			const profile = await service.createPasskeyProfile("PK")
			const wrongCred = fakeCredentialData("cred-OTHER", profile.id)
			await expect(service.exportPlain(profile.id, undefined, wrongCred)).rejects.toThrow(/Invalid profile id/)
		}, 30_000)

		test("F-007: unlockPasskeyProfile rejects credentialData for a different credential", async () => {
			// Phase 2 / F-007 regression pin. Mirrors the exportPlain binding
			// check (above). Without it, a popup-supplied credentialData whose
			// id doesn't match the profile's stored credentialId would still
			// open a session — using a master secret derived from the WRONG
			// credential. Downstream account derivation then operates against
			// the wrong key material.
			const { service } = await makeService()
			const profile = await service.createPasskeyProfile("PK")
			// First lock the profile so we can attempt to unlock it.
			await service.lockActiveProfile()
			const wrongCred = fakeCredentialData("cred-OTHER", profile.id)
			await expect(service.unlockPasskeyProfile(profile.id, wrongCred)).rejects.toThrow(/Invalid profile id/)
		}, 30_000)

		test("exportPlain passkey requires credentialData (no Path B fallback)", async () => {
			const { service } = await makeService()
			const profile = await service.createPasskeyProfile("PK")
			await expect(service.exportPlain(profile.id)).rejects.toThrow(/credentialData is required/)
		}, 30_000)

		test("exportPlain passkey revalidates credentialId after confirm (codex Finding 1)", async () => {
			// The risk: exportPlain proves possession against an initial
			// `repo.get` snapshot, then returns the credentialId from that
			// snapshot. If a concurrent delete + reimport rotates the
			// credential between the snapshot and the return, the caller
			// gets a stale id. Post-fix: a second refetch + compare catches it.
			const { service } = await makeService()
			const profile = await service.createPasskeyProfile("PK")

			const credData = fakeCredentialData(`cred-${profile.id}`, profile.id)
			const exportPromise = service.exportPlain(profile.id, undefined, credData)

			// Race: delete + reimport with a different credentialId in parallel.
			await service.deleteProfile(profile.id)
			const newProfile = await service.createPasskeyProfile("PK new")

			const exportResult = await exportPromise.catch((err) => err)
			if (exportResult instanceof Error) {
				// Caught the stale-credential race → threw "Invalid profile id". Good.
				expect(exportResult.message).toMatch(/Invalid profile id/)
			} else {
				// Won the race before delete landed → returned the ORIGINAL credentialId.
				const newCred = await service
					.exportPlain(newProfile.id, undefined, fakeCredentialData(`cred-${newProfile.id}`, newProfile.id))
					.catch(() => undefined)
				expect(exportResult).not.toBe(newCred)
			}
		}, 30_000)
	})

	describe("AUDIT A2 — exportEncrypted auth gate", () => {
		test("exportEncrypted returns the blob when called for the currently-active profile", async () => {
			const { service } = await makeService()
			const profile = await service.createProfile("P", "pass1234")
			// createProfile leaves the new profile as the active session.
			const exported = await service.exportEncrypted(profile.id)
			expect(exported).toBeDefined()
			expect(exported.length).toBeGreaterThan(0)
		}, 30_000)

		test("exportEncrypted throws 'Profile locked' when no session is active", async () => {
			const { service } = await makeService()
			const profile = await service.createProfile("P", "pass1234")
			await service.lockActiveProfile()
			await expect(service.exportEncrypted(profile.id)).rejects.toThrow(/Profile locked/)
		}, 30_000)

		test("exportEncrypted throws 'Profile locked' when a DIFFERENT profile is active", async () => {
			const { service } = await makeService()
			const a = await service.createProfile("A", "passA1234")
			// Lock A and create B; B is now the active profile.
			await service.lockActiveProfile()
			const b = await service.createProfile("B", "passB1234")
			expect((await service.getActiveProfile())?.id).toBe(b.id)
			// Asking for A's blob while B is active must reject — closes the
			// "I-know-the-id" exfil hole even though the wallet is unlocked.
			await expect(service.exportEncrypted(a.id)).rejects.toThrow(/Profile locked/)
			// Sanity: B's blob still works (the gate is per-profile, not global).
			const exportedB = await service.exportEncrypted(b.id)
			expect(exportedB).toBeDefined()
		}, 30_000)

		test("exportEncrypted throws 'Operation not supported for passkey profile' when active is passkey", async () => {
			const { service } = await makeService()
			const profile = await service.createPasskeyProfile("PK")
			await expect(service.exportEncrypted(profile.id)).rejects.toThrow(/Operation not supported for passkey profile/)
		}, 30_000)
	})

	describe("createPasskeyProfile — id conflict (Phase 0 bug fix)", () => {
		test("throws ProfileIdConflictError when id is taken during WebAuthn ceremony", async () => {
			// Simulate a concurrent writer claiming the pre-reserved id during
			// the WebAuthn prompt by having FakePasskeyService write a colliding
			// profile mid-createKey. Pre-fix behavior was to silently regenerate
			// the id under the lock, leaving the credential's userHandle out of
			// sync with the persisted profile id. Post-fix: throw a retryable
			// `ProfileIdConflictError`, caller re-runs the ceremony with a new id.
			const api = new FakeBrowserApi()
			api.reset()
			const config = fakeConfig({})
			const logger = new LoggerStore(config)

			class CollidingPasskey extends Service<Record<string, never>> {
				protected readonly rpcMethods = new Set<string>()

				public constructor() {
					super(PasskeyService.name, logger)
				}
				protected override async init(): Promise<void> {}
				public async createKey(userHandle: string): Promise<PasskeyCredential> {
					// Simulate a parallel writer claiming `userHandle` during the
					// prompt by directly writing a profile to storage at that id.
					// EntityStorage uses keys of the form `${root}@${id}`.
					const key = `nulo:core:profiles@${userHandle}`
					await api.storage.local.set({
						[key]: JSON.stringify({ id: userHandle, name: "concurrent", type: "password" }),
					})
					const secret = new Uint8Array(32)
					for (let i = 0; i < 32; i++) secret[i] = (i + 1) & 0xff
					return {
						id: `cred-${userHandle}`,
						userHandle,
						deriveMasterSecret: async () => {
							const { Fr } = await import("@aztec/foundation/curves/bn254")
							return Fr.fromBufferReduce(Buffer.from(secret)).toBuffer() as Buffer<ArrayBuffer>
						},
					} as unknown as PasskeyCredential
				}
				public async getKey(): Promise<PasskeyCredential> {
					throw new Error("not used in this test")
				}
			}

			const services = new ServiceCollection()
			services.add(new CollidingPasskey())
			const service = new ProfileService(config, logger, api)
			services.add(service)
			await services.start()

			await expect(service.createPasskeyProfile("PK")).rejects.toBeInstanceOf(ProfileIdConflictError)
		}, 30_000)

		test("happy path still works (no conflict — single createKey, single persist)", async () => {
			const { service } = await makeService()
			const profile = await service.createPasskeyProfile("PK")
			expect(profile.id).toBeDefined()
			expect(profile.type).toBe("passkey")
		}, 30_000)
	})

	describe("Change 1 — unlockPasskeyProfile phase-1/2/3", () => {
		test("unlocks a passkey profile and opens session", async () => {
			const { service } = await makeService()
			const profile = await service.createPasskeyProfile("PK")
			await service.lockActiveProfile()

			const unlocked = await service.unlockPasskeyProfile(profile.id)
			expect(unlocked.id).toBe(profile.id)
			const active = await service.getActiveProfile()
			expect(active?.id).toBe(profile.id)
		}, 30_000)

		test("throws 'Invalid profile id' when profile deleted during phase 2", async () => {
			const { service } = await makeService()
			const profile = await service.createPasskeyProfile("PK")
			await service.lockActiveProfile()

			const [unlockRes, deleteRes] = await Promise.allSettled([
				service.unlockPasskeyProfile(profile.id),
				service.deleteProfile(profile.id),
			])
			expect(deleteRes.status).toBe("fulfilled")
			if (unlockRes.status === "rejected") {
				expect(unlockRes.reason.message).toMatch(/Invalid profile id/)
			}
			// If unlock won the race, active profile is set but then the
			// facade's deleteProfile closed the session (isActive check).
			const all = await service.getProfiles()
			expect(all.find((p) => p.id === profile.id)).toBeUndefined()
		}, 30_000)
	})

	/**
	 * Strict Security Mode integration tests.
	 *
	 * The architectural decision: `SessionManager` owns the
	 * bearer-persistence gate. `ProfileService` is unchanged — it still
	 * passes `passhash` to `sessionManager.open(...)` from all four call
	 * sites (`createProfile`, `unlockProfile`, `changeProfilePassword`,
	 * `importPasswordProfile`). `SessionManager` decides whether to
	 * persist.
	 * These tests verify all four caller paths respect strict mode + cover
	 * the toggle race + SW-restart upgrade.
	 */
	describe("M4.2 — Strict Security Mode", () => {
		// 32-byte base64 secret used for importPlain.
		const PLAIN_SECRET_B64 = Buffer.from(new Uint8Array(32).fill(7)).toString("base64")

		async function readPersistedBearer(api: FakeBrowserApi): Promise<SessionWrappedSecret | undefined> {
			const raw = await api.storage.session.get("nulo:core:session")
			if (!raw["nulo:core:session"]) return undefined
			const session = JSON.parse(raw["nulo:core:session"] as string) as { bearer?: SessionWrappedSecret }
			return session.bearer
		}

		test("default unlock under strict ON: persisted Session has no bearer", async () => {
			const { api, service } = await makeService({ strict: true })
			const profile = await service.createProfile("P", "pass1234")
			// createProfile already opens a session (no separate unlock needed).
			expect(await readPersistedBearer(api)).toBeUndefined()
			expect(profile.id).toBeDefined()
		}, 30_000)

		test("opt-out unlock keeps bearer (legacy lenient behavior)", async () => {
			const { api, service } = await makeService({ strict: false })
			await service.createProfile("P", "pass1234")
			expect((await readPersistedBearer(api))?.v).toBe(1)
		}, 30_000)

		test("createProfile honors strict mode (gate applies even on profile creation, not just unlock)", async () => {
			const { api, service } = await makeService({ strict: true })
			await service.createProfile("P", "pass1234")
			expect(await readPersistedBearer(api)).toBeUndefined()
		}, 30_000)

		test("changeProfilePassword honors strict mode (gate applies on re-open after password change)", async () => {
			const { api, service } = await makeService({ strict: true })
			const profile = await service.createProfile("P", "oldpass1")
			expect(await readPersistedBearer(api)).toBeUndefined() // create was strict

			await service.changeProfilePassword(profile.id, "oldpass1", "newpass1")
			// changeProfilePassword reopens the session with the new credentials
			// — still must respect strict mode (codex-flagged BLOCKER in v1).
			expect(await readPersistedBearer(api)).toBeUndefined()
		}, 30_000)

		test("importPlain honors strict mode (gate applies on import-then-open)", async () => {
			const { api, service } = await makeService({ strict: true })
			await service.importPlain("Imported", PLAIN_SECRET_B64, "pass1234")
			// importPasswordProfile reopens the session as part of the import flow
			// — must respect strict mode (codex-flagged BLOCKER in v1).
			expect(await readPersistedBearer(api)).toBeUndefined()
		}, 30_000)

		test("toggle ON during unlocked session: bearer cleared from persisted record + in-memory", async () => {
			const { api, config, service } = await makeService({ strict: false })
			await service.createProfile("P", "pass1234")
			expect((await readPersistedBearer(api))?.v).toBe(1)

			config.set("strictSecurityMode", true)
			// onConfigUpdated fires `void clearBearer()` — flush microtasks.
			await Promise.resolve()
			await Promise.resolve()
			await Promise.resolve()
			await Promise.resolve()

			expect(await readPersistedBearer(api)).toBeUndefined()
			// Master secret survives toggle — wallet stays unlocked.
			const active = await service.getActiveProfile()
			expect(active).toBeDefined()
		}, 30_000)

		test("toggle OFF during strict session: no immediate backfill", async () => {
			const { api, config, service } = await makeService({ strict: true })
			await service.createProfile("P", "pass1234")
			expect(await readPersistedBearer(api)).toBeUndefined()

			config.set("strictSecurityMode", false)
			await Promise.resolve()
			await Promise.resolve()

			// Session storage stays bearer-less; bearer reappears on the
			// NEXT unlock (after the user manually locks + unlocks).
			expect(await readPersistedBearer(api)).toBeUndefined()
		}, 30_000)

		test("toggle OFF + relock + unlock: bearer is restored on the next unlock", async () => {
			const { api, config, service } = await makeService({ strict: true })
			const profile = await service.createProfile("P", "pass1234")

			config.set("strictSecurityMode", false)
			await Promise.resolve()
			await Promise.resolve()

			await service.lockActiveProfile()
			await service.unlockProfile(profile.id, "pass1234")

			// Now the bearer is back — confirms toggle OFF takes effect on
			// next unlock.
			expect((await readPersistedBearer(api))?.v).toBe(1)
		}, 30_000)

		test("SW restart simulation: legacy passhash record → silentClose + profile still unlockable (upgrade-path safety)", async () => {
			// A pre-F-11 build persisted a password-equivalent `passhash` string.
			// After upgrade, restore() must NEVER accept it (F-11) — the profile
			// record is intact, so the user re-unlocks ONCE. This proves the
			// no-re-registration invariant end-to-end: no wipe, no re-create.
			const { api } = await makeService({ strict: false })
			const profile = await (async () => {
				const built = await makeServiceFromExistingApi(api, { strict: false })
				const p = await built.service.createProfile("P", "pass1234")
				await built.service.lockActiveProfile() // clears the F-11 session
				return p
			})()

			// Hand-seed a genuine legacy passhash session as an old build left it.
			await api.storage.session.set({
				[SESSION_STORAGE_ROOT]: JSON.stringify({
					profile: profile.id,
					passhash: Buffer.from(new ArrayBuffer(8)).toString("base64"),
					since: Date.now(),
					lockedAt: Date.now() + 1_800_000,
				}),
			})

			// SW restart. restore() sees the legacy passhash → silentClose,
			// regardless of strict mode (the legacy shape is never trusted).
			const { service: service2 } = await makeServiceFromExistingApi(api, { strict: false })
			expect(await service2.getActiveProfile()).toBeUndefined() // lock-screen state
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(SESSION_STORAGE_ROOT in raw).toBe(false) // legacy record cleaned up

			// The profile is untouched: the SAME password unlocks it — no
			// re-registration, no data loss (F-11 option (a)).
			const reunlocked = await service2.unlockProfile(profile.id, "pass1234")
			expect(reunlocked.id).toBe(profile.id)
			expect((await readPersistedBearer(api))?.v).toBe(1) // fresh F-11 bearer on re-unlock
		}, 30_000)

		test("SW restart simulation: clean strict session + strict ON → no in-memory restore (passkey-equivalent)", async () => {
			const { api } = await makeService({ strict: true })
			const built = await makeServiceFromExistingApi(api, { strict: true })
			await built.service.createProfile("P", "pass1234")

			// Fresh ProfileService against the same api with strict ON.
			const { service: service2 } = await makeServiceFromExistingApi(api, { strict: true })
			// Persisted Session has no bearer (strict open never wrote one).
			// restore() takes the `!session.bearer` branch → silentClose.
			expect(await service2.getActiveProfile()).toBeUndefined()
		}, 30_000)

		test("SW restart simulation: lenient session + strict OFF → silent restore (lenient path intact)", async () => {
			const { api } = await makeService({ strict: false })
			const built = await makeServiceFromExistingApi(api, { strict: false })
			await built.service.createProfile("P", "pass1234")
			expect((await readPersistedBearer(api))?.v).toBe(1)

			const { service: service2 } = await makeServiceFromExistingApi(api, { strict: false })
			// Persisted bearer + strict OFF → silent restore.
			const active = await service2.getActiveProfile()
			expect(active).toBeDefined()
		}, 30_000)

		test("passkey profile + strict ON: behavior unchanged (no bearer to begin with)", async () => {
			const { api, service } = await makeService({ strict: true })
			const profile = await service.createPasskeyProfile("PK")
			expect(profile.type).toBe("passkey")
			expect(await readPersistedBearer(api)).toBeUndefined()
		}, 30_000)
	})

	/**
	 * Backup-import: restore() + finalizeRestore() contract.
	 *
	 * `restore()` writes the profile only — NO session open, NO
	 * `onActiveProfileChanged` emit. The session is opened explicitly via
	 * `finalizeRestore()` after the caller has finished restoring backup data
	 * (networks / accounts / etc.). This split prevents
	 * `app.vue:onActiveProfileChanged` from racing the rest of the import
	 * (it would otherwise call `getOrInitNetworks` + `ensureDefaultAccount`
	 * against an empty profile, seeding duplicate networks / addresses).
	 */
	describe("restore + finalizeRestore", () => {
		// 32-byte base64 master key used for restore() password-profile path.
		const RESTORE_MASTER_KEY = Buffer.from(new Uint8Array(32).fill(11)).toString("base64")

		test("restore() writes the profile but does NOT open a session", async () => {
			const { service } = await makeService()

			const out = await service.restore(
				{ id: "ignored", name: "P", type: "password" },
				{ type: "password", masterKey: asBase64MasterSecret(RESTORE_MASTER_KEY) },
				"pass1234",
			)

			expect("restoreError" in out && out.restoreError).toBeFalsy()
			// Profile is in storage but no session.
			expect((await service.getProfiles()).find((p) => p.id === out.id)).toBeDefined()
			expect(await service.getActiveProfile()).toBeUndefined()
		}, 30_000)

		test("finalizeRestore() opens the session with the supplied password and emits onActiveProfileChanged", async () => {
			const { service } = await makeService()

			const events: Array<{ id: string } | undefined> = []
			service.onActiveProfileChanged.add((p) => events.push(p))

			const out = await service.restore(
				{ id: "ignored", name: "P", type: "password" },
				{ type: "password", masterKey: asBase64MasterSecret(RESTORE_MASTER_KEY) },
				"pass1234",
			)
			if ("restoreError" in out && out.restoreError) throw new Error(String(out.restoreError))

			// No emit happened during restore — sanity-check before finalize.
			expect(events).toEqual([])

			const active = await service.finalizeRestore(out.id, "pass1234")
			expect(active.id).toBe(out.id)
			expect((await service.getActiveProfile())?.id).toBe(out.id)
			expect(events.length).toBe(1)
			expect(events[0]?.id).toBe(out.id)
		}, 30_000)

		test("finalizeRestore() with wrong password throws InvalidPasswordError; profile stays in storage", async () => {
			const { service } = await makeService()
			const out = await service.restore(
				{ id: "ignored", name: "P", type: "password" },
				{ type: "password", masterKey: asBase64MasterSecret(RESTORE_MASTER_KEY) },
				"pass1234",
			)
			if ("restoreError" in out && out.restoreError) throw new Error(String(out.restoreError))

			await expect(service.finalizeRestore(out.id, "wrong-pass")).rejects.toBeInstanceOf(InvalidPasswordError)
			// Still in storage, still no session — user can retry or fall back to /popup/auth.
			expect((await service.getProfiles()).find((p) => p.id === out.id)).toBeDefined()
			expect(await service.getActiveProfile()).toBeUndefined()
		}, 30_000)

		test("finalizeRestore() is idempotent: a second call on an already-active session is a no-op", async () => {
			const { service } = await makeService()
			const out = await service.restore(
				{ id: "ignored", name: "P", type: "password" },
				{ type: "password", masterKey: asBase64MasterSecret(RESTORE_MASTER_KEY) },
				"pass1234",
			)
			if ("restoreError" in out && out.restoreError) throw new Error(String(out.restoreError))

			await service.finalizeRestore(out.id, "pass1234")
			const events: Array<{ id: string } | undefined> = []
			service.onActiveProfileChanged.add((p) => events.push(p))

			await service.finalizeRestore(out.id, "pass1234") // second call
			expect(events.length).toBe(0) // no second emit
			expect((await service.getActiveProfile())?.id).toBe(out.id)
		}, 30_000)

		test("finalizeRestore() throws when the profile no longer exists (rollback case)", async () => {
			const { service } = await makeService()
			const out = await service.restore(
				{ id: "ignored", name: "P", type: "password" },
				{ type: "password", masterKey: asBase64MasterSecret(RESTORE_MASTER_KEY) },
				"pass1234",
			)
			if ("restoreError" in out && out.restoreError) throw new Error(String(out.restoreError))

			await service.deleteProfile(out.id)
			await expect(service.finalizeRestore(out.id, "pass1234")).rejects.toThrow(/Invalid profile id/)
		}, 30_000)

		test("passkey: restore() with Path A credentialData writes the profile + stashes the recovery secret; finalizeRestore() opens session without re-prompting WebAuthn", async () => {
			const { service } = await makeService()

			// Create a passkey profile first so the userHandle / credentialId exist
			// in the FakePasskeyService's deterministic credential map.
			const original = await service.createPasskeyProfile("PK")
			const credentialId = await service.getPasskeyCredentialId(original.id)
			// Wipe the active session to simulate "fresh import" state.
			await service.lockActiveProfile()
			await service.deleteProfile(original.id)

			const credData = fakeCredentialData(credentialId, original.id)
			const out = await service.restore(
				{ id: "ignored", name: "PK", type: "passkey" },
				{ type: "passkey", credentialId: asBase64CredentialId(credentialId) },
				undefined,
				credData,
			)
			if ("restoreError" in out && out.restoreError) throw new Error(String(out.restoreError))

			// Profile re-created, no session yet.
			expect((await service.getProfiles()).find((p) => p.id === out.id)).toBeDefined()
			expect(await service.getActiveProfile()).toBeUndefined()

			// Finalize without supplying any credentialData — proves the stashed
			// secret is consumed, not a fresh ceremony. The no-extra-prompt
			// invariant is what makes the passkey-import UX bearable.
			await service.finalizeRestore(out.id)
			expect((await service.getActiveProfile())?.id).toBe(out.id)
		}, 30_000)

		test("passkey: restore() requires credentialData (no Path B fallback)", async () => {
			// The previous Path B behavior — SW opens a window via
			// `recoverByCredentialId` — was removed because the popup-side
			// modal is now the only legitimate ceremony driver. Callers
			// that forget credentialData get a `restoreError` so the import
			// flow's outer catch surfaces it as "Import failed: …".
			const { service } = await makeService()
			const original = await service.createPasskeyProfile("PK")
			const credentialId = await service.getPasskeyCredentialId(original.id)
			await service.lockActiveProfile()
			await service.deleteProfile(original.id)

			const out = await service.restore(
				{ id: "ignored", name: "PK", type: "passkey" },
				{ type: "passkey", credentialId: asBase64CredentialId(credentialId) },
			)
			expect("restoreError" in out && out.restoreError).toBeTruthy()
			expect(String((out as { restoreError?: unknown }).restoreError)).toMatch(/credentialData is required/)
		}, 30_000)

		test("passkey: restore() rejects credentialData whose id ≠ masterKey (codex P0 binding check)", async () => {
			const { service } = await makeService()
			const original = await service.createPasskeyProfile("PK")
			const credentialId = await service.getPasskeyCredentialId(original.id)
			await service.lockActiveProfile()
			await service.deleteProfile(original.id)

			// Supply credentialData for a DIFFERENT credential than the
			// backup's masterKey. Without the binding check, the secret
			// derived from the wrong key would land in pendingRestoreSecrets
			// and finalizeRestore would open a session bound to a master
			// that doesn't match the imported address.
			const wrongCred = fakeCredentialData("cred-WRONG", original.id)
			const out = await service.restore(
				{ id: "ignored", name: "PK", type: "passkey" },
				{ type: "passkey", credentialId: asBase64CredentialId(credentialId) },
				undefined,
				wrongCred,
			)
			expect("restoreError" in out && out.restoreError).toBeTruthy()
			expect(String((out as { restoreError?: unknown }).restoreError)).toMatch(/credentialId mismatch/)
		}, 30_000)

		test("passkey: deleteProfile clears the pending restore secret (rollback cleanup)", async () => {
			const { service } = await makeService()

			const original = await service.createPasskeyProfile("PK")
			const credentialId = await service.getPasskeyCredentialId(original.id)
			await service.lockActiveProfile()
			await service.deleteProfile(original.id)

			const credData = fakeCredentialData(credentialId, original.id)
			const out = await service.restore(
				{ id: "ignored", name: "PK", type: "passkey" },
				{ type: "passkey", credentialId: asBase64CredentialId(credentialId) },
				undefined,
				credData,
			)
			if ("restoreError" in out && out.restoreError) throw new Error(String(out.restoreError))

			// Rollback before finalize — simulating the duplicate-address path
			// in useFullBackupImport that calls deleteProfile() on the just-
			// restored profile.
			await service.deleteProfile(out.id)

			// finalize must fail cleanly — the profile is gone AND the pending
			// secret was scrubbed.
			await expect(service.finalizeRestore(out.id)).rejects.toThrow(/Invalid profile id/)
		}, 30_000)

		test("restore() password path with invalid master key length throws, no session", async () => {
			const { service } = await makeService()

			// The 32-byte guard is an early-throw (before the try-catch), so
			// callers see a thrown Error rather than `{restoreError}`. The
			// guarantee that matters is "no session, no orphan profile" —
			// both verified below.
			await expect(
				service.restore(
					{ id: "ignored", name: "P", type: "password" },
					{ type: "password", masterKey: asBase64MasterSecret(Buffer.from(new Uint8Array(16)).toString("base64")) }, // 16 bytes, not 32
					"pass1234",
				),
			).rejects.toThrow(/master key length/i)
			expect(await service.getActiveProfile()).toBeUndefined()
			expect(await service.getProfiles()).toEqual([])
		}, 30_000)

		test("restore() rejects a secret whose type does not match the profile type (split invariant)", async () => {
			const { service } = await makeService()

			// The RestoreSecret split's core guard: a passkey-shaped secret handed to a
			// password profile (and the inverse) is rejected up front — the swap the old
			// polymorphic `masterKey: string` slot silently allowed. Both throw (the check
			// is before runExclusive), leaving no profile + no session.
			await expect(
				service.restore(
					{ id: "ignored", name: "P", type: "password" },
					{ type: "passkey", credentialId: asBase64CredentialId("cred-x") },
					"pass1234",
				),
			).rejects.toThrow(/secret type does not match/i)
			await expect(
				service.restore(
					{ id: "ignored", name: "PK", type: "passkey" },
					{ type: "password", masterKey: asBase64MasterSecret(RESTORE_MASTER_KEY) },
					undefined,
					fakeCredentialData("cred-x"),
				),
			).rejects.toThrow(/secret type does not match/i)
			expect(await service.getProfiles()).toEqual([])
			expect(await service.getActiveProfile()).toBeUndefined()
		}, 30_000)

		test("restore + finalize password profile survives a simulated SW restart via chrome.storage.session", async () => {
			const { service, api } = await makeService()
			const out = await service.restore(
				{ id: "ignored", name: "P", type: "password" },
				{ type: "password", masterKey: asBase64MasterSecret(RESTORE_MASTER_KEY) },
				"pass1234",
			)
			if ("restoreError" in out && out.restoreError) throw new Error(String(out.restoreError))
			await service.finalizeRestore(out.id, "pass1234")
			expect((await service.getActiveProfile())?.id).toBe(out.id)

			// Simulate an MV3 SW restart: a fresh ProfileService over the SAME persisted
			// storage must rehydrate the password session from chrome.storage.session.
			const { service: service2 } = await makeServiceFromExistingApi(api)
			expect((await service2.getActiveProfile())?.id).toBe(out.id)
		}, 30_000)

		test("restore + finalize passkey profile round-trips across SW restart WITHOUT silent activation", async () => {
			const { service, api } = await makeService()

			// Seed the FakePasskeyService credential map, capture its deterministic
			// credentialId + userHandle, then wipe to simulate a fresh import.
			const original = await service.createPasskeyProfile("PK")
			const credentialId = await service.getPasskeyCredentialId(original.id)
			const userHandle = original.id
			await service.lockActiveProfile()
			await service.deleteProfile(original.id)

			const credData = fakeCredentialData(credentialId, userHandle)
			const out = await service.restore(
				{ id: "ignored", name: "PK", type: "passkey" },
				{ type: "passkey", credentialId: asBase64CredentialId(credentialId) },
				undefined,
				credData,
			)
			if ("restoreError" in out && out.restoreError) throw new Error(String(out.restoreError))
			await service.finalizeRestore(out.id)
			expect((await service.getActiveProfile())?.id).toBe(out.id)

			// SW restart: a fresh service does NOT auto-activate a passkey profile
			// (WebAuthn needs a user gesture), but the persisted record survives and an
			// explicit unlockPasskeyProfile re-opens it.
			const { service: service2 } = await makeServiceFromExistingApi(api)
			expect(await service2.getActiveProfile()).toBeUndefined()
			const unlocked = await service2.unlockPasskeyProfile(out.id, fakeCredentialData(credentialId, userHandle))
			expect(unlocked.id).toBe(out.id)
			expect((await service2.getActiveProfile())?.id).toBe(out.id)
		}, 30_000)
	})

	// Q10 composition seam — the runtime now does `new ProfileService(config, logger, browserApi)`
	// (runtime.ts:136). The browserApi port carries BOTH storage AND alarms, so wiring it for the
	// storage migration also ACTIVATES SessionManager's pre-existing proactive TTL auto-lock (it was
	// dormant pre-arc only because the composition root passed no port). This is an accepted,
	// user-visible behavior change — the intended completion of the migration, flagged by the codex
	// confidence-pass HOLD and accepted by the owner. See WRAP-UP.md. These pins keep the activation
	// from silently regressing back to dormant (or silently flipping on without a port).
	describe("ProfileService Q10 composition seam — proactive TTL activation", () => {
		test("WITH a browserApi port → SessionManager subscribes to the proactive-TTL alarm", () => {
			const api = new FakeBrowserApi()
			api.reset()
			const onAlarm = vi.spyOn(api.alarms, "onAlarm")
			const config = fakeConfig()
			const logger = new LoggerStore(config)
			new ProfileService(config, logger, api)
			expect(onAlarm).toHaveBeenCalledTimes(1)
		})

		test("WITHOUT a browserApi port (the pre-arc runtime) → no alarm subscription (reactive-only, dormant)", () => {
			const api = new FakeBrowserApi()
			api.reset()
			const onAlarm = vi.spyOn(api.alarms, "onAlarm")
			const config = fakeConfig()
			const logger = new LoggerStore(config)
			// Port deliberately NOT passed — mirrors the pre-arc `new ProfileService(config, logger)`.
			new ProfileService(config, logger)
			expect(onAlarm).not.toHaveBeenCalled()
		})
	})

	// Q10 proactive-TTL alarm-vs-refresh RACE fix (codex security audit 019ef47d-d5c5).
	// The alarm's close() is routed through ProfileService.runExclusive (the facade lock),
	// so it cannot interleave with a refreshSession() storage write-back. Without that, a
	// refresh().set() landing after the alarm close().delete() would resurrect an expired
	// session on the next SW restore (a TTL bypass).
	describe("TTL alarm-vs-refresh race (serialized close)", () => {
		async function fireTtlAlarm(scheduledTime: number): Promise<void> {
			const { fakeBrowser } = await import("@webext-core/fake-browser")
			fakeBrowser.alarms.onAlarm.trigger({
				name: SESSION_TTL_ALARM_NAME,
				scheduledTime,
				periodInMinutes: undefined,
			} as chrome.alarms.Alarm)
		}
		const readLockedAt = async (api: FakeBrowserApi): Promise<number> => {
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			return (JSON.parse(raw[SESSION_STORAGE_ROOT] as string) as { lockedAt: number }).lockedAt
		}

		test("alarm firing during refreshSession()'s write-back does NOT delete the session mid-write; session stays consistent", async () => {
			const { api, service } = await makeService(60_000)
			const profile = await service.createProfile("P", "pass1234")
			await service.unlockProfile(profile.id, "pass1234")
			const oldLockedAt = await readLockedAt(api)

			// Block the NEXT storage.session.set (refreshSession's write-back) so refresh
			// parks WHILE holding the facade lock.
			let releaseSet!: () => void
			const blocked = new Promise<void>((r) => {
				releaseSet = r
			})
			const sessionArea = api.storage.session
			const origSet = sessionArea.set.bind(sessionArea)
			let armed = true
			sessionArea.set = async (items: Record<string, unknown>) => {
				if (armed) {
					armed = false
					await blocked
				}
				return origSet(items)
			}

			const refreshP = service.refreshSession()
			await flushPromises() // let refresh acquire the lock + park at the blocked set

			// Fire the (now-old) alarm while refresh holds the lock. onAlarmFired routes
			// close() through runExclusive → it BLOCKS on the facade lock.
			await fireTtlAlarm(oldLockedAt)
			await flushPromises()

			// MID-STATE: the alarm's close is serialized behind refresh — it must NOT have
			// deleted the session. (In the un-fixed code the close ran concurrently here.)
			// NB: probe via storage.get (lock-free) — `service.getActiveProfile()` here would
			// block on the facade lock the parked refresh still holds.
			const midRaw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(midRaw[SESSION_STORAGE_ROOT]).toBeDefined()

			// Release refresh's write-back → it finishes (bumps lockedAt + reschedules) +
			// releases the lock → the queued alarm-close runs, finds the gate stale
			// (oldLockedAt ≠ new lockedAt), and no-ops. Session stays active + consistent.
			releaseSet()
			await refreshP
			await flushPromises()

			// Whatever the serialized outcome (refresh-won → extended/active, or alarm-won →
			// locked), in-memory state and a fresh SW restore must AGREE. The bug this fixes is
			// the resurrection HYBRID: the alarm clears memory while a racing refresh re-persists
			// the session, so restore() silently un-expires it. Asserting agreement catches that.
			const memActive = (await service.getActiveProfile()) !== undefined
			const restarted = await makeServiceFromExistingApi(api, { sessionTtl: 60_000 })
			const restoredActive = (await restarted.service.getActiveProfile()) !== undefined
			expect(restoredActive).toBe(memActive)
		}, 30_000)
	})

	// Q10 TTL residual (C1): the CONFIG-driven session writebacks — applyTtlChange
	// (sessionTtl change) and clearBearer (strictSecurityMode toggle) — are now
	// ALSO routed through ProfileService.runExclusive, like the alarm close. Before,
	// they ran lock-free and could interleave with a refreshSession() write-back:
	// a TTL-shorten close could be resurrected (TTL bypass), and clearBearer's
	// stale-snapshot write could clobber a newer lockedAt (lost update).
	describe("config-driven writeback vs refresh race (serialized)", () => {
		const readRoot = async (api: FakeBrowserApi): Promise<string | undefined> => {
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			return raw[SESSION_STORAGE_ROOT] as string | undefined
		}
		const readSession = async (api: FakeBrowserApi): Promise<{ lockedAt?: number; bearer?: SessionWrappedSecret }> => {
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			return JSON.parse(raw[SESSION_STORAGE_ROOT] as string)
		}
		/** Arm a one-shot block on the next storage.session.set so the next writer
		 *  (refresh) parks WHILE holding the facade lock. Returns the release fn. */
		function blockNextSessionSet(api: FakeBrowserApi): () => void {
			let release!: () => void
			const blocked = new Promise<void>((r) => {
				release = r
			})
			const area = api.storage.session
			const origSet = area.set.bind(area)
			let armed = true
			area.set = async (items: Record<string, unknown>) => {
				if (armed) {
					armed = false
					await blocked
				}
				return origSet(items)
			}
			return release
		}

		test("a sessionTtl shorten-to-elapsed close during refresh's write-back does NOT resurrect the session", async () => {
			const { api, config, service } = await makeService(60_000)
			const profile = await service.createProfile("P", "pass1234")
			await service.unlockProfile(profile.id, "pass1234")

			const releaseSet = blockNextSessionSet(api)
			const refreshP = service.refreshSession()
			await flushPromises() // refresh acquires the lock + parks at the blocked set (bumped `since`)

			// Shorten the TTL to ~0 → onConfigUpdated fires applyTtlChange, now routed
			// through runExclusive → it BLOCKS behind the parked refresh.
			config.set("sessionTtl", 1)
			await flushPromises()
			// Advance real time so applyTtlChange's `since + 1 <= now` close branch is
			// deterministic once it runs.
			await new Promise((r) => setTimeout(r, 25))

			// MID-STATE: neither refresh's set nor applyTtlChange's close has run — the
			// session is still in storage (not deleted mid-write).
			expect(await readRoot(api)).toBeDefined()

			// Release refresh → it persists (bumped lockedAt) + releases the lock → the
			// queued applyTtlChange runs, takes the close branch (TTL elapsed), deletes.
			releaseSet()
			await refreshP
			await flushPromises()

			// Memory + a fresh SW restore must AGREE (no resurrection hybrid).
			const memActive = (await service.getActiveProfile()) !== undefined
			const restarted = await makeServiceFromExistingApi(api, { sessionTtl: 1 })
			const restoredActive = (await restarted.service.getActiveProfile()) !== undefined
			expect(restoredActive).toBe(memActive)
			expect(memActive).toBe(false) // TTL shortened-past-elapsed → locked
		}, 30_000)

		test("enabling strict mode during refresh's write-back drops the bearer WITHOUT reverting the bumped lockedAt", async () => {
			const { api, config, service } = await makeService(60_000) // lenient → bearer persisted
			const profile = await service.createProfile("P", "pass1234")
			await service.unlockProfile(profile.id, "pass1234")
			expect((await readSession(api)).bearer).toBeDefined() // lenient bearer cached
			const lockedAtBeforeRefresh = (await readSession(api)).lockedAt as number

			// Ensure refresh bumps `since` strictly past unlock so a stale-snapshot
			// clobber (the bug) would be DETECTABLE as a reverted (smaller) lockedAt.
			await new Promise((r) => setTimeout(r, 12))

			const releaseSet = blockNextSessionSet(api)
			const refreshP = service.refreshSession()
			await flushPromises() // refresh parks holding the lock (in-memory bearer still present)

			// Toggle strict ON → clearBearer() routed through runExclusive → BLOCKS
			// behind the parked refresh.
			config.set("strictSecurityMode", true)
			await flushPromises()

			// Release refresh → persists {bumped lockedAt, bearer present} + releases
			// lock → queued clearBearer runs, re-reads the bumped session, drops the
			// bearer, persists THAT object (not a stale pre-refresh snapshot).
			releaseSet()
			await refreshP
			await flushPromises()

			expect((await service.getActiveProfile()) !== undefined).toBe(true) // strict ≠ force-lock
			const persisted = await readSession(api)
			expect(persisted.bearer).toBeUndefined() // bearer dropped — strict enforced
			// The bumped lockedAt survived: a stale-snapshot write would have reverted it
			// to the pre-refresh value. (Strict deliberately drops the cross-restart bearer,
			// so a SW-restart agreement check does NOT apply here — that's expected, not a hybrid.)
			expect(persisted.lockedAt).toBeGreaterThan(lockedAtBeforeRefresh)
		}, 30_000)
	})
})

describe("ProfileService — deletion coordinator integration (finding D)", () => {
	test("a FAILED purge keeps the tombstone → the id stays reserved (no successor-clobber)", async () => {
		const { service } = await makeService()
		// A delegate whose purge fails, simulating a SW-kill / retryable failure.
		service.setDeletionDelegate({
			snapshot: async () => ({ addresses: [], tokenIds: [], networkIds: [] }),
			runFor: async () => {
				throw new Error("purge interrupted")
			},
		})
		const p = await service.createProfile("A", "password123")

		await expect(service.deleteProfile(p.id)).rejects.toThrow(/purge interrupted/)

		// The profile row is gone AND it's tombstoned → absent to every read.
		expect((await service.getProfiles()).map((x) => x.id)).not.toContain(p.id)
		// A new profile can NEVER be handed the tombstoned id (fail-closed reservation).
		const q = await service.createProfile("B", "password123")
		expect(q.id).not.toBe(p.id)
	})

	test("a SUCCESSFUL purge clears the tombstone + releases the id", async () => {
		const { service } = await makeService() // default no-op (success) delegate
		const p = await service.createProfile("A", "password123")
		await service.deleteProfile(p.id)
		expect(await service.getProfiles()).toHaveLength(0)
	})

	test("resumePendingDeletions finishes an interrupted delete on the next boot", async () => {
		const { api } = await makeService()
		// First boot: a delete whose purge fails leaves a tombstone behind.
		const boot1 = new ProfileService(fakeConfig({}), new LoggerStore(fakeConfig({})), api)
		const c1 = new ServiceCollection()
		c1.add(new FakePasskeyService(new LoggerStore(fakeConfig({}))))
		c1.add(boot1)
		await c1.start()
		boot1.setDeletionDelegate({
			snapshot: async () => ({ addresses: [], tokenIds: [], networkIds: [] }),
			runFor: async () => {
				throw new Error("interrupted")
			},
		})
		const p = await boot1.createProfile("A", "password123")
		await expect(boot1.deleteProfile(p.id)).rejects.toThrow()

		// Second boot over the SAME storage: the tombstone is still there.
		const boot2 = new ProfileService(fakeConfig({}), new LoggerStore(fakeConfig({})), api)
		const c2 = new ServiceCollection()
		c2.add(new FakePasskeyService(new LoggerStore(fakeConfig({}))))
		c2.add(boot2)
		await c2.start()
		let resumed = false
		boot2.setDeletionDelegate({
			snapshot: async () => ({ addresses: [], tokenIds: [], networkIds: [] }),
			runFor: async () => {
				resumed = true
			},
		})
		// Until resume runs, the id is still reserved (deletion pending).
		expect((await boot2.getProfiles()).map((x) => x.id)).not.toContain(p.id)

		await boot2.resumePendingDeletions()

		expect(resumed).toBe(true)
		// A fresh profile can now reuse... no — the id was random; assert the tombstone
		// cleared by confirming a NEW delete of a NEW profile still works cleanly.
		const q = await boot2.createProfile("B", "password123")
		await boot2.deleteProfile(q.id)
		expect(await boot2.getProfiles()).toHaveLength(0)
	})
})

describe("account-integrity delegate — the session-open chokepoint", () => {
	const throwingDelegate = () => {
		const calls: Array<{ profileId: string }> = []
		return {
			calls,
			delegate: {
				verifyBeforeSessionOpen: async (profileId: string) => {
					calls.push({ profileId })
					throw new AccountAddressInconsistencyError()
				},
			},
		}
	}

	test("unlock with a mismatching profile is WITHHELD: typed error, no session", async () => {
		const { service } = await makeService()
		const profile = await service.createProfile("P", "pass1234")
		await service.lockActiveProfile()

		const { calls, delegate } = throwingDelegate()
		service.setIntegrityDelegate(delegate)

		await expect(service.unlockProfile(profile.id, "pass1234")).rejects.toBeInstanceOf(AccountAddressInconsistencyError)
		expect(calls).toEqual([{ profileId: profile.id }])
		expect(await service.getActiveProfile()).toBeUndefined()
	}, 30_000)

	test("STARTUP-WINDOW FAIL-CLOSED: unlock refuses on a durable block even with NO delegate injected yet", async () => {
		const { api, service } = await makeService()
		const profile = await service.createProfile("P", "pass1234")
		await service.lockActiveProfile()

		// Simulate the coordinator having persisted a block on a prior boot, but not yet having
		// injected its delegate this boot (the startup window). No `setIntegrityDelegate` call.
		await new AccountIntegrityBlockedRepository(api.storage.local).set({
			profileId: profile.id,
			chainId: 0,
			accountIndex: 0,
			storedAddress: "0xstored",
			derivedAddress: "0xderived",
			regimeId: "nulo-v5",
			walletVersion: "0.0.0",
			detectedAt: 1,
		})

		await expect(service.unlockProfile(profile.id, "pass1234")).rejects.toBeInstanceOf(AccountAddressInconsistencyError)
		expect(await service.getActiveProfile()).toBeUndefined()
	}, 30_000)

	test("no delegate + NO block: unlock proceeds (the gate is targeted, not a blanket refusal)", async () => {
		const { service } = await makeService()
		const profile = await service.createProfile("P", "pass1234")
		await service.lockActiveProfile()
		// No delegate, no block record.
		const info = await service.unlockProfile(profile.id, "pass1234")
		expect(info.id).toBe(profile.id)
		expect((await service.getActiveProfile())?.id).toBe(profile.id)
	}, 30_000)

	test("backup-import path: finalizeRestore runs the check AFTER restore, BEFORE the session opens", async () => {
		const { service } = await makeService()
		const events: unknown[] = []
		service.onActiveProfileChanged.add((p) => events.push(p))

		const out = await service.restore(
			{ id: "ignored", name: "P", type: "password" },
			{ type: "password", masterKey: asBase64MasterSecret(Buffer.from(new Uint8Array(32).fill(11)).toString("base64")) },
			"pass1234",
		)
		if ("restoreError" in out && out.restoreError) throw new Error(String(out.restoreError))

		// Accounts are restored by the caller between restore() and finalizeRestore() — the
		// delegate registered here stands in for the coordinator seeing a mismatched row.
		const { calls, delegate } = throwingDelegate()
		service.setIntegrityDelegate(delegate)

		await expect(service.finalizeRestore(out.id, "pass1234")).rejects.toBeInstanceOf(AccountAddressInconsistencyError)
		expect(calls).toEqual([{ profileId: out.id }])
		// The mismatched import never activated: no session, no emit.
		expect(await service.getActiveProfile()).toBeUndefined()
		expect(events).toEqual([])
	}, 30_000)

	test("SW-restart persistence: a blocked profile's session is NOT silently rehydrated", async () => {
		const { api, service } = await makeService()
		const profile = await service.createProfile("P", "pass1234")
		expect((await service.getActiveProfile())?.id).toBe(profile.id)

		// The coordinator persisted a blocking record (simulated directly), then the SW died.
		const repo = new AccountIntegrityBlockedRepository(api.storage.local)
		await repo.set({
			profileId: profile.id,
			chainId: 0,
			accountIndex: 0,
			storedAddress: "0xstored",
			derivedAddress: "0xderived",
			regimeId: "nulo-v5",
			walletVersion: "0.0.0",
			detectedAt: 1,
		})

		// Fresh service over the same persisted state = the SW restart.
		const { service: rebooted } = await makeServiceFromExistingApi(api)
		expect(await rebooted.getActiveProfile()).toBeUndefined()
	}, 30_000)

	test("SW-restart control: WITHOUT a blocking record the session rehydrates (gate is targeted)", async () => {
		const { api, service } = await makeService()
		const profile = await service.createProfile("P", "pass1234")
		expect((await service.getActiveProfile())?.id).toBe(profile.id)

		const { service: rebooted } = await makeServiceFromExistingApi(api)
		expect((await rebooted.getActiveProfile())?.id).toBe(profile.id)
	}, 30_000)

	test("deleting a blocked profile clears its blocking record (no orphaned barrier)", async () => {
		const { api, service } = await makeService()
		const profile = await service.createProfile("P", "pass1234")
		const repo = new AccountIntegrityBlockedRepository(api.storage.local)
		await repo.set({
			profileId: profile.id,
			chainId: 0,
			accountIndex: 0,
			storedAddress: "0xstored",
			derivedAddress: "0xderived",
			regimeId: "nulo-v5",
			walletVersion: "0.0.0",
			detectedAt: 1,
		})
		expect(await repo.isBlocked(profile.id)).toBe(true)

		await service.deleteProfile(profile.id)
		expect(await repo.isBlocked(profile.id)).toBe(false)
	}, 30_000)

	test("EPOCH FENCE: a deletion that completes (reserve→release) DURING verify aborts the open", async () => {
		const { service } = await makeService()
		const profile = await service.createProfile("P", "pass1234")
		await service.lockActiveProfile()

		// The delegate stands in for a slow verify; while it runs, a delete fully completes
		// (reserve then release) — `isReserved` is false afterward, but the epoch advanced.
		const state = service.getDeletionState()
		service.setIntegrityDelegate({
			verifyBeforeSessionOpen: async () => {
				state.beginDeletion(profile.id)
				state.release(profile.id)
			},
		})

		await expect(service.unlockProfile(profile.id, "pass1234")).rejects.toThrow(/Invalid profile id/)
		// A deleted profile must never be resurrected — no active session.
		expect(await service.getActiveProfile()).toBeUndefined()
	}, 30_000)

	test("changePassword: a PRE-CHECK integrity block fails honestly — password unchanged + active session closed", async () => {
		const { service } = await makeService()
		const profile = await service.createProfile("P", "oldpass12")
		expect((await service.getActiveProfile())?.id).toBe(profile.id)

		// Drift present BEFORE the change → the pre-persist verify throws.
		service.setIntegrityDelegate({
			verifyBeforeSessionOpen: async () => {
				throw new AccountAddressInconsistencyError()
			},
		})

		await expect(service.changeProfilePassword(profile.id, "oldpass12", "newpass12")).rejects.toBeInstanceOf(
			AccountAddressInconsistencyError,
		)
		// The blocked profile's live session was closed (must not keep operating), and nothing was
		// persisted — the OLD password still unlocks (with the delegate healed).
		expect(await service.getActiveProfile()).toBeUndefined()
		await service.setIntegrityDelegate({ verifyBeforeSessionOpen: async () => {} })
		const reunlocked = await service.unlockProfile(profile.id, "oldpass12")
		expect(reunlocked.id).toBe(profile.id)
	}, 30_000)

	test("changePassword: an integrity block on RE-OPEN commits the password but withholds the session", async () => {
		const { service } = await makeService()
		const profile = await service.createProfile("P", "oldpass12")

		// Pass the PRE-check (before persist), throw on the RE-open (post-persist) — simulating a
		// mismatched account restored between the two. The password change must still report success.
		let call = 0
		service.setIntegrityDelegate({
			verifyBeforeSessionOpen: async () => {
				call++
				if (call >= 2) throw new AccountAddressInconsistencyError()
			},
		})

		const info = await service.changeProfilePassword(profile.id, "oldpass12", "newpass12")
		expect(info.id).toBe(profile.id)
		expect(call).toBe(2)
		// Session withheld (re-open threw + closed), but the NEW password is what's persisted.
		expect(await service.getActiveProfile()).toBeUndefined()
		await service.setIntegrityDelegate({ verifyBeforeSessionOpen: async () => {} })
		const reunlocked = await service.unlockProfile(profile.id, "newpass12")
		expect(reunlocked.id).toBe(profile.id)
	}, 30_000)
})
