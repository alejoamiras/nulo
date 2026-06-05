import type { ILogger } from "@/wallet/logger"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service } from "@nulo/extension-messaging/background"
import { EventHandler, Lock, getErrorMessage } from "@nulo/wallet-core/utils"
import { ProfileService } from "@/wallet/services/profile/service"
import { NetworkService, type Network } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { TokenService, type Token, type TokenInfo } from "@/wallet/services/token/service"
import { TransactionService, type Tx } from "@/wallet/services/transaction/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { NoteService, type RawNote } from "@/wallet/services/note/service"
import { ConfigService } from "@/wallet/services/config/service"
import { IncomingTransferRepository } from "./repository"
import {
	INCOMING_TRANSFER_SERVICE_NAME,
	type Events,
	type IncomingTransferPending,
	type IncomingTransferRecord,
	type IncomingTrustRecord,
	type IncomingTrustState,
	type Methods,
} from "./spec"

export * from "./spec"

/** Default poll cadence per (networkId, accountAddress) scheduler. Start
 *  conservative (30s); a future PR can tune based on SW restart frequency
 *  + PXE sync cadence. */
const DEFAULT_POLL_INTERVAL_MS = 30_000

/**
 * IncomingTransferService — surfaces decrypted notes that arrived from known
 * fungible-token contracts as "Received" rows in the activity feed.
 *
 * Dependencies (declared via `dependencies`):
 *   - ProfileService — active profile context for record scoping
 *   - NetworkService — resolve networks by id / chainId
 *   - AccountService — currently-active account address
 *   - TokenService — watched-contract list; lifecycle events
 *   - TransactionService — outgoing tx hashes (dedupe source)
 *   - OperationJournalService — in-flight `progress.txHash` (dedupe source)
 *   - NoteService — `getNotesRaw` for the raw NoteDao fields
 *
 * Discovery loop:
 *   ONE singleflight scheduler per (networkId, accountAddress). Each tick
 *   iterates the registered contract list and calls
 *   `noteService.getNotesRaw(networkId, account, contract)`. For each note,
 *   the 3-source dedupe gates record creation: prior records
 *   (`siloedNullifier`), user's own outgoing tx hashes, in-flight journal
 *   `progress.txHash`.
 *
 * Trust state machine (per `(profileId, networkId, contract)`):
 *   unknown → first note → pending (hidden, popup prompts)
 *   pending → all queued records stay hidden until user resolves
 *   Allow → trusted; queued records visible, emit Added for each
 *   Reject → blocked; queued records stay hidden silently
 *   trusted → subsequent records insert visible
 *   blocked → subsequent records insert hidden (silent)
 *
 * Late-delete reconciliation: when `TransactionService.onTransactionAdded`
 * fires, any existing record whose txHash matches is deleted — closes the
 * proving→submitting race window for self-mint / change-note cases that
 * arrived via PXE before the local tx was journalled.
 */
