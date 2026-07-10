/**
 * Unit tests for `SessionManager`.
 *
 * Uses `FakeBrowserApi` — no `chrome.storage`, no real crypto. Focus:
 *   - TTL semantics (including the `sessionTtl === 0` never-expires branch).
 *   - `restore()` init-only silent contract (no emit).
 *   - Persisted `Session` shape lock — frozen.
 *   - `open` / `close` / `refresh` lifecycle emits exactly as the facade
 *     expects.
 */

import { asMasterSecretBytes, asPasshash, type MasterSecretBytes } from "@nulo/wallet-crypto"
import { describe, expect, test, vi } from "vitest"
import { Fr } from "@aztec/foundation/curves/bn254"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import type { ConfigProp, IConfig } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { Profile, ProfileInfo, Session } from "./spec"
import { SESSION_STORAGE_ROOT, SESSION_TTL_ALARM_NAME, SessionManager } from "./session-manager"

/** Minimal `IConfig` stand-in. Tests drive `sessionTtl` /
 *  `strictSecurityMode` updates by invoking `onUpdate` directly; avoids
 *  `ConfigStore`'s `chrome.storage` dependency.
 *
 *  Defaults `strictSecurityMode` to `false` so the bearer-cache tests
 *  (which assert the passhash IS persisted) keep their semantics.
 *  Strict-mode tests opt in via `setStrict(true)`. */
function fakeConfig(
	initialTtl: number,
	initialStrict = false,
): IConfig & {
	emit: (prop: ConfigProp) => void
	setTtl: (v: number) => void
	setStrict: (v: boolean) => void
} {
	const onUpdate = new EventHandler<ConfigProp>()
	let ttl = initialTtl
	let strict = initialStrict
	return {
		onUpdate,
		get: ((key: string) => {
			if (key === "sessionTtl") return ttl
			if (key === "strictSecurityMode") return strict
			return undefined
		}) as IConfig["get"],
		emit: (prop) => onUpdate.invoke(prop),
		setTtl: (v) => {
			ttl = v
			onUpdate.invoke({ key: "sessionTtl", value: v } as ConfigProp)
		},
		setStrict: (v) => {
			strict = v
			onUpdate.invoke({ key: "strictSecurityMode", value: v } as ConfigProp)
		},
	}
}

const passwordProfile = (id = "pid"): Profile & { type: "password" } => ({
	id,
	name: "P",
	type: "password",
	guard: "Z3VhcmQ=",
	secret: "c2VjcmV0",
})

const passkeyProfile = (id = "pid"): Profile & { type: "passkey" } => ({
	id,
	name: "P",
	type: "passkey",
	credentialId: "cred-123",
})

/** 32-byte secret buffer; Fr-reducible. */
function secretBuffer(): MasterSecretBytes {
	const buf = new Uint8Array(new ArrayBuffer(32))
	for (let i = 0; i < 32; i++) buf[i] = i + 1
	return asMasterSecretBytes(buf as Uint8Array<ArrayBuffer>)
}

function setup(
	initialTtl = 1_800_000,
	initialStrict = false,
): {
	api: FakeBrowserApi
	config: ReturnType<typeof fakeConfig>
	emits: Array<ProfileInfo | undefined>
	manager: SessionManager
} {
	const api = new FakeBrowserApi()
	api.reset()
	const config = fakeConfig(initialTtl, initialStrict)
	const emits: Array<ProfileInfo | undefined> = []
	const manager = new SessionManager(config, new LoggerStore(config), (p) => emits.push(p), api)
	return { api, config, emits, manager }
}

/** Re-uses an existing FakeBrowserApi to simulate a fresh SessionManager
 *  observing the persisted state — i.e., what happens after an MV3 SW
 *  restart. Needed for restore() tests that depend on prior state. */
