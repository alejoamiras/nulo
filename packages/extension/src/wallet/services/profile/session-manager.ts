/**
 * `SessionManager` — owns the in-memory `ActiveSession` and its
 * persisted `Session` mirror in `chrome.storage.session`.
 *
 * `ProfileService` is the facade: it keeps the lock and the RPC
 * surface. This class owns session state and TTL expiry.
 *
 * ## Storage ownership
 *
 * Frozen storage key: `nulo:core:session` in `chrome.storage.session`.
 * Session storage is cleared by the browser when the service-worker's
 * "browser session" ends, but survives MV3 service-worker suspensions —
 * which is the whole point: the popup can reconnect mid-session without
 * re-prompting for the password.
 *
 * The persisted shape (`Session`) is frozen across the ProfileService
 * split; every existing session record on disk was written under this
 * encoding. The in-memory shape (`ActiveSession`) is a superset — it
 * also holds the raw `Fr` master secret, which is NEVER persisted.
 *
 * ## Restore semantics (init-only, silent)
 *
 * `restore(lookup, unseal)` is called exactly once during service init.
 * It re-hydrates `activeSession` from disk without emitting
 * `onActiveProfileChanged`. Emitting at init would fire before any
 * subscriber has attached; subscribers pull the current value via
 * `getActive()` at their own mount time.
 *
 * Restore is also TTL-aware: a session whose `since + ttl` has passed
 * is silently dropped (storage cleaned, no emit — matches the "session
 * expired on reload" UX).
 *
 * ## Wrong-credential / corrupted-ciphertext policy
 *
 * `restore` passes a `unseal` callback that returns `null` on any
 * wrong-credential / corrupted-ciphertext condition. The manager maps
 * that to a silent close, same as TTL expiry. The facade does NOT see
 * an error — there is no UI to surface one to during init.
 *
 * ## Lock-agnostic
 *
 * SessionManager performs no locking of its own. Callers (the facade)
 * run its methods under `ProfileService.lock` when they need
 * serialization with profile CRUD. Init is called before the service
 * announces readiness (`ensureInitialized`), so the lock isn't
 * required there either.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import type { ConfigProp, IConfig } from "@/wallet/config"
import { type ILogger, LogLevel } from "@/wallet/logger"
import { ValueStorage } from "@/wallet/storage"
import type { AlarmEvent, AlarmsPort, BrowserApi } from "@nulo/wallet-core/ports"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { zeroize } from "@nulo/wallet-crypto"
import type { ActiveSession, Profile, ProfileInfo, Session } from "./spec"

const LOG_SOURCE = "SessionManager"

/** Frozen storage root for the session record. */
export const SESSION_STORAGE_ROOT = "nulo:core:session"

/**
 * `chrome.alarms` name for the proactive TTL lock fire.
 * Convention: `nulo:<service>:<purpose>`.
 */
export const SESSION_TTL_ALARM_NAME = "nulo:core:session:ttl"

/** Callback the facade passes to `restore()` so SessionManager can fetch
 *  the profile named in the persisted session without reaching into
 *  `ProfileRepository` directly — keeps the dependency arrow one-way
 *  (facade → manager, not manager → repo). */
export type SessionProfileLookup = (profileId: string) => Promise<Profile | undefined>

/** Callback the facade passes to `restore()` so SessionManager can
 *  decrypt the master secret for a password profile. Returns `null` on
 *  wrong-credential / corrupted-ciphertext — same contract as
 *  `PasswordSecretBox.unsealWithPasshash`. */
export type SessionSecretUnsealer = (
	passhash: ArrayBuffer,
	profile: Profile & { type: "password" },
) => Promise<Uint8Array<ArrayBuffer> | null>

/** Hook the facade registers at construction so SessionManager can
 *  surface open / close transitions as `onActiveProfileChanged`
 *  events. `undefined` means the active profile cleared. */
export type SessionChangeListener = (profile: ProfileInfo | undefined) => void