export class IncomingTransferService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	public static name = INCOMING_TRANSFER_SERVICE_NAME

	public readonly dependencies: readonly string[] = [
		ProfileService.name,
		NetworkService.name,
		AccountService.name,
		TokenService.name,
		TransactionService.name,
		OperationJournalService.name,
		NoteService.name,
		ConfigService.name,
	]

	public readonly onIncomingTransferAdded = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferUpdated = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferDeleted = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferPending = new EventHandler<IncomingTransferPending>()
	public readonly onIncomingTrustChanged = new EventHandler<IncomingTrustRecord>()

	private readonly repo = new IncomingTransferRepository()
	private profileService: ProfileService = null!
	private networkService: NetworkService = null!
	private accountService: AccountService = null!
	private tokenService: TokenService = null!
	private transactionService: TransactionService = null!
	private operationJournalService: OperationJournalService = null!
	private noteService: NoteService = null!
	private configService: ConfigService = null!

	/** Singleflight scheduler per `(networkId, accountAddress)`. The interval
	 *  id keeps each scheduler one-at-a-time. */
	private readonly schedulers = new Map<string, ReturnType<typeof setInterval>>()
	/** Contracts each scheduler watches, by scheduler key. */
	private readonly watchedContracts = new Map<string, Set<string>>()
	/** Reentrancy guard so a slow poll doesn't double-fire. */
	private readonly polling = new Set<string>()
	/** Single global lock serializing every writer on this service's storage
	 *  surface. Replaces the ad-hoc race guards (scanGenerations,
	 *  txDeleteInflight, compensating reverts) that prior audit cycles
	 *  accumulated. Plan reference: implementations-plan/
	 *  incoming-trust-state-machine-refactor/plan.md. */
	private readonly serviceLock: Lock

	/** Lifecycle epoch — bumped by clear / delete paths that wipe storage,
	 *  so an in-flight scanContract (which fetches PXE notes BEFORE entering
	 *  the per-note critical section) can detect that its snapshot is stale
	 *  and bail before persisting. Closes the lifecycle-cancel race the
	 *  codex final-audit identified. */
	private serviceEpoch = 0

	private readonly pollIntervalMs: number

	public constructor(logger: ILogger, pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS) {
		super(INCOMING_TRANSFER_SERVICE_NAME, logger)
		this.pollIntervalMs = pollIntervalMs
		this.serviceLock = new Lock(INCOMING_TRANSFER_SERVICE_NAME, logger)
	}

	/** Run `fn` inside the service lock. Acquire → try → finally release. */
	private async withServiceLock<T>(fn: () => Promise<T>): Promise<T> {
		await this.serviceLock.enter()
		try {
			return await fn()
		} finally {
			this.serviceLock.leave()
		}
	}

	/** Bump the lifecycle epoch — call from clear / delete paths so any
	 *  in-flight scanContract whose epochAtStart no longer matches bails. */
	private bumpServiceEpoch(): void {
		this.serviceEpoch += 1
	}

	protected async init(services: ServiceCollection): Promise<void> {
		this.profileService = services.get(ProfileService.name)
		this.networkService = services.get(NetworkService.name)
		this.accountService = services.get(AccountService.name)
		this.tokenService = services.get(TokenService.name)
		this.transactionService = services.get(TransactionService.name)
		this.operationJournalService = services.get(OperationJournalService.name)
		this.noteService = services.get(NoteService.name)
		this.configService = services.get(ConfigService.name)

		this.tokenService.onTokenAdded.add(this.onTokenAdded)
		this.tokenService.onTokenDeleted.add(this.onTokenDeleted)
		this.transactionService.onTransactionAdded.add(this.onTransactionAdded)
		// Profile lifecycle: re-hydrate the scheduler set when the active
		// profile changes (otherwise we keep scanning the old profile's
		// tokens). Wipe stored records when a profile is deleted.
		this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)
		this.profileService.onProfileDeleted.add(this.onProfileDeleted)
		// Account lifecycle (codex post-impl audit C3): without these, a newly
		// added account stays unscanned until SW restart (or the user adds a
		// token), and a deleted account keeps polling PXE indefinitely — both
		// wasted PXE calls and a privacy footgun (PXE keeps querying for an
		// account the user removed). hydrateSchedulers is the simplest correct
		// reaction to onAccountAdded (chain pull + ratify); onAccountDeleted
		// is a targeted tear-down per (networkId, accountAddress) key across
		// every network sharing the account's chainId.
		this.accountService.onAccountAdded.add(this.onAccountAdded)
		this.accountService.onAccountDeleted.add(this.onAccountDeleted)
		// onAccountUpdated intentionally not subscribed — Account.address is
		// derivation-bound (profileId + chainId + index + type) and cannot
		// change for an existing record. A name/visibility flip would not
		// affect scheduling.
		// Chain-purge fan-out (mirrors TransactionService.init at line 55):
		// when a chain is removed, drop our records + trust rows for that
		// (profile, network) pair.
		this.networkService.registerChainPurgeSubscriber(async (profileId, _chainId, networkId) => {
			await this.clearChain(profileId, networkId)
		})

		// Hydrate schedulers from any tokens already in storage. Without
		// this, a SW restart would wait for the next onTokenAdded event
		// before resuming any polling — which never fires for tokens
		// added in a prior session.
		await this.hydrateSchedulers()
	}

	private onActiveProfileChanged = async (): Promise<void> => {
		await this.hydrateSchedulers()
	}

	private onProfileDeleted = async (profile: { id: string }): Promise<void> => {
		await this.clearProfile(profile.id)
	}

	private onAccountAdded = async (_account: { chainId: number; address: string }): Promise<void> => {
		// Lightweight re-hydrate — onAccountAdded is rare (user-driven). The
		// cost is one tokens-by-profile read + one accounts-by-(profile,chain)
		// read per network. Cheaper than open-coding the scheduler bookkeeping
		// and reusing hydrateSchedulers keeps the per-account add path
		// converging on the same end state as a fresh service init.
		await this.hydrateSchedulers()
	}

	private onAccountDeleted = async (account: { chainId: number; address: string }): Promise<void> => {
		// Targeted tear-down: stop polling for every (network, deletedAccount)
		// scheduler key. Without this, the interval keeps PXE-querying for an
		// account the user removed — wasted calls and a privacy footgun.
		// Wipes records belonging to the deleted account per-contract.
		// Trust rows are contract-scoped (not account-scoped) → survive.
		const profile = await this.profileService.getActiveProfile()
		if (!profile) return
		let networks: Network[]
		try {
			networks = await this.networkService.getNetworks(account.chainId)
		} catch (error) {
			this.logWarn(`onAccountDeleted: failed to resolve networks: ${getErrorMessage(error)}`)
			return
		}

		await this.withServiceLock(async () => {
			for (const network of networks) {
				const key = this.schedulerKey(network.id, account.address)
				const interval = this.schedulers.get(key)
				if (interval) clearInterval(interval)
				this.schedulers.delete(key)
				this.watchedContracts.delete(key)

				// Wipe records for the deleted account on this network.
				const records = await this.repo.listForAccount(profile.id, network.id, account.address)
				for (const record of records) {
					await this.repo.deleteRecord(record.siloedNullifier)
					this.emit("onIncomingTransferDeleted", record)
				}
			}
			// Invalidate any in-flight scan whose PXE snapshot predates this wipe.
			this.bumpServiceEpoch()
		})
	}

	// --- public surface ---

	public async getIncomingTransfers(
		profileId: string,
		networkId: string,
		accountAddress: string,
		tokenId?: number,
	): Promise<IncomingTransferRecord[]> {
		await this.ensureInitialized()
		// Settings escape hatch: when `incomingTransfersVisible === false`,
		// records are still persisted (so flipping back on shows history
		// retroactively) but the activity feed sees an empty list. Useful
		// for cross-device same-seed users where another device's outgoing
		// surfaces here as incoming.
		try {
			const visible = await this.configService.getValue("incomingTransfersVisible")
			if (visible === false) return []
		} catch {
			// Config service unavailable — fail open (default behaviour).
		}
		const records = await this.repo.listForAccount(profileId, networkId, accountAddress)
		return records
			.filter((r) => !r.hidden)
			.filter((r) => tokenId === undefined || r.tokenId === tokenId)
			.sort(orderByBlockIndex)
	}

	public async getTrustState(profileId: string, networkId: string, contract: string): Promise<IncomingTrustState> {
		await this.ensureInitialized()
		const record = await this.repo.getTrust(profileId, networkId, contract)
		return record?.state ?? "unknown"
	}

	/** Internal trust transition. Caller MUST hold the service lock. */
	private async _setTrustStateLocked(profileId: string, networkId: string, contract: string, state: IncomingTrustState): Promise<void> {
		const record = await this.repo.setTrust(profileId, networkId, contract, state)
		this.emit("onIncomingTrustChanged", record)
	}

	public async setTrustAllow(profileId: string, networkId: string, contract: string): Promise<boolean> {
		await this.ensureInitialized()
		return this.withServiceLock(async () => {
			// Stale-popup guard: refuse the flip if the contract is no longer
			// registered. Inside the lock, so the check + writes are atomic.
			if (!(await this.isTokenStillRegistered(profileId, networkId, contract))) return false
			await this._setTrustStateLocked(profileId, networkId, contract, "trusted")

			// Flip every hidden record for this contract to visible; emit
			// Added for each so the popup activity feed updates atomically.
			// Visibility gate: if `incomingTransfersVisible` is off, persist
			// records visible (so a future toggle-on shows them) but DO NOT
			// emit live events.
			const visibilityEnabled = await this.isVisibilityEnabled()
			const records = await this.repo.listByContract(profileId, networkId, contract)
			for (const record of records) {
				if (!record.hidden) continue
				// Per-iteration getRecord re-check: tests may directly mutate
				// the records Map (bypassing the service + the lock). Lock
				// alone can't catch those. Cheap (one repo read per record).
				const stillThere = await this.repo.getRecord(record.siloedNullifier)
				if (!stillThere) continue
				const updated = { ...record, hidden: false }
				await this.repo.upsertRecord(updated)
				if (visibilityEnabled) {
					this.emit("onIncomingTransferAdded", updated)
				}
			}
			return true
		})
	}

	public async setTrustReject(profileId: string, networkId: string, contract: string): Promise<boolean> {
		await this.ensureInitialized()
		return this.withServiceLock(async () => {
			if (!(await this.isTokenStillRegistered(profileId, networkId, contract))) return false
			await this._setTrustStateLocked(profileId, networkId, contract, "blocked")
			// Hidden records stay hidden. No event emission — silent rejection.
			return true
		})
	}

	private async isTokenStillRegistered(profileId: string, networkId: string, contract: string): Promise<boolean> {
		try {
			const network = await this.networkService.getNetwork(networkId)
			const tokens = await this.tokenService.getTokensRaw(profileId)
			return tokens.some((t) => t.contract === contract && t.chainId === network.chainId)
		} catch {
			// On any lookup failure, fail CLOSED (return false) — refusing
			// a trust flip is safer than honoring one on a contract whose
			// registration we couldn't verify.
			return false
		}
	}

	public async clearProfile(profileId: string): Promise<void> {
		await this.ensureInitialized()
		await this.repo.clearProfile(profileId)
		await this.hydrateSchedulers()
	}

	public async clearChain(profileId: string, networkId: string): Promise<void> {
		await this.ensureInitialized()
		await this.repo.clearChain(profileId, networkId)
		await this.hydrateSchedulers()
	}

	// --- internal: scheduler ---

	private schedulerKey(networkId: string, accountAddress: string): string {
		return `${networkId}|${accountAddress}`
	}

	private async resolveNetworkByChainId(chainId: number): Promise<Network | undefined> {
		try {
			const networks = await this.networkService.getNetworks(chainId)
			return networks[0]
		} catch {
			return undefined
		}
	}

	/** Rebuild the scheduler set from current tokens + active accounts.
	 *  Lifecycle-cancel safety: callers wrapping hydrateSchedulers (e.g.,
	 *  clearProfile/clearChain in Phase 6) bump `serviceEpoch` so any
	 *  in-flight scan whose snapshot predates the rebuild will bail.
	 */
	private async hydrateSchedulers(): Promise<void> {
		// Clear existing schedulers; we re-register below.
		for (const id of this.schedulers.values()) clearInterval(id)
		this.schedulers.clear()
		this.watchedContracts.clear()

		const profile = await this.profileService.getActiveProfile()
		if (!profile) return
		const networks = await this.networkService.getNetworks()
		const tokens = await this.tokenService.getTokensRaw(profile.id)

		for (const network of networks) {
			const tokensForNet = tokens.filter((t) => t.chainId === network.chainId)
			if (tokensForNet.length === 0) continue
			const accounts = await this.accountService.getAccounts(profile.id, network.chainId)
			for (const account of accounts) {
				const key = this.schedulerKey(network.id, account.address)
				const contracts = new Set(tokensForNet.map((t) => t.contract))
				this.watchedContracts.set(key, contracts)
				this.startScheduler(profile.id, network.id, account.address)
			}
		}
	}

	private startScheduler(profileId: string, networkId: string, accountAddress: string): void {
		const key = this.schedulerKey(networkId, accountAddress)
		if (this.schedulers.has(key)) return
		const interval = setInterval(() => {
			this.poll(profileId, networkId, accountAddress).catch((err) => {
				this.logWarn(`Poll failed: ${getErrorMessage(err)}`)
			})
		}, this.pollIntervalMs)
		this.schedulers.set(key, interval)
		// Kick once immediately so first-receive doesn't wait one full
		// interval after SW restart / token-add.
		this.poll(profileId, networkId, accountAddress).catch((err) => {
			this.logWarn(`Initial poll failed: ${getErrorMessage(err)}`)
		})
	}

	private onTokenAdded = async (token: TokenInfo): Promise<void> => {
		// TokenInfo lacks `profileId`; trust the active profile context the
		// emit is happening in. (The token service emits while the owning
		// profile is loaded.)
		const profile = await this.profileService.getActiveProfile()
		if (!profile) return
		const network = await this.resolveNetworkByChainId(token.chainId)
		if (!network) return
		const accounts = await this.accountService.getAccounts(profile.id, network.chainId)
		for (const account of accounts) {
			const key = this.schedulerKey(network.id, account.address)
			let contracts = this.watchedContracts.get(key)
			if (!contracts) {
				contracts = new Set()
				this.watchedContracts.set(key, contracts)
			}
			contracts.add(token.contract)
			this.startScheduler(profile.id, network.id, account.address)
		}
	}

	private onTokenDeleted = async (token: TokenInfo): Promise<void> => {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) return
		const network = await this.resolveNetworkByChainId(token.chainId)
		if (!network) return

		await this.withServiceLock(async () => {
			// Scheduler teardown + row mutations both inside the lock so a
			// concurrent scan can't slip a row in between teardown + wipe.
			const accounts = await this.accountService.getAccounts(profile.id, network.chainId)
			for (const account of accounts) {
				const key = this.schedulerKey(network.id, account.address)
				const contracts = this.watchedContracts.get(key)
				if (!contracts) continue
				contracts.delete(token.contract)
				if (contracts.size === 0) {
					const interval = this.schedulers.get(key)
					if (interval) clearInterval(interval)
					this.schedulers.delete(key)
					this.watchedContracts.delete(key)
				}
			}

			// Records wipe + trust reset. Re-add re-indexes via PXE with
			// identical blockTimestamps so activity-feed order is preserved.
			const records = await this.repo.listByContract(profile.id, network.id, token.contract)
			for (const record of records) {
				await this.repo.deleteRecord(record.siloedNullifier)
				this.emit("onIncomingTransferDeleted", record)
			}
			const trustRecord = await this.repo.getTrust(profile.id, network.id, token.contract)
			if (trustRecord) {
				const updated = await this.repo.setTrust(profile.id, network.id, token.contract, "unknown")
				this.emit("onIncomingTrustChanged", updated)
			}

			// Invalidate any in-flight scans whose PXE snapshot predates this wipe.
			this.bumpServiceEpoch()
		})
	}

	/** Per-hash reentrancy guard: `EventHandler.invoke` is sync-fires-async
	 *  (no await on subscribers), so two `onTransactionAdded` events for the
	 *  same hash can both observe the same `listByTxHash` result before
	 *  either delete completes — leading to double `onIncomingTransferDeleted`
	 *  emits. Storage delete is idempotent; event emission isn't. */
	private readonly txDeleteInflight = new Set<string>()

	private onTransactionAdded = async (tx: Tx): Promise<void> => {
		// Late-delete: if a tx we just added has a hash matching an existing
		// incoming record, that record was actually our own outgoing tx's
		// note — clean it up.
		const profile = await this.profileService.getActiveProfile()
		if (!profile) return
		const network = await this.resolveNetworkByChainId(tx.chainId)
		if (!network) return
		const guardKey = `${profile.id}|${network.id}|${tx.account}|${tx.hash}`
		if (this.txDeleteInflight.has(guardKey)) return
		this.txDeleteInflight.add(guardKey)
		try {
			const matches = await this.repo.listByTxHash(profile.id, network.id, tx.hash)
			for (const record of matches) {
				// Same-hash collision across accounts is legal under split-fee /
				// sponsored flows: account A's outgoing tx can deliver a note
				// to account B in the same hash. Only delete records whose
				// own accountAddress matches THIS tx's account; B's records
				// stay until B's own tx confirms.
				if (record.accountAddress !== tx.account) continue
				await this.repo.deleteRecord(record.siloedNullifier)
				this.emit("onIncomingTransferDeleted", record)
			}
		} finally {
			this.txDeleteInflight.delete(guardKey)
		}
	}

	private async poll(profileId: string, networkId: string, accountAddress: string): Promise<void> {
		const key = this.schedulerKey(networkId, accountAddress)
		if (this.polling.has(key)) return
		this.polling.add(key)
		try {
			const contracts = this.watchedContracts.get(key)
			if (!contracts || contracts.size === 0) return
			for (const contract of contracts) {
				try {
					await this.scanContract(profileId, networkId, accountAddress, contract)
				} catch (error) {
					this.logWarn(`Scan failed for ${contract}: ${getErrorMessage(error)}`)
				}
			}
		} finally {
			this.polling.delete(key)
		}
	}

	private async scanContract(profileId: string, networkId: string, accountAddress: string, contract: string): Promise<void> {
		// ── UNLOCKED discovery (PXE-bound — kept outside the service lock
		// so user-mediated writers like setTrustAllow don't wait on PXE) ──
		let notes: RawNote[]
		try {
			notes = await this.noteService.getNotesRaw(networkId, accountAddress, contract)
		} catch (error) {
			this.logWarn(`getNotesRaw failed: ${getErrorMessage(error)}`)
			return
		}

		const network = await this.networkService.getNetwork(networkId)

		// Capture lifecycle epoch BEFORE further async work. If clear /
		// onTokenDeleted / onAccountDeleted bumps the epoch while we're
		// still pre-lock, every per-note CS will observe the mismatch and
		// bail. Closes the codex final-audit Critical (PXE outside lock =
		// scan can otherwise resurrect just-wiped rows).
		const epochAtStart = this.serviceEpoch

		// Block-timestamp cache scoped to this scan. Lazy lookup inside the
		// per-note critical section: only blocks of notes that actually need
		// processing (new record or missing-blockTimestamp backfill) trigger
		// a PXE call. Multiple notes from the same block share the lookup.
		const blockTimestampCache = new Map<number, number | undefined>()
		const blockTimestampFor = async (bn: number): Promise<number | undefined> => {
			if (blockTimestampCache.has(bn)) return blockTimestampCache.get(bn)
			const ts = await this.noteService.getBlockTimestamp(networkId, bn)
			blockTimestampCache.set(bn, ts)
			return ts
		}

		// ── LOCKED commit (per-note critical section) ──
		// Note: only the FIRST note in this poll that observes `unknown`
		// triggers the unknown→pending transition + Pending emit. Subsequent
		// notes find `pending` and skip the emit (sticky pending semantic).
		for (const note of notes) {
			if (!note.siloedNullifier) continue
			await this.withServiceLock(async () => {
				// Lifecycle-cancel guard.
				if (this.serviceEpoch !== epochAtStart) return

				// Live re-reads INSIDE the lock.
				const tokens = await this.tokenService.getTokensRaw(profileId)
				const token = tokens.find((t) => t.contract === contract && t.chainId === network.chainId)
				if (!token) return // Token removed concurrently.

				// Re-read tx-suppression sets live. The outer-scan-loop
				// approach would stale these between notes if onTransactionAdded
				// fires mid-scan (codex R1 M1 / R2 confirmation).
				const outgoingTxHashes = await this.collectOutgoingTxHashes(network.chainId, accountAddress)
				const inflightTxHashes = await this.collectInflightTxHashes(profileId, networkId, accountAddress)

				// Existing-record branch: backfill blockTimestamp if missing.
				const existing = await this.repo.getRecord(note.siloedNullifier)
				if (existing) {
					if (existing.blockTimestamp === undefined) {
						const ts = await blockTimestampFor(note.l2BlockNumber)
						if (ts !== undefined) {
							await this.repo.upsertRecord({ ...existing, blockTimestamp: ts })
						}
					}
					return
				}

				if (outgoingTxHashes.has(note.txHash)) return
				if (inflightTxHashes.has(note.txHash)) return
				const amountRaw = parseNoteAmount(note)
				if (amountRaw === null) return

				// Read trust FRESH inside the lock — kills the residual race
				// codex audit-6 identified (the LOCAL trustState going stale
				// across PXE await chains in the prior design).
				const liveTrust = (await this.repo.getTrust(profileId, networkId, contract))?.state ?? "unknown"
				let trustState = liveTrust

				// First-receive: transition unknown → pending and emit the
				// pending event so the popup can prompt the user. Visibility
				// gate respects the user's `incomingTransfersVisible` toggle.
				if (trustState === "unknown") {
					const updated = await this.repo.setTrust(profileId, networkId, contract, "pending")
					this.emit("onIncomingTrustChanged", updated)
					trustState = "pending"
					if (await this.isVisibilityEnabled()) {
						this.emit("onIncomingTransferPending", {
							profileId,
							networkId,
							accountAddress,
							contract,
							tokenId: token.id,
							tokenSymbol: token.symbol,
							tokenDecimals: token.decimals,
							amountRaw,
						})
					}
				}

				const blockTimestamp = await blockTimestampFor(note.l2BlockNumber)
				const record = this.buildRecord({
					note,
					profileId,
					networkId,
					accountAddress,
					token,
					amountRaw,
					trustState,
					blockTimestamp,
				})
				await this.repo.upsertRecord(record)

				if (trustState === "trusted" && (await this.isVisibilityEnabled())) {
					this.emit("onIncomingTransferAdded", record)
				}
				// pending / blocked: record persisted hidden, no Added emit.
			})
		}
	}

	/** Visibility check used by both initial-load (`getIncomingTransfers`)
	 *  and live-event emit paths. Fails OPEN (returns true) if the config
	 *  service is unreachable so a transient port hiccup doesn't silently
	 *  suppress events. */
	private async isVisibilityEnabled(): Promise<boolean> {
		try {
			return (await this.configService.getValue("incomingTransfersVisible")) !== false
		} catch {
			return true
		}
	}

	/**
	 * Re-emit `onIncomingTransferPending` for every contract currently in
	 * `pending` trust state that the caller's account owns hidden records
	 * for. Called by `PopupManager` on (re)connect so a user who closed the
	 * popup without resolving doesn't get stuck — the next popup load
	 * re-prompts. Without this, the service only emits Pending on the
	 * `unknown → pending` transition, which is a one-shot event that
	 * vanishes if the popup wasn't open at the time.
	 */
	public async replayPendingPrompts(profileId: string, networkId: string, accountAddress: string): Promise<void> {
		await this.ensureInitialized()
		// Visibility gate (codex post-impl audit C2): if the user toggled
		// incoming-transfers OFF, the replay-on-(re)connect path must NOT
		// surface prompts — same privacy promise as the Pending emit in
		// `scanContract`. PopupManager owns the false→true flip replay, so
		// when the user toggles back on, that path re-invokes this method
		// and the gate passes.
		if (!(await this.isVisibilityEnabled())) return
		const trustRecords = await this.repo.listTrust()
		const pending = trustRecords.filter((t) => t.profileId === profileId && t.networkId === networkId && t.state === "pending")
		if (pending.length === 0) return
		let network
		try {
			network = await this.networkService.getNetwork(networkId)
		} catch {
			return
		}
		for (const trust of pending) {
			await this.withServiceLock(async () => {
				const scoped = (await this.repo.listByContract(profileId, networkId, trust.contract)).filter(
					(r) => r.accountAddress === accountAddress,
				)
				if (scoped.length === 0) return
				// Live re-reads INSIDE the lock. The outer `tokens` + `pending`
				// snapshots predate this critical section; a concurrent
				// onTokenDeleted may have made them stale.
				const liveTokens = await this.tokenService.getTokensRaw(profileId)
				const token = liveTokens.find((t) => t.contract === trust.contract && t.chainId === network.chainId)
				if (!token) return
				const liveTrust = await this.repo.getTrust(profileId, networkId, trust.contract)
				if (liveTrust?.state !== "pending") return

				const first = scoped[0]
				this.emit("onIncomingTransferPending", {
					profileId,
					networkId,
					accountAddress,
					contract: trust.contract,
					tokenId: token.id,
					tokenSymbol: token.symbol,
					tokenDecimals: token.decimals,
					amountRaw: first.amountRaw,
				})
			})
		}
	}

	private buildRecord(params: {
		note: RawNote
		profileId: string
		networkId: string
		accountAddress: string
		token: Token
		amountRaw: string
		trustState: IncomingTrustState
		blockTimestamp: number | undefined
	}): IncomingTransferRecord {
		const { note, profileId, networkId, accountAddress, token, amountRaw, trustState, blockTimestamp } = params
		const hidden = trustState !== "trusted"
		return {
			siloedNullifier: note.siloedNullifier,
			profileId,
			networkId,
			accountAddress,
			contract: token.contract,
			tokenId: token.id,
			owner: note.content?.owner ?? accountAddress,
			amountRaw,
			noteHash: note.noteHash,
			txHash: note.txHash,
			l2BlockNumber: note.l2BlockNumber,
			txIndexInBlock: note.txIndexInBlock,
			noteIndexInTx: note.noteIndexInTx,
			hidden,
			discoveredAt: Date.now(),
			blockTimestamp,
		}
	}

	private async collectOutgoingTxHashes(chainId: number, accountAddress: string): Promise<Set<string>> {
		try {
			const txs = await this.transactionService.getTransactions(accountAddress)
			return new Set(txs.filter((t) => t.chainId === chainId).map((t) => t.hash))
		} catch (error) {
			this.logWarn(`getTransactions failed: ${getErrorMessage(error)}`)
			return new Set()
		}
	}

	private async collectInflightTxHashes(profileId: string, networkId: string, accountAddress: string): Promise<Set<string>> {
		try {
			const ops = await this.operationJournalService.getOperations({ profileId, isTerminal: false })
			const hashes = new Set<string>()
			for (const op of ops) {
				if (op.accountAddress !== accountAddress) continue
				if (op.networkId !== networkId) continue
				const txHash = (op.progress as { txHash?: string })?.txHash
				if (txHash) hashes.add(txHash)
			}
			return hashes
		} catch (error) {
			this.logWarn(`getOperations failed: ${getErrorMessage(error)}`)
			return new Set()
		}
	}
}

/** Decode the UintNote amount from the parsed content map. Returns the
 *  raw u128 stringified decimal, or null if the note isn't a UintNote /
 *  failed to decode. */
function parseNoteAmount(note: RawNote): string | null {
	const value = note.content?.value
	if (!value) return null
	try {
		const big = BigInt(value)
		return big.toString()
	} catch {
		return null
	}
}

/** Order records by (block, txIndex, noteIndex) ascending. Sorting helper
 *  exported so tests can pin the ordering invariant. */
export function orderByBlockIndex(a: IncomingTransferRecord, b: IncomingTransferRecord): number {
	if (a.l2BlockNumber !== b.l2BlockNumber) return a.l2BlockNumber - b.l2BlockNumber
	if (a.txIndexInBlock !== b.txIndexInBlock) return a.txIndexInBlock - b.txIndexInBlock
	return a.noteIndexInTx - b.noteIndexInTx
}
