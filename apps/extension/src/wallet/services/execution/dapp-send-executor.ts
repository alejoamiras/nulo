/**
 * `DappSendExecutor` — the dApp-initiated send flows (standard,
 * aztec.js, NO_FROM/DefaultEntrypoint) plus dApp fee estimation, moved
 * verbatim off the execution facade.
 *
 * ## Lane-shaped deps
 *
 * Unlike the transfer flow, dApp sends DO take an execution slot: the
 * per-(profileId, chainId) FIFO mutex that keeps two approved sendTx
 * from interleaving their simulate/prove against shared private-note
 * state. The slot, the queued-record claim, the journal helpers, and
 * the controller registry all live behind `deps.lane` — the facade owns
 * the implementations today; the execution-lane seam swaps the wiring,
 * not this module's control flow.
 *
 * Frozen ordering invariants (do not reorder):
 *   - `acquireSlot` BEFORE the journal claim and any PXE-touching work.
 *     The session-FIFO baton releases inside the slot acquisition (via
 *     `onExecutionEnqueued`) the instant we're enqueued.
 *   - `journalId` hoisted outside the try so catch (mark failed) +
 *     finally (controller cleanup + slot release) run even if the claim
 *     or the post-claim cancel-check throws on a raced cancel —
 *     otherwise the slot leaks and the lane wedges until SW restart.
 *   - `simulating` marked BEFORE authwit discovery / the build, which
 *     run real `simulateTx` calls; `pending`'s short reaper grace is
 *     not a defensible ceiling for simulation time.
 */

