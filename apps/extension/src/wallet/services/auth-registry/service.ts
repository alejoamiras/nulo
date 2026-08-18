import type { ILogger } from "@/wallet/logger"
import { restoreRows } from "@/wallet/services/restore-rows"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { maybeRethrowAsRpcCancel } from "@/wallet/services/execution/rpc-cancel"
import { ExecutionService, type FeeSettings, type AuthwitContent } from "@/wallet/services/execution/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { purgeMalformedRows, purgeRows } from "@/wallet/services/purge-rows"
import type { WrappedTask } from "@/wallet/services/task/wrapped-task"
import { TaskService, RevokeAuthwitsContent, StepContent } from "@/wallet/services/task/service"
import { TransactionService, OriginType } from "@/wallet/services/transaction/service"
import { type Tx, TxExecutionResult, TxStatus } from "@/wallet/services/transaction/spec"
import { EntityStorage } from "@/wallet/storage"
import { array_max, Lock, sleep } from "@/wallet/utils"
import { getAuthRegistryAddress, isAuthRegistryEnabled, isAuthwitConsumable } from "@/wallet/utils/auth-registry"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import {
	AUTH_REGISTRY_ENABLED_STORAGE_ROOT,
	AUTH_REGISTRY_SERVICE_NAME,
	AUTH_REGISTRY_STORAGE_ROOT,
	type Authwit,
	type Events,
	MAX_REVOKES_PER_TX,
	MAX_TRACKED_AUTHWITS_PER_ACCOUNT,
	type Methods,
	AuthwitSchema,
	AuthwitStatusSchema,
} from "./spec"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { TxHash } from "@aztec/stdlib/tx"

export * from "./spec"

