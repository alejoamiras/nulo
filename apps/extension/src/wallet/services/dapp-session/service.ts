import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import type { ILogger } from "@/wallet/logger"
import { ProfileService } from "@/wallet/services/profile/service"
import type { ExecutionFence } from "@/wallet/services/profile/profile-deletion-state"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { purgeRows } from "@/wallet/services/purge-rows"
import { nextRandomId } from "@/wallet/services/id-allocators"
import { EntityStorage } from "@/wallet/storage"
import { DappSessionMacStorage } from "./mac-storage"
import { Lock } from "@/wallet/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import {
	DAPP_SESSION_SERVICE_NAME,
	type DappMetadata,
	type DappPermissions,
	type CapabilityDecision,
	type DappSession,
	type GrantedCapabilityRecord,
	type RejectedCapabilityRecord,
	type AccessLevel,
	type Methods,
	type Events,
	DappSessionSchema,
} from "./spec"

export * from "./spec"

export class DappSessionService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"getDappSessions",
		"getDappSession",
		"addDappSession",
		"updateDappSession",
		"deleteDappSession",
		"setVerificationHash",
		"setTrustedVerification",
		"setAccountAliases",
		"setCapabilityGrants",
		"getCapabilityGrants",
		"setCapabilityRejections",
		"getCapabilityRejections",
		"applyCapabilityDecision",
	)
	public static name = DAPP_SESSION_SERVICE_NAME

	public readonly onDappSessionAdded = new EventHandler<DappSession>()
	public readonly onDappSessionUpdated = new EventHandler<DappSession>()
	public readonly onDappSessionDeleted = new EventHandler<DappSession>()

	private readonly storage: DappSessionMacStorage
	private readonly lock = new Lock()

	private profileService: ProfileService = null!

	public constructor(logger: ILogger, browserApi: BrowserApi) {
		super(DAPP_SESSION_SERVICE_NAME, logger)
		// F-12: wrap the raw store with the row-integrity (MAC) layer. The key
		// provider reads `this.profileService` lazily — it is set in `init`,
		// before any storage operation runs. The inner EntityStorage validates
		// each row via `DappSessionSchema` (dev's boundary codec) BEFORE the MAC
		// layer verifies row integrity — both defenses run.
		this.storage = new DappSessionMacStorage(
			new EntityStorage<DappSession>("nulo:core:dappSessions", browserApi.storage.local, (raw) => DappSessionSchema.parse(raw)),
			(profileId) => this.profileService.deriveDappSessionMacKey(profileId),
			logger,
		)
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		// Profile-delete cleanup is now the coordinator's awaited `purgeForProfile` (D).
	}

	public async getDappSessions(): Promise<DappSession[]> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		await this.deleteExpired()
		return (await this.storage.getValues()).filter((x) => x.profileId === profile.id)
	}

	public async getDappSession(sessionId: string): Promise<DappSession> {
		const session = await this.storage.get(sessionId)
		if (!session) {
			throw new Error("Invalid id")
		}
		if (await this.isExpired(session)) {
			throw new Error("Session expired")
		}
		return session
	}

	public async tryGetDappSession(sessionId: string): Promise<DappSession | undefined> {
		const session = await this.storage.get(sessionId)
		if (session && (await this.isExpired(session))) {
			return undefined
		}
		return session
	}

	/**
	 * Find a non-expired DappSession by `(origin, chainId)`.
	 * Used by the wallet-sdk integration to auto-approve returning users:
	 * if a valid session already exists for the origin AND chain, we skip
	 * the connect popup and go straight to key exchange.
	 *
	 * `chainId` is REQUIRED (AUDIT A12). Sessions are per
	 * `(origin, chainId, profileId)` so a session remembered on testnet
	 * does not silently auto-approve on mainnet — that was a
	 * cross-network trust-bleed bug. The lookup matches the storage
	 * shape: `DappSession.chainId` is the source of truth; no
	 * `permissions[].chains?: string[]` redundancy.
	 */
	public async tryGetDappSessionByOriginAndChain(
		origin: string,
		chainId: string,
		forProfileId?: string,
	): Promise<DappSession | undefined> {
		await this.ensureInitialized()
		// `forProfileId` ANCHORS the lookup to a caller-known identity: the
		// dispatch path passes the session's establishment-stamped profile, so
		// an in-flight message racing a profile switch resolves its OWN
		// profile's row or nothing — never the newly active profile's. Callers
		// without a stamped identity (discovery, establishment) omit it and get
		// the live active profile, as before.
		const profileId = forProfileId ?? (await this.profileService.getActiveProfile())?.id
		if (!profileId) {
			return undefined
		}
		const sessions = (await this.storage.getValues()).filter(
			(x) => x.profileId === profileId && x.dappMetadata.url === origin && x.chainId === chainId,
		)
		for (const session of sessions) {
			if (!(await this.isExpired(session))) {
				return session
			}
		}
		return undefined
	}

	public async addDappSession(
		dappMetadata: DappMetadata,
		permissions: DappPermissions[],
		accounts: string[],
		confirmationLevel: AccessLevel,
		chainId: string,
	): Promise<DappSession> {
		await this.ensureInitialized()
		// Atomic read+capture: the expiry sweep + lock wait + id allocation below
		// can span the profile's deletion. An orphan here is worse than most —
		// a dApp-session row is a dormant permission grant. The capture's only
		// throw is the locked gate; re-thrown under this method's pinned message.
		let fence: ExecutionFence
		try {
			fence = await this.profileService.captureExecutionFence()
		} catch {
			throw new Error("Wallet is locked")
		}
		const deletion = this.profileService.getDeletionState()
		await this.deleteExpired()
		return await this.lock.withLock(async () => {
			const id = await nextRandomId(this.storage, 64)

			const session: DappSession = {
				id,
				profileId: fence.profileId,
				chainId,
				dappMetadata: dappMetadata,
				permissions: permissions,
				accounts: accounts,
				confirmationLevel: confirmationLevel,
				expiry: Date.now() + 7 * 24 * 60 * 60 * 1000,
			}
			deletion.assertCurrent(fence.profileId, fence.epoch)
			await this.storage.set(session.id, session)
			// The set awaits — compensate before the grant becomes observable.
			if (!deletion.isCurrent(fence.profileId, fence.epoch)) {
				await this.storage.delete(session.id)
				throw new Error(`profile ${fence.profileId} deleted`)
			}
			this.emit("onDappSessionAdded", session)

			return session
		})
	}

	/**
	 * Q-09: the shared "load → require → mutate → persist → emit" body every
	 * single-field setter below repeats. Under the session lock: load the row,
	 * throw `Invalid id` if absent, apply `mutate` (synchronous), persist, and
	 * emit `onDappSessionUpdated`. `applyCapabilityDecision` intentionally does
	 * NOT route through here (it merges deltas under one lock).
	 */
	private patchSession(sessionId: string, mutate: (session: DappSession) => void): Promise<DappSession> {
		return this.lock.withLock(async () => {
			const session = await this.storage.get(sessionId)
			if (!session) throw new Error("Invalid id")
			mutate(session)
			await this.storage.set(sessionId, session)
			this.emit("onDappSessionUpdated", session)
			return session
		})
	}

	public async updateDappSession(
		sessionId: string,
		permissions: DappPermissions[],
		accounts: string[],
		confirmationLevel: AccessLevel,
	): Promise<DappSession> {
		return await this.patchSession(sessionId, (session) => {
			session.permissions = permissions
			session.accounts = accounts
			session.confirmationLevel = confirmationLevel
		})
	}

	public async upgradeDappSession(sessionId: string, newSessionId: string, newExpiry: number): Promise<DappSession> {
		return await this.lock.withLock(async () => {
			if (await this.storage.contains(newSessionId)) {
				throw new Error("Invalid new id")
			}

			const oldSession = await this.storage.get(sessionId)
			if (!oldSession) {
				throw new Error("Invalid id")
			}
			await this.storage.delete(oldSession.id)
			this.emit("onDappSessionDeleted", oldSession)

			const newSession = { ...oldSession, id: newSessionId, expiry: newExpiry }
			await this.storage.set(newSession.id, newSession)
			this.emit("onDappSessionAdded", newSession)

			return newSession
		})
	}

	public async setVerificationHash(sessionId: string, verificationHash: string): Promise<DappSession> {
		return await this.patchSession(sessionId, (session) => {
			session.verificationHash = verificationHash
		})
	}

	public async setTrustedVerification(sessionId: string, trusted: boolean): Promise<DappSession> {
		return await this.patchSession(sessionId, (session) => {
			session.trustedVerification = trusted
		})
	}

	public async setAccountAliases(sessionId: string, aliases: Record<string, string>): Promise<DappSession> {
		return await this.patchSession(sessionId, (session) => {
			session.accountAliases = { ...session.accountAliases, ...aliases }
		})
	}

	public async setCapabilityGrants(sessionId: string, grants: GrantedCapabilityRecord[]): Promise<DappSession> {
		return await this.patchSession(sessionId, (session) => {
			session.capabilityGrants = grants
		})
	}

	public async getCapabilityGrants(sessionId: string): Promise<GrantedCapabilityRecord[]> {
		const session = await this.storage.get(sessionId)
		if (!session) throw new Error("Invalid id")
		return session.capabilityGrants ?? []
	}

	public async setCapabilityRejections(sessionId: string, rejections: RejectedCapabilityRecord[]): Promise<DappSession> {
		return await this.patchSession(sessionId, (session) => {
			session.capabilityRejections = rejections
		})
	}

	public async getCapabilityRejections(sessionId: string): Promise<RejectedCapabilityRecord[]> {
		const session = await this.storage.get(sessionId)
		if (!session) throw new Error("Invalid id")
		return session.capabilityRejections ?? []
	}

	/**
	 * Apply a capability decision atomically (B-14). The dispatcher used to push
	 * precomputed whole-row arrays across FOUR separately-locked writes
	 * (updateDappSession → setAccountAliases → setCapabilityGrants →
	 * setCapabilityRejections), so a concurrent revoke could throw mid-sequence
	 * (discarding the approval + a cryptic error) and two concurrent approvals both
	 * snapshotted the pre-write row, the later clobbering the earlier. This merges
	 * the DELTAS against the LATEST row under ONE lock: accounts UNION, aliases
	 * merge, grants keep-latest-minus-REPLACED + new records (a rejected/denied
	 * widening PRESERVES its older grant), and rejections preserve unrelated types
	 * (an approval clears its type's rejection).
	 * A missing row rejects cleanly with no partial write.
	 *
	 * Concurrent SAME-type approvals are last-completion-wins (an accepted deviation
	 * — two popups approving the same capability type for one session simultaneously
	 * is not a real flow); DIFFERENT-type concurrent approvals both survive because
	 * the merge reads the latest row.
	 */
	public async applyCapabilityDecision(sessionId: string, decision: CapabilityDecision): Promise<DappSession> {
		return await this.lock.withLock(async () => {
			const session = await this.storage.get(sessionId)
			if (!session) throw new Error("Invalid id")
			const now = Date.now()

			if (decision.addAccounts.length > 0) {
				session.accounts = [...new Set([...(session.accounts ?? []), ...decision.addAccounts])]
			}
			if (Object.keys(decision.aliasPatch).length > 0) {
				session.accountAliases = { ...session.accountAliases, ...decision.aliasPatch }
			}

			// Only REPLACED types drop their stored grant; a REJECTED type keeps its
			// existing grant — a denied widening (a re-consent the user declined) must
			// preserve the older, narrower grant, never revoke it.
			const replaceSet = new Set(decision.replaceTypes)
			session.capabilityGrants = [
				...(session.capabilityGrants ?? []).filter((g) => !replaceSet.has(g.capability.type)),
				...decision.grantRecords,
			]

			// Preserve rejections for types this decision didn't touch; an approval
			// clears its type's prior rejection (only rejectedTypes get re-recorded).
			const touched = new Set<string>([...decision.approvedTypes, ...decision.rejectedTypes])
			session.capabilityRejections = [
				...(session.capabilityRejections ?? []).filter((r) => !touched.has(r.capabilityType)),
				...decision.rejectedTypes.map((t) => ({ capabilityType: t, rejectedAt: now })),
			]

			await this.storage.set(sessionId, session)
			this.emit("onDappSessionUpdated", session)
			return session
		})
	}

	public async deleteDappSession(sessionId: string): Promise<DappSession> {
		return await this.lock.withLock(async () => {
			const session = await this.storage.get(sessionId)
			if (!session) {
				throw new Error("Invalid id")
			}
			await this.storage.delete(sessionId)
			this.emit("onDappSessionDeleted", session)

			return session
		})
	}

	public async isExpired(session: DappSession): Promise<boolean> {
		if (session.expiry < Date.now()) {
			await this.lock.withLock(async () => {
				if (await this.storage.contains(session.id)) {
					this.logDebug(`Session ${session.id} has expired`)
					await this.storage.delete(session.id)
					this.emit("onDappSessionDeleted", session)
				}
			})
			return true
		}
		return false
	}

	public async deleteExpired(): Promise<void> {
		await this.lock.withLock(async () => {
			const now = Date.now()
			const expired = (await this.storage.getValues()).filter((x) => x.expiry < now)
			await purgeRows(
				expired,
				(session) => {
					this.logDebug(`Session ${session.id} has expired`)
					return this.storage.delete(session.id)
				},
				(session) => this.emit("onDappSessionDeleted", session),
			)
		})
	}

	/** Awaited profile-scoped purge, called by the deletion coordinator (relocated
	 *  from the removed fire-and-forget `onProfileDeleted` sub — finding D). */
	public async purgeForProfile(profileId: string): Promise<void> {
		await this.ensureInitialized()
		this.logDebug(`purgeForProfile ${profileId}: remove related dapp sessions`)
		await this.lock.withLock(async () => {
			// MAC-free, key-aware raw purge: a DELETED profile may be INACTIVE (MAC
			// key underivable → `getValues()` HIDES its rows) or hold a schema-invalid
			// / key-aliased row; all must be removed or they revive on a same-secret
			// re-import. `rowsForProfile` returns the true `storageId` per row; delete
			// by it (not the self-reported id) and emit per successful delete so a
			// live wallet-SDK channel is torn down even on a partial failure.
			const rows = await this.storage.rowsForProfile(profileId)
			await purgeRows(
				rows,
				({ storageId }) => {
					this.logDebug(`Remove session @${storageId}`)
					return this.storage.delete(storageId)
				},
				({ row }) => this.emit("onDappSessionDeleted", row),
			)
		})
	}
}
