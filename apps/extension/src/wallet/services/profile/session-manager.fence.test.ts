/**
 * N-12 pins — the session ARTIFACT fence (adoption of audit proof f1-1,
 * rewritten to repo conventions; the audit/ copy is untouched).
 *
 * The hazard: `getActive()`'s expiry-triggered `close()` runs off the facade
 * lock, so its row-delete / alarm-clear legs can interleave with a concurrent
 * `open()` and destroy the SUCCESSOR session's artifacts (the singleton
 * `nulo:core:session` row + the one global TTL alarm — lazy auto-lock dead).
 * The fix serializes the artifact operations under a private mutex and makes
 * open's generation bump its LAST act (the commit point), which a stale
 * close's in-mutex re-check stands down against.
 */

import { asImportedKeysDek, asMasterSecretBytes, asPasshash, type MasterSecretBytes } from "@nulo/wallet-crypto"
import { describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ConfigProp, IConfig } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import type { ActiveSession, Profile, ProfileInfo } from "./spec"
import { SESSION_STORAGE_ROOT, SESSION_TTL_ALARM_NAME, SessionManager } from "./session-manager"

function _deferred<T = void>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function fakeConfig(initialTtl: number): IConfig {
	const onUpdate = new EventHandler<ConfigProp>()
	return {
		onUpdate,
		get: ((key: string) => {
			if (key === "sessionTtl") return initialTtl
			if (key === "strictSecurityMode") return false
			return undefined
		}) as IConfig["get"],
	}
}

const profileA: Profile & { type: "password" } = {
	id: "prof-A",
	name: "A",
	type: "password",
	pxeGeneration: "gen-test",
	dekSealed: "ZGVrLXNlYWxlZA==",
	walletFingerprint: "fp-test",
	guard: "Z3VhcmQ=",
	secret: "c2VjcmV0",
	entropy: "ZW50cm9weQ==",
	envelopeMac: "bWFj",
}
const profileB: Profile & { type: "password" } = { ...profileA, id: "prof-B", name: "B" }

function secretBuffer(): MasterSecretBytes {
	const buf = new Uint8Array(new ArrayBuffer(32))
	for (let i = 0; i < 32; i++) buf[i] = i + 1
	return asMasterSecretBytes(buf as Uint8Array<ArrayBuffer>)
}

/** Ordered log of every artifact operation, so ordering assertions can see
 *  exactly which session's row/alarm each op targeted. */
function instrument(api: FakeBrowserApi) {
	const events: string[] = []
	const storage = api.storage.session
	const alarms = api.alarms
	const rawSet = storage.set.bind(storage)
	const rawRemove = storage.remove.bind(storage)
	const rawCreate = alarms.create.bind(alarms)
	const rawClear = alarms.clear.bind(alarms)
	storage.set = async (items: Record<string, unknown>) => {
		if (SESSION_STORAGE_ROOT in items) {
			const parsed = JSON.parse(items[SESSION_STORAGE_ROOT] as string) as { profile: string }
			events.push(`row-set:${parsed.profile}`)
		}
		return rawSet(items)
	}
	storage.remove = async (keys: string | string[]) => {
		if (keys === SESSION_STORAGE_ROOT || (Array.isArray(keys) && keys.includes(SESSION_STORAGE_ROOT))) {
			events.push("row-delete")
		}
		return rawRemove(keys)
	}
	alarms.create = async (name: string, options: { when?: number }) => {
		if (name === SESSION_TTL_ALARM_NAME) events.push("alarm-create")
		return rawCreate(name, options)
	}
	alarms.clear = async (name: string) => {
		if (name === SESSION_TTL_ALARM_NAME) events.push("alarm-clear")
		return rawClear(name)
	}
	return { events, rawRemove, rawSet }
}

function setup(ttl = 1_800_000) {
	const api = new FakeBrowserApi()
	api.reset()
	const config = fakeConfig(ttl)
	const emits: Array<ProfileInfo | undefined> = []
	const manager = new SessionManager(config, new LoggerStore(config), (p) => emits.push(p), api)
	return { api, emits, manager }
}

/** Expire the active session in place (the proof's own technique). */
function expireActive(manager: SessionManager): ActiveSession {
	const active = (manager as unknown as { activeSession: ActiveSession }).activeSession
	active.session.lockedAt = Date.now() - 1
	return active
}

async function readRow(api: FakeBrowserApi): Promise<string | undefined> {
	const raw = (await api.storage.session.get(SESSION_STORAGE_ROOT))[SESSION_STORAGE_ROOT]
	if (typeof raw !== "string") return undefined
	return (JSON.parse(raw) as { profile: string }).profile
}