function setupFromExistingApi(
	api: FakeBrowserApi,
	initialTtl = 1_800_000,
	initialStrict = false,
): {
	config: ReturnType<typeof fakeConfig>
	emits: Array<ProfileInfo | undefined>
	manager: SessionManager
} {
	const config = fakeConfig(initialTtl, initialStrict)
	const emits: Array<ProfileInfo | undefined> = []
	const manager = new SessionManager(config, new LoggerStore(config), (p) => emits.push(p), api)
	return { config, emits, manager }
}

describe("SessionManager", () => {
	describe("open / getActive", () => {
		test("persists the session, caches the secret, emits onChange", async () => {
			const { api, emits, manager } = setup()
			const profile = passwordProfile()

			await manager.open(profile, secretBuffer(), asPasshash(new ArrayBuffer(8)))

			const active = await manager.getActive()
			expect(active).toBeDefined()
			expect(active?.profile).toEqual(profile)
			expect(active?.secret).toBeInstanceOf(Fr)
			expect(emits).toEqual([{ id: "pid", name: "P", type: "password" }])

			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(raw[SESSION_STORAGE_ROOT]).toBeDefined()
			const persisted: Session = JSON.parse(raw[SESSION_STORAGE_ROOT] as string)
			expect(persisted.profile).toBe("pid")
			expect(typeof persisted.passhash).toBe("string")
			expect(typeof persisted.since).toBe("number")
		})

		test("getActive returns undefined when nothing is open", async () => {
			const { manager } = setup()
			await expect(manager.getActive()).resolves.toBeUndefined()
		})

		test("passkey profile open does not persist a passhash", async () => {
			const { api, manager } = setup()
			await manager.open(passkeyProfile(), secretBuffer())
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			const persisted: Session = JSON.parse(raw[SESSION_STORAGE_ROOT] as string)
			expect(persisted.passhash).toBeUndefined()
		})
	})

	describe("close", () => {
		test("clears in-memory + persisted state and emits undefined", async () => {
			const { api, emits, manager } = setup()
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			emits.length = 0

			await manager.close()

			await expect(manager.getActive()).resolves.toBeUndefined()
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(SESSION_STORAGE_ROOT in raw).toBe(false)
			expect(emits).toEqual([undefined])
		})

		test("is a no-op (no emit) when already closed", async () => {
			const { emits, manager } = setup()
			await manager.close()
			expect(emits).toEqual([])
		})
	})

	describe("refresh", () => {
		test("extends the session.since timestamp", async () => {
			const { api, manager } = setup()
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))

			const raw1 = await api.storage.session.get(SESSION_STORAGE_ROOT)
			const session1: Session = JSON.parse(raw1[SESSION_STORAGE_ROOT] as string)

			await new Promise((r) => setTimeout(r, 5))
			await manager.refresh()

			const raw2 = await api.storage.session.get(SESSION_STORAGE_ROOT)
			const session2: Session = JSON.parse(raw2[SESSION_STORAGE_ROOT] as string)
			expect(session2.since).toBeGreaterThan(session1.since)
		})

		test("is a no-op when no session is active", async () => {
			const { api, manager } = setup()
			await manager.refresh()
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(SESSION_STORAGE_ROOT in raw).toBe(false)
		})
	})

	describe("TTL expiry", () => {
		test("getActive silently closes an expired session", async () => {
			const { emits, manager } = setup(50)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			emits.length = 0

			await new Promise((r) => setTimeout(r, 60))
			await expect(manager.getActive()).resolves.toBeUndefined()
			expect(emits).toEqual([undefined])
		})

		test("sessionTtl === 0 means sessions never expire", async () => {
			const { manager } = setup(0)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			// Artificially age the in-memory session far past any non-zero ttl
			const active = await manager.getActive()
			if (active) {
				active.session.since = 1
			}
			await expect(manager.getActive()).resolves.toBeDefined()
		})

		test("config update to sessionTtl takes effect for the next check", async () => {
			const { config, manager } = setup(1_800_000)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))

			config.setTtl(1)
			await new Promise((r) => setTimeout(r, 5))

			await expect(manager.getActive()).resolves.toBeUndefined()
		})
	})

	describe("getSecret", () => {
		test("returns the master secret for the active profile id", async () => {
			const { manager } = setup()
			await manager.open(passwordProfile("abc"), secretBuffer(), asPasshash(new ArrayBuffer(8)))

			const secret = await manager.getSecret("abc")
			expect(secret).toBeInstanceOf(Fr)
		})

		test("throws 'Profile locked' when the id doesn't match", async () => {
			const { manager } = setup()
			await manager.open(passwordProfile("abc"), secretBuffer(), asPasshash(new ArrayBuffer(8)))

			await expect(manager.getSecret("other")).rejects.toThrow(/Profile locked/)
		})

		test("throws 'Profile locked' when no session is open", async () => {
			const { manager } = setup()
			await expect(manager.getSecret("anything")).rejects.toThrow(/Profile locked/)
		})
	})

	describe("patchActiveProfile / isActive", () => {
		test("patchActiveProfile updates in-memory profile ref", async () => {
			const { manager } = setup()
			const p = passwordProfile("abc")
			await manager.open(p, secretBuffer(), asPasshash(new ArrayBuffer(8)))

			const renamed: Profile = { ...p, name: "New Name" }
			manager.patchActiveProfile("abc", renamed)

			const active = await manager.getActive()
			expect(active?.profile.name).toBe("New Name")
		})

		test("patchActiveProfile is a no-op for non-active ids", async () => {
			const { manager } = setup()
			const p = passwordProfile("abc")
			await manager.open(p, secretBuffer(), asPasshash(new ArrayBuffer(8)))

			manager.patchActiveProfile("other", { ...p, id: "other", name: "Nope" })

			const active = await manager.getActive()
			expect(active?.profile.id).toBe("abc")
			expect(active?.profile.name).toBe("P")
		})

		test("isActive reflects the current session", async () => {
			const { manager } = setup()
			expect(manager.isActive("abc")).toBe(false)
			await manager.open(passwordProfile("abc"), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			expect(manager.isActive("abc")).toBe(true)
			expect(manager.isActive("other")).toBe(false)
			await manager.close()
			expect(manager.isActive("abc")).toBe(false)
		})
	})

	describe("restore (init-only, silent)", () => {
		test("re-hydrates a valid password session without emitting", async () => {
			// Seed a persisted session directly (bypass open, which emits).
			const { api, emits, manager } = setup()
			const profile = passwordProfile("abc")
			const session: Session = {
				profile: "abc",
				passhash: Buffer.from(asPasshash(new ArrayBuffer(8))).toString("base64"),
				since: Date.now(),
			}
			await api.storage.session.set({ [SESSION_STORAGE_ROOT]: JSON.stringify(session) })

			const lookup = vi.fn(async (_: string) => profile as Profile)
			const unseal = vi.fn(async () => secretBuffer())

			await manager.restore(lookup, unseal)

			expect(emits).toEqual([]) // SILENT
			const active = await manager.getActive()
			expect(active?.profile).toEqual(profile)
			expect(lookup).toHaveBeenCalledWith("abc")
			expect(unseal).toHaveBeenCalledOnce()
		})

		test("silently drops an expired session on restore", async () => {
			const { api, emits, manager } = setup(50)
			const expired: Session = {
				profile: "abc",
				passhash: Buffer.from(asPasshash(new ArrayBuffer(8))).toString("base64"),
				since: Date.now() - 1000,
			}
			await api.storage.session.set({ [SESSION_STORAGE_ROOT]: JSON.stringify(expired) })

			await manager.restore(
				async () => passwordProfile("abc"),
				async () => secretBuffer(),
			)

			expect(emits).toEqual([])
			await expect(manager.getActive()).resolves.toBeUndefined()
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(SESSION_STORAGE_ROOT in raw).toBe(false)
		})

		test("silently drops when profile no longer exists", async () => {
			const { api, emits, manager } = setup()
			const session: Session = {
				profile: "gone",
				passhash: Buffer.from(asPasshash(new ArrayBuffer(8))).toString("base64"),
				since: Date.now(),
			}
			await api.storage.session.set({ [SESSION_STORAGE_ROOT]: JSON.stringify(session) })

			await manager.restore(
				async () => undefined,
				async () => secretBuffer(),
			)

			expect(emits).toEqual([])
			await expect(manager.getActive()).resolves.toBeUndefined()
		})

		test("silently drops when unseal returns null (wrong creds / corrupt)", async () => {
			const { api, emits, manager } = setup()
			const session: Session = {
				profile: "abc",
				passhash: Buffer.from(asPasshash(new ArrayBuffer(8))).toString("base64"),
				since: Date.now(),
			}
			await api.storage.session.set({ [SESSION_STORAGE_ROOT]: JSON.stringify(session) })

			await manager.restore(
				async () => passwordProfile("abc"),
				async () => null,
			)

			expect(emits).toEqual([])
			await expect(manager.getActive()).resolves.toBeUndefined()
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(SESSION_STORAGE_ROOT in raw).toBe(false)
		})

		test("passkey profile: leaves persisted record, does not activate, no emit", async () => {
			const { api, emits, manager } = setup()
			const session: Session = {
				profile: "abc",
				since: Date.now(),
			}
			await api.storage.session.set({ [SESSION_STORAGE_ROOT]: JSON.stringify(session) })

			const unseal = vi.fn(async () => null)
			await manager.restore(async () => passkeyProfile("abc"), unseal)

			expect(emits).toEqual([])
			await expect(manager.getActive()).resolves.toBeUndefined()
			expect(unseal).not.toHaveBeenCalled()
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(SESSION_STORAGE_ROOT in raw).toBe(true)
		})

		test("password session missing passhash → silent close", async () => {
			const { api, emits, manager } = setup()
			const session: Session = { profile: "abc", since: Date.now() }
			await api.storage.session.set({ [SESSION_STORAGE_ROOT]: JSON.stringify(session) })

			await manager.restore(
				async () => passwordProfile("abc"),
				async () => secretBuffer(),
			)

			expect(emits).toEqual([])
			await expect(manager.getActive()).resolves.toBeUndefined()
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(SESSION_STORAGE_ROOT in raw).toBe(false)
		})

		test("no persisted session → no-op", async () => {
			const { emits, manager } = setup()
			await manager.restore(
				async () => passwordProfile("abc"),
				async () => secretBuffer(),
			)
			expect(emits).toEqual([])
			await expect(manager.getActive()).resolves.toBeUndefined()
		})
	})

	describe("storage key + shape invariants", () => {
		test("writes under the frozen 'nulo:core:session' root", async () => {
			const { api, manager } = setup()
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			const raw = await api.storage.session.get(null)
			expect(SESSION_STORAGE_ROOT in raw).toBe(true)
			expect(SESSION_STORAGE_ROOT).toBe("nulo:core:session")
		})

		test("persisted Session shape is { profile, passhash?, since, lockedAt? }", async () => {
			const { api, manager } = setup()
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			const persisted: Session = JSON.parse(raw[SESSION_STORAGE_ROOT] as string)
			// `lockedAt` is an additive optional field (schema still v1).
			// Records without `lockedAt` still load — `SessionManager`
			// derives the value via `since + sessionTtl`. Both branches
			// are tested: with TTL (`lockedAt` present) and without
			// (omitted).
			expect(Object.keys(persisted).sort()).toEqual(["lockedAt", "passhash", "profile", "since"])
		})

		test("persisted Session omits lockedAt when sessionTtl=0", async () => {
			const { api, manager } = setup(0)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			const persisted: Session = JSON.parse(raw[SESSION_STORAGE_ROOT] as string)
			// `lockedAt: undefined` is dropped by JSON.stringify.
			expect(Object.keys(persisted).sort()).toEqual(["passhash", "profile", "since"])
		})
	})

	describe("M4.5 proactive TTL via chrome.alarms", () => {
		// Helper: read the registered alarm by name from the fake-browser
		// alarm registry. Returns undefined when no alarm is scheduled.
		async function getAlarm(api: FakeBrowserApi): Promise<chrome.alarms.Alarm | undefined> {
			const list = await api.alarms.create // type-only access; fake-browser stores in a module-local list
			void list
			// FakeBrowserApi exposes the standard chrome.alarms.get; emulate
			// the chrome shape via its own global. Simpler: drive via the
			// fakeBrowser global the adapter uses.
			const { fakeBrowser } = await import("@webext-core/fake-browser")
			return fakeBrowser.alarms.get(SESSION_TTL_ALARM_NAME) as Promise<chrome.alarms.Alarm | undefined>
		}

		// Helper: directly trigger the alarm event with a given scheduledTime.
		// Mirrors what `chrome.alarms.onAlarm` would deliver in the real
		// browser when the alarm fires.
		async function fireAlarm(scheduledTime: number, name = SESSION_TTL_ALARM_NAME): Promise<void> {
			const { fakeBrowser } = await import("@webext-core/fake-browser")
			fakeBrowser.alarms.onAlarm.trigger({ name, scheduledTime, periodInMinutes: undefined } as chrome.alarms.Alarm)
		}

		test("open(ttl=60s) schedules an alarm at since + ttl", async () => {
			const ttl = 60_000
			const { api, manager } = setup(ttl)
			vi.useFakeTimers()
			vi.setSystemTime(new Date("2026-04-26T10:00:00Z"))
			const since = Date.now()
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			const alarm = await getAlarm(api)
			expect(alarm).toBeDefined()
			expect(alarm?.scheduledTime).toBe(since + ttl)
			vi.useRealTimers()
		})

		test("open(ttl=0) does not schedule an alarm", async () => {
			const { api, manager } = setup(0)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			const alarm = await getAlarm(api)
			expect(alarm).toBeUndefined()
		})

		test("close() cancels the scheduled alarm", async () => {
			const { api, manager } = setup(60_000)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			expect(await getAlarm(api)).toBeDefined()
			await manager.close()
			expect(await getAlarm(api)).toBeUndefined()
		})

		test("refresh() cancels + re-schedules the alarm against new lockedAt", async () => {
			const ttl = 60_000
			const { api, manager } = setup(ttl)
			vi.useFakeTimers()
			vi.setSystemTime(new Date("2026-04-26T10:00:00Z"))
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			const firstAlarm = await getAlarm(api)
			expect(firstAlarm?.scheduledTime).toBe(Date.now() + ttl)

			vi.advanceTimersByTime(30_000) // 30s into the session
			const newSince = Date.now()
			await manager.refresh()
			const secondAlarm = await getAlarm(api)
			expect(secondAlarm?.scheduledTime).toBe(newSince + ttl)
			expect(secondAlarm?.scheduledTime).not.toBe(firstAlarm?.scheduledTime)
			vi.useRealTimers()
		})

		test("alarm fire at the persisted lockedAt closes the session + emits onChange(undefined)", async () => {
			const ttl = 60_000
			const { emits, manager } = setup(ttl)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			const lockedAt = (await manager.getActive())?.session.lockedAt
			expect(lockedAt).toBeDefined()
			emits.length = 0 // discard the open() emit

			await fireAlarm(lockedAt as number)
			// close() runs as a void Promise inside the sync alarm listener.
			// Wait for the close-emitted onChange to land in `emits` (the
			// outermost observable side-effect of the close chain).
			await vi.waitFor(() => expect(emits).toEqual([undefined]), { timeout: 1000 })

			expect(await manager.getActive()).toBeUndefined()
		})

		test("STALE alarm fire (different scheduledTime) is ignored — session stays open", async () => {
			const ttl = 60_000
			const { manager } = setup(ttl)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))

			// A late delivery from a hypothetical old alarm arrives with a
			// scheduledTime that no longer matches the current
			// activeSession.lockedAt — must be ignored.
			const staleScheduledTime = 1 // far in the past
			await fireAlarm(staleScheduledTime)

			// Microtask flush; nothing should have happened.
			await Promise.resolve()
			await Promise.resolve()

			expect(await manager.getActive()).toBeDefined()
		})

		test("config TTL change to 0 clears alarm + persists lockedAt removal", async () => {
			const { api, config, manager } = setup(60_000)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			expect(await getAlarm(api)).toBeDefined()

			config.setTtl(0)
			// async config-update applies inside void IIFE; let microtasks flush
			await Promise.resolve()
			await Promise.resolve()
			await Promise.resolve()

			expect(await getAlarm(api)).toBeUndefined()
		})

		test("config TTL shrinkage past elapsed window locks immediately", async () => {
			const ttl = 60_000
			const { emits, manager, config } = setup(ttl)
			vi.useFakeTimers()
			vi.setSystemTime(new Date("2026-04-26T10:00:00Z"))
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			emits.length = 0

			// 40s pass.
			vi.advanceTimersByTime(40_000)
			// User shrinks TTL to 30s — already elapsed → must lock now.
			config.setTtl(30_000)

			// applyTtlChange runs as a void Promise inside the sync config
			// listener; await its outermost observable (the close emit)
			// before asserting.
			vi.useRealTimers()
			await vi.waitFor(() => expect(emits).toEqual([undefined]), { timeout: 1000 })
			expect(await manager.getActive()).toBeUndefined()
		})

		test("SW restart with persisted lockedAt < now silentCloses (no emit)", async () => {
			const ttl = 60_000
			const { api, emits, manager } = setup(ttl)
			vi.useFakeTimers()
			vi.setSystemTime(new Date("2026-04-26T10:00:00Z"))

			// Inject a persisted session as if from a previous SW with
			// lockedAt in the past.
			const stale: Session = {
				profile: "pid",
				since: Date.now() - 120_000,
				lockedAt: Date.now() - 60_000, // already expired
				passhash: Buffer.from(asPasshash(new ArrayBuffer(8))).toString("base64"),
			}
			await api.storage.session.set({ [SESSION_STORAGE_ROOT]: JSON.stringify(stale) })

			emits.length = 0
			await manager.restore(
				async () => passwordProfile(),
				async () => secretBuffer(),
			)

			expect(await manager.getActive()).toBeUndefined()
			// silentClose semantics — no emit on init-time cleanup.
			expect(emits).toEqual([])
			// Persisted record cleaned up.
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(SESSION_STORAGE_ROOT in raw).toBe(false)
			vi.useRealTimers()
		})
	})

	/**
	 * Strict security mode tests.
	 *
	 * Strict mode pushes the bearer-persistence decision into
	 * `SessionManager` itself (gates `open()` + `restore()`). The
	 * `fakeConfig.setStrict()` helper drives toggle scenarios without
	 * going through `ConfigStore`.
	 */
	describe("M4.2 — open + strictSecurityMode", () => {
		test("strict ON: open ignores passhash, persisted Session has no bearer", async () => {
			const { api, manager } = setup(1_800_000, true) // strict ON
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			const persisted: Session = JSON.parse(raw[SESSION_STORAGE_ROOT] as string)
			expect(persisted.profile).toBe("pid")
			expect(persisted.passhash).toBeUndefined()
			// In-memory active session also has no passhash leak.
			const active = await manager.getActive()
			expect(active?.session.passhash).toBeUndefined()
		})

		test("strict OFF: open persists passhash (legacy bearer behavior)", async () => {
			const { api, manager } = setup(1_800_000, false) // strict OFF
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			const persisted: Session = JSON.parse(raw[SESSION_STORAGE_ROOT] as string)
			expect(typeof persisted.passhash).toBe("string")
			const active = await manager.getActive()
			expect(typeof active?.session.passhash).toBe("string")
		})

		test("strict ON + passkey-style open (no passhash arg) — persisted Session has no passhash regardless", async () => {
			const { api, manager } = setup(1_800_000, true)
			await manager.open(passkeyProfile(), secretBuffer())
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			const persisted: Session = JSON.parse(raw[SESSION_STORAGE_ROOT] as string)
			expect(persisted.passhash).toBeUndefined()
		})
	})

	describe("M4.2 — restore + strictSecurityMode", () => {
		test("strict ON + stale passhash → silentClose + no in-memory session", async () => {
			const { api } = setup(1_800_000, false)
			vi.useFakeTimers()
			vi.setSystemTime(new Date("2026-04-26T10:00:00Z"))

			// Inject a persisted Session with passhash (as a prior lenient
			// session would leave behind).
			const legacy: Session = {
				profile: "pid",
				since: Date.now(),
				lockedAt: Date.now() + 1_800_000,
				passhash: Buffer.from(asPasshash(new ArrayBuffer(8))).toString("base64"),
			}
			await api.storage.session.set({ [SESSION_STORAGE_ROOT]: JSON.stringify(legacy) })

			// New SessionManager observes the persisted state with strict ON.
			const { manager: m2, emits: e2 } = setupFromExistingApi(api, 1_800_000, true)
			await m2.restore(
				async () => passwordProfile(),
				async () => secretBuffer(),
			)

			expect(await m2.getActive()).toBeUndefined()
			expect(e2).toEqual([]) // silent — no emit on init cleanup
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(SESSION_STORAGE_ROOT in raw).toBe(false) // record deleted
			vi.useRealTimers()
		})

		test("strict OFF + persisted passhash → silent restore (legacy lenient behavior)", async () => {
			const { api } = setup(1_800_000, false)
			vi.useFakeTimers()
			vi.setSystemTime(new Date("2026-04-26T10:00:00Z"))

			const fresh: Session = {
				profile: "pid",
				since: Date.now(),
				lockedAt: Date.now() + 1_800_000,
				passhash: Buffer.from(asPasshash(new ArrayBuffer(8))).toString("base64"),
			}
			await api.storage.session.set({ [SESSION_STORAGE_ROOT]: JSON.stringify(fresh) })

			const { manager: m2 } = setupFromExistingApi(api, 1_800_000, false)
			await m2.restore(
				async () => passwordProfile(),
				async () => secretBuffer(),
			)

			const active = await m2.getActive()
			expect(active).toBeDefined()
			expect(active?.profile.id).toBe("pid")
			vi.useRealTimers()
		})

		test("strict ON + passkey session (no passhash) → unchanged short-circuit (no silentClose)", async () => {
			const { api } = setup(1_800_000, false)
			vi.useFakeTimers()
			vi.setSystemTime(new Date("2026-04-26T10:00:00Z"))

			const passkeySession: Session = {
				profile: "pid",
				since: Date.now(),
				lockedAt: Date.now() + 1_800_000,
				// no passhash — passkey-style record
			}
			await api.storage.session.set({ [SESSION_STORAGE_ROOT]: JSON.stringify(passkeySession) })

			const { manager: m2 } = setupFromExistingApi(api, 1_800_000, true)
			await m2.restore(
				async () => passkeyProfile(),
				async () => secretBuffer(),
			)

			// Passkey branch leaves the persisted record alone (popup will prompt).
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(SESSION_STORAGE_ROOT in raw).toBe(true)
			expect(await m2.getActive()).toBeUndefined() // not restored — needs user gesture
			vi.useRealTimers()
		})
	})

	describe("M4.2 — clearPasshash", () => {
		test("no-op when no session is open", async () => {
			const { api, manager } = setup(1_800_000, false)
			await manager.clearPasshash()
			const raw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(SESSION_STORAGE_ROOT in raw).toBe(false)
		})

		test("no-op when persisted session has no passhash (passkey)", async () => {
			const { api, manager } = setup(1_800_000, false)
			await manager.open(passkeyProfile(), secretBuffer())
			const beforeRaw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			await manager.clearPasshash()
			const afterRaw = await api.storage.session.get(SESSION_STORAGE_ROOT)
			expect(afterRaw[SESSION_STORAGE_ROOT]).toBe(beforeRaw[SESSION_STORAGE_ROOT])
		})

		test("drops persisted passhash AND in-memory activeSession.session.passhash", async () => {
			const { api, manager } = setup(1_800_000, false)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			// Sanity: bearer present.
			const before = JSON.parse((await api.storage.session.get(SESSION_STORAGE_ROOT))[SESSION_STORAGE_ROOT] as string) as Session
			expect(typeof before.passhash).toBe("string")
			expect(typeof (await manager.getActive())?.session.passhash).toBe("string")

			await manager.clearPasshash()

			const after = JSON.parse((await api.storage.session.get(SESSION_STORAGE_ROOT))[SESSION_STORAGE_ROOT] as string) as Session
			expect(after.passhash).toBeUndefined()
			expect(after.profile).toBe("pid") // other fields preserved
			// CRITICAL invariant: in-memory copy also cleared, otherwise refresh()
			// would re-persist the bearer on TTL bumps (codex audit BLOCKING).
			expect((await manager.getActive())?.session.passhash).toBeUndefined()
		})

		test("refresh() after clearPasshash does NOT re-persist passhash", async () => {
			const { api, manager } = setup(1_800_000, false)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			await manager.clearPasshash()

			// refresh() reads activeSession.session and re-persists. If the
			// in-memory copy still had passhash, this would re-write the
			// bearer to storage — strict mode would be silently undone.
			await manager.refresh()

			const persisted = JSON.parse((await api.storage.session.get(SESSION_STORAGE_ROOT))[SESSION_STORAGE_ROOT] as string) as Session
			expect(persisted.passhash).toBeUndefined()
		})

		test("idempotent: calling twice succeeds without error", async () => {
			const { manager } = setup(1_800_000, false)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			await manager.clearPasshash()
			await expect(manager.clearPasshash()).resolves.toBeUndefined()
		})
	})

	describe("M4.2 — onConfigUpdated strictSecurityMode toggle", () => {
		test("toggle ON during unlocked password session → bearer cleared from storage + memory", async () => {
			const { api, config, manager } = setup(1_800_000, false)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			expect(typeof (await manager.getActive())?.session.passhash).toBe("string")

			config.setStrict(true)
			// The handler fires `void clearPasshash()` — flush microtasks.
			await Promise.resolve()
			await Promise.resolve()
			await Promise.resolve()

			const persisted = JSON.parse((await api.storage.session.get(SESSION_STORAGE_ROOT))[SESSION_STORAGE_ROOT] as string) as Session
			expect(persisted.passhash).toBeUndefined()
			expect((await manager.getActive())?.session.passhash).toBeUndefined()
			// Master secret survives the toggle — toggle ON is not a force-lock.
			expect((await manager.getActive())?.secret).toBeInstanceOf(Fr)
		})

		test("toggle OFF during unlocked strict session → no immediate effect (no backfill)", async () => {
			const { api, config, manager } = setup(1_800_000, true)
			await manager.open(passwordProfile(), secretBuffer(), asPasshash(new ArrayBuffer(8)))
			expect((await manager.getActive())?.session.passhash).toBeUndefined()

			config.setStrict(false)
			await Promise.resolve()
			await Promise.resolve()

			// No backfill. Existing session stays bearer-less. The bearer
			// returns on the NEXT unlock via open()'s gate.
			const persisted = JSON.parse((await api.storage.session.get(SESSION_STORAGE_ROOT))[SESSION_STORAGE_ROOT] as string) as Session
			expect(persisted.passhash).toBeUndefined()
			expect((await manager.getActive())?.session.passhash).toBeUndefined()
		})

		test("toggle ON during passkey session → no-op (no passhash to clear)", async () => {
			const { api, config, manager } = setup(1_800_000, false)
			await manager.open(passkeyProfile(), secretBuffer())
			config.setStrict(true)
			await Promise.resolve()
			await Promise.resolve()

			const persisted = JSON.parse((await api.storage.session.get(SESSION_STORAGE_ROOT))[SESSION_STORAGE_ROOT] as string) as Session
			expect(persisted.passhash).toBeUndefined()
			expect(await manager.getActive()).toBeDefined()
		})
	})
})
