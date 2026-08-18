import type { Fr } from "@aztec/foundation/curves/bn254"
import { toRestoreError } from "@/utils/restore-error"
import type { BrowserApi, StorageArea } from "@nulo/wallet-core/ports"
import type { IConfig } from "@/wallet/config"
import { LogLevel, type ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import {
	AccountAddressInconsistencyError,
	InvalidPasswordError,
	ProfileIdConflictError,
	RestoreTornError,
} from "@nulo/extension-messaging/errors"
import { Lock } from "@/wallet/utils"
import { ProfileRepository } from "./repository"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { array_equals, canonicalizeMnemonic, getEntropy, getMnemonic } from "@nulo/wallet-core/utils"
import {
	asBase64Ciphertext,
	asMasterSecretBytes,
	computeEnvelopeMac,
	deriveMasterFromMnemonic,
	EncryptionKey,
	type MacEnvelope,
	type MasterSecretBytes,
	type Passhash,
	PasswordSecretBox,
	zeroize,
} from "@nulo/wallet-crypto"
import { PasskeyService } from "@/wallet/services/passkey/service"
import { PasskeyRecoveryCoordinator, type PasskeyRecovery } from "./passkey-recovery-coordinator"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import { SessionManager } from "./session-manager"
import {
	mintPxeGeneration,
	PROFILE_SERVICE_NAME,
	type ProfileInfo,
	type Profile,
	type Events,
	type Methods,
	type RestoreSecret,
} from "./spec"
import { RestorePendingRepository } from "./restore-pending-repository"
import { TombstoneRepository } from "./tombstone-repository"
import { ProfileDeletionState, type ExecutionFence } from "./profile-deletion-state"
import type { ProfileDeletionDelegate } from "../profile-deletion/types"
import { AccountIntegrityBlockedRepository, AccountIntegrityVerifiedStampRepository } from "../account-integrity/blocked-repository"
import type { AccountIntegrityBlocked, AccountIntegrityDelegate } from "../account-integrity/types"

export * from "./spec"

export class ProfileService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"getActiveProfile",
		"getProfiles",
		"generateProfileId",
		"createProfile",
		"createPasskeyProfile",
		"unlockProfile",
		"unlockPasskeyProfile",
		"getPasskeyCredentialId",
		"lockActiveProfile",
		"refreshSession",
		"changeProfileName",
		"changeProfilePassword",
		"confirmProfileOperation",
		"deleteProfile",
		"importPasskey",
		"importMnemonic",
		"exportPlain",
		"exportBackupMaterial",
		"exportMnemonic",
		"restore",
		"finalizeRestore",
	)
	public static name = PROFILE_SERVICE_NAME

	public readonly onProfileAdded = new EventHandler<ProfileInfo>()
	public readonly onProfileUpdated = new EventHandler<ProfileInfo>()
	public readonly onProfileDeleted = new EventHandler<ProfileInfo>()
	public readonly onActiveProfileChanged = new EventHandler<ProfileInfo | undefined>()

	private readonly lock = new Lock()
	private readonly repo: ProfileRepository
	private readonly secretBox: PasswordSecretBox
	private readonly sessionManager: SessionManager
	private passkeys: PasskeyService = null!
	private passkeyCoordinator: PasskeyRecoveryCoordinator = null!

	/**
	 * Holds the recovered passkey secret between `restore()` (which writes the
	 * profile to storage) and `finalizeRestore()` (which opens the session).
	 *
	 * Why the split: `restore()` runs at the START of a full-backup import
	 * flow, but `useFullBackupImport` then restores backup networks/accounts.
	 * If `restore()` opened the session up-front, `onActiveProfileChanged`
	 * would fire and `app.vue` would call `getOrInitNetworks()` /
	 * `ensureDefaultAccount()` — racing duplicate networks/accounts into the
	 * same storage that the import is about to populate. Late activation
	 * defers the emit until after the import has written everything.
	 *
	 * For password profiles, finalize re-derives the secret from the new
	 * password (a second PBKDF2). For passkey profiles, re-prompting WebAuthn
	 * to get the same secret would be a UX regression — we cache the recovery
	 * secret here in memory only, never persisted, cleared on SW restart.
	 */
	private readonly pendingRestoreSecrets = new Map<string, { secret: MasterSecretBytes; capturedAt: number }>()

	/** Durable delete-in-progress markers (finding D). NOT an EntityStorage — see
	 *  TombstoneRepository: a corrupt tombstone must still reserve its id. */
	private readonly tombstones: TombstoneRepository

	/** B-11: an abandoned backup restore (row written, never finalized/deleted)
	 *  would otherwise park a raw master secret in `pendingRestoreSecrets` for the
	 *  SW lifetime. Sweep entries older than this, zeroizing them, at the entry of
	 *  every op that touches the map (restore/finalizeRestore/deleteProfile). The
	 *  window comfortably exceeds a slow multi-service backup import; a legitimate
	 *  import that runs longer can be expired by a later trigger — accepted. NEVER
	 *  the id currently being finalized (finalizeRestore removes it from the map
	 *  before its await). */
	private static readonly PENDING_RESTORE_TTL_MS = 30 * 60 * 1000

	/** F-B24: a restore-pending marker must be at least this old before the boot
	 *  sweep may treat the import as ABANDONED and reap it. A marker only proves
	 *  incompleteness — a password import whose SW died can still finalize via
	 *  the popup's auto-reconnect — so abandonment is proven by age. Seven days
	 *  is a generous multiple of any plausible import (slice RPCs are seconds; a
	 *  passkey ceremony is minutes; PENDING_RESTORE_TTL is 30 min) and outlasts
	 *  even a suspended-laptop onboarding tab; the wall-clock residual that
	 *  remains is documented at the reap site. */
	public static readonly TORN_IMPORT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000

	/** Zeroize + drop stale pending-restore secrets. MUST be called under the
	 *  facade lock (`runExclusive`) so it can't zeroize an entry another op holds
	 *  a live reference to. Optionally skips `exceptId` (the id being finalized). */
	private sweepStalePendingRestore(now: number, exceptId?: string): void {
		for (const [id, entry] of this.pendingRestoreSecrets) {
			if (id === exceptId) continue
			if (now - entry.capturedAt >= ProfileService.PENDING_RESTORE_TTL_MS) {
				this.pendingRestoreSecrets.delete(id)
				zeroize(entry.secret)
			}
		}
	}
	/** In-memory reserved-id set + per-profile deletion epoch (fencing). Seeded
	 *  from the tombstone raw keys in `init()` BEFORE the session is restored.
	 *  Shared (via {@link getDeletionState}) with Execution + Transaction so a
	 *  worker that captured an epoch before a purge is fenced when it persists. */
	private readonly deletionState = new ProfileDeletionState()
	/** Lazily injected by the last-started ProfileDeletionCoordinator — the purge
	 *  executor. Never a topological dependency (would be a cycle). */
	private deletionDelegate: ProfileDeletionDelegate | null = null
	/** Lazily injected by the last-started AccountIntegrityCoordinator — the pre-open address
	 *  verifier. Never a topological dependency (would be a cycle, same as the deletion delegate). */
	private integrityDelegate: AccountIntegrityDelegate | null = null
	/** Read-only view of the coordinator's durable blocking records, consulted at init so a
	 *  blocked profile's session is never silently rehydrated after a SW restart (the coordinator
	 *  itself starts later, in the last topological phase). */
	private readonly integrityBlocked: AccountIntegrityBlockedRepository
	/** Deletion-time cleanup of the coordinator's per-profile verified stamps. */
	private readonly integrityStamps: AccountIntegrityVerifiedStampRepository
	/** Restore-in-progress markers (torn-import detection at the unlock gate). */
	private readonly restorePending: RestorePendingRepository

	/**
	 * @param browserApi Optional. Tests pass `FakeBrowserApi` so the
	 *        collaborators work off in-memory storage without chrome.*. The
	 *        legacy SW boot path passes nothing and falls back to
	 *        `chrome.storage.local / session`.
	 */
	public constructor(config: IConfig, logger: ILogger, browserApi?: BrowserApi) {
		super(PROFILE_SERVICE_NAME, logger)
		this.repo = new ProfileRepository(browserApi)
		this.tombstones = new TombstoneRepository((browserApi?.storage.local ?? chrome.storage.local) as StorageArea)
		this.integrityBlocked = new AccountIntegrityBlockedRepository((browserApi?.storage.local ?? chrome.storage.local) as StorageArea)
		this.integrityStamps = new AccountIntegrityVerifiedStampRepository(
			(browserApi?.storage.local ?? chrome.storage.local) as StorageArea,
		)
		this.restorePending = new RestorePendingRepository((browserApi?.storage.local ?? chrome.storage.local) as StorageArea)
		this.secretBox = new PasswordSecretBox()
		this.sessionManager = new SessionManager(
			config,
			logger,
			(p) => this.emit("onActiveProfileChanged", p),
			browserApi,
			(fn) => this.runExclusive(fn),
		)
	}

	/** Run `fn` under the facade lock. Injected into `SessionManager` so its
	 *  out-of-band session closes — the alarm-driven TTL close AND the
	 *  config-driven `applyTtlChange` close — serialize against the lock-holding
	 *  session writers (`refresh`/`open`/`unlock`). Without it, a racing
	 *  `refresh()` storage write can land after a `close()` delete and resurrect
	 *  an expired session on the next SW restore (a TTL bypass). Callers MUST NOT
	 *  already hold the facade lock — `Lock` is non-reentrant, so re-entering it
	 *  self-deadlocks; this is safe ONLY because both wired paths are reached from
	 *  the alarm dispatch / the config-update listener, never from inside a locked
	 *  op. A future facade-locked write of `sessionTtl` would re-enter via
	 *  `applyTtlChange` and deadlock — keep `sessionTtl` writes off the locked
	 *  paths. */
	private async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		return this.lock.withLock(fn)
	}

	protected async init(services: ServiceCollection) {
		this.passkeys = services.get(PasskeyService.name)
		this.passkeyCoordinator = new PasskeyRecoveryCoordinator(this.passkeys, this.logger)

		// Seed the reserved-id set from the durable tombstone RAW keys BEFORE the
		// session is restored / any profile becomes visible — a tombstoned id must
		// never be reused or unlocked while its deletion is still pending (finding D).
		this.deletionState.initReserved(await this.tombstones.reservedIds())
		// Hydrate the deletion EPOCH for each VALID tombstone (raw-key reserve above
		// is fail-closed for corrupt ones; the epoch fence needs the payload). This
		// arms assertCurrent BEFORE any execution can run (D13). Corrupt tombstones
		// stay reserved with epoch 0 — still unreusable, just not epoch-fenced.
		for (const t of await this.tombstones.validPayloads()) {
			this.deletionState.hydrateDeletion(t.profileId, t.epoch)
		}

		// Silent restore: SessionManager handles TTL expiry, missing
		// profile, wrong creds, and passkey-can't-silently-restore
		// internally. No emit on restore — subscribers pull via
		// getActiveProfile() when they mount.
		// F-11: the silent-restore bearer is a random-token wrapped secret
		// (SessionSecretBox), so `restore()` needs no passhash unsealer. dev's
		// tombstone gate is preserved: a tombstoned profile (SW died mid-delete:
		// row present, id reserved) must NOT have its session restored — it's being
		// erased, so no downstream unlock/export/secret path can observe it.
		await this.sessionManager.restore(async (id) => {
			if (this.deletionState.isReserved(id)) return undefined
			const profile = await this.repo.get(id)
			if (!profile) return undefined
			// Torn-restore gate on the SILENT path too: rehydrating a marked
			// profile would bypass the unlock chokepoint. Return undefined (silent
			// close) — throwing here would abort service init (F-13 discipline).
			const marker = await this.restorePending.get(id)
			if (marker.kind === "corrupt") return undefined
			if (marker.kind === "valid") {
				if (marker.marker.pxeGeneration === profile.pxeGeneration) return undefined
				// Stale leftover from a prior incarnation: purge here too (the
				// interactive path already does) — best-effort, never blocking.
				await this.restorePending.delete(id).catch(() => {})
			}
			return profile
		})

		// Integrity gate on the silent restore: a profile the integrity coordinator flagged must
		// not rehydrate its session after a SW restart. The durable blocking record is the signal
		// (fail-closed on corrupt records); the coordinator itself starts in the LAST topological
		// phase, so this early gate reads the repository directly.
		const restored = await this.sessionManager.getActive()
		if (restored && (await this.integrityBlocked.isBlocked(restored.session.profile))) {
			this.logger.log(this.name, LogLevel.Error, "restored session belongs to an integrity-blocked profile — closing")
			await this.sessionManager.close()
		}
	}

	public async getActiveProfile(): Promise<ProfileInfo | undefined> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			const session = await this.sessionManager.getActive()
			if (!session || this.deletionState.isReserved(session.profile.id)) return undefined
			return this.getProfileInfo(session.profile)
		})
	}

	/** Capture the {profileId, epoch} execution fence ATOMICALLY under the facade
	 *  lock (D13). The active-session read, the reserved-id check, and the epoch
	 *  read MUST be one critical section — `deleteProfile`'s phase 1 (beginDeletion
	 *  + reserve) runs under the SAME lock, so this either captures the pre-delete
	 *  epoch (then the later addTransaction assert fails) or sees the id already
	 *  reserved and rejects. Composing getActiveProfile + capture across separate
	 *  lock acquisitions would let a delete slip between them (codex TOCTOU). */
	public async captureExecutionFence(): Promise<ExecutionFence> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			const session = await this.sessionManager.getActive()
			if (!session || this.deletionState.isReserved(session.profile.id)) {
				throw new Error("Wallet locked")
			}
			return { profileId: session.profile.id, epoch: this.deletionState.capture(session.profile.id) }
		})
	}

	public async getProfiles(): Promise<ProfileInfo[]> {
		await this.ensureInitialized()
		// A tombstoned (deletion-pending) profile is ABSENT to every read (finding D).
		return (await this.repo.getAll()).filter((p) => !this.deletionState.isReserved(p.id)).map(this.getProfileInfo)
	}

	public async createProfile(name: string, password: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		// Entropy-originated (NULO-ACCOUNT-KDF v2): 32 CSPRNG bytes — plain random, NOT
		// Fr.random(); entropy is pre-PBKDF2 and needs no field bound — encode to the recovery
		// words, then derive the master one-way through the standard BIP-39 step. The row stores
		// BOTH sealed (store-both): the bearer path can't re-run a mnemonic KDF, and unlock
		// already pays one PBKDF2.
		const entropy = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>
		const words = await getMnemonic(entropy)
		const secret = await deriveMasterFromMnemonic(words)
		let passhash: Passhash | undefined
		try {
			const sealed = await this.secretBox.seal(password, secret, entropy)
			passhash = sealed.passhash
			const encrypted = sealed.encrypted
			const envelopeMac = await computeEnvelopeMac(secret, this.macEnvelope(encrypted))
			return await this.runExclusive(async () => {
				const id = await this.nextUnreservedId()

				const profile: Profile = {
					id,
					name,
					type: "password",
					pxeGeneration: mintPxeGeneration(),
					guard: encrypted.guard,
					secret: encrypted.secret,
					entropy: encrypted.entropy,
					envelopeMac,
				}
				await this.repo.set(id, profile)

				this.emit("onProfileAdded", this.getProfileInfo(profile))

				await this.openSessionVerified(profile, secret, passhash)

				return profile
			})
		} finally {
			// zero secret + entropy + passhash after sessionManager has copied
			// what it needs (Fr.fromBuffer copies; passhash is base64-
			// encoded into Session). Done after lock release so a thrown
			// open()/repo.set() also gets the zeroize.
			zeroize(secret)
			zeroize(entropy)
			zeroize(passhash)
		}
	}

	/** Unlock a password profile. Three phases so the ~1s PBKDF2+AES-GCM
	 *  never holds the facade-wide lock:
	 *   1. Locked read + guard checks — snapshot encrypted bytes.
	 *   2. Unlocked unseal + passhash derive — other profile ops proceed.
	 *   3. Locked revalidate + open session — rejects the stale case where
	 *      changeProfilePassword / deleteProfile landed during phase 2. */
	public async unlockProfile(id: string, password: string): Promise<ProfileInfo> {
		await this.ensureInitialized()

		// Phase 1 — snapshot profile under lock.
		const snapshot = await this.runExclusive(async () => {
			const fetched = await this.repo.get(id)
			if (!fetched) {
				throw new Error("Invalid profile id")
			}
			// A tombstoned profile (mid-delete: row present, id reserved) must not
			// be unlocked — its data is being purged. `repo.get` alone is blind to
			// the reservation.
			if (this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			if (fetched.type === "passkey") {
				throw new Error("Profile requires passkey")
			}
			return fetched
		})

		// Phase 2 — crypto UNLOCKED. Caller pays ~1s PBKDF2 but the rest of
		// the RPC surface stays responsive.
		const unsealed = await this.secretBox.unseal(password, {
			guard: asBase64Ciphertext(snapshot.guard),
			secret: asBase64Ciphertext(snapshot.secret),
			entropy: asBase64Ciphertext(snapshot.entropy),
		})
		if (!unsealed) {
			// Can't tell wrong-password from storage corruption from this single
			// null, but GUARD catches wrong-password first in practice. Auth UI
			// matches on InvalidPasswordError (popup/pages/auth.vue:65-74).
			throw new InvalidPasswordError()
		}
		const { secret, entropy } = unsealed
		try {
			// Pairing check at the entropy-decryption site: the stored words must still derive
			// the stored master. A mismatch means a tampered/corrupted/transplanted row whose
			// exported recovery phrase would point at a DIFFERENT wallet — fail closed before any
			// session opens.
			await this.assertEntropyMasterPair(secret, entropy)
			const passhash = await EncryptionKey.getPasshash(password)

			// Phase 3 — re-enter lock, revalidate, open session.
			try {
				return await this.runExclusive(async () => {
					const current = await this.repo.get(id)
					if (!current) {
						throw new Error("Invalid profile id")
					}
					// A deletion that began during the (lock-free) phase-2 unseal must
					// abort the unlock — the id is now reserved even if the row lingers.
					if (this.deletionState.isReserved(id)) {
						throw new Error("Invalid profile id")
					}
					if (current.type !== "password") {
						throw new Error("Profile requires passkey")
					}
					if (current.guard !== snapshot.guard || current.secret !== snapshot.secret || current.entropy !== snapshot.entropy) {
						// Password changed under us. `secret` is for the OLD ciphertext;
						// the passhash wouldn't unseal the current encrypted blob, so
						// SessionManager.restore would silently close on the next SW
						// suspension. Refuse and let the user retry with the new password.
						throw new InvalidPasswordError()
					}
					await this.openSessionVerified(current, secret, passhash)
					return this.getProfileInfo(current)
				})
			} finally {
				zeroize(passhash)
			}
		} finally {
			// zero buffers after sessionManager has copied. Runs on
			// success AND on the revalidate-failure throw path.
			zeroize(secret)
			zeroize(entropy)
		}
	}

	/**
	 * Returns a freshly-generated profile id that is not currently in
	 * storage. See `Methods.generateProfileId` for the contract.
	 */
	public async generateProfileId(): Promise<string> {
		await this.ensureInitialized()
		return await this.nextUnreservedId()
	}

	public async createPasskeyProfile(name: string, credentialData?: PasskeyCredentialData): Promise<ProfileInfo> {
		await this.ensureInitialized()
		// PATH A: caller (popup) collected the credential via in-page modal;
		// `credentialData.userHandle` is the profile id the caller pre-reserved
		// (the popup got it from `repo.generateUniqueId()` over RPC before the
		// modal opened).
		// PATH B: no credentialData provided → SW opens a window via
		// `passkeyCoordinator.createForNewProfile`, which calls
		// `passkey.createKey(id, name)` → `openWindowAndWait`.
		// Generate the id BEFORE entering the lock so the passkey UI
		// prompt below doesn't hold the facade lock for minutes.
		const id = credentialData?.userHandle ?? (await this.nextUnreservedId())
		const recovery = await this.acquireRecovery({ ceremony: "create", userHandle: id, name }, credentialData)

		try {
			return await this.runExclusive(async () => {
				// Re-verify under the lock: another writer could have claimed
				// the id during the WebAuthn prompt. If so, throw a retryable
				// `ProfileIdConflictError` — the previous behavior silently
				// regenerated `id` here, which left the WebAuthn credential's
				// `userHandle` (= the OLD id) out of sync with the persisted
				// profile id. Caller is responsible for re-running the entire
				// flow with a fresh id (and a fresh WebAuthn ceremony).
				if ((await this.repo.contains(id)) || this.deletionState.isReserved(id)) {
					throw new ProfileIdConflictError()
				}

				const profile: Profile = {
					id,
					name,
					type: "passkey",
					pxeGeneration: mintPxeGeneration(),
					credentialId: recovery.credentialId,
				}
				await this.repo.set(id, profile)

				this.emit("onProfileAdded", this.getProfileInfo(profile))

				await this.openSessionVerified(profile, recovery.secret)

				return profile
			})
		} finally {
			// zero recovery secret after sessionManager copied it.
			zeroize(recovery.secret)
		}
	}

	/** Unlock a passkey profile. Three phases so the WebAuthn prompt (3 min
	 *  max) never holds the facade-wide lock:
	 *   1. Locked read + guard checks — snapshot credentialId.
	 *   2. Unlocked WebAuthn prompt — user touches authenticator.
	 *   3. Locked revalidate + open session — rejects the stale case where
	 *      the profile was deleted or the credential rotated under us. */
	public async getPasskeyCredentialId(id: string): Promise<string> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			const fetched = await this.repo.get(id)
			if (!fetched) throw new Error("Invalid profile id")
			if (this.deletionState.isReserved(id)) throw new Error("Invalid profile id")
			if (fetched.type !== "passkey") throw new Error("Profile requires password")
			if (!fetched.credentialId) throw new Error("Missing credentialId")
			return fetched.credentialId
		})
	}

	public async unlockPasskeyProfile(id: string, credentialData?: PasskeyCredentialData): Promise<ProfileInfo> {
		await this.ensureInitialized()

		// Phase 1 — snapshot profile under lock.
		const snapshot = await this.runExclusive(async () => {
			const fetched = await this.repo.get(id)
			if (!fetched) {
				throw new Error("Invalid profile id")
			}
			// A tombstoned profile (mid-delete) must not be unlocked (see unlockProfile).
			if (this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			if (fetched.type === "password") {
				throw new Error("Profile requires password")
			}
			if (!fetched.credentialId) {
				throw new Error("Missing credentialId")
			}
			return fetched
		})

		// Phase 2 — WebAuthn prompt, UNLOCKED.
		// PATH A: caller already ran the ceremony; we just materialize the
		// credential here. Note: the popup is responsible for using the
		// credentialId from the snapshot when calling the modal so the WebAuthn
		// `get` is bound to the right credential.
		// PATH B: SW opens a window via `passkeyCoordinator.recoverByCredentialId`.
		// Other profile ops can run during the user's authenticator interaction
		// regardless of path.
		const recovery = await this.acquireRecovery({ ceremony: "getById", credentialId: snapshot.credentialId }, credentialData)

		// Phase 3 — re-enter lock, revalidate credentialId, open session.
		try {
			// F-007 (B-10): bind the recovered credential to the target profile.
			// Mirrors the check in exportPlain + restore(). Without it, a
			// popup-supplied PasskeyCredentialData for credential B could unlock
			// profile A using a session derived from credential B's master secret.
			// The check lives INSIDE this try so the `finally` below zeroizes
			// `recovery.secret` even when the credential mismatches (previously the
			// throw preceded the try, leaking the recovered master secret).
			if (recovery.credentialId !== snapshot.credentialId) {
				throw new Error("Invalid profile id")
			}
			return await this.runExclusive(async () => {
				const current = await this.repo.get(id)
				if (!current) {
					throw new Error("Invalid profile id")
				}
				// A deletion that began during the (lock-free) WebAuthn prompt must
				// abort the unlock — the id is now reserved even if the row lingers.
				if (this.deletionState.isReserved(id)) {
					throw new Error("Invalid profile id")
				}
				if (current.type !== "passkey") {
					throw new Error("Profile requires password")
				}
				if (current.credentialId !== snapshot.credentialId) {
					// Credential rotated (delete + reimport with different passkey) during
					// prompt. Refuse rather than open a session bound to the old id.
					throw new Error("Invalid profile id")
				}
				await this.openSessionVerified(current, recovery.secret)
				return this.getProfileInfo(current)
			})
		} finally {
			// zero recovery secret after sessionManager copied it.
			zeroize(recovery.secret)
		}
	}

	public async importPasskey(name: string, credentialData?: PasskeyCredentialData): Promise<ProfileInfo> {
		await this.ensureInitialized()
		// PATH A: caller already ran a discovery `get` ceremony in the modal;
		// `credentialData.userHandle` is whatever the user-selected credential
		// reports (the wallet uses this as the new profile id, mirroring the
		// existing import-passkey contract).
		// PATH B: SW opens a window via `passkeyCoordinator.recoverUnknown`.
		const recovery = await this.acquireRecovery({ ceremony: "getAny" }, credentialData)
		return await this.importPasskeyProfile(name, recovery.credentialId, recovery.secret, recovery.userHandle)
	}

	/**
	 * Single ceremony entry point. Routes between PATH A (caller-supplied
	 * credential data — no window opened) and PATH B (SW opens a window via
	 * the coordinator). Keeps the dual-transport contract on a single line
	 * so the public methods stay focused on their post-ceremony storage
	 * logic.
	 */
	private async acquireRecovery(
		opts:
			| { ceremony: "create"; userHandle: string; name: string }
			| { ceremony: "getById"; credentialId: string }
			| { ceremony: "getAny" },
		credentialData: PasskeyCredentialData | undefined,
	): Promise<PasskeyRecovery> {
		if (credentialData) {
			return await this.passkeyCoordinator.recoverFromCredentialData(credentialData)
		}
		switch (opts.ceremony) {
			case "create":
				return await this.passkeyCoordinator.createForNewProfile(opts.userHandle, opts.name)
			case "getById":
				return await this.passkeyCoordinator.recoverByCredentialId(opts.credentialId)
			case "getAny":
				return await this.passkeyCoordinator.recoverUnknown()
		}
	}

	public async lockActiveProfile(): Promise<void> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			await this.sessionManager.close()
			// B-01 post-close read-back: `close()` is memory-first and swallows a
			// storage-delete failure (so clearLockAlarm always runs), but an
			// explicit lock that leaves the persisted bearer alive would silently
			// re-unlock on the next SW start. Surface that here so the RPC reports a
			// real failure instead of a false "locked".
			if (await this.sessionManager.hasPersistedSession()) {
				throw new Error("Lock did not persist — the session record could not be cleared; retry")
			}
		})
	}

	/**
	 * Close the active session ONLY if it belongs to `profileId`. Used by the integrity
	 * coordinator so a mismatch detected for profile P can't close a DIFFERENT profile that became
	 * active during the (slow, unlocked) re-derivation. The `isActive` check + `close` run under
	 * the facade lock so no unlock can interleave between them.
	 */
	public async lockProfileIfActive(profileId: string): Promise<void> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			if (this.sessionManager.isActive(profileId)) {
				await this.sessionManager.close()
			}
		})
	}

	/**
	 * Persist an integrity block record — but ONLY if the profile still exists and isn't being
	 * deleted. The two OFF-LOCK integrity writers (the coordinator's boot re-verify, AccountService's
	 * operation-time mismatch) route through here so a `deleteProfile` racing them (whose own
	 * block-CLEAR runs under this same lock) can't be followed by an orphan write: the write either
	 * lands before the delete's clear (then the delete clears it) or is skipped here because the
	 * profile is gone/reserved. Prevents an unclearable block record for a deleted profile.
	 */
	public async persistIntegrityBlockIfLive(record: AccountIntegrityBlocked): Promise<void> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			if (this.deletionState.isReserved(record.profileId) || !(await this.repo.get(record.profileId))) return
			await this.integrityBlocked.set(record)
		})
	}

	/**
	 * F-12: derive the per-profile, NON-EXTRACTABLE HMAC key that signs
	 * DappSession rows. The raw master secret never leaves this service — only
	 * the derived (non-exportable) key is handed out. Propagates the "Profile
	 * locked" throw from `getSecret`, which the DappSession read path treats as
	 * "drop rows until unlock". Key is per-profile (IKM = the profile master
	 * secret), so a row signed under one profile can't verify under another.
	 */
	public async deriveDappSessionMacKey(profileId: string): Promise<CryptoKey> {
		const secret = await this.sessionManager.getSecret(profileId)
		const ikm = new Uint8Array(secret.toBuffer())
		try {
			const baseKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"])
			return await crypto.subtle.deriveKey(
				{
					name: "HKDF",
					hash: "SHA-256",
					salt: new TextEncoder().encode("nulo:dappsession-mac:salt:v1"),
					info: new TextEncoder().encode("nulo:dappsession-mac:v1"),
				},
				baseKey,
				{ name: "HMAC", hash: "SHA-256" },
				false,
				["sign", "verify"],
			)
		} finally {
			zeroize(ikm)
		}
	}

	public async refreshSession(): Promise<void> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			await this.sessionManager.refresh()
		})
	}

	public async changeProfileName(id: string, newName: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			const profile = await this.repo.get(id)
			if (!profile) {
				throw new Error("Invalid profile id")
			}

			profile.name = newName
			await this.repo.set(id, profile)

			this.emit("onProfileUpdated", this.getProfileInfo(profile))

			this.sessionManager.patchActiveProfile(id, profile)

			return profile
		})
	}

	public async changeProfilePassword(id: string, oldPassword: string, newPassword: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			const profile = await this.repo.get(id)
			if (!profile) {
				throw new Error("Invalid profile id")
			}
			if (profile.type === "passkey") {
				throw new Error("Operation not supported for passkey profile")
			}

			const resealed = await this.secretBox.reseal(oldPassword, newPassword, {
				guard: asBase64Ciphertext(profile.guard),
				secret: asBase64Ciphertext(profile.secret),
				entropy: asBase64Ciphertext(profile.entropy),
			})
			if (!resealed) {
				throw new Error("Invalid profile old password")
			}

			// Unseal the (new-cipher) secret up front so integrity can be checked BEFORE the new
			// password is persisted. If the check throws (address drift), nothing is committed and
			// the RPC failure is honest — the password is NOT durably changed under a reported
			// failure. `reseal` returns passhash + ciphertext but not the raw secret.
			let secret: MasterSecretBytes | null = null
			let entropy: Uint8Array<ArrayBuffer> | null = null
			try {
				// Inside the try so a throw in the unseal still hits the finally that wipes
				// resealed.passhash (memory hygiene — P3 rider Low).
				const unsealed = await this.secretBox.unsealWithPasshash(resealed.passhash, resealed.encrypted)
				secret = unsealed?.secret ?? null
				entropy = unsealed?.entropy ?? null
				if (secret && entropy) {
					// Pairing check BEFORE the reseal is committed (P3 rider High): a change-password
					// on a transplanted-entropy row must NOT launder the mismatch into a MAC-valid
					// profile. reseal preserves the plaintext, so checking the freshly-sealed pair is
					// equivalent to checking the pre-change one.
					await this.assertEntropyMasterPair(secret, entropy)
					// Pre-persist verify: on drift, nothing is committed (honest failure — the password
					// is NOT changed). But a drift here means the CURRENT session is on a mismatched
					// build, so close it too — a rejected change must not leave the blocked profile
					// operating (matches openSessionVerified's close-on-throw).
					try {
						await this.integrityDelegate?.verifyBeforeSessionOpen(id, secret)
					} catch (precheckError) {
						if (precheckError instanceof AccountAddressInconsistencyError && this.sessionManager.isActive(id)) {
							await this.sessionManager.close()
						}
						throw precheckError
					}
				}

				// Dual reseal is atomic with this same pre-persist-verified commit (audit H2):
				// guard, master, AND entropy re-encrypt together — entropy must never remain
				// decryptable under the retired password — and the envelope MAC re-keys over the
				// new ciphertexts so the bearer-path check keeps holding.
				profile.guard = resealed.encrypted.guard
				profile.secret = resealed.encrypted.secret
				profile.entropy = resealed.encrypted.entropy
				if (secret) {
					profile.envelopeMac = await computeEnvelopeMac(secret, this.macEnvelope(resealed.encrypted))
				}
				await this.repo.set(id, profile)
				this.emit("onProfileUpdated", this.getProfileInfo(profile))

				if (secret && this.sessionManager.isActive(id)) {
					// Re-open with a fresh Fr. openSessionVerified re-runs the check + the deletion
					// bracket. If the RE-check now fails on an address-drift block (e.g. a foreign
					// account was restored between the pre-check and here), the password change ALREADY
					// SUCCEEDED — it must not be reported as a failure. Swallow ONLY that typed error:
					// openSessionVerified has already persisted the block + closed the session, so the
					// barrier surfaces the drift as its own handled state. Any other error (deletion
					// fence, etc.) propagates.
					try {
						await this.openSessionVerified(profile, secret, resealed.passhash)
					} catch (reopenError) {
						if (!(reopenError instanceof AccountAddressInconsistencyError)) throw reopenError
						this.logger.log(
							this.name,
							LogLevel.Error,
							"password changed but re-open hit an address-integrity block — surfaced via the barrier",
							id,
						)
					}
				}
			} finally {
				zeroize(secret)
				zeroize(entropy)
				zeroize(resealed.passhash)
			}

			return profile
		})
	}

	/** Point-in-time "does this user know the password / still hold the
	 *  passkey?". Snapshots the profile under the lock, releases, runs the
	 *  credential check UNLOCKED. The caller's downstream op (if any) runs
	 *  its own lock + refetch, so there is no TOCTOU worth serializing here.
	 *  Only UI-local ConfirmPopup callbacks currently consume the return. */
	public async confirmProfileOperation(id: string, password?: string): Promise<boolean> {
		await this.ensureInitialized()

		const { snapshot, capturedEpoch } = await this.runExclusive(async () => {
			const fetched = await this.repo.get(id)
			if (!fetched) {
				throw new Error("Invalid profile id")
			}
			// A tombstoned profile (mid-delete) must not be confirmable (codex verify).
			if (this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			// Capture the deletion epoch atomically with the snapshot — a delete
			// (even one FOLLOWED by a same-id restore) bumps it permanently, so the
			// post-op check below rejects a stale generation (codex verify r3).
			return { snapshot: fetched, capturedEpoch: this.deletionState.capture(id) }
		})

		try {
			if (snapshot.type === "password") {
				if (!password) {
					throw new Error("Password is required")
				}
				const unsealed = await this.secretBox.unseal(password, {
					guard: asBase64Ciphertext(snapshot.guard),
					secret: asBase64Ciphertext(snapshot.secret),
					entropy: asBase64Ciphertext(snapshot.entropy),
				})
				try {
					if (!unsealed) {
						// Wrapped by the catch below into a generic Error. Keeps the
						// current "confirm rejects on wrong password" contract.
						throw new InvalidPasswordError()
					}
				} finally {
					// confirmation only checks decryptability — the secrets
					// are live key material but never used. Zero both.
					if (unsealed) {
						zeroize(unsealed.secret)
						zeroize(unsealed.entropy)
					}
				}
			} else {
				// Facade dispatches on profile.type — password path above goes
				// through PasswordSecretBox, passkey path goes through the
				// coordinator. Codex audit Q2 validated this shape.
				await this.passkeyCoordinator.confirm(snapshot)
			}
			// Revalidate AFTER the async credential op (codex verify): a delete that
			// completed during the (unlocked) derivation/prompt — even one followed by
			// a same-id restore — must not report success for the stale generation.
			// The epoch check distinguishes generations; a LEGIT concurrent password
			// change does NOT bump the epoch, so confirm still succeeds.
			await this.runExclusive(async () => {
				if (!(await this.repo.get(id)) || this.deletionState.isReserved(id) || !this.deletionState.isCurrent(id, capturedEpoch)) {
					throw new Error("Invalid profile id")
				}
			})
			return true
		} catch (error) {
			this.logError("Failed to confirm operation", getErrorMessage(error))
			throw new Error(getErrorMessage(error))
		}
	}

	/** Injected by the last-started ProfileDeletionCoordinator (finding D). */
	public setDeletionDelegate(delegate: ProfileDeletionDelegate): void {
		this.deletionDelegate = delegate
	}

	/** Injected by the last-started AccountIntegrityCoordinator. */
	public setIntegrityDelegate(delegate: AccountIntegrityDelegate): void {
		this.integrityDelegate = delegate
	}

	/**
	 * Session-open chokepoint: EVERY path that materializes a session (unlock, create, import,
	 * finalizeRestore, password change) runs the integrity delegate FIRST — a profile whose
	 * stored account addresses no longer re-derive is withheld, never exposed. For the backup
	 * import path this lands after account restoration and before `finalizeRestore` opens the
	 * session, so a corrupt/foreign backup cannot activate a mismatched profile. The delegate
	 * registers in the LAST topological phase, before any RPC-driven open can occur; when absent
	 * (unit tests without the coordinator) the open proceeds unchecked.
	 */
	private async openSessionVerified(profile: Profile, secret: MasterSecretBytes, passhash?: Passhash): Promise<void> {
		// Capture the PERSISTENT deletion epoch up front. `isReserved` alone is transient — a
		// force-released facade lock could let a delete reserve→purge→RELEASE entirely while the
		// verify/open below runs, leaving `isReserved` false on both sides. The monotonic epoch does
		// not reset on release, so comparing it after the open detects a delete that fully completed.
		const deletionEpoch = this.deletionState.capture(profile.id)
		// Torn-restore gate FIRST (cheap read; precedence over the integrity
		// delegate by ordering): a restore-pending marker still present for THIS
		// incarnation means the import never finalized — the slices may be torn,
		// and opening would let the bootstrap silently re-seed the gaps. A marker
		// that EXISTS but cannot be decoded blocks too (tombstone fail-closed
		// precedent); only a generation MISMATCH (stale leftover from a prior
		// incarnation) is purged and ignored.
		const pendingMarker = await this.restorePending.get(profile.id)
		if (pendingMarker.kind === "corrupt") {
			throw new RestoreTornError(undefined, { profileId: profile.id })
		}
		if (pendingMarker.kind === "valid") {
			if (pendingMarker.marker.pxeGeneration === profile.pxeGeneration) {
				throw new RestoreTornError(undefined, { profileId: profile.id })
			}
			// Known-stale leftover: best-effort purge — a rejecting remove must
			// not fail an otherwise-valid unlock (rehydration-path symmetry).
			await this.restorePending.delete(profile.id).catch(() => {})
		}
		try {
			if (this.integrityDelegate) {
				await this.integrityDelegate.verifyBeforeSessionOpen(profile.id, secret)
			} else if (await this.integrityBlocked.isBlocked(profile.id)) {
				// STARTUP-WINDOW FAIL-CLOSED: the coordinator injects the delegate in a later phase,
				// but each service accepts RPCs from construction — an unlock racing startup would
				// otherwise open UNCHECKED. With no delegate we can't re-derive, but a KNOWN durable
				// block still refuses the open. (A never-before-seen drift in this window is caught by
				// the coordinator's boot verification, which runs right after it registers; the
				// version-keyed stamp means a drift can't already carry a green stamp.)
				throw new AccountAddressInconsistencyError(undefined, { profileId: profile.id })
			}
		} catch (error) {
			// A freshly-flagged profile must not keep a PRIOR live session either (the password-change
			// flow re-opens over one): withholding the new session while the old stays usable would
			// leave the blocked profile operating.
			if (this.sessionManager.isActive(profile.id)) {
				await this.sessionManager.close()
			}
			throw error
		}
		// Bracket the open against a deletion racing the (possibly slow) verification. Pre-open:
		// reject if already reserved. Post-open: reject + close the just-opened session if the
		// profile is reserved OR its deletion epoch advanced during the open (a delete that
		// reserved→purged→released entirely while the open ran) — so a deleted profile can never be
		// resurrected.
		if (this.deletionState.isReserved(profile.id)) {
			throw new Error("Invalid profile id")
		}
		await this.sessionManager.open(profile, secret, passhash)
		if (this.deletionState.isReserved(profile.id) || !this.deletionState.isCurrent(profile.id, deletionEpoch)) {
			if (this.sessionManager.isActive(profile.id)) {
				await this.sessionManager.close()
			}
			throw new Error("Invalid profile id")
		}
		// B-01: post-open invariant. open() is memory-first, so a persistence
		// failure degrades to in-memory success (still active). But a genuine
		// in-memory commit failure (e.g. Fr.fromBuffer / wrap throw) would leave
		// the session inactive while this method returned success — surface it.
		if (!this.sessionManager.isActive(profile.id)) {
			throw new Error("Invalid profile id")
		}
	}

	/** The SHARED deletion state (reserved ids + per-profile epoch). Execution +
	 *  Transaction resolve this at init so a write that captured an epoch before a
	 *  delete is fenced when it tries to persist afterward (D13). */
	public getDeletionState(): ProfileDeletionState {
		return this.deletionState
	}

	/** A fresh profile id that is neither in storage NOR reserved by a pending
	 *  deletion (fail-CLOSED against successor-clobber, finding D). */
	private async nextUnreservedId(): Promise<string> {
		let id = await this.repo.generateUniqueId()
		while (this.deletionState.isReserved(id)) id = await this.repo.generateUniqueId()
		return id
	}

	/**
	 * Atomic, awaited, privacy-erasing profile deletion (finding D). THREE phases:
	 *  1. UNDER the facade lock: snapshot (lock-free reads) → write the durable
	 *     tombstone (reserves the id + bumps the deletion epoch, fencing in-flight
	 *     writes) → delete the profile row → close the session → UI-only emit.
	 *  2. OUTSIDE the lock: the coordinator's awaited purge of EVERY profile-bearing
	 *     root. A failure leaves the tombstone → resume retries; the id stays reserved.
	 *  3. UNDER the lock: clear the tombstone (epoch-guarded) + release the reservation.
	 *
	 * `tornGuard` (F-B24 torn-import sweep only): when supplied, phase 1 refuses
	 * UNDER THE LOCK unless (a) the row's `pxeGeneration` still matches — a
	 * same-id re-import that landed between the sweep's observation and this call
	 * must never be deleted by a decision made about its predecessor — and (b)
	 * the EXACT observed restore-pending marker tuple is still present. (b) is
	 * the load-bearing half against a finalize race: `finalizeRestore` clears
	 * the marker at entry UNDER THIS SAME LOCK and leaves the generation
	 * unchanged, so a generation check alone would let the sweep delete a
	 * just-finalized, in-use profile (codex audit round 2). Marker gone or
	 * different → the import finalized or restarted → refuse.
	 */
	public async deleteProfile(id: string, tornGuard?: { pxeGeneration: string; markerAt: number }): Promise<ProfileInfo> {
		await this.ensureInitialized()
		const delegate = this.deletionDelegate
		if (!delegate) throw new Error("deletion coordinator not ready")

		const { profile, epoch, snapshot } = await this.runExclusive(async () => {
			this.sweepStalePendingRestore(Date.now())
			const profile = await this.repo.get(id)
			if (!profile || this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			if (tornGuard !== undefined) {
				if (profile.pxeGeneration !== tornGuard.pxeGeneration) {
					throw new Error("profile generation changed since the deletion was decided")
				}
				const marker = await this.restorePending.get(id)
				if (
					marker.kind !== "valid" ||
					marker.marker.pxeGeneration !== tornGuard.pxeGeneration ||
					marker.marker.at !== tornGuard.markerAt
				) {
					throw new Error("restore-pending marker changed since the deletion was decided — import finalized or restarted")
				}
			}
			// Fail FAST on a pre-fence row (no persisted pxeGeneration): proceeding
			// would half-execute — the tombstone write drops the undefined field, its
			// own schema then can't parse it, and the PXE clear throws AFTER the row
			// is deleted, wedging the id forever. Pre-production stance: no
			// migrations; a stale dev install reinstalls (review finding, 2026-07-18).
			if (!profile.pxeGeneration) {
				throw new Error("profile predates the pxe-generation fence — reinstall the extension (pre-production, no migration)")
			}
			const rows = await delegate.snapshot(id)
			const snapshot = { ...rows, pxeGeneration: profile.pxeGeneration }
			const epoch = this.deletionState.beginDeletion(id)
			// B-12: `beginDeletion` reserves the id synchronously. If the tombstone
			// write REJECTS, the delete didn't durably happen — but the rejection is
			// commit-ambiguous (the key may still have landed). Read back the RAW
			// tombstone key: release the reservation ONLY when its absence is
			// confirmed (a cleanly-failed write), so the live profile isn't wedged.
			// If the key exists / is corrupt / the read-back throws, RETAIN
			// fail-closed (a durable tombstone means resumePendingDeletions will
			// finish the delete; releasing would let an unlock race the resume).
			// The epoch bump is kept regardless — rolling it back would let a later
			// real deletion re-mint the same epoch and un-fence a stale writer.
			try {
				await this.tombstones.write({ profileId: id, ...snapshot, epoch })
			} catch (writeError) {
				let tombstoneDurable = true
				try {
					tombstoneDurable = (await this.tombstones.reservedIds()).has(id)
				} catch {
					tombstoneDurable = true
				}
				if (!tombstoneDurable) {
					this.deletionState.release(id)
				}
				throw writeError
			}
			await this.repo.delete(id)
			// Close the session BEFORE the emit (a subscriber reacting to the emit
			// must not observe a still-open session for a deleted profile).
			if (this.sessionManager.isActive(id)) {
				await this.sessionManager.close()
			}
			const pending = this.pendingRestoreSecrets.get(id)
			if (pending) {
				this.pendingRestoreSecrets.delete(id)
				zeroize(pending.secret)
			}
			// A deleted profile's integrity records must not outlive it: a stale blocking record
			// would keep the barrier up forever, and a stale verified-stamp could let a future
			// same-id re-import skip its first boot verification.
			await this.integrityBlocked.clear(id)
			await this.integrityStamps.clear(id)
			// The restore-pending marker clears LAST among the fallible cleanups —
			// session close + pending-secret zeroization above must never be
			// skipped by a rejecting storage remove. A failure here leaves the
			// tombstone in place, so the crash-resume path re-clears it.
			await this.restorePending.delete(id)
			this.emit("onProfileDeleted", this.getProfileInfo(profile))
			return { profile, epoch, snapshot }
		})

		await delegate.runFor(id, snapshot)

		// F-B24: a TORN reap keeps the tombstone (skips phase 3). In the wall-clock
		// corner (clock jump / multi-day suspension) the reaped import's popup may
		// still land slice writes AFTER this purge — slice restores don't consult
		// deletion state — so the cleanup must be re-runnable after the loser
		// quiesces (codex audit round 3): the retained tombstone makes the NEXT
		// boot's resume re-purge idempotently (catching any late rows), then clear
		// + release there. Cost: the id stays reserved until that boot — a dead
		// import's id, unreused for one SW lifetime.
		if (tornGuard !== undefined) {
			return profile
		}

		await this.runExclusive(async () => {
			await this.tombstones.clearIfSame(id, epoch)
			this.deletionState.release(id)
		})
		return profile
	}

	/**
	 * Resume any deletion a prior SW left tombstoned (crashed mid-cleanup). Called
	 * AFTER `services.start()` so it never blocks unrelated startup. Idempotent;
	 * a corrupt tombstone stays reserved ("deletion pending"), never fails open.
	 *
	 * F-B24: when `bootCutoff` is supplied (the SW boot instant, captured BEFORE
	 * `services.start()` — the B-03 discipline), also sweep TORN IMPORTS. A
	 * restore-pending marker only proves the restore is INCOMPLETE, not
	 * abandoned: a PASSWORD import whose SW died mid-flow can still legitimately
	 * `finalizeRestore` against this new SW (the popup auto-reconnects; finalize
	 * re-derives from the durable row + the popup-held password — codex audit).
	 * Abandonment is therefore proven by AGE: only markers older than
	 * {@link TORN_IMPORT_MIN_AGE_MS} are reaped — no live import plausibly spans
	 * it, and the popup flow is an unbroken RPC chain whose failure paths run
	 * the composable's own rollback. The reap runs the real `deleteProfile`
	 * pinned to the observed `pxeGeneration`, so it can never land on a newer
	 * same-id incarnation. Accepted risk (blast-radius note): unlike the journal
	 * reaper's metadata-only boot sweep, this destroys a profile — the age floor
	 * + generation pin + tuple compare-and-delete are the containment. Without a
	 * cutoff the sweep is SKIPPED entirely.
	 */
	public async resumePendingDeletions(bootCutoff?: number): Promise<void> {
		const delegate = this.deletionDelegate
		if (!delegate) return
		// TELEMETRY: a corrupt tombstone reserves its id (fail-closed) but can't be
		// auto-resumed — surface it for manual recovery. We do NOT drop it (that would
		// fail OPEN: the row is already deleted but purge may still be pending).
		const corrupt = await this.tombstones.corruptIds()
		if (corrupt.length) {
			this.logError(
				`profile-deletion: ${corrupt.length} corrupt tombstone(s) reserved but un-resumable (manual recovery)`,
				corrupt.join(","),
			)
		}
		for (const t of await this.tombstones.validPayloads()) {
			try {
				// Complete phase 1 idempotently — a crash may have written the tombstone
				// but not yet deleted the row / closed the session.
				await this.runExclusive(async () => {
					if (await this.repo.get(t.profileId)) await this.repo.delete(t.profileId)
					if (this.sessionManager.isActive(t.profileId)) await this.sessionManager.close()
					await this.restorePending.delete(t.profileId)
					// Idempotent, same as the live `deleteProfile` phase-1 block: a deletion that
					// crashed before these clears must still drop the integrity records so a deleted
					// profile can't leave an orphan block/stamp behind.
					await this.integrityBlocked.clear(t.profileId)
					await this.integrityStamps.clear(t.profileId)
				})
				await delegate.runFor(t.profileId, {
					addresses: t.addresses,
					tokenIds: t.tokenIds,
					networkIds: t.networkIds,
					pxeGeneration: t.pxeGeneration,
				})
				await this.runExclusive(async () => {
					await this.tombstones.clearIfSame(t.profileId, t.epoch)
					this.deletionState.release(t.profileId)
				})
			} catch (err) {
				this.logError(`resume deletion failed for ${t.profileId}`, getErrorMessage(err))
			}
		}

		// F-B24 torn-import sweep — only with an explicit boot cutoff (see doc).
		if (bootCutoff === undefined) return
		const corruptMarkers = await this.restorePending.corruptIds()
		if (corruptMarkers.length) {
			// Fail CLOSED (tombstone doctrine): never delete what we can't decode —
			// the marker stays, the row stays, unlock keeps refusing via its own
			// corrupt-marker gate. Surfaced for manual recovery.
			this.logError(`torn-import sweep: ${corruptMarkers.length} corrupt marker(s) left untouched`, corruptMarkers.join(","))
		}
		for (const marker of await this.restorePending.validMarkers()) {
			if (marker.at >= bootCutoff) continue // this-lifetime import — live, untouchable
			try {
				// Purge decisions run UNDER the facade lock: `restore()` writes its
				// marker under the same lock, so read/compare/delete here is atomic
				// against a live same-id restore (codex audit round 2 — an unlocked
				// deleteIfSame is still TOCTOU between its get and remove).
				const purged = await this.runExclusive(async () => {
					const row = await this.repo.get(marker.profileId)
					if (!row) {
						// Row-write compensation already cleaned the row; the bare marker
						// must not brand a future same-id profile.
						await this.restorePending.deleteIfSame(marker)
						return true
					}
					if (row.pxeGeneration !== marker.pxeGeneration) {
						// Stale leftover from a prior incarnation — the eager version of
						// the lazy purge `openSessionVerified` already performs.
						await this.restorePending.deleteIfSame(marker)
						return true
					}
					return false
				})
				if (purged) continue
				if (bootCutoff - marker.at < ProfileService.TORN_IMPORT_MIN_AGE_MS) {
					// Incomplete, but not provably ABANDONED: a password import whose SW
					// died can still finalize through the popup's auto-reconnect. Leave
					// it; it stays unlock-refused (RestoreTornError) and is reaped once
					// it ages past the floor.
					continue
				}
				// Aged past any plausible live import. Complete the compensating delete
				// through the full three-phase machinery, guarded UNDER THE LOCK on both
				// the observed generation AND the exact marker tuple — finalize clears
				// the marker under that same lock, so a reap can never fire after a
				// finalize; a same-id re-import mints a new generation. If THIS delete
				// fails pre-tombstone the marker survives and the next boot retries;
				// post-tombstone, the tombstone loop above finishes it. A torn reap
				// also RETAINS its tombstone (phase 3 skipped), so the next boot
				// re-purges idempotently — any slice rows a wall-clock-corner loser
				// (forward clock jump / multi-day suspension) lands AFTER this purge
				// are swept once it has quiesced. The loser's own finalize fails
				// RETRYABLY with the backup file still the source of truth; no in-use
				// profile can be deleted (the marker guard above).
				this.logError(`torn-import sweep: completing compensating delete for ${marker.profileId}`)
				await this.deleteProfile(marker.profileId, { pxeGeneration: marker.pxeGeneration, markerAt: marker.at })
			} catch (err) {
				this.logError(`torn-import sweep failed for ${marker.profileId}`, getErrorMessage(err))
			}
		}
	}

	public async importMnemonic(name: string, mnemonic: string[], password: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		// Boundary validation BEFORE any persistence, on the CANONICAL form (the same
		// normalizer the KDF applies — the same input can never validate one way and derive
		// another): exactly 24 words, every word on the wordlist, checksum valid (`getEntropy`
		// throws on unknown words and bad checksums).
		const words = canonicalizeMnemonic(mnemonic)
		if (words.length !== 24) {
			throw new Error("Invalid mnemonic length")
		}
		const entropy = await getEntropy(words)
		const secret = await deriveMasterFromMnemonic(words)
		const passhash = await EncryptionKey.getPasshash(password)
		// importPasswordProfile takes ownership of `secret` + `entropy` + `passhash`.
		return await this.importPasswordProfile(name, secret, entropy as Uint8Array<ArrayBuffer>, passhash)
	}

	public async exportPlain(id: string, password?: string, credentialData?: PasskeyCredentialData): Promise<string> {
		await this.ensureInitialized()
		// Capture the row + deletion epoch ATOMICALLY under the lock. A delete
		// (even one followed by a same-id restore) bumps the epoch permanently, so
		// the post-derivation check rejects a stale generation (codex verify r3).
		const { profile, capturedEpoch } = await this.runExclusive(async () => {
			const profile = await this.repo.get(id)
			if (!profile) {
				throw new Error("Invalid profile id")
			}
			// A tombstoned profile (mid-delete) must not export its master secret.
			if (this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			return { profile, capturedEpoch: this.deletionState.capture(id) }
		})

		if (profile.type === "passkey") {
			// Path A: caller (popup) ran the in-page WebAuthn ceremony via the
			// `PasskeyCeremonyDialog` modal and is handing us the credential
			// data. Materialize the credential SW-side and verify it actually
			// belongs to this profile — without the credentialId binding
			// check, a popup bug could supply data for a different key and
			// we'd happily export the wrong credentialId.
			//
			// `credentialData` is required for passkey profiles: the
			// previous Path B (SW opens a window via confirmProfileOperation)
			// is gone for this entry point. The remaining `confirmProfileOperation`
			// call site lives in `ConfirmPopup.vue` for now.
			if (!credentialData) {
				throw new Error("credentialData is required for passkey profile")
			}
			const recovery = await this.passkeyCoordinator.recoverFromCredentialData(credentialData)
			try {
				if (recovery.credentialId !== profile.credentialId) {
					throw new Error("Invalid profile id")
				}
			} finally {
				// Export doesn't need the derived master — security
				// minimization. The credentialId is the actual return.
				zeroize(recovery.secret)
			}
			// Refetch + credentialId-rotation check: a concurrent delete+
			// reimport during the (unlocked) WebAuthn prompt could have
			// rotated `credentialId` under us. Without this, the post-confirm
			// return would hand back a stale credentialId.
			const current = await this.repo.get(id)
			if (!current) {
				throw new Error("Invalid profile id")
			}
			// A delete that completed during the (unlocked) WebAuthn prompt must not
			// still return the credentialId (codex verify).
			if (
				this.deletionState.isReserved(id) ||
				!this.deletionState.isCurrent(id, capturedEpoch) ||
				current.type !== "passkey" ||
				current.credentialId !== profile.credentialId
			) {
				throw new Error("Invalid profile id")
			}
			return current.credentialId
		}

		if (!password) {
			throw new Error("Password is required")
		}
		// Single unseal — skip the redundant `confirmProfileOperation`
		// PBKDF2. Still emulate that method's outer catch: any throw
		// (including crypto-level failures) is flattened to a plain
		// `Error(message)` so callers see a stable error shape.
		try {
			const unsealed = await this.secretBox.unseal(password, {
				guard: asBase64Ciphertext(profile.guard),
				secret: asBase64Ciphertext(profile.secret),
				entropy: asBase64Ciphertext(profile.entropy),
			})
			try {
				if (!unsealed) {
					throw new InvalidPasswordError()
				}
				// Revalidate AFTER the slow unseal (codex verify): a delete that
				// completed DURING derivation — even fully (row gone, reservation
				// released) — must not still hand back the now-erased profile's
				// master secret. Re-fetch catches gone/reimported; isReserved catches
				// mid-delete.
				const still = await this.repo.get(id)
				if (!still || this.deletionState.isReserved(id) || !this.deletionState.isCurrent(id, capturedEpoch)) {
					throw new Error("Invalid profile id")
				}
				// Backup `master-key` semantics: ALWAYS the derived master, never entropy —
				// restore() seals this value verbatim as the working master.
				return Buffer.from(unsealed.secret).toString("base64")
			} finally {
				// zero secrets after base64-encode escapes (the base64
				// string is the wire format; we can't zero strings).
				if (unsealed) {
					zeroize(unsealed.secret)
					zeroize(unsealed.entropy)
				}
			}
		} catch (error) {
			this.logError("Failed to confirm operation", getErrorMessage(error))
			throw new Error(getErrorMessage(error))
		}
	}

	/**
	 * Atomic paired export for the Full-Backup builder: master + entropy from ONE unseal, so
	 * the two backup fields can never come from different row states (final-codex M1). Password
	 * profiles only — passkey backups carry the credentialId via `exportPlain` and re-derive
	 * the master from the passkey PRF at restore.
	 */
	public async exportBackupMaterial(id: string, password: string): Promise<{ masterKey: string; entropy: string }> {
		await this.ensureInitialized()
		const { profile, capturedEpoch } = await this.runExclusive(async () => {
			const profile = await this.repo.get(id)
			if (!profile) {
				throw new Error("Invalid profile id")
			}
			if (this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			return { profile, capturedEpoch: this.deletionState.capture(id) }
		})
		if (profile.type === "passkey") {
			throw new Error("Operation not supported for passkey profile")
		}
		const unsealed = await this.secretBox.unseal(password, {
			guard: asBase64Ciphertext(profile.guard),
			secret: asBase64Ciphertext(profile.secret),
			entropy: asBase64Ciphertext(profile.entropy),
		})
		try {
			if (!unsealed) {
				throw new InvalidPasswordError()
			}
			const still = await this.repo.get(id)
			if (!still || this.deletionState.isReserved(id) || !this.deletionState.isCurrent(id, capturedEpoch)) {
				throw new Error("Invalid profile id")
			}
			// Pairing check before EXPORT (P3 rider High): a backup built from a tampered/
			// transplanted row would otherwise report success with an unrestorable pair.
			await this.assertEntropyMasterPair(unsealed.secret, unsealed.entropy)
			return {
				masterKey: Buffer.from(unsealed.secret).toString("base64"),
				entropy: Buffer.from(unsealed.entropy).toString("base64"),
			}
		} finally {
			if (unsealed) {
				zeroize(unsealed.secret)
				zeroize(unsealed.entropy)
			}
		}
	}

	public async exportMnemonic(id: string, password: string): Promise<string[]> {
		await this.ensureInitialized()
		// Capture row + deletion epoch atomically (see exportPlain / codex verify r3).
		const { profile, capturedEpoch } = await this.runExclusive(async () => {
			const profile = await this.repo.get(id)
			if (!profile) {
				throw new Error("Invalid profile id")
			}
			// A tombstoned profile (mid-delete) must not export its seed phrase.
			if (this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			return { profile, capturedEpoch: this.deletionState.capture(id) }
		})
		if (profile.type === "passkey") {
			throw new Error("Operation not supported for passkey profile")
		}
		const unsealed = await this.secretBox.unseal(password, {
			guard: asBase64Ciphertext(profile.guard),
			secret: asBase64Ciphertext(profile.secret),
			entropy: asBase64Ciphertext(profile.entropy),
		})
		try {
			if (!unsealed) {
				// Identity-stable error message — the import flow expects this
				// exact string for its wrong-password branch.
				throw new Error("Invalid profile old password")
			}
			// The recovery words come from the STORED ENTROPY (the master derives one-way from
			// them and cannot be reversed). Pairing check before the words are ever revealed:
			// words that no longer derive the stored master would point at a DIFFERENT wallet —
			// the split-brain recovery attack — so fail closed instead of handing them out.
			const mnemonic = await getMnemonic(unsealed.entropy)
			await this.assertEntropyMasterPair(unsealed.secret, unsealed.entropy)
			// Revalidate under the lock AFTER the async derivations — a delete interleaving
			// during them must not let the erased profile's words escape (codex verify r4).
			await this.runExclusive(async () => {
				if (!(await this.repo.get(id)) || this.deletionState.isReserved(id) || !this.deletionState.isCurrent(id, capturedEpoch)) {
					throw new Error("Invalid profile id")
				}
			})
			return mnemonic
		} finally {
			// zero secrets after mnemonic words derived. The mnemonic
			// is itself sensitive (the user shows it on screen), but
			// zeroing the underlying buffers at least closes the
			// in-memory window.
			if (unsealed) {
				zeroize(unsealed.secret)
				zeroize(unsealed.entropy)
			}
		}
	}

	/**
	 * The words↔master pairing check, run at every site that has decrypted BOTH the entropy and
	 * the master: the stored recovery words MUST still derive the stored master. A mismatch means
	 * a tampered or cross-profile-transplanted ciphertext (the backup checksum is integrity-not-
	 * auth; purpose-AAD stops slot-swaps but not same-slot moves between same-password profiles).
	 * Throws before any secret is revealed, persisted, or exported. Zeroizes its own scratch.
	 */
	private async assertEntropyMasterPair(secret: MasterSecretBytes, entropy: Uint8Array<ArrayBuffer>): Promise<void> {
		const words = await getMnemonic(entropy)
		const rederived = await deriveMasterFromMnemonic(words)
		const paired = array_equals(rederived, secret)
		zeroize(rederived)
		if (!paired) {
			throw new Error("Profile storage corrupted")
		}
	}

	/** The whole-envelope MAC preimage for a sealed profile record. */
	private macEnvelope(p: { guard: string; secret: string; entropy: string }): MacEnvelope {
		return { guard: p.guard, secret: p.secret, entropy: p.entropy }
	}

	public async getProfileSecret(id: string): Promise<Fr> {
		await this.ensureInitialized()
		return this.runExclusive(() => {
			// A profile queued for deletion must not hand out its secret — a half-
			// deleted profile (tombstoned but not yet purged) is being erased.
			if (this.deletionState.isReserved(id)) throw new Error("Invalid profile id")
			return this.sessionManager.getSecret(id)
		})
	}

	/**
	 * The profile row's CURRENT incarnation generation, read under the facade
	 * lock with the row-exists + not-reserved validation the D4 fence requires
	 * at SEND time. `undefined` (row gone or tombstoned) makes the PXE client
	 * skip the capture/provision — a deleted profile cannot re-key its store.
	 */
	public async getPxeGeneration(id: string): Promise<string | undefined> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			if (this.deletionState.isReserved(id)) return undefined
			return (await this.repo.get(id))?.pxeGeneration
		})
	}

	/**
	 * takes ownership of `secret` + `passhash` from the public
	 * import* methods. Zeroes both in finally — runs on success, throw,
	 * and re-throw paths.
	 */
	private async importPasswordProfile(
		name: string,
		secret: MasterSecretBytes,
		entropy: Uint8Array<ArrayBuffer>,
		passhash: Passhash,
	): Promise<Profile> {
		try {
			return await this.runExclusive(async () => {
				const id = await this.nextUnreservedId()
				const encrypted = await this.secretBox.sealWithPasshash(passhash, secret, entropy)
				const envelopeMac = await computeEnvelopeMac(secret, this.macEnvelope(encrypted))
				const profile: Profile = {
					id,
					name,
					type: "password",
					pxeGeneration: mintPxeGeneration(),
					guard: encrypted.guard,
					secret: encrypted.secret,
					entropy: encrypted.entropy,
					envelopeMac,
				}
				await this.repo.set(id, profile)
				this.emit("onProfileAdded", this.getProfileInfo(profile))
				await this.openSessionVerified(profile, secret, passhash)
				return profile
			})
		} finally {
			zeroize(secret)
			zeroize(entropy)
			zeroize(passhash)
		}
	}

	/**
	 * takes ownership of `secret` from the recovery coordinator.
	 * Zeroes in finally.
	 */
	private async importPasskeyProfile(
		name: string,
		credentialId: string,
		secret: MasterSecretBytes,
		userHandle?: string,
	): Promise<Profile> {
		try {
			return await this.runExclusive(async () => {
				if (userHandle && ((await this.repo.contains(userHandle)) || this.deletionState.isReserved(userHandle))) {
					throw new Error("Passkey profile already exists")
				}

				// It is unclear if this case is possible, this is a fallback:
				if (!userHandle) {
					// MUST exclude reserved ids — this userHandle becomes the profile id,
					// and generateUniqueId only checks storage (a tombstoned profile's row
					// is already deleted, so its reserved id would otherwise be reused →
					// the resumed purge clobbers the new profile — audit id-reuse).
					userHandle = await this.nextUnreservedId()
				}

				const id = userHandle
				const profile: Profile = {
					id,
					name,
					type: "passkey",
					pxeGeneration: mintPxeGeneration(),
					credentialId,
				}
				await this.repo.set(id, profile)
				this.emit("onProfileAdded", this.getProfileInfo(profile))
				await this.openSessionVerified(profile, secret)
				return profile
			})
		} finally {
			zeroize(secret)
		}
	}

	private getProfileInfo(profile: Profile): ProfileInfo {
		return { id: profile.id, name: profile.name, type: profile.type }
	}

	public async backup(): Promise<ProfileInfo | undefined> {
		return await this.getActiveProfile()
	}

	public async restore(
		profile: ProfileInfo,
		secret: RestoreSecret,
		password?: string,
		credentialData?: PasskeyCredentialData,
	): Promise<Restored<ProfileInfo>> {
		await this.ensureInitialized()

		// The split's core invariant: the secret discriminant MUST match the profile
		// type — prevents a password master key reaching a passkey profile (or vice
		// versa), the swap the old polymorphic `masterKey: string` slot allowed.
		if (secret.type !== profile.type) {
			throw new Error("Restore secret type does not match profile type")
		}

		const rawSecret = secret.type === "password" ? secret.masterKey : secret.credentialId
		if (!rawSecret) {
			throw new Error("Master key is required to restore profile")
		}

		const profileNames = (await this.repo.getAll()).map((p) => p.name)
		const base = profile.name
		let name = base
		let counter = 1
		while (profileNames.includes(name)) {
			name = `${base} ${counter}`
			counter++
		}

		switch (secret.type) {
			case "password": {
				if (!password) {
					throw new Error("Password is required for password profile")
				}

				const plainSecret = Buffer.from(secret.masterKey, "base64")
				if (plainSecret.byteLength !== 32) {
					zeroize(plainSecret)
					throw new Error("Invalid master key length")
				}
				// Epoch-4 password backups REQUIRE entropy (passkey blobs must never carry it —
				// enforced by the RestoreSecret discriminated shape + the backup reader). Pairing
				// check BEFORE anything is sealed: the backup checksum is integrity-not-auth, so a
				// doctored blob can carry a self-consistent-looking but mismatched pair — restoring
				// it would mint a profile whose displayed recovery words derive a DIFFERENT master
				// than the one in use (audit H3).
				const plainEntropy = Buffer.from(secret.entropy, "base64") as Uint8Array<ArrayBuffer>
				if (plainEntropy.byteLength !== 32) {
					zeroize(plainSecret)
					zeroize(plainEntropy)
					throw new Error("Invalid entropy length")
				}
				{
					const words = await getMnemonic(plainEntropy)
					const rederived = await deriveMasterFromMnemonic(words)
					const paired = array_equals(rederived, plainSecret as Uint8Array<ArrayBuffer>)
					zeroize(rederived)
					if (!paired) {
						zeroize(plainSecret)
						zeroize(plainEntropy)
						throw new Error("Backup entropy does not derive the backup master key")
					}
				}

				// Buffers declared outside try so the finally always runs
				// against defined references. `passhash` is filled by `seal()`
				// inside the try — if seal throws, finally still zeros the
				// already-allocated `plainSecret`. (Pre-A11 had seal() outside
				// the try, leaking plainSecret on seal failure.)
				let passhash: ArrayBuffer | undefined
				try {
					return await this.runExclusive(async () => {
						try {
							const sealed = await this.secretBox.seal(
								password,
								asMasterSecretBytes(plainSecret as Uint8Array<ArrayBuffer>),
								plainEntropy,
							)
							passhash = sealed.passhash
							const envelopeMac = await computeEnvelopeMac(
								asMasterSecretBytes(plainSecret as Uint8Array<ArrayBuffer>),
								this.macEnvelope(sealed.encrypted),
							)

							let id = profile.id
							while ((await this.repo.contains(id)) || this.deletionState.isReserved(id)) {
								id = await this.repo.generateUniqueId()
							}

							const newProfile: Profile = {
								id,
								name,
								type: "password",
								// Fresh generation even on a same-id re-import: the D4 fence
								// distinguishes this incarnation from the deleted one.
								pxeGeneration: mintPxeGeneration(),
								guard: sealed.encrypted.guard,
								secret: sealed.encrypted.secret,
								entropy: sealed.encrypted.entropy,
								envelopeMac,
							}

							// Marker BEFORE row (fail-closed): a crash between the two writes
							// leaves an orphan marker with no row — lazily purged — never a
							// row without its restore-in-progress marker.
							await this.restorePending.write({ profileId: id, pxeGeneration: newProfile.pxeGeneration, at: Date.now() })
							try {
								await this.repo.set(id, newProfile)
							} catch (rowErr) {
								// Compensate: the row never landed, so the marker must not
								// brand a future same-id profile.
								await this.restorePending.delete(id).catch(() => {})
								throw rowErr
							}

							this.emit("onProfileAdded", this.getProfileInfo(newProfile))

							// Late activation: do NOT open the session here. The popup
							// will call `finalizeRestore(id, password)` after restoring
							// all backup data (networks, accounts, etc.) to avoid
							// `app.vue:onActiveProfileChanged` racing the import with
							// auto-seeded defaults.
							return this.getProfileInfo(newProfile)
						} catch (err) {
							// Build restoreError INSIDE the locked callback so it runs
							// before lock.leave() — byte-equivalent to the pre-refactor
							// catch-before-leave order (toRestoreError may invoke a
							// custom err.toString()).
							return {
								...profile,
								restoreError: toRestoreError(err),
							}
						}
					})
				} finally {
					zeroize(plainSecret)
					zeroize(plainEntropy)
					if (passhash) zeroize(passhash)
				}
			}
			case "passkey": {
				let recoverySecret: Uint8Array<ArrayBuffer> | undefined
				let storedPending = false
				try {
					// Path A only: caller (popup) ran the in-page modal
					// against the backup's credentialId. No SW-window
					// fallback — the previous Path B path is removed.
					if (!credentialData) {
						throw new Error("credentialData is required for passkey profile")
					}
					const recovery = await this.passkeyCoordinator.recoverFromCredentialData(credentialData)
					// Bind the modal-supplied credential to the credentialId
					// recorded in the backup file. Without this a popup bug
					// could stash a secret derived from the WRONG key, then
					// finalizeRestore would open a session bound to a master
					// that doesn't match the imported account address.
					if (recovery.credentialId !== secret.credentialId) {
						zeroize(recovery.secret)
						throw new Error("credentialId mismatch")
					}
					recoverySecret = recovery.secret
					// The restored profile id is the (hex) userHandle when the credential
					// carried one, else a freshly generated id — a plain profile-id string
					// either way, so widen off the `HexUserHandle` brand here.
					let id: string | undefined = recovery.userHandle

					// Only the storage tail is locked — the WebAuthn ceremony +
					// credentialId-bind above run UNLOCKED, and their early throws
					// must NOT reach a lock.leave() (the prior single try/finally
					// called leave() even when enter() was never reached).
					return await this.runExclusive(async () => {
						if (id && ((await this.repo.contains(id)) || this.deletionState.isReserved(id))) {
							throw new Error("Passkey profile already exists")
						}

						// It is unclear if this case is possible, this is a fallback:
						if (!id) {
							// Exclude reserved ids (see importPasskeyProfile) — generateUniqueId
							// only checks storage, so a tombstoned id could be reused here.
							id = await this.nextUnreservedId()
						}

						const newProfile: Profile = {
							id,
							name,
							type: "passkey",
							pxeGeneration: mintPxeGeneration(),
							credentialId: recovery.credentialId,
						}
						// Marker BEFORE row + compensation — same bracket as the password
						// branch (a torn passkey import must not escape detection).
						await this.restorePending.write({ profileId: id, pxeGeneration: newProfile.pxeGeneration, at: Date.now() })
						try {
							await this.repo.set(id, newProfile)
						} catch (rowErr) {
							await this.restorePending.delete(id).catch(() => {})
							throw rowErr
						}

						this.emit("onProfileAdded", this.getProfileInfo(newProfile))

						// Late activation: stash the recovery secret so finalize
						// can open the session without re-prompting WebAuthn.
						// The map takes ownership — DO NOT zero in finally.
						this.sweepStalePendingRestore(Date.now(), id)
						this.pendingRestoreSecrets.set(id, { secret: recovery.secret, capturedAt: Date.now() })
						storedPending = true

						return this.getProfileInfo(newProfile)
					})
				} catch (err) {
					return {
						...profile,
						restoreError: toRestoreError(err),
					}
				} finally {
					// Zero the recovery secret iff it never made it into the
					// pending map (early throws). If stashed, finalize owns it.
					if (!storedPending) zeroize(recoverySecret)
				}
			}

			default:
				throw new Error("Unknown profile type")
		}
	}

	/**
	 * Late-activation step for the full-backup import flow. Opens the session
	 * for a profile previously created by `restore()`. Splitting restore +
	 * activate lets the caller restore all the backup's networks / accounts /
	 * etc. BEFORE `onActiveProfileChanged` fires — without this split,
	 * `app.vue`'s handler would call `getOrInitNetworks` + `ensureDefaultAccount`
	 * in parallel with the import and race the imported data.
	 *
	 * Password profiles: re-derives the passhash from `password` (PBKDF2 cost
	 * paid again — acceptable for a one-time import flow).
	 *
	 * Passkey profiles: consumes the recovery secret stashed by `restore()`
	 * in `pendingRestoreSecrets`. NO second WebAuthn prompt. If no pending
	 * secret exists (SW restarted, finalize already ran, profile created via
	 * a non-restore path), throws — caller can fall back to the regular
	 * unlock flow.
	 *
	 * Idempotent in spirit: if the session is already active for this profile,
	 * skips the re-open (the no-op case after a second `finalizeRestore` call).
	 */
	public async finalizeRestore(id: string, password?: string): Promise<ProfileInfo> {
		await this.ensureInitialized()

		return this.runExclusive(async () => {
			// B-11: sweep stale entries but never the id being finalized here.
			this.sweepStalePendingRestore(Date.now(), id)
			const profile = await this.repo.get(id)
			if (!profile) {
				throw new Error("Invalid profile id")
			}
			// A tombstoned profile (SW died mid-delete: row still present, id
			// reserved) must not open a session — it is being erased. Gate here as
			// well as at row-read so a delete that began mid-restore is caught.
			if (this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}

			// Clear the restore-in-progress marker at ENTRY: being called at all
			// proves the storage-slice phase completed (the import flow only
			// finalizes after every slice restore). Clearing on entry — not on
			// session-open success — keeps finalize-throw survivors (wrong
			// password, lost passkey pending-secret) on their documented
			// unlock-later recovery instead of branding them torn.
			await this.restorePending.delete(id)

			// If the session is already active for this profile, treat as
			// no-op. Defensive against double-finalize.
			if (this.sessionManager.isActive(id)) {
				return this.getProfileInfo(profile)
			}

			if (profile.type === "password") {
				if (!password) {
					throw new Error("Password is required for password profile")
				}
				// Re-derive: unseal the stored ciphertext with the supplied
				// password. Mirrors `unlockProfile` Phase 3.
				const unsealed = await this.secretBox.unseal(password, {
					guard: asBase64Ciphertext(profile.guard),
					secret: asBase64Ciphertext(profile.secret),
					entropy: asBase64Ciphertext(profile.entropy),
				})
				if (!unsealed) {
					throw new InvalidPasswordError()
				}
				let passhash: Passhash | undefined
				try {
					// Pairing check before the session opens (P3 rider): a tamper between restore()
					// and finalize must not open a session whose recovery phrase is a lie. Inside
					// the try so a pairing throw still wipes the unsealed buffers (rider Low).
					await this.assertEntropyMasterPair(unsealed.secret, unsealed.entropy)
					passhash = await EncryptionKey.getPasshash(password)
					await this.openSessionVerified(profile, unsealed.secret, passhash)
					return this.getProfileInfo(profile)
				} finally {
					// zero buffers after sessionManager has copied.
					zeroize(unsealed.secret)
					zeroize(unsealed.entropy)
					zeroize(passhash)
				}
			}

			// Passkey: consume the stashed recovery secret. Remove it from the map
			// BEFORE the await (B-11) so no concurrent sweep can zeroize the buffer
			// while openSessionVerified is copying it; zeroize in finally.
			const pending = this.pendingRestoreSecrets.get(id)
			if (!pending) {
				throw new Error("No pending restore secret for passkey profile")
			}
			this.pendingRestoreSecrets.delete(id)
			try {
				await this.openSessionVerified(profile, pending.secret)
				return this.getProfileInfo(profile)
			} finally {
				zeroize(pending.secret)
			}
		})
	}
}
