import { Fr } from "@aztec/foundation/curves/bn254"
import { toRestoreError } from "@/utils/restore-error"
import type { BrowserApi, StorageArea } from "@nulo/wallet-core/ports"
import type { IConfig } from "@/wallet/config"
import type { ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { InvalidPasswordError, ProfileIdConflictError } from "@nulo/extension-messaging/errors"
import { Lock } from "@/wallet/utils"
import { ProfileRepository } from "./repository"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { getEntropy, getMnemonic } from "@nulo/wallet-core/utils"
import {
	asBase64Ciphertext,
	asMasterSecretBytes,
	EncryptionKey,
	type MasterSecretBytes,
	type Passhash,
	PasswordSecretBox,
	zeroize,
} from "@nulo/wallet-crypto"
import { PasskeyService } from "@/wallet/services/passkey/service"
import { PasskeyRecoveryCoordinator, type PasskeyRecovery } from "./passkey-recovery-coordinator"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import { SessionManager } from "./session-manager"
import { PROFILE_SERVICE_NAME, type ProfileInfo, type Profile, type Events, type Methods, type RestoreSecret } from "./spec"
import { TombstoneRepository } from "./tombstone-repository"
import { ProfileDeletionState, type ExecutionFence } from "./profile-deletion-state"
import type { ProfileDeletionDelegate } from "../profile-deletion/types"

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
		"importEncrypted",
		"importPlain",
		"importPasskey",
		"importMnemonic",
		"exportEncrypted",
		"exportPlain",
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
	private readonly pendingRestoreSecrets = new Map<string, MasterSecretBytes>()

	/** Durable delete-in-progress markers (finding D). NOT an EntityStorage — see
	 *  TombstoneRepository: a corrupt tombstone must still reserve its id. */
	private readonly tombstones: TombstoneRepository
	/** In-memory reserved-id set + per-profile deletion epoch (fencing). Seeded
	 *  from the tombstone raw keys in `init()` BEFORE the session is restored.
	 *  Shared (via {@link getDeletionState}) with Execution + Transaction so a
	 *  worker that captured an epoch before a purge is fenced when it persists. */
	private readonly deletionState = new ProfileDeletionState()
	/** Lazily injected by the last-started ProfileDeletionCoordinator — the purge
	 *  executor. Never a topological dependency (would be a cycle). */
	private deletionDelegate: ProfileDeletionDelegate | null = null

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
		try {
			await this.lock.enter()
			return await fn()
		} finally {
			this.lock.leave()
		}
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
		await this.sessionManager.restore(
			// A tombstoned profile (SW died mid-delete: row present, id reserved) must
			// NOT have its session restored — it's being erased. Gate the lookup so no
			// downstream unlock/export/secret path can observe an active session for it.
			(id) => (this.deletionState.isReserved(id) ? Promise.resolve(undefined) : this.repo.get(id)),
			(passhash, profile) =>
				this.secretBox.unsealWithPasshash(passhash, {
					guard: asBase64Ciphertext(profile.guard),
					secret: asBase64Ciphertext(profile.secret),
				}),
		)
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
		const secret = asMasterSecretBytes(Fr.random().toBuffer() as Buffer<ArrayBuffer>)
		const { passhash, encrypted } = await this.secretBox.seal(password, secret)
		try {
			return await this.runExclusive(async () => {
				const id = await this.nextUnreservedId()

				const profile: Profile = {
					id,
					name,
					type: "password",
					guard: encrypted.guard,
					secret: encrypted.secret,
				}
				await this.repo.set(id, profile)

				this.emit("onProfileAdded", this.getProfileInfo(profile))

				await this.sessionManager.open(profile, secret, passhash)

				return profile
			})
		} finally {
			// zero secret + passhash after sessionManager has copied
			// what it needs (Fr.fromBuffer copies; passhash is base64-
			// encoded into Session). Done after lock release so a thrown
			// open()/repo.set() also gets the zeroize.
			zeroize(secret)
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
		const secret = await this.secretBox.unseal(password, {
			guard: asBase64Ciphertext(snapshot.guard),
			secret: asBase64Ciphertext(snapshot.secret),
		})
		if (!secret) {
			// Can't tell wrong-password from storage corruption from this single
			// null, but GUARD catches wrong-password first in practice. Auth UI
			// matches on InvalidPasswordError (popup/pages/auth.vue:65-74).
			throw new InvalidPasswordError()
		}
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
				if (current.guard !== snapshot.guard || current.secret !== snapshot.secret) {
					// Password changed under us. `secret` is for the OLD ciphertext;
					// the passhash wouldn't unseal the current encrypted blob, so
					// SessionManager.restore would silently close on the next SW
					// suspension. Refuse and let the user retry with the new password.
					throw new InvalidPasswordError()
				}
				await this.sessionManager.open(current, secret, passhash)
				return this.getProfileInfo(current)
			})
		} finally {
			// zero buffers after sessionManager has copied. Runs on
			// success AND on the revalidate-failure throw path.
			zeroize(secret)
			zeroize(passhash)
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
					credentialId: recovery.credentialId,
				}
				await this.repo.set(id, profile)

				this.emit("onProfileAdded", this.getProfileInfo(profile))

				await this.sessionManager.open(profile, recovery.secret)

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

		// F-007: bind the recovered credential to the target profile. Mirrors
		// the existing check in exportPlain (line ~656) and restore() (~916).
		// Without this, a popup-supplied PasskeyCredentialData for credential
		// B could unlock profile A using a session derived from credential B's
		// master secret — opening a session with the wrong key material.
		if (recovery.credentialId !== snapshot.credentialId) {
			throw new Error("Invalid profile id")
		}

		// Phase 3 — re-enter lock, revalidate credentialId, open session.
		try {
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
				await this.sessionManager.open(current, recovery.secret)
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
		})
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
			})
			if (!resealed) {
				throw new Error("Invalid profile old password")
			}

			profile.guard = resealed.encrypted.guard
			profile.secret = resealed.encrypted.secret
			await this.repo.set(id, profile)

			this.emit("onProfileUpdated", this.getProfileInfo(profile))

			if (this.sessionManager.isActive(id)) {
				// Re-unseal with the new password so we can re-open the session
				// with a fresh Fr. `reseal` returns the new passhash+encrypted
				// but not the raw secret; cheapest path is to unseal once here.
				const secret = await this.secretBox.unsealWithPasshash(resealed.passhash, resealed.encrypted)
				try {
					if (secret) {
						await this.sessionManager.open(profile, secret, resealed.passhash)
					}
				} finally {
					// zero secret + new passhash after session re-open.
					zeroize(secret)
					zeroize(resealed.passhash)
				}
			} else {
				// Even if no active session, the new passhash returned by
				// `reseal` was held briefly. Zero it.
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

		const snapshot = await this.runExclusive(async () => {
			const fetched = await this.repo.get(id)
			if (!fetched) {
				throw new Error("Invalid profile id")
			}
			// A tombstoned profile (mid-delete) must not be confirmable (codex verify).
			if (this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			return fetched
		})

		try {
			if (snapshot.type === "password") {
				if (!password) {
					throw new Error("Password is required")
				}
				const secret = await this.secretBox.unseal(password, {
					guard: asBase64Ciphertext(snapshot.guard),
					secret: asBase64Ciphertext(snapshot.secret),
				})
				try {
					if (!secret) {
						// Wrapped by the catch below into a generic Error. Keeps the
						// current "confirm rejects on wrong password" contract.
						throw new InvalidPasswordError()
					}
				} finally {
					// confirmation only checks decryptability — `secret`
					// is the live master key but is never used. Zero it.
					zeroize(secret)
				}
			} else {
				// Facade dispatches on profile.type — password path above goes
				// through PasswordSecretBox, passkey path goes through the
				// coordinator. Codex audit Q2 validated this shape.
				await this.passkeyCoordinator.confirm(snapshot)
			}
			// Revalidate AFTER the async credential op (codex verify): a delete that
			// completed during the (unlocked) derivation/prompt must not report a
			// successful confirmation for the now-erased profile. confirm returns a
			// boolean (no secret), so the delete check suffices — and must NOT reject
			// a LEGIT concurrent password change (that's not a delete).
			await this.runExclusive(async () => {
				if (!(await this.repo.get(id)) || this.deletionState.isReserved(id)) {
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

	/** The SHARED deletion state (reserved ids + per-profile epoch). Execution +
	 *  Transaction resolve this at init so a write that captured an epoch before a
	 *  delete is fenced when it tries to persist afterward (D13). */
	public getDeletionState(): ProfileDeletionState {
		return this.deletionState
	}

	/** Stable identity of a profile ROW (its sealed creds) — used to revalidate
	 *  after a slow unlocked op that a delete+reimport didn't reuse the id with
	 *  DIFFERENT creds (would otherwise leak the pre-delete secret; C1 revalidation). */
	private profileIdentity(p: Profile | undefined): string | undefined {
		if (!p) return undefined
		// The Profile discriminated union is intersected with ProfileInfo, which
		// defeats `p.type ===` narrowing — read the sealed fields off a widened view.
		const row = p as { type: string; guard?: string; secret?: string; credentialId?: string }
		return row.type === "passkey" ? `pk:${row.credentialId}` : `pw:${row.guard}:${row.secret}`
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
	 */
	public async deleteProfile(id: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		const delegate = this.deletionDelegate
		if (!delegate) throw new Error("deletion coordinator not ready")

		const { profile, epoch, snapshot } = await this.runExclusive(async () => {
			const profile = await this.repo.get(id)
			if (!profile || this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			const snapshot = await delegate.snapshot(id)
			const epoch = this.deletionState.beginDeletion(id)
			await this.tombstones.write({ profileId: id, ...snapshot, epoch })
			await this.repo.delete(id)
			// Close the session BEFORE the emit (a subscriber reacting to the emit
			// must not observe a still-open session for a deleted profile).
			if (this.sessionManager.isActive(id)) {
				await this.sessionManager.close()
			}
			const pending = this.pendingRestoreSecrets.get(id)
			if (pending) {
				this.pendingRestoreSecrets.delete(id)
				zeroize(pending)
			}
			this.emit("onProfileDeleted", this.getProfileInfo(profile))
			return { profile, epoch, snapshot }
		})

		await delegate.runFor(id, snapshot)

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
	 */
	public async resumePendingDeletions(): Promise<void> {
		const delegate = this.deletionDelegate
		if (!delegate) return
		for (const t of await this.tombstones.validPayloads()) {
			try {
				// Complete phase 1 idempotently — a crash may have written the tombstone
				// but not yet deleted the row / closed the session.
				await this.runExclusive(async () => {
					if (await this.repo.get(t.profileId)) await this.repo.delete(t.profileId)
					if (this.sessionManager.isActive(t.profileId)) await this.sessionManager.close()
				})
				await delegate.runFor(t.profileId, { addresses: t.addresses, tokenIds: t.tokenIds, networkIds: t.networkIds })
				await this.runExclusive(async () => {
					await this.tombstones.clearIfSame(t.profileId, t.epoch)
					this.deletionState.release(t.profileId)
				})
			} catch (err) {
				this.logError(`resume deletion failed for ${t.profileId}`, getErrorMessage(err))
			}
		}
	}

	public async importEncrypted(name: string, secret: string, password: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		// Different shape from Profile.secret — this is a raw ciphertext the
		// user pasted in, not a GUARD+secret pair. Decrypt directly through
		// EncryptionKey; wrong password or corrupted ciphertext both surface
		// as a thrown error, which we catch and map to "Invalid password".
		const passhash = await EncryptionKey.getPasshash(password)
		const key = await EncryptionKey.fromPasshash(passhash)
		const _secret = Buffer.from(secret, "base64") as Uint8Array<ArrayBuffer>
		let _plainSecret: Uint8Array<ArrayBuffer> | undefined
		try {
			_plainSecret = await key.decrypt(_secret)
		} catch {
			// Swallow — any decrypt failure means the user's blob + password
			// don't match. Fall through to the null-guarded throw below.
		}
		if (!_plainSecret) {
			// zero passhash on early-throw paths (importPasswordProfile
			// won't run + take ownership).
			zeroize(passhash)
			throw new Error("Invalid password")
		}
		if (_plainSecret.byteLength !== 32) {
			zeroize(_plainSecret)
			zeroize(passhash)
			throw new Error("Invalid secret length")
		}
		// importPasswordProfile takes ownership of `_plainSecret` + `passhash`.
		return await this.importPasswordProfile(name, asMasterSecretBytes(_plainSecret as Uint8Array<ArrayBuffer>), passhash)
	}

	public async importPlain(name: string, secret: string, password: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		const passhash = await EncryptionKey.getPasshash(password)
		const _plainSecret = Buffer.from(secret, "base64")
		if (_plainSecret.byteLength !== 32) {
			zeroize(_plainSecret)
			zeroize(passhash)
			throw new Error("Invalid secret length")
		}
		return await this.importPasswordProfile(name, asMasterSecretBytes(_plainSecret as Uint8Array<ArrayBuffer>), passhash)
	}

	public async importMnemonic(name: string, mnemonic: string[], password: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		const passhash = await EncryptionKey.getPasshash(password)
		const plain = await getEntropy(mnemonic)
		// importPasswordProfile takes ownership of `plain` + `passhash`.
		return await this.importPasswordProfile(name, asMasterSecretBytes(plain as Uint8Array<ArrayBuffer>), passhash)
	}

	public async exportEncrypted(id: string): Promise<string> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			// Auth gate (AUDIT A2): require the requested profile to be the
			// currently-active (unlocked) one. The encrypted blob is already
			// password-protected at rest, but leaking it to a caller whose only
			// context is "I know the id" is a logged-out-but-popup-open exfil
			// hole. Mirrors `SessionManager.getSecret`'s "Profile locked" check
			// (session-manager.ts:170-174) so the error shape is consistent
			// across the secret-access surface.
			const session = await this.sessionManager.getActive()
			if (session?.session.profile !== id) {
				throw new Error("Profile locked")
			}
			// A tombstoned profile (mid-delete) must not export its encrypted blob —
			// belt-and-suspenders with the gated session restore (a delete under this
			// same facade lock closes the session + reserves before releasing).
			if (this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			const profile = await this.repo.get(id)
			if (!profile) {
				throw new Error("Invalid profile id")
			}
			if (profile.type === "passkey") {
				throw new Error("Operation not supported for passkey profile")
			}
			return profile.secret
		})
	}

	public async exportPlain(id: string, password?: string, credentialData?: PasskeyCredentialData): Promise<string> {
		await this.ensureInitialized()
		const profile = await this.repo.get(id)
		if (!profile) {
			throw new Error("Invalid profile id")
		}
		// A tombstoned profile (mid-delete) must not export its master secret.
		if (this.deletionState.isReserved(id)) {
			throw new Error("Invalid profile id")
		}

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
			if (this.deletionState.isReserved(id) || current.type !== "passkey" || current.credentialId !== profile.credentialId) {
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
			const secret = await this.secretBox.unseal(password, {
				guard: asBase64Ciphertext(profile.guard),
				secret: asBase64Ciphertext(profile.secret),
			})
			try {
				if (!secret) {
					throw new InvalidPasswordError()
				}
				// Revalidate AFTER the slow unseal (codex verify): a delete that
				// completed DURING derivation — even fully (row gone, reservation
				// released) — must not still hand back the now-erased profile's
				// master secret. Re-fetch catches gone/reimported; isReserved catches
				// mid-delete.
				const still = await this.repo.get(id)
				if (!still || this.deletionState.isReserved(id) || this.profileIdentity(still) !== this.profileIdentity(profile)) {
					throw new Error("Invalid profile id")
				}
				return Buffer.from(secret).toString("base64")
			} finally {
				// zero secret after base64-encode escapes (the base64
				// string is the wire format; we can't zero strings).
				zeroize(secret)
			}
		} catch (error) {
			this.logError("Failed to confirm operation", getErrorMessage(error))
			throw new Error(getErrorMessage(error))
		}
	}

	public async exportMnemonic(id: string, password: string): Promise<string[]> {
		await this.ensureInitialized()
		const profile = await this.repo.get(id)
		if (!profile) {
			throw new Error("Invalid profile id")
		}
		// A tombstoned profile (mid-delete) must not export its seed phrase.
		if (this.deletionState.isReserved(id)) {
			throw new Error("Invalid profile id")
		}
		if (profile.type === "passkey") {
			throw new Error("Operation not supported for passkey profile")
		}
		const secret = await this.secretBox.unseal(password, {
			guard: asBase64Ciphertext(profile.guard),
			secret: asBase64Ciphertext(profile.secret),
		})
		try {
			if (!secret) {
				// Identity-stable error message — the import flow expects this
				// exact string for its wrong-password branch.
				throw new Error("Invalid profile old password")
			}
			// Revalidate AFTER the slow unseal (codex verify): a delete completing
			// during derivation must not still hand back the erased profile's seed.
			const still = await this.repo.get(id)
			if (!still || this.deletionState.isReserved(id) || this.profileIdentity(still) !== this.profileIdentity(profile)) {
				throw new Error("Invalid profile id")
			}
			return await getMnemonic(secret)
		} finally {
			// zero secret after mnemonic words derived. The mnemonic
			// is itself sensitive (the user shows it on screen), but
			// zeroing the underlying entropy buffer at least closes the
			// in-memory window.
			zeroize(secret)
		}
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
	 * takes ownership of `secret` + `passhash` from the public
	 * import* methods. Zeroes both in finally — runs on success, throw,
	 * and re-throw paths.
	 */
	private async importPasswordProfile(name: string, secret: MasterSecretBytes, passhash: Passhash): Promise<Profile> {
		try {
			return await this.runExclusive(async () => {
				const id = await this.nextUnreservedId()
				const encrypted = await this.secretBox.sealWithPasshash(passhash, secret)
				const profile: Profile = {
					id,
					name,
					type: "password",
					guard: encrypted.guard,
					secret: encrypted.secret,
				}
				await this.repo.set(id, profile)
				this.emit("onProfileAdded", this.getProfileInfo(profile))
				await this.sessionManager.open(profile, secret, passhash)
				return profile
			})
		} finally {
			zeroize(secret)
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
					credentialId,
				}
				await this.repo.set(id, profile)
				this.emit("onProfileAdded", this.getProfileInfo(profile))
				await this.sessionManager.open(profile, secret)
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

				// Buffers declared outside try so the finally always runs
				// against defined references. `passhash` is filled by `seal()`
				// inside the try — if seal throws, finally still zeros the
				// already-allocated `plainSecret`. (Pre-A11 had seal() outside
				// the try, leaking plainSecret on seal failure.)
				let passhash: ArrayBuffer | undefined
				try {
					return await this.runExclusive(async () => {
						try {
							const sealed = await this.secretBox.seal(password, asMasterSecretBytes(plainSecret as Uint8Array<ArrayBuffer>))
							passhash = sealed.passhash

							let id = profile.id
							while ((await this.repo.contains(id)) || this.deletionState.isReserved(id)) {
								id = await this.repo.generateUniqueId()
							}

							const newProfile: Profile = {
								id,
								name,
								type: "password",
								guard: sealed.encrypted.guard,
								secret: sealed.encrypted.secret,
							}

							await this.repo.set(id, newProfile)

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
							credentialId: recovery.credentialId,
						}
						await this.repo.set(id, newProfile)

						this.emit("onProfileAdded", this.getProfileInfo(newProfile))

						// Late activation: stash the recovery secret so finalize
						// can open the session without re-prompting WebAuthn.
						// The map takes ownership — DO NOT zero in finally.
						this.pendingRestoreSecrets.set(id, recovery.secret)
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
				const secret = await this.secretBox.unseal(password, {
					guard: asBase64Ciphertext(profile.guard),
					secret: asBase64Ciphertext(profile.secret),
				})
				if (!secret) {
					throw new InvalidPasswordError()
				}
				const passhash = await EncryptionKey.getPasshash(password)
				try {
					await this.sessionManager.open(profile, secret, passhash)
					return this.getProfileInfo(profile)
				} finally {
					// zero buffers after sessionManager has copied.
					zeroize(secret)
					zeroize(passhash)
				}
			}

			// Passkey: consume the stashed recovery secret.
			const pending = this.pendingRestoreSecrets.get(id)
			if (!pending) {
				throw new Error("No pending restore secret for passkey profile")
			}
			try {
				await this.sessionManager.open(profile, pending)
				return this.getProfileInfo(profile)
			} finally {
				this.pendingRestoreSecrets.delete(id)
				zeroize(pending)
			}
		})
	}
}