export class AuthRegistryService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"getAuthwits",
		"revokeAuthwits",
		"getRegistryEnabled",
		"setRegistryEnabled",
		"syncRegistry",
	)
	public static name = AUTH_REGISTRY_SERVICE_NAME

	public readonly onAuthwitAdded = new EventHandler<Authwit>()
	public readonly onAuthwitDeleted = new EventHandler<Authwit>()
	public readonly onRegistryEnabled = new EventHandler<string>()
	public readonly onRegistryDisabled = new EventHandler<string>()

	private readonly authwits: EntityStorage<Authwit>
	private readonly statuses: EntityStorage<boolean>
	private readonly lock = new Lock()

	private profileService: ProfileService = null!
	private networkService: NetworkService = null!
	private accountService: AccountService = null!
	private executionService: ExecutionService = null!
	private transactionService: TransactionService = null!
	private taskService: TaskService = null!

	public constructor(logger: ILogger, browserApi: BrowserApi) {
		super(AUTH_REGISTRY_SERVICE_NAME, logger)
		this.authwits = new EntityStorage<Authwit>(AUTH_REGISTRY_STORAGE_ROOT, browserApi.storage.local, (raw) => AuthwitSchema.parse(raw))
		this.statuses = new EntityStorage<boolean>(AUTH_REGISTRY_ENABLED_STORAGE_ROOT, browserApi.storage.local, (raw) =>
			AuthwitStatusSchema.parse(raw),
		)
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		this.networkService = services.get(NetworkService.name)
		this.accountService = services.get(AccountService.name)
		this.executionService = services.get(ExecutionService.name)
		this.transactionService = services.get(TransactionService.name)
		this.taskService = services.get(TaskService.name)

		// Authwits + registry-enabled flags are keyed per-account. When an
		// account is deleted (e.g. as part of a chain purge), wipe its
		// records here so we don't leak stale state. Fire-and-forget against
		// the EventHandler — best-effort cleanup.
		this.accountService.onAccountDeleted.add((account) => {
			void this.purgeForAccounts([account.address])
		})

		// Reconcile pending public-authwit rows by their tx's on-chain outcome: a row is
		// written `pending` at the post-send tail, then confirmed here once its tx is proven
		// successful, or removed if the tx dropped/reverted — so the local revocation index
		// never claims a grant that never landed. Best-effort + idempotent: a failed pass is
		// retried on the next tx update (or by sync). See lessons/phase-5.md.
		this.transactionService.onTransactionUpdated.add((tx) => {
			void this.reconcileFromTx(tx).catch(() => {})
		})
	}

	/** Map a tx's settled on-chain outcome to a pending-authwit reconcile. Proven/Finalized
	 *  + Success ⇒ confirm; settled non-success (reverted) ⇒ remove. A Dropped status
	 *  deliberately does NOTHING: the transaction service may still resurrect a dropped tx
	 *  on a late mine (transient DROPPED answers happen behind load-balanced RPCs), and a
	 *  row removed here can never be reconfirmed — authwit hashes aren't enumerable from
	 *  chain. ACCEPTED RESIDUAL: a genuinely dropped tx's row then lingers as pending —
	 *  `syncAuthwit` skips pending rows on purpose, so nothing prunes it. That is the safe
	 *  direction (over-claiming; revoking a never-landed grant is a no-op); it stays
	 *  user-visible/revocable and only costs headroom against the tracked-authwit cap. */
	private async reconcileFromTx(tx: Tx): Promise<void> {
		const settled = tx.status === TxStatus.Proven || tx.status === TxStatus.Finalized
		if (settled && tx.executionResult === TxExecutionResult.Success) {
			await this.reconcileAuthwits(tx.hash, "mined")
			return
		}
		const reverted = settled && tx.executionResult !== undefined && tx.executionResult !== TxExecutionResult.Success
		if (reverted) {
			await this.reconcileAuthwits(tx.hash, "dropped")
		}
	}

	public async getAuthwits(account: string): Promise<Authwit[]> {
		return (await this.authwits.getValues()).filter((x) => x.account === account)
	}

	/** PRE-send cap gate: throw if granting `newHashes` would push `account` past the
	 *  tracked-authwit ceiling. Counts existing tracked rows (incl. pending) PLUS the unique
	 *  NEW hashes not already tracked — a per-action check would let e.g. 255 existing + 2 new
	 *  slip through and miscount intra-tx duplicates. Never auto-evict (that destroys the
	 *  only local revocation index). Called by `buildStandard` for each `add_public_authwit`. */
	public async assertWithinCap(account: string, newHashes: string[]): Promise<void> {
		const existing = (await this.authwits.getValues()).filter((x) => x.account === account)
		const existingHashes = new Set(existing.map((a) => a.hash))
		const newUnique = new Set(newHashes.filter((h) => !existingHashes.has(h)))
		if (existing.length + newUnique.size > MAX_TRACKED_AUTHWITS_PER_ACCOUNT) {
			throw new Error(
				`Cannot grant: account ${account} would exceed the ${MAX_TRACKED_AUTHWITS_PER_ACCOUNT} tracked public-authwit limit. Revoke some first.`,
			)
		}
	}

	/** Record public authwits at the POST-send tail as `pending`, tx-linked rows.
	 *  Acceptance of `sendTx` is NOT mining — these stay pending until
	 *  `reconcileAuthwits` confirms (mined) or removes (dropped) them. Idempotent:
	 *  an account+hash already tracked (pending or confirmed) is skipped, so a
	 *  retry after a partial write does not duplicate. */
	public async recordPendingAuthwits(account: string, items: { hash: string; content: AuthwitContent }[], txHash: string): Promise<void> {
		if (items.length === 0) return
		await this.lock.withLock(async () => {
			const existing = await this.authwits.getValues()
			const seen = new Set(existing.filter((x) => x.account === account).map((x) => x.hash))
			let nextId = array_max(existing.map((x) => x.id)) + 1
			for (const { hash, content } of items) {
				if (seen.has(hash)) continue
				seen.add(hash)
				const authwit: Authwit = { id: nextId++, account, hash, content, pending: true, txHash }
				await this.authwits.set(`${authwit.id}`, authwit)
				this.emit("onAuthwitAdded", authwit)
			}
		})
	}

	/** Reconcile pending rows for a tx once its outcome is known: `mined` clears
	 *  the pending flag (the grant is durable + revocable); `dropped` removes the
	 *  rows (the grant never landed, so the local index must not claim it exists).
	 *  Confirmed (non-pending) rows are untouched. */
	public async reconcileAuthwits(txHash: string, outcome: "mined" | "dropped"): Promise<void> {
		await this.lock.withLock(async () => {
			const rows = (await this.authwits.getValues()).filter((x) => x.pending && x.txHash === txHash)
			for (const row of rows) {
				if (outcome === "mined") {
					await this.authwits.set(`${row.id}`, { ...row, pending: false })
				} else {
					await this.authwits.delete(`${row.id}`)
					this.emit("onAuthwitDeleted", row)
				}
			}
		})
	}

	public async revokeAuthwits(networkId: string, account: string, ids: number[], feeSettings: FeeSettings): Promise<void> {
		await this.ensureInitialized()
		if (ids.length > MAX_REVOKES_PER_TX) {
			throw new Error(`Cannot revoke more than ${MAX_REVOKES_PER_TX} authwits per single tx`)
		}

		const authwits: Authwit[] = []
		for (const id of ids) {
			const authwit = await this.authwits.get(`${id}`)
			// Reject an authwit id owned by a DIFFERENT account: authwits are FK-scoped
			// by account (no profileId), so without this a caller could revoke another
			// account's authwits by supplying its ids. Treat a foreign id as "doesn't
			// exist" — there is deliberately no cross-account existence oracle.
			if (!authwit || authwit.account !== account) {
				throw new Error(`Authwit #${id} doesn't exist`)
			}
			authwits.push(authwit)
		}

		const task = this.taskService.startNewTask(new RevokeAuthwitsContent(ids))
		try {
			const registryAddress = getAuthRegistryAddress().toString()
			const txHash = await this.executionService.executeSendTransaction(
				{
					kind: "send_transaction",
					networkId,
					accountAddress: account,
					feeSettings,
					actions: authwits.map((x) => ({
						kind: "call",
						contract: registryAddress,
						method: "set_authorized",
						args: [x.hash, false],
					})),
				},
				{ type: OriginType.UI },
				task,
			)

			await this.transactionService.waitForTx(txHash, task)

			const network = await this.networkService.getNetwork(networkId)
			const node = await this.networkService.getNode(network.chainId)
			// `waitForTx` only confirms the tx left the pending queue (submitted),
			// not that its PUBLIC effect is mined + visible. Poll the on-chain state
			// so a fast (proverless) follow-up consume can't race a not-yet-mined
			// revoke. See waitForOnChainState.
			await this.waitForTxProven(node, txHash)
			await this.syncAuthwits(node, account, task, authwits)

			task.complete()
		} catch (error) {
			// Convert the internal sentinel to the structured RPC-boundary
			// error so the popup's `classifyCancellableRejection` works.
			// Same conversion done by `executeTransfer`.
			maybeRethrowAsRpcCancel(error, task)
			task.fail(error)
			throw error
		}
	}

	public async getRegistryEnabled(account: string): Promise<boolean> {
		return (await this.statuses.get(account)) ?? true
	}

	public async setRegistryEnabled(networkId: string, account: string, enabled: boolean, feeSettings: FeeSettings): Promise<void> {
		await this.ensureInitialized()
		const task = this.taskService.startNewTask(new StepContent(`${enabled ? "Enable" : "Disable"} auth registry`))
		try {
			const txHash = await this.executionService.executeSendTransaction(
				{
					kind: "send_transaction",
					networkId,
					accountAddress: account,
					feeSettings,
					actions: [
						{
							kind: "call",
							contract: getAuthRegistryAddress().toString(),
							method: "set_reject_all",
							args: [!enabled],
						},
					],
				},
				{ type: OriginType.UI },
				task,
			)

			await this.transactionService.waitForTx(txHash, task)

			const network = await this.networkService.getNetwork(networkId)
			const node = await this.networkService.getNode(network.chainId)
			// Ensure the registry toggle is mined + visible before returning, so a
			// fast follow-up consume reads the new state (see waitForOnChainState).
			await this.waitForTxProven(node, txHash)
			await this.syncStatus(node, account, task)

			task.complete()
		} catch (error) {
			// Convert the internal sentinel to the structured RPC-boundary
			// error so the popup's `classifyCancellableRejection` works.
			// Same conversion done by `executeTransfer`.
			maybeRethrowAsRpcCancel(error, task)
			task.fail(error)
			throw error
		}
	}

	public async syncRegistry(networkId: string, account: string): Promise<void> {
		await this.ensureInitialized()
		const task = this.taskService.startNewTask(new StepContent("Sync auth registry"))
		try {
			const network = await this.networkService.getNetwork(networkId)
			const node = await this.networkService.getNode(network.chainId)
			await Promise.all([this.syncAuthwits(node, account, task), this.syncStatus(node, account, task)])
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	/** Poll an on-chain predicate until it holds (the just-submitted settings
	 *  tx's public effect is mined + visible) or the timeout elapses.
	 *
	 *  `transactionService.waitForTx` only blocks while the tx is in the local
	 *  `pending` queue (i.e. until it's submitted), NOT until its public state
	 *  is mined — so a one-shot read right after it can observe stale state. The
	 *  gap is masked under real proving (the prove duration absorbs it) but
	 *  exposed under proverless e2e, where a follow-up `consume` would race the
	 *  registry. Polling the actual on-chain predicate closes the race for both.
	 *  On timeout we proceed (the caller's sync reads whatever is current) rather
	 *  than fail the settings op. */
	/**
	 * Wait until the mutation tx's block is PROVEN, not merely at the proposed
	 * `latest` tip. The sequencer executes public functions — e.g. a follow-up
	 * authwit consume's `AuthRegistry.consume` — against PROVEN state, so a
	 * revoke/toggle visible only at `latest` is invisible to that execution and a
	 * fast consume can still spend a "revoked" grant. Poll the proven tip past the
	 * tx's receipt block. Throws on timeout — never report an unverifiable
	 * security mutation as success. (Proven advances normally here: grants reach
	 * proven within the test's own step timing, which is why their consumes work.)
	 */
	private async waitForTxProven(node: AztecNode, txHash: string, timeoutMs = 120_000): Promise<void> {
		const receipt = await node.getTxReceipt(TxHash.fromString(txHash))
		const target = receipt.blockNumber
		if (target === undefined) throw new Error(`waitForTxProven: tx ${txHash} has no block number`)
		const start = Date.now()
		while (Date.now() - start < timeoutMs) {
			if ((await node.getChainTips()).proven.block.number >= target) return
			await sleep(1_000)
		}
		throw new Error(`waitForTxProven: tx ${txHash} (block ${target}) not proven within ${timeoutMs}ms`)
	}

	private async syncAuthwits(node: AztecNode, account: string, parentTask: WrappedTask, authwits?: Authwit[]) {
		const task = parentTask.startSubtask(new StepContent("Sync authwits"))
		try {
			const _authwits = authwits ?? (await this.getAuthwits(account))
			await Promise.all(_authwits.map((authwit) => this.syncAuthwit(node, authwit, task)))
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	private async syncAuthwit(node: AztecNode, authwit: Authwit, parentTask: WrappedTask) {
		// Skip no-op syncs BEFORE starting a subtask: a started-but-unfinished subtask blocks
		// the PARENT task from completing (TaskService refuses a parent with open children),
		// which is exactly what wedged `revokeAuthwits`' syncAuthwits when the revoked grants
		// were still `pending`. A `pending` row is reconciled by its tx outcome
		// (onTransactionUpdated), not by sync; a still-consumable row is live. Sync only prunes
		// confirmed-but-vanished rows.
		if (authwit.pending) return
		if (await isAuthwitConsumable(node, authwit.account, authwit.hash)) return
		const task = parentTask.startSubtask(new StepContent(`Sync authwit #${authwit.id}`))
		try {
			await this.lock.withLock(async () => {
				if (await this.authwits.get(`${authwit.id}`)) {
					await this.authwits.delete(`${authwit.id}`)
					this.emit("onAuthwitDeleted", authwit)
				}
			})
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	private async syncStatus(node: AztecNode, account: string, parentTask: WrappedTask): Promise<void> {
		const task = parentTask.startSubtask(new StepContent("Sync status"))
		try {
			const isEnabled = await isAuthRegistryEnabled(node, account)
			await this.lock.withLock(async () => {
				const enabled = await this.statuses.get(account)
				if (enabled !== isEnabled) {
					if (isEnabled) {
						await this.statuses.delete(account)
						this.emit("onRegistryEnabled", account)
					} else {
						await this.statuses.set(account, isEnabled)
						this.emit("onRegistryDisabled", account)
					}
				}
			})
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	public async backup(): Promise<Authwit[] | undefined> {
		const profile = await requireActiveProfile(this.profileService)

		const networks = await this.networkService.getNetworks()
		if (!networks.length) {
			return undefined
		}

		const authwits: Authwit[] = []

		for (const n of networks) {
			const accounts = await this.accountService.getAccounts(profile.id, n.chainId)
			for (const acc of accounts) {
				authwits.push(...(await this.getAuthwits(acc.address)))
			}
		}

		return authwits
	}

	/** Awaited authwit + status purge for a SET of accounts — called by the
	 *  deletion coordinator with the tombstone's address snapshot (finding D).
	 *  `onAccountDeleted` delegates here (single-account deleteNetwork path). */
	public async purgeForAccounts(addresses: readonly string[]): Promise<void> {
		await this.ensureInitialized()
		const set = new Set(addresses)
		await this.lock.withLock(async () => {
			const authwits = (await this.authwits.getValues()).filter((a) => set.has(a.account))
			await purgeRows(
				authwits,
				(authwit) => this.authwits.delete(`${authwit.id}`),
				(authwit) => this.emit("onAuthwitDeleted", authwit),
			)
			// F-B23: raw second pass — a validation-failed row for a purged account
			// is invisible to getValues() and would otherwise survive forever.
			await purgeMalformedRows(
				this.authwits,
				(raw) => typeof raw.account === "string" && set.has(raw.account),
				(id) => this.logDebug(`purged malformed authwit row ${id}`),
			)
			for (const addr of set) {
				if (await this.statuses.contains(addr)) await this.statuses.delete(addr)
			}
		})
	}

	public async restore(authwits: Authwit[]): Promise<Restored<Authwit>[]> {
		await this.ensureInitialized()

		return await this.lock.withLock(async () => {
			let id = array_max((await this.authwits.getValues()).map((x) => x.id)) + 1
			// `id` advances only after a successful write: restoreRows routes a
			// throwing row to `restoreError` and never reaches the `id++`, so a
			// malformed authwit doesn't consume a cursor slot (matches the prior
			// hand-rolled loop exactly).
			return await restoreRows(authwits, async (authwit) => {
				// Parse the persisted shape so a malformed backup authwit is recorded
				// as restoreError, not silently written + codec-hidden on read.
				const row = AuthwitSchema.parse({ ...authwit, id })
				await this.authwits.set(`${id}`, row)
				id++
				return row
			})
		})
	}
}