import { CallAuthorizationRequest, computeAuthWitMessageHash } from "@aztec/aztec.js/authorization"
import { type InteractionWaitOptions, type SendReturn, extractOffchainOutput } from "@aztec/aztec.js/contracts"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { Fr } from "@aztec/foundation/curves/bn254"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import { collectOffchainEffects } from "@aztec/stdlib/tx"
import { assertLiveChainIdentity } from "@nulo/aztec-runtime/utils"
import { type JobError, type JobProgress, JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { markFailedUnlessCancelled } from "./mark-failed-unless-cancelled"
import { formatFeeJuice } from "@/utils/fee-estimation"
import { pickPrimaryMethod } from "@/utils/primary-method"
import { primaryEndpointUrl } from "@/wallet/services/network/spec"
import type { ExecutionHooks } from "@/wallet/services/dapp-interaction/spec"
import type { WrappedTask } from "@/wallet/services/task/service"
import type { LocalTxOrigin, TransactionService } from "@/wallet/services/transaction/service"
import type { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import type { Network } from "@/wallet/services/network/service"
import type { FpcInfo } from "@/wallet/services/fpc/spec"
import type { DiscoveryAwareEstimator } from "./discovery-aware-estimator"
import type { ExecutionCoordinator } from "./execution-coordinator"
import type { ExecutionMutexRelease } from "./execution-mutex"
import type { OperationEstimateReuse, OperationEstimateReuseEntry } from "./operation-estimate-reuse"
import { fingerprintOperation, type OperationFingerprintInput } from "./operation-fingerprint"
import { fingerprintBaseFee } from "./transfer-estimate-reuse"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { applyEmbeddedFpcGasCap } from "./fee/embedded-fpc-cap"
import { type FeeEstimate, finalizeGasLimits, suggestGasLimits } from "./fee/fee-strategy"
import type { OperationPlanner } from "./operation-planner"
import type {
	Action,
	AztecSendTxOperation,
	FeeOptions,
	FeeSettings,
	Operation,
	SendTransactionOperation,
	TransferFeeEstimate,
} from "./spec"
import type { TxRequestBuilder } from "./tx-request-builder"
import type { ExecutionFence } from "@/wallet/services/profile/profile-deletion-state"
import { getEstimatedFee, getGasDetails } from "./tx-fee-details"
import { detectEmbeddedFeePayment } from "./utils/fee-detection"

/** Project an `Action[]` (a discriminated union with non-call variants like
 *  `AddCapsuleAction`) into the carrier shape `pickPrimaryMethod` expects.
 *  Inlined here rather than in `primary-method.ts` because that helper is
 *  layer-agnostic — importing `Action` from the execution spec would invert
 *  the dependency direction. */
function pickActionMethod(actions: readonly Action[] | undefined): string | undefined {
	const carriers: Array<{ method?: string; name?: string }> = []
	for (const action of actions ?? []) {
		if (action.kind === "call") carriers.push({ method: action.method })
		else if (action.kind === "encoded_call") carriers.push({ name: action.name ?? action.selector })
	}
	return pickPrimaryMethod(carriers)
}

/** Execution-lane subset the dApp-send flows depend on: the FIFO slot,
 *  the queued-record claim, the journal helpers, and the controller
 *  registry. Implementations live on the facade today. */
export interface DappSendExecutorLane {
	registerController(journalId: string, controller: AbortController): void
	deleteController(journalId: string): void
	acquireSlot(
		networkId: string,
		queuedJournalId: string | undefined,
		onEnqueued?: () => void,
		originKey?: string,
	): Promise<{ release: ExecutionMutexRelease; preController: AbortController | undefined }>
	claimOrCreateJournal(
		networkId: string,
		accountAddress: string,
		origin: LocalTxOrigin,
		calls: { method?: string }[] | undefined,
		hooks: ExecutionHooks | undefined,
		reuseController?: AbortController,
		fence?: ExecutionFence,
	): Promise<{ journalId: string | undefined; controller: AbortController | undefined }>
	beginJournal(
		networkId: string,
		accountAddress: string,
		origin: LocalTxOrigin,
		calls?: { method?: string }[],
		fence?: ExecutionFence,
	): Promise<string | undefined>
	markJournal(journalId: string | undefined, progress: JobProgress, error?: JobError | null): Promise<void>
}

export interface DappSendExecutorDeps {
	planner: OperationPlanner
	txBuilder: TxRequestBuilder
	coordinator: ExecutionCoordinator
	lane: DappSendExecutorLane
	/** Discover-then-estimate pipeline — the ONLY route to probed/folded
	 *  strategy instances. Distinctly typed from the validated dep so
	 *  probe-forbidden paths (executeSendTransaction, embedded, NO_FROM)
	 *  cannot reach it by construction. */
	estimateWithDiscovery: DiscoveryAwareEstimator
	/** Estimate→confirm reuse for standard-mode aztec_sendTx (fj/fpc). */
	operationEstimateReuse: OperationEstimateReuse
	getActiveProfile(): Promise<{ id: string } | undefined>
	getNetwork(networkId: string): Promise<Network>
	getNode(chainId: number): Promise<FeeEstimate["node"]>
	getPXE(network: Network): FeeEstimate["pxe"]
	getAccountContract(profileId: string, chainId: number, accountAddress: string): Promise<FeeEstimate["account"]>
	getPendingForAccount(account: string): { hash: string }[]
	/** Fresh decorated FPC row — identity snapshot for fpc-kind reuse entries. */
	getFpcInfo(fpcId: string): Promise<FpcInfo>
	/** The probe-free validated pipeline (the service's strategy map). */
	buildAndEstimateValidated(
		inputOp: { networkId: string; accountAddress: string; actions: Action[]; fee?: FeeOptions },
		feeSettings: FeeSettings,
		parentTask?: WrappedTask,
		signal?: AbortSignal,
	): Promise<FeeEstimate>
	/** Mirrors `TransactionService.addTransaction` — indexed type keeps the
	 *  seam in sync with the source signature. */
	addTransaction: TransactionService["addTransaction"]
	/** Mirrors `AuthRegistryService.recordPendingAuthwits` — records the build's
	 *  public authwits at the post-send tail as pending, tx-linked rows. */
	recordPendingAuthwits: AuthRegistryService["recordPendingAuthwits"]
	logDebug(msg: string): void
}

export class DappSendExecutor {
	public constructor(private readonly deps: DappSendExecutorDeps) {}

	/**
	 * Shared execution-slot scaffold for the two slot-taking dApp-send paths
	 * (standard `aztec_sendTx` + NO_FROM). Owns ONLY the invariant-critical
	 * choreography; each caller's `run` closure owns its own `simulating`
	 * checkpoint and body.
	 *
	 * Frozen ordering (do not reorder — see execution-lane.ts header):
	 *   - `acquireSlot` BEFORE the journal claim and any PXE work (the
	 *     session-FIFO baton releases inside acquisition via `onEnqueued`).
	 *   - `journalId` hoisted OUTSIDE the try so catch (mark failed) +
	 *     finally (controller cleanup + slot release) run even if the claim
	 *     or the post-claim cancel-check throws on a raced cancel — otherwise
	 *     the slot leaks and the (profileId, chainId) lane wedges until SW
	 *     restart.
	 *   - the post-claim `checkCancelled()` surfaces a cancel that landed
	 *     during the claim's await-chain BEFORE any side-effecting work; the
	 *     `simulating` transition is deliberately NOT here — a fixed point
	 *     would change the standard path's invalid-from / payload-parse
	 *     failure FSM and add a NO_FROM checkpoint that does not exist today.
	 */
	private async runInSlot<T>(
		params: {
			networkId: string
			accountAddress: string
			origin: LocalTxOrigin
			hooks: ExecutionHooks | undefined
			// The AUTHORIZATION-time fence. The journal create must carry THIS
			// epoch, not one recaptured after the FIFO wait: a profile deleted
			// and reimported under the same id while the operation queued would
			// otherwise mint a fresh epoch and file the stale operation into the
			// successor incarnation.
			fence: ExecutionFence | undefined
			// A THUNK, not a value: the primary-method extraction reads the
			// (potentially large / adversarial) `op.exec.calls`, and must run
			// AFTER `acquireSlot` — computing it earlier would delay our FIFO
			// enqueue (letting a later request overtake) and move any throw out
			// of the acquire-protected try. Evaluated below, inside the try.
			getCalls: () => { method?: string }[] | undefined
		},
		run: (ctx: {
			journalId: string | undefined
			checkCancelled: () => void
			markJournal: (patch: JobProgress) => Promise<void>
		}) => Promise<T>,
	): Promise<T> {
		const { release: releaseSlot, preController } = await this.deps.lane.acquireSlot(
			params.networkId,
			params.hooks?.queuedJournalId,
			params.hooks?.onExecutionEnqueued,
			params.hooks?.originKey,
		)

		let journalId: string | undefined
		try {
			const claimed = await this.deps.lane.claimOrCreateJournal(
				params.networkId,
				params.accountAddress,
				params.origin,
				params.getCalls(),
				params.hooks,
				preController,
				params.fence,
			)
			journalId = claimed.journalId
			const controller = claimed.controller
			const checkCancelled = (): void => {
				if (controller?.signal.aborted) throw new JobCancelledSentinel(journalId ?? "")
			}
			checkCancelled()

			return await run({
				journalId,
				checkCancelled,
				markJournal: (patch) => this.deps.lane.markJournal(journalId, patch),
			})
		} catch (error) {
			await markFailedUnlessCancelled(error, journalId, this.deps.lane)
			throw error
		} finally {
			if (journalId) this.deps.lane.deleteController(journalId)
			// A pre-claim throw leaves `journalId` unset while `acquireSlot`
			// already registered the pre-controller under `queuedJournalId`;
			// the fresh-id fallbacks also make the two keys DIFFER after a
			// successful claim. Delete under both (idempotent) — always before
			// the slot release, matching the P17 ordering contract.
			const queuedKey = params.hooks?.queuedJournalId
			if (queuedKey && queuedKey !== journalId) this.deps.lane.deleteController(queuedKey)
			releaseSlot()
		}
	}

	public async estimateOperationFee(operation: Operation, feeSettings: FeeSettings, signal?: AbortSignal): Promise<TransferFeeEstimate> {
		if (operation.kind !== "send_transaction" && operation.kind !== "aztec_sendTx") {
			throw new Error("Only send_transaction and aztec_sendTx operations support fee estimation")
		}
		// Stage-boundary cancellation — see TransferExecutor.estimateFee.
		const checkCancelled = (): void => {
			if (signal?.aborted) throw new JobCancelledSentinel("")
		}
		checkCancelled()

		// Build actions array — clone to prevent mutation side effects
		let actions: Action[]
		let detectedFee: FeeOptions | undefined
		if (operation.kind === "aztec_sendTx") {
			const { actions: processedActions, feeOptions: fee } = await this.deps.planner.processAztecJsPayload(
				(operation as AztecSendTxOperation).exec,
				(operation as AztecSendTxOperation).opts ?? {},
			)
			actions = [...processedActions]
			detectedFee = fee
		} else {
			actions = [...(operation as SendTransactionOperation).actions]
		}
		// Reuse fingerprints bind the POST-PLANNER, PRE-DISCOVERY action set —
		// the consume side re-derives the same normalization point.
		const preDiscoveryActions = [...actions]

		// Discover-then-estimate via the decorator (the single owner of that
		// choreography for dApp sends; stage-boundary cancellation preserved
		// inside it).
		checkCancelled()
		const { built } = await this.deps.estimateWithDiscovery.estimate(operation, actions, detectedFee, feeSettings, undefined, signal)
		const { txRequest } = built
		checkCancelled()

		const estimateId = await this.stashOperationEstimate(operation, feeSettings, detectedFee, preDiscoveryActions, built)

		const maxFeeRaw = BigInt(getEstimatedFee(txRequest))
		return {
			maxFee: maxFeeRaw.toString(),
			maxFeeFormatted: formatFeeJuice(maxFeeRaw),
			gasDetails: getGasDetails(txRequest),
			estimateId,
		}
	}

	/** Best-effort reuse stash. Eligibility mirrors the Send-page cache's
	 *  fj/fpc rule, narrowed to standard-mode `aztec_sendTx`:
	 *  `send_transaction`'s confirm path skips authwit discovery today, so
	 *  reusing a discovery-inclusive estimate there would CHANGE its
	 *  behavior — it stays carve-out. Embedded fee payments keep their
	 *  divergent-path exclusion. A non-fingerprintable op (exotic arg
	 *  values) is silently ineligible — the estimate itself still returns. */
	private async stashOperationEstimate(
		operation: Operation,
		feeSettings: FeeSettings,
		detectedFee: FeeOptions | undefined,
		preDiscoveryActions: readonly Action[],
		built: FeeEstimate,
	): Promise<string | undefined> {
		const kind = feeSettings.paymentMethod.kind
		const eligible =
			operation.kind === "aztec_sendTx" &&
			((operation as AztecSendTxOperation).executionMode ?? "standard") !== "default_entrypoint" &&
			!detectedFee?.embeddedFeePayment &&
			// A dApp-supplied fee cap makes the built request's maxFees diverge
			// from the predicted-worst basis the consume ladder re-derives, so
			// such an entry would ALWAYS miss on "base fee drift" — stashing it
			// only parks an unusable signed request for the TTL.
			!detectedFee?.maxFeesPerGas &&
			(kind === "fj" || kind === "fpc")
		if (!eligible) return undefined
		try {
			const input: OperationFingerprintInput = {
				networkId: operation.networkId,
				accountAddress: operation.accountAddress,
				executionMode: (operation as AztecSendTxOperation).executionMode ?? "standard",
				from: (operation as AztecSendTxOperation).opts?.from?.toString() ?? "",
				actions: preDiscoveryActions,
				fee: detectedFee,
				feeSettings,
			}
			const fingerprint = fingerprintOperation(input)
			if (fingerprint === null) return undefined
			const primary = built.network.endpoints.find((e) => e.id === built.network.primaryEndpointId)
			if (!primary) return undefined
			const profile = await this.deps.getActiveProfile()
			if (!profile) return undefined
			let fpcIdentity: OperationEstimateReuseEntry["fpcIdentity"]
			if (feeSettings.paymentMethod.kind === "fpc") {
				const info = await this.deps.getFpcInfo(feeSettings.paymentMethod.fpcId)
				fpcIdentity = {
					id: info.id,
					type: info.type,
					address: info.address,
					chainId: info.chainId,
					isProtocol: info.isProtocol ?? false,
				}
			}
			const builtFees = built.txRequest.txContext.gasSettings.maxFeesPerGas
			const estimateId = crypto.randomUUID()
			this.deps.operationEstimateReuse.stash(estimateId, {
				fingerprint,
				accountAddress: operation.accountAddress,
				networkId: operation.networkId,
				feeSettings,
				profileId: profile.id,
				// The BUILDER's asserted pair, never a refetch — a refetch after
				// an endpoint flip would snapshot a chain this request was not
				// signed under (consume would then compare live-vs-live).
				chainIdentity: built.chainIdentity,
				baseFeeFingerprint: fingerprintBaseFee({
					feePerDaGas: builtFees.feePerDaGas,
					feePerL2Gas: builtFees.feePerL2Gas,
				}),
				primaryEndpointId: primary.id,
				primaryEndpointUrl: primary.rpcUrl,
				pendingHashes: this.deps.getPendingForAccount(operation.accountAddress).map((tx) => tx.hash),
				fpcIdentity,
				txRequest: built.txRequest,
				initializesAccount: built.initializesAccount,
				nonce: built.nonce,
				feePaymentMethod: built.feePaymentMethod,
				txCalls: built.txCalls,
				pendingPublicAuthwits: built.pendingPublicAuthwits,
				builtAt: Date.now(),
			})
			return estimateId
		} catch (error) {
			// Cache write is best-effort — the estimate result still goes out.
			this.deps.logDebug(`estimateOperationFee: cache write skipped: ${getErrorMessage(error)}`)
			return undefined
		}
	}

	public async executeSendTransaction(
		op: SendTransactionOperation,
		origin: LocalTxOrigin,
		parentTask?: WrappedTask,
		fence?: ExecutionFence,
		hooks?: ExecutionHooks,
	): Promise<string> {
		// JS-context trust boundary: approveInteraction() at
		// dapp-interaction/service.ts ships popup-built operations through
		// without further validation. If the popup leaks a draft op with
		// feeSettings undefined, surface a clear error here BEFORE
		// downstream code dereferences feeSettings.priorityLevel /
		// paymentMethod.kind and surfaces a confusing TypeError to the user.
		if (!op.feeSettings) {
			throw new Error("send_transaction: feeSettings is required")
		}

		// B-02: take the shared execution slot + journal scaffold (runInSlot) like
		// the other two dApp-send pipelines. Without it, two concurrent
		// send_transaction ops (e.g. a dApp calling grantPublicAuthwit twice, or one
		// racing an in-flight aztec_sendTx on the same account) run simulateTx/proveTx
		// concurrently against the same PXE + account → stale-private-note interleaving
		// → double-spent nullifier / on-chain-rejected tx. The journal record is
		// created inside claimOrCreateJournal (identical shape to the prior
		// beginJournal); the primary-method calls are a thunk so they read after
		// acquireSlot. hooks (esp. originKey) bucket the slot per-origin.
		const primaryMethod = pickActionMethod(op.actions)
		return this.runInSlot(
			{
				networkId: op.networkId,
				accountAddress: op.accountAddress,
				origin,
				hooks,
				fence,
				getCalls: () => (primaryMethod ? [{ method: primaryMethod }] : undefined),
			},
			async ({ checkCancelled, markJournal }) => {
				// Enter `simulating` BEFORE the build/estimate work — fee
				// strategies inside the build run real simulateTx calls (can be
				// several seconds), and leaving the journal at `pending` would
				// hide that from the popup.
				await markJournal({ stage: "simulating" })
				checkCancelled()

				const {
					txRequest,
					node,
					pxe,
					account,
					network,
					nonce,
					txCalls,
					feePaymentMethod,
					pendingPublicAuthwits,
					initializesAccount,
				} = await this.deps.buildAndEstimateValidated(op, op.feeSettings, parentTask)

				const { txHash } = await this.deps.coordinator.proveAndSend({
					pxe,
					node,
					txRequest,
					initializesAccount,
					scopes: [account.address],
					parentTask,
					checkCancelled,
					markJournal,
					// One post-send closure owns BOTH the activity record AND the public-authwit
					// index write. grantPublicAuthwit routes here (kind: send_transaction), so this
					// is where a granted authwit is recorded — pending, reconciled by tx outcome.
					recordTransaction: async (hash) => {
						await this.deps.addTransaction(
							origin,
							network.chainId,
							account.address.toString(),
							txCalls,
							nonce.toString(),
							feePaymentMethod,
							hash,
							primaryEndpointUrl(network),
							getEstimatedFee(txRequest),
							getGasDetails(txRequest),
							fence,
							op.networkId,
						)
						if (pendingPublicAuthwits.length > 0) {
							await this.deps.recordPendingAuthwits(account.address.toString(), pendingPublicAuthwits, hash)
						}
					},
				})
				return txHash.toString()
			},
		)
	}

	public async executeAztecSendTx(
		op: AztecSendTxOperation,
		origin: LocalTxOrigin,
		parentTask?: WrappedTask,
		hooks?: ExecutionHooks,
		fence?: ExecutionFence,
		estimateId?: string,
	): Promise<SendReturn<InteractionWaitOptions>> {
		// `default_entrypoint` is a special dApp path that bypasses the
		// standard tx-build pipeline and runs its own kernelless discovery.
		// Forward hooks so concurrent NO_FROM sendTx still get the FIFO baton
		// release at the right point (and benefit from the queued-record
		// claim if one was pre-allocated).
		if (op.executionMode === "default_entrypoint") {
			return this.executeNoFromSendTx(op, origin, parentTask, hooks, fence)
		}

		// JS-context trust boundary: approveInteraction() ships popup-built
		// operations through without further validation. If the popup leaks
		// a draft op with feeSettings undefined, surface a clear error here
		// BEFORE the build dereferences feeSettings.priorityLevel /
		// paymentMethod.kind. (executeNoFromSendTx tolerates missing
		// feeSettings by design — the dApp handles fee payment.)
		if (!op.feeSettings) {
			throw new Error("aztec_sendTx: feeSettings is required for the standard execution path")
		}

		// The standard path takes the shared execution slot + journal scaffold
		// (runInSlot); its `run` owns the opts.from guard, payload parse, its own
		// `simulating` checkpoint, authwit discovery, build, and prove/send. The
		// primary-method extraction is a thunk so it runs after acquireSlot.
		return this.runInSlot(
			{
				networkId: op.networkId,
				accountAddress: op.accountAddress,
				origin,
				hooks,
				fence,
				getCalls: () => {
					// The shared picker, NOT the raw first call: a self-pay claim's fee payload leads the list
					// (e.g. [claim_and_end_setup, claim_public]) and the raw pick titles it "Claim Fee Juice"
					// while proving, flipping to the real method once the settled record is built.
					const primaryMethod = Array.isArray(op.exec?.calls) ? pickPrimaryMethod(op.exec.calls) : undefined
					return primaryMethod ? [{ method: primaryMethod }] : undefined
				},
			},
			async ({ checkCancelled, markJournal }) => {
				if (op.accountAddress !== op.opts?.from?.toString()) {
					throw new Error("Invalid `opts.from`")
				}

				const { actions, feeOptions: fee } = await this.deps.planner.processAztecJsPayload(op.exec, op.opts)

				// Enter `simulating` BEFORE authwit discovery (which runs real
				// `pxe.simulateTx`). Keeps the holder out of the short-grace `pending`
				// window during a potentially-slow discovery + build. Marked HERE (not
				// in runInSlot) so it stays AFTER the opts.from guard + payload parse —
				// those failures must remain `pending → failed`, not go via simulating.
				await markJournal({ stage: "simulating" })
				checkCancelled()

				// Estimate→confirm reuse: consume validates the full drift ladder
				// (fingerprint at the same pre-discovery normalization point, profile,
				// endpoint, pending set, chain identity, FPC identity, base fee).
				// Any miss falls through to the full discovery + build below.
				const reused = estimateId
					? await this.deps.operationEstimateReuse.tryConsume(estimateId, {
							networkId: op.networkId,
							accountAddress: op.accountAddress,
							executionMode: op.executionMode ?? "standard",
							from: op.opts?.from?.toString() ?? "",
							actions,
							fee,
							feeSettings: op.feeSettings,
						})
					: undefined

				let txRequest: FeeEstimate["txRequest"]
				let node: FeeEstimate["node"]
				let pxe: FeeEstimate["pxe"]
				let account: FeeEstimate["account"]
				let network: Network
				let nonce: { toString(): string }
				let txCalls: FeeEstimate["txCalls"]
				let feePaymentMethod: FeeEstimate["feePaymentMethod"]
				let pendingPublicAuthwits: FeeEstimate["pendingPublicAuthwits"]
				let initializesAccount: boolean | undefined

				if (reused) {
					this.deps.logDebug(`[executeAztecSendTx] reusing precomputed estimate ${estimateId}`)
					// Live handles are re-resolved, never cached — the cross-profile
					// fail-closed property depends on this.
					network = await this.deps.getNetwork(op.networkId)
					node = await this.deps.getNode(network.chainId)
					pxe = this.deps.getPXE(network)
					const profile = await this.deps.getActiveProfile()
					if (!profile) throw new Error("Wallet locked")
					account = await this.deps.getAccountContract(profile.id, network.chainId, op.accountAddress)
					txRequest = reused.txRequest
					// The entry retains the exact build — its provenance rides along.
					initializesAccount = reused.initializesAccount
					nonce = reused.nonce
					txCalls = reused.txCalls
					feePaymentMethod = reused.feePaymentMethod
					pendingPublicAuthwits = [...reused.pendingPublicAuthwits]
				} else if (fee.embeddedFeePayment) {
					// Embedded fee payments skip discovery entirely — the dApp's own
					// fee calls conflict with the discovery simulation's dummy fee
					// method. Probe-free validated pipeline, as always.
					checkCancelled()
					;({
						txRequest,
						node,
						pxe,
						account,
						network,
						nonce,
						txCalls,
						feePaymentMethod,
						pendingPublicAuthwits,
						initializesAccount,
					} = await this.deps.buildAndEstimateValidated({ ...op, actions, fee }, op.feeSettings, parentTask))
				} else {
					const { built, discoveredActions } = await this.deps.estimateWithDiscovery.estimate(
						op,
						actions,
						fee,
						op.feeSettings,
						parentTask,
					)
					if (discoveredActions.length) {
						this.deps.logDebug(
							`[executeAztecSendTx] Discovered ${discoveredActions.length} auth witness(es) via offchain effects`,
						)
					}
					checkCancelled()
					;({
						txRequest,
						node,
						pxe,
						account,
						network,
						nonce,
						txCalls,
						feePaymentMethod,
						pendingPublicAuthwits,
						initializesAccount,
					} = built)
				}

				const sendAdditionalScopes = Array.isArray(op.opts.additionalScopes) ? op.opts.additionalScopes : []
				const { txHash, offchainOutput } = await this.deps.coordinator.proveAndSend({
					pxe,
					node,
					txRequest,
					initializesAccount,
					scopes: [account.address, ...sendAdditionalScopes],
					parentTask,
					checkCancelled,
					markJournal,
					wantOffchainOutput: (provedTx) => {
						const timestamp = provedTx.publicInputs.constants.anchorBlockHeader.globalVariables.timestamp
						return extractOffchainOutput(provedTx.getOffchainEffects(), BigInt(timestamp))
					},
					// One post-send closure owns BOTH the activity record AND the public-authwit
					// index write, so ordering is explicit. Recording here (not at build) is what
					// keeps estimate/reject from leaking a grant; the rows land `pending` and are
					// reconciled by the tx's on-chain outcome (onTransactionUpdated).
					recordTransaction: async (hash) => {
						await this.deps.addTransaction(
							origin,
							network.chainId,
							account.address.toString(),
							txCalls,
							nonce.toString(),
							feePaymentMethod,
							hash,
							primaryEndpointUrl(network),
							getEstimatedFee(txRequest),
							getGasDetails(txRequest),
							fence,
							op.networkId,
						)
						if (pendingPublicAuthwits.length > 0) {
							await this.deps.recordPendingAuthwits(account.address.toString(), pendingPublicAuthwits, hash)
						}
					},
				})

				if (op.opts.wait === "NO_WAIT") {
					return { txHash, ...offchainOutput } as SendReturn<InteractionWaitOptions>
				}
				const receipt = await node.getTxReceipt(txHash)
				return { receipt, ...offchainOutput } as SendReturn<InteractionWaitOptions>
			},
		)
	}

	/**
	 * Execute a NO_FROM (DefaultEntrypoint) transaction.
	 * The dApp's ExecutionPayload is passed directly to DefaultEntrypoint — no account
	 * contract wrapping, no wallet auth witness discovery, no call mutation.
	 */
	private async executeNoFromSendTx(
		op: AztecSendTxOperation,
		origin: LocalTxOrigin,
		parentTask?: WrappedTask,
		hooks?: ExecutionHooks,
		fence?: ExecutionFence,
	): Promise<SendReturn<InteractionWaitOptions>> {
		this.deps.logDebug(
			`executeNoFromSendTx: starting, accountAddress=${op.accountAddress}, calls=${op.exec?.calls?.length}, additionalScopes=${JSON.stringify(op.opts?.additionalScopes)}`,
		)
		if (op.feeSettings?.paymentMethod?.kind && op.feeSettings.paymentMethod.kind !== "embedded") {
			throw new Error("DefaultEntrypoint transactions must use embedded fee payment")
		}

		// NO_FROM takes the SAME shared execution slot + journal scaffold
		// (runInSlot) as the standard path. It has no nonce at all (history
		// records Fr.ZERO), so the mutex is its ONLY protection against
		// concurrent build/simulate interleaving. Unlike the standard path it
		// does NOT re-check cancel after `simulating` — preserved verbatim. The
		// primary-method extraction is a thunk so it runs after acquireSlot.
		return this.runInSlot(
			{
				networkId: op.networkId,
				accountAddress: op.accountAddress,
				origin,
				hooks,
				fence,
				getCalls: () => {
					// The shared picker, NOT the raw first call: a self-pay claim's fee payload leads the list
					// (e.g. [claim_and_end_setup, claim_public]) and the raw pick titles it "Claim Fee Juice"
					// while proving, flipping to the real method once the settled record is built.
					const primaryMethod = Array.isArray(op.exec?.calls) ? pickPrimaryMethod(op.exec.calls) : undefined
					return primaryMethod ? [{ method: primaryMethod }] : undefined
				},
			},
			async ({ checkCancelled, markJournal }) => {
				await markJournal({ stage: "simulating" })

				const { txRequest, node, pxe, account, network, txCalls, txsLimits } = await this.deps.txBuilder.buildNoFrom(op, parentTask)
				this.deps.logDebug(
					`executeNoFromSendTx: buildNoFromTxRequest completed, txCalls=${txCalls.length}, account=${account.address.toString()}`,
				)

				// NO_FROM is enforced (above) to use embedded payment, so we mark
				// `embeddedFeePayment` explicitly here (the planner-built path infers
				// it; this code path constructs `feeOpts` inline so it must set it).
				// That gates `applyEmbeddedFpcGasCap` to fire as expected — see the
				// helper's JSDoc for the cap rationale.
				const maxFeesUpstream = op.opts.fee?.gasSettings?.maxFeesPerGas
				const feeOpts: FeeOptions = {
					embeddedFeePayment: detectEmbeddedFeePayment(op.exec?.feePayer, op.opts.from) ?? "fpc",
					gasLimits: op.opts.fee?.gasSettings?.gasLimits,
					teardownGasLimits: op.opts.fee?.gasSettings?.teardownGasLimits,
					maxFeesPerGas: maxFeesUpstream
						? { feePerDaGas: maxFeesUpstream.feePerDaGas.toString(), feePerL2Gas: maxFeesUpstream.feePerL2Gas.toString() }
						: undefined,
					gasPadding: 1,
				}
				suggestGasLimits(txRequest, feeOpts)
				await applyEmbeddedFpcGasCap(txRequest, feeOpts, node)

				// Kernelless auth witness discovery: stub the user's account so verify_private_authwit
				// doesn't fail on missing witnesses. The stub accepts any authwit during simulation.
				// The discovery result is ONLY used to read offchain effects — never for proving or gas estimation.
				const dappScopes: AztecAddress[] = Array.isArray(op.opts.additionalScopes) ? op.opts.additionalScopes : []
				// Dedup by hex (AztecAddress is a class — Set de-dups by ref, not value).
				const scopeByHex = new Map<string, AztecAddress>()
				for (const s of dappScopes) scopeByHex.set(s.toString(), s)
				const additionalScopes = [...scopeByHex.values()]
				const scopeWithAccountByHex = new Map<string, AztecAddress>()
				scopeWithAccountByHex.set(account.address.toString(), account.address)
				for (const s of dappScopes) scopeWithAccountByHex.set(s.toString(), s)
				const scopesWithAccount = [...scopeWithAccountByHex.values()]
				this.deps.logDebug(
					`executeNoFromSendTx: dappScopes=${JSON.stringify(dappScopes)}, additionalScopes=${JSON.stringify(additionalScopes)}, scopesWithAccount=${JSON.stringify(scopesWithAccount)}`,
				)

				this.deps.logDebug(`executeNoFromSendTx: starting kernelless discovery simulation`)
				const discoveryResult = await pxe.simulateTx(
					txRequest,
					{ simulatePublic: true, skipTxValidation: true, skipFeeEnforcement: true, scopes: additionalScopes },
					[account.address.toString()],
				)

				this.deps.logDebug(`executeNoFromSendTx: kernelless discovery completed`)
				// Extract auth witness requirements from CallAuthorizationRequest offchain effects
				const effects = collectOffchainEffects(discoveryResult.privateExecutionResult)
				this.deps.logDebug(`executeNoFromSendTx: offchain effects found: ${effects.length}`)
				if (effects.length) {
					const nodeInfo2 = await node.getNodeInfo()
					// F-012 / A-01 V-01: NO_FROM path also derives chainInfo from
					// live node — rebind to selected network before constructing
					// the authwit message hash.
					assertLiveChainIdentity(network, nodeInfo2)
					const chainInfo = { chainId: new Fr(nodeInfo2.l1ChainId), version: new Fr(nodeInfo2.rollupVersion) }
					for (const effect of effects) {
						try {
							const authRequest = await CallAuthorizationRequest.fromFields(effect.data)
							const messageHash = await computeAuthWitMessageHash(
								{ consumer: effect.contractAddress, innerHash: authRequest.innerHash },
								chainInfo,
							)
							const authWitness = await account.createAuthWit(messageHash)
							txRequest.authWitnesses.push(authWitness)
						} catch {
							// Not a CallAuthorizationRequest — skip
						}
					}
				}

				this.deps.logDebug(`executeNoFromSendTx: authwits added: ${txRequest.authWitnesses.length}, starting real simulation`)
				// Real simulation with actual auth witnesses and real account contract
				const simulatedTx = await this.deps.coordinator.simulateTxTask(
					pxe,
					txRequest,
					{ simulatePublic: true, skipFeeEnforcement: true, scopes: scopesWithAccount },
					parentTask,
				)
				await finalizeGasLimits(node, txRequest, simulatedTx, 1, undefined, feeOpts, 1, txsLimits)

				// Prove with account in scope
				const { txHash, offchainOutput } = await this.deps.coordinator.proveAndSend({
					pxe,
					node,
					txRequest,
					scopes: scopesWithAccount,
					parentTask,
					checkCancelled,
					markJournal,
					wantOffchainOutput: (provedTx) => {
						const timestamp = provedTx.publicInputs.constants.anchorBlockHeader.globalVariables.timestamp
						return extractOffchainOutput(provedTx.getOffchainEffects(), BigInt(timestamp))
					},
					recordTransaction: (hash) =>
						this.deps.addTransaction(
							origin,
							network.chainId,
							account.address.toString(),
							txCalls,
							Fr.ZERO.toString(),
							AccountFeePaymentMethodOptions.EXTERNAL,
							hash,
							primaryEndpointUrl(network),
							getEstimatedFee(txRequest),
							getGasDetails(txRequest),
							fence,
							op.networkId,
						),
				})

				if (op.opts.wait === "NO_WAIT") {
					return { txHash, ...offchainOutput } as SendReturn<InteractionWaitOptions>
				}
				const receipt = await node.getTxReceipt(txHash)
				return { receipt, ...offchainOutput } as SendReturn<InteractionWaitOptions>
			},
		)
	}
}
