import type { ILogger } from "@/wallet/logger"
import { assertRestoreEpoch, captureRestoreEpochs } from "@/wallet/services/restore-fence"
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
	type AuthwitRegistryScope,
	authwitStatusRowId,
	type Events,
	MAX_REVOKES_PER_TX,
	MAX_TRACKED_AUTHWITS_PER_ACCOUNT,
	type Methods,
	AuthwitSchema,
	AuthwitStatusSchema,
	parseAuthwitStatusRowId,
} from "./spec"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { TxHash } from "@aztec/stdlib/tx"

export * from "./spec"

/** The `(profileId, chainId, account)` scope every authwit read/write is bound to. `profileId` is
 *  never a popup parameter — it is always the active profile, resolved SW-side. */
type AuthwitScope = { profileId: string; chainId: number; account: string }

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
	public readonly onRegistryEnabled = new EventHandler<AuthwitRegistryScope>()
	public readonly onRegistryDisabled = new EventHandler<AuthwitRegistryScope>()

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
		// The journal is keyed BY the authwit's numeric id and every mutation site derives its
		// storage key from the row's embedded id — so a raw-storage row copied under a foreign
		// key (id aliasing) would make revoke/delete/reconcile operate on the wrong row. The
		// id/key guard hides such rows at read time; honest rows always agree.
		this.authwits = new EntityStorage<Authwit>(
			AUTH_REGISTRY_STORAGE_ROOT,
			browserApi.storage.local,
			(raw) => AuthwitSchema.parse(raw),
			{
				requireKeyIdentityMatch: true,
				keyIdentityMode: "numeric",
			},
		)
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

		// Authwit rows + registry-enabled flags are scoped by (profileId, chainId, account). Two
		// awaited purge subscribers, NOT the address-only onAccountDeleted listener (which could
		// delete a sibling profile's rows for a shared address, and never fires on deleteNetwork):
		//   - account purge (reconcileImportedAccounts): the exact (chainId, address) scopes.
		//   - chain purge (deleteNetwork / profile delete): every row on (profileId, chainId).
		this.accountService.registerAccountPurgeSubscriber(async (profileId, scopes) => this.purgeForAccounts(scopes, profileId))
		this.networkService.registerChainPurgeSubscriber(async (profileId, chainId) => this.purgeChain(profileId, chainId))

		// Reconcile pending public-authwit rows by their tx's on-chain outcome: a row is
		// written `pending` at the post-send tail, then confirmed here once its tx is proven
		// successful, or removed if the tx dropped/reverted — so the local revocation index
		// never claims a grant that never landed. Best-effort + idempotent: a failed pass is
		// retried on the next tx update (or by sync). See lessons/phase-5.md.
		this.transactionService.onTransactionUpdated.add((tx) => {
			void this.reconcileFromTx(tx).catch(() => {})
		})
	}

	/** Map a tx's settled on-chain outcome to a pending-authwit reconcile, scoped to the tx's own
	 *  `(profileId, chainId, account)` — a tx without provenance (`profileId` absent) is skipped
	 *  so it can never reconcile another profile's rows. Proven/Finalized + Success ⇒ confirm;
	 *  settled non-success (reverted) ⇒ remove. A Dropped status deliberately does NOTHING: the
	 *  transaction service may still resurrect a dropped tx on a late mine (transient DROPPED
	 *  answers happen behind load-balanced RPCs), and a row removed here can never be reconfirmed —
	 *  authwit hashes aren't enumerable from chain. ACCEPTED RESIDUAL: a genuinely dropped tx's row
	 *  then lingers as pending — `syncAuthwit` skips pending rows on purpose, so nothing prunes it.
	 *  That is the safe direction (over-claiming; revoking a never-landed grant is a no-op); it
	 *  stays user-visible/revocable and only costs headroom against the tracked-authwit cap. */
	private async reconcileFromTx(tx: Tx): Promise<void> {
		if (!tx.profileId) return
		const scope: AuthwitScope = { profileId: tx.profileId, chainId: tx.chainId, account: tx.account }
		const settled = tx.status === TxStatus.Proven || tx.status === TxStatus.Finalized
		if (settled && tx.executionResult === TxExecutionResult.Success) {
			await this.reconcileAuthwits(scope, tx.hash, "mined")
			return
		}
		const reverted = settled && tx.executionResult !== undefined && tx.executionResult !== TxExecutionResult.Success
		if (reverted) {
			await this.reconcileAuthwits(scope, tx.hash, "dropped")
		}
	}

	/** Every tracked row for `(profileId, chainId, account)`. */
	private async rowsForScope(scope: AuthwitScope): Promise<Authwit[]> {
		return (await this.authwits.getValues()).filter(
			(x) => x.profileId === scope.profileId && x.chainId === scope.chainId && x.account === scope.account,
		)
	}

	public async getAuthwits(chainId: number, account: string): Promise<Authwit[]> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return this.rowsForScope({ profileId: profile.id, chainId, account })
	}

	/** PRE-send cap gate: throw if granting `newHashes` would push the scope past the
	 *  tracked-authwit ceiling. Counts existing tracked rows for THIS `(profileId, chainId,
	 *  account)` (incl. pending) PLUS the unique NEW hashes not already tracked — a per-action
	 *  check would let e.g. 255 existing + 2 new slip through and miscount intra-tx duplicates.
	 *  Never auto-evict (that destroys the only local revocation index). Called by `buildStandard`
	 *  for each `add_public_authwit`, with the owned network's profile + chain. */
	public async assertWithinCap(scope: AuthwitScope, newHashes: string[]): Promise<void> {
		const existing = await this.rowsForScope(scope)
		const existingHashes = new Set(existing.map((a) => a.hash))
		const newUnique = new Set(newHashes.filter((h) => !existingHashes.has(h)))
		if (existing.length + newUnique.size > MAX_TRACKED_AUTHWITS_PER_ACCOUNT) {
			throw new Error(
				`Cannot grant: account ${scope.account} would exceed the ${MAX_TRACKED_AUTHWITS_PER_ACCOUNT} tracked public-authwit limit. Revoke some first.`,
			)
		}
	}

	/** Record public authwits at the POST-send tail as `pending`, tx-linked rows, stamped with the
	 *  sending tx's `(profileId, chainId, account)`. Acceptance of `sendTx` is NOT mining — these
	 *  stay pending until `reconcileAuthwits` confirms (mined) or removes (dropped) them.
	 *  Idempotent: a hash already tracked in this scope (pending or confirmed) is skipped, so a
	 *  retry after a partial write does not duplicate. Ids are allocated over the PHYSICAL key
	 *  space so a codec-hidden row (a damaged current-format row) can't be overwritten. */
	public async recordPendingAuthwits(
		scope: AuthwitScope,
		items: { hash: string; content: AuthwitContent }[],
		txHash: string,
	): Promise<void> {
		if (items.length === 0) return
		await this.lock.withLock(async () => {
			const all = await this.authwits.getValues()
			const seen = new Set(
				all
					.filter((x) => x.profileId === scope.profileId && x.chainId === scope.chainId && x.account === scope.account)
					.map((x) => x.hash),
			)
			const occupied = new Set(await this.authwits.getKeys())
			let nextId = array_max(all.map((x) => x.id)) + 1
			for (const { hash, content } of items) {
				if (seen.has(hash)) continue
				seen.add(hash)
				while (Number.isSafeInteger(nextId) && occupied.has(`${nextId}`)) nextId++
				if (!Number.isSafeInteger(nextId)) throw new Error("authwit id space exhausted")
				const authwit: Authwit = {
					id: nextId,
					profileId: scope.profileId,
					chainId: scope.chainId,
					account: scope.account,
					hash,
					content,
					pending: true,
					txHash,
				}
				await this.authwits.set(`${authwit.id}`, authwit)
				occupied.add(`${authwit.id}`)
				nextId++
				this.emit("onAuthwitAdded", authwit)
			}
		})
	}

	/** Reconcile pending rows for a tx once its outcome is known, scoped to the tx's own
	 *  `(profileId, chainId, account)` AND its hash: `mined` clears the pending flag (the grant is
	 *  durable + revocable); `dropped` removes the rows (the grant never landed, so the local index
	 *  must not claim it exists). Confirmed (non-pending) rows are untouched. */
	public async reconcileAuthwits(scope: AuthwitScope, txHash: string, outcome: "mined" | "dropped"): Promise<void> {
		await this.lock.withLock(async () => {
			const rows = (await this.authwits.getValues()).filter(
				(x) =>
					x.pending &&
					x.txHash === txHash &&
					x.profileId === scope.profileId &&
					x.chainId === scope.chainId &&
					x.account === scope.account,
			)
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
		const network = await this.networkService.getNetwork(networkId)
		const scope: AuthwitScope = { profileId: network.profileId, chainId: network.chainId, account }

		const authwits: Authwit[] = []
		for (const id of ids) {
			const authwit = await this.authwits.get(`${id}`)
			// Reject an id owned by a DIFFERENT (profileId, chainId, account) tuple: without this a
			// caller could revoke another profile's / chain's / account's authwits by supplying its
			// ids. Treat a foreign id as "doesn't exist" — there is deliberately no cross-scope
			// existence oracle.
			if (
				!authwit ||
				authwit.profileId !== scope.profileId ||
				authwit.chainId !== scope.chainId ||
				authwit.account !== scope.account
			) {
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

			const node = await this.networkService.getNode(network.chainId)
			// `waitForTx` only confirms the tx left the pending queue (submitted),
			// not that its PUBLIC effect is mined + visible. Poll the on-chain state
			// so a fast (proverless) follow-up consume can't race a not-yet-mined
			// revoke. See waitForOnChainState.
			await this.waitForTxProven(node, txHash)
			await this.syncAuthwits(node, scope, task, authwits)

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

	public async getRegistryEnabled(chainId: number, account: string): Promise<boolean> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return (await this.statuses.get(authwitStatusRowId(profile.id, chainId, account))) ?? true
	}

	public async setRegistryEnabled(networkId: string, account: string, enabled: boolean, feeSettings: FeeSettings): Promise<void> {
		await this.ensureInitialized()
		const network = await this.networkService.getNetwork(networkId)
		const scope: AuthwitScope = { profileId: network.profileId, chainId: network.chainId, account }
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

			const node = await this.networkService.getNode(network.chainId)
			// Ensure the registry toggle is mined + visible before returning, so a
			// fast follow-up consume reads the new state (see waitForOnChainState).
			await this.waitForTxProven(node, txHash)
			await this.syncStatus(node, scope, task)

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
		const network = await this.networkService.getNetwork(networkId)
		const scope: AuthwitScope = { profileId: network.profileId, chainId: network.chainId, account }
		const task = this.taskService.startNewTask(new StepContent("Sync auth registry"))
		try {
			const node = await this.networkService.getNode(network.chainId)
			await Promise.all([this.syncAuthwits(node, scope, task), this.syncStatus(node, scope, task)])
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

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

	private async syncAuthwits(node: AztecNode, scope: AuthwitScope, parentTask: WrappedTask, authwits?: Authwit[]) {
		const task = parentTask.startSubtask(new StepContent("Sync authwits"))
		try {
			const _authwits = authwits ?? (await this.rowsForScope(scope))
			await Promise.all(_authwits.map((authwit) => this.syncAuthwit(node, scope, authwit, task)))
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	private async syncAuthwit(node: AztecNode, scope: AuthwitScope, authwit: Authwit, parentTask: WrappedTask) {
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
				// Re-read UNDER the lock and delete only if the row still holds the SAME
				// scope + hash + pending state the sync captured: a purge + restore during
				// the (lock-free) node await can hand this numeric id to a different tuple,
				// and an id-keyed delete would then destroy the wrong row.
				const current = await this.authwits.get(`${authwit.id}`)
				if (
					current &&
					!current.pending &&
					current.profileId === scope.profileId &&
					current.chainId === scope.chainId &&
					current.account === scope.account &&
					current.hash === authwit.hash
				) {
					await this.authwits.delete(`${authwit.id}`)
					this.emit("onAuthwitDeleted", current)
				}
			})
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	private async syncStatus(node: AztecNode, scope: AuthwitScope, parentTask: WrappedTask): Promise<void> {
		const task = parentTask.startSubtask(new StepContent("Sync status"))
		const rowId = authwitStatusRowId(scope.profileId, scope.chainId, scope.account)
		try {
			const isEnabled = await isAuthRegistryEnabled(node, scope.account)
			await this.lock.withLock(async () => {
				const enabled = (await this.statuses.get(rowId)) ?? true
				if (enabled !== isEnabled) {
					if (isEnabled) {
						await this.statuses.delete(rowId)
						this.emit("onRegistryEnabled", scope)
					} else {
						await this.statuses.set(rowId, isEnabled)
						this.emit("onRegistryDisabled", scope)
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
				authwits.push(...(await this.rowsForScope({ profileId: profile.id, chainId: n.chainId, account: acc.address })))
			}
		}

		return authwits
	}

	/** Awaited authwit + status purge for a SET of `(chainId, address)` scopes within ONE profile —
	 *  registered with AccountService and invoked BEFORE the Account rows are deleted (finding D).
	 *  Scope is the full tuple: a bare-address match would destroy a sibling profile's rows (shared
	 *  addresses are a supported state), and an address+profile match would destroy this profile's
	 *  rows on ANOTHER chain. Idempotent. */
	public async purgeForAccounts(scopes: ReadonlyArray<{ chainId: number; address: string }>, profileId: string): Promise<void> {
		await this.ensureInitialized()
		if (scopes.length === 0) return
		const keys = new Set(scopes.map((s) => `${s.chainId}:${s.address}`))
		await this.lock.withLock(async () => {
			const authwits = (await this.authwits.getValues()).filter(
				(a) => a.profileId === profileId && keys.has(`${a.chainId}:${a.account}`),
			)
			await purgeRows(
				authwits,
				(authwit) => this.authwits.delete(`${authwit.id}`),
				(authwit) => this.emit("onAuthwitDeleted", authwit),
			)
			// F-B23: raw second pass — a validation-failed row for a purged scope
			// is invisible to getValues() and would otherwise survive forever.
			await purgeMalformedRows(
				this.authwits,
				(raw) =>
					raw.profileId === profileId &&
					typeof raw.chainId === "number" &&
					typeof raw.account === "string" &&
					keys.has(`${raw.chainId}:${raw.account}`),
				(id) => this.logDebug(`purged malformed authwit row ${id}`),
			)
			await this.purgeStatuses((s) => s.profileId === profileId && keys.has(`${s.chainId}:${s.account}`))
		})
	}

	/** Awaited authwit + status purge for one whole profile (profile-delete cascade). */
	public async purgeForProfile(profileId: string): Promise<void> {
		await this.ensureInitialized()
		await this.lock.withLock(async () => {
			const authwits = (await this.authwits.getValues()).filter((a) => a.profileId === profileId)
			await purgeRows(
				authwits,
				(authwit) => this.authwits.delete(`${authwit.id}`),
				(authwit) => this.emit("onAuthwitDeleted", authwit),
			)
			await purgeMalformedRows(
				this.authwits,
				(raw) => raw.profileId === profileId,
				(id) => this.logDebug(`purged malformed authwit row ${id}`),
			)
			await this.purgeStatuses((s) => s.profileId === profileId)
		})
	}

	/** Awaited authwit + status purge for one `(profileId, chainId)` — the chain-purge subscriber
	 *  (deleteNetwork and the profile-delete network cascade both reach it). */
	public async purgeChain(profileId: string, chainId: number): Promise<void> {
		await this.ensureInitialized()
		await this.lock.withLock(async () => {
			const authwits = (await this.authwits.getValues()).filter((a) => a.profileId === profileId && a.chainId === chainId)
			await purgeRows(
				authwits,
				(authwit) => this.authwits.delete(`${authwit.id}`),
				(authwit) => this.emit("onAuthwitDeleted", authwit),
			)
			await purgeMalformedRows(
				this.authwits,
				(raw) => raw.profileId === profileId && raw.chainId === chainId,
				(id) => this.logDebug(`purged malformed authwit row ${id}`),
			)
			await this.purgeStatuses((s) => s.profileId === profileId && s.chainId === chainId)
		})
	}

	/** Delete every registry-enabled row whose canonical tuple key matches `keep`. Attribution is
	 *  off the byte-canonical KEY, never a value (a status row's value is a bare boolean with no
	 *  identity), so a non-canonical/foreign key is left untouched. Caller holds the lock. */
	private async purgeStatuses(keep: (scope: { profileId: string; chainId: number; account: string }) => boolean): Promise<void> {
		for (const key of await this.statuses.getKeys()) {
			const scope = parseAuthwitStatusRowId(key)
			if (scope && keep(scope)) await this.statuses.delete(key)
		}
	}

	public async restore(authwits: Authwit[], profileId: string): Promise<Restored<Authwit>[]> {
		await this.ensureInitialized()
		// Deletion fence keyed on the composable's authoritative created-profile id. Fail closed:
		// dispatch has no schema validation.
		if (typeof profileId !== "string" || profileId.length === 0) {
			throw new Error("restore requires the created profile id")
		}
		const deletion = this.profileService.getDeletionState()
		const epochs = captureRestoreEpochs(deletion, [profileId])

		return await this.lock.withLock(async () => {
			// Duplicate identity is the compound (profileId, chainId, account, hash): the restored
			// rows are all forced to THIS profile, so a same-address sibling's existing row (a
			// different profileId) no longer false-blocks the restore, while a genuine in-profile
			// duplicate still does. Encoded injectively (JSON array): the strings are
			// attacker-shaped, so any in-band delimiter is forgeable. The seed comes from RAW
			// payloads — decoded reads hide malformed rows whose tuples must still block
			// duplicates; a row too corrupt to yield its fields has no identity to collide with.
			// NO cap check: these are already-granted authorizations, and rejecting a unique row
			// would destroy the only revocation index.
			const pairKeyOf = (chainId: number, account: string, hash: string) => JSON.stringify([profileId, chainId, account, hash])
			const seen = new Set<string>()
			for (const [, raw] of await this.authwits.rawStringEntries()) {
				try {
					const v = JSON.parse(raw) as { profileId?: unknown; chainId?: unknown; account?: unknown; hash?: unknown }
					if (
						v.profileId === profileId &&
						typeof v.chainId === "number" &&
						typeof v.account === "string" &&
						typeof v.hash === "string"
					) {
						seen.add(pairKeyOf(v.chainId, v.account, v.hash))
					}
				} catch {
					// No extractable identity — nothing to dedupe against.
				}
			}
			// Occupancy from the PHYSICAL key space: the cursor must never land on
			// a key a decoded read can't see (a hidden row would be overwritten).
			// Writes use canonical String(id), so noncanonical aliases can't
			// falsely collide.
			const occupied = new Set(await this.authwits.getKeys())
			let id = array_max((await this.authwits.getValues()).map((x) => x.id)) + 1
			// `id` advances only after a successful write: restoreRows routes a
			// throwing row to `restoreError` and never reaches the `id++`, so a
			// malformed authwit doesn't consume a cursor slot. Ordering inside the
			// writer is load-bearing: validate → dedupe-check → write → record —
			// a malformed or duplicate row must neither block nor poison a valid
			// sibling.
			return await restoreRows(authwits, async (authwit) => {
				// The safe-integer guard lives INSIDE the loop condition: a hostile
				// decodable row can sit at MAX_SAFE_INTEGER, past which the float
				// cursor stops advancing (id++ is a no-op) — an unguarded skip
				// loop would spin forever under the service-wide lock, and an
				// unguarded write would land key-identity-hidden on read. Fail
				// the ROW (restoreRows tags it), never the service.
				while (Number.isSafeInteger(id) && occupied.has(`${id}`)) id++
				if (!Number.isSafeInteger(id)) {
					throw new Error("authwit id space exhausted (hostile id boundary)")
				}
				// Parse the persisted shape, FORCING profileId to the threaded id — a hostile
				// backup's foreign profileId is overwritten, never trusted — so a malformed backup
				// authwit is recorded as restoreError, not silently written + codec-hidden on read.
				const row = AuthwitSchema.parse({ ...authwit, id, profileId })
				const pairKey = pairKeyOf(row.chainId, row.account, row.hash)
				if (seen.has(pairKey)) {
					throw new Error("authwit already exists (profile+chain+account+hash)")
				}
				assertRestoreEpoch(deletion, epochs, profileId)
				await this.authwits.set(`${id}`, row)
				occupied.add(`${id}`)
				seen.add(pairKey)
				id++
				return row
			})
		})
	}
}
