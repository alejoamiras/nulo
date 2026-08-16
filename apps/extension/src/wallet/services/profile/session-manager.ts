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
 * `restore(lookup)` is called exactly once during service init.
 * It re-hydrates `activeSession` from disk without emitting
 * `onActiveProfileChanged`. Emitting at init would fire before any
 * subscriber has attached; subscribers pull the current value via
 * `getActive()` at their own mount time.
 *
 * Restore is also TTL-aware: a session whose `since + ttl` has passed
 * is silently dropped (storage cleaned, no emit — matches the "session
 * expired on reload" UX).
 *
 * ## Bearer / corrupted-ciphertext policy (F-11)
 *
 * The silent-restore bearer is a random-token-wrapped master secret
 * (`SessionSecretBox`), not the old password-equivalent passhash. On any
 * wrong-profile / tampered-bearer / bad-tag condition `unwrap` returns
 * `null` and the manager maps that to a silent close, same as TTL expiry.
 * A legacy `passhash`-shaped session is never accepted (one-time re-unlock).
 * The facade does NOT see an error — there is no UI to surface one to
 * during init.
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
import { SessionSecretBox, type MasterSecretBytes, type Passhash, zeroize } from "@nulo/wallet-crypto"
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

/** Hook the facade registers at construction so SessionManager can
 *  surface open / close transitions as `onActiveProfileChanged`
 *  events. `undefined` means the active profile cleared. */
export type SessionChangeListener = (profile: ProfileInfo | undefined) => void

export class SessionManager {
	private readonly session: ValueStorage<Session>
	/** F-11: wraps the master secret under a fresh random token for the
	 *  silent-restore bearer (replaces the password-equivalent passhash). */
	private readonly sessionSecretBox = new SessionSecretBox()
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

	/** Persists + enters the session for `profile`. `passhash` is now only
	 *  a PRESENCE signal (a password unlock/create where a silent-restore
	 *  bearer is appropriate) — its VALUE is never persisted (F-11). Only
	 *  non-strict password profiles persist a bearer. Emits
	 *  `onChange(ProfileInfo)` on success.
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
	 *  copies what it needs (`Fr.fromBuffer` copies; the bearer wraps a
	 *  COPY of `secretBuffer` under a fresh random token). The caller is
	 *  responsible for calling `zeroize(...)` on these buffers after `open`
	 *  returns. */
	public async open(profile: Profile, secretBuffer: MasterSecretBytes, passhash?: Passhash): Promise<void> {
		try {
			const since = Date.now()
			// F-11: `passhash` is now only a PRESENCE signal — "a password
			// unlock/create where the user authenticated, so a silent-restore
			// bearer is appropriate." Its value is no longer persisted; the
			// bearer wraps the master secret under a fresh RANDOM token
			// (AAD-bound to the profile id). In strict mode NO bearer is
			// persisted. Reading `strictSecurityMode` here (not at the call
			// sites) keeps the gate race-free with a concurrent strict-toggle ON
			// mid-unlock — it cannot create a session that already carries a bearer.
			const persistBearer = passhash !== undefined && !this.strictSecurityMode && profile.type === "password"
			const bearer = persistBearer ? await this.sessionSecretBox.wrap(secretBuffer, profile.id) : undefined
			const session: Session = {
				profile: profile.id,
				bearer,
				since,
				lockedAt: this.sessionTtl > 0 ? since + this.sessionTtl : undefined,
			}
			// B-01: memory-first. Commit the in-memory session BEFORE the storage
			// write so a rejecting `session.set` can't discard it — the class
			// contract is that a broken chrome.storage write at unlock still leaves
			// the in-memory secret usable for this SW lifetime (degraded success:
			// not persisted, but usable). A stale prior-profile bearer that survives
			// on disk is harmless — restore() validates the bearer against the
			// active profile on the next SW start.
			const secret = Fr.fromBuffer(Buffer.from(secretBuffer))
			this.activeSession = { profile, session, secret }
			this.onChange(this.toInfo(profile))
			try {
				await this.session.set(session)
			} catch (error) {
				this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to persist opened session (in-memory only)", getErrorMessage(error))
			}
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
			// B-01: memory-first + asymmetric-to-open. Clear the in-memory session
			// FIRST so a rejecting `session.delete` can't leave the secret live in
			// memory after an explicit lock. Unlike open(), a swallowed delete
			// failure here is NOT benign — the persisted bearer would survive and
			// re-unlock on the next SW start — so `delete()` gets its OWN catch
			// (clearLockAlarm must still run) and callers that need the durable
			// guarantee (lockActiveProfile) read back via hasPersistedSession().
			if (this.activeSession) {
				this.activeSession = undefined
				this.onChange(undefined)
			}
			try {
				await this.session.delete()
			} catch (error) {
				this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to delete persisted session on close", getErrorMessage(error))
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

	/** True iff a session record is still persisted in storage. Used by
	 *  `lockActiveProfile` as a post-close read-back (B-01): a swallowed
	 *  `session.delete` failure would leave a bearer that re-unlocks on the next
	 *  SW start, so the lock RPC surfaces the failure rather than reporting a
	 *  false "locked". Fail-closed: a read error reports "still persisted". */
	public async hasPersistedSession(): Promise<boolean> {
		try {
			return (await this.session.get()) !== undefined
		} catch {
			return true
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

	/** Drops the persisted silent-restore `bearer` (F-11; and any legacy
	 *  `passhash`) from the session record. Called by `onConfigUpdated` when
	 *  strict mode is enabled mid-session.
	 *
	 *  Why it matters: `refresh()` (and TTL updates) re-persist the in-memory
	 *  `activeSession.session` object, so leaving the in-memory bearer present
	 *  would silently re-write it to storage on the next refresh — strict ON
	 *  would be quietly undone. So we mutate the shared in-memory object too.
	 *
	 *  The Fr master secret keeps living: enabling strict mid-session is
	 *  not a force-lock — the user stays unlocked until SW death OR
	 *  auto-lock OR manual lock. Idempotent. */
	public async clearBearer(): Promise<void> {
		try {
			// Serialize against the facade-locked session writers (refresh/open/
			// unlock), applyTtlChange, and the alarm close, via the injected
			// runExclusive — same config-driven, void-dispatched provenance as
			// applyTtlChange, so it is deadlock-free (only reached from
			// `onConfigUpdated`, never from within the facade lock). Without
			// serialization the storage write below could clobber a concurrent
			// refresh/applyTtlChange's newer `since`/`lockedAt` (lost update).
			await this.runExclusive(async () => {
				// Re-read inside the lock.
				const active = this.activeSession
				if (active) {
					// Live session: clear the bearer on the shared object and persist
					// THAT object — it carries the authoritative latest since/lockedAt.
					// Persisting a fresh storage snapshot instead (`{...persisted}`)
					// would be the lost-update vector against a serialized writer.
					if (active.session.bearer || active.session.passhash) {
						active.session.bearer = undefined
						active.session.passhash = undefined
						await this.session.set(active.session)
					}
					return
				}
				// No in-memory session (locked): scrub a persisted bearer directly.
				const persisted = await this.session.get()
				if (persisted?.bearer || persisted?.passhash) {
					await this.session.set({ ...persisted, bearer: undefined, passhash: undefined })
				}
			})
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
	 *  Password profile + bearer fails to unwrap (tampered / wrong profile /
	 *  legacy passhash / missing) → silent close.
	 *  Passkey profile → skipped (requires user interaction; lock-screen
	 *  prompts for passkey the next time the popup opens). */
	public async restore(lookup: SessionProfileLookup): Promise<void> {
		let session: Session | undefined
		try {
			session = await this.session.get()
		} catch (error) {
			// F-13: `ValueStorage.get()` is fail-closed (throws on a malformed /
			// undecodable value, preserving it for repair). A corrupt
			// `nulo:core:session` must NOT abort service init (this runs under
			// `ServiceCollection.start()`) — treat it as "no restorable session"
			// so the user simply re-unlocks. The bad record stays for diagnosis.
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Undecodable persisted session; skipping restore", getErrorMessage(error))
			return
		}
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
		// F-11 shape gate — fail closed. `silentClose` (never throw) if:
		//  - a LEGACY `passhash`-shaped session (pre-F-11) is present — NEVER
		//    accepted, even non-strict → one-time re-unlock (profile intact);
		//  - strict mode + any bearer — untrusted (open() never persists a
		//    bearer under strict; this is a leftover or a mid-toggle race);
		//  - a password session with NO bearer — nothing to restore.
		if (session.passhash || (this.strictSecurityMode && session.bearer) || !session.bearer) {
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "No restorable bearer (legacy passhash / strict+bearer / missing) → silentClose")
			await this.silentClose()
			return
		}
		let secretBytes: MasterSecretBytes | null = null
		try {
			// AAD = profile id: a bearer minted for one profile can't unwrap
			// under another. `unwrap` returns null (never throws) on a tampered
			// bearer / bad GCM tag / wrong version.
			secretBytes = await this.sessionSecretBox.unwrap(session.bearer, profile.id)
			if (!secretBytes) {
				this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session bearer failed to unwrap (tampered / wrong profile) → silentClose")
				await this.silentClose()
				return
			}
			// F-11 race: re-check strict AFTER the async unwrap, immediately
			// before committing `activeSession`. A strict-toggle ON that landed
			// mid-restore already cleared storage; do not resurrect an in-memory
			// bearer session past it.
			if (this.strictSecurityMode) {
				this.logger.log(LOG_SOURCE, LogLevel.Debug, "Strict toggled ON mid-restore → silentClose")
				await this.silentClose()
				return
			}
			// `unwrap` already enforces the 32-byte length, but a 32-byte value ≥ the
			// BN254 field modulus still throws in `Fr.fromBuffer`. A crafted/corrupt
			// bearer must `silentClose`, not crash service init.
			let secret: Fr
			try {
				// Fr.fromBuffer copies into Fr's internal field-element rep
				// (verified by zeroize.test.ts). Safe to zero `secretBytes` after.
				secret = Fr.fromBuffer(Buffer.from(secretBytes))
			} catch (err) {
				this.logger.log(
					LOG_SOURCE,
					LogLevel.Debug,
					"Bearer decrypted to an out-of-range secret → silentClose",
					getErrorMessage(err),
				)
				await this.silentClose()
				return
			}
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session restored")
			this.activeSession = { profile, session, secret }
			// Re-schedule the alarm against the persisted `lockedAt`. If
			// `lockedAt` is absent (older records), fall back to
			// `since + sessionTtl`.
			await this.scheduleLockAlarm(this.deriveLockedAt(session))
		} finally {
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
				// force-lock. `clearBearer` mutates the in-memory copy too.
				void this.clearBearer()
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
			// Serialize the writeback + close against the facade-locked session
			// writers (refresh/open/unlock) AND the TTL alarm close, via the
			// injected runExclusive — the same reason as `onAlarmFired`. Without
			// it, a config-driven TTL-shorten's close()/set() racing a refresh()
			// writeback can resurrect a session the shorten just expired (a TTL
			// bypass) or lose the lockedAt update. Deadlock-free: applyTtlChange
			// is only ever reached from the config-update listener
			// (`onConfigUpdated`), never from within the facade lock, and
			// `close()` is itself lock-free.
			await this.runExclusive(async () => {
				// Re-read INSIDE the lock: a queued refresh/open/unlock may have
				// changed the active session (e.g. bumped `since`, or closed it)
				// while we waited for the lock.
				const active = this.activeSession
				if (!active) return
				if (newTtl === 0) {
					// `lockedAt: undefined` is dropped by JSON.stringify on
					// persist, matching the no-TTL write in `open()`.
					active.session.lockedAt = undefined
					await this.session.set(active.session)
					await this.clearLockAlarm()
					return
				}
				const newLockedAt = active.session.since + newTtl
				if (newLockedAt <= Date.now()) {
					// New TTL has already elapsed since `since` — lock now,
					// don't schedule an already-overdue alarm.
					this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session TTL shortened past elapsed window; locking immediately")
					await this.close()
					return
				}
				active.session.lockedAt = newLockedAt
				await this.session.set(active.session)
				await this.clearLockAlarm()
				await this.scheduleLockAlarm(newLockedAt)
			})
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
