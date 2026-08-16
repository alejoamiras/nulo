import { TxHash, TxStatus as AztecTxStatus, TxExecutionResult as AztecTxExecutionResult } from "@aztec/stdlib/tx"
import { toRestoreError } from "@/utils/restore-error"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import type { ILogger } from "@/wallet/logger"
import { AccountService, type Account } from "@/wallet/services/account/service"
import { NetworkService } from "@/wallet/services/network/service"
import { ProfileService } from "@/wallet/services/profile/service"
import type { ExecutionFence, ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { StepContent, type WrappedTask } from "@/wallet/services/task/service"
import { purgeRows } from "@/wallet/services/purge-rows"
import { EntityStorage } from "@/wallet/storage"
import { Lock, sleep } from "@/wallet/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import {
	type Tx,
	type TxGasDetails,
	TRANSACTION_SERVICE_NAME,
	TRANSACTION_STORAGE_ROOT,
	type LocalTxOrigin,
	type TxCall,
	TxStatus,
	TxExecutionResult,
	type Methods,
	type Events,
	TxSchema,
} from "./spec"
import type { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"

export * from "./spec"

/**
 * DROPPED-receipt debounce. The node answers DROPPED for any tx hash it does
 * not know — including a just-submitted tx that hasn't reached the queried
 * replica yet, so behind a load-balanced RPC the submitting `sendTx` and the
 * receipt poll can hit different nodes and a healthy tx transiently reads as
 * dropped (aztec.js guards its own `waitForTx` against exactly this via
 * `ignoreDroppedReceiptsFor`). A DROPPED answer is therefore only accepted as
 * terminal once the tx is older than the grace window AND was seen dropped on
 * enough consecutive polls. Observations made DURING the grace window count
 * toward the streak on purpose: a tx that read dropped consistently for the
 * whole window finalizes right at the boundary — the sustained window itself
 * is the evidence, not three post-window ticks.
 */
export const DROPPED_GRACE_MS = 60_000
export const DROPPED_CONFIRMATIONS = 3
/** After a tx IS marked Dropped, keep re-checking it at a slow cadence for this
 *  long — a late mine (the receipt turning up mined after all) resurrects the
 *  row instead of leaving a confirmed tx labeled failed forever. */
export const DROPPED_RESURRECTION_WINDOW_MS = 30 * 60_000
export const DROPPED_RECHECK_INTERVAL_MS = 15_000

export class TransactionService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()("getTransactions", "getTransaction")
	public static name = TRANSACTION_SERVICE_NAME

	public readonly onTransactionAdded = new EventHandler<Tx>()
	public readonly onTransactionUpdated = new EventHandler<Tx>()
	public readonly onTransactionDeleted = new EventHandler<Tx>()

	private readonly txs: EntityStorage<Tx>
	private readonly pending = new Map<string, Tx>()
	// Consecutive-DROPPED counter per pending hash. In-memory on purpose: a SW
	// restart resets the streak, which only makes the debounce MORE conservative.
	private readonly droppedStreaks = new Map<string, number>()
	// Resurrection watch: txs marked Dropped THIS session, re-checked at a slow
	// cadence until the window expires. Deliberately never re-armed from storage
	// on init — same reasoning as D16 in `restore`: a restored/aged row's
	// `submittedEndpointUrl` must not get the sync worker dialing it again.
	private readonly droppedWatch = new Map<string, Tx>()
	private readonly droppedNextCheckAt = new Map<string, number>()
	// Serializes restore's read-modify-write (contains → set) so two concurrent
	// imports can't both pass the create-only check for the same hash.
	private readonly lock = new Lock()

	private profileService: ProfileService = null!
	private accountService: AccountService = null!
	private networkService: NetworkService = null!
	private deletionState: ProfileDeletionState = null!

	public constructor(logger: ILogger, browserApi: BrowserApi) {
		super(TRANSACTION_SERVICE_NAME, logger)
		this.txs = new EntityStorage<Tx>(TRANSACTION_STORAGE_ROOT, browserApi.storage.local, (raw) => TxSchema.parse(raw))
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		this.accountService = services.get(AccountService.name)
		this.networkService = services.get(NetworkService.name)
		// The SHARED deletion state — addTransaction asserts an execution's captured
		// epoch is still current before writing (D13).
		this.deletionState = this.profileService.getDeletionState()

		// Tx cleanup on network/profile deletion flows through `onAccountDeleted`
		// ONLY — it is account-scoped (= profile-accurate). A chain-purge
		// subscriber that filtered by chainId alone was REMOVED: it over-purged
		// EVERY profile's txs on a shared chain (tx rows carry no profileId), and
		// it was redundant — `NetworkService.purgeChain` already cascades account
		// deletion via `AccountService`'s own chain-purge subscriber, which emits
		// `onAccountDeleted` per account. See implementations-plan/
		// backup-restore-corruption-fix (P1).
		//
		// This `onAccountDeleted` sub stays for the standalone `deleteNetwork`
		// chain-purge path (best-effort). PROFILE deletion no longer relies on it:
		// the ProfileDeletionCoordinator now calls the AWAITED `purgeForAccounts`
		// directly with the tombstone's address snapshot, and the worker's write is
		// fenced (see `updateTx`) so a mid-poll tx can't resurrect (finding D).
		this.accountService.onAccountDeleted.add(this.onAccountDeleted)

		// Only Pending rows are re-armed. Dropped rows are NOT added to the
		// resurrection watch across restarts: rows can enter storage via backup
		// restore, and their `submittedEndpointUrl` is backup-controlled — the
		// worker must never dial it for a row this session didn't transition
		// itself (D16 parity; see `restore`).
		for (const tx of (await this.txs.getValues()).filter((x) => x.status === TxStatus.Pending && !x.ambiguous)) {
			// `ambiguous` rows are excluded here too, not just when they are marked:
			// otherwise a restart puts them straight back into the poller, against
			// whichever profile is now active.
			this.pending.set(tx.hash, tx)
		}

		this.runWorker()
	}

	public async getTransactions(account: string): Promise<Tx[]> {
		return (await this.txs.getValues()).filter((x) => x.account === account)
	}

	public async getTransaction(hash: string): Promise<Tx> {
		const tx = await this.txs.get(hash)
		if (!tx) {
			throw new Error("unknown hash")
		}
		return tx
	}

	/** Synchronous read of in-memory pending txs for an account. Used by
	 *  the fee-estimate-reuse cache to detect that a new pending tx
	 *  appeared between estimate and confirm — that's a signal to
	 *  rebuild rather than reuse, since concurrent in-flight private
	 *  transfers can consume the same notes. */
	public getPendingForAccount(account: string): Tx[] {
		const out: Tx[] = []
		for (const tx of this.pending.values()) {
			if (tx.account === account) out.push(tx)
		}
		return out
	}

	public async addTransaction(
		origin: LocalTxOrigin,
		chainId: number,
		account: string,
		calls: TxCall[],
		nonce: string,
		feePaymentMethod: AccountFeePaymentMethodOptions,
		hash: string,
		submittedEndpointUrl: string | undefined,
		estimatedFee?: string,
		gasDetails?: TxGasDetails,
		fence?: ExecutionFence,
		/** Owning network row id. Together with the fence's profile this is the
		 *  row's activity scope — without it, two profiles holding the same
		 *  address on one chain are indistinguishable in history. */
		networkId?: string,
	): Promise<Tx> {
		// Under the tx lock (codex blocker): serialize the dup-check + write against
		// restore's create-only check + the coordinator's purge (finding D).
		return await this.lock.withLock(async () => {
			// D13: an execution captured {profileId, epoch} when it was authorized.
			// If a deletion of that profile has since begun (epoch advanced) OR the
			// owning account row is already purged/re-owned, reject — a completing
			// prove must not recreate a pending tx after its profile was deleted.
			// Both checks are bound to the CAPTURED profileId: a successor that reused
			// the deterministic address owns a DIFFERENT profileId, so getAccount
			// returns undefined here even after the epoch is released.
			if (fence) {
				this.deletionState.assertCurrent(fence.profileId, fence.epoch)
				const owner = await this.accountService.getAccount(fence.profileId, chainId, account)
				if (!owner) throw new Error("stale execution owner — account no longer exists")
			}
			if (await this.txs.get(hash)) {
				throw new Error("duplicated hash")
			}
			const now = Date.now()
			// `submittedEndpointUrl` is resolved by the EXECUTOR from the network it
			// actually built+submitted against (captured before prove/send), then
			// passed in. It is NOT re-derived here from active-profile state: a TTL
			// auto-lock or profile switch DURING the (slow) prove would make an
			// active-profile lookup throw or resolve the wrong profile's endpoint,
			// recording a wrong/undefined URL — which at poll time routes the receipt
			// fetch to the active profile's RPC (a cross-profile leak). See
			// `NetworkService.getNodeForUrl`.
			const tx: Tx = {
				origin,
				chainId,
				profileId: fence?.profileId,
				networkId,
				account,
				calls,
				nonce,
				feePaymentMethod,
				hash,
				createdAt: now,
				updatedAt: now,
				status: TxStatus.Pending,
				estimatedFee,
				gasDetails,
				submittedEndpointUrl,
			}
			await this.txs.set(tx.hash, tx)
			this.emit("onTransactionAdded", tx)
			this.pending.set(tx.hash, tx)
			return tx
		})
	}

	public async waitForTx(txHash: string, parentTask?: WrappedTask) {
		const waitForTxTask = parentTask?.startSubtask(new StepContent("Waiting for transaction"))
		while (this.pending.has(txHash)) {
			await sleep(100)
		}
		waitForTxTask?.complete()
	}

	private readonly onAccountDeleted = async (account: Account) => {
		await this.purgeForAccounts([account.address], account.profileId)
	}

	/**
	 * Whether `profileId` is the only profile holding any of `addresses`.
	 *
	 * Decides the fate of rows written before transactions carried a profile:
	 * with a single owner they are unambiguously this profile's, so deletion is
	 * safe; with more than one they could belong to either, and removing them
	 * would destroy the surviving profile's history.
	 */
	private async isSoleOwner(addresses: readonly string[], profileId: string): Promise<boolean> {
		const owners = new Set<string>()
		for (const address of addresses) {
			for (const account of await this.accountService.getAccountsByAddress(address)) {
				owners.add(account.profileId)
			}
		}
		owners.delete(profileId)
		return owners.size === 0
	}

	/** Awaited tx purge for a SET of accounts — called by the deletion coordinator
	 *  with the tombstone's authoritative address snapshot (finding D). Runs under
	 *  the tx lock; idempotent. `onAccountDeleted` delegates here so the single-
	 *  account (deleteNetwork chain-purge) path shares one implementation. */
	public async purgeForAccounts(addresses: readonly string[], profileId?: string): Promise<void> {
		await this.ensureInitialized()
		const set = new Set(addresses)
		await this.lock.withLock(async () => {
			// Two profiles built from one mnemonic own the same address, so an
			// address-only match deletes the OTHER profile's history too. When the
			// caller knows whose rows these are, a scoped row must match that
			// profile; a row that names no profile is only safe to remove when this
			// is the address's sole owner, and is otherwise left alone.
			const soleOwner = profileId !== undefined ? await this.isSoleOwner(addresses, profileId) : true
			const all = await this.txs.getValues()
			const txs = all.filter((x) => {
				if (!set.has(x.account)) return false
				if (profileId === undefined) return true
				if (x.profileId !== undefined) return x.profileId === profileId
				return soleOwner
			})
			// An unscoped row shared with another profile is neither deleted (that
			// would destroy the survivor's history) nor left plain, since deleting
			// this profile makes the survivor the only owner and the row would
			// silently become theirs. Mark it instead, permanently.
			if (profileId !== undefined && !soleOwner) {
				for (const tx of all) {
					if (!set.has(tx.account) || tx.profileId !== undefined || tx.ambiguous) continue
					this.pending.delete(tx.hash)
					// A marked row must also leave the dropped-resurrection state:
					// leaving it in `droppedWatch` would keep polling it AND let a
					// late-mine write (built from the pre-mark in-memory object)
					// silently erase the `ambiguous` flag.
					this.droppedStreaks.delete(tx.hash)
					this.droppedWatch.delete(tx.hash)
					this.droppedNextCheckAt.delete(tx.hash)
					await this.txs.set(tx.hash, { ...tx, ambiguous: true })
				}
			}
			await purgeRows(
				txs,
				(tx) => {
					this.pending.delete(tx.hash)
					this.droppedStreaks.delete(tx.hash)
					this.droppedWatch.delete(tx.hash)
					this.droppedNextCheckAt.delete(tx.hash)
					return this.txs.delete(tx.hash)
				},
				(tx) => this.emit("onTransactionDeleted", tx),
			)
		})
	}

	private async runWorker() {
		while (true) {
			const due = [...this.pending.values(), ...this.collectDroppedDue()]
			if (due.length) {
				const activeProfile = await this.profileService.getActiveProfile()
				if (activeProfile) {
					try {
						this.logDebug(`Sync ${due.length} transactions...`)
						const start = Date.now()
						await Promise.allSettled(due.map((x) => this.updateTx(x)))
						const end = Date.now()
						this.logDebug(`Transactions synced in ${end - start}ms`)
					} catch (error) {
						this.logError("Failed to sync transaction status.", getErrorMessage(error))
					}
				}
			}
			await sleep(1000)
		}
	}

	/** Dropped txs due for a resurrection re-check this tick; watch entries past
	 *  the window are evicted (the row simply stays Dropped). */
	private collectDroppedDue(): Tx[] {
		const now = Date.now()
		const due: Tx[] = []
		for (const [hash, tx] of this.droppedWatch) {
			if (now - tx.updatedAt > DROPPED_RESURRECTION_WINDOW_MS) {
				this.droppedWatch.delete(hash)
				this.droppedNextCheckAt.delete(hash)
				continue
			}
			if ((this.droppedNextCheckAt.get(hash) ?? 0) <= now) {
				this.droppedNextCheckAt.set(hash, now + DROPPED_RECHECK_INTERVAL_MS)
				due.push(tx)
			}
		}
		return due
	}

	private async updateTx(tx: Tx) {
		this.logDebug(`Sync tx ${tx.hash.slice(0, 8)}`)
		// Pin polling to the endpoint that submitted this tx: staying on the
		// originating endpoint avoids transient receipt-not-yet-indexed issues
		// when the user swaps the network's primary endpoint mid-pending, and —
		// critically — keeps a pending tx's receipt fetch on ITS OWN profile's
		// endpoint after a profile switch, instead of leaking the tx hash to the
		// now-active profile's RPC. `getNodeForUrl` never falls back to the
		// active profile. Legacy txs with no recorded endpoint have no URL to
		// pin to, so they still resolve via the active profile's node.
		const node = tx.submittedEndpointUrl
			? await this.networkService.getNodeForUrl(tx.submittedEndpointUrl)
			: await this.networkService.getNode(tx.chainId)
		if (!node) {
			this.logError("Unknown network")
			return
		}

		let receipt: Awaited<ReturnType<typeof node.getTxReceipt>>
		try {
			receipt = await node.getTxReceipt(TxHash.fromString(tx.hash))
		} catch (err) {
			if (tx.submittedEndpointUrl) {
				this.networkService.reportEndpointFailure(tx.submittedEndpointUrl)
			}
			throw err
		}
		const status = this.getTxStatus(receipt.status)
		const executionResult = this.getTxExecutionResult(receipt.executionResult)

		// Debounce DROPPED for a still-pending tx: within the submission grace
		// window, or below the consecutive-observation threshold, keep the row
		// Pending and let the next tick re-check (see the constants' doc block —
		// DROPPED also means "this replica has never seen the hash").
		if (status === TxStatus.Dropped && tx.status === TxStatus.Pending) {
			// No streak bookkeeping for a tx that is no longer the armed instance —
			// an in-flight poll racing a purge would otherwise recreate the map
			// entry the purge just cleaned.
			if (this.pending.get(tx.hash) !== tx) return
			const streak = (this.droppedStreaks.get(tx.hash) ?? 0) + 1
			this.droppedStreaks.set(tx.hash, streak)
			const ageMs = Date.now() - tx.createdAt
			if (ageMs < DROPPED_GRACE_MS || streak < DROPPED_CONFIRMATIONS) {
				this.logDebug(
					`Tx ${tx.hash.slice(0, 8)} reported dropped (streak ${streak}, age ${Math.round(ageMs / 1000)}s) — keeping pending`,
				)
				return
			}
		} else {
			this.droppedStreaks.delete(tx.hash)
		}

		if (status === tx.status && executionResult === tx.executionResult) {
			this.logDebug(`Tx ${tx.hash.slice(0, 8)} still ${receipt.status}`)
			return
		}

		// The node fetch above ran UNLOCKED (network I/O). Re-check + persist UNDER
		// the tx lock: a concurrent profile-delete purge (`purgeForAccounts`, same
		// lock) removes this tx from `this.pending` + storage. Without the guarded
		// re-check, the worker's stale write would RESURRECT a deleted profile's tx
		// (finding D — in-flight-write fencing). The fence is on OBJECT IDENTITY,
		// not hash membership: after a purge, `addTransaction` may legitimately
		// re-create the same hash as a NEW row (ABA) — a stale poll's `has(hash)`
		// would pass and overwrite it, while `get(hash) !== tx` cannot.
		await this.lock.withLock(async () => {
			if (this.pending.get(tx.hash) !== tx && this.droppedWatch.get(tx.hash) !== tx) return
			tx.updatedAt = Date.now()
			tx.status = status
			tx.executionResult = executionResult
			tx.block =
				receipt.blockHash && receipt.blockNumber ? { hash: receipt.blockHash.toString(), number: receipt.blockNumber } : undefined
			tx.fee = receipt.transactionFee?.toString()
			tx.error = receipt.error

			await this.txs.set(tx.hash, tx)
			this.emit("onTransactionUpdated", tx)
			// Map membership is canonical from the NEW status: Pending → polled
			// every tick (this is how a watched-Dropped tx whose receipt reads
			// pending again re-arms instead of stranding unpolled in neither map),
			// Dropped → slow-cadence watch, mined → neither.
			if (tx.status === TxStatus.Pending) {
				this.pending.set(tx.hash, tx)
			} else {
				this.pending.delete(tx.hash)
			}
			if (tx.status === TxStatus.Dropped) {
				this.droppedWatch.set(tx.hash, tx)
				this.droppedNextCheckAt.set(tx.hash, Date.now() + DROPPED_RECHECK_INTERVAL_MS)
			} else {
				this.droppedWatch.delete(tx.hash)
				this.droppedNextCheckAt.delete(tx.hash)
			}
			this.logDebug(`Tx ${tx.hash.slice(0, 8)} ${receipt.status}`)
		})
	}

	private getTxStatus(status: AztecTxStatus): TxStatus {
		switch (status) {
			case AztecTxStatus.PENDING:
				return TxStatus.Pending
			case AztecTxStatus.DROPPED:
				return TxStatus.Dropped
			case AztecTxStatus.PROPOSED:
				return TxStatus.Proposed
			case AztecTxStatus.CHECKPOINTED:
				return TxStatus.Checkpointed
			case AztecTxStatus.PROVEN:
				return TxStatus.Proven
			case AztecTxStatus.FINALIZED:
				return TxStatus.Finalized
			default:
				throw new Error("unknown tx status")
		}
	}

	private getTxExecutionResult(result: AztecTxExecutionResult | undefined): TxExecutionResult | undefined {
		if (!result) return undefined
		switch (result) {
			case AztecTxExecutionResult.SUCCESS:
				return TxExecutionResult.Success
			// 5.0 collapsed the three revert variants (app-logic / teardown / both) into one
			// REVERTED. Map it to AppLogicReverted as the catch-all "reverted" label; the Nulo
			// enum's TeardownReverted/BothReverted are now unreachable (follow-up: collapse + UI review).
			case AztecTxExecutionResult.REVERTED:
				return TxExecutionResult.AppLogicReverted
			default:
				return undefined
		}
	}

	public async backup(): Promise<Tx[] | undefined> {
		const profile = await requireActiveProfile(this.profileService)

		const networks = await this.networkService.getNetworks()
		if (!networks.length) {
			return undefined
		}

		const txs: Tx[] = []

		for (const n of networks) {
			const accounts = await this.accountService.getAccounts(profile.id, n.chainId)
			for (const acc of accounts) {
				for (const tx of await this.getTransactions(acc.address)) {
					// The fetch is by address, which two same-seed profiles share, so a
					// row naming another profile is not ours to export. A row that was
					// marked unattributable is nobody's, and restore would hand it to
					// whichever profile imported the backup.
					if (tx.ambiguous) continue
					if (tx.profileId !== undefined && tx.profileId !== profile.id) continue
					if (tx.chainId !== n.chainId) continue
					txs.push(tx)
				}
			}
		}

		return txs
	}

	public async restore(txs: Tx[]): Promise<Restored<Tx>[]> {
		await this.ensureInitialized()

		const result: Restored<Tx>[] = []

		return await this.lock.withLock(async () => {
			for (const tx of txs) {
				try {
					// D16: never restore a Pending tx. `submittedEndpointUrl` is
					// backup-controlled and `updateTx` dials it (or, when absent, the
					// ACTIVE profile's node) — the sync worker would leak an
					// attacker-chosen hash to the wrong RPC. Pending is transient sync
					// state that re-derives on the next real submission. Drop-and-record;
					// NEVER write it (a written Pending row is re-armed by the init scan)
					// and NEVER add it to `this.pending`.
					if (tx.status === TxStatus.Pending) {
						result.push({ ...tx, restoreError: "restored pending transaction rejected" })
						continue
					}
					// B: create-only. `EntityStorage.set` is an upsert on the
					// profile-shared txs root keyed by `hash`; a crafted hash equal to a
					// victim's tx would overwrite (erase) it. A restore must never
					// overwrite an existing tx.
					if (await this.txs.contains(tx.hash)) {
						result.push({ ...tx, restoreError: "transaction already exists (hash collision)" })
						continue
					}
					// H: validate + canonicalize the persisted shape (mirror the read
					// codec) so a malformed row is recorded, not written + codec-hidden.
					const row = TxSchema.parse(tx)
					await this.txs.set(row.hash, row)
					result.push(row)
				} catch (err) {
					result.push({
						...tx,
						restoreError: toRestoreError(err),
					})
				}
			}

			return result
		})
	}
}