describe("SessionManager artifact fence (N-12 / f1-1 adoption)", () => {
	test("a close parked inside its delete serializes the successor open BEHIND it — B's artifacts land intact", async () => {
		const { api, manager } = setup()
		const { events, rawRemove } = instrument(api)
		await manager.open(profileA, secretBuffer())
		expireActive(manager)

		// Gate the row delete: A's expiry close will park INSIDE the mutex.
		const gate = _deferred()
		api.storage.session.remove = async (keys: string | string[]) => {
			events.push("row-delete")
			await gate.promise
			return rawRemove(keys)
		}
		const closing = manager.getActive() // triggers close(A), parks in delete
		await new Promise((r) => setTimeout(r, 0))
		expect(events).toContain("row-delete")

		// B's open queues on the artifact mutex — nothing of B lands yet.
		const opening = manager.open(profileB, secretBuffer())
		await new Promise((r) => setTimeout(r, 0))
		expect(events.filter((e) => e === "row-set:prof-B")).toHaveLength(0)

		gate.resolve()
		await Promise.all([closing, opening])

		// Serialized ordering: A's delete + A's alarm-clear complete FIRST,
		// then B's row + B's alarm — so B's alarm is never cleared.
		expect(await readRow(api)).toBe("prof-B")
		const lastClear = events.lastIndexOf("alarm-clear")
		const bCreate = events.lastIndexOf("alarm-create")
		expect(bCreate).toBeGreaterThan(lastClear)
		expect((manager as unknown as { activeSession?: ActiveSession }).activeSession?.profile.id).toBe("prof-B")
	})

	test("a stale close whose head ran pre-open stands down at the generation re-check (the load-bearing mid-ordering)", async () => {
		// close(A)'s sync head runs while A is still installed (identity guard
		// passes, pre-bump generation captured) — then a listener-driven open(B)
		// wins the mutex, fully commits (bump), and the stale close's section
		// must MISMATCH and stand down. Without the generation re-check this
		// deletes B's row and clears B's alarm. The reentrant open mirrors
		// production: the lock-emit (onChange undefined) drives UI that can
		// immediately unlock.
		const { api, emits, manager } = setup()
		const { events } = instrument(api)
		await manager.open(profileA, secretBuffer())
		expireActive(manager)

		// On the FIRST lock emit (close's head), synchronously start open(B):
		// its artifact section enqueues on the mutex BEFORE the close's section
		// (the close's enter() runs only after the head's emit returns).
		let opening: Promise<void> | undefined
		const emitsBefore = emits.length
		const origPush = emits.push.bind(emits)
		emits.push = (p: ProfileInfo | undefined) => {
			const n = origPush(p)
			if (p === undefined && emits.length === emitsBefore + 1) {
				opening = manager.open(profileB, secretBuffer())
			}
			return n
		}

		await manager.getActive() // A expired → close(A): head emits → open(B) races in
		await opening
		await new Promise((r) => setTimeout(r, 0))

		// B survived the stale close: row present, alarm created after any clear.
		expect(await readRow(api)).toBe("prof-B")
		const lastClear = events.lastIndexOf("alarm-clear")
		expect(events.lastIndexOf("alarm-create")).toBeGreaterThan(lastClear)
		expect((manager as unknown as { activeSession?: ActiveSession }).activeSession?.profile.id).toBe("prof-B")
	})

	test("a fully-completed successor open stands a stale close down at the identity guard — nothing of B is touched", async () => {
		const { api, manager } = setup()
		const { events } = instrument(api)
		await manager.open(profileA, secretBuffer())
		const staleA = expireActive(manager)

		// B lands COMPLETELY first (replace-open wipes A's in-memory DEK).
		await manager.open(profileB, secretBuffer())
		const eventsAtOpenDone = events.length

		// The stale expiry close for A (identity guard: activeSession is B now).
		await manager.close(staleA)

		expect(events.length).toBe(eventsAtOpenDone) // zero artifact ops from the stale close
		expect(await readRow(api)).toBe("prof-B")
		expect((manager as unknown as { activeSession?: ActiveSession }).activeSession?.profile.id).toBe("prof-B")
	})

	test("a failed open (pre-section) never bumps — a pending close still completes A's cleanup", async () => {
		const { api, manager } = setup()
		instrument(api)
		await manager.open(profileA, secretBuffer())
		expireActive(manager)

		// Force open(B) to fail BEFORE its artifact section: the bearer wrap
		// (crypto prep, deliberately outside the mutex) throws.
		const box = (manager as unknown as { sessionSecretBox: { wrapPair: () => Promise<never> } }).sessionSecretBox
		box.wrapPair = async () => {
			throw new Error("crypto prep failed")
		}
		const dek = new Uint8Array(new ArrayBuffer(32)) as Uint8Array<ArrayBuffer>
		await manager.open(profileB, secretBuffer(), asPasshash(new ArrayBuffer(32)), asImportedKeysDek(dek))

		// The failed open bumped nothing: A's expiry close proceeds normally.
		await manager.getActive()
		expect(await readRow(api)).toBeUndefined() // A's row deleted
		expect(await api.alarms.clear(SESSION_TTL_ALARM_NAME)).toBe(false) // alarm already cleared
	})

	test("rejection-after-write, CONFIRMED branch: compensation deletes, B commits — a PENDING close stands down", async () => {
		const { api, emits, manager } = setup()
		const { events, rawSet } = instrument(api)
		await manager.open(profileA, secretBuffer())
		expireActive(manager)

		// session.set WRITES then rejects (indeterminate-write simulation).
		api.storage.session.set = async (items: Record<string, unknown>) => {
			if (SESSION_STORAGE_ROOT in items) {
				events.push("row-set:reject-after-write")
				await rawSet(items)
				throw new Error("storage flaked after write")
			}
			return rawSet(items)
		}

		// A's expiry close heads first; its lock-emit drives open(B) into the
		// mutex ahead of the close's queued section (the pending close).
		let opening: Promise<void> | undefined
		const origPush = emits.push.bind(emits)
		let fired = false
		emits.push = (p: ProfileInfo | undefined) => {
			const n = origPush(p)
			if (p === undefined && !fired) {
				fired = true
				opening = manager.open(profileB, secretBuffer())
			}
			return n
		}
		await manager.getActive() // close(A): head → open(B) races in → close queues
		await opening
		await new Promise((r) => setTimeout(r, 0))

		// B committed as a degraded in-memory successor (row compensated away,
		// alarm live, generation bumped) — so the pending close STOOD DOWN:
		// B's alarm survives and the in-memory session is B's.
		expect(await readRow(api)).toBeUndefined()
		expect((manager as unknown as { activeSession?: ActiveSession }).activeSession?.profile.id).toBe("prof-B")
		const lastClear = events.lastIndexOf("alarm-clear")
		expect(events.lastIndexOf("alarm-create")).toBeGreaterThan(lastClear)
	})

	test("rejection-after-write, UNCONFIRMABLE branch: no install, NO BUMP — the pending close completes cleanup (bump-first reverts red)", async () => {
		const { api, emits, manager } = setup()
		const { rawSet, rawRemove } = instrument(api)
		await manager.open(profileA, secretBuffer())
		expireActive(manager)

		// set writes-then-rejects; the FIRST remove (open's compensation) also
		// fails → read-back sees the row → open uninstalls WITHOUT bumping.
		// Later removes (the pending close's delete) succeed.
		api.storage.session.set = async (items: Record<string, unknown>) => {
			await rawSet(items)
			throw new Error("storage flaked after write")
		}
		let removeCalls = 0
		api.storage.session.remove = async (keys: string | string[]) => {
			removeCalls += 1
			if (removeCalls === 1) throw new Error("delete also failed")
			return rawRemove(keys)
		}

		// The pending close: A's expiry close heads first (captures the
		// PRE-open generation), open(B) wins the mutex via the lock-emit.
		let opening: Promise<void> | undefined
		const origPush = emits.push.bind(emits)
		let fired = false
		emits.push = (p: ProfileInfo | undefined) => {
			const n = origPush(p)
			if (p === undefined && !fired) {
				fired = true
				opening = manager.open(profileB, secretBuffer())
			}
			return n
		}
		await manager.getActive()
		await opening
		await new Promise((r) => setTimeout(r, 0))

		// The failed open never bumped → the pending close's re-check MATCHED
		// and it completed cleanup: the half-written row is GONE. (Under a
		// bump-first revert the close stands down and B's rejected row
		// survives — this assertion is the bump-LAST discriminator.)
		expect(await readRow(api)).toBeUndefined()
		expect((manager as unknown as { activeSession?: ActiveSession }).activeSession).toBeUndefined()
	})

	test("mid-open expiry close (parked at the bearer wrap, pre-section): close completes fully, then B lands intact", async () => {
		const { api, manager } = setup()
		const { events } = instrument(api)
		await manager.open(profileA, secretBuffer())
		expireActive(manager)

		// Park open(B) at wrapPair — the section's one slow crypto await,
		// deliberately OUTSIDE the mutex — so the expiry close can run to
		// completion while B prepares.
		const gate = _deferred()
		const box = (manager as unknown as { sessionSecretBox: { wrapPair: () => Promise<unknown> } }).sessionSecretBox
		box.wrapPair = async () => {
			await gate.promise
			return { v: 2 } as never // dummy bearer — the row stores it opaquely
		}
		const dek = new Uint8Array(new ArrayBuffer(32)) as Uint8Array<ArrayBuffer>
		const opening = manager.open(profileB, secretBuffer(), asPasshash(new ArrayBuffer(32)), asImportedKeysDek(dek))
		await new Promise((r) => setTimeout(r, 0))

		await manager.getActive() // A expired → close runs to COMPLETION (row + alarm gone)
		expect(await readRow(api)).toBeUndefined()

		gate.resolve()
		await opening
		expect(await readRow(api)).toBe("prof-B")
		const lastClear = events.lastIndexOf("alarm-clear")
		expect(events.lastIndexOf("alarm-create")).toBeGreaterThan(lastClear)
		expect((manager as unknown as { activeSession?: ActiveSession }).activeSession?.profile.id).toBe("prof-B")
	})

	test("the artifact mutex's watchdog is DISABLED (load-bearing config)", () => {
		const { manager } = setup()
		// A default 5-min force-release would re-admit a successor's section
		// into a stalled close's — the N-12 interleaving reborn inside the fix.
		const lock = (manager as unknown as { artifactLock: { maxHoldMs: number | null } }).artifactLock
		expect(lock.maxHoldMs).toBeNull()
	})
})