export class SessionManager {
	private readonly session: ValueStorage<Session>
	private readonly onChange: SessionChangeListener
	private activeSession?: ActiveSession
	private sessionTtl: number
	/** When ON, `open()` does NOT persist a passhash bearer to
	 *  `chrome.storage.session` and `restore()` treats any stale
	 *  passhash-bearing session as untrusted (`silentClose`). Tracked
	 *  here (not re-read from config per call) so the gate decision is
	 *  race-free with concurrent toggles — `onConfigUpdated` keeps it in
	 *  sync. */
	private strictSecurityMode: boolean
	private readonly alarms?: AlarmsPort
	/** Facade-lock serializer injected by ProfileService. Serializes the
	 *  alarm-driven TTL close against the facade-locked session writers
	 *  (refresh/open/unlock) so a racing refresh writeback cannot resurrect a
	 *  session the alarm just closed. Defaults to a pass-through for the
	 *  lock-agnostic legacy/test paths (which never wire the alarm). */
	private readonly runExclusive: <T>(fn: () => Promise<T>) => Promise<T>

	/**
	 * @param config      Reactive config — SessionManager subscribes to
	 *                    `sessionTtl` updates so the user toggling the
	 *                    auto-lock timeout takes effect immediately for
	 *                    the *next* TTL check (never shortens the current
	 *                    window retroactively).
	 * @param logger      Wallet-wide logger; used only for debug breadcrumbs
	 *                    + error logging (never throws out of SessionManager).
	 * @param onChange    Callback invoked on open + close transitions. The
	 *                    facade wires this to `emit("onActiveProfileChanged", …)`.
	 * @param browserApi  Optional `BrowserApi` port. Tests pass `FakeBrowserApi`
	 *                    so storage + alarms are in-memory. If omitted, falls
	 *                    back to `chrome.storage.session` for legacy SW startup
	 *                    AND skips alarm wiring (proactive TTL relies on the
	 *                    port; without it, the existing reactive `isExpired`
	 *                    check still gates `getActive`).
	 */
	public constructor(
		config: IConfig,
		private readonly logger: ILogger,
		onChange: SessionChangeListener,
		browserApi?: BrowserApi,
		runExclusive?: <T>(fn: () => Promise<T>) => Promise<T>,
	) {
		this.onChange = onChange
		this.sessionTtl = config.get("sessionTtl")
		this.strictSecurityMode = config.get("strictSecurityMode")
		config.onUpdate.add(this.onConfigUpdated)
		this.session = browserApi
			? new ValueStorage<Session>(SESSION_STORAGE_ROOT, browserApi.storage.session)
			: new ValueStorage<Session>(SESSION_STORAGE_ROOT, chrome.storage.session)
		// Subscribe to `chrome.alarms` only when a port is wired. The
		// legacy (no-`browserApi`) SW path keeps the reactive `isExpired`
		// behavior — proactive TTL lights up once the composition root
		// passes a real `BrowserApi`.
		this.alarms = browserApi?.alarms
		// Pass-through default keeps the lock-agnostic contract for callers
		// that don't wire the alarm (legacy SW path / unit tests).
		this.runExclusive = runExclusive ?? ((fn) => fn())
		// SessionManager has no dispose method (SW-lifetime singleton);
		// we don't store the unsubscribe handle. If a future teardown
		// path emerges, capture this return value.
		this.alarms?.onAlarm(this.onAlarmFired)
	}

	/** Returns the active session if one exists and has not yet expired.
	 *  TTL-expired sessions are silently closed here — the return is
	 *  always the authoritative view of "is the wallet unlocked right
	 *  now".
	 *
	 *  Async (not sync) deliberately: close() writes to storage, which
	 *  is async. Making this sync would require a fire-and-forget
	 *  close, which drifts persisted-state from in-memory-state. */
	public async getActive(): Promise<ActiveSession | undefined> {
		if (!this.activeSession) {
			return undefined
		}
		if (this.isExpired(this.activeSession.session)) {
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session expired")
			await this.close()
			return undefined
		}
		return this.activeSession
	}

	/** Returns the master secret for the given profile id. Throws
	 *  `"Profile locked"` if no session is active or if the active
	 *  session belongs to a different profile — this is the contract
	 *  every caller downstream (signing, key derivation) relies on. */
	public async getSecret(profileId: string): Promise<Fr> {
		const session = await this.getActive()
		if (session?.session.profile !== profileId) {
			throw new Error("Profile locked")
		}
		return session.secret
	}

