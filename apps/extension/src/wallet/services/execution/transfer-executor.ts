/**
 * `TransferExecutor` — the popup-initiated transfer flow (execute +
 * estimate), moved verbatim off the execution facade.
 *
 * Owns: journal creation for `transfer`-kind records, the cancel
 * controller surface (via the lane-shaped deps — see below), the
 * estimate-reuse fast path, and the activity-record shape (always
 * transfer-only, never the FPC-mutated calls — the card title must stay
 * the token symbol regardless of payment method).
 *
 * ## Lane-shaped deps
 *
 * Controller registration goes through `deps.lane` from day one so the
 * execution-lane seam swaps the IMPLEMENTATION behind this interface
 * instead of re-cutting executor control flow. NOTE the preserved
 * quirk: this flow takes NO execution slot (mutex) — only the
 * controller registry. Do NOT harmonize with the dApp-send flow.
 */

import type { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { TxExecutionRequest } from "@aztec/stdlib/tx"
import { type JobError, type JobProgress, JobCancelledSentinel, normalizeError } from "@nulo/wallet-core/jobs"
import { DuplicateInitializationError } from "@nulo/extension-messaging/errors"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import type { IAccountContract } from "@nulo/aztec-runtime/account"
import { formatFeeJuice } from "@/utils/fee-estimation"
import type { Network } from "@/wallet/services/network/service"
import { primaryEndpointUrl } from "@/wallet/services/network/spec"
import type { NewOperationInput, OperationRecord } from "@/wallet/services/operation-journal/spec"
import type { ProfileInfo } from "@/wallet/services/profile/service"
import type { ExecutionFence } from "@/wallet/services/profile/profile-deletion-state"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { type TaskService, type WrappedTask, TransferContent } from "@/wallet/services/task/service"
import { OriginType, type LocalTxOrigin, type TransactionService, type Tx } from "@/wallet/services/transaction/service"
import type { IPXE } from "@/wallet/services/pxe/client"
import type { ExecutionCoordinator } from "./execution-coordinator"
import type { FeeEstimate } from "./fee/fee-strategy"
import type { OperationPlanner, TransferRequest } from "./operation-planner"
import { maybeRethrowAsRpcCancel } from "./rpc-cancel"
import type { Action, FeeOptions, FeeSettings, TransferFeeEstimate } from "./spec"
import { fingerprintBaseFee, fingerprintFeeSettings, type TransferEstimateReuse } from "./transfer-estimate-reuse"
import { getEstimatedFee, getGasDetails } from "./tx-fee-details"

/** The resolved inputs the prove-and-send tail consumes, produced by either
 *  the reused-estimate arm or the fresh-build arm. */
type TransferBuildInputs = {
	txRequest: TxExecutionRequest
	node: AztecNode
	pxe: IPXE
	account: IAccountContract
	network: Network
	nonce: { toString(): string }
	feePaymentMethod: AccountFeePaymentMethodOptions
	initializesAccount: boolean | undefined
	activity: {
		token: { contract: string; name: string; symbol: string; decimals: number }
		fnName: string
		args: readonly unknown[]
	}
}

/** Controller-registry subset of the (future) execution lane. */
export interface TransferExecutorLane {
	registerController(journalId: string, controller: AbortController): void
	deleteController(journalId: string): void
}

export interface TransferExecutorDeps {
	tasks: TaskService
	planner: OperationPlanner
	estimateReuse: TransferEstimateReuse
	coordinator: ExecutionCoordinator
	lane: TransferExecutorLane
	getActiveProfile(): Promise<ProfileInfo | undefined>
	getNetwork(networkId: string): Promise<Network>
	getNode(chainId: number): Promise<AztecNode>
	getPXE(network: Network): IPXE
	getAccountContract(profileId: string, chainId: number, accountAddress: string): Promise<IAccountContract>
	getPendingForAccount(account: string): Tx[]
	/** Mirrors `TransactionService.addTransaction` — indexed type keeps the
	 *  seam in sync with the source signature. */
	addTransaction: TransactionService["addTransaction"]
	buildAndEstimate(
		inputOp: { networkId: string; accountAddress: string; actions: Action[]; fee?: FeeOptions },
		feeSettings: FeeSettings,
		parentTask?: WrappedTask,
		signal?: AbortSignal,
	): Promise<FeeEstimate>
	createJournalOperation(input: NewOperationInput): Promise<OperationRecord>
	transitionJournal(journalId: string, progress: JobProgress, error?: JobError | null): Promise<unknown>
	logDebug(msg: string): void
	logError(msg: string, ...rest: unknown[]): void
}

export class TransferExecutor {
	public constructor(private readonly deps: TransferExecutorDeps) {}

	public async execute(req: TransferRequest, precomputedEstimateId?: string, fence?: ExecutionFence): Promise<string> {
		const { networkId, accountAddress, tokenId, transferType, recipientAddress, amount } = req
		const origin: LocalTxOrigin = { type: OriginType.UI }
		const transferContent = new TransferContent(tokenId, transferType, accountAddress, recipientAddress, amount, networkId)
		const transferTask = this.deps.tasks.startNewTask(transferContent, undefined, origin)

		const { journalId, controller } = await this.createTransferJournal(req)
		const markJournal = async (progress: JobProgress, error?: JobError | null) => {
			if (!journalId) return
			try {
				await this.deps.transitionJournal(journalId, progress, error)
			} catch (err) {
				this.deps.logError("Failed to update journal operation", getErrorMessage(err))
			}
		}

		// checkCancelled reads the controller's signal at each stage boundary
		// and short-circuits with JobCancelledSentinel so the catch handler can
		// skip the failure path.
		const checkCancelled = (): void => {
			if (controller?.signal.aborted) throw new JobCancelledSentinel(journalId ?? "")
		}

		try {
			// Try the cached-estimate fast path first. Falls back to a fresh
			// build if the snapshot has drifted (base fee, primary endpoint,
			// or any input field) — conservative: any mismatch ⇒ rebuild.
			const reused = precomputedEstimateId ? await this.deps.estimateReuse.tryConsume(precomputedEstimateId, req) : undefined

			// Enter `simulating` BEFORE the build — the fee strategies inside
			// run real `simulateTx` calls which can take several seconds;
			// leaving the journal at `pending` would hide that work from the
			// popup. Reused-estimate path also enters `simulating` so the FSM
			// transition is uniform.
			await markJournal({ stage: "simulating" })
			checkCancelled()

			const { txRequest, node, pxe, account, network, nonce, feePaymentMethod, initializesAccount, activity } = reused
				? await this.fromReusedEstimate(reused, req, precomputedEstimateId)
				: await this.buildFresh(req, transferTask)
			const { token: activityToken, fnName: activityFnName, args: activityArgs } = activity

			// Activity-feed shape is always transfer-only (no FPC fee payload).
			// `txCalls` from the build carries the FPC mutation (`pay_fee` for
			// Private FPC, `fee_entrypoint_*` for Default FPC), which would
			// surface as the card title via `getPrimaryCall`. The hardcoded
			// shape preserves the pre-reuse behavior: card shows token symbol +
			// transfer type, regardless of fee payment method.
			const { txHash } = await this.deps.coordinator.proveAndSend({
				pxe,
				node,
				txRequest,
				initializesAccount,
				scopes: [account.address],
				parentTask: transferTask,
				checkCancelled,
				markJournal: (patch) => markJournal(patch),
				recordTransaction: (hash) =>
					this.deps.addTransaction(
						origin,
						network.chainId,
						accountAddress,
						[
							{
								contract: activityToken.contract,
								method: activityFnName,
								args: activityArgs.map((x) => String(x)),
								transfers: [
									{
										token: {
											name: activityToken.name,
											symbol: activityToken.symbol,
											decimals: activityToken.decimals,
										},
										type: transferType,
										from: accountAddress,
										to: recipientAddress,
										amount: amount.toString(),
									},
								],
							},
						],
						nonce.toString(),
						feePaymentMethod,
						hash,
						primaryEndpointUrl(network),
						getEstimatedFee(txRequest),
						getGasDetails(txRequest),
						fence,
						network.id,
					),
			})
			transferTask.complete()
			return txHash.toString()
		} catch (error) {
			// Journal already in `cancelled` (cancelJob did it); convert the
			// internal sentinel to the structured RPC-boundary error here.
			maybeRethrowAsRpcCancel(error, transferTask)
			// A classified initialization race keeps its own kind on the transfer
			// path too — the flag was threaded here precisely so a first-tx popup
			// transfer classifies the same as a dApp send.
			await markJournal(
				{ stage: "failed" },
				normalizeError(error, error instanceof DuplicateInitializationError ? "duplicate_initialization" : "transfer"),
			)
			transferTask.fail(error)
			throw error
		} finally {
			if (journalId) this.deps.lane.deleteController(journalId)
		}
	}

	/** Durable record of the in-flight operation. Survives SW restart and popup
	 *  close/reopen so consumers can recover a consistent view of "what is this
	 *  tx doing right now". FSM: pending → simulating → proving → submitting →
	 *  succeeded | failed | cancelled. Creation is best-effort — a journal
	 *  failure logs and returns an empty result, never blocks the transfer.
	 *  This helper OWNS the full `await create → new AbortController →
	 *  registerController` span: the controller must be registered in the SAME
	 *  continuation that sees the durable row, so `cancelJob(journalId)` can
	 *  never land in a settlement hop between the row becoming visible and the
	 *  controller existing (it would transition the row terminal, find nothing
	 *  to abort, and a later-installed controller would let proving continue). */
	private async createTransferJournal(
		req: TransferRequest,
	): Promise<{ journalId: string | undefined; controller: AbortController | undefined }> {
		let journalOp: OperationRecord | undefined
		try {
			const profile = await this.deps.getActiveProfile()
			if (profile) {
				journalOp = await this.deps.createJournalOperation({
					kind: "transfer",
					origin: "popup",
					profileId: profile.id,
					accountAddress: req.accountAddress,
					networkId: req.networkId,
					tokenId: req.tokenId,
					// Persist amount + recipient so terminal cards can render
					// the same info as awaiting/settled cards. amount is bigint
					// → string for JSON safety; field name matches
					// `balanceFormatted(rawAmount, decimals, length)`.
					amountRaw: req.amount.toString(),
					recipientAddress: req.recipientAddress,
					// Persist the privacy direction so the in-flight awaiting
					// card can render the Private/Public chip the settled card
					// shows. Resolved via `formatTransferType()` consumer-side.
					transferType: req.transferType,
				})
			}
		} catch (error) {
			this.deps.logError("Failed to create journal operation", getErrorMessage(error))
		}
		const journalId = journalOp?.id
		const controller = journalId ? new AbortController() : undefined
		if (journalId && controller) this.deps.lane.registerController(journalId, controller)
		return { journalId, controller }
	}

	/** Reused-estimate arm: the entry retains the exact build — its provenance
	 *  rides along; only the live handles (network/node/pxe/account) resolve. */
	private async fromReusedEstimate(
		reused: NonNullable<Awaited<ReturnType<TransferEstimateReuse["tryConsume"]>>>,
		req: TransferRequest,
		precomputedEstimateId: string | undefined,
	): Promise<TransferBuildInputs> {
		this.deps.logDebug(`executeTransfer: reusing precomputed estimate ${precomputedEstimateId}`)
		const network = await this.deps.getNetwork(req.networkId)
		const node = await this.deps.getNode(network.chainId)
		const pxe = this.deps.getPXE(network)
		const profile = await requireActiveProfile(this.deps, "Wallet locked")
		const account = await this.deps.getAccountContract(profile.id, network.chainId, req.accountAddress)
		return {
			txRequest: reused.txRequest,
			node,
			pxe,
			account,
			network,
			nonce: reused.nonce,
			feePaymentMethod: reused.feePaymentMethod,
			initializesAccount: reused.initializesAccount,
			activity: { token: reused.token, fnName: reused.fnName, args: reused.args },
		}
	}

	/** Fresh-build arm: plan the transfer, then build + estimate. The activity
	 *  inputs are captured from the PLAN, separately from the FPC-mutated
	 *  `buildAndEstimate` txCalls, so the persisted record stays just the
	 *  user-intent transfer (no `pay_fee` / `fee_entrypoint_*` fee-payload
	 *  pollution leaking into the activity card title). */
	private async buildFresh(req: TransferRequest, transferTask: WrappedTask): Promise<TransferBuildInputs> {
		const { op, token, fn, args } = await this.deps.planner.buildTransferOperation(req)
		const built = await this.deps.buildAndEstimate(op, op.feeSettings, transferTask)
		return {
			txRequest: built.txRequest,
			node: built.node,
			pxe: built.pxe,
			account: built.account,
			network: built.network,
			nonce: built.nonce,
			feePaymentMethod: built.feePaymentMethod,
			initializesAccount: built.initializesAccount,
			activity: {
				token: { contract: token.contract, name: token.name, symbol: token.symbol, decimals: token.decimals },
				fnName: fn.name,
				args,
			},
		}
	}

	public async estimateFee(req: TransferRequest, signal?: AbortSignal): Promise<TransferFeeEstimate> {
		const { networkId, accountAddress, tokenId, transferType, recipientAddress, amount } = req

		// Stage-boundary cancellation: an in-flight sim can't be preempted, but
		// each next stage — and critically the stash — must not run after a
		// cancel. A cancelled estimate never leaves a signed request cached.
		const checkCancelled = (): void => {
			if (signal?.aborted) throw new JobCancelledSentinel("")
		}
		checkCancelled()
		const { op, token, fn, args } = await this.deps.planner.buildTransferOperation(req)
		checkCancelled()

		const {
			txRequest,
			network,
			nonce,
			feePaymentMethod,
			initializesAccount: builtInitializes,
		} = await this.deps.buildAndEstimate(op, op.feeSettings, undefined, signal)
		checkCancelled()

		const maxFeeRaw = BigInt(getEstimatedFee(txRequest))

		// Stash the post-strategy build result for one-shot reuse on Confirm.
		// Embedded fee payments take a divergent execution path, so we don't
		// offer reuse for them — the popup will receive no `estimateId` and
		// `executeTransfer` falls through to the rebuild path. Same for
		// FeeJuiceWithClaim, which mutates actions during build.
		const reuseEligible = op.feeSettings.paymentMethod.kind === "fj" || op.feeSettings.paymentMethod.kind === "fpc"
		let estimateId: string | undefined
		if (reuseEligible) {
			try {
				const primary = network.endpoints.find((e) => e.id === network.primaryEndpointId)
				if (primary) {
					// Fingerprint the EXACT fee the txRequest was built with —
					// not a fresh fetch after the fact (codex audit
					// SHOULD-FIX #3). Both FJ and FPC strategies finalize
					// `maxFeesPerGas = predictedWorstMinFees * multiplier`, so
					// on consume we compare against the same live product.
					const builtFees = txRequest.txContext.gasSettings.maxFeesPerGas
					const baseFeeFingerprint = fingerprintBaseFee({
						feePerDaGas: builtFees.feePerDaGas,
						feePerL2Gas: builtFees.feePerL2Gas,
					})
					const profile = await requireActiveProfile(this.deps, "Wallet locked")
					const pendingHashes = this.deps.getPendingForAccount(accountAddress).map((tx) => tx.hash)
					estimateId = crypto.randomUUID()
					this.deps.estimateReuse.stash(estimateId, {
						networkId,
						accountAddress,
						tokenId,
						transferType,
						recipientAddress,
						amount,
						feeSettingsHash: fingerprintFeeSettings(op.feeSettings),
						profileId: profile.id,
						baseFeeFingerprint,
						primaryEndpointId: primary.id,
						primaryEndpointUrl: primary.rpcUrl,
						pendingHashes,
						txRequest,
						initializesAccount: builtInitializes,
						nonce,
						feePaymentMethod,
						token: { contract: token.contract, name: token.name, symbol: token.symbol, decimals: token.decimals },
						fnName: fn.name,
						args: args.map((x) => x),
						builtAt: Date.now(),
					})
				}
			} catch (error) {
				// Cache write is best-effort. The estimate result still goes
				// out — the popup just won't get a reuse token.
				this.deps.logDebug(`estimateTransferFee: cache write skipped: ${getErrorMessage(error)}`)
				estimateId = undefined
			}
		}

		return {
			maxFee: maxFeeRaw.toString(),
			maxFeeFormatted: formatFeeJuice(maxFeeRaw),
			gasDetails: getGasDetails(txRequest),
			estimateId,
		}
	}
}
