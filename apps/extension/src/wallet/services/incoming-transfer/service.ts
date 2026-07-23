import type { ILogger } from "@/wallet/logger"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { EventHandler, Lock, getErrorMessage } from "@nulo/wallet-core/utils"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import { ProfileService } from "@/wallet/services/profile/service"
import { NetworkService, networkInfoFrom, type Network } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { TokenService, type Token, type TokenInfo, type TokenDeleted } from "@/wallet/services/token/service"
import { TransactionService, type Tx } from "@/wallet/services/transaction/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { NoteService, type RawNote } from "@/wallet/services/note/service"
import { ConfigService } from "@/wallet/services/config/service"
import { TokenBalanceService } from "@/wallet/services/token-balance/service"
import { TaskService } from "@/wallet/services/task/service"
import { TaskStatus } from "@/wallet/services/task/spec"
import { PriceService } from "@/wallet/services/price/service"
import { getPriceMapEntry } from "@/wallet/services/price/price-map"
import { isReceiptAboveDustThreshold, usdThresholdToMicro } from "@/utils/incoming-dust"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import type { PublicEventCursor, PublicScanTips, PublicTokenClassStatus, PublicTransferEvent } from "@nulo/aztec-runtime/pxe/public-events"
import { IncomingTransferRepository } from "./repository"
import { PublicEventIndexer, type PublicEventReader } from "./public-event-indexer"
import {
	INCOMING_TRANSFER_SERVICE_NAME,
	type Events,
	type IncomingBalanceOutboxRow,
	type IncomingPublicEventRecord,
	type IncomingTransferPending,
	type IncomingTransferRecord,
	type IncomingTrustRecord,
	type IncomingTrustState,
	type Methods,
	type PublicScanCursor,
	noteRecordId,
	publicRecordId,
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
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"getIncomingTransfers",
		"getIncomingTransferById",
		"getTrustState",
		"setTrustAllow",
		"setTrustReject",
		"clearProfile",
		"clearChain",
		"replayPendingPrompts",
	)
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
		// D4 balance wiring: TokenBalanceService supplies the causal-ack refresh request; TaskService
		// supplies the anchored task's terminal state. Declaring both also starts TokenBalance first
		// (verified acyclic — TokenBalance does not depend on incoming-transfer).
		TokenBalanceService.name,
		TaskService.name,
		// D8 dust filter: PriceService supplies fresh USD quotes for the read-time filter.
		PriceService.name,
	]

	public readonly onIncomingTransferAdded = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferUpdated = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferDeleted = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferPending = new EventHandler<IncomingTransferPending>()
	public readonly onIncomingTrustChanged = new EventHandler<IncomingTrustRecord>()

	private readonly repo: IncomingTransferRepository
	private profileService: ProfileService = null!
	private networkService: NetworkService = null!
	private accountService: AccountService = null!
	private tokenService: TokenService = null!
	private transactionService: TransactionService = null!
	private operationJournalService: OperationJournalService = null!
	private noteService: NoteService = null!
	private configService: ConfigService = null!
	private tokenBalanceService: TokenBalanceService = null!
	private taskService: TaskService = null!
	private priceService: PriceService = null!

	/** Singleflight scheduler per `(networkId, accountAddress)`. The interval
	 *  id keeps each scheduler one-at-a-time. */
	private readonly schedulers = new Map<string, ReturnType<typeof setInterval>>()
	/** Contracts each scheduler watches, by scheduler key. */
	private readonly watchedContracts = new Map<string, Set<string>>()
	/** Reentrancy guard so a slow poll doesn't double-fire. */
	private readonly polling = new Set<string>()

	/** Public-event scan arm (D3). ONE scheduler per `(networkId, contract)` serves EVERY account —
	 *  `to` fans out client-side. Keyed `${networkId}|${contract}`. */
	private readonly publicSchedulers = new Map<string, ReturnType<typeof setInterval>>()
	private readonly publicPolling = new Set<string>()
	/** `${networkId}|${contract}` → the scan target (profile bound at hydration). */
	private readonly publicWatched = new Map<string, { profileId: string; networkId: string; contract: string }>()
	/** D2 class-gate verdict cached by the FINALIZED tip — one `getContract` per finalized advance,
	 *  not per tick. Keyed `${profileId}|${networkId}|${contract}`; `unresolved` is never cached. */
	private readonly classGateCache = new Map<string, { finalizedTip: number; checkpointedTip: number; status: PublicTokenClassStatus }>()
	private pxeService: PxeServiceClient = null!
	private indexer: PublicEventIndexer = null!
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
	/** Test seam: inject a fake public-event reader (unit tests drive the scan arm without a real
	 *  PXE transport). Production leaves it undefined and `init` builds the real client-backed one. */
	private readonly injectedPublicReader?: PublicEventReader

	public constructor(
		logger: ILogger,
		browserApi: BrowserApi,
		pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
		publicReader?: PublicEventReader,
	) {
		super(INCOMING_TRANSFER_SERVICE_NAME, logger)
		this.repo = new IncomingTransferRepository(browserApi)
		this.pollIntervalMs = pollIntervalMs
		this.injectedPublicReader = publicReader
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
		this.tokenBalanceService = services.get(TokenBalanceService.name)
		this.taskService = services.get(TaskService.name)
		this.priceService = services.get(PriceService.name)

		// Public-event scan arm (D3): its own PXE client + the injected indexer collaborator.
		// The reader curries `networkId → NetworkInfo` (via the same `networkInfoFrom` the note arm
		// uses through NoteService) and forwards to the SW-side public-event RPCs. A test-injected
		// reader replaces this transport wholesale.
		this.pxeService = new PxeServiceClient(this.logger)
		const reader: PublicEventReader = this.injectedPublicReader ?? {
			fetchTransferPage: async (networkId, contract, args) =>
				this.pxeService.getPublicTokenTransferEvents(
					networkInfoFrom(await this.networkService.getNetwork(networkId)),
					contract,
					args,
				),
			getScanTips: async (networkId) =>
				this.pxeService.getPublicScanTips(networkInfoFrom(await this.networkService.getNetwork(networkId))),
			getTokenClassStatus: async (networkId, contract) =>
				this.pxeService.getPublicTokenClassStatus(networkInfoFrom(await this.networkService.getNetwork(networkId)), contract),
		}
		this.indexer = new PublicEventIndexer(reader, (level, msg, ...rest) =>
			level === "warn" ? this.logWarn(msg, ...rest) : this.logDebug(msg, ...rest),
		)

		this.tokenService.onTokenAdded.add(this.onTokenAdded)
		this.tokenService.onTokenDeleted.add(this.onTokenDeleted)
		this.transactionService.onTransactionAdded.add(this.onTransactionAdded)
		// Profile lifecycle: re-hydrate the scheduler set when the active
		// profile changes (otherwise we keep scanning the old profile's tokens).
		// NB: profile DELETION cleanup is NOT wired here — the deletion coordinator
		// calls `clearProfile` DIRECTLY + AWAITED (coordinator.ts). A fire-and-forget
		// `onProfileDeleted` sub here would run un-awaited AFTER the coordinator
		// releases the id, re-introducing the exact race D7 removed (audit H3/D7).
		this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)
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

		// D4: drain any balance-refresh outbox rows that survived an SW death (pull-based recovery —
		// re-requests the refresh, no lost or mis-attributed enqueue).
		await this.drainBalanceOutbox().catch((err) => this.logWarn(`init drain failed: ${getErrorMessage(err)}`))
	}

	private onActiveProfileChanged = async (): Promise<void> => {
		await this.hydrateSchedulers()
	}

	private onAccountAdded = async (account: { chainId: number; address: string }): Promise<void> => {
		// A new account means the per-(network, contract) public cursors have already scanned PAST
		// its historical receipts (one stream serves all accounts). Reset those cursors to null so
		// the next scan re-indexes public history from `startBlock` and discovers the new account's
		// receipts (L7 — correctness over speed; the reset restarts backfill). Done under the lock +
		// the hydrateSchedulers epoch bump so an in-flight scan bails.
		const profile = await this.profileService.getActiveProfile()
		if (profile) {
			try {
				const networks = await this.networkService.getNetworks(account.chainId)
				const tokens = await this.tokenService.getTokensRaw(profile.id, account.chainId)
				await this.withServiceLock(async () => {
					// Invalidate in-flight scans BEFORE the reset, inside the SAME critical section: an
					// old scan (holding the pre-reset epoch) that acquires the lock AFTER us now fails its
					// `persistCursorLocked` epoch check, so it can't overwrite the reset and skip the new
					// account's history. Deferring the bump to `hydrateSchedulers` (below) left that gap
					// (codex R1 High #4).
					this.bumpServiceEpoch()
					for (const network of networks) {
						for (const contract of new Set(tokens.map((t) => t.contract))) {
							const existing = await this.repo.getCursor(profile.id, network.id, contract)
							await this.repo.setCursor(profile.id, network.id, contract, this.freshCursor(existing?.startBlock ?? 0))
							this.classGateCache.delete(`${profile.id}|${network.id}|${contract}`)
						}
					}
				})
			} catch (error) {
				this.logWarn(`onAccountAdded: public cursor reset failed: ${getErrorMessage(error)}`)
			}
		}
		// Lightweight re-hydrate — onAccountAdded is rare (user-driven). Reusing hydrateSchedulers
		// keeps the per-account add path converging on the same end state as a fresh service init.
		await this.hydrateSchedulers()
	}

	private onAccountDeleted = async (account: { profileId: string; chainId: number; address: string }): Promise<void> => {
		// Targeted tear-down: stop polling for every (network, deletedAccount)
		// scheduler key. Without this, the interval keeps PXE-querying for an
		// account the user removed — wasted calls and a privacy footgun.
		// Wipes records belonging to the deleted account per-contract.
		// Trust rows are contract-scoped (not account-scoped) → survive.
		//
		// Codex post-impl audit High #2: use `account.profileId` (NOT
		// `getActiveProfile()`). The chain-purge + profile-delete paths
		// fire onAccountDeleted for inactive profiles; using the active
		// profile id would wipe rows from the wrong profile.
		const activeProfile = await this.profileService.getActiveProfile()
		let networks: Network[]
		try {
			networks = await this.networkService.getNetworks(account.chainId)
		} catch (error) {
			this.logWarn(`onAccountDeleted: failed to resolve networks: ${getErrorMessage(error)}`)
			return
		}

		await this.withServiceLock(async () => {
			for (const network of networks) {
				// Scheduler key is `(networkId, address)` — no profileId. Only
				// touch the scheduler maps when the deleted account belongs
				// to the active profile (otherwise we'd kill the active
				// profile's scheduler for a same-address inactive account).
				if (activeProfile && account.profileId === activeProfile.id) {
					const key = this.schedulerKey(network.id, account.address)
					const interval = this.schedulers.get(key)
					if (interval) clearInterval(interval)
					this.schedulers.delete(key)
					this.watchedContracts.delete(key)
				}

				// Wipe records belonging to THIS account on THIS network.
				// Always uses account.profileId — chain purge / profile delete
				// can fire this handler for inactive profiles.
				const records = await this.repo.listForAccount(account.profileId, network.id, account.address)
				for (const record of records) {
					await this.repo.deleteRecord(record.id)
					this.emit("onIncomingTransferDeleted", record)
					// Purge the balance-outbox row for this deleted (account, token) — D4 stale-row safety.
					if (record.tokenId !== undefined) {
						await this.repo.deleteOutbox(account.profileId, network.id, account.address, record.tokenId)
					}
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
		const visible = records.filter((r) => !r.hidden).filter((r) => tokenId === undefined || r.tokenId === tokenId)
		// Dust filter runs LAST (D8) — the visible/hidden gates above are already applied, so a price
		// failure inside the dust filter can never un-hide a hidden record.
		const kept = await this.applyDustFilter(profileId, networkId, visible)
		return kept.sort(orderByBlockIndex)
	}

	/**
	 * Read-by-id for the received-detail page (`/popup/received/:id`). Deliberately UNFILTERED (no
	 * dust / visibility gate) — the page shows the specific record the user navigated to. `id` is the
	 * profile+network-scoped PK, so this can only ever return the caller's own record.
	 */
	public async getIncomingTransferById(id: string): Promise<IncomingTransferRecord | undefined> {
		await this.ensureInitialized()
		return this.repo.getRecord(id)
	}

	/**
	 * D8 USD-value dust filter, applied at read time. Fails OPEN at every gap (config unavailable,
	 * filter off, no token, no CoinGecko mapping, stale/absent quote) so a receipt is only ever
	 * HIDDEN when it provably falls below a fresh USD threshold. Never gates the balance-refresh
	 * outbox (balances are chain facts, independent of display).
	 */
	private async applyDustFilter(
		profileId: string,
		networkId: string,
		records: IncomingTransferRecord[],
	): Promise<IncomingTransferRecord[]> {
		if (records.length === 0) return records
		let thresholdMicro: bigint
		try {
			thresholdMicro = usdThresholdToMicro(await this.configService.getValue("incomingDustUsdThreshold"))
		} catch {
			return records // config unavailable → fail open
		}
		if (thresholdMicro <= 0n) return records // filter off
		let chainId: number
		let tokensById: Map<number, Token>
		let quotes: Record<string, { usd: number }>
		try {
			chainId = (await this.networkService.getNetwork(networkId)).chainId
			tokensById = new Map((await this.tokenService.getTokensRaw(profileId, chainId)).map((t) => [t.id, t]))
			quotes = await this.priceService.getQuotes()
		} catch {
			return records // any price/token/network dependency unavailable → fail open
		}
		return records.filter((r) => {
			if (r.tokenId === undefined) return true
			const token = tokensById.get(r.tokenId)
			if (!token) return true
			const entry = getPriceMapEntry(chainId, token.contract)
			const usdRate = entry ? quotes[entry.coingeckoId]?.usd : undefined // `getQuotes` returns FRESH quotes only
			return isReceiptAboveDustThreshold({ amountRaw: r.amountRaw, decimals: token.decimals, usdRate, thresholdMicro })
		})
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
				const stillThere = await this.repo.getRecord(record.id)
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
		await this.withServiceLock(async () => {
			await this.repo.clearProfile(profileId)
			// Lock held across the wipe AND scheduler rebuild so a queued poll
			// can't fire between the two and repopulate state we just cleared
			// (codex R2 H1). hydrateSchedulers bumps serviceEpoch internally
			// so any in-flight scan whose snapshot predates this wipe bails.
			await this.hydrateSchedulers()
		})
	}

	public async clearChain(profileId: string, networkId: string): Promise<void> {
		await this.ensureInitialized()
		await this.withServiceLock(async () => {
			await this.repo.clearChain(profileId, networkId)
			await this.hydrateSchedulers()
		})
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
	 *  Bumps `serviceEpoch` because the rebuild changes the schedulable
	 *  contracts surface — any in-flight scan that captured its epoch
	 *  before this rebuild MUST bail (it may be scanning under a profile
	 *  / network / contract set that no longer applies). Codex post-impl
	 *  audit High #1: `onActiveProfileChanged` calls hydrateSchedulers
	 *  without other lifecycle hooks; placing the bump inside the rebuild
	 *  covers EVERY hydrate caller (init, profile-change, account-add,
	 *  clearProfile, clearChain).
	 */
	private async hydrateSchedulers(): Promise<void> {
		this.bumpServiceEpoch()
		// Clear existing schedulers (both arms); we re-register below.
		for (const id of this.schedulers.values()) clearInterval(id)
		this.schedulers.clear()
		this.watchedContracts.clear()
		for (const id of this.publicSchedulers.values()) clearInterval(id)
		this.publicSchedulers.clear()
		this.publicWatched.clear()

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
			// Public arm: one scheduler per (networkId, contract) — serves every account.
			for (const contract of new Set(tokensForNet.map((t) => t.contract))) {
				this.startPublicScheduler(profile.id, network.id, contract)
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

	private publicSchedulerKey(networkId: string, contract: string): string {
		return `${networkId}|${contract}`
	}

	/** Start the public-event scheduler for `(networkId, contract)` (idempotent). */
	private startPublicScheduler(profileId: string, networkId: string, contract: string): void {
		const key = this.publicSchedulerKey(networkId, contract)
		this.publicWatched.set(key, { profileId, networkId, contract })
		if (this.publicSchedulers.has(key)) return
		const interval = setInterval(() => {
			this.pollPublic(key).catch((err) => this.logWarn(`Public poll failed: ${getErrorMessage(err)}`))
		}, this.pollIntervalMs)
		this.publicSchedulers.set(key, interval)
		// Kick once immediately (parity with the note arm).
		this.pollPublic(key).catch((err) => this.logWarn(`Initial public poll failed: ${getErrorMessage(err)}`))
	}

	/** Tear down the public-event scheduler for `(networkId, contract)`. */
	private stopPublicScheduler(networkId: string, contract: string): void {
		const key = this.publicSchedulerKey(networkId, contract)
		const interval = this.publicSchedulers.get(key)
		if (interval) clearInterval(interval)
		this.publicSchedulers.delete(key)
		this.publicWatched.delete(key)
	}

	/** Single-flight public poll for one `(networkId, contract)` stream. */
	private async pollPublic(key: string): Promise<void> {
		if (this.publicPolling.has(key)) return
		this.publicPolling.add(key)
		try {
			const target = this.publicWatched.get(key)
			if (!target) return
			await this.scanPublicContract(target.profileId, target.networkId, target.contract)
			await this.drainBalanceOutbox()
		} catch (error) {
			this.logWarn(`Public scan failed for ${key}: ${getErrorMessage(error)}`)
		} finally {
			this.publicPolling.delete(key)
		}
	}

	private onTokenAdded = async (token: TokenInfo): Promise<void> => {
		// TokenInfo lacks `profileId`; trust the active profile context the
		// emit is happening in. (The token service emits while the owning
		// profile is loaded.)
		const profile = await this.profileService.getActiveProfile()
		if (!profile) return
		const network = await this.resolveNetworkByChainId(token.chainId)
		if (!network) return

		// Every TokenService.addToken call is a user-explicit add path —
		// either the in-popup "Add custom token" form or a dApp's
		// register_token approved through the dapp-interaction modal. Both
		// already require the user to confirm the contract address, so the
		// first-receive trust popup that fires moments later is redundant
		// friction. Flip trust→trusted BEFORE the per-account schedulers
		// kick scans, so the first per-note CS reads trusted and persists
		// records visible from the start (instead of hidden+pending).
		// Idempotent: skip the write+emit when already trusted.
		await this.withServiceLock(async () => {
			const current = await this.repo.getTrust(profile.id, network.id, token.contract)
			if (current?.state === "trusted") return
			await this._setTrustStateLocked(profile.id, network.id, token.contract, "trusted")
		})

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
		// Public arm: one stream per (networkId, contract).
		this.startPublicScheduler(profile.id, network.id, token.contract)
	}

	private onTokenDeleted = async (token: TokenDeleted): Promise<void> => {
		// Scope to the DELETED token's profile (finding C), NOT the active profile:
		// deleting an inactive profile's token must not wipe the ACTIVE profile's
		// incoming-transfer records + trust for a shared (chain, contract).
		const profileId = token.profileId
		const network = (await this.networkService.getNetworksRaw(profileId, token.chainId))[0]
		if (!network) return

		await this.withServiceLock(async () => {
			// Scheduler teardown + row mutations both inside the lock so a
			// concurrent scan can't slip a row in between teardown + wipe.
			const accounts = await this.accountService.getAccounts(profileId, network.chainId)
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
			// Public arm teardown: stop the stream + DELETE the cursor row (re-add re-indexes public
			// history from `startBlock`, preserving the note arm's remove/re-add parity) + drop the
			// cached class gate.
			this.stopPublicScheduler(network.id, token.contract)
			await this.repo.deleteCursor(profileId, network.id, token.contract)
			this.classGateCache.delete(`${profileId}|${network.id}|${token.contract}`)

			// Records wipe + trust reset. Re-add re-indexes via PXE with
			// identical blockTimestamps so activity-feed order is preserved.
			const records = await this.repo.listByContract(profileId, network.id, token.contract)
			for (const record of records) {
				await this.repo.deleteRecord(record.id)
				this.emit("onIncomingTransferDeleted", record)
				// Purge the balance-outbox row for this (account, token) — the token is gone, so a
				// pending refresh would look up a missing balance (D4 stale-row safety).
				if (record.tokenId !== undefined) {
					await this.repo.deleteOutbox(profileId, network.id, record.accountAddress, record.tokenId)
				}
			}
			const trustRecord = await this.repo.getTrust(profileId, network.id, token.contract)
			if (trustRecord) {
				const updated = await this.repo.setTrust(profileId, network.id, token.contract, "unknown")
				this.emit("onIncomingTrustChanged", updated)
			}

			// Invalidate any in-flight scans whose PXE snapshot predates this wipe.
			this.bumpServiceEpoch()
		})
	}

	private onTransactionAdded = async (tx: Tx): Promise<void> => {
		// Late-delete: if a tx we just added has a hash matching an existing
		// incoming record, that record was actually our own outgoing tx's
		// note — clean it up. Same-hash collision across accounts is legal
		// under split-fee / sponsored flows: account A's outgoing tx can
		// deliver a note to account B in the same hash. Only delete records
		// whose own accountAddress matches THIS tx's account; B's records
		// stay until B's own tx confirms.
		//
		// The global serviceLock serializes the two-call sequence
		// (listByTxHash + per-record delete) AND coalesces back-to-back
		// same-hash events: the second handler enters after the first
		// completes, calls listByTxHash again, sees the matching record
		// gone, no-ops. The txDeleteInflight Set was a per-hash reentrancy
		// guard that this lock supersedes.
		const profile = await this.profileService.getActiveProfile()
		if (!profile) return
		const network = await this.resolveNetworkByChainId(tx.chainId)
		if (!network) return

		await this.withServiceLock(async () => {
			const matches = await this.repo.listByTxHash(profile.id, network.id, tx.hash)
			for (const record of matches) {
				if (record.accountAddress !== tx.account) continue
				// Re-check existence inside the lock — a concurrent path
				// (rare; tests can mutate the underlying Map directly) may
				// have already deleted.
				const stillThere = await this.repo.getRecord(record.id)
				if (!stillThere) continue
				await this.repo.deleteRecord(record.id)
				this.emit("onIncomingTransferDeleted", record)
			}
		})
	}

	private async poll(profileId: string, networkId: string, accountAddress: string): Promise<void> {
		const key = this.schedulerKey(networkId, accountAddress)
		if (this.polling.has(key)) return
		this.polling.add(key)
		try {
			const contracts = this.watchedContracts.get(key)
			if (contracts && contracts.size > 0) {
				for (const contract of contracts) {
					try {
						await this.scanContract(profileId, networkId, accountAddress, contract)
					} catch (error) {
						this.logWarn(`Scan failed for ${contract}: ${getErrorMessage(error)}`)
					}
				}
			}
			// D4: drain the balance-refresh outbox each tick (both arms). The drain is service-global +
			// active-profile-scoped, so any scheduler tick makes progress on the causal ack.
			await this.drainBalanceOutbox()
		} finally {
			this.polling.delete(key)
		}
	}

	private async scanContract(profileId: string, networkId: string, accountAddress: string, contract: string): Promise<void> {
		// Capture lifecycle epoch BEFORE any await — if a clear / onTokenDeleted /
		// onAccountDeleted runs during PXE I/O or any other await in the unlocked
		// discovery phase, every per-note CS below will observe the mismatch
		// and bail. Closes the codex final-audit Critical (PXE outside lock =
		// scan can otherwise resurrect just-wiped rows).
		const epochAtStart = this.serviceEpoch

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
				const existing = await this.repo.getRecord(noteRecordId(profileId, networkId, note.siloedNullifier))
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
				// D4 write-side (both arms): the outbox row is written BEFORE the record. A discovered
				// note changed the chain-factual balance regardless of trust/display state.
				await this.markBalanceDirty(profileId, networkId, accountAddress, token.id)
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

	// ── Public-event scan arm (D3 / D4 write-side / D6) ────────────────────────

	private freshCursor(startBlock: number): PublicScanCursor {
		return { cursor: null, lastSyncedBlockHash: null, lastScanFinalized: null, startBlock }
	}

	/** Recipient lookup for the pre-lock filter: lowercased address → canonical account address.
	 *  Includes hidden accounts — a receipt to one still changed its chain balance + is a record. */
	private async recipientsFor(profileId: string, chainId: number): Promise<Map<string, string>> {
		const accounts = await this.accountService.getAccounts(profileId, chainId, true)
		const map = new Map<string, string>()
		for (const a of accounts) map.set(a.address.toLowerCase(), a.address)
		return map
	}

	/** D2 class gate, cached by the finalized tip. `unresolved` is transient — never cached. */
	private async resolvePublicClassGate(
		profileId: string,
		networkId: string,
		contract: string,
		finalizedTip: number,
		checkpointedTip: number,
	): Promise<PublicTokenClassStatus> {
		// Cache by BOTH tips: the gate now resolves the class at the finalized AND checkpointed anchors
		// (codex R3 #7), so a checkpointed advance must re-resolve — else a mid-cache malicious upgrade
		// at checkpointed would be served a stale "standard".
		const key = `${profileId}|${networkId}|${contract}`
		const cached = this.classGateCache.get(key)
		if (cached && cached.finalizedTip === finalizedTip && cached.checkpointedTip === checkpointedTip) return cached.status
		const status = await this.indexer.getClassStatus(networkId, contract)
		if (status !== "unresolved") this.classGateCache.set(key, { finalizedTip, checkpointedTip, status })
		return status
	}

	/** The sole cursor writer (D3): persists inside the lock + epoch check. Returns false when the
	 *  epoch moved (a concurrent reset ran) — the write was skipped and the caller should bail. */
	private async persistCursorLocked(
		profileId: string,
		networkId: string,
		contract: string,
		cursor: PublicScanCursor,
		epochAtStart: number,
	): Promise<boolean> {
		return this.withServiceLock(async () => {
			if (this.serviceEpoch !== epochAtStart) return false
			await this.repo.setCursor(profileId, networkId, contract, cursor)
			return true
		})
	}

	/**
	 * One public-event scan tick for `(networkId, contract)`. Class-gates, then either resumes an
	 * in-progress reconciliation / pending page or runs a bounded forward scan. A reorg throw
	 * (referenceBlock dropped) escalates to reconciliation (D6).
	 */
	private async scanPublicContract(profileId: string, networkId: string, contract: string): Promise<void> {
		const epochAtStart = this.serviceEpoch
		let network: Network
		try {
			network = await this.networkService.getNetwork(networkId)
		} catch (error) {
			this.logWarn(`scanPublicContract: network resolve failed: ${getErrorMessage(error)}`)
			return
		}

		let tips: PublicScanTips
		try {
			tips = await this.indexer.getTips(networkId)
		} catch (error) {
			this.logWarn(`public tips failed for ${contract}: ${getErrorMessage(error)}`)
			return
		}

		const classStatus = await this.resolvePublicClassGate(
			profileId,
			networkId,
			contract,
			tips.finalizedBlockNumber,
			tips.checkpointedBlockNumber,
		)
		if (classStatus !== "standard") return // fail closed (non-standard / upgraded / unresolvable)

		const cursor = (await this.repo.getCursor(profileId, networkId, contract)) ?? this.freshCursor(0)

		// Resume an in-progress reconciliation FIRST (crash / MV3-tick resume) — don't forward-scan
		// the same tick.
		if (cursor.reconciling) {
			await this.stepReconciliation(profileId, networkId, contract, network.chainId, epochAtStart)
			return
		}

		// Resume a pending page (normal-scan record-before-cursor crash window, D3).
		if (cursor.pendingPage) {
			const reorged = await this.pendingPageReorged(networkId, contract, cursor.pendingPage)
			if (reorged) {
				await this.beginReconciliation(profileId, networkId, contract, network.chainId, cursor, tips, epochAtStart)
				return
			}
			// Clean fork — clear the marker; the forward scan below re-fetches from the un-advanced
			// cursor and idempotently re-commits any records the crash may have already written.
			if (!(await this.persistCursorLocked(profileId, networkId, contract, { ...cursor, pendingPage: undefined }, epochAtStart)))
				return
		}

		try {
			await this.forwardScanOnce(
				profileId,
				networkId,
				contract,
				network.chainId,
				{ ...cursor, pendingPage: undefined },
				tips,
				epochAtStart,
			)
		} catch (err) {
			if (cursor.lastSyncedBlockHash) {
				// We had a reorg anchor; a throw means it was reorged out (or a transient node error —
				// either way rewind + rescan is idempotent, so reconcile).
				await this.beginReconciliation(profileId, networkId, contract, network.chainId, cursor, tips, epochAtStart)
			} else {
				// No anchor yet (first scan) — nothing to reconcile; retry next tick.
				this.logWarn(`public forward scan failed (no anchor) for ${contract}: ${getErrorMessage(err)}`)
			}
		}
	}

	/** One budgeted forward-scan batch. Persists `pendingPage` before record writes and advances the
	 *  cursor after; the finalized watermark advances on every tick (even empty ones). */
	private async forwardScanOnce(
		profileId: string,
		networkId: string,
		contract: string,
		chainId: number,
		cursor: PublicScanCursor,
		tips: PublicScanTips,
		epochAtStart: number,
	): Promise<void> {
		// Reorg detection has TWO anchors (codex R2 #1 / R3 #1):
		// (1) BOUNDARY — the last-committed block. Prove it is an ANCESTOR of the checkpoint we're about
		//     to scan toward, via ONE atomic archive-membership query anchored to `checkpointedBlockHash`
		//     (NOT two independent "currently canonical" probes — those don't establish ancestry across a
		//     flapping/lying node, so fork-A rows below the cursor could be orphaned undetected). A
		//     non-member throws → reconcile. When the checkpoint hash is unavailable this tick, fall back
		//     to a best-effort canonicity probe of the boundary itself (the scan also caps to 1 page).
		if (cursor.cursor !== null && cursor.lastSyncedBlockHash) {
			if (tips.checkpointedBlockHash) {
				await this.indexer.probe(networkId, contract, {
					referenceBlock: tips.checkpointedBlockHash,
					verifyAncestorHash: cursor.lastSyncedBlockHash,
				})
			} else {
				await this.indexer.probe(networkId, contract, { afterCursor: cursor.cursor, referenceBlock: cursor.lastSyncedBlockHash })
			}
		}
		// (2) IN-RANGE — pin EVERY page to the checkpoint FORK HASH captured at tick start. A reorg any
		//     time during the multi-page scan makes a page read off the wrong fork throw immediately
		//     (defeats even a transient A→B→A excursion — the B page can't validate against H_A). When
		//     the tip hash is unavailable this tick, cap the scan to ONE page: a single page is atomic
		//     against one fork, so it can never splice two.
		const result = await this.indexer.scan(networkId, contract, {
			fromBlock: cursor.cursor === null ? cursor.startBlock : undefined,
			toBlock: tips.checkpointedBlockNumber,
			afterCursor: cursor.cursor,
			referenceBlock: tips.checkpointedBlockHash ?? cursor.lastSyncedBlockHash ?? undefined,
			maxPages: tips.checkpointedBlockHash ? undefined : 1,
		})

		if (result.scannedThrough === null) {
			// Nothing new — still advance the finalized watermark so a later reorg rewinds no further
			// than necessary. (A dropped/suspect page also lands here; the watermark comes from `tips`,
			// not the page, so advancing it is safe — no records are touched.)
			await this.persistCursorLocked(
				profileId,
				networkId,
				contract,
				{ ...cursor, lastScanFinalized: tips.finalizedBlockNumber },
				epochAtStart,
			)
			return
		}

		const recipients = await this.recipientsFor(profileId, chainId)
		const matching = this.indexer.filterToRecipients(result.events, recipients)
		const nextSyncedHash = result.topBlockHash ?? cursor.lastSyncedBlockHash

		if (matching.length === 0) {
			// No receipts for us — advance the cursor + watermark; no records, no crash window.
			await this.persistCursorLocked(
				profileId,
				networkId,
				contract,
				{
					...cursor,
					cursor: result.scannedThrough,
					lastSyncedBlockHash: nextSyncedHash,
					lastScanFinalized: tips.finalizedBlockNumber,
				},
				epochAtStart,
			)
			return
		}

		// Records to write → persist `pendingPage` BEFORE the writes (D3 crash window).
		const upperHash = result.topBlockHash ?? cursor.lastSyncedBlockHash
		if (upperHash) {
			const withPending: PublicScanCursor = {
				...cursor,
				pendingPage: { fromCursor: cursor.cursor, toScannedThrough: result.scannedThrough, upperHash },
			}
			if (!(await this.persistCursorLocked(profileId, networkId, contract, withPending, epochAtStart))) return
		}

		for (const ev of matching) {
			const account = recipients.get(ev.to.toLowerCase())
			if (!account) continue
			await this.commitPublicEvent(profileId, networkId, contract, chainId, account, ev, epochAtStart)
		}

		// Advance the cursor + clear `pendingPage` + record the watermark.
		await this.persistCursorLocked(
			profileId,
			networkId,
			contract,
			{
				...cursor,
				cursor: result.scannedThrough,
				lastSyncedBlockHash: nextSyncedHash,
				lastScanFinalized: tips.finalizedBlockNumber,
				pendingPage: undefined,
			},
			epochAtStart,
		)
	}

	/** Probe whether a pending page's fork is still canonical (D3): a `referenceBlock=upperHash`
	 *  page fetch that throws ⇒ the fork was reorged out. */
	private async pendingPageReorged(
		networkId: string,
		contract: string,
		pendingPage: NonNullable<PublicScanCursor["pendingPage"]>,
	): Promise<boolean> {
		try {
			await this.indexer.probe(networkId, contract, {
				afterCursor: pendingPage.toScannedThrough,
				referenceBlock: pendingPage.upperHash,
			})
			return false
		} catch {
			return true
		}
	}

	/** Stage a resumable reconciliation marker (D6) over `[lastScanFinalized+1 .. checkpointed]`,
	 *  pinned to `upperBoundHash`, then step it once. */
	private async beginReconciliation(
		profileId: string,
		networkId: string,
		contract: string,
		chainId: number,
		cursor: PublicScanCursor,
		tips: PublicScanTips,
		epochAtStart: number,
	): Promise<void> {
		if (!tips.checkpointedBlockHash) {
			this.logWarn(`reconcile deferred for ${contract}: no checkpointed block hash this tick`)
			return
		}
		const lowerBound = cursor.lastScanFinalized !== null ? cursor.lastScanFinalized + 1 : cursor.startBlock
		const marker: PublicScanCursor = {
			...cursor,
			pendingPage: undefined,
			reconciling: {
				lowerBound,
				upperBound: tips.checkpointedBlockNumber,
				upperBoundHash: tips.checkpointedBlockHash,
				progress: null,
				seen: [],
			},
		}
		if (!(await this.persistCursorLocked(profileId, networkId, contract, marker, epochAtStart))) return
		await this.stepReconciliation(profileId, networkId, contract, chainId, epochAtStart)
	}

	/** Advance a staged reconciliation by one budgeted batch (D6): page the window pinned to
	 *  `upperBoundHash`, re-insert canonical receipts, accumulate `seen`; on a mid-reconcile reorg
	 *  discard + restart; when the window is exhausted, finish (deletions + marker clear). */
	private async stepReconciliation(
		profileId: string,
		networkId: string,
		contract: string,
		chainId: number,
		epochAtStart: number,
	): Promise<void> {
		const cursorRow = await this.repo.getCursor(profileId, networkId, contract)
		const marker = cursorRow?.reconciling
		if (!cursorRow || !marker) return

		let result: Awaited<ReturnType<PublicEventIndexer["scan"]>>
		try {
			result = await this.indexer.scan(networkId, contract, {
				fromBlock: marker.lowerBound,
				// PIN the reconcile scan to the marker's captured checkpoint — NOT the node's live
				// checkpointed (which may have advanced). Without this the scan reads + `seen`-accumulates
				// past `upperBound`, the cursor advances beyond it while the anchor stays `upperBoundHash`
				// (low), and a later reorg of those higher blocks strands orphans (codex R1 High #3).
				toBlock: marker.upperBound,
				afterCursor: marker.progress,
				referenceBlock: marker.upperBoundHash,
			})
		} catch (err) {
			// Mid-reconcile reorg (`upperBoundHash` gone) → discard staged seen/progress + RESTART
			// against a fresh tip so `seen` can never mix two forks (codex final-confirm #1a).
			this.logWarn(`reconcile restart for ${contract}: ${getErrorMessage(err)}`)
			let tips: PublicScanTips
			try {
				tips = await this.indexer.getTips(networkId)
			} catch {
				return // node down — retry next tick; the marker is still staged.
			}
			await this.beginReconciliation(
				profileId,
				networkId,
				contract,
				chainId,
				{ ...cursorRow, reconciling: undefined },
				tips,
				epochAtStart,
			)
			return
		}

		if (result.dropped) {
			// A validator-DROPPED page (non-monotonic / beyond-bound — a compromised RPC node is in the
			// threat model), NOT a genuine EOF. Treating it as "window complete" would run
			// finishReconciliation and DELETE records not yet in `seen`. Leave the marker untouched and
			// retry next tick (codex R1 Critical #2).
			this.logWarn(`reconcile page dropped for ${contract} — retrying next tick, not finishing`)
			return
		}

		// Re-insert canonical receipts addressed to us (idempotent; updates a MOVED receipt's block).
		const recipients = await this.recipientsFor(profileId, chainId)
		for (const ev of this.indexer.filterToRecipients(result.events, recipients)) {
			const account = recipients.get(ev.to.toLowerCase())
			if (!account) continue
			await this.commitPublicEvent(profileId, networkId, contract, chainId, account, ev, epochAtStart, { reconcile: true })
		}

		// Accumulate `seen` deduped by HEIGHT (one canonical hash per block) — the reconcile window is
		// pinned to one fork, so height→hash is 1:1, and this bounds the persisted marker to
		// (upperBound − lowerBound) entries instead of one-per-event (codex R1 Med #6).
		const seenByHeight = new Map<number, string>(marker.seen)
		for (const ev of result.events) seenByHeight.set(ev.l2BlockNumber, ev.blockHash)
		const seen: Array<[number, string]> = [...seenByHeight]

		if (result.hasMore && result.scannedThrough) {
			// More window remains — persist progress + seen, resume next tick.
			await this.persistCursorLocked(
				profileId,
				networkId,
				contract,
				{ ...cursorRow, reconciling: { ...marker, progress: result.scannedThrough, seen } },
				epochAtStart,
			)
			return
		}

		await this.finishReconciliation(profileId, networkId, contract, marker, seen, result.scannedThrough, epochAtStart)
	}

	/** Close out a fully-scanned reconciliation (D6): delete orphan receipts (stored blockHash ≠
	 *  canonical at height — enqueuing the balance refresh BEFORE the delete), clear the marker, and
	 *  advance the anchor to the reconciled fork so the next forward scan resumes cleanly. */
	private async finishReconciliation(
		profileId: string,
		networkId: string,
		contract: string,
		marker: NonNullable<PublicScanCursor["reconciling"]>,
		seen: Array<[number, string]>,
		reconciledThrough: PublicEventCursor | null,
		epochAtStart: number,
	): Promise<void> {
		const canonicalByHeight = new Map<number, string>()
		for (const [height, hash] of seen) canonicalByHeight.set(height, hash)

		await this.withServiceLock(async () => {
			if (this.serviceEpoch !== epochAtStart) return
			const records = await this.repo.listByContract(profileId, networkId, contract)
			for (const record of records) {
				if (record.kind !== "public-event") continue
				if (record.l2BlockNumber < marker.lowerBound || record.l2BlockNumber > marker.upperBound) continue
				if (canonicalByHeight.get(record.l2BlockNumber) === record.blockHash) continue // still canonical
				// Orphaned (reversed) receipt: enqueue the balance refresh BEFORE deleting (delete-first
				// would lose the refresh on MV3 suspension), never driven by the recipient filter.
				if (record.tokenId !== undefined) await this.markBalanceDirty(profileId, networkId, record.accountAddress, record.tokenId)
				await this.repo.deleteRecord(record.id)
				this.emit("onIncomingTransferDeleted", record)
			}
		})

		// Clear the marker + advance the anchor to `upperBoundHash` so the next forward scan doesn't
		// re-throw on a stale referenceBlock (which would loop reconciliation).
		const cursorRow = await this.repo.getCursor(profileId, networkId, contract)
		if (cursorRow) {
			await this.persistCursorLocked(
				profileId,
				networkId,
				contract,
				{
					...cursorRow,
					reconciling: undefined,
					cursor: reconciledThrough ?? cursorRow.cursor,
					lastSyncedBlockHash: marker.upperBoundHash,
				},
				epochAtStart,
			)
		}
	}

	/**
	 * Per-event locked commit for a public receipt (mirrors the note arm's critical section). On a
	 * fresh receipt: 3-source dedupe → trust transition → outbox row (D4, BEFORE the record) → insert.
	 * With `reconcile`, an EXISTING record is updated in place when its block moved (idempotent otherwise).
	 */
	private async commitPublicEvent(
		profileId: string,
		networkId: string,
		contract: string,
		chainId: number,
		account: string,
		ev: PublicTransferEvent,
		epochAtStart: number,
		opts?: { reconcile?: boolean },
	): Promise<void> {
		await this.withServiceLock(async () => {
			if (this.serviceEpoch !== epochAtStart) return
			const tokens = await this.tokenService.getTokensRaw(profileId)
			const token = tokens.find((t) => t.contract === contract && t.chainId === chainId)
			if (!token) return // token removed concurrently

			const id = publicRecordId(profileId, networkId, ev.txHash, ev.logIndexWithinTx)
			const existing = await this.repo.getRecord(id)
			if (existing) {
				// A reorg can re-mine the same tx (same PK) at a NEW block — update the chain fields so
				// the reconciliation's blockHash comparison keeps it instead of deleting it.
				if (opts?.reconcile && existing.kind === "public-event" && existing.blockHash !== ev.blockHash) {
					await this.repo.upsertRecord({
						...existing,
						blockHash: ev.blockHash,
						l2BlockNumber: ev.l2BlockNumber,
						txIndexInBlock: ev.txIndexWithinBlock,
						indexInTx: ev.logIndexWithinTx,
						blockTimestamp: ev.blockTimestamp,
					})
				}
				return
			}

			// 3-source dedupe: own outgoing tx hashes, in-flight journal txHash (existing record was
			// checked above).
			const outgoing = await this.collectOutgoingTxHashes(chainId, account)
			if (outgoing.has(ev.txHash)) return
			const inflight = await this.collectInflightTxHashes(profileId, networkId, account)
			if (inflight.has(ev.txHash)) return

			let trustState = (await this.repo.getTrust(profileId, networkId, contract))?.state ?? "unknown"
			if (trustState === "unknown") {
				const updated = await this.repo.setTrust(profileId, networkId, contract, "pending")
				this.emit("onIncomingTrustChanged", updated)
				trustState = "pending"
				if (await this.isVisibilityEnabled()) {
					this.emit("onIncomingTransferPending", {
						profileId,
						networkId,
						accountAddress: account,
						contract,
						tokenId: token.id,
						tokenSymbol: token.symbol,
						tokenDecimals: token.decimals,
						amountRaw: ev.amountRaw,
					})
				}
			}

			// D4 write-side: the outbox row is written BEFORE the record (ordering + idempotent replay
			// substitute for a multi-key transaction). Trust-independent — a hidden receipt still
			// changed the chain balance.
			await this.markBalanceDirty(profileId, networkId, account, token.id)
			const record = this.buildPublicRecord({ ev, profileId, networkId, account, token, trustState })
			await this.repo.upsertRecord(record)
			if (trustState === "trusted" && (await this.isVisibilityEnabled())) {
				this.emit("onIncomingTransferAdded", record)
			}
		})
	}

	private buildPublicRecord(params: {
		ev: PublicTransferEvent
		profileId: string
		networkId: string
		account: string
		token: Token
		trustState: IncomingTrustState
	}): IncomingPublicEventRecord {
		const { ev, profileId, networkId, account, token, trustState } = params
		return {
			kind: "public-event",
			id: publicRecordId(profileId, networkId, ev.txHash, ev.logIndexWithinTx),
			from: ev.from,
			blockHash: ev.blockHash,
			profileId,
			networkId,
			accountAddress: account,
			contract: token.contract,
			tokenId: token.id,
			amountRaw: ev.amountRaw,
			txHash: ev.txHash,
			l2BlockNumber: ev.l2BlockNumber,
			txIndexInBlock: ev.txIndexWithinBlock,
			indexInTx: ev.logIndexWithinTx,
			hidden: trustState !== "trusted",
			discoveredAt: Date.now(),
			blockTimestamp: ev.blockTimestamp,
		}
	}

	/**
	 * D4 write-side: mark a balance dirty (written BEFORE the record). A new receipt OVERWRITES
	 * `dirtyAt` and CLEARS any prior task anchor — the old anchor is stale w.r.t. the newer receipt.
	 * The drain (Phase 3) reads these rows and issues the causal refresh.
	 */
	private async markBalanceDirty(profileId: string, networkId: string, account: string, tokenId: number): Promise<void> {
		await this.repo.setOutbox(profileId, networkId, account, tokenId, { dirtyAt: Date.now() })
	}

	/**
	 * Causal task-anchored drain of the balance-refresh outbox (D4/L17). Runs on init + every scan
	 * tick. ACTIVE-PROFILE-SCOPED — `TokenBalanceService`'s balance map is active-profile-only, so
	 * draining a background profile's row would look up a missing balance and false-classify it
	 * stale. Per row (re-read under the lock so a concurrent receipt's `dirtyAt` overwrite / anchor
	 * clear wins):
	 *  - anchored + terminal-SUCCESS → the task was minted strictly after this `dirtyAt`, so its
	 *    projection read chain state INCLUDING the receipt → delete the row (causal).
	 *  - anchored + terminal-FAILURE/MISSING → clear the anchor; the next drain re-requests.
	 *  - no anchor → `requestBalanceRefresh`: `{taskId}` (a FRESH task) → anchor it; `{busy}` → keep
	 *    the row unanchored (a later drain, after the in-flight task drains, mints a fresh one);
	 *    `{missing}` (the balance pair is positively gone — token/account removed) → delete the row.
	 *  - `requestBalanceRefresh` THROWS (a transient storage/task failure, NOT a missing pair) → KEEP
	 *    the row and retry next drain; deleting on a transient throw would discard the sole durable
	 *    refresh marker (codex R1 High #4).
	 */
	private async drainBalanceOutbox(): Promise<void> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) return
		let rows: Array<[string, IncomingBalanceOutboxRow]>
		try {
			rows = await this.repo.listOutbox()
		} catch (error) {
			this.logWarn(`drainBalanceOutbox: listOutbox failed: ${getErrorMessage(error)}`)
			return
		}
		for (const [key] of rows) {
			const parts = key.split("|")
			if (parts.length !== 4) continue
			const [profileId, networkId, accountAddress, tokenIdStr] = parts
			if (profileId !== profile.id) continue // active-profile-scoped (codex R2-followup-2 #1)
			const tokenId = Number(tokenIdStr)
			if (!Number.isInteger(tokenId)) continue
			await this.withServiceLock(async () => {
				const current = await this.repo.getOutbox(profileId, networkId, accountAddress, tokenId)
				if (!current) return
				if (current.pendingTaskId) {
					const state = this.readTaskState(current.pendingTaskId)
					if (state === "success") {
						await this.repo.deleteOutbox(profileId, networkId, accountAddress, tokenId)
					} else if (state === "failure" || state === "missing") {
						await this.repo.setOutbox(profileId, networkId, accountAddress, tokenId, { dirtyAt: current.dirtyAt })
					}
					// pending → keep waiting for the anchored task.
					return
				}
				let result: { taskId: string } | { busy: true } | { missing: true }
				try {
					result = await this.tokenBalanceService.requestBalanceRefresh(tokenId, accountAddress)
				} catch (error) {
					// TRANSIENT failure (storage/task), NOT a missing pair — keep the row + retry next
					// drain. Deleting here would lose the only durable refresh marker (codex R1 High #4).
					this.logWarn(`drainBalanceOutbox: refresh request failed transiently, keeping row: ${getErrorMessage(error)}`)
					return
				}
				if ("missing" in result) {
					// The (token, account) balance pair is positively gone (removed) → delete the stale row.
					await this.repo.deleteOutbox(profileId, networkId, accountAddress, tokenId)
					return
				}
				if ("taskId" in result) {
					await this.repo.setOutbox(profileId, networkId, accountAddress, tokenId, {
						dirtyAt: current.dirtyAt,
						pendingTaskId: result.taskId,
					})
				}
				// busy → keep the row unanchored; a later drain mints a fresh post-`dirtyAt` task.
			})
		}
	}

	/** Terminal state of an anchored refresh task via the TaskService ledger (`missing` = expired/gone). */
	private readTaskState(taskId: string): "success" | "failure" | "pending" | "missing" {
		let status: TaskStatus
		let finished: boolean
		try {
			const task = this.taskService.getTaskSync(taskId)
			status = task.status
			finished = task.finishedAt !== undefined
		} catch {
			return "missing"
		}
		if (!finished) return "pending"
		return status === TaskStatus.Completed ? "success" : "failure"
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
			kind: "note",
			id: noteRecordId(profileId, networkId, note.siloedNullifier),
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
			indexInTx: note.noteIndexInTx,
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

/** Order records by (block, txIndex, indexInTx) ascending. Sorting helper
 *  exported so tests can pin the ordering invariant. Note `indexInTx` mixes note-index
 *  and log-index spaces, so a note+public pair in the SAME tx orders arbitrarily —
 *  acceptable, since the block+txIndex prefix keeps cross-tx order correct. */
export function orderByBlockIndex(a: IncomingTransferRecord, b: IncomingTransferRecord): number {
	if (a.l2BlockNumber !== b.l2BlockNumber) return a.l2BlockNumber - b.l2BlockNumber
	if (a.txIndexInBlock !== b.txIndexInBlock) return a.txIndexInBlock - b.txIndexInBlock
	return a.indexInTx - b.indexInTx
}
