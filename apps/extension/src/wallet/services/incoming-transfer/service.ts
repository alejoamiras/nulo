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
import { TxHash } from "@aztec/stdlib/tx"
import type { PublicEventCursor, PublicScanTips, PublicTokenClassStatus, PublicTransferEvent } from "@nulo/aztec-runtime/pxe/public-events"
import type { IncomingPollGate } from "@/e2e/incoming-poll-gate"
import { IncomingTransferRepository } from "./repository"
import { PublicEventIndexer, type PublicEventReader, type PublicScanResult } from "./public-event-indexer"
import {
	BACKFILL_INDICATOR_THRESHOLD_BLOCKS,
	INCOMING_TRANSFER_SERVICE_NAME,
	type Events,
	type IncomingBalanceOutboxRow,
	type IncomingPublicEventRecord,
	type IncomingSyncSnapshot,
	type IncomingSyncState,
	type IncomingSyncStateChanged,
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
		"getReceiptFee",
		"getTrustState",
		"getSyncState",
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
	public readonly onIncomingSyncStateChanged = new EventHandler<IncomingSyncStateChanged>()

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
	private readonly classGateCache = new Map<string, { finalizedTip: number; checkpointHash: string; status: PublicTokenClassStatus }>()
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

	/** In-memory receipt-fee cache keyed `${networkId}|${txHash}|${blockHash}` (D5 lazy fee). A mined tx's
	 *  fee is block-derived, so a reorg re-mine under a new block hash mints a new key (the old entry is
	 *  simply never read again); only VIEWED public receipts populate it, so it stays tiny. Evicted on
	 *  chain/profile purge, and never persisted (no storage bloat). */
	private readonly feeCache = new Map<string, string>()

	/** Last emitted public-scan sync state per `${networkId}|${contract}` (§3 catching-up dot). Derived,
	 *  in-memory only (never persisted); backs both the transition-only emit and the getSyncState snapshot. */
	private readonly syncState = new Map<string, IncomingSyncSnapshot>()

	/** E2E-only deterministic race lever. `undefined` in production (the ctor
	 *  arg is only ever passed inside `if (E2E_PROVERLESS)` in runtime.ts), so
	 *  every call site is a no-op `?.` in prod. */
	private readonly incomingPollGate?: IncomingPollGate

	public constructor(
		logger: ILogger,
		browserApi: BrowserApi,
		pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
		publicReader?: PublicEventReader,
		incomingPollGate?: IncomingPollGate,
	) {
		super(INCOMING_TRANSFER_SERVICE_NAME, logger)
		this.repo = new IncomingTransferRepository(browserApi)
		this.pollIntervalMs = pollIntervalMs
		this.injectedPublicReader = publicReader
		this.serviceLock = new Lock(INCOMING_TRANSFER_SERVICE_NAME, logger)
		this.incomingPollGate = incomingPollGate
	}

	/** Run `fn` inside the service lock. `isCurrent` reports whether this
	 *  acquisition still owns the lock — false after a watchdog handoff. */
	private async withServiceLock<T>(fn: (isCurrent: () => boolean) => Promise<T>): Promise<T> {
		return this.serviceLock.withLock(fn)
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
			getTokenClassStatus: async (networkId, contract, checkpointHash) =>
				this.pxeService.getPublicTokenClassStatus(
					networkInfoFrom(await this.networkService.getNetwork(networkId)),
					contract,
					checkpointHash,
				),
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
				await this.purgeDeletedAccountOnNetworkLocked(account, network.id, activeProfile?.id)
			}
			// Invalidate any in-flight scan whose PXE snapshot predates this wipe.
			this.bumpServiceEpoch()
		})
	}

	/** Per-network wipe for a deleted account. Caller holds the service lock. */
	private async purgeDeletedAccountOnNetworkLocked(
		account: { profileId: string; chainId: number; address: string },
		networkId: string,
		activeProfileId: string | undefined,
	): Promise<void> {
		// Scheduler key is `(networkId, address)` — no profileId. Only
		// touch the scheduler maps when the deleted account belongs
		// to the active profile (otherwise we'd kill the active
		// profile's scheduler for a same-address inactive account).
		if (activeProfileId && account.profileId === activeProfileId) {
			const key = this.schedulerKey(networkId, account.address)
			const interval = this.schedulers.get(key)
			if (interval) clearInterval(interval)
			this.schedulers.delete(key)
			this.watchedContracts.delete(key)
		}

		// Wipe records belonging to THIS account on THIS network.
		// Always uses account.profileId — chain purge / profile delete
		// can fire this handler for inactive profiles.
		const records = await this.repo.listForAccount(account.profileId, networkId, account.address)
		for (const record of records) {
			await this.repo.deleteRecord(record.id)
			this.emit("onIncomingTransferDeleted", record)
			// Purge the balance-outbox row for this deleted (account, token) — D4 stale-row safety.
			if (record.tokenId !== undefined) {
				await this.repo.deleteOutbox(account.profileId, networkId, account.address, record.tokenId)
			}
		}
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
		// Fail CLOSED (matches the emit path): if visibility is off OR the config
		// is unverifiable, the feed sees an empty list — a reconnect/remount must
		// not expose receives the user chose to hide while the setting can't be read.
		if (!(await this.isVisibilityEnabled())) return []
		const records = await this.repo.listForAccount(profileId, networkId, accountAddress)
		const visible = records.filter((r) => !r.hidden).filter((r) => tokenId === undefined || r.tokenId === tokenId)
		// Dust filter runs LAST (D8) — the visible/hidden gates above are already applied, so a price
		// failure inside the dust filter can never un-hide a hidden record.
		const kept = await this.applyDustFilter(profileId, networkId, visible)
		return kept.sort(orderByBlockIndex)
	}

	/**
	 * Read-by-id for the received-detail page (`/popup/received/:id`). Deliberately UNFILTERED (no
	 * dust / visibility gate) — the page shows the specific record the user navigated to. Scoped to the
	 * ACTIVE profile: `id` is a URL route param and all profiles' records share one store, so a
	 * stale/crafted id (e.g. after a profile switch, or a bookmarked link) must NOT surface another
	 * profile's receipt — a cross-profile isolation boundary. A non-active-profile id → `undefined`.
	 */
	public async getIncomingTransferById(id: string): Promise<IncomingTransferRecord | undefined> {
		await this.ensureInitialized()
		const record = await this.repo.getRecord(id)
		if (!record) return undefined
		const active = await this.profileService.getActiveProfile()
		if (!active || record.profileId !== active.id) return undefined
		return record
	}

	/**
	 * Lazily fetch the network fee (fee juice) the SENDER paid for a receipt's parent tx. Keyed on the
	 * record `id`, resolved active-profile-scoped via `getIncomingTransferById`. The fee row is a
	 * PUBLIC-event feature — the record carries the block hash the reorg-safe cache needs, and a
	 * sender-paid fee is a public-transfer concept — so a note (private) receipt returns `null` with no
	 * node call. Not persisted — cached in-memory by `(networkId, txHash, blockHash)`: a mined tx's fee is
	 * block-derived, and a reorg re-mine under a new block hash changes it, so the block hash is part of
	 * the key. Returns `null` when the record is absent/note-kind, the tx has no recorded fee, the
	 * receipt's block no longer matches the record's (reorg mid-flight — show nothing until the reconciler
	 * catches up), or the node lookup fails (page shows a dash).
	 */
	public async getReceiptFee(id: string): Promise<{ feeJuice: string } | null> {
		const epochAtStart = this.serviceEpoch
		const record = await this.getIncomingTransferById(id)
		if (record?.kind !== "public-event") return null
		// The reconciler rewrites `record.blockHash` on re-mine, so keying on it busts a stale cached fee.
		const cacheKey = `${record.networkId}|${record.txHash}|${record.blockHash}`
		const cached = this.feeCache.get(cacheKey)
		if (cached !== undefined) return { feeJuice: cached }
		try {
			const network = await this.networkService.getNetwork(record.networkId)
			// Pin the fetch to the RECORD's own endpoint (getNodeForUrl), NOT the active profile's chainId
			// node: a profile switch mid-call could otherwise route this tx hash to another profile's RPC
			// provider (a cross-profile leak) — the same footgun the pending-tx poller avoids. A malformed
			// network with no primary endpoint fails soft (dash) rather than falling back to that global node.
			const primary = network.endpoints?.find((e) => e.id === network.primaryEndpointId)
			if (!primary) return null
			const node = await this.networkService.getNodeForUrl(primary.rpcUrl)
			const receipt = await node.getTxReceipt(TxHash.fromString(record.txHash))
			const fee = receipt.transactionFee
			if (fee === undefined) return null
			// The receipt must belong to the block the record (and thus the page) names. Before the
			// reconciler rewrites a re-mined record, the receipt reflects the NEW block while the record
			// still names the OLD one — showing that fee would pair it with the wrong block on the page, so
			// return nothing until they agree.
			if (receipt.blockHash?.toString() !== record.blockHash) return null
			const feeJuice = fee.toString()
			// Skip the cache write if a purge/clear bumped the epoch while we were off-lock fetching — else a
			// concurrent clearChain/clearProfile that already wiped the cache would be silently repopulated.
			if (this.serviceEpoch === epochAtStart) this.feeCache.set(cacheKey, feeJuice)
			return { feeJuice }
		} catch (err) {
			this.logDebug(`getReceiptFee failed for ${record.txHash.slice(0, 10)}: ${getErrorMessage(err)}`)
			return null
		}
	}

	/** Current public-scan sync snapshot for `(networkId, contract)` — the token card's mount-time read.
	 *  The stored snapshot refreshes EVERY pass (not just on transitions), so reseeds see current lag.
	 *  `{ caught-up, 0 }` for an unknown/never-scanned key (fail toward "no indicator"). */
	public async getSyncState(networkId: string, contract: string): Promise<IncomingSyncSnapshot> {
		await this.ensureInitialized()
		return this.syncState.get(`${networkId}|${contract}`) ?? { state: "caught-up", blocksBehind: 0 }
	}

	/** Store the fresh `{state, blocksBehind}` snapshot EVERY pass, but emit only on a state transition
	 *  OR a threshold crossing (either direction) while backfilling — a steady poll re-deriving
	 *  `caught-up` every tick doesn't spam the popup, yet a long backfill can start/stop showing the
	 *  indicator mid-episode. Guarded by the scan's start-epoch: a purge/delete that bumped the epoch
	 *  mid-scan makes this emit obsolete — drop it so it can't repopulate state for a token being torn
	 *  down. */
	private emitSyncStateIfChanged(
		networkId: string,
		contract: string,
		state: IncomingSyncState,
		blocksBehind: number,
		epochAtStart: number,
	): void {
		if (this.serviceEpoch !== epochAtStart) return
		const key = `${networkId}|${contract}`
		const prev = this.syncState.get(key)
		this.syncState.set(key, { state, blocksBehind })
		const stateChanged = prev?.state !== state
		// Relational `>=` binds tighter than `!==`, so this compares the two BOOLEAN bucket values
		// (above/below threshold), not the raw numbers — i.e. "did the bucket flip?".
		const crossedThreshold =
			state === "backfilling" &&
			prev?.state === "backfilling" &&
			prev.blocksBehind >= BACKFILL_INDICATOR_THRESHOLD_BLOCKS !== blocksBehind >= BACKFILL_INDICATOR_THRESHOLD_BLOCKS
		if (!stateChanged && !crossedThreshold) return
		this.emit("onIncomingSyncStateChanged", { networkId, contract, state, blocksBehind })
	}

	/** The catching-up indicator's coverage datum: the highest block CONFIRMED contiguously covered.
	 *  During a reconciliation the repair window is open, so coverage drops to just below it. NOT the
	 *  event cursor (a quiet token's cursor sits at its last event forever) and NOT capped at finality
	 *  (see `lastCoveredBlock` in spec.ts). */
	private coveredBlock(cursor: PublicScanCursor): number {
		if (cursor.reconciling) return Math.max(0, cursor.reconciling.lowerBound - 1)
		return cursor.lastCoveredBlock ?? cursor.lastScanFinalized ?? cursor.startBlock
	}

	/** Advisory lag for the indicator: blocks between the checkpointed tip and confirmed coverage. */
	private lagBehind(tips: PublicScanTips, cursor: PublicScanCursor): number {
		return Math.max(0, tips.checkpointedBlockNumber - this.coveredBlock(cursor))
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
			// Bump the epoch FIRST (before any eviction or await): an off-lock getReceiptFee that started
			// before this clear must observe the change so its post-fetch cache write is skipped — otherwise
			// it could repopulate the cache during the repo-delete await, after we've evicted.
			this.bumpServiceEpoch()
			// The fee cache is keyed by networkId (not profileId), so a profile's networkIds aren't
			// recoverable here — clear it wholesale. It's tiny (only viewed public receipts) and a stale
			// entry is harmless anyway (its record is gone, so getReceiptFee returns null before the cache).
			this.feeCache.clear()
			// Sync-state is keyed by networkId too, so drop it all — a purged profile's tokens are gone, and
			// a stale entry would only mislead getSyncState (which fails toward caught-up anyway).
			this.syncState.clear()
			try {
				await this.repo.clearProfile(profileId)
				// Lock held across the wipe AND scheduler rebuild so a queued poll
				// can't fire between the two and repopulate state we just cleared
				// (codex R2 H1). hydrateSchedulers bumps serviceEpoch internally
				// so any in-flight scan whose snapshot predates this wipe bails.
				await this.hydrateSchedulers()
			} finally {
				// Re-clear AFTER hydration (in finally so it's absolute even if the wipe/rebuild threw): a
				// getReceiptFee that captured the post-first-bump epoch could have written an entry in the
				// window before hydrate's second bump. Its record is already gone (so the entry is
				// unreachable anyway), but sweep it to keep the map honest.
				this.feeCache.clear()
			}
		})
	}

	public async clearChain(profileId: string, networkId: string): Promise<void> {
		await this.ensureInitialized()
		await this.withServiceLock(async () => {
			// Bump the epoch FIRST (before eviction or any await) so an in-flight off-lock getReceiptFee
			// can't repopulate the cache after we evict — see clearProfile for the full rationale.
			this.bumpServiceEpoch()
			// Evict this network's fee-cache entries (keyed `${networkId}|…`) so a chain purge doesn't
			// leave them dangling for the worker's lifetime.
			const evict = () => {
				for (const key of this.feeCache.keys()) if (key.startsWith(`${networkId}|`)) this.feeCache.delete(key)
				for (const key of this.syncState.keys()) if (key.startsWith(`${networkId}|`)) this.syncState.delete(key)
			}
			evict()
			try {
				await this.repo.clearChain(profileId, networkId)
				await this.hydrateSchedulers()
			} finally {
				// Re-evict AFTER hydration (in finally so it's absolute even if the wipe/rebuild threw):
				// closes the window where a getReceiptFee holding the post-first-bump epoch wrote an
				// (already-unreachable) entry before hydrate's second bump. See clearProfile.
				evict()
			}
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
		const epochAtStart = this.serviceEpoch

		// Build the desired scheduler set OFF-MAP first — the live maps are NOT
		// touched until the single synchronous commit below, so a bail (a newer
		// hydrate/clear/add bumped the epoch) leaves the existing schedulers running
		// intact. Clearing at entry would strand them if this rebuild then bails.
		const profile = await this.profileService.getActiveProfile()
		// No active profile → the desired set is empty; still commit so a lock/logout
		// tears the schedulers down.
		const { noteDescriptors, publicDescriptors } = await this.buildSchedulerDescriptors(profile)

		// A concurrent hydrate/clear/token-add (each bumps the epoch) since our entry
		// owns the maps now — bail WITHOUT touching them: clearing would drop
		// schedulers the newer op is responsible for, and installing our stale set
		// would leak a poller under a dead profile/network/contract set.
		if (this.serviceEpoch !== epochAtStart) return

		this.commitSchedulers(noteDescriptors, publicDescriptors)
	}

	private async buildSchedulerDescriptors(profile: { id: string } | undefined): Promise<{
		noteDescriptors: { profileId: string; networkId: string; accountAddress: string; contracts: Set<string> }[]
		publicDescriptors: { profileId: string; networkId: string; contract: string }[]
	}> {
		const noteDescriptors: { profileId: string; networkId: string; accountAddress: string; contracts: Set<string> }[] = []
		const publicDescriptors: { profileId: string; networkId: string; contract: string }[] = []
		if (!profile) return { noteDescriptors, publicDescriptors }
		const networks = await this.networkService.getNetworks()
		const tokens = await this.tokenService.getTokensRaw(profile.id)
		for (const network of networks) {
			const tokensForNet = tokens.filter((t) => t.chainId === network.chainId)
			if (tokensForNet.length === 0) continue
			const accounts = await this.accountService.getAccounts(profile.id, network.chainId)
			const contracts = new Set(tokensForNet.map((t) => t.contract))
			for (const account of accounts) {
				noteDescriptors.push({
					profileId: profile.id,
					networkId: network.id,
					accountAddress: account.address,
					contracts: new Set(contracts),
				})
			}
			// Public arm: one scheduler per (networkId, contract) — serves every account.
			for (const contract of contracts) {
				publicDescriptors.push({ profileId: profile.id, networkId: network.id, contract })
			}
		}
		return { noteDescriptors, publicDescriptors }
	}

	/** COMMIT (synchronous, no awaits): atomically REPLACE — tear down the old set then
	 *  install the desired one. A bailed rebuild never reaches here. */
	private commitSchedulers(
		noteDescriptors: { profileId: string; networkId: string; accountAddress: string; contracts: Set<string> }[],
		publicDescriptors: { profileId: string; networkId: string; contract: string }[],
	): void {
		for (const id of this.schedulers.values()) clearInterval(id)
		this.schedulers.clear()
		this.watchedContracts.clear()
		for (const id of this.publicSchedulers.values()) clearInterval(id)
		this.publicSchedulers.clear()
		this.publicWatched.clear()
		for (const d of noteDescriptors) {
			this.watchedContracts.set(this.schedulerKey(d.networkId, d.accountAddress), d.contracts)
			this.startScheduler(d.profileId, d.networkId, d.accountAddress)
		}
		for (const d of publicDescriptors) {
			this.startPublicScheduler(d.profileId, d.networkId, d.contract)
		}
	}

	private startScheduler(profileId: string, networkId: string, accountAddress: string): void {
		const key = this.schedulerKey(networkId, accountAddress)
		if (this.schedulers.has(key)) return
		// The epoch this scheduler belongs to. A hydrate/clear bumps the epoch at its
		// entry but only tears the old intervals down at its COMMIT — so between the
		// two, an old interval can still fire. Bail its tick if the epoch has moved:
		// otherwise the scan it starts would capture the NEW epoch and commit stale
		// old-profile work under it.
		const bornAtEpoch = this.serviceEpoch
		const interval = setInterval(() => {
			if (this.serviceEpoch !== bornAtEpoch) return
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
		// Same creation-epoch fence as the note arm: an old interval firing during a
		// newer hydrate's construction window must not start a scan under the bumped epoch.
		const bornAtEpoch = this.serviceEpoch
		const interval = setInterval(() => {
			if (this.serviceEpoch !== bornAtEpoch) return
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
		// §3: the contract is no longer scanned (token removed / account gone) → drop its sync state so a
		// stale `backfilling` can't linger for the worker's lifetime.
		this.syncState.delete(key)
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
		// friction. Flip trust→trusted BEFORE the rebuild kicks scans, so the
		// first per-note CS reads trusted and persists records visible from the
		// start (instead of hidden+pending). Idempotent: skip when already trusted.
		await this.withServiceLock(async () => {
			const current = await this.repo.getTrust(profile.id, network.id, token.contract)
			if (current?.state === "trusted") return
			await this._setTrustStateLocked(profile.id, network.id, token.contract, "trusted")
		})

		// Rebuild the WHOLE scheduler set from the current token set rather than
		// incrementally grafting this one contract on. The token is already persisted,
		// so the rebuild includes it; and because every rebuild reads the live set and
		// hydrateSchedulers's epoch fence + atomic clear-then-install commit serialize
		// them, this can't drop a concurrently-added token or a token the rebuild it
		// races cleared (the lost updates a manual incremental install had).
		await this.hydrateSchedulers()
	}

	private onTokenDeleted = async (token: TokenDeleted): Promise<void> => {
		// Scope to the DELETED token's profile (finding C), NOT the active profile:
		// deleting an inactive profile's token must not wipe the ACTIVE profile's
		// incoming-transfer records + trust for a shared (chain, contract).
		const profileId = token.profileId
		const network = (await this.networkService.getNetworksRaw(profileId, token.chainId))[0]
		if (!network) return

		await this.withServiceLock(async () => {
			// Bump the epoch FIRST — before the scheduler teardown / sync-state eviction / any await — so an
			// in-flight off-lock scan holding the old epoch can't emit a sync state (or otherwise write) that
			// repopulates rows for the token we're deleting. (A late bump left a window: stopPublicScheduler
			// deletes the sync-state entry, then an old scan re-adds it before the bump.)
			this.bumpServiceEpoch()
			// Scheduler teardown + row mutations both inside the lock so a
			// concurrent scan can't slip a row in between teardown + wipe.
			await this.detachTokenSchedulersLocked(profileId, network, token.contract)
			// Public arm teardown: stop the stream + DELETE the cursor row (re-add re-indexes public
			// history from `startBlock`, preserving the note arm's remove/re-add parity) + drop the
			// cached class gate.
			this.stopPublicScheduler(network.id, token.contract)
			await this.repo.deleteCursor(profileId, network.id, token.contract)
			this.classGateCache.delete(`${profileId}|${network.id}|${token.contract}`)
			await this.wipeContractRecordsLocked(profileId, network.id, token.contract)
		})
	}

	/** Remove `contract` from every affected note scheduler; stop schedulers left empty.
	 *  Caller holds the service lock. */
	private async detachTokenSchedulersLocked(profileId: string, network: Network, contract: string): Promise<void> {
		const accounts = await this.accountService.getAccounts(profileId, network.chainId)
		for (const account of accounts) {
			const key = this.schedulerKey(network.id, account.address)
			const contracts = this.watchedContracts.get(key)
			if (!contracts) continue
			contracts.delete(contract)
			if (contracts.size === 0) {
				const interval = this.schedulers.get(key)
				if (interval) clearInterval(interval)
				this.schedulers.delete(key)
				this.watchedContracts.delete(key)
			}
		}
	}

	/** Records wipe + trust reset for a removed token. Re-add re-indexes via PXE with
	 *  identical blockTimestamps so activity-feed order is preserved. Caller holds the
	 *  service lock. */
	private async wipeContractRecordsLocked(profileId: string, networkId: string, contract: string): Promise<void> {
		const records = await this.repo.listByContract(profileId, networkId, contract)
		for (const record of records) {
			await this.repo.deleteRecord(record.id)
			this.emit("onIncomingTransferDeleted", record)
			// Purge the balance-outbox row for this (account, token) — the token is gone, so a
			// pending refresh would look up a missing balance (D4 stale-row safety).
			if (record.tokenId !== undefined) {
				await this.repo.deleteOutbox(profileId, networkId, record.accountAddress, record.tokenId)
			}
		}
		const trustRecord = await this.repo.getTrust(profileId, networkId, contract)
		if (trustRecord) {
			const updated = await this.repo.setTrust(profileId, networkId, contract, "unknown")
			this.emit("onIncomingTrustChanged", updated)
		}
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

		// E2E-only deterministic race lever (prod: `incomingPollGate` is undefined →
		// this is a no-op `?.`). Parks the scan AFTER PXE discovery and BEFORE the
		// locked commit — the exact in-flight window the account-switch isolation
		// test needs — and NEVER under `serviceLock`.
		const heldTxHash =
			(await this.incomingPollGate?.waitIfArmed({
				profileId,
				networkId,
				accountAddress,
				contract,
				txHashes: notes.map((n) => n.txHash),
			})) ?? null

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
			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 47) — refactor when touched, never raise
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
				const outgoingTxHashes = await this.collectOutgoingTxHashes(profileId, networkId, network.chainId, accountAddress)
				const inflightTxHashes = await this.collectInflightTxHashes(profileId, networkId, accountAddress)

				// Existing-record branch: backfill blockTimestamp if missing.
				const existing = await this.repo.getRecord(noteRecordId(profileId, networkId, note.siloedNullifier))
				if (existing) {
					if (existing.blockTimestamp === undefined) {
						const ts = await blockTimestampFor(note.l2BlockNumber)
						// The PXE-bound await above is the CS's park point: a lock
						// watchdog handoff there lets a destructive lifecycle bumper
						// (purge/delete) run to completion — writing after it would
						// resurrect what it wiped. Re-check before the write.
						if (this.serviceEpoch !== epochAtStart) return
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
				// Same park-point discipline as the backfill branch: nothing may be
				// written (outbox row, record, Added emit) after a mid-await epoch
				// move — the other awaits in this CS are fast storage/config reads,
				// and every DESTRUCTIVE bumper holds this lock, so the two PXE-bound
				// awaits are the only revocation windows that matter.
				if (this.serviceEpoch !== epochAtStart) return
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

		// Tell the test the parked scan's locked commit is done (the late emission,
		// if any, has fired) — its precondition before asserting cross-account isolation.
		if (heldTxHash) await this.incomingPollGate?.markCommitted(heldTxHash)
	}

	/** Visibility check used by both initial-load (`getIncomingTransfers`)
	 *  and live-event emit paths. **Fails CLOSED** (returns false) if the config
	 *  service is unreachable: the toggle is a privacy control, so a transient
	 *  port hiccup must NOT surface receives the user chose to hide. Records are
	 *  still persisted (hidden), so they reappear once visibility resolves —
	 *  fail-closed here suppresses only the EMISSION, never the data. */
	private async isVisibilityEnabled(): Promise<boolean> {
		try {
			return (await this.configService.getValue("incomingTransfersVisible")) !== false
		} catch {
			return false
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
		let network: Network
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
		checkpointHash: string | null,
		epochAtStart: number,
	): Promise<PublicTokenClassStatus> {
		// No checkpoint hash this tick → we can't pin the checkpointed class anchor, so fail closed
		// (the forward scan defers on the same condition). Never cache an unresolved.
		if (!checkpointHash) return "unresolved"
		// Cache by the finalized tip + the exact checkpoint HASH: the gate resolves the class at the
		// finalized AND checkpoint anchors (codex R3/R4 #7), so a checkpoint change — including a
		// SAME-HEIGHT reorg (a number-keyed cache would miss it) — must re-resolve, else a mid-cache
		// malicious upgrade at checkpointed would be served a stale "standard".
		const key = `${profileId}|${networkId}|${contract}`
		const cached = this.classGateCache.get(key)
		if (cached && cached.finalizedTip === finalizedTip && cached.checkpointHash === checkpointHash) return cached.status
		const status = await this.indexer.getClassStatus(networkId, contract, checkpointHash)
		// The one cache write in this file without an epoch guard would repopulate a
		// key the locked wipe just deleted (in-flight resolve outliving the reset).
		if (status !== "unresolved" && this.serviceEpoch === epochAtStart) {
			this.classGateCache.set(key, { finalizedTip, checkpointHash, status })
		}
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
		const inputs = await this.resolveScanInputs(networkId, contract)
		if (!inputs) return
		const { network, tips } = inputs

		const classStatus = await this.resolvePublicClassGate(
			profileId,
			networkId,
			contract,
			tips.finalizedBlockNumber,
			tips.checkpointedBlockHash,
			epochAtStart,
		)
		if (classStatus !== "standard") {
			// §3: a non-standard / unresolvable token is not scanned for public events → there's nothing to
			// catch up on. Clear any stale indicator (fail toward "no indicator").
			this.emitSyncStateIfChanged(networkId, contract, "caught-up", 0, epochAtStart)
			return // fail closed (non-standard / upgraded / unresolvable)
		}
		// `classStatus === "standard"` guarantees a non-null checkpoint hash (the gate fail-closes to
		// `unresolved` without one). Capture it: it anchors both the pending-page ancestry probe and the
		// forward scan.
		const checkpointHash = tips.checkpointedBlockHash
		if (!checkpointHash) return

		const cursor = (await this.repo.getCursor(profileId, networkId, contract)) ?? this.freshCursor(0)

		// Resume an in-progress reconciliation FIRST (crash / MV3-tick resume) — don't forward-scan
		// the same tick.
		if (cursor.reconciling) {
			// §3: actively reconciling = work in progress → still catching up. NB the caught-up flip comes
			// from the NEXT tick's forward scan (reconciliation rewinds the cursor, so coverage isn't
			// re-confirmed until then). Accepted narrow limitation: if reconciliation completes and the node
			// then fails PERSISTENTLY before that next scan, the indicator stays "catching up" until the node
			// recovers — the same node-down staleness we accept above, and honest (we can't confirm coverage).
			this.emitSyncStateIfChanged(networkId, contract, "backfilling", this.lagBehind(tips, cursor), epochAtStart)
			await this.stepReconciliation(profileId, networkId, contract, network.chainId, epochAtStart)
			return
		}

		// Resume a pending page (normal-scan record-before-cursor crash window, D3).
		if (cursor.pendingPage) {
			const reorged = await this.pendingPageReorged(networkId, contract, cursor.pendingPage, checkpointHash)
			if (reorged) {
				this.emitSyncStateIfChanged(networkId, contract, "backfilling", this.lagBehind(tips, cursor), epochAtStart)
				await this.beginReconciliation(profileId, networkId, contract, network.chainId, cursor, tips, epochAtStart)
				return
			}
			// Clean fork — clear the marker; the forward scan below re-fetches from the un-advanced
			// cursor and idempotently re-commits any records the crash may have already written.
			if (!(await this.persistCursorLocked(profileId, networkId, contract, { ...cursor, pendingPage: undefined }, epochAtStart)))
				return
		}

		try {
			// §3: emit from the pass's COVERAGE — reached the tip (`!hasMore && !dropped`) ⟹ caught up,
			// budget-incomplete / dropped / degraded ⟹ still backfilling. Independent of the last-event cursor.
			const pass = await this.forwardScanOnce(
				profileId,
				networkId,
				contract,
				network.chainId,
				{ ...cursor, pendingPage: undefined },
				tips,
				epochAtStart,
			)
			this.emitSyncStateIfChanged(
				networkId,
				contract,
				pass.reachedTip ? "caught-up" : "backfilling",
				Math.max(0, tips.checkpointedBlockNumber - pass.coveredBlock),
				epochAtStart,
			)
		} catch (err) {
			// A reorg throw / transient node error → we did NOT confirm coverage → still catching up.
			this.emitSyncStateIfChanged(networkId, contract, "backfilling", this.lagBehind(tips, cursor), epochAtStart)
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

	/** The scan tick's inputs, or `undefined` when either resolve fails (skip the tick).
	 *  A tips/RPC failure deliberately does NOT emit a sync state — it can't confirm
	 *  coverage: flipping to caught-up on a transient blip would wrongly clear the
	 *  indicator mid-backfill, and a persistent failure means the node is down
	 *  (everything is stale, not just this contract). */
	private async resolveScanInputs(networkId: string, contract: string): Promise<{ network: Network; tips: PublicScanTips } | undefined> {
		let network: Network
		try {
			network = await this.networkService.getNetwork(networkId)
		} catch (error) {
			this.logWarn(`scanPublicContract: network resolve failed: ${getErrorMessage(error)}`)
			return undefined
		}
		try {
			return { network, tips: await this.indexer.getTips(networkId) }
		} catch (error) {
			this.logWarn(`public tips failed for ${contract}: ${getErrorMessage(error)}`)
			return undefined
		}
	}

	/** One budgeted forward-scan batch. Persists `pendingPage` before record writes and advances the
	 *  cursor after; the finalized watermark advances on every tick (even empty ones). Returns whether the
	 *  pass REACHED THE TIP (`!hasMore && !dropped`) — the §3 sync signal (a complete pass covered the
	 *  whole `(cursor, checkpointed]` window, so it's caught up; a budget-incomplete/dropped/degraded pass
	 *  is still backfilling) — plus the pass's confirmed `coveredBlock` (the indicator's lag datum,
	 *  monotonic, persisted as `lastCoveredBlock`). Coverage, NOT the last-event cursor position — a quiet
	 *  token with no events still reaches the tip on its empty-EOF pass. */
	private async forwardScanOnce(
		profileId: string,
		networkId: string,
		contract: string,
		chainId: number,
		cursor: PublicScanCursor,
		tips: PublicScanTips,
		epochAtStart: number,
	): Promise<{ reachedTip: boolean; coveredBlock: number }> {
		// A public scan REQUIRES the checkpoint fork hash: it is the reorg anchor every page pins, the
		// frame the boundary-ancestry proof is rooted in, AND the committed-fork anchor we persist.
		// Without it (a degraded tick where `getBlockData("checkpointed")` failed) we cannot scan
		// safely — DEFER (advance only the finalized watermark) and retry next tick (codex R4 #1).
		// Fail-slow beats a blind fork splice.
		if (!tips.checkpointedBlockHash) {
			await this.persistCursorLocked(
				profileId,
				networkId,
				contract,
				{ ...cursor, lastScanFinalized: tips.finalizedBlockNumber },
				epochAtStart,
			)
			// Degraded tick — could not scan → not confirmed caught up; coverage unchanged.
			return { reachedTip: false, coveredBlock: this.coveredBlock(cursor) }
		}
		const checkpointHash = tips.checkpointedBlockHash

		// BOUNDARY ancestry (codex R3 #1): prove the last-committed block is an ANCESTOR of the
		// checkpoint we're scanning toward, via ONE atomic archive-membership query rooted at
		// `checkpointHash`. A non-member throws → reconcile. (Two independent "canonical now" probes
		// can't establish ancestry across a flapping/lying node.)
		if (cursor.cursor !== null && cursor.lastSyncedBlockHash) {
			await this.indexer.probe(networkId, contract, {
				referenceBlock: checkpointHash,
				verifyAncestorHash: cursor.lastSyncedBlockHash,
			})
		}
		// IN-RANGE: pin EVERY page to the checkpoint FORK HASH so a mid-scan reorg makes the offending
		// page throw immediately (defeats even a transient A→B→A excursion — the B page can't validate
		// against H_A).
		const result = await this.indexer.scan(networkId, contract, {
			fromBlock: cursor.cursor === null ? cursor.startBlock : undefined,
			toBlock: tips.checkpointedBlockNumber,
			afterCursor: cursor.cursor,
			referenceBlock: checkpointHash,
		})

		// §3: a complete pass (not budget-limited, not dropped) covered the whole window up to the pinned
		// checkpoint — caught up. This is COVERAGE, independent of whether any events landed.
		const reachedTip = !result.hasMore && !result.dropped

		const watermark = this.finalizedWatermark(cursor, result, tips)
		// The indicator's coverage datum — same shape as `finalizedWatermark` but UNcapped by finality
		// (a finality-capped seed would fake a `checkpointed − finalized` backlog after a restart).
		// Monotonic: a dropped/degraded pass confirms nothing and keeps the prior value.
		const priorCovered = this.coveredBlock(cursor)
		const coveredBlock = reachedTip
			? Math.max(priorCovered, tips.checkpointedBlockNumber)
			: result.scannedThrough && !result.dropped
				? Math.max(priorCovered, result.scannedThrough.blockNumber - 1)
				: priorCovered

		if (result.scannedThrough === null) {
			// Nothing new (empty EOF) OR a dropped/suspect page — advance the finalized rewind floor, but
			// only as far as we CONTIGUOUSLY scanned (a dropped page scanned nothing, so the floor stays
			// at the cursor — codex R5 A1). No records are touched.
			await this.persistCursorLocked(
				profileId,
				networkId,
				contract,
				{ ...cursor, lastScanFinalized: watermark, lastCoveredBlock: coveredBlock },
				epochAtStart,
			)
			return { reachedTip, coveredBlock }
		}

		const recipients = await this.recipientsFor(profileId, chainId)
		const matching = this.indexer.filterToRecipients(result.events, recipients)
		// Anchor the committed fork on the PINNED CHECKPOINT HASH — NOT the last decoded event's block
		// hash. `scannedThrough` advances past malformed/skipped tail logs while a decoded-events hash
		// would lag it; anchoring on the checkpoint (which every page validated against) keeps the
		// persisted anchor in lock-step with the scanned frame, so the next tick's ancestry proof can't
		// validate a stale sub-cursor block and miss a reorg above it (codex R4 #1).
		const nextSyncedHash = checkpointHash

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
					lastScanFinalized: watermark,
					lastCoveredBlock: coveredBlock,
				},
				epochAtStart,
			)
			return { reachedTip, coveredBlock }
		}

		// Records to write → persist `pendingPage` BEFORE the writes (D3 crash window). Its fork anchor
		// is the pinned checkpoint hash (same rationale as `nextSyncedHash` — never a decoded-events hash).
		const withPending: PublicScanCursor = {
			...cursor,
			pendingPage: { fromCursor: cursor.cursor, toScannedThrough: result.scannedThrough, upperHash: checkpointHash },
		}
		if (!(await this.persistCursorLocked(profileId, networkId, contract, withPending, epochAtStart)))
			return { reachedTip: false, coveredBlock: priorCovered }

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
				lastScanFinalized: watermark,
				lastCoveredBlock: coveredBlock,
				pendingPage: undefined,
			},
			epochAtStart,
		)
		return { reachedTip, coveredBlock }
	}

	/** The finalized rewind floor to persist: `min(finalized, the highest block CONTIGUOUSLY scanned
	 *  this tick)`. A budget-INCOMPLETE (`hasMore`) or validator-DROPPED scan did not reach the pinned
	 *  `checkpointed`, so the floor must not outrun the cursor — else a later reconcile
	 *  `[floor+1..checkpointed]` would jump the cursor past the unscanned gap and permanently skip its
	 *  logs (codex R5 A1). Crucially a budget-limited scan stops MID-block, so the last FULLY-scanned
	 *  block is `scannedThrough.blockNumber - 1`, not `.blockNumber` (the tail of that block may hold
	 *  more logs beyond the budget — codex R6 A1). A COMPLETE scan (`hasMore` false, not dropped)
	 *  covered the whole `(cursor, checkpointed]` window, so the floor may reach `finalized`. A DROPPED
	 *  scan confirmed nothing new → the floor stays where it was. The floor is monotonic (`finalized`
	 *  only advances), so we never regress below the persisted value. */
	private finalizedWatermark(cursor: PublicScanCursor, result: PublicScanResult, tips: PublicScanTips): number {
		const oldFloor = cursor.lastScanFinalized ?? -1
		const fullyScanned = result.dropped
			? Number.NEGATIVE_INFINITY // suspect page — confirmed nothing new this tick
			: result.hasMore && result.scannedThrough
				? result.scannedThrough.blockNumber - 1 // stopped MID-block; that block is only partial
				: tips.checkpointedBlockNumber // reached the pinned checkpoint (empty tail or full window)
		return Math.max(oldFloor, Math.min(tips.finalizedBlockNumber, fullyScanned))
	}

	/** Probe whether a pending page's fork survived (D3): an ATOMIC ancestry proof that
	 *  `pendingPage.upperHash` is still in the archive rooted at the CURRENT checkpoint hash. A throw
	 *  (non-member / gone) ⇒ the fork was reorged out. Uses the membership witness — NOT a standalone
	 *  canonicity probe — so a flapping/lying node can't momentarily expose the old fork here and the
	 *  new one during the forward scan (codex R5 A2). */
	private async pendingPageReorged(
		networkId: string,
		contract: string,
		pendingPage: NonNullable<PublicScanCursor["pendingPage"]>,
		checkpointHash: string,
	): Promise<boolean> {
		try {
			await this.indexer.probe(networkId, contract, {
				referenceBlock: checkpointHash,
				verifyAncestorHash: pendingPage.upperHash,
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
				if (!orphanedByReconciliation(record, marker, canonicalByHeight)) continue
				// Enqueue the balance refresh BEFORE deleting (delete-first would lose the refresh on MV3
				// suspension), never driven by the recipient filter.
				if (record.tokenId !== undefined) await this.markBalanceDirty(profileId, networkId, record.accountAddress, record.tokenId)
				await this.repo.deleteRecord(record.id)
				this.emit("onIncomingTransferDeleted", record)
			}
		})

		// Clear the marker + advance the anchor to `upperBoundHash` so the next forward scan doesn't
		// re-throw on a stale referenceBlock (which would loop reconciliation).
		const cursorRow = await this.repo.getCursor(profileId, networkId, contract)
		if (cursorRow) {
			// If the cursor sits ABOVE the reconciled checkpoint (a rollback stranded it) and reconcile
			// found nothing to resume from, reset it to `null` so the next forward scan re-covers from
			// `startBlock` as the checkpoint re-advances — otherwise it would forever query the empty
			// `(oldCursor, newCheckpoint]` backwards range and the deleted rollback rows never re-index
			// (codex R6). A full re-scan is heavy but rollbacks are rare + commits are idempotent.
			const strandedAboveCheckpoint = cursorRow.cursor !== null && cursorRow.cursor.blockNumber > marker.upperBound
			const nextCursor = reconciledThrough ?? (strandedAboveCheckpoint ? null : cursorRow.cursor)
			await this.persistCursorLocked(
				profileId,
				networkId,
				contract,
				{
					...cursorRow,
					reconciling: undefined,
					cursor: nextCursor,
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
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 35) — refactor when touched, never raise
		await this.withServiceLock(async () => {
			if (this.serviceEpoch !== epochAtStart) return
			const tokens = await this.tokenService.getTokensRaw(profileId)
			// Every awaited read in this CS can park across a watchdog handoff that
			// admits a wipe (clearProfile/onTokenDeleted bump + purge); re-check the
			// epoch after each read block, before any write — the note arm's own
			// post-park discipline, which this newer arm originally lacked.
			if (this.serviceEpoch !== epochAtStart) return
			const token = tokens.find((t) => t.contract === contract && t.chainId === chainId)
			if (!token) return // token removed concurrently

			const id = publicRecordId(profileId, networkId, ev.txHash, ev.logIndexWithinTx)
			const existing = await this.repo.getRecord(id)
			if (this.serviceEpoch !== epochAtStart) return
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
			const outgoing = await this.collectOutgoingTxHashes(profileId, networkId, chainId, account)
			if (outgoing.has(ev.txHash)) return
			const inflight = await this.collectInflightTxHashes(profileId, networkId, account)
			if (inflight.has(ev.txHash)) return
			if (this.serviceEpoch !== epochAtStart) return

			let trustState = (await this.repo.getTrust(profileId, networkId, contract))?.state ?? "unknown"
			if (this.serviceEpoch !== epochAtStart) return
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
			if (this.serviceEpoch !== epochAtStart) return

			// D4 write-side: the outbox row is written BEFORE the record (ordering + idempotent replay
			// substitute for a multi-key transaction). Trust-independent — a hidden receipt still
			// changed the chain balance.
			await this.markBalanceDirty(profileId, networkId, account, token.id)
			// A wipe admitted during the dirty-mark's await must not land the record
			// AFTER the purge enumerated rows; aborting here leaves dirty-without-
			// record, which D4's ordering already tolerates (the drain heals it).
			if (this.serviceEpoch !== epochAtStart) return
			const record = this.buildPublicRecord({ ev, profileId, networkId, account, token, trustState })
			await this.repo.upsertRecord(record)
			if (trustState === "trusted" && (await this.isVisibilityEnabled()) && this.serviceEpoch === epochAtStart) {
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
			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 47) — refactor when touched, never raise
			await this.withServiceLock(async (isCurrent) => {
				const current = await this.repo.getOutbox(profileId, networkId, accountAddress, tokenId)
				if (!current) return
				// Every write below is guarded by `isCurrent()`: a watchdog handoff
				// admits a receipt writer whose fresher dirtyAt this displaced section
				// must not clobber (an anchor overwrite here launders the new receipt
				// into a PRE-receipt task's causality; the next drain's success-delete
				// then drops the sole refresh marker — permanent until an unrelated
				// refresh). The ticket flips on ANY successor acquisition, so a
				// displaced drain stands down at the first write.
				if (current.pendingTaskId) {
					const state = this.readTaskState(current.pendingTaskId)
					if (state === "success") {
						if (!isCurrent()) return
						await this.repo.deleteOutbox(profileId, networkId, accountAddress, tokenId)
					} else if (state === "failure" || state === "missing") {
						if (!isCurrent()) return
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
					if (!isCurrent()) return
					await this.repo.deleteOutbox(profileId, networkId, accountAddress, tokenId)
					return
				}
				if ("taskId" in result) {
					// Re-read at commit: a wipe (row gone) or a fresh markBalanceDirty bump
					// (dirtyAt moved) during the refresh await must not be overwritten with
					// this older snapshot — stand down and let the next drain see the row's
					// new state. Writing anyway would anchor stale dirt to the minted task.
					// The receipt writer can only interleave by ACQUIRING the lock (a
					// watchdog handoff), which flips the ticket — so the `isCurrent()`
					// check below is a true guard, not a smaller race window: either the
					// receipt landed before it (ticket flipped → stand down) or its write
					// is dispatched after this set and last-writer-wins is the receipt.
					const fresh = await this.repo.getOutbox(profileId, networkId, accountAddress, tokenId)
					if (!fresh || fresh.dirtyAt !== current.dirtyAt) return
					if (!isCurrent()) return
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

	private async collectOutgoingTxHashes(
		profileId: string,
		networkId: string,
		chainId: number,
		accountAddress: string,
	): Promise<Set<string>> {
		try {
			// Positive scope match only: `getTransactions` is address-wide, and two
			// same-seed profiles (or two networks on one chainId) share addresses.
			// A foreign profile's outgoing must NOT suppress this scope's incoming —
			// same-seed activity from another silo deliberately surfaces as incoming
			// (see the visibility escape hatch in `getIncomingTransfers`), exactly
			// like another device's outgoing does.
			const txs = await this.transactionService.getTransactions(accountAddress)
			return new Set(
				txs.filter((t) => t.profileId === profileId && t.networkId === networkId && t.chainId === chainId).map((t) => t.hash),
			)
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

/** Is this record deleted by a finished reconciliation? Records below `lowerBound` —
 *  therefore at or below the finalized floor — are never touched. A record ABOVE the reconciled checkpoint
 *  (`upperBound`) is stale unconditionally: Aztec prunes the checkpointed tip back to the
 *  proven tip, so a rollback (old checkpoint 100 → new 90) leaves records at 91–100 no
 *  longer checkpointed and possibly on a pruned fork — the forward scan re-indexes them if
 *  the checkpoint re-advances. Within the window, only a blockHash mismatch (a reversed
 *  receipt) deletes. */
export function orphanedByReconciliation(
	record: IncomingTransferRecord,
	marker: { lowerBound: number; upperBound: number },
	canonicalByHeight: Map<number, string>,
): boolean {
	if (record.kind !== "public-event") return false
	if (record.l2BlockNumber < marker.lowerBound) return false
	const aboveCheckpoint = record.l2BlockNumber > marker.upperBound
	if (!aboveCheckpoint && canonicalByHeight.get(record.l2BlockNumber) === record.blockHash) return false
	return true
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
