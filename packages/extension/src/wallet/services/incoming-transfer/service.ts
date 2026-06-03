import type { ILogger } from "@/wallet/logger"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service } from "@nulo/extension-messaging/background"
import { EventHandler, getErrorMessage } from "@nulo/wallet-core/utils"
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

	private readonly pollIntervalMs: number

	public constructor(logger: ILogger, pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS) {
		super(INCOMING_TRANSFER_SERVICE_NAME, logger)
		this.pollIntervalMs = pollIntervalMs
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
		let networks: Network[]
		try {
			networks = await this.networkService.getNetworks(account.chainId)
		} catch (error) {
			this.logWarn(`onAccountDeleted: failed to resolve networks: ${getErrorMessage(error)}`)
			return
		}
		for (const network of networks) {
			const key = this.schedulerKey(network.id, account.address)
			const interval = this.schedulers.get(key)
			if (interval) clearInterval(interval)
			this.schedulers.delete(key)
			this.watchedContracts.delete(key)
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

	public async setTrustState(profileId: string, networkId: string, contract: string, state: IncomingTrustState): Promise<void> {
		await this.ensureInitialized()
		const record = await this.repo.setTrust(profileId, networkId, contract, state)
		this.emit("onIncomingTrustChanged", record)
	}

	public async setTrustAllow(profileId: string, networkId: string, contract: string): Promise<void> {
		await this.setTrustState(profileId, networkId, contract, "trusted")
		// Flip every hidden record for this contract to visible; emit Added
		// for each so the popup activity feed updates atomically.
		// Visibility gate (codex post-impl followup): if `incomingTransfersVisible`
		// is off, persist the records as visible (so a future toggle-on shows
		// them) but DO NOT emit live events that would surface rows on an
		// already-mounted page where the user has opted out.
		const visibilityEnabled = await this.isVisibilityEnabled()
		const records = await this.repo.listByContract(profileId, networkId, contract)
		for (const record of records) {
			if (!record.hidden) continue
			const updated = { ...record, hidden: false }
			await this.repo.upsertRecord(updated)
			if (visibilityEnabled) {
				this.emit("onIncomingTransferAdded", updated)
			}
		}
	}

	public async setTrustReject(profileId: string, networkId: string, contract: string): Promise<void> {
		await this.setTrustState(profileId, networkId, contract, "blocked")
		// Hidden records stay hidden. No event emission — silent rejection.
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

	/** Rebuild the scheduler set from current tokens + active accounts. */
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
		let notes: RawNote[]
		try {
			notes = await this.noteService.getNotesRaw(networkId, accountAddress, contract)
		} catch (error) {
			this.logWarn(`getNotesRaw failed: ${getErrorMessage(error)}`)
			return
		}

		const network = await this.networkService.getNetwork(networkId)
		const tokens = await this.tokenService.getTokensRaw(profileId)
		const token = tokens.find((t) => t.contract === contract && t.chainId === network.chainId)
		// Token-removed: don't surface anything for a contract the user has
		// since removed.
		if (!token) return

		const outgoingTxHashes = await this.collectOutgoingTxHashes(network.chainId, accountAddress)
		const inflightTxHashes = await this.collectInflightTxHashes(profileId, networkId, accountAddress)
		let trustState = await this.getTrustState(profileId, networkId, contract)

		for (const note of notes) {
			if (!note.siloedNullifier) continue
			if (await this.repo.hasRecord(note.siloedNullifier)) continue
			if (outgoingTxHashes.has(note.txHash)) continue
			if (inflightTxHashes.has(note.txHash)) continue
			const amountRaw = parseNoteAmount(note)
			if (amountRaw === null) continue

			// First-receive policy: transition unknown → pending and emit a
			// pending event so the popup can prompt the user for Allow/Reject.
			// While pending, the record is persisted hidden — `setTrustAllow`
			// flips queued records visible atomically, `setTrustReject`
			// keeps them hidden permanently.
			//
			// Visibility gate (codex post-impl audit C2): the EMIT must
			// respect `incomingTransfersVisible`. Without this, an OFF toggle
			// suppresses initial-load + Added events but the Pending prompt
			// still pops on first receive — leaking that a contract was
			// touched. The trust transition + record persistence still happen
			// so a toggle-on later can replay via `replayPendingPrompts`.
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

			const record = this.buildRecord({ note, profileId, networkId, accountAddress, token, amountRaw, trustState })
			await this.repo.upsertRecord(record)

			if (trustState === "trusted") {
				// Live-event gate: respect the `incomingTransfersVisible`
				// settings toggle on the EMIT path too. Without this, the
				// initial-load gate in `getIncomingTransfers` would block
				// already-mounted pages from showing the row, but live
				// updates would slip past and surface anyway (codex post-
				// impl audit critical).
				if (await this.isVisibilityEnabled()) {
					this.emit("onIncomingTransferAdded", record)
				}
			}
			// pending / blocked: record persisted hidden, no event emit-Added.
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
		const tokens = await this.tokenService.getTokensRaw(profileId)
		let network
		try {
			network = await this.networkService.getNetwork(networkId)
		} catch {
			return
		}
		for (const trust of pending) {
			const scoped = (await this.repo.listByContract(profileId, networkId, trust.contract)).filter(
				(r) => r.accountAddress === accountAddress,
			)
			if (scoped.length === 0) continue
			const token = tokens.find((t) => t.contract === trust.contract && t.chainId === network.chainId)
			if (!token) continue
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
	}): IncomingTransferRecord {
		const { note, profileId, networkId, accountAddress, token, amountRaw, trustState } = params
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