	/** Persists + enters the session for `profile`. `passhash` is optional
	 *  (only password profiles persist it, to enable silent restore after
	 *  SW suspension). Emits `onChange(ProfileInfo)` on success.
	 *
	 *  Failures are logged but swallowed — historically `_openSession`
	 *  did the same because a broken chrome.storage write at unlock time
	 *  still leaves the in-memory secret usable for the current popup
	 *  lifetime. We keep that behavior; the facade's test coverage pins
	 *  it.
	 *
	 *  ## Buffer ownership
	 *
	 *  `secretBuffer` and `passhash` are **caller-owned**. This method
	 *  copies what it needs (`Fr.fromBuffer` makes its own copy; passhash
	 *  is base64-encoded into `Session`). The caller is responsible for
	 *  calling `zeroize(...)` on these buffers after `open` returns. */
	public async open(profile: Profile, secretBuffer: Uint8Array<ArrayBuffer>, passhash?: ArrayBuffer): Promise<void> {
		try {
			const since = Date.now()
			// In strict mode the bearer is never persisted, regardless of
			// which caller passed it. Reading `strictSecurityMode` here
			// (instead of at the `ProfileService` call sites) keeps the
			// decision race-free with concurrent strict-toggle: a toggle
			// flipping ON mid-unlock cannot create a session that already
			// carries the bearer.
			const persistPasshash = passhash !== undefined && !this.strictSecurityMode
			const session: Session = {
				profile: profile.id,
				passhash: persistPasshash ? Buffer.from(passhash).toString("base64") : undefined,
				since,
				lockedAt: this.sessionTtl > 0 ? since + this.sessionTtl : undefined,
			}
			await this.session.set(session)
			const secret = Fr.fromBuffer(Buffer.from(secretBuffer))
			this.activeSession = { profile, session, secret }
			this.onChange(this.toInfo(profile))
			// Schedule the proactive lock alarm AFTER state is committed.
			// If alarm scheduling fails (port error, browser throttling),
			// log + fall back to the reactive `isExpired` check — never
			// block session-open on alarm wiring.
			await this.scheduleLockAlarm(session.lockedAt)
		} catch (error) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to open profile session", getErrorMessage(error))
		}
	}

	/** Clears persisted + in-memory session. Emits `onChange(undefined)`
	 *  iff a session was actually open (idempotent when already closed).
	 *  Safe to call multiple times. */
	public async close(): Promise<void> {
		try {
			await this.session.delete()
			if (this.activeSession) {
				this.activeSession = undefined
				this.onChange(undefined)
			}
			// Cancel any pending lock alarm. Idempotent — `clear()` returns
			// `false` if no alarm exists. Run after state-clear so a racing
			// alarm fire that arrives during this call sees
			// `activeSession === undefined` and short-circuits in
			// `onAlarmFired`.
			await this.clearLockAlarm()
		} catch (error) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to close profile session", getErrorMessage(error))
		}
	}

	/** Resets `since` to now, extending the TTL window. No-op when no
	 *  session is active (via the `getActive` guard). Does not emit —
	 *  the UI already has the correct active-profile info. */
	public async refresh(): Promise<void> {
		try {
			const session = await this.getActive()
			if (session) {
				const since = Date.now()
				session.session.since = since
				session.session.lockedAt = this.sessionTtl > 0 ? since + this.sessionTtl : undefined
				await this.session.set(session.session)
				// Cancel + recreate the alarm against the new `lockedAt`.
				// The previous alarm's `scheduledTime` no longer matches
				// the persisted `lockedAt`, so the gate in `onAlarmFired`
				// would ignore a late-firing stale delivery anyway — but
				// cancelling avoids the spurious fire entirely.
				await this.clearLockAlarm()
				await this.scheduleLockAlarm(session.session.lockedAt)
			}
		} catch (error) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to refresh profile session", getErrorMessage(error))
		}
	}

	/** Drops the persisted `passhash` bearer from BOTH the storage record
	 *  AND the in-memory `activeSession.session` object. Called by
	 *  `onConfigUpdated` when strict mode is enabled mid-session.
	 *
	 *  Why both: `refresh()` (and TTL updates) re-persist the in-memory
	 *  `activeSession.session` object, so leaving the in-memory passhash
	 *  present would silently re-write the bearer to storage on the
	 *  next refresh — strict ON would be quietly undone. Mutating the
	 *  in-memory copy too closes that race.
	 *
	 *  The Fr master secret keeps living: enabling strict mid-session is
	 *  not a force-lock — the user stays unlocked until SW death OR
	 *  auto-lock OR manual lock. Idempotent. */
	public async clearPasshash(): Promise<void> {
		try {
			// Clear in-memory FIRST. Order matters: if a `refresh()` (or TTL
			// alarm reschedule) lands between our two ops while in-memory
			// still has the bearer, refresh re-persists it. By clearing
			// memory before storage, any concurrent refresh reads the
			// cleared session and writes a clean record — our subsequent
			// storage-set is a no-op confirmation.
			if (this.activeSession?.session.passhash) {
				this.activeSession.session.passhash = undefined
			}
			const persisted = await this.session.get()
			if (persisted?.passhash) {
				await this.session.set({ ...persisted, passhash: undefined })
			}
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Cleared passhash bearer (strict mode)")
		} catch (error) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to clear passhash bearer", getErrorMessage(error))
		}
	}

	/** Re-enters the active session from persisted storage, if one is
	 *  still valid. Called exactly once by the facade during init.
	 *
	 *  SILENT by design: does NOT invoke `onChange`. Subscribers are not
	 *  yet attached at init time; they query `getActive()` when they
	 *  mount.
	 *
	 *  TTL expiry → silent close.
	 *  Profile no longer exists on disk → silent close.
	 *  Password profile + unseal returns null → silent close.
	 *  Passkey profile → skipped (requires user interaction; lock-screen
	 *  prompts for passkey the next time the popup opens). */
	public async restore(lookup: SessionProfileLookup, unseal: SessionSecretUnsealer): Promise<void> {
		const session = await this.session.get()
		if (!session) {
			return
		}
		if (this.isExpired(session)) {
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session expired")
			await this.silentClose()
			return
		}
		const profile = await lookup(session.profile)
		if (!profile) {
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session refers wrong profile")
			await this.silentClose()
			return
		}
		if (profile.type === "passkey") {
			// Passkey sessions can't be silently restored — the browser
			// requires a user gesture for WebAuthn `get`. Leave persisted
			// record in place; the popup's lock screen will handle it.
			return
		}
		if (this.strictSecurityMode && session.passhash) {
			// A persisted passhash bearer under strict mode is either
			// (a) a leftover from a prior lenient session before the user
			// enabled strict, or (b) a race where a toggle ON landed
			// mid-restore. Either way, treat as untrusted —
			// `silentClose` so the popup shows the lock screen and the
			// user re-auths fresh. Pairs with `open()`'s gate so a
			// brand-new strict session has no passhash to begin with.
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Strict mode + persisted passhash → silentClose")
			await this.silentClose()
			return
		}
		if (!session.passhash) {
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Password session missing passhash")
			await this.silentClose()
			return
		}
		const passhash = Buffer.from(session.passhash, "base64")
		// `Buffer.from(string, "base64")` may allocate from Node's pooled
		// buffer (poolSize ~8 KiB), so `passhash.buffer` is the FULL pool
		// `ArrayBuffer`, not the 32-byte slice we want. Slicing yields a
		// detached `ArrayBuffer` of exactly `passhash.byteLength` bytes —
		// safe to pass to `crypto.subtle.importKey("raw", ...)` which
		// would otherwise derive PBKDF2 from the wrong input. This latent
		// bug rarely surfaces in normal use because the SW stays warm via
		// popup ports + alarms; the strict-mode restore tests exercise
		// the cold-restore path explicitly.
		const passhashBuffer = passhash.buffer.slice(passhash.byteOffset, passhash.byteOffset + passhash.byteLength)
		let secretBytes: Uint8Array<ArrayBuffer> | null = null
		try {
			secretBytes = await unseal(passhashBuffer, profile)
			if (!secretBytes) {
				this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session contains wrong credentials or corrupted ciphertext")
				await this.silentClose()
				return
			}
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session restored")
			this.activeSession = {
				profile,
				session,
				// Fr.fromBuffer copies into Fr's internal field-element rep
				// (verified by zeroize.test.ts). Safe to zero `secretBytes`
				// after this line.
				secret: Fr.fromBuffer(Buffer.from(secretBytes)),
			}
			// Re-schedule the alarm against the persisted `lockedAt`. If
			// `lockedAt` is absent (records written before the field was
			// added), fall back to `since + sessionTtl`.
			await this.scheduleLockAlarm(this.deriveLockedAt(session))
		} finally {
			zeroize(passhash)
			// passhashBuffer is a fresh slice owned by us — zero it too
			// so the bearer doesn't linger in the GC heap longer than needed.
			zeroize(passhashBuffer)
			zeroize(secretBytes)
		}
	}

	/** Facade-side helper for `changeProfileName` etc.: patches the
	 *  `profile` reference on the in-memory `ActiveSession` so
	 *  subsequent `getActive()` calls see the updated name / type /
	 *  etc. without reloading from disk. No-op when the update doesn't
	 *  target the active session. */
	public patchActiveProfile(profileId: string, profile: Profile): void {
		if (this.activeSession?.session.profile === profileId) {
			this.activeSession.profile = profile
		}
	}

	/** `true` iff a session belongs to `profileId` right now. Used by
	 *  the facade to decide whether a profile-mutation operation (e.g.
	 *  `deleteProfile`) should also close the session. */
	public isActive(profileId: string): boolean {
		return this.activeSession?.session.profile === profileId
	}

	private isExpired(session: Session): boolean {
		return this.sessionTtl !== 0 && this.deriveLockedAt(session) <= Date.now()
	}

	/** Derive the effective `lockedAt` for a session. Prefers the
	 *  explicit `lockedAt` field when present; falls back to
	 *  `since + sessionTtl` for older records.
	 *
	 *  Returned value is meaningful only when `sessionTtl !== 0`; the
	 *  caller checks that gate first. */
	private deriveLockedAt(session: Session): number {
		return session.lockedAt ?? session.since + this.sessionTtl
	}

	/** Close without emitting — used by `restore` so init-time cleanup
	 *  doesn't fire onChange before any subscriber exists. */
	private async silentClose(): Promise<void> {
		try {
			await this.session.delete()
			this.activeSession = undefined
			await this.clearLockAlarm()
		} catch (error) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to close profile session", getErrorMessage(error))
		}
	}

	private toInfo(profile: Profile): ProfileInfo {
		return { id: profile.id, name: profile.name, type: profile.type }
	}

	/**
	 * Config update is **sync fire-and-forget** — `IConfig.onUpdate`'s
	 * `EventHandler.add` doesn't await async listeners, so we must:
	 *   1. Update `this.sessionTtl` synchronously (so the next read sees
	 *      the new value).
	 *   2. Spin off the async storage + alarm reschedule in a void
	 *      `(async () => { ... })()` IIFE that handles its own errors.
	 *
	 * Critical: when the new TTL would put `lockedAt` in the past, we
	 * lock immediately rather than scheduling an already-late alarm.
	 */
	private readonly onConfigUpdated = (prop: ConfigProp) => {
		if (prop.key === "sessionTtl") {
			const oldTtl = this.sessionTtl
			const newTtl = prop.value
			this.sessionTtl = newTtl
			if (oldTtl === newTtl) return
			// Don't await — config.set returns immediately and the listener
			// signature is sync. Internal helper logs its own errors.
			void this.applyTtlChange(newTtl)
		} else if (prop.key === "strictSecurityMode") {
			const wasStrict = this.strictSecurityMode
			this.strictSecurityMode = prop.value
			if (!wasStrict && this.strictSecurityMode) {
				// Toggle ON: drop any persisted bearer from a prior lenient
				// unlock so subsequent `refresh()` / TTL bumps don't re-write
				// it. The Fr secret keeps living — strict toggle is not a
				// force-lock. `clearPasshash` mutates the in-memory copy too.
				void this.clearPasshash()
			}
			// Toggle OFF: no immediate effect. Bearer is restored on next
			// unlock via `open()`'s gate.
		}
	}

	/**
	 * Internal async helper invoked by the sync config-update listener.
	 * Handles the three TTL-change cases:
	 *   - newTtl === 0      → clear alarm + clear lockedAt (TTL disabled)
	 *   - newLockedAt <= now → lock immediately (don't schedule a stale alarm)
	 *   - otherwise          → reschedule alarm against the new lockedAt
	 *
	 * Errors are logged + swallowed; never escape the void IIFE.
	 */
	private async applyTtlChange(newTtl: number): Promise<void> {
		try {
			if (!this.activeSession) return
			if (newTtl === 0) {
				// `lockedAt: undefined` is dropped by JSON.stringify on
				// persist, matching the no-TTL write in `open()`.
				this.activeSession.session.lockedAt = undefined
				await this.session.set(this.activeSession.session)
				await this.clearLockAlarm()
				return
			}
			const newLockedAt = this.activeSession.session.since + newTtl
			if (newLockedAt <= Date.now()) {
				// New TTL has already elapsed since `since` — lock now,
				// don't schedule an already-overdue alarm.
				this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session TTL shortened past elapsed window; locking immediately")
				await this.close()
				return
			}
			this.activeSession.session.lockedAt = newLockedAt
			await this.session.set(this.activeSession.session)
			await this.clearLockAlarm()
			await this.scheduleLockAlarm(newLockedAt)
		} catch (error) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to apply TTL change", getErrorMessage(error))
		}
	}

	/**
	 * `chrome.alarms` `onAlarm` dispatch handler.
	 *
	 * Gate: `alarm.scheduledTime === activeSession.session.lockedAt`.
	 * Without this gate, a queued stale delivery from an old (cleared
	 * but in-flight) alarm could lock a freshly refreshed session. The
	 * `scheduledTime` field is the alarm's epoch-ms when-set, which we
	 * also persist as `lockedAt` — so equality is the right check.
	 *
	 * Idempotent: if `close()` already ran (e.g. user manually locked
	 * a microsecond before alarm fire), the activeSession is undefined
	 * and we short-circuit.
	 */
	private readonly onAlarmFired = (alarm: AlarmEvent): void => {
		if (alarm.name !== SESSION_TTL_ALARM_NAME) return
		// Serialize the expiry close against the facade-locked session writers
		// (refresh/open/unlock) via the injected runExclusive. Without it, a
		// refresh() writeback racing this close()'s delete() can re-persist
		// (resurrect) the session the alarm just expired, which the next SW
		// restore() silently rehydrates — a TTL bypass. The activeSession +
		// lockedAt gate is re-checked INSIDE the lock so a refresh that won the
		// lock first (and bumped lockedAt) makes this now-stale fire a no-op.
		// `deriveLockedAt` (lockedAt ?? since+ttl) also matches the alarm
		// scheduled for legacy restored records that lack an explicit lockedAt.
		void this.runExclusive(async () => {
			const active = this.activeSession
			if (!active) return // already closed; nothing to do
			const expectedLockedAt = this.deriveLockedAt(active.session)
			if (alarm.scheduledTime !== expectedLockedAt) {
				// Stale alarm — a refresh rescheduled to a newer lockedAt; this
				// fire is from the previous schedule. Ignore.
				this.logger.log(
					LOG_SOURCE,
					LogLevel.Debug,
					`Stale TTL alarm (scheduledTime=${alarm.scheduledTime}, lockedAt=${expectedLockedAt}); ignoring`,
				)
				return
			}
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session TTL alarm fired; locking")
			await this.close()
		})
	}

	/**
	 * Schedule the lock alarm at `lockedAt` (epoch ms). No-op when
	 * alarms aren't wired, when sessionTtl is 0, or when lockedAt is
	 * undefined / past.
	 *
	 * Errors are logged + swallowed; never propagate to callers (the
	 * reactive `isExpired` check is the safety net).
	 */
	private async scheduleLockAlarm(lockedAt: number | undefined): Promise<void> {
		if (!this.alarms || this.sessionTtl === 0 || lockedAt === undefined || lockedAt <= Date.now()) {
			return
		}
		try {
			await this.alarms.create(SESSION_TTL_ALARM_NAME, { when: lockedAt })
		} catch (error) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to schedule TTL alarm", getErrorMessage(error))
		}
	}

	/**
	 * Cancel any pending lock alarm. Idempotent — `clear` returns false
	 * when no alarm exists. No-op when alarms aren't wired.
	 */
	private async clearLockAlarm(): Promise<void> {
		if (!this.alarms) return
		try {
			await this.alarms.clear(SESSION_TTL_ALARM_NAME)
		} catch (error) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to clear TTL alarm", getErrorMessage(error))
		}
	}
}
