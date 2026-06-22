import { TxHash, TxStatus as AztecTxStatus, TxExecutionResult as AztecTxExecutionResult } from "@aztec/stdlib/tx"
import { toRestoreError } from "@/utils/restore-error"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import type { ILogger } from "@/wallet/logger"
import { AccountService, type Account } from "@/wallet/services/account/service"
import { NetworkService } from "@/wallet/services/network/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { StepContent, type WrappedTask } from "@/wallet/services/task/service"
import { purgeRows } from "@/wallet/services/purge-rows"
import { EntityStorage } from "@/wallet/storage"
import { sleep } from "@/wallet/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import {
	type Tx,
	type TxGasDetails,
	TRANSACTION_SERVICE_NAME,
	type LocalTxOrigin,
	type TxCall,
	TxStatus,
	TxExecutionResult,
	type Methods,
	type Events,
} from "./spec"
import type { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"

export * from "./spec"

export class TransactionService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()("getTransactions", "getTransaction")
	public static name = TRANSACTION_SERVICE_NAME

	public readonly onTransactionAdded = new EventHandler<Tx>()
	public readonly onTransactionUpdated = new EventHandler<Tx>()
	public readonly onTransactionDeleted = new EventHandler<Tx>()

	private readonly txs = new EntityStorage<Tx>("nulo:core:txs", chrome.storage.local)
	private readonly pending = new Map<string, Tx>()

	private profileService: ProfileService = null!
	private accountService: AccountService = null!
	private networkService: NetworkService = null!
	private pxeService: PxeServiceClient = null!

	public constructor(logger: ILogger) {
		super(TRANSACTION_SERVICE_NAME, logger)
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		this.accountService = services.get(AccountService.name)
		this.networkService = services.get(NetworkService.name)
		this.pxeService = new PxeServiceClient(this.logger)

		this.accountService.onAccountDeleted.add(this.onAccountDeleted)
		this.networkService.registerChainPurgeSubscriber(async (profileId, chainId) => this.clearChainState(profileId, chainId))

		for (const tx of (await this.txs.getValues()).filter((x) => x.status === TxStatus.Pending)) {
			this.pending.set(tx.hash, tx)
		}

		this.runWorker()
	}

	/**
	 * Wipe all transactions for `(profileId, chainId)`. Drops in-flight
	 * pending entries first so the polling worker stops touching them, then
	 * deletes the rows + emits `onTransactionDeleted`. Called by
	 * `NetworkService.purgeChain`.
	 *
	 * The `profileId` arg is unused — Tx records carry chainId but not
	 * profileId; we filter by chainId alone. Profile cleanup goes through
	 * `onAccountDeleted` for accuracy when multiple profiles share a chain.
	 */
	public async clearChainState(_profileId: string, chainId: number): Promise<void> {
		await this.ensureInitialized()
		const txs = (await this.txs.getValues()).filter((x) => x.chainId === chainId)
		await purgeRows(
			txs,
			(tx) => {
				this.pending.delete(tx.hash)
				return this.txs.delete(tx.hash)
			},
			(tx) => this.emit("onTransactionDeleted", tx),
		)
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
		estimatedFee?: string,
		gasDetails?: TxGasDetails,
	): Promise<Tx> {
		if (await this.txs.get(hash)) {
			throw new Error("duplicated hash")
		}
		const now = Date.now()
		// Capture the primary endpoint URL at submission time so receipt
		// polling stays bound to it across primary-endpoint swaps. Lookup
		// is best-effort — if the network record can't be resolved (e.g.
		// just deleted), the field stays undefined and polling falls back
		// to the chain's current primary at read time.
		let submittedEndpointUrl: string | undefined
		try {
			const networks = await this.networkService.getNetworks(chainId)
			const network = networks[0]
			submittedEndpointUrl = network?.endpoints.find((e) => e.id === network.primaryEndpointId)?.rpcUrl
		} catch {
			submittedEndpointUrl = undefined
		}
		const tx: Tx = {
			origin,
			chainId,
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
	}

	public async waitForTx(txHash: string, parentTask?: WrappedTask) {
		const waitForTxTask = parentTask?.startSubtask(new StepContent("Waiting for transaction"))
		while (this.pending.has(txHash)) {
			await sleep(100)
		}
		waitForTxTask?.complete()
	}

	private readonly onAccountDeleted = async (account: Account) => {
		this.logDebug(`Account ${account.address} deleted, remove related txs`)
		const txs = (await this.txs.getValues()).filter((x) => x.account === account.address)
		await purgeRows(
			txs,
			(tx) => {
				this.logDebug(`Remove tx ${tx.hash}`)
				this.pending.delete(tx.hash)
				return this.txs.delete(tx.hash)
			},
			(tx) => this.emit("onTransactionDeleted", tx),
		)
	}

	private async runWorker() {
		while (true) {
			if (this.pending.size) {
				const activeProfile = await this.profileService.getActiveProfile()
				if (activeProfile) {
					try {
						this.logDebug(`Sync ${this.pending.size} transactions...`)
						const start = Date.now()
						await Promise.allSettled([...this.pending.values()].map((x) => this.updateTx(x)))
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

	private async updateTx(tx: Tx) {
		this.logDebug(`Sync tx ${tx.hash.slice(0, 8)}`)
		// Pin polling to the endpoint that submitted this tx: staying on
		// the originating endpoint avoids transient receipt-not-yet-indexed
		// issues when the user swaps the network's primary endpoint mid-
		// pending. Falls back to the current primary if the URL is no
		// longer a known endpoint (deleted) — handled inside
		// `getNodeForUrl`.
		const node = tx.submittedEndpointUrl
			? await this.networkService.getNodeForUrl(tx.submittedEndpointUrl, tx.chainId)
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
		if (status === tx.status && executionResult === tx.executionResult) {
			this.logDebug(`Tx ${tx.hash.slice(0, 8)} still ${receipt.status}`)
			return
		}

		tx.updatedAt = Date.now()
		tx.status = status
		tx.executionResult = executionResult
		tx.block =
			receipt.blockHash && receipt.blockNumber ? { hash: receipt.blockHash.toString(), number: receipt.blockNumber } : undefined
		tx.fee = receipt.transactionFee?.toString()
		tx.error = receipt.error

		await this.txs.set(tx.hash, tx)
		this.emit("onTransactionUpdated", tx)
		if (tx.status !== TxStatus.Pending) {
			this.pending.delete(tx.hash)
		}
		this.logDebug(`Tx ${tx.hash.slice(0, 8)} ${receipt.status}`)
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
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}

		const networks = await this.networkService.getNetworks()
		if (!networks.length) {
			return undefined
		}

		const txs: Tx[] = []

		for (const n of networks) {
			const accounts = await this.accountService.getAccounts(profile.id, n.chainId)
			for (const acc of accounts) {
				txs.push(...(await this.getTransactions(acc.address)))
			}
		}

		return txs
	}

	public async restore(txs: Tx[]): Promise<Restored<Tx>[]> {
		await this.ensureInitialized()

		const result: Restored<Tx>[] = []

		for (const tx of txs) {
			try {
				await this.txs.set(tx.hash, tx)

				result.push(tx)
				if (tx.status !== TxStatus.Pending) continue

				this.pending.set(tx.hash, tx)
			} catch (err) {
				result.push({
					...tx,
					restoreError: toRestoreError(err),
				})
			}
		}

		return result
	}
}
