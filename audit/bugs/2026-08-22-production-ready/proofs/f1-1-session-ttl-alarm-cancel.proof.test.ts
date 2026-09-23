/**
 * BUG PROOF — F1-1: the reader-triggered reactive TTL close runs OUTSIDE the
 * facade serializer, so its trailing `clearLockAlarm()` can cancel a freshly
 * scheduled alarm belonging to a session opened in between (auto-lock silently
 * degrades to lazy for that session).
 *
 * Interleaving proven here:
 *  1. Session A is expired; proactive TTL is down (its one-shot was lost).
 *  2. A lock-free reader (`getSecret` → `getActive`) sees A expired and calls
 *     `close()`, which suspends on `session.delete()` (we hold it).
 *  3. While suspended, `open(B)` commits memory + storage and schedules B's
 *     lock alarm.
 *  4. The suspended `close()` resumes and calls `clearLockAlarm()` — deleting
 *     B's just-created alarm.
 *
 * RED today: B's alarm is gone after the race. GREEN after fix: the reactive
 * close serializes through `runExclusive` with an in-lock expiry re-check, so
 * B's alarm survives.
 */
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { describe, expect, test } from "vitest"
import { SessionManager } from "../../../../apps/extension/src/wallet/services/profile/session-manager"
import type { IConfig } from "../../../../apps/extension/src/wallet/config"
import type { Profile } from "../../../../apps/extension/src/wallet/services/profile/spec"

const configStub: IConfig = {
	onUpdate: new EventHandler(),
	get: (key) => {
		switch (key) {
			case "sessionTtl":
				return 1_800_000
			case "strictSecurityMode":
				return false
			default:
				throw new Error(`unexpected config key ${String(key)}`)
		}
	},
}

const logger = { log: () => {}, child: () => logger } as never

const mkProfile = (id: string): Profile =>
	({
		id,
		name: id,
		type: "password",
		pxeGeneration: 0,
	}) as unknown as Profile

describe("F1-1: reactive TTL close must not cancel a newer session's lock alarm", () => {
	test("open(B) during a suspended close(A) keeps B's alarm", async () => {
		const browserApi = new FakeBrowserApi()
		// Observe alarm clears on the SAME port instance the manager captures.
		const clearedAlarms: string[] = []
		const origClear = browserApi.alarms.clear.bind(browserApi.alarms)
		browserApi.alarms.clear = async (name: string) => {
			clearedAlarms.push(name)
			return origClear(name)
		}
		const manager = new SessionManager(configStub, logger, () => {}, browserApi)

		const secretA = new Uint8Array(32).fill(1) as never
		const secretB = new Uint8Array(32).fill(2) as never

		// Session A open, then age past TTL by rewriting the IN-MEMORY session's
		// `since` directly (deterministic expiry — no timers, no alarm fires).
		await manager.open(mkProfile("A"), secretA)
		const internal = manager as unknown as {
			activeSession: { session: { since: number } } | null
		}
		expect(internal.activeSession).not.toBeNull()
		// deriveLockedAt prefers the persisted lockedAt — age IT past the 30-min
		// default TTL so the session is deterministically expired.
		const agedSession = internal.activeSession!.session as unknown as { lockedAt?: number; since: number }
		agedSession.lockedAt = Date.now() - 1000

		// Hold session.delete() so the reader-triggered close suspends mid-body.
		let releaseDelete: (() => void) | undefined
		const deleteGate = new Promise<void>((resolve) => {
			releaseDelete = resolve
		})
		const area = browserApi.storage.session as unknown as {
			remove(keys: string | string[]): Promise<void>
		}
		const origRemove = area.remove.bind(area)
		area.remove = async (keys: string | string[]) => {
			await deleteGate
			return origRemove(keys)
		}
		void origRemove

		// Lock-free reader path: getSecret → getActive → sees A expired → close().
		const reader = manager.getSecret().catch(() => "locked")

		// Give the close a tick to reach the gated delete…
		await new Promise((r) => setTimeout(r, 5))

		// …meanwhile the user unlocks profile B: open() commits and schedules B's alarm.
		await manager.open(mkProfile("B"), secretB)

		// The suspended close resumes and clears "the" lock alarm.
		releaseDelete!()
		await reader

		// CORRECT behavior: the stale close must not clear B's alarm. RED today:
		// clearLockAlarm() ran unconditionally after B's scheduleLockAlarm —
		// auto-lock for B degrades to lazy.
		expect(clearedAlarms.filter((n) => n === "nulo:core:session:ttl").length).toBe(0)
	})
})
