import { Fr } from "@aztec/foundation/curves/bn254"
import { toRestoreError } from "@/utils/restore-error"
import type { BrowserApi } from "@nulo/wallet-core/ports"
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
import { EncryptionKey, PasswordSecretBox, zeroize } from "@nulo/wallet-crypto"
import { PasskeyService } from "@/wallet/services/passkey/service"
import { PasskeyRecoveryCoordinator, type PasskeyRecovery } from "./passkey-recovery-coordinator"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import { SessionManager } from "./session-manager"
import { PROFILE_SERVICE_NAME, type ProfileInfo, type Profile, type Events, type Methods } from "./spec"

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
	private readonly pendingRestoreSecrets = new Map<string, Uint8Array<ArrayBuffer>>()

	/**
	 * @param browserApi Optional. Tests pass `FakeBrowserApi` so the
	 *        collaborators work off in-memory storage without chrome.*. The
	 *        legacy SW boot path passes nothing and falls back to
	 *        `chrome.storage.local / session`.
	 */
	public constructor(config: IConfig, logger: ILogger, browserApi?: BrowserApi) {
		super(PROFILE_SERVICE_NAME, logger)
		this.repo = new ProfileRepository(browserApi)
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

		// Silent restore: SessionManager handles TTL expiry, missing
		// profile, wrong creds, and passkey-can't-silently-restore
		// internally. No emit on restore — subscribers pull via
		// getActiveProfile() when they mount.
		// F-11: the silent-restore bearer is now a random-token wrapped secret
		// (SessionSecretBox), so `restore()` no longer needs the passhash unsealer.
		await this.sessionManager.restore((id) => this.repo.get(id))
	}

	public async getActiveProfile(): Promise<ProfileInfo | undefined> {
		await this.ensureInitialized()
		try {
			await this.lock.enter()

			const session = await this.sessionManager.getActive()
			return session ? this.getProfileInfo(session.profile) : undefined
		} finally {
			this.lock.leave()
		}
	}

	public async getProfiles(): Promise<ProfileInfo[]> {
		await this.ensureInitialized()
		return (await this.repo.getAll()).map(this.getProfileInfo)
	}

	public async createProfile(name: string, password: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		const secret = Fr.random().toBuffer() as Buffer<ArrayBuffer>
		const { passhash, encrypted } = await this.secretBox.seal(password, secret)
		try {
			await this.lock.enter()

			const id = await this.repo.generateUniqueId()

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
		} finally {
			this.lock.leave()
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
		let snapshot: Profile & { type: "password" }
		try {
			await this.lock.enter()
			const fetched = await this.repo.get(id)
			if (!fetched) {
				throw new Error("Invalid profile id")
			}
			if (fetched.type === "passkey") {
				throw new Error("Profile requires passkey")
			}
			snapshot = fetched
		} finally {
			this.lock.leave()
		}

		// Phase 2 — crypto UNLOCKED. Caller pays ~1s PBKDF2 but the rest of
		// the RPC surface stays responsive.
		const secret = await this.secretBox.unseal(password, {
			guard: snapshot.guard,
			secret: snapshot.secret,
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
			await this.lock.enter()
			const current = await this.repo.get(id)
			if (!current) {
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
		} finally {
			this.lock.leave()
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
		return await this.repo.generateUniqueId()
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
		const id = credentialData?.userHandle ?? (await this.repo.generateUniqueId())
		const recovery = await this.acquireRecovery({ ceremony: "create", userHandle: id, name }, credentialData)

		try {
			await this.lock.enter()
			// Re-verify under the lock: another writer could have claimed
			// the id during the WebAuthn prompt. If so, throw a retryable
			// `ProfileIdConflictError` — the previous behavior silently
			// regenerated `id` here, which left the WebAuthn credential's
			// `userHandle` (= the OLD id) out of sync with the persisted
			// profile id. Caller is responsible for re-running the entire
			// flow with a fresh id (and a fresh WebAuthn ceremony).
			if (await this.repo.contains(id)) {
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
		} finally {
			this.lock.leave()
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
		try {
			await this.lock.enter()
			const fetched = await this.repo.get(id)
			if (!fetched) throw new Error("Invalid profile id")
			if (fetched.type !== "passkey") throw new Error("Profile requires password")
			if (!fetched.credentialId) throw new Error("Missing credentialId")
			return fetched.credentialId
		} finally {
			this.lock.leave()
		}
	}

	public async unlockPasskeyProfile(id: string, credentialData?: PasskeyCredentialData): Promise<ProfileInfo> {
		await this.ensureInitialized()

		// Phase 1 — snapshot profile under lock.
		let snapshot: Profile & { type: "passkey" }
		try {
			await this.lock.enter()
			const fetched = await this.repo.get(id)
			if (!fetched) {
				throw new Error("Invalid profile id")
			}
			if (fetched.type === "password") {
				throw new Error("Profile requires password")
			}
			if (!fetched.credentialId) {
				throw new Error("Missing credentialId")
			}
			snapshot = fetched
		} finally {
			this.lock.leave()
		}

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
			await this.lock.enter()
			const current = await this.repo.get(id)
			if (!current) {
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
		} finally {
			this.lock.leave()
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
		try {
			await this.lock.enter()
			await this.sessionManager.close()
		} finally {
			this.lock.leave()
		}
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
		try {
			await this.lock.enter()
			await this.sessionManager.refresh()
		} finally {
			this.lock.leave()
		}
	}

	public async changeProfileName(id: string, newName: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		try {
			await this.lock.enter()

			const profile = await this.repo.get(id)
			if (!profile) {
				throw new Error("Invalid profile id")
			}

			profile.name = newName
			await this.repo.set(id, profile)

			this.emit("onProfileUpdated", this.getProfileInfo(profile))

			this.sessionManager.patchActiveProfile(id, profile)

			return profile
		} finally {
			this.lock.leave()
		}
	}

	public async changeProfilePassword(id: string, oldPassword: string, newPassword: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		try {
			await this.lock.enter()

			const profile = await this.repo.get(id)
			if (!profile) {
				throw new Error("Invalid profile id")
			}
			if (profile.type === "passkey") {
				throw new Error("Operation not supported for passkey profile")
			}

			const resealed = await this.secretBox.reseal(oldPassword, newPassword, {
				guard: profile.guard,
				secret: profile.secret,
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
		} finally {
			this.lock.leave()
		}
	}

	/** Point-in-time "does this user know the password / still hold the
	 *  passkey?". Snapshots the profile under the lock, releases, runs the
	 *  credential check UNLOCKED. The caller's downstream op (if any) runs
	 *  its own lock + refetch, so there is no TOCTOU worth serializing here.
	 *  Only UI-local ConfirmPopup callbacks currently consume the return. */
	public async confirmProfileOperation(id: string, password?: string): Promise<boolean> {
		await this.ensureInitialized()

		let snapshot: Profile
		try {
			await this.lock.enter()
			const fetched = await this.repo.get(id)
			if (!fetched) {
				throw new Error("Invalid profile id")
			}
			snapshot = fetched
		} finally {
			this.lock.leave()
		}

		try {
			if (snapshot.type === "password") {
				if (!password) {
					throw new Error("Password is required")
				}
				const secret = await this.secretBox.unseal(password, {
					guard: snapshot.guard,
					secret: snapshot.secret,
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
			return true
		} catch (error) {
			this.logError("Failed to confirm operation", getErrorMessage(error))
			throw new Error(getErrorMessage(error))
		}
	}

	public async deleteProfile(id: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		try {
			await this.lock.enter()

			const profile = await this.repo.get(id)
			if (!profile) {
				throw new Error("Invalid profile id")
			}

			await this.repo.delete(id)

			this.emit("onProfileDeleted", this.getProfileInfo(profile))

			if (this.sessionManager.isActive(id)) {
				await this.sessionManager.close()
			}

			// Cleanup: any pending restore secret for this profile is now
			// unreachable. Happens when a backup-import rollback (e.g. the
			// Duplicate-address case) deletes the freshly-created profile
			// before finalize runs.
			const pending = this.pendingRestoreSecrets.get(id)
			if (pending) {
				this.pendingRestoreSecrets.delete(id)
				zeroize(pending)
			}

			return profile
		} finally {
			this.lock.leave()
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
		return await this.importPasswordProfile(name, _plainSecret, passhash)
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
		return await this.importPasswordProfile(name, _plainSecret, passhash)
	}

	public async importMnemonic(name: string, mnemonic: string[], password: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		const passhash = await EncryptionKey.getPasshash(password)
		const plain = await getEntropy(mnemonic)
		// importPasswordProfile takes ownership of `plain` + `passhash`.
		return await this.importPasswordProfile(name, plain, passhash)
	}

	public async exportEncrypted(id: string): Promise<string> {
		await this.ensureInitialized()
		try {
			await this.lock.enter()
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
			const profile = await this.repo.get(id)
			if (!profile) {
				throw new Error("Invalid profile id")
			}
			if (profile.type === "passkey") {
				throw new Error("Operation not supported for passkey profile")
			}
			return profile.secret
		} finally {
			this.lock.leave()
		}
	}

	public async exportPlain(id: string, password?: string, credentialData?: PasskeyCredentialData): Promise<string> {
		await this.ensureInitialized()
		const profile = await this.repo.get(id)
		if (!profile) {
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
			if (current.type !== "passkey" || current.credentialId !== profile.credentialId) {
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
				guard: profile.guard,
				secret: profile.secret,
			})
			try {
				if (!secret) {
					throw new InvalidPasswordError()
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
		if (profile.type === "passkey") {
			throw new Error("Operation not supported for passkey profile")
		}
		const secret = await this.secretBox.unseal(password, {
			guard: profile.guard,
			secret: profile.secret,
		})
		try {
			if (!secret) {
				// Identity-stable error message — the import flow expects this
				// exact string for its wrong-password branch.
				throw new Error("Invalid profile old password")
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
		try {
			await this.lock.enter()
			return await this.sessionManager.getSecret(id)
		} finally {
			this.lock.leave()
		}
	}

	/**
	 * takes ownership of `secret` + `passhash` from the public
	 * import* methods. Zeroes both in finally — runs on success, throw,
	 * and re-throw paths.
	 */
	private async importPasswordProfile(name: string, secret: Uint8Array<ArrayBuffer>, passhash: ArrayBuffer): Promise<Profile> {
		try {
			await this.lock.enter()
			const id = await this.repo.generateUniqueId()
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
		} finally {
			this.lock.leave()
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
		secret: Uint8Array<ArrayBuffer>,
		userHandle?: string,
	): Promise<Profile> {
		try {
			await this.lock.enter()
			if (userHandle && (await this.repo.contains(userHandle))) {
				throw new Error("Passkey profile already exists")
			}

			// It is unclear if this case is possible, this is a fallback:
			if (!userHandle) {
				userHandle = await this.repo.generateUniqueId()
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
		} finally {
			this.lock.leave()
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
		masterKey: string,
		password?: string,
		credentialData?: PasskeyCredentialData,
	): Promise<Restored<ProfileInfo>> {
		await this.ensureInitialized()

		if (!masterKey) {
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

		switch (profile.type) {
			case "password": {
				if (!password) {
					throw new Error("Password is required for password profile")
				}

				const plainSecret = Buffer.from(masterKey, "base64")
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
					await this.lock.enter()

					const sealed = await this.secretBox.seal(password, plainSecret as Uint8Array<ArrayBuffer>)
					passhash = sealed.passhash

					let id = profile.id
					while (await this.repo.contains(id)) {
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
					return {
						...profile,
						restoreError: toRestoreError(err),
					}
				} finally {
					this.lock.leave()
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
					if (recovery.credentialId !== masterKey) {
						zeroize(recovery.secret)
						throw new Error("credentialId mismatch")
					}
					recoverySecret = recovery.secret
					let id = recovery.userHandle

					await this.lock.enter()
					if (id && (await this.repo.contains(id))) {
						throw new Error("Passkey profile already exists")
					}

					// It is unclear if this case is possible, this is a fallback:
					if (!id) {
						id = await this.repo.generateUniqueId()
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
					this.pendingRestoreSecrets.set(id, recoverySecret)
					storedPending = true

					return this.getProfileInfo(newProfile)
				} catch (err) {
					return {
						...profile,
						restoreError: toRestoreError(err),
					}
				} finally {
					this.lock.leave()
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

		try {
			await this.lock.enter()
			const profile = await this.repo.get(id)
			if (!profile) {
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
					guard: profile.guard,
					secret: profile.secret,
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
		} finally {
			this.lock.leave()
		}
	}
}
