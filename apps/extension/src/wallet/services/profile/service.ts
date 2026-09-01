import type { Fr } from "@aztec/foundation/curves/bn254"
import { toRestoreError } from "@/utils/restore-error"
import type { BrowserApi, StorageArea } from "@nulo/wallet-core/ports"
import type { IConfig } from "@/wallet/config"
import { LogLevel, type ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import {
	AccountAddressInconsistencyError,
	DuplicateWalletError,
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
	asImportedKeysDek,
	asMasterSecretBytes,
	computeEnvelopeMacV3,
	computeWalletFingerprint,
	deriveMasterFromMnemonic,
	EncryptionKey,
	generateImportedKeysDek,
	IMPORTED_DEK_AAD,
	IMPORTED_KEYS_DEK_LEN,
	type ImportedKeysDek,
	type MacEnvelopeV3,
	type MasterSecretBytes,
	type Passhash,
	PasswordSecretBox,
	sealDekUnderWrapKey,
	unsealDekUnderWrapKey,
	verifyEnvelopeMacV3,
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
	type ProfileType,
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

/** Out-params for `restore`'s locked commit bodies: allocations made under the lock are
 *  reported back so the branch's single post-lock-release `finally` owns every buffer wipe. */
type PasswordRestoreScratch = { passhash?: Passhash; destinationDek?: ImportedKeysDek; storedContext: boolean }
type PasskeyRestoreScratch = { stashDek?: ImportedKeysDek; storedPending: boolean; storedContext: boolean }

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
		"getProfileDekSealed",
		"exportMnemonic",
		"restore",
		"finalizeRestore",
	)
	public static name = PROFILE_SERVICE_NAME

	public readonly onProfileAdded = new EventHandler<ProfileInfo>()
	public readonly onProfileUpdated = new EventHandler<ProfileInfo>()
	public readonly onProfileDeleted = new EventHandler<ProfileInfo>()
	public readonly onActiveProfileChanged = new EventHandler<ProfileInfo | undefined>()
	public readonly onImportedKeysDegraded = new EventHandler<ProfileInfo>()

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
	private readonly pendingRestoreSecrets = new Map<
		string,
		{
			secret: MasterSecretBytes
			dek: ImportedKeysDek
			capturedAt: number
			/** The security-bearing row fields as restore() wrote them. Finalize compares the
			 *  live row against this snapshot before a clean open — an A1 writer editing
			 *  `dekSealed`/`credentialId`/`pxeGeneration` between restore and finalize must not
			 *  get a clean session carrying the stashed master (the fingerprint binding alone
			 *  would miss those fields). */
			expected: { type: ProfileType; credentialId: string; dekSealed: string; pxeGeneration: string; walletFingerprint: string }
		}
	>()

	/**
	 * TTL-bound, memory-only source→destination DEK rewrap context (final-audit condition).
	 * `restore()` runs BEFORE the imported-keys slice arrives, so the SOURCE DEK cannot be
	 * consumed inside restore itself: it is stashed here — both profile types — and
	 * `AccountService.restoreImportedKeys` consumes it atomically (rewraps every backup key row
	 * source→destination, zeroizes the source immediately). `finalizeRestore` zeroizes any
	 * LEFTOVER context for its id (the empty-slice case); the shared TTL sweep covers abandoned
	 * restores + SW death. An expired/missing context with rows present fails those rows into
	 * the existing orphan taxonomy — never silently-kept undecryptable rows.
	 */
	private readonly pendingDekRewraps = new Map<
		string,
		{ sourceDek: ImportedKeysDek; destinationDek: ImportedKeysDek; capturedAt: number }
	>()

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
				zeroize(entry.dek)
			}
		}
		for (const [id, entry] of this.pendingDekRewraps) {
			if (id === exceptId) continue
			if (now - entry.capturedAt >= ProfileService.PENDING_RESTORE_TTL_MS) {
				this.pendingDekRewraps.delete(id)
				zeroize(entry.sourceDek)
				zeroize(entry.destinationDek)
			}
		}
	}

	/**
	 * Pop the restore rewrap context for `profileId` (see `pendingDekRewraps`). The caller
	 * (AccountService.restoreImportedKeys) takes ownership of BOTH buffers and zeroizes them.
	 * `undefined` = expired / already consumed / never created — the caller fails its rows into
	 * the orphan taxonomy.
	 */
	public async consumeDekRewrapContext(
		profileId: string,
	): Promise<{ sourceDek: ImportedKeysDek; destinationDek: ImportedKeysDek } | undefined> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			const now = Date.now()
			this.sweepStalePendingRestore(now, profileId)
			const entry = this.pendingDekRewraps.get(profileId)
			if (!entry) return undefined
			this.pendingDekRewraps.delete(profileId)
			// The sweep above EXCLUDES this id (it must not free the entry mid-consume), so the TTL
			// has to be enforced here or it never applies to the one entry that matters: an
			// abandoned restore's raw SOURCE DEK would stay consumable for the whole SW lifetime.
			if (now - entry.capturedAt >= ProfileService.PENDING_RESTORE_TTL_MS) {
				zeroize(entry.sourceDek)
				zeroize(entry.destinationDek)
				return undefined
			}
			return { sourceDek: entry.sourceDek, destinationDek: entry.destinationDek }
		})
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

	/** The row's three password-sealed slots as the branded triple `PasswordSecretBox` consumes. */
	private sealedTriple(p: { guard: string; secret: string; entropy: string }) {
		return { guard: asBase64Ciphertext(p.guard), secret: asBase64Ciphertext(p.secret), entropy: asBase64Ciphertext(p.entropy) }
	}

	/** Caller MUST already hold the facade lock (`Lock` is non-reentrant). Checks row
	 *  PRESENCE only — deliberately blind to a deletion reservation; the mutation
	 *  paths built on it accept a tombstoned-but-present row (pinned bug, see the
	 *  integration suite's tombstoned-row pin). */
	private async getProfileOrThrowHoldingLock(id: string): Promise<Profile> {
		const profile = await this.repo.get(id)
		if (!profile) {
			throw new Error("Invalid profile id")
		}
		return profile
	}

	/** Capture the row + its deletion epoch in ONE critical section. A tombstoned
	 *  profile (mid-delete: row present, id reserved) is invalid here — `repo.get`
	 *  alone is blind to the reservation. The epoch survives even a delete FOLLOWED
	 *  by a same-id restore (it bumps permanently), so a later `profileFenceBroken`
	 *  check rejects the stale generation. */
	private async captureRowFence(id: string): Promise<{ profile: Profile; capturedEpoch: number }> {
		return this.runExclusive(async () => {
			const profile = await this.getProfileOrThrowHoldingLock(id)
			if (this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			return { profile, capturedEpoch: this.deletionState.capture(id) }
		})
	}

	/** The post-derivation staleness re-check paired with `captureRowFence`: the row is
	 *  gone, reserved, or its deletion epoch advanced during the (slow, unlocked)
	 *  crypto/prompt in between. Lock wrapping is the CALLER's: the confirm/mnemonic
	 *  sites re-check under the facade lock, the export sites run it lock-free. */
	private async profileFenceBroken(id: string, capturedEpoch: number): Promise<boolean> {
		return !(await this.repo.get(id)) || this.deletionState.isReserved(id) || !this.deletionState.isCurrent(id, capturedEpoch)
	}

	private async snapshotForUnlock(id: string, expect: "password"): Promise<Extract<Profile, { type: "password" }>>
	private async snapshotForUnlock(id: string, expect: "passkey"): Promise<Extract<Profile, { type: "passkey" }>>
	/** Phase-1 snapshot for the two unlock flows: fetch + tombstone gate + type gate in
	 *  ONE critical section. The type arms are asymmetric on purpose — each rejects the
	 *  OTHER stored type by name (a hypothetical third type passes both, preserved
	 *  verbatim), and only the passkey arm requires `credentialId`. */
	private async snapshotForUnlock(id: string, expect: "password" | "passkey"): Promise<Profile> {
		return this.runExclusive(async () => {
			const fetched = await this.getProfileOrThrowHoldingLock(id)
			// A tombstoned profile (mid-delete: row present, id reserved) must not be
			// unlocked — its data is being purged; `repo.get` alone is blind to the
			// reservation.
			if (this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			if (expect === "password") {
				if (fetched.type === "passkey") {
					throw new Error("Profile requires passkey")
				}
			} else {
				if (fetched.type === "password") {
					throw new Error("Profile requires password")
				}
				if (!fetched.credentialId) {
					throw new Error("Missing credentialId")
				}
			}
			return fetched
		})
	}

	/** The password-side DEK trust gate at session open: unseal the slot, then prove the
	 *  envelope MAC still covers this exact record — verified against the REQUESTED id,
	 *  never the row's self-claimed one (belt-and-suspenders on EntityStorage's id/key
	 *  guard). `null`, never a throw, on unseal/MAC failure: the caller opens
	 *  derived-only (degradation state machine, rule 2) and emits the visible warning.
	 *  Caller MUST hold the facade lock and OWNS the returned dek; on an internal throw
	 *  after the unseal, the local dek is zeroized here before the rethrow. */
	private async unsealTrustedDekHoldingLock(
		id: string,
		row: Extract<Profile, { type: "password" }>,
		secret: MasterSecretBytes,
		passhash: Passhash,
		logContext: string,
	): Promise<ImportedKeysDek | null> {
		let dek: ImportedKeysDek | null = null
		try {
			dek = await this.unsealDekWithPasshash(passhash, row.dekSealed)
			if (dek) {
				const macOk = await verifyEnvelopeMacV3(
					id,
					secret,
					dek,
					this.macEnvelopeV3(
						{ guard: row.guard, secret: row.secret, entropy: row.entropy },
						row.dekSealed,
						row.walletFingerprint,
					),
					row.envelopeMac,
				)
				if (!macOk) {
					zeroize(dek)
					dek = null
				}
			}
		} catch (err) {
			zeroize(dek)
			throw err
		}
		if (!dek) {
			this.logger.log(this.name, LogLevel.Error, `imported-keys DEK/MAC failed at ${logContext} — opening derived-only`, id)
		}
		return dek
	}

	/** The passkey-side DEK trust gate: rows carry no envelope MAC (nothing
	 *  password-sealed to cover), so the plaintext fingerprint is bound by RECOMPUTING
	 *  it from the ceremony's freshly derived master — a same-credential ceremony always
	 *  reproduces the same master, so a mismatch means the stored row was edited; treated
	 *  exactly like a failed envelope MAC on the password side (derived-only, visible
	 *  warning). Caller MUST hold the facade lock and owns the returned dek. */
	private async unsealPasskeyDekHoldingLock(
		id: string,
		current: Extract<Profile, { type: "passkey" }>,
		recovery: PasskeyRecovery,
	): Promise<ImportedKeysDek | null> {
		const expectedFingerprint = await computeWalletFingerprint(recovery.secret)
		let dek: ImportedKeysDek | null = null
		try {
			if (current.walletFingerprint === expectedFingerprint) {
				dek = await unsealDekUnderWrapKey(recovery.dekWrapKey, current.dekSealed)
			}
		} catch {
			dek = null
		}
		if (!dek) {
			this.logger.log(
				this.name,
				LogLevel.Error,
				current.walletFingerprint !== expectedFingerprint
					? "passkey wallet fingerprint mismatch — opening derived-only"
					: "imported-keys DEK failed at passkey unlock — opening derived-only",
				id,
			)
		}
		return dek
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
		// Fresh imported-keys DEK, minted per profile (credential-sealed below — never
		// master-derived; see the Profile.dekSealed doc).
		const dek = generateImportedKeysDek()
		let passhash: Passhash | undefined
		try {
			const sealed = await this.secretBox.seal(password, secret, entropy)
			passhash = sealed.passhash
			const encrypted = sealed.encrypted
			const dekSealed = await this.sealDekWithPasshash(passhash, dek)
			return await this.runExclusive(async () => {
				// Invariant assertion on fresh CSPRNG entropy (a collision is cryptographically
				// impossible) — kept uniform with the import/restore paths.
				const walletFingerprint = await this.assertNotDuplicateWallet(secret, false)
				const id = await this.nextUnreservedId()
				// The envelope MAC binds the row's OWN storage key (plus its fingerprint), so it
				// can only be computed after the id is final — hence inside this locked section,
				// after allocation. PBKDF2 stays outside; this is microseconds.
				const envelopeMac = await computeEnvelopeMacV3(id, secret, dek, this.macEnvelopeV3(encrypted, dekSealed, walletFingerprint))

				const profile: Profile = {
					id,
					name,
					type: "password",
					pxeGeneration: mintPxeGeneration(),
					dekSealed,
					walletFingerprint,
					guard: encrypted.guard,
					secret: encrypted.secret,
					entropy: encrypted.entropy,
					envelopeMac,
				}
				await this.persistNewProfileHoldingLock(profile)

				await this.openSessionVerified(profile, secret, passhash, dek)

				return profile
			})
		} finally {
			// zero secret + entropy + dek + passhash after sessionManager has copied
			// what it needs (Fr.fromBuffer copies; the session stores a dek COPY).
			// Done after lock release so a thrown open()/repo.set() also gets the zeroize.
			zeroize(secret)
			zeroize(entropy)
			zeroize(dek)
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
		const snapshot = await this.snapshotForUnlock(id, "password")

		// Phase 2 — crypto UNLOCKED. Caller pays ~1s PBKDF2 but the rest of
		// the RPC surface stays responsive.
		const unsealed = await this.secretBox.unseal(password, this.sealedTriple(snapshot))
		if (!unsealed) {
			// Can't tell wrong-password from storage corruption from this single
			// null, but GUARD catches wrong-password first in practice. Auth UI
			// matches on InvalidPasswordError (popup/pages/auth.vue:65-74).
			throw new InvalidPasswordError()
		}
		const { secret, entropy } = unsealed
		let dek: ImportedKeysDek | null = null
		try {
			// Pairing check at the entropy-decryption site: the stored words must still derive
			// the stored master. A mismatch means a tampered/corrupted/transplanted row whose
			// exported recovery phrase would point at a DIFFERENT wallet — fail closed before any
			// session opens. (CORE material — this failure BLOCKS, per the degradation state
			// machine rule 1; the DEK/MAC checks below degrade instead.)
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
					// Degradation state machine, rule 2: a DEK-unseal failure OR an envelope-MAC
					// v3 failure opens DERIVED-ONLY — imported accounts quarantine per-account
					// (A4: imported material must never profile-block derived funds; blocking
					// here would hand a storage-writer a one-field DoS lever), a user-visible
					// warning fires (the popup listens on onImportedKeysDegraded — never just a
					// log), and NO bearer is persisted (open() enforces that from the absent dek).
					dek = await this.unsealTrustedDekHoldingLock(id, current, secret, passhash, "unlock")
					await this.openSessionVerified(current, secret, passhash, dek ?? undefined)
					if (!dek) {
						this.emit("onImportedKeysDegraded", this.getProfileInfo(current))
					}
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
			zeroize(dek)
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
		// Fresh imported-keys DEK, sealed under the PRF-derived wrap key while the ceremony's
		// credential material is in hand (the SIXTH row-construction site — every creation path
		// mints a DEK + fingerprint).
		const dek = generateImportedKeysDek()

		try {
			const dekSealed = await sealDekUnderWrapKey(recovery.dekWrapKey, dek)
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
				// Invariant assertion (fresh credential ⇒ fresh PRF ⇒ fresh master).
				const walletFingerprint = await this.assertNotDuplicateWallet(recovery.secret, false)

				const profile: Profile = {
					id,
					name,
					type: "passkey",
					pxeGeneration: mintPxeGeneration(),
					dekSealed,
					walletFingerprint,
					credentialId: recovery.credentialId,
				}
				await this.persistNewProfileHoldingLock(profile)

				await this.openSessionVerified(profile, recovery.secret, undefined, dek)

				return profile
			})
		} finally {
			// zero recovery secret + dek after sessionManager copied them.
			zeroize(recovery.secret)
			zeroize(dek)
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
		const snapshot = await this.snapshotForUnlock(id, "passkey")

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
				const dek = await this.unsealPasskeyDekHoldingLock(id, current, recovery)
				try {
					await this.openSessionVerified(current, recovery.secret, undefined, dek ?? undefined)
					if (!dek) {
						this.emit("onImportedKeysDegraded", this.getProfileInfo(current))
					}
					return this.getProfileInfo(current)
				} finally {
					zeroize(dek)
				}
			})
		} finally {
			// zero recovery secret after sessionManager copied it.
			zeroize(recovery.secret)
		}
	}

	public async importPasskey(name: string, credentialData?: PasskeyCredentialData, allowDuplicate = false): Promise<ProfileInfo> {
		await this.ensureInitialized()
		// PATH A: caller already ran a discovery `get` ceremony in the modal;
		// `credentialData.userHandle` is whatever the user-selected credential
		// reports (the wallet uses this as the new profile id, mirroring the
		// existing import-passkey contract).
		// PATH B: SW opens a window via `passkeyCoordinator.recoverUnknown`.
		const recovery = await this.acquireRecovery({ ceremony: "getAny" }, credentialData)
		return await this.importPasskeyProfile(
			name,
			recovery.credentialId,
			recovery.secret,
			recovery.dekWrapKey,
			recovery.userHandle,
			allowDuplicate,
		)
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
			const profile = await this.getProfileOrThrowHoldingLock(id)

			profile.name = newName
			await this.repo.set(id, profile)

			this.emit("onProfileUpdated", this.getProfileInfo(profile))

			this.sessionManager.patchActiveProfile(id, profile)

			return profile
		})
	}

	/** Unseal the freshly-resealed pair and run the pre-commit integrity gates: fail
	 *  CLOSED on a null unseal (`resealed.encrypted` was just minted under
	 *  `resealed.passhash`, so null means the row is corrupt — continuing would persist
	 *  the new cipher while SKIPPING the pairing check, the integrity pre-check, and the
	 *  MAC re-key), then the pairing check BEFORE anything commits (a change-password on
	 *  a transplanted-entropy row must NOT launder the mismatch into a MAC-valid
	 *  profile), then the pre-persist drift verify — on drift nothing is committed AND
	 *  the current session closes (a rejected change must not leave the blocked profile
	 *  operating). Caller MUST hold the facade lock and OWNS the returned buffers; on a
	 *  throw after the unseal they are zeroized here before the rethrow. */
	private async unsealResealedVerifiedHoldingLock(
		id: string,
		resealed: NonNullable<Awaited<ReturnType<PasswordSecretBox["reseal"]>>>,
	): Promise<{ secret: MasterSecretBytes; entropy: Uint8Array<ArrayBuffer> }> {
		const unsealed = await this.secretBox.unsealWithPasshash(resealed.passhash, resealed.encrypted)
		const secret = unsealed?.secret ?? null
		const entropy = unsealed?.entropy ?? null
		if (!secret || !entropy) {
			zeroize(secret)
			zeroize(entropy)
			throw new Error("Profile storage corrupted")
		}
		try {
			await this.assertEntropyMasterPair(secret, entropy)
			try {
				await this.integrityDelegate?.verifyBeforeSessionOpen(id, secret)
			} catch (precheckError) {
				if (precheckError instanceof AccountAddressInconsistencyError && this.sessionManager.isActive(id)) {
					await this.sessionManager.close()
				}
				throw precheckError
			}
		} catch (err) {
			zeroize(secret)
			zeroize(entropy)
			throw err
		}
		return { secret, entropy }
	}

	/** Recover the DEK under the RETIRED password and re-key it for the new one. Failure
	 *  to unseal the old slot SELF-HEALS with a fresh mint (a lost DEK already means
	 *  every imported key is dead — A4 repair is delete+re-import — so a fresh mint
	 *  restores forward function without masking anything). But a recovered DEK whose
	 *  envelope MAC does not cover the row is REFUSED, not healed: re-MACing would
	 *  launder a transplanted `dekSealed` that unlock had quarantined into a
	 *  freshly-valid envelope, and a MAC failure cannot distinguish that from
	 *  corruption of the MAC field alone (DEK intact, keys recoverable) — minting fresh
	 *  would silently destroy recoverable keys in the second case. The non-destructive
	 *  repair is export a full backup (deliberately still works — see
	 *  `exportBackupMaterial`) and restore it. Caller MUST hold the facade lock and OWNS
	 *  the returned dek + oldPasshash; on a throw after allocation they are zeroized
	 *  here before the rethrow. */
	private async rekeyedDekForPasswordChangeHoldingLock(
		id: string,
		profile: Extract<Profile, { type: "password" }>,
		secret: MasterSecretBytes,
		oldPassword: string,
		newPasshash: Passhash,
	): Promise<{ dek: ImportedKeysDek; oldPasshash: Passhash; newDekSealed: string }> {
		let dek: ImportedKeysDek | null = null
		let oldPasshash: Passhash | null = null
		try {
			oldPasshash = await EncryptionKey.getPasshash(oldPassword)
			dek = await this.unsealDekWithPasshash(oldPasshash, profile.dekSealed)
			if (dek && !(await this.envelopeMacValid(id, profile, secret, dek))) {
				this.logger.log(this.name, LogLevel.Error, "envelope MAC does not cover the DEK slot at password change", id)
				throw new Error("Profile integrity check failed — export a full backup and restore it before changing the password")
			}
			if (!dek) {
				this.logger.log(this.name, LogLevel.Error, "imported-keys DEK unrecoverable at password change — minting fresh", id)
				dek = generateImportedKeysDek()
			}
			const newDekSealed = await this.sealDekWithPasshash(newPasshash, dek)
			return { dek, oldPasshash, newDekSealed }
		} catch (err) {
			zeroize(dek)
			zeroize(oldPasshash)
			throw err
		}
	}

	/** Re-open the active session over the just-committed row with a fresh Fr.
	 *  `openSessionVerified` re-runs the integrity check + the deletion bracket. If the
	 *  RE-check now fails on an address-drift block (e.g. a foreign account was restored
	 *  between the pre-check and here), the password change ALREADY SUCCEEDED — it must
	 *  not be reported as a failure. Swallow ONLY that typed error: openSessionVerified
	 *  has already persisted the block + closed the session, so the barrier surfaces the
	 *  drift as its own handled state. Any other error (deletion fence, etc.)
	 *  propagates. Caller MUST hold the facade lock. */
	private async reopenAfterPasswordChangeHoldingLock(
		id: string,
		profile: Profile,
		secret: MasterSecretBytes,
		passhash: Passhash,
		dek: ImportedKeysDek,
	): Promise<void> {
		if (!this.sessionManager.isActive(id)) return
		try {
			await this.openSessionVerified(profile, secret, passhash, dek)
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

	public async changeProfilePassword(id: string, oldPassword: string, newPassword: string): Promise<ProfileInfo> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			const profile = await this.getProfileOrThrowHoldingLock(id)
			if (profile.type === "passkey") {
				throw new Error("Operation not supported for passkey profile")
			}

			const resealed = await this.secretBox.reseal(oldPassword, newPassword, this.sealedTriple(profile))
			if (!resealed) {
				throw new Error("Invalid profile old password")
			}

			// Unseal the (new-cipher) secret up front so integrity can be checked BEFORE the new
			// password is persisted — if a gate throws, nothing is committed and the RPC failure
			// is honest. `reseal` returns passhash + ciphertext but not the raw secret.
			let secret: MasterSecretBytes | null = null
			let entropy: Uint8Array<ArrayBuffer> | null = null
			let dek: ImportedKeysDek | null = null
			let oldPasshash: Passhash | null = null
			try {
				// Inside the try so a throw in the unseal still hits the finally that wipes
				// resealed.passhash (memory hygiene — P3 rider Low).
				;({ secret, entropy } = await this.unsealResealedVerifiedHoldingLock(id, resealed))
				const rekeyed = await this.rekeyedDekForPasswordChangeHoldingLock(id, profile, secret, oldPassword, resealed.passhash)
				dek = rekeyed.dek
				oldPasshash = rekeyed.oldPasshash

				// Dual reseal is atomic with this same pre-persist-verified commit (audit H2):
				// guard, master, entropy, AND the DEK re-encrypt together — nothing may remain
				// decryptable under the retired password — and the envelope MAC v3 re-keys over
				// the new ciphertexts (still bound to this row's id + fingerprint) so both verify
				// sites keep holding.
				profile.guard = resealed.encrypted.guard
				profile.secret = resealed.encrypted.secret
				profile.entropy = resealed.encrypted.entropy
				profile.dekSealed = rekeyed.newDekSealed
				profile.envelopeMac = await computeEnvelopeMacV3(
					id,
					secret,
					dek,
					this.macEnvelopeV3(resealed.encrypted, rekeyed.newDekSealed, profile.walletFingerprint),
				)
				await this.repo.set(id, profile)
				this.emit("onProfileUpdated", this.getProfileInfo(profile))

				await this.reopenAfterPasswordChangeHoldingLock(id, profile, secret, resealed.passhash, dek)
			} finally {
				zeroize(secret)
				zeroize(entropy)
				zeroize(dek)
				zeroize(oldPasshash)
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

		const { profile: snapshot, capturedEpoch } = await this.captureRowFence(id)

		try {
			if (snapshot.type === "password") {
				if (!password) {
					throw new Error("Password is required")
				}
				const unsealed = await this.secretBox.unseal(password, this.sealedTriple(snapshot))
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
			// Revalidate AFTER the async credential op: a delete that completed
			// during the (unlocked) derivation/prompt — even one followed by
			// a same-id restore — must not report success for the stale generation.
			// A LEGIT concurrent password change does NOT bump the epoch, so confirm
			// still succeeds.
			await this.runExclusive(async () => {
				if (await this.profileFenceBroken(id, capturedEpoch)) {
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
	private async openSessionVerified(
		profile: Profile,
		secret: MasterSecretBytes,
		passhash?: Passhash,
		dek?: ImportedKeysDek,
	): Promise<void> {
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
		await this.sessionManager.open(profile, secret, passhash, dek)
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

	/** F-B24 torn-import guard, run UNDER the facade lock: refuse unless (a) the row's
	 *  `pxeGeneration` still matches — a same-id re-import that landed between the
	 *  sweep's observation and this call must never be deleted by a decision made about
	 *  its predecessor — and (b) the EXACT observed restore-pending marker tuple is
	 *  still present. (b) is the load-bearing half against a finalize race:
	 *  `finalizeRestore` clears the marker at entry UNDER THIS SAME LOCK and leaves the
	 *  generation unchanged, so a generation check alone would let the sweep delete a
	 *  just-finalized, in-use profile. Marker gone or different →
	 *  the import finalized or restarted → refuse. */
	private async assertTornGuardUnchangedHoldingLock(
		id: string,
		profile: Profile,
		tornGuard: { pxeGeneration: string; markerAt: number },
	): Promise<void> {
		if (profile.pxeGeneration !== tornGuard.pxeGeneration) {
			throw new Error("profile generation changed since the deletion was decided")
		}
		const marker = await this.restorePending.get(id)
		if (marker.kind !== "valid" || marker.marker.pxeGeneration !== tornGuard.pxeGeneration || marker.marker.at !== tornGuard.markerAt) {
			throw new Error("restore-pending marker changed since the deletion was decided — import finalized or restarted")
		}
	}

	/** B-12: `beginDeletion` reserved the id synchronously; if the tombstone write
	 *  REJECTS, the delete didn't durably happen — but the rejection is
	 *  commit-ambiguous (the key may still have landed). Read back the RAW tombstone
	 *  key and release the reservation ONLY when its absence is confirmed (a
	 *  cleanly-failed write), so the live profile isn't wedged. If the key exists / is
	 *  corrupt / the read-back throws, RETAIN fail-closed (a durable tombstone means
	 *  `resumePendingDeletions` finishes the delete; releasing would let an unlock race
	 *  the resume). The epoch bump is kept regardless — rolling it back would let a
	 *  later real deletion re-mint the same epoch and un-fence a stale writer. Caller
	 *  MUST hold the facade lock. */
	private async writeTombstoneHoldingLock(
		id: string,
		snapshot: { addresses: string[]; tokenIds: number[]; networkIds: string[]; pxeGeneration: string },
		epoch: number,
	): Promise<void> {
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
	}

	/** Commit a freshly-built row and announce it — the shared tail of every
	 *  create/import path. `openSessionVerified` (where a path opens at all) stays at
	 *  the call site: restore's late-activation paths commit without opening. Caller
	 *  MUST hold the facade lock. */
	private async persistNewProfileHoldingLock(profile: Profile): Promise<void> {
		await this.repo.set(profile.id, profile)
		this.emit("onProfileAdded", this.getProfileInfo(profile))
	}

	/** Marker BEFORE row (fail-closed): a crash between the two writes leaves an orphan
	 *  marker with no row — lazily purged — never a row without its restore-in-progress
	 *  marker. A rejected row write compensates by removing the marker it just wrote so
	 *  it cannot brand a future same-id profile. No emit here — the restore branches
	 *  announce AFTER this bracket. Caller MUST hold the facade lock. */
	private async writeMarkerThenRowHoldingLock(id: string, newProfile: Profile): Promise<void> {
		await this.restorePending.write({ profileId: id, pxeGeneration: newProfile.pxeGeneration, at: Date.now() })
		try {
			await this.repo.set(id, newProfile)
		} catch (rowErr) {
			await this.restorePending.delete(id).catch(() => {})
			throw rowErr
		}
	}

	/** Drop + zeroize the stashed passkey restore secret (the map owns its buffers). */
	private dropPendingRestoreSecret(id: string): void {
		const pending = this.pendingRestoreSecrets.get(id)
		if (pending) {
			this.pendingRestoreSecrets.delete(id)
			zeroize(pending.secret)
			zeroize(pending.dek)
		}
	}

	/** Drop + zeroize the DEK rewrap context (the map owns its buffers). */
	private dropPendingDekRewrap(id: string): void {
		const rewrap = this.pendingDekRewraps.get(id)
		if (rewrap) {
			this.pendingDekRewraps.delete(id)
			zeroize(rewrap.sourceDek)
			zeroize(rewrap.destinationDek)
		}
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
	 * `tornGuard` (F-B24 torn-import sweep only): phase 1 refuses unless the observed
	 * generation + marker tuple are unchanged — see `assertTornGuardUnchangedHoldingLock`.
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
				await this.assertTornGuardUnchangedHoldingLock(id, profile, tornGuard)
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
			await this.writeTombstoneHoldingLock(id, snapshot, epoch)
			await this.repo.delete(id)
			// Close the session BEFORE the emit (a subscriber reacting to the emit
			// must not observe a still-open session for a deleted profile).
			if (this.sessionManager.isActive(id)) {
				await this.sessionManager.close()
			}
			this.dropPendingRestoreSecret(id)
			// Deleting a profile mid-restore must also drop + zeroize its rewrap context (its
			// buffers aren't aged yet, so the TTL sweep wouldn't reap them) — P4 rider Medium.
			this.dropPendingDekRewrap(id)
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
		await this.resumeTombstonedDeletions(delegate)
		// F-B24 torn-import sweep — only with an explicit boot cutoff (see doc).
		if (bootCutoff === undefined) return
		await this.sweepTornImports(bootCutoff)
	}

	/** Finish every valid tombstone's deletion through the same three-phase shape as the
	 *  live `deleteProfile`; per-tombstone failures log and continue. */
	private async resumeTombstonedDeletions(delegate: ProfileDeletionDelegate): Promise<void> {
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
	}

	/** The F-B24 torn-import sweep body — see `resumePendingDeletions`' doc for the
	 *  age-floor/abandonment rationale; per-marker failures log and continue. */
	private async sweepTornImports(bootCutoff: number): Promise<void> {
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
				// against a live same-id restore (an unlocked deleteIfSame is still
				// TOCTOU between its get and remove).
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

	public async importMnemonic(name: string, mnemonic: string[], password: string, allowDuplicate = false): Promise<ProfileInfo> {
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
		return await this.importPasswordProfile(name, secret, entropy as Uint8Array<ArrayBuffer>, passhash, allowDuplicate)
	}

	public async exportPlain(id: string, password?: string, credentialData?: PasskeyCredentialData): Promise<string> {
		await this.ensureInitialized()
		const { profile, capturedEpoch } = await this.captureRowFence(id)

		if (profile.type === "passkey") {
			return this.exportPasskeyCredential(id, profile, capturedEpoch, credentialData)
		}

		if (!password) {
			throw new Error("Password is required")
		}
		// Single unseal — skip the redundant `confirmProfileOperation`
		// PBKDF2. Still emulate that method's outer catch: any throw
		// (including crypto-level failures) is flattened to a plain
		// `Error(message)` so callers see a stable error shape.
		try {
			const unsealed = await this.secretBox.unseal(password, this.sealedTriple(profile))
			try {
				if (!unsealed) {
					throw new InvalidPasswordError()
				}
				// Revalidate AFTER the slow unseal: a delete that completed DURING
				// derivation — even fully (row gone, reservation released) — must
				// not still hand back the now-erased profile's master secret.
				if (await this.profileFenceBroken(id, capturedEpoch)) {
					throw new Error("Invalid profile id")
				}
				// Pairing check at every entropy-decryption reveal site: this master feeds
				// `exportAccount` (which derives real signing keys), so a corrupted/transplanted
				// secret slot must fail loudly here too, not silently downstream.
				await this.assertEntropyMasterPair(unsealed.secret, unsealed.entropy)
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
	 * The passkey arm of `exportPlain` — the credentialId IS the exported material.
	 * Path A only: the caller (popup) ran the in-page WebAuthn ceremony via the
	 * `PasskeyCeremonyDialog` modal and hands us the credential data; the previous
	 * Path B (SW opens a window via confirmProfileOperation) is gone for this entry
	 * point. Materialize the credential SW-side and verify it actually belongs to
	 * this profile — without the credentialId binding check, a popup bug could
	 * supply data for a different key and we'd happily export the wrong one.
	 */
	private async exportPasskeyCredential(
		id: string,
		profile: Extract<Profile, { type: "passkey" }>,
		capturedEpoch: number,
		credentialData?: PasskeyCredentialData,
	): Promise<string> {
		if (!credentialData) {
			throw new Error("credentialData is required for passkey profile")
		}
		const recovery = await this.passkeyCoordinator.recoverFromCredentialData(credentialData)
		try {
			if (recovery.credentialId !== profile.credentialId) {
				throw new Error("Invalid profile id")
			}
			// Same fingerprint binding the unlock path enforces: a stored row edited after
			// creation must not produce a backup that looks complete.
			if (profile.walletFingerprint !== (await computeWalletFingerprint(recovery.secret))) {
				throw new Error("Profile integrity check failed — this profile cannot produce a trustworthy backup")
			}
			// A passkey full backup carries `dekSealed` VERBATIM (the ceremony's wrap key opens
			// it at restore), so nothing downstream ever proves it opens. Prove it here, where
			// the wrap key is already in hand: otherwise a corrupt slot yields a backup that
			// reports success and only fails at restore, when the source may be long gone.
			let probe: ImportedKeysDek | null = null
			try {
				probe = await unsealDekUnderWrapKey(recovery.dekWrapKey, profile.dekSealed)
			} catch {
				probe = null
			} finally {
				zeroize(probe)
			}
			if (!probe) {
				throw new Error("Imported-keys key unrecoverable — this profile cannot produce a complete backup")
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
		// still return the credentialId.
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

	/**
	 * Atomic paired export for the Full-Backup builder: master + entropy from ONE unseal, so
	 * the two backup fields can never come from different row states (final-codex M1). Password
	 * profiles only — passkey backups carry the credentialId via `exportPlain` and re-derive
	 * the master from the passkey PRF at restore.
	 */
	public async exportBackupMaterial(
		id: string,
		password: string,
	): Promise<{ masterKey: string; entropy: string; importedKeysDek: string }> {
		await this.ensureInitialized()
		const { profile, capturedEpoch } = await this.captureRowFence(id)
		if (profile.type === "passkey") {
			throw new Error("Operation not supported for passkey profile")
		}
		const unsealed = await this.secretBox.unseal(password, this.sealedTriple(profile))
		let dek: ImportedKeysDek | null = null
		let passhash: Passhash | null = null
		try {
			if (!unsealed) {
				throw new InvalidPasswordError()
			}
			if (await this.profileFenceBroken(id, capturedEpoch)) {
				throw new Error("Invalid profile id")
			}
			// Pairing check before EXPORT (P3 rider High): a backup built from a tampered/
			// transplanted row would otherwise report success with an unrestorable pair.
			await this.assertEntropyMasterPair(unsealed.secret, unsealed.entropy)
			// The DEK travels plaintext beside the already-plaintext master (same trust envelope;
			// any backup already carries jointly-sufficient material). An unrecoverable slot fails
			// the export LOUDLY — the epoch-4 shape requires the field, and a password change
			// self-heals the slot for a retry.
			//
			// KNOWN LIMITATION, accepted: this is the LONG-LIVED profile DEK, not a per-backup
			// transfer key, and a password change rewraps rather than rotates it. So a backup
			// grants FORWARD reach — whoever holds it can decrypt imported-key rows created after
			// the export, given access to those rows' ciphertext later. Scope it honestly:
			//   - It needs later ciphertext access, but that is NOT a separate compromise for the
			//     storage-reader this design targets — an ongoing reader already has it.
			//   - It is narrower than what the same blob already gives up: the plaintext master =
			//     every derived account plus every imported key existing at export time.
			//   - It does NOT reach the sibling this DEK exists to stop — a profile created by
			//     re-importing the recovery PHRASE never sees this key. A clone created by
			//     RESTORING this backup does, because the blob hands it over by construction.
			//   - Passkey blobs resist a blob-only thief (the DEK travels sealed under the PRF wrap
			//     key), but not an authorized clone, which unseals and can retain it.
			// Closing it means a per-backup transfer key: rewrap every row at export under a fresh
			// key and carry THAT, which the restore side would consume exactly where it consumes
			// the source DEK today. That needs export-time ProfileService↔AccountService
			// coordination and crash consistency — a follow-up arc, not a patch here.
			passhash = await EncryptionKey.getPasshash(password)
			dek = await this.unsealDekWithPasshash(passhash, profile.dekSealed)
			// DELIBERATELY exports even when the envelope MAC no longer covers the row, unlike
			// every path that puts the DEK to work. Exporting cannot leak: a planted DEK is the
			// attacker's own key, and a genuine one makes the backup correct — while refusing
			// would strand a MAC-corrupted profile with no non-destructive repair at all (backup
			// + restore is precisely the repair `changeProfilePassword` points at). If the DEK
			// does turn out to be foreign, its rows simply fail into the restore-side orphan
			// taxonomy, which is a handled, visible outcome rather than a silent one.
			if (!dek) {
				throw new Error("Imported-keys key unrecoverable — change the profile password to repair, then retry the backup")
			}
			return {
				masterKey: Buffer.from(unsealed.secret).toString("base64"),
				entropy: Buffer.from(unsealed.entropy).toString("base64"),
				importedKeysDek: Buffer.from(dek).toString("base64"),
			}
		} finally {
			if (unsealed) {
				zeroize(unsealed.secret)
				zeroize(unsealed.entropy)
			}
			zeroize(dek)
			zeroize(passhash)
		}
	}

	/** The SEALED imported-keys DEK blob, verbatim — ciphertext, safe to hand out. Passkey full
	 *  backups carry this as `imported-keys-dek-sealed`; the restore ceremony's wrap key opens it. */
	public async getProfileDekSealed(id: string): Promise<string> {
		await this.ensureInitialized()
		return this.runExclusive(async () => {
			const profile = await this.repo.get(id)
			if (!profile || this.deletionState.isReserved(id)) {
				throw new Error("Invalid profile id")
			}
			return profile.dekSealed
		})
	}

	/** Fresh-auth DEK unseal for the account-export path (mirrors `exportPlain`'s posture:
	 *  password-gated, session-independent, epoch-revalidated). Password profiles only — the
	 *  passkey account-export limitation matches `exportAccount`'s existing contract. */
	public async exportImportedKeysDek(id: string, password: string): Promise<ImportedKeysDek> {
		await this.ensureInitialized()
		const { profile, capturedEpoch } = await this.captureRowFence(id)
		if (profile.type === "passkey") {
			throw new Error("Operation not supported for passkey profile")
		}
		// Authenticate via the guard round-trip (full unseal), THEN open the DEK slot.
		const unsealed = await this.secretBox.unseal(password, this.sealedTriple(profile))
		let passhash: Passhash | null = null
		try {
			if (!unsealed) {
				throw new InvalidPasswordError()
			}
			if (await this.profileFenceBroken(id, capturedEpoch)) {
				throw new Error("Invalid profile id")
			}
			passhash = await EncryptionKey.getPasshash(password)
			const dek = await this.unsealDekWithPasshash(passhash, profile.dekSealed)
			// No MAC gate here either, for `exportBackupMaterial`'s reason: a foreign DEK cannot
			// unseal this profile's rows, so the account export fails loudly at the unseal instead
			// of emitting anything — and gating would deny the single-account escape hatch to a
			// profile whose DEK is merely MAC-corrupted.
			if (!dek) {
				throw new Error("Imported-keys key unrecoverable")
			}
			return dek
		} finally {
			if (unsealed) {
				zeroize(unsealed.secret)
				zeroize(unsealed.entropy)
			}
			zeroize(passhash)
		}
	}

	/** The session's imported-keys DEK (a COPY — caller zeroizes), or `undefined` for a degraded
	 *  session. Facade-mediated so the deletion guards apply; AccountService never touches the
	 *  SessionManager directly. */
	public async getProfileDek(id: string): Promise<ImportedKeysDek | undefined> {
		await this.ensureInitialized()
		return this.runExclusive(() => {
			if (this.deletionState.isReserved(id)) throw new Error("Invalid profile id")
			return this.sessionManager.getDek(id)
		})
	}

	public async exportMnemonic(id: string, password: string): Promise<string[]> {
		await this.ensureInitialized()
		const { profile, capturedEpoch } = await this.captureRowFence(id)
		if (profile.type === "passkey") {
			throw new Error("Operation not supported for passkey profile")
		}
		const unsealed = await this.secretBox.unseal(password, this.sealedTriple(profile))
		try {
			if (!unsealed) {
				// Legacy identity-stable message, pinned by the integration suite — kept in
				// lockstep with changeProfilePassword's, whose exact string the
				// change-password UI matches for its wrong-password branch.
				throw new Error("Invalid profile old password")
			}
			// The recovery words come from the STORED ENTROPY (the master derives one-way from
			// them and cannot be reversed). Pairing check before the words are ever revealed:
			// words that no longer derive the stored master would point at a DIFFERENT wallet —
			// the split-brain recovery attack — so fail closed instead of handing them out.
			const mnemonic = await getMnemonic(unsealed.entropy)
			await this.assertEntropyMasterPair(unsealed.secret, unsealed.entropy)
			// Revalidate under the lock AFTER the async derivations — a delete interleaving
			// during them must not let the erased profile's words escape.
			await this.runExclusive(async () => {
				if (await this.profileFenceBroken(id, capturedEpoch)) {
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

	/** The envelope MAC v3 preimage for a sealed profile record: the row's OWN storage key
	 *  first (kills whole-envelope swaps between same-password profiles — B's authentic
	 *  envelope pasted under A's id fails verification even though every byte, including the
	 *  original tag, is genuine), then the four sealed slots, then the plaintext fingerprint
	 *  (blinding the duplicate guard becomes a detectable tamper). */
	private macEnvelopeV3(
		p: { guard: string; secret: string; entropy: string },
		dekSealed: string,
		walletFingerprint: string,
	): MacEnvelopeV3 {
		return { guard: p.guard, secret: p.secret, entropy: p.entropy, dek: dekSealed, walletFingerprint }
	}

	/**
	 * Does the stored MAC still cover this exact record? EVERY site that is about to trust the DEK
	 * must ask — not just the unlock path. The DEK slot's AAD is a purpose constant, not
	 * profile-bound, so a same-password sibling's `dekSealed` transplants cleanly into another
	 * profile's row and unseals there; the whole-envelope MAC is the only check that catches it.
	 * A site that skips this either blesses the planted slot (laundering the tamper into a
	 * freshly-valid MAC) or exports material sealed to a key the profile does not own.
	 */
	private async envelopeMacValid(
		requestedId: string,
		p: {
			guard: string
			secret: string
			entropy: string
			dekSealed: string
			walletFingerprint: string
			envelopeMac: string
		},
		secret: MasterSecretBytes,
		dek: ImportedKeysDek,
	): Promise<boolean> {
		return verifyEnvelopeMacV3(requestedId, secret, dek, this.macEnvelopeV3(p, p.dekSealed, p.walletFingerprint), p.envelopeMac)
	}

	/** Seal the imported-keys DEK under the password credential (EncryptionKey — the audited
	 *  PBKDF2 + AES-GCM path — with the shared purpose AAD). */
	private async sealDekWithPasshash(passhash: Passhash, dek: ImportedKeysDek): Promise<string> {
		const key = await EncryptionKey.fromPasshash(passhash)
		return Buffer.from(await key.encrypt(dek, IMPORTED_DEK_AAD)).toString("base64")
	}

	/** Unseal the DEK slot under the password credential. `null` — not a throw — on any
	 *  wrong-key / transplant / corruption / length failure: the caller applies the degradation
	 *  state machine (derived-only session), never a profile block. */
	private async unsealDekWithPasshash(passhash: Passhash, dekSealed: string): Promise<ImportedKeysDek | null> {
		try {
			const key = await EncryptionKey.fromPasshash(passhash)
			const pt = await key.decrypt(Buffer.from(dekSealed, "base64") as Uint8Array<ArrayBuffer>, IMPORTED_DEK_AAD)
			if (pt.length !== IMPORTED_KEYS_DEK_LEN) {
				zeroize(pt)
				return null
			}
			return asImportedKeysDek(pt)
		} catch {
			return null
		}
	}

	/**
	 * The duplicate-phrase guard: compare the candidate master's fingerprint against every live
	 * row. Soft by owner policy — a match throws the typed `DuplicateWalletError` (profile NAME
	 * only, never key material) unless the caller carries the confirmed `allowDuplicate`
	 * override. Returns the fingerprint for the row being built. Callers run this UNDER the same
	 * lock as the row commit (check→write atomicity — final-audit condition).
	 */
	private async assertNotDuplicateWallet(master: MasterSecretBytes, allowDuplicate: boolean): Promise<string> {
		const fingerprint = await computeWalletFingerprint(master)
		if (!allowDuplicate) {
			const clash = (await this.repo.getAll()).find(
				(p) => !this.deletionState.isReserved(p.id) && p.walletFingerprint === fingerprint,
			)
			if (clash) {
				throw new DuplicateWalletError(undefined, { existingProfileName: clash.name })
			}
		}
		return fingerprint
	}

	/**
	 * Same-credential passkey duplicate is a HARD reject (final-audit fact correction: the
	 * userHandle check alone is not structural — WebAuthn may omit the userHandle, and restore
	 * mints a fresh id then). Same credential ⇒ same PRF ⇒ same master: a pure footgun with no
	 * legitimate use, unlike the warned same-phrase case.
	 */
	private async assertNotDuplicateCredential(credentialId: string): Promise<void> {
		const clash = (await this.repo.getAll()).some(
			(p) => !this.deletionState.isReserved(p.id) && p.type === "passkey" && p.credentialId === credentialId,
		)
		if (clash) {
			throw new Error("Passkey profile already exists")
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
		allowDuplicate = false,
	): Promise<Profile> {
		const dek = generateImportedKeysDek()
		try {
			return await this.runExclusive(async () => {
				// Duplicate-phrase guard under the SAME lock as the row commit (check→write
				// atomicity): a concurrent same-phrase import gets exactly one dup verdict.
				const walletFingerprint = await this.assertNotDuplicateWallet(secret, allowDuplicate)
				const id = await this.nextUnreservedId()
				const encrypted = await this.secretBox.sealWithPasshash(passhash, secret, entropy)
				const dekSealed = await this.sealDekWithPasshash(passhash, dek)
				const envelopeMac = await computeEnvelopeMacV3(id, secret, dek, this.macEnvelopeV3(encrypted, dekSealed, walletFingerprint))
				const profile: Profile = {
					id,
					name,
					type: "password",
					pxeGeneration: mintPxeGeneration(),
					dekSealed,
					walletFingerprint,
					guard: encrypted.guard,
					secret: encrypted.secret,
					entropy: encrypted.entropy,
					envelopeMac,
				}
				await this.persistNewProfileHoldingLock(profile)
				await this.openSessionVerified(profile, secret, passhash, dek)
				return profile
			})
		} finally {
			zeroize(secret)
			zeroize(entropy)
			zeroize(dek)
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
		dekWrapKey: CryptoKey,
		userHandle?: string,
		allowDuplicate = false,
	): Promise<Profile> {
		const dek = generateImportedKeysDek()
		try {
			const dekSealed = await sealDekUnderWrapKey(dekWrapKey, dek)
			return await this.runExclusive(async () => {
				if (userHandle && ((await this.repo.contains(userHandle)) || this.deletionState.isReserved(userHandle))) {
					throw new Error("Passkey profile already exists")
				}
				// Same-credential duplicate is a HARD reject regardless of userHandle presence
				// (the userHandle check above is not structural — WebAuthn may omit it).
				await this.assertNotDuplicateCredential(credentialId)
				// Same-phrase-class (same-master) duplicate is the WARNED path.
				const walletFingerprint = await this.assertNotDuplicateWallet(secret, allowDuplicate)

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
					dekSealed,
					walletFingerprint,
					credentialId,
				}
				await this.persistNewProfileHoldingLock(profile)
				await this.openSessionVerified(profile, secret, undefined, dek)
				return profile
			})
		} finally {
			zeroize(secret)
			zeroize(dek)
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
		allowDuplicate = false,
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
				return this.restorePasswordProfile(profile, secret, name, password, allowDuplicate)
			}
			case "passkey":
				return this.restorePasskeyProfile(profile, secret, name, credentialData, allowDuplicate)

			default:
				throw new Error("Unknown profile type")
		}
	}

	/** The password branch of `restore`: decode + validate the backup material
	 *  UNLOCKED, then commit under the lock. The post-release `finally` here owns
	 *  every buffer wipe — the locked body reports its allocations back through
	 *  `scratch` so a throw at ANY point still reaches this one cleanup site. */
	private async restorePasswordProfile(
		profile: ProfileInfo,
		secret: Extract<RestoreSecret, { type: "password" }>,
		name: string,
		password: string,
		allowDuplicate: boolean,
	): Promise<Restored<ProfileInfo>> {
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

		// The SOURCE profile's DEK — required by the epoch-4 shape; used ONLY to seed the
		// rewrap context (a restored clone must never share the source's DEK).
		const sourceDek = Buffer.from(secret.importedKeysDek ?? "", "base64") as Uint8Array<ArrayBuffer>
		if (sourceDek.byteLength !== 32) {
			zeroize(plainSecret)
			zeroize(plainEntropy)
			zeroize(sourceDek)
			throw new Error("Invalid imported-keys dek length")
		}

		// `scratch` is filled by the locked body — if seal throws mid-way, this finally
		// still zeros the already-allocated buffers.
		const scratch: PasswordRestoreScratch = { storedContext: false }
		try {
			return await this.runExclusive(() =>
				this.commitRestoredPasswordProfileHoldingLock(
					profile,
					name,
					password,
					plainSecret,
					plainEntropy,
					sourceDek,
					allowDuplicate,
					scratch,
				),
			)
		} finally {
			zeroize(plainSecret)
			zeroize(plainEntropy)
			if (scratch.passhash) zeroize(scratch.passhash)
			if (!scratch.storedContext) {
				zeroize(sourceDek)
				zeroize(scratch.destinationDek)
			}
		}
	}

	/** The locked commit of a password restore. Reports allocations back through
	 *  `scratch` — the CALLER's post-release finally does every wipe. Caller MUST hold
	 *  the facade lock. */
	private async commitRestoredPasswordProfileHoldingLock(
		profile: ProfileInfo,
		name: string,
		password: string,
		plainSecret: Uint8Array,
		plainEntropy: Uint8Array<ArrayBuffer>,
		sourceDek: Uint8Array<ArrayBuffer>,
		allowDuplicate: boolean,
		scratch: PasswordRestoreScratch,
	): Promise<Restored<ProfileInfo>> {
		try {
			// Duplicate-phrase guard under the SAME lock as the commit (check→write
			// atomicity). The catch below RETHROWS the typed error so the UI's
			// confirm-retry can fire (restoreError flattening would dead-end it).
			const walletFingerprint = await this.assertNotDuplicateWallet(
				asMasterSecretBytes(plainSecret as Uint8Array<ArrayBuffer>),
				allowDuplicate,
			)
			const sealed = await this.secretBox.seal(password, asMasterSecretBytes(plainSecret as Uint8Array<ArrayBuffer>), plainEntropy)
			scratch.passhash = sealed.passhash
			// CLONE DIVERGENCE: a FRESH destination DEK for the
			// new row — restoring A's backup beside a still-live A must not let the
			// clone's credential open keys A imports later. The backup's own key rows
			// stay usable via the source→destination rewrap context below.
			const destinationDek = generateImportedKeysDek()
			scratch.destinationDek = destinationDek
			const dekSealed = await this.sealDekWithPasshash(sealed.passhash, destinationDek)

			let id = profile.id
			while ((await this.repo.contains(id)) || this.deletionState.isReserved(id)) {
				id = await this.repo.generateUniqueId()
			}
			// MAC v3 binds the row's OWN id — computed only after the id loop above
			// settles it.
			const envelopeMac = await computeEnvelopeMacV3(
				id,
				asMasterSecretBytes(plainSecret as Uint8Array<ArrayBuffer>),
				destinationDek,
				this.macEnvelopeV3(sealed.encrypted, dekSealed, walletFingerprint),
			)

			const newProfile: Profile = {
				id,
				name,
				type: "password",
				// Fresh generation even on a same-id re-import: the D4 fence
				// distinguishes this incarnation from the deleted one.
				pxeGeneration: mintPxeGeneration(),
				dekSealed,
				walletFingerprint,
				guard: sealed.encrypted.guard,
				secret: sealed.encrypted.secret,
				entropy: sealed.encrypted.entropy,
				envelopeMac,
			}

			await this.writeMarkerThenRowHoldingLock(id, newProfile)

			this.emit("onProfileAdded", this.getProfileInfo(newProfile))

			// Stash the rewrap context — the map takes OWNERSHIP of both buffers
			// (restoreImportedKeys consumes; finalizeRestore/TTL sweep zeroize
			// leftovers).
			this.sweepStalePendingRestore(Date.now(), id)
			this.pendingDekRewraps.set(id, {
				sourceDek: asImportedKeysDek(sourceDek),
				destinationDek,
				capturedAt: Date.now(),
			})
			scratch.storedContext = true

			// Late activation: do NOT open the session here. The popup
			// will call `finalizeRestore(id, password)` after restoring
			// all backup data (networks, accounts, etc.) to avoid
			// `app.vue:onActiveProfileChanged` racing the import with
			// auto-seeded defaults.
			return this.getProfileInfo(newProfile)
		} catch (err) {
			// Build restoreError INSIDE the locked callback so it runs before the
			// lock releases (withLock's finally) — toRestoreError may invoke a
			// custom err.toString().
			// The duplicate-phrase verdict must REACH the UI as its typed self
			// (confirm-retry), never flattened into a dead-end restoreError.
			if (err instanceof DuplicateWalletError) throw err
			return {
				...profile,
				restoreError: toRestoreError(err),
			}
		}
	}

	/** The passkey branch of `restore`: ceremony + credential binding run UNLOCKED —
	 *  their early throws must not reach a lock release — and only the storage tail is
	 *  locked. The catch converting to `restoreError` therefore sits OUTSIDE the lock,
	 *  covering the unlocked prologue too (the password branch's sits inside, for
	 *  toRestoreError-before-release). */
	private async restorePasskeyProfile(
		profile: ProfileInfo,
		secret: Extract<RestoreSecret, { type: "passkey" }>,
		name: string,
		credentialData: PasskeyCredentialData | undefined,
		allowDuplicate: boolean,
	): Promise<Restored<ProfileInfo>> {
		let recoverySecret: Uint8Array<ArrayBuffer> | undefined
		let sourceDek: ImportedKeysDek | undefined
		let destinationDek: ImportedKeysDek | undefined
		const scratch: PasskeyRestoreScratch = { storedPending: false, storedContext: false }
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
			// The SOURCE DEK travels as the sealed blob (passkey backups carry no plaintext
			// secrets); the ceremony's wrap key — same credential ⇒ same key — opens it here,
			// feeding the rewrap context only.
			sourceDek = await unsealDekUnderWrapKey(recovery.dekWrapKey, secret.dekSealed ?? "")
			// CLONE DIVERGENCE: fresh destination DEK for the restored row (see the
			// password branch). Local consts so the narrowed types survive into the
			// locked closure below.
			destinationDek = generateImportedKeysDek()
			const sourceDekLocal = sourceDek
			const destDekLocal = destinationDek
			const dekSealed = await sealDekUnderWrapKey(recovery.dekWrapKey, destinationDek)
			// The restored profile id is the (hex) userHandle when the credential
			// carried one, else a freshly generated id — a plain profile-id string
			// either way, so widen off the `HexUserHandle` brand here.
			const initialId: string | undefined = recovery.userHandle

			return await this.runExclusive(() =>
				this.commitRestoredPasskeyProfileHoldingLock(
					name,
					recovery,
					sourceDekLocal,
					destDekLocal,
					dekSealed,
					initialId,
					allowDuplicate,
					scratch,
				),
			)
		} catch (err) {
			// The duplicate verdict must reach the UI typed (confirm-retry with the SAME
			// credentialData — no second ceremony), never a dead-end restoreError.
			if (err instanceof DuplicateWalletError) throw err
			return {
				...profile,
				restoreError: toRestoreError(err),
			}
		} finally {
			// Zero whatever never made it into a map (early throws). Stashed buffers are
			// owned by their maps (finalize / restoreImportedKeys / TTL sweep).
			if (!scratch.storedPending) {
				zeroize(recoverySecret)
				zeroize(scratch.stashDek)
			}
			if (!scratch.storedContext) {
				zeroize(sourceDek)
				zeroize(destinationDek)
			}
		}
	}

	/** The locked commit of a passkey restore. Reports the stash back through `scratch`
	 *  — the CALLER's post-release finally does every wipe. Caller MUST hold the facade
	 *  lock. */
	private async commitRestoredPasskeyProfileHoldingLock(
		name: string,
		recovery: PasskeyRecovery,
		sourceDek: ImportedKeysDek,
		destinationDek: ImportedKeysDek,
		dekSealed: string,
		initialId: string | undefined,
		allowDuplicate: boolean,
		scratch: PasskeyRestoreScratch,
	): Promise<ProfileInfo> {
		let id = initialId
		if (id && ((await this.repo.contains(id)) || this.deletionState.isReserved(id))) {
			throw new Error("Passkey profile already exists")
		}
		// Same-credential duplicate is a HARD reject even when the userHandle is
		// absent (restore would otherwise mint a fresh id for the same credential).
		await this.assertNotDuplicateCredential(recovery.credentialId)
		// Same-master duplicate (theoretical cross-type case) is the WARNED path.
		const walletFingerprint = await this.assertNotDuplicateWallet(recovery.secret, allowDuplicate)

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
			dekSealed,
			walletFingerprint,
			credentialId: recovery.credentialId,
		}
		// Same marker-before-row bracket as the password branch (a torn passkey
		// import must not escape detection).
		await this.writeMarkerThenRowHoldingLock(id, newProfile)

		this.emit("onProfileAdded", this.getProfileInfo(newProfile))

		// Late activation: stash the recovery secret + the DESTINATION DEK so
		// finalize can open a non-degraded session without re-prompting WebAuthn
		// (a master-only stash would leave the first post-restore session dek-less,
		// quarantining every restored imported account). The maps take ownership —
		// DO NOT zero the stashed buffers in finally.
		this.sweepStalePendingRestore(Date.now(), id)
		const stashDek = asImportedKeysDek(new Uint8Array(destinationDek))
		scratch.stashDek = stashDek
		this.pendingRestoreSecrets.set(id, {
			secret: recovery.secret,
			dek: stashDek,
			capturedAt: Date.now(),
			expected: {
				type: newProfile.type,
				credentialId: newProfile.credentialId,
				dekSealed: newProfile.dekSealed,
				pxeGeneration: newProfile.pxeGeneration,
				walletFingerprint: newProfile.walletFingerprint,
			},
		})
		scratch.storedPending = true
		this.pendingDekRewraps.set(id, { sourceDek, destinationDek, capturedAt: Date.now() })
		scratch.storedContext = true

		return this.getProfileInfo(newProfile)
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

			// Zeroize any LEFTOVER rewrap context for this id — the empty-slice case
			// (`restoreImportedKeys` never ran, so nothing consumed it) and any abandoned
			// re-restore of the same id. Consumed contexts are already gone.
			this.dropPendingDekRewrap(id)

			// If the session is already active for this profile, treat as
			// no-op. Defensive against double-finalize.
			if (this.sessionManager.isActive(id)) {
				return this.getProfileInfo(profile)
			}

			if (profile.type === "password") {
				return this.finalizePasswordRestoreHoldingLock(id, profile, password)
			}
			// This dispatch falls through to the passkey branch for ANY non-password
			// type — an edited `type` field must not select it; the branch re-checks.
			return this.finalizePasskeyRestoreHoldingLock(id, profile)
		})
	}

	/** Password-side finalize: re-derive from the supplied password (PBKDF2 paid again —
	 *  acceptable for a one-time import flow), mirroring `unlockProfile` phase 3, with
	 *  the full degradation state machine at this open too (P4 rider High: the row was
	 *  minted by `restore()`, so a DEK/MAC failure here means a tamper landed BETWEEN
	 *  restore and finalize — skipping the MAC check would hand a storage attacker a
	 *  bearer-backed non-degraded session). Caller MUST hold the facade lock. */
	private async finalizePasswordRestoreHoldingLock(
		id: string,
		profile: Extract<Profile, { type: "password" }>,
		password?: string,
	): Promise<ProfileInfo> {
		if (!password) {
			throw new Error("Password is required for password profile")
		}
		const unsealed = await this.secretBox.unseal(password, this.sealedTriple(profile))
		if (!unsealed) {
			throw new InvalidPasswordError()
		}
		let passhash: Passhash | undefined
		let dek: ImportedKeysDek | null = null
		try {
			// Pairing check before the session opens (P3 rider): a tamper between restore()
			// and finalize must not open a session whose recovery phrase is a lie. Inside
			// the try so a pairing throw still wipes the unsealed buffers (rider Low).
			await this.assertEntropyMasterPair(unsealed.secret, unsealed.entropy)
			passhash = await EncryptionKey.getPasshash(password)
			dek = await this.unsealTrustedDekHoldingLock(id, profile, unsealed.secret, passhash, "finalizeRestore")
			await this.openSessionVerified(profile, unsealed.secret, passhash, dek ?? undefined)
			if (!dek) {
				this.emit("onImportedKeysDegraded", this.getProfileInfo(profile))
			}
			return this.getProfileInfo(profile)
		} finally {
			// zero buffers after sessionManager has copied.
			zeroize(unsealed.secret)
			zeroize(unsealed.entropy)
			zeroize(dek)
			zeroize(passhash)
		}
	}

	/** Passkey-side finalize: consume the stashed recovery secret + destination DEK.
	 *  Removed from the map BEFORE the await (B-11) so no concurrent sweep can zeroize
	 *  the buffers while `openSessionVerified` is copying them; zeroized in finally.
	 *  Same binding every other passkey open enforces: a tamper between `restore()` and
	 *  this finalize (the row sat unlocked in storage the whole time) must not yield a
	 *  clean session — the live row's security fields are compared against the
	 *  restore-time snapshot AND the fingerprint is recomputed from the stashed master;
	 *  degrades exactly like the password side on any mismatch. Caller MUST hold the
	 *  facade lock. */
	private async finalizePasskeyRestoreHoldingLock(id: string, profile: Profile): Promise<ProfileInfo> {
		const pending = this.pendingRestoreSecrets.get(id)
		if (!pending) {
			throw new Error("No pending restore secret for passkey profile")
		}
		if (profile.type !== "passkey") {
			throw new Error("Profile type changed between restore and finalizeRestore")
		}
		this.pendingRestoreSecrets.delete(id)
		let dek: ImportedKeysDek | null = pending.dek
		try {
			const intact =
				profile.type === pending.expected.type &&
				profile.credentialId === pending.expected.credentialId &&
				profile.dekSealed === pending.expected.dekSealed &&
				profile.pxeGeneration === pending.expected.pxeGeneration &&
				profile.walletFingerprint === pending.expected.walletFingerprint &&
				profile.walletFingerprint === (await computeWalletFingerprint(pending.secret))
			if (!intact) {
				zeroize(pending.dek)
				dek = null
			}
		} catch {
			zeroize(pending.dek)
			dek = null
		}
		if (!dek) {
			this.logger.log(this.name, LogLevel.Error, "passkey row changed between restore and finalizeRestore — opening derived-only", id)
		}
		try {
			await this.openSessionVerified(profile, pending.secret, undefined, dek ?? undefined)
			if (!dek) {
				this.emit("onImportedKeysDegraded", this.getProfileInfo(profile))
			}
			return this.getProfileInfo(profile)
		} finally {
			zeroize(pending.secret)
			zeroize(dek)
		}
	}
}
