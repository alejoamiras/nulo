import { type IntentInnerHash, type CallIntent, computeAuthWitMessageHash, CallAuthorizationRequest } from "@aztec/aztec.js/authorization"
import { type InteractionWaitOptions, type SendReturn, extractOffchainOutput } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/foundation/curves/bn254"
import {
	type AbiDecoded,
	type AbiType,
	AbiTypeSchema,
	type ContractArtifact,
	ContractArtifactSchema,
	encodeArguments,
	type FunctionAbi,
	FunctionSelector,
	FunctionType,
	FunctionCall,
	decodeFromAbi,
} from "@aztec/stdlib/abi"
import { AuthWitness } from "@aztec/stdlib/auth-witness"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import {
	type CompleteAddress,
	computeContractAddressFromInstance,
	type ContractInstanceWithAddress,
	ContractInstanceWithAddressSchema,
	getContractClassFromArtifact,
	computePartialAddress,
} from "@aztec/stdlib/contract"
import type { ChainInfo } from "@aztec/entrypoints/interfaces"
import {
	ExecutionPayload,
	type TxExecutionRequest,
	type TxProfileResult,
	type TxSimulationResult,
	type UtilityExecutionResult,
	collectOffchainEffects,
} from "@aztec/stdlib/tx"
import z from "zod"
import { NetworkService, networkInfoFrom } from "@/wallet/services/network/service"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { AccountService } from "@/wallet/services/account/service"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { ContactService } from "@/wallet/services/contact/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import { TokenService } from "@/wallet/services/token/service"
import { FpcService, FpcType } from "@/wallet/services/fpc/service"
import {
	TransactionService,
	OriginType,
	type TransferType,
	type LocalTxOrigin,
	TxStatus,
	type TxGasDetails,
} from "@/wallet/services/transaction/service"
import { feeJuiceAddress } from "@/wallet/utils/fee-juice"
import { computeMaxFee, formatFeeJuice, feeToUsd } from "@/utils/fee-estimation"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import type { OperationContext, OperationRecord } from "@/wallet/services/operation-journal/spec"
import { TaskService, type WrappedTask, ExecuteOperationContent, TransferContent } from "@/wallet/services/task/service"
import type { ILogger } from "@/wallet/logger"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service } from "@nulo/extension-messaging/background"
import { type JobError, type JobProgress, JobCancelledSentinel, normalizeError } from "@nulo/wallet-core/jobs"
import { classifyOperationCatch, maybeRethrowAsRpcCancel } from "./rpc-cancel"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import {
	EXECUTION_SERVICE_NAME,
	type Methods,
	type Operation,
	type GetCompleteAddressOperation,
	type RegisterSenderOperation,
	type RegisterTokenOperation,
	type RegisterContractOperation,
	type SendTransactionOperation,
	type SimulateTransactionOperation,
	type SimulateUtilityOperation,
	type SimulateViewsOperation,
	type OperationResult,
	type Action,
	type FeeSettings,
	PRIORITY_MULTIPLIERS,
	type AztecGetContractClassMetadataOperation,
	type AztecGetContractMetadataOperation,
	type AztecGetPrivateEventsOperation,
	type AztecGetChainInfoOperation,
	type AztecRegisterSenderOperation,
	type AztecGetAddressBookOperation,
	type AztecRegisterContractOperation,
	type AztecSimulateTxOperation,
	type AztecExecuteUtilityOperation,
	type AztecProfileTxOperation,
	type AztecSendTxOperation,
	type AztecCreateAuthWitOperation,
	type FeeOptions,
	type GasBalances,
	type TransferFeeEstimate,
} from "./spec"
import { coerceAmount } from "./coerce-amount"
import { OperationPlanner } from "./operation-planner"
import { ContractResolver } from "./contract-resolver"
import { AuthwitDiscoverer } from "./authwit-discoverer"
import { TxRequestBuilder } from "./tx-request-builder"
import {
	type FeeEstimateResult,
	type FeeStrategy,
	type FeeStrategyContext,
	type FeeStrategyDeps,
	DEFAULT_FEE_MULTIPLIER,
	finalizeGasLimits,
	suggestGasLimits,
} from "./fee/fee-strategy"
import { FeeJuiceStrategy } from "./fee/fee-juice-strategy"
import { FeeJuiceWithClaimStrategy } from "./fee/fee-juice-with-claim-strategy"
import { FpcStrategy } from "./fee/fpc-strategy"
import { EmbeddedStrategy } from "./fee/embedded-strategy"
import { applyEmbeddedFpcGasCap } from "./fee/embedded-fpc-cap"
import { detectEmbeddedFeePayment } from "./utils/fee-detection"
import { ExecutionCoordinator } from "./execution-coordinator"
import { type Aliased, ContractInitializationStatus } from "@aztec/aztec.js/wallet"
import { rehydrateOptimizablePrefix, runFastPath } from "./fast-path"
import type { PackedPrivateEvent } from "@aztec/pxe/client/bundle"

export * from "./spec"

/** Best-effort extraction of a human-readable method name from a tx's
 *  Action list. Used by `dapp_execute` journal records so the activity
 *  card's title shows the called function rather than a generic
 *  "Transaction" label. Encoded-call actions carry their decoded `name`
 *  optionally; raw call actions always carry `method`. */
function primaryActionMethod(actions: readonly Action[] | undefined): string | undefined {
	if (!Array.isArray(actions)) return undefined
	for (const action of actions) {
		if (action.kind === "call" && action.method) return action.method
		if (action.kind === "encoded_call" && action.name) return action.name
	}
	return undefined
}

/** Snapshot of the SW state at estimate time. Used by `executeTransfer` to
 *  validate that nothing relevant has drifted between estimate and confirm
 *  before reusing the prebuilt TxRequest. Each field is something the
 *  rebuilt request would have differed on — see plan-v4 Branch 5. */
type TransferEstimateReuseEntry = {
	/** Inputs identifying the transfer (rebuilt for cache-hit verification). */
	readonly networkId: string
	readonly accountAddress: string
	readonly tokenId: number
	readonly transferType: TransferType
	readonly recipientAddress: string
	readonly amount: bigint
	readonly feeSettingsHash: string
	/** Profile id at estimate time. Used for cleaner reject diagnostics
	 *  (codex audit NICE-TO-HAVE #2) — drift already fails closed via
	 *  `getNetwork` / `getAccountContract` profile-scoping, but rejecting
	 *  early avoids confusing errors deeper in the reuse path. */
	readonly profileId: string
	/** Validation snapshot — what was true at estimate time. */
	readonly baseFeeFingerprint: string
	readonly primaryEndpointId: string
	readonly primaryEndpointUrl: string
	/** Pending-tx snapshot for the active account. If new pending txs
	 *  appear between estimate and confirm, the reused TxRequest may
	 *  conflict on private notes (private transfers select notes at
	 *  build time; concurrent in-flight txs can consume them). Reject
	 *  reuse in that case (codex audit SHOULD-FIX #2 partial). */
	readonly pendingHashes: readonly string[]
	/** Built downstream state — reused on confirm. */
	readonly txRequest: TxExecutionRequest
	readonly nonce: { toString(): string }
	readonly feePaymentMethod: AccountFeePaymentMethodOptions
	/** Inputs for the activity-feed record. We persist a transfer-only
	 *  call shape (no FPC fee payload) so the card title stays the token
	 *  symbol regardless of payment method. */
	readonly token: { contract: string; name: string; symbol: string; decimals: number }
	readonly fnName: string
	readonly args: readonly unknown[]
	/** Cache lifecycle. */
	readonly builtAt: number
}

/** Stable fingerprint for `node.getCurrentMinFees()` so we can compare
 *  the snapshot taken at estimate time against the value at confirm.
 *  Exported for unit tests. */
export function fingerprintBaseFee(min: { feePerDaGas: bigint; feePerL2Gas: bigint }): string {
	return `${min.feePerDaGas.toString()}:${min.feePerL2Gas.toString()}`
}

/** Stable fingerprint for fee settings. Explicit per-variant — the
 *  previous JSON.stringify-with-key-array form silently dropped nested
 *  paymentMethod fields (the keys array is read as a recursive filter,
 *  so nested keys not in `Object.keys(fs)` got stripped). That made
 *  `{kind: "fj"}` and `{kind: "fpc", fpcId}` collide and could allow
 *  reuse to serve a TxRequest built for a different payment method.
 *  Codex audit BLOCKING #1. Exported for unit tests. */
export function fingerprintFeeSettings(fs: FeeSettings): string {
	const pm = fs.paymentMethod
	let pmHash: string
	switch (pm.kind) {
		case "fj":
			pmHash = "fj"
			break
		case "fjwc":
			pmHash = `fjwc:${pm.claimAmount}:${pm.claimSecret}:${pm.messageLeafIndex}`
			break
		case "fpc":
			pmHash = `fpc:${pm.fpcId}`
			break
		case "embedded":
			pmHash = "embedded"
			break
	}
	return `${pmHash}|${fs.priorityLevel ?? "default"}`
}

/** Extract estimated fee from finalized gas settings on a TxExecutionRequest. */
function getEstimatedFee(txRequest: TxExecutionRequest): string {
	const gs = txRequest.txContext.gasSettings
	return computeMaxFee(
		{ daGas: gs.gasLimits.daGas, l2Gas: gs.gasLimits.l2Gas },
		{ daGas: gs.teardownGasLimits.daGas, l2Gas: gs.teardownGasLimits.l2Gas },
		{ feePerDaGas: gs.maxFeesPerGas.feePerDaGas, feePerL2Gas: gs.maxFeesPerGas.feePerL2Gas },
	).toString()
}

/** Extract gas breakdown from finalized gas settings. */
function getGasDetails(txRequest: TxExecutionRequest): TxGasDetails {
	const gs = txRequest.txContext.gasSettings
	return {
		l2GasLimit: gs.gasLimits.l2Gas,
		daGasLimit: gs.gasLimits.daGas,
		teardownL2GasLimit: gs.teardownGasLimits.l2Gas,
		teardownDaGasLimit: gs.teardownGasLimits.daGas,
		feePerL2Gas: gs.maxFeesPerGas.feePerL2Gas.toString(),
		feePerDaGas: gs.maxFeesPerGas.feePerDaGas.toString(),
	}
}

export class ExecutionService extends Service<Methods> implements ServiceSpec<Methods> {
	public static name = EXECUTION_SERVICE_NAME

	private pxeService: PxeServiceClient = null!
	private profileService: ProfileService = null!
	private networkService: NetworkService = null!
	private accountService: AccountService = null!
	private contactService: ContactService = null!
	private tokenService: TokenService = null!
	private fpcService: FpcService = null!
	private transactionService: TransactionService = null!
	private authRegistryService: AuthRegistryService = null!
	private taskService: TaskService = null!
	private operationJournal: OperationJournalService = null!
	private planner: OperationPlanner = null!
	private resolver: ContractResolver = null!
	private authwit: AuthwitDiscoverer = null!
	private txBuilder: TxRequestBuilder = null!
	private feeStrategies: Map<FeeSettings["paymentMethod"]["kind"], FeeStrategy> = null!
	private coordinator: ExecutionCoordinator = null!

	/** TTL cache for gas balance queries (survives popup reopens). */
	private static readonly GAS_BALANCE_TTL_MS = 5 * 60 * 1000 // 5 minutes
	private gasBalanceCache = new Map<string, { result: GasBalances; fetchedAt: number }>()

	/** Reuse cache for `executeTransfer` post-confirm. The popup-side fee
	 *  estimator (`estimateTransferFee`) writes here; `executeTransfer`
	 *  consumes when the caller passes a `precomputedEstimateId` AND the
	 *  validation snapshot matches the SW's current view. Skips the
	 *  `buildAndEstimateTxRequest` round-trip on the happy path — saves
	 *  1-3s of post-confirm "estimating fee" UX delay (plan-v4 Branch 5).
	 *
	 *  Scope: Send-page transfer flow only. dApp paths (estimateOperationFee
	 *  + executeAztecSendTx) carve out per audit-codex-v3 — the embedded-fee
	 *  and default_entrypoint variants take divergent code paths that the
	 *  reuse contract doesn't yet cover. */
	private static readonly ESTIMATE_REUSE_TTL_MS = 5 * 60 * 1000 // 5 minutes
	private estimateReuseCache = new Map<string, TransferEstimateReuseEntry>()
	/** Single-flight dedup for concurrent getGasBalances callers.
	 *  The Send popup mounts multiple components that each call this
	 *  simultaneously on unlock; without dedup, each request independently
	 *  enters FpcService discovery under a shared lock, amplifying
	 *  contention and exposing a wedged PXE call as an N-caller stall. */
	private gasBalanceInFlight = new Map<string, Promise<GasBalances>>()

	/** Phase 2 cancel surface: jobId → AbortController. SW-internal only,
	 *  never crosses the wire. `cancelJob(id)` aborts the controller; the
	 *  in-flight prove pipeline checks `signal.aborted` at each stage
	 *  boundary and short-circuits with {@link JobCancelledSentinel}. */
	private activeControllers = new Map<string, AbortController>()

	public constructor(logger: ILogger) {
		super(EXECUTION_SERVICE_NAME, logger)
	}

	protected async init(services: ServiceCollection) {
		this.pxeService = new PxeServiceClient(this.logger)
		this.profileService = services.get(ProfileService.name)
		this.networkService = services.get(NetworkService.name)
		this.accountService = services.get(AccountService.name)
		this.contactService = services.get(ContactService.name)
		this.tokenService = services.get(TokenService.name)
		this.fpcService = services.get(FpcService.name)
		this.transactionService = services.get(TransactionService.name)
		this.authRegistryService = services.get(AuthRegistryService.name)
		this.taskService = services.get(TaskService.name)
		this.operationJournal = services.get(OperationJournalService.name)
		this.planner = new OperationPlanner(this.profileService, this.tokenService)
		this.resolver = new ContractResolver(this.logger)
		this.authwit = new AuthwitDiscoverer(this.logger)
		this.coordinator = new ExecutionCoordinator(this.taskService, this.logger)
		this.txBuilder = new TxRequestBuilder(
			this.pxeService,
			this.profileService,
			this.networkService,
			this.accountService,
			this.authRegistryService,
			this.taskService,
			this.resolver,
			this.authwit,
			this.logger,
		)
		const feeDeps: FeeStrategyDeps = {
			txBuilder: this.txBuilder,
			simulateTxTask: (pxe, req, opts, parentTask) => this.coordinator.simulateTxTask(pxe, req, opts, parentTask),
			fpcService: this.fpcService,
			tasks: this.taskService,
			logger: this.logger,
		}
		this.feeStrategies = new Map<FeeSettings["paymentMethod"]["kind"], FeeStrategy>([
			["fj", new FeeJuiceStrategy(feeDeps)],
			["fjwc", new FeeJuiceWithClaimStrategy(feeDeps)],
			["fpc", new FpcStrategy(feeDeps)],
			["embedded", new EmbeddedStrategy(feeDeps)],
		])

		// Invalidate gas balance cache when a transaction settles
		this.transactionService.onTransactionUpdated.add((tx) => {
			if (tx.status !== TxStatus.Pending) {
				for (const key of this.gasBalanceCache.keys()) {
					if (key.endsWith(`:${tx.account}`)) {
						this.gasBalanceCache.delete(key)
					}
				}
			}
		})

		// PrivateFPC address is read on every getGasBalances() call to fetch
		// `balance_of`. The cache is keyed only by `${networkId}:${account}`,
		// so swapping the PrivateFPC address would otherwise serve stale
		// private-FJ readouts for up to GAS_BALANCE_TTL_MS. Clear the cache
		// on any PrivateFpc mutation. Coarse but correct.
		const invalidateOnPrivateFpc = (fpc: { type: FpcType }) => {
			if (fpc.type === FpcType.PrivateFpc) this.gasBalanceCache.clear()
		}
		this.fpcService.onFpcUpdated.add(invalidateOnPrivateFpc)
		this.fpcService.onFpcDeleted.add(invalidateOnPrivateFpc)
	}

	public async executeTransfer(
		networkId: string,
		accountAddress: string,
		tokenId: number,
		transferType: TransferType,
		recipientAddress: string,
		amount: bigint,
		feeSettings: FeeSettings,
		precomputedEstimateId?: string,
	): Promise<string> {
		await this.ensureInitialized()
		amount = coerceAmount(amount)
		const origin: LocalTxOrigin = { type: OriginType.UI }
		const transferContent = new TransferContent(tokenId, transferType, accountAddress, recipientAddress, amount)
		const transferTask = this.taskService.startNewTask(transferContent, undefined, origin)

		// Durable record of this in-flight operation. Survives SW restart
		// and popup close/reopen so consumers can recover a consistent view
		// of "what is this tx doing right now". Phase 2 FSM:
		//   pending → simulating → proving → submitting → succeeded | failed | cancelled
		let journalOp: OperationRecord | undefined
		try {
			const profile = await this.profileService.getActiveProfile()
			if (profile) {
				journalOp = await this.operationJournal.createOperation({
					kind: "transfer",
					origin: "popup",
					profileId: profile.id,
					accountAddress,
					networkId,
					tokenId,
					// Phase 2 follow-up v4: persist amount + recipient so terminal
					// cards can render the same info as awaiting/settled cards.
					// amount is bigint → string for JSON safety; field name
					// matches `balanceFormatted(rawAmount, decimals, length)`.
					amountRaw: amount.toString(),
					recipientAddress,
					// Persist the privacy direction so the in-flight awaiting
					// card can render the Private/Public chip the settled card
					// shows. Resolved via `formatTransferType()` consumer-side.
					transferType,
				})
			}
		} catch (error) {
			this.logError("Failed to create journal operation", getErrorMessage(error))
		}
		const journalId = journalOp?.id
		const markJournal = async (progress: JobProgress, error?: JobError | null) => {
			if (!journalId) return
			try {
				await this.operationJournal.transitionOperation(journalId, progress, error)
			} catch (err) {
				this.logError("Failed to update journal operation", getErrorMessage(err))
			}
		}

		// Phase 2 cancel surface: register an AbortController under journalId
		// so cancelJob(journalId) can fire `signal.abort()`. Checkpoint() reads
		// the signal at each stage boundary and short-circuits with
		// JobCancelledSentinel so the catch handler can skip the failure path.
		const controller = journalId ? new AbortController() : undefined
		if (journalId && controller) this.activeControllers.set(journalId, controller)
		const checkCancelled = (): void => {
			if (controller?.signal.aborted) throw new JobCancelledSentinel(journalId ?? "")
		}

		try {
			// Try the cached-estimate fast path first. Falls back to a fresh
			// build if the snapshot has drifted (base fee, primary endpoint,
			// or any input field) — conservative: any mismatch ⇒ rebuild.
			const reused = precomputedEstimateId
				? await this.tryConsumeTransferEstimate(precomputedEstimateId, {
						networkId,
						accountAddress,
						tokenId,
						transferType,
						recipientAddress,
						amount,
						feeSettings,
					})
				: undefined

			let txRequest: TxExecutionRequest
			let pxe: Awaited<ReturnType<PxeServiceClient["getPXE"]>>
			let account: Awaited<ReturnType<AccountService["getAccountContract"]>>
			let network: Awaited<ReturnType<NetworkService["getNetwork"]>>
			let nonce: { toString(): string }
			let feePaymentMethod: AccountFeePaymentMethodOptions
			// Activity-feed inputs — captured separately from the FPC-mutated
			// `buildAndEstimateTxRequest` txCalls so the persisted record stays
			// just the user-intent transfer (no `pay_fee` / `fee_entrypoint_*`
			// fee-payload pollution leaking into the activity card title).
			let activityToken: { contract: string; name: string; symbol: string; decimals: number }
			let activityFnName: string
			let activityArgs: readonly unknown[]

			// Enter `simulating` BEFORE `buildAndEstimateTxRequest` — the fee
			// strategies inside that helper run real `simulateTx` calls which
			// can take several seconds; leaving the journal at `pending` would
			// hide that work from the popup. Reused-estimate path also enters
			// `simulating` so the FSM transition is uniform.
			await markJournal({ stage: "simulating" })
			checkCancelled()

			if (reused) {
				this.logDebug(`executeTransfer: reusing precomputed estimate ${precomputedEstimateId}`)
				txRequest = reused.txRequest
				nonce = reused.nonce
				feePaymentMethod = reused.feePaymentMethod
				activityToken = reused.token
				activityFnName = reused.fnName
				activityArgs = reused.args
				network = await this.networkService.getNetwork(networkId)
				pxe = this.pxeService.getPXE(networkInfoFrom(network))
				const profile = await this.profileService.getActiveProfile()
				if (!profile) throw new Error("Wallet locked")
				account = await this.accountService.getAccountContract(profile.id, network.chainId, accountAddress)
			} else {
				const { op, token, fn, args } = await this.planner.buildTransferOperation(
					networkId,
					accountAddress,
					tokenId,
					transferType,
					recipientAddress,
					amount,
					feeSettings,
				)
				activityToken = { contract: token.contract, name: token.name, symbol: token.symbol, decimals: token.decimals }
				activityFnName = fn.name
				activityArgs = args

				const built = await this.buildAndEstimateTxRequest(op, op.feeSettings, transferTask)
				txRequest = built[0]
				pxe = built[2]
				account = built[3]
				network = built[4]
				nonce = built[5]
				feePaymentMethod = built[7]
			}

			checkCancelled()
			await markJournal({ stage: "proving", enteredProveAt: Date.now() })
			const provedTx = await this.coordinator.proveTxTask(pxe, txRequest, [account.address], transferTask)
			// Key checkpoint: if cancel fired during prove, this prevents submission.
			// The proof artifact is dropped silently when this throws.
			checkCancelled()

			const tx = await provedTx.toTx()
			await markJournal({ stage: "submitting" })
			checkCancelled()
			// Re-acquire via withBinding so a node.sendTx failure routes
			// through the classifier and the active endpoint takes a hit.
			// If failover happened between build and send, the live node
			// reflects the new endpoint; the tx itself is chain-bound by
			// its embedded chainId so it's portable across endpoints.
			await this.networkService.withBinding(network.chainId, async (b) => this.coordinator.sendTxTask(b.node, tx, transferTask))

			const txHash = tx.getTxHash().toString()
			// Activity-feed shape is always transfer-only (no FPC fee payload).
			// `txCalls` from `buildAndEstimateTxRequest` carries the FPC mutation
			// (`pay_fee` for Private FPC, `fee_entrypoint_*` for Default FPC),
			// which would surface as the card title via `getPrimaryCall`. The
			// hardcoded shape preserves the pre-reuse behavior: card shows
			// token symbol + transfer type, regardless of fee payment method.
			await this.transactionService.addTransaction(
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
				txHash,
				getEstimatedFee(txRequest),
				getGasDetails(txRequest),
			)
			await markJournal({ stage: "succeeded", txHash })
			transferTask.complete()
			return txHash
		} catch (error) {
			// Journal already in `cancelled` (cancelJob did it); convert the
			// internal sentinel to the structured RPC-boundary error here.
			maybeRethrowAsRpcCancel(error, transferTask)
			await markJournal({ stage: "failed" }, normalizeError(error, "transfer"))
			transferTask.fail(error)
			throw error
		} finally {
			if (journalId) this.activeControllers.delete(journalId)
		}
	}

	/** Pop a cached estimate if (a) the id exists, (b) inputs match
	 *  byte-for-byte, (c) the SW's current view of base fee + primary
	 *  endpoint matches the snapshot, and (d) the entry is fresh
	 *  (TTL).  Any mismatch ⇒ delete + return undefined; caller falls
	 *  back to a full rebuild. The popup gets a single-shot reuse: the
	 *  entry is dropped on consumption (success or failure), preventing
	 *  retries from racing with a fresh estimate. */
	private async tryConsumeTransferEstimate(
		estimateId: string,
		inputs: {
			networkId: string
			accountAddress: string
			tokenId: number
			transferType: TransferType
			recipientAddress: string
			amount: bigint
			feeSettings: FeeSettings
		},
	): Promise<TransferEstimateReuseEntry | undefined> {
		const entry = this.estimateReuseCache.get(estimateId)
		this.estimateReuseCache.delete(estimateId) // single-shot
		if (!entry) return undefined

		// TTL gate
		if (Date.now() - entry.builtAt > ExecutionService.ESTIMATE_REUSE_TTL_MS) {
			this.logDebug(`tryConsumeTransferEstimate ${estimateId}: stale (TTL)`)
			return undefined
		}

		// Input byte-for-byte match
		if (
			entry.networkId !== inputs.networkId ||
			entry.accountAddress !== inputs.accountAddress ||
			entry.tokenId !== inputs.tokenId ||
			entry.transferType !== inputs.transferType ||
			entry.recipientAddress !== inputs.recipientAddress ||
			entry.amount !== inputs.amount ||
			entry.feeSettingsHash !== fingerprintFeeSettings(inputs.feeSettings)
		) {
			this.logDebug(`tryConsumeTransferEstimate ${estimateId}: input drift`)
			return undefined
		}

		// Active-profile drift. `getNetwork` and `getAccountContract` already
		// fail closed for cross-profile leakage, but rejecting reuse here
		// avoids confusing downstream errors when the user swapped profiles
		// between estimate and confirm. (codex audit NICE-TO-HAVE #2)
		const profile = await this.profileService.getActiveProfile()
		if (!profile || profile.id !== entry.profileId) {
			this.logDebug(`tryConsumeTransferEstimate ${estimateId}: profile drift`)
			return undefined
		}

		// Endpoint identity (codex audit gap — preferred can change at runtime).
		// After the multi-rpc-failover schema collapse, `endpoints[0]` IS the
		// preferred. The cached entry's `primaryEndpointId` field is an
		// internal snapshot — keep the name for diff minimality; Phase 3 of
		// failover will switch this whole path to binding-derived identity.
		const network = await this.networkService.getNetwork(inputs.networkId)
		const preferred = network.endpoints[0]
		if (!preferred) {
			this.logDebug(`tryConsumeTransferEstimate ${estimateId}: no preferred endpoint`)
			return undefined
		}
		if (preferred.id !== entry.primaryEndpointId || preferred.rpcUrl !== entry.primaryEndpointUrl) {
			this.logDebug(`tryConsumeTransferEstimate ${estimateId}: preferred endpoint changed`)
			return undefined
		}

		// Base fee snapshot. Compare the cached entry's fingerprint
		// (derived from the txRequest's actual `maxFeesPerGas`) against
		// `liveMin * multiplier` — that's what a fresh build would have
		// finalized. If the chain min hasn't drifted, they match.
		// (codex audit SHOULD-FIX #3)
		try {
			const currentMin = await this.networkService.withBinding(network.chainId, async (b) => b.node.getCurrentMinFees())
			const multiplier = inputs.feeSettings.priorityLevel
				? PRIORITY_MULTIPLIERS[inputs.feeSettings.priorityLevel]
				: DEFAULT_FEE_MULTIPLIER
			const expectedFingerprint = fingerprintBaseFee({
				feePerDaGas: currentMin.feePerDaGas * BigInt(multiplier),
				feePerL2Gas: currentMin.feePerL2Gas * BigInt(multiplier),
			})
			if (expectedFingerprint !== entry.baseFeeFingerprint) {
				this.logDebug(`tryConsumeTransferEstimate ${estimateId}: base fee changed`)
				return undefined
			}
		} catch (error) {
			// Conservative: if we can't verify, don't reuse.
			this.logDebug(`tryConsumeTransferEstimate ${estimateId}: base fee fetch failed: ${getErrorMessage(error)}`)
			return undefined
		}

		// Pending-tx drift. New same-account pending txs since estimate
		// can consume notes the cached private-transfer TxRequest selected.
		// Rebuild rather than risk a note-exhaustion failure mid-flight.
		// (codex audit SHOULD-FIX #2 partial — PXE rebuild detection
		// remains deferred; conservative TTL bounds that risk.)
		const currentPending = new Set(this.transactionService.getPendingForAccount(inputs.accountAddress).map((tx) => tx.hash))
		const cachedPending = new Set(entry.pendingHashes)
		if (currentPending.size !== cachedPending.size || [...currentPending].some((h) => !cachedPending.has(h))) {
			this.logDebug(`tryConsumeTransferEstimate ${estimateId}: pending tx set changed`)
			return undefined
		}

		return entry
	}

	public async estimateTransferFee(
		networkId: string,
		accountAddress: string,
		tokenId: number,
		transferType: TransferType,
		recipientAddress: string,
		amount: bigint,
		feeSettings: FeeSettings,
	): Promise<TransferFeeEstimate> {
		await this.ensureInitialized()
		amount = coerceAmount(amount)

		const { op, token, fn, args } = await this.planner.buildTransferOperation(
			networkId,
			accountAddress,
			tokenId,
			transferType,
			recipientAddress,
			amount,
			feeSettings,
		)

		const [txRequest, _node, _pxe, _account, network, nonce, _txCalls, feePaymentMethod] = await this.buildAndEstimateTxRequest(
			op,
			op.feeSettings,
		)

		const maxFeeRaw = BigInt(getEstimatedFee(txRequest))

		// Stash the post-strategy build result for one-shot reuse on Confirm
		// (plan-v4 Branch 5). Embedded fee payments take a divergent
		// execution path, so we don't offer reuse for them — the popup will
		// receive no `estimateId` and `executeTransfer` falls through to the
		// rebuild path. Same for FeeJuiceWithClaim, which mutates actions
		// during build.
		const reuseEligible = op.feeSettings.paymentMethod.kind === "fj" || op.feeSettings.paymentMethod.kind === "fpc"
		let estimateId: string | undefined
		if (reuseEligible) {
			try {
				const preferred = network.endpoints[0]
				if (preferred) {
					// Fingerprint the EXACT fee the txRequest was built with —
					// not a fresh `getCurrentMinFees()` after the fact (codex
					// audit SHOULD-FIX #3). Both FJ and FPC strategies finalize
					// `maxFeesPerGas = currentMin * multiplier`, so on consume
					// we compare against `liveMin * multiplier`.
					const builtFees = txRequest.txContext.gasSettings.maxFeesPerGas
					const baseFeeFingerprint = fingerprintBaseFee({
						feePerDaGas: builtFees.feePerDaGas,
						feePerL2Gas: builtFees.feePerL2Gas,
					})
					const profile = await this.profileService.getActiveProfile()
					if (!profile) throw new Error("Wallet locked")
					const pendingHashes = this.transactionService.getPendingForAccount(accountAddress).map((tx) => tx.hash)
					estimateId = crypto.randomUUID()
					this.estimateReuseCache.set(estimateId, {
						networkId,
						accountAddress,
						tokenId,
						transferType,
						recipientAddress,
						amount,
						feeSettingsHash: fingerprintFeeSettings(op.feeSettings),
						profileId: profile.id,
						baseFeeFingerprint,
						primaryEndpointId: preferred.id,
						primaryEndpointUrl: preferred.rpcUrl,
						pendingHashes,
						txRequest,
						nonce,
						feePaymentMethod,
						token: { contract: token.contract, name: token.name, symbol: token.symbol, decimals: token.decimals },
						fnName: fn.name,
						args: args.map((x) => x),
						builtAt: Date.now(),
					})
					this.evictStaleEstimateReuseEntries()
				}
			} catch (error) {
				// Cache write is best-effort. The estimate result still goes
				// out — the popup just won't get a reuse token.
				this.logDebug(`estimateTransferFee: cache write skipped: ${getErrorMessage(error)}`)
				estimateId = undefined
			}
		}

		return {
			maxFee: maxFeeRaw.toString(),
			maxFeeFormatted: formatFeeJuice(maxFeeRaw),
			maxFeeUsd: feeToUsd(maxFeeRaw),
			gasDetails: getGasDetails(txRequest),
			estimateId,
		}
	}

	/** Garbage-collect estimate-reuse entries past their TTL. Called
	 *  opportunistically on cache write so we don't grow the map
	 *  unboundedly when the popup keeps re-estimating without ever
	 *  consuming the entries. */
	private evictStaleEstimateReuseEntries(): void {
		const now = Date.now()
		for (const [id, entry] of this.estimateReuseCache) {
			if (now - entry.builtAt > ExecutionService.ESTIMATE_REUSE_TTL_MS) {
				this.estimateReuseCache.delete(id)
			}
		}
	}

	/**
	 * Cancel an in-flight job (Phase 2 lossy-cancel).
	 *
	 * Transitions the journal record to `cancelled` synchronously, then
	 * fires the SW-internal AbortController so the running prove pipeline
	 * unwinds at its next stage boundary. The underlying offscreen prove
	 * may still complete (BB.wasm can't be preempted); its result is
	 * dropped silently when it arrives.
	 *
	 * No-op for unknown jobIds or jobs that already terminated (idempotent).
	 */
	public async cancelJob(jobId: string): Promise<void> {
		await this.ensureInitialized()

		// Try the journal transition first. If the FSM accepts it, the job
		// is in a pre-submit stage and cancel is meaningful — abort the
		// in-flight controller so the prove pipeline unwinds.
		//
		// If the FSM REJECTS the transition (job already terminal, or past
		// `submitting` where the tx is mid-broadcast and on-chain effect is
		// no longer preventable), drop the cancel signal silently and do
		// NOT abort the controller. The in-flight flow continues to its
		// natural `succeeded` or `failed` terminal — preserving consistency
		// between journal stage and on-chain state.
		//
		// This is the codex-W1W2-review fix for the cancel-after-submit
		// race: previously the journal would flip to `cancelled` and the
		// tx-was-already-broadcast path would log a swallowed illegal
		// `cancelled → succeeded` transition, leaving the journal saying
		// "cancelled" while a real tx existed in chain history.
		try {
			await this.operationJournal.transitionOperation(jobId, { stage: "cancelled" })
		} catch (err) {
			this.logDebug("cancelJob: too late to cancel — dropping signal", getErrorMessage(err))
			return
		}

		const controller = this.activeControllers.get(jobId)
		if (controller) {
			controller.abort()
			this.activeControllers.delete(jobId)
		}
	}

	public async estimateOperationFee(operation: Operation, feeSettings: FeeSettings): Promise<TransferFeeEstimate> {
		await this.ensureInitialized()

		if (operation.kind !== "send_transaction" && operation.kind !== "aztec_sendTx") {
			throw new Error("Only send_transaction and aztec_sendTx operations support fee estimation")
		}

		// Build actions array — clone to prevent mutation side effects
		let actions: Action[]
		let detectedFee: FeeOptions | undefined
		if (operation.kind === "aztec_sendTx") {
			const [processedActions, , fee] = await this.planner.processAztecJsPayload(
				(operation as AztecSendTxOperation).exec,
				(operation as AztecSendTxOperation).opts ?? {},
			)
			actions = [...processedActions]
			detectedFee = fee
		} else {
			actions = [...(operation as SendTransactionOperation).actions]
		}

		// Discover auth witnesses via offchain effects (single-pass)
		const authWitActions = await this.authwit.discoverPrivateAuthwits(
			{ ...operation, actions: [...actions] } as SendTransactionOperation,
			async (op, method) => {
				const [txRequest, node, pxe, account] = await this.txBuilder.buildStandard(op as SendTransactionOperation, method)
				return { txRequest, node, pxe, account }
			},
		)
		if (authWitActions.length) {
			actions.push(...authWitActions)
		}

		const op = { ...operation, actions: [...actions], ...(detectedFee ? { fee: detectedFee } : {}) } as SendTransactionOperation
		const [txRequest] = await this.buildAndEstimateTxRequest(op, feeSettings)

		const maxFeeRaw = BigInt(getEstimatedFee(txRequest))
		return {
			maxFee: maxFeeRaw.toString(),
			maxFeeFormatted: formatFeeJuice(maxFeeRaw),
			maxFeeUsd: feeToUsd(maxFeeRaw),
			gasDetails: getGasDetails(txRequest),
		}
	}

	public async executeOperations(operations: Operation[], origin: LocalTxOrigin, parentTask?: WrappedTask): Promise<OperationResult[]> {
		await this.ensureInitialized()
		const results: OperationResult[] = []
		for (const operation of operations) {
			if (results.length && results.at(-1)!.status !== "ok") {
				results.push({ status: "skipped" })
				continue
			}

			const traceId = crypto.randomUUID().slice(0, 8)
			this.logDebug(`[${traceId}] executeOperations: starting ${operation.kind}`)

			const content = new ExecuteOperationContent(operation.kind, this.planner.extractPrimaryMethod(operation))
			const operationTask = parentTask ? parentTask.startSubtask(content) : this.taskService.startNewTask(content, undefined, origin)

			try {
				let result: unknown
				switch (operation.kind) {
					case "get_complete_address": {
						result = await this.executeGetCompleteAddress(operation)
						break
					}
					case "register_contract": {
						result = await this.executeRegisterContract(operation)
						break
					}
					case "register_sender": {
						result = await this.executeRegisterSender(operation)
						break
					}
					case "register_token": {
						result = await this.executeRegisterToken(operation, origin, operationTask)
						break
					}
					case "send_transaction": {
						result = await this.executeSendTransaction(operation, origin, operationTask)
						break
					}
					case "simulate_transaction": {
						result = await this.executeSimulateTransaction(operation)
						break
					}
					case "simulate_utility": {
						result = await this.executeSimulateUtility(operation)
						break
					}
					case "simulate_views": {
						result = await this.executeSimulateViews(operation)
						break
					}
					// Aztec.js interface:
					case "aztec_getContractClassMetadata": {
						result = await this.executeAztecGetContractClassMetadata(operation)
						break
					}
					case "aztec_getContractMetadata": {
						result = await this.executeAztecGetContractMetadata(operation)
						break
					}
					case "aztec_getPrivateEvents": {
						result = await this.executeAztecGetPrivateEvents(operation)
						break
					}
					case "aztec_getChainInfo": {
						result = await this.executeAztecGetChainInfo(operation)
						break
					}
					case "aztec_registerSender": {
						result = await this.executeAztecRegisterSender(operation)
						break
					}
					case "aztec_getAddressBook": {
						result = await this.executeAztecGetAddressBook(operation)
						break
					}
					case "aztec_registerContract": {
						result = await this.executeAztecRegisterContract(operation)
						break
					}
					case "aztec_simulateTx": {
						result = await this.executeAztecSimulateTx(operation)
						break
					}
					case "aztec_executeUtility": {
						result = await this.executeAztecExecuteUtility(operation)
						break
					}
					case "aztec_profileTx": {
						result = await this.executeAztecProfileTx(operation)
						break
					}
					case "aztec_sendTx": {
						result = await this.executeAztecSendTx(operation, origin, operationTask)
						break
					}
					case "aztec_createAuthWit": {
						result = await this.executeAztecCreateAuthWit(operation)
						break
					}
					default: {
						throw new Error("Invalid operation")
					}
				}
				operationTask.complete()
				this.logDebug(`[${traceId}] executeOperations: ${operation.kind} completed`)
				results.push({ status: "ok", result })
			} catch (error) {
				const classified = classifyOperationCatch(error, operationTask, getErrorMessage)
				if (classified.status === "cancelled") {
					this.logInfo(`[${traceId}] executeOperations: ${operation.kind} cancelled by user`)
				} else {
					this.logError(`[${traceId}] executeOperations: ${operation.kind} failed:`, classified.error)
				}
				results.push(classified)
			}
		}
		return results
	}

	// Nulo base:

	private async executeGetCompleteAddress(op: GetCompleteAddressOperation): Promise<CompleteAddress> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Wallet locked")
		}
		const network = await this.networkService.getNetwork(op.networkId)
		const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)
		return await account.getCompleteAddress()
	}

	private async executeRegisterContract(op: RegisterContractOperation): Promise<void> {
		const addressNum = AztecAddress.fromString(op.address).toBigInt()
		if (addressNum >= 0 && addressNum <= 6) {
			// ignore protocol contracts registration,
			// because we cannot validate it due to hardcoded addresses
			return
		}

		const network = await this.networkService.getNetwork(op.networkId)

		const providedInstance = await ContractInstanceWithAddressSchema.optional().parseAsync(op.instance)
		const instance =
			providedInstance ?? (await this.pxeService.getContractInstance(networkInfoFrom(network), AztecAddress.fromString(op.address)))
		if (!instance) {
			throw new Error("Contract instance not found")
		}

		const providedArtifact = await ContractArtifactSchema.optional().parseAsync(op.artifact)
		const artifact =
			providedArtifact ?? (await this.pxeService.getContractArtifact(networkInfoFrom(network), instance.currentContractClassId))
		if (!artifact) {
			throw new Error("Contract artifact not found")
		}

		const contractClass = await getContractClassFromArtifact(artifact)
		if (contractClass.id.toString() !== instance.currentContractClassId.toString()) {
			throw new Error("Contract artifact doesn't match instance's current class id")
		}

		const contractAddress = await computeContractAddressFromInstance(instance)
		if (contractAddress.toString() !== op.address) {
			throw new Error("Contract address doesn't match instance address")
		}

		await this.pxeService.registerContract(networkInfoFrom(network), { instance, artifact })
	}

	private async executeRegisterSender(op: RegisterSenderOperation): Promise<void> {
		const network = await this.networkService.getNetwork(op.networkId)
		await this.pxeService.registerSender(networkInfoFrom(network), AztecAddress.fromString(op.address))
	}

	private async executeRegisterToken(op: RegisterTokenOperation, origin: LocalTxOrigin, parentTask?: WrappedTask): Promise<void> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Wallet locked")
		}
		const ti = await this.tokenService.parseTokenInterface(op.networkId, op.address, parentTask)
		if (
			ti.getNameFn === undefined ||
			ti.getSymbolFn === undefined ||
			ti.getDecimalsFn === undefined ||
			(ti.balanceOfPrivateFn === undefined && ti.balanceOfPublicFn === undefined)
		) {
			throw new Error("Couldn't find necessary methods in the contract interface. Try to add token manually.")
		}
		// Thread the dApp origin into the journal entry so the tokens-view
		// TokenImportRow can render "Requested by <origin>" for dapp imports.
		// Anonymous-DApp fallback matches the repo convention used in
		// tx-enrichment.ts and tx-detail-helpers.ts.
		const opContext: OperationContext =
			origin.type === OriginType.DAPP ? { origin: "dapp", dappOrigin: origin.name ?? "dApp" } : { origin: "popup" }
		await this.tokenService.addToken(profile.id, op.networkId, op.accountAddress, ti, opContext)
	}

	public async executeSendTransaction(op: SendTransactionOperation, origin: LocalTxOrigin, parentTask?: WrappedTask): Promise<string> {
		await this.ensureInitialized()

		// JS-context trust boundary: approveInteraction() at
		// dapp-interaction/service.ts:82 ships popup-built operations
		// through without further validation. If the popup leaks a
		// draft op with feeSettings undefined (the pre-Phase-2-followup
		// bug class), surface a clear error here BEFORE downstream code
		// dereferences feeSettings.priorityLevel / paymentMethod.kind
		// and surfaces a confusing TypeError to the user.
		if (!op.feeSettings) {
			throw new Error("send_transaction: feeSettings is required")
		}

		// Durable journal record for dApp-initiated sends. Mirrors the same
		// pattern `executeTransfer` uses for UI-initiated transfers (M1.1) so
		// the activity feed stays consistent across SW restart + popup
		// close/reopen. The card shape unification in
		// `TransactionCardLayout.vue` relies on this record carrying the
		// dApp identity in `subtitle` so the in-flight chip matches the
		// settled chip rendered from the transaction itself.
		const primaryMethod = primaryActionMethod(op.actions)
		const journalId = await this.beginDappExecuteJournal(
			op.networkId,
			op.accountAddress,
			origin,
			primaryMethod ? [{ method: primaryMethod }] : undefined,
		)

		const controller = journalId ? new AbortController() : undefined
		if (journalId && controller) this.activeControllers.set(journalId, controller)
		const checkCancelled = (): void => {
			if (controller?.signal.aborted) throw new JobCancelledSentinel(journalId ?? "")
		}

		try {
			// Enter `simulating` BEFORE the build/estimate work — fee
			// strategies inside `buildAndEstimateTxRequest` run real
			// simulateTx calls (can be several seconds), and leaving the
			// journal at `pending` would hide that from the popup.
			await this.markJournal(journalId, { stage: "simulating" })
			checkCancelled()

			const [txRequest, , pxe, account, network, nonce, txCalls, feePaymentMethod] = await this.buildAndEstimateTxRequest(
				op,
				op.feeSettings,
				parentTask,
			)

			checkCancelled()
			await this.markJournal(journalId, { stage: "proving", enteredProveAt: Date.now() })
			const provedTx = await this.coordinator.proveTxTask(pxe, txRequest, [account.address], parentTask)
			checkCancelled()

			const tx = await provedTx.toTx()
			await this.markJournal(journalId, { stage: "submitting" })
			checkCancelled()
			await this.networkService.withBinding(network.chainId, async (b) => this.coordinator.sendTxTask(b.node, tx, parentTask))

			const txHash = tx.getTxHash().toString()
			await this.transactionService.addTransaction(
				origin,
				network.chainId,
				account.address.toString(),
				txCalls,
				nonce.toString(),
				feePaymentMethod,
				txHash,
				getEstimatedFee(txRequest),
				getGasDetails(txRequest),
			)

			await this.markJournal(journalId, { stage: "succeeded", txHash })
			return txHash
		} catch (error) {
			if (error instanceof JobCancelledSentinel) {
				throw error
			}
			await this.markJournal(journalId, { stage: "failed" }, normalizeError(error, "dapp_execute"))
			throw error
		} finally {
			if (journalId) this.activeControllers.delete(journalId)
		}
	}

	/** Open a `dapp_execute` journal record covering an in-flight dApp send.
	 *  Returns the journal id (or `undefined` on failure — non-fatal). The
	 *  record carries the signing account, network, and the dApp identity
	 *  for activity-feed rendering. Method name lives in `title` so the
	 *  in-flight card shows the same value the settled card derives from
	 *  the tx history. */
	private async beginDappExecuteJournal(
		networkId: string,
		accountAddress: string,
		origin: LocalTxOrigin,
		calls?: { method?: string }[],
	): Promise<string | undefined> {
		try {
			const profile = await this.profileService.getActiveProfile()
			if (!profile) return undefined
			const primaryMethod = Array.isArray(calls) ? calls.find((c) => c?.method)?.method : undefined
			const op = await this.operationJournal.createOperation({
				kind: "dapp_execute",
				origin: "dapp",
				profileId: profile.id,
				accountAddress,
				networkId,
				title: primaryMethod ?? "Transaction",
				subtitle: origin.name,
			})
			return op.id
		} catch (error) {
			this.logError("Failed to create dapp_execute journal record", getErrorMessage(error))
			return undefined
		}
	}

	private async markJournal(journalId: string | undefined, progress: JobProgress, error?: JobError | null): Promise<void> {
		if (!journalId) return
		try {
			await this.operationJournal.transitionOperation(journalId, progress, error)
		} catch (err) {
			this.logError("Failed to update journal operation", getErrorMessage(err))
		}
	}

	private async executeSimulateTransaction(op: SimulateTransactionOperation): Promise<unknown> {
		const [txRequest, _, pxe, account] = await this.txBuilder.buildStandard(op, AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
		const simulatedTx = await pxe.simulateTx(txRequest, {
			simulatePublic: op.simulatePublic ?? false,
			skipFeeEnforcement: true,
			scopes: [account.address],
		})
		return {
			gasUsed: simulatedTx.gasUsed,
			privateReturn: simulatedTx.getPrivateReturnValues(),
			publicReturn: simulatedTx.getPublicReturnValues(),
		}
	}

	private async executeSimulateUtility(op: SimulateUtilityOperation): Promise<AbiDecoded> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Wallet locked")
		}
		const network = await this.networkService.getNetwork(op.networkId)
		const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)

		const pxe = this.pxeService.getPXE(networkInfoFrom(network))

		const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
		if (!registeredContracts.has(op.contract)) {
			const [_, instance] = await this.resolver.resolveInstance(pxe, op.contract)
			const [__, artifact] = await this.resolver.resolveArtifact(pxe, instance.currentContractClassId.toString())
			this.logDebug("Register contract")
			await pxe.registerContract({ instance, artifact })
		}

		const [_, instance] = await this.resolver.resolveInstance(pxe, op.contract)
		const [__, artifact] = await this.resolver.resolveArtifact(pxe, instance.currentContractClassId.toString())

		const fn =
			artifact.functions.find((x) => x.name === op.method) ?? artifact.nonDispatchPublicFunctions.find((x) => x.name === op.method)
		if (!fn) {
			throw new Error("Method not found")
		}
		const fnSelector = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
		const encodedArgs = encodeArguments(fn, op.args)
		const call = new FunctionCall(
			fn.name,
			AztecAddress.fromString(op.contract),
			fnSelector,
			fn.functionType,
			false,
			fn.isStatic,
			encodedArgs,
			fn.returnTypes,
		)

		await account.ensureRegistered(pxe)
		const { result } = await pxe.executeUtility(call, {
			scopes: [account.address],
		})

		try {
			return decodeFromAbi(fn.returnTypes, result)
		} catch (error) {
			this.logError("Failed to decode simulation results", fn.returnTypes, result, getErrorMessage(error))
			return result as AbiDecoded
		}
	}

	public async executeSimulateViews(op: SimulateViewsOperation): Promise<{ encoded: Fr[][]; decoded: AbiDecoded[] }> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Wallet locked")
		}
		const network = await this.networkService.getNetwork(op.networkId)
		const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)

		const node = await this.networkService.getNode(network.chainId)
		const pxe = this.pxeService.getPXE(networkInfoFrom(network))
		const contracts = this.resolver.extractContracts(op.calls)
		const instances = await this.resolver.resolveInstances(pxe, contracts)
		const artifacts = await this.resolver.resolveArtifacts(pxe, instances)

		const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
		for (const [contract, instance] of instances) {
			if (!registeredContracts.has(contract)) {
				this.logDebug("Register contract")
				await pxe.registerContract({
					instance,
					artifact: artifacts.get(instance.currentContractClassId.toString()),
				})
			}
		}

		const result: {
			encoded: Fr[][]
			decoded: AbiDecoded[]
		} = {
			encoded: [],
			decoded: [],
		}

		const calls: [FunctionCall, number, number, AbiType[]][] = []
		const utility: [Promise<UtilityExecutionResult>, number, AbiType[]][] = []
		let privateCalls = 0
		let publicCalls = 0

		await account.ensureRegistered(pxe)

		for (let i = 0; i < op.calls.length; i++) {
			const call = op.calls[i]
			switch (call.kind) {
				case "call": {
					const instance = instances.get(call.contract)
					if (!instance) {
						throw new Error("Contract not found")
					}
					const artifact = artifacts.get(instance.currentContractClassId.toString())
					if (!artifact) {
						throw new Error("Contract artifact not found")
					}
					const fn =
						artifact.functions.find((x) => x.name === call.method) ??
						artifact.nonDispatchPublicFunctions.find((x) => x.name === call.method)
					if (!fn) {
						throw new Error("Method not found")
					}
					const fnSelector = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
					const encodedArgs = encodeArguments(fn, call.args)
					if (fn.functionType === FunctionType.UTILITY) {
						utility.push([
							pxe.executeUtility(
								new FunctionCall(
									fn.name,
									AztecAddress.fromString(call.contract),
									fnSelector,
									fn.functionType,
									false,
									fn.isStatic,
									encodedArgs,
									fn.returnTypes,
								),
								{ scopes: [account.address] },
							),
							i,
							fn.returnTypes,
						])
					} else {
						calls.push([
							new FunctionCall(
								fn.name,
								AztecAddress.fromString(call.contract),
								fnSelector,
								fn.functionType,
								call.hideSender === true,
								fn.isStatic,
								encodedArgs,
								fn.returnTypes,
							),
							i,
							fn.functionType === FunctionType.PUBLIC ? publicCalls++ : privateCalls++,
							fn.returnTypes,
						])
					}
					this.logDebug("Call enqueued.")
					break
				}
				case "encoded_call": {
					const instance = instances.get(call.to)
					if (!instance) {
						throw new Error("Contract not found")
					}
					const artifact = artifacts.get(instance.currentContractClassId.toString())
					if (!artifact) {
						throw new Error("Contract artifact not found")
					}
					let fn: FunctionAbi | undefined
					for (const _fn of artifact.functions) {
						const selector = await FunctionSelector.fromNameAndParameters(_fn.name, _fn.parameters)
						if (selector.toString() === call.selector) {
							fn = _fn
							break
						}
					}
					if (!fn) {
						for (const _fn of artifact.nonDispatchPublicFunctions) {
							const selector = await FunctionSelector.fromNameAndParameters(_fn.name, _fn.parameters)
							if (selector.toString() === call.selector) {
								fn = _fn
								break
							}
						}
					}
					if (!fn) {
						throw new Error("Method not found")
					}
					if (fn.functionType === FunctionType.UTILITY) {
						utility.push([
							pxe.executeUtility(
								new FunctionCall(
									fn.name,
									AztecAddress.fromString(call.to),
									FunctionSelector.fromString(call.selector),
									fn.functionType,
									false,
									fn.isStatic,
									call.args.map((x) => Fr.fromString(x)),
									fn.returnTypes,
								),
								{ scopes: [account.address] },
							),
							i,
							fn.returnTypes,
						])
					} else {
						calls.push([
							new FunctionCall(
								fn.name,
								AztecAddress.fromString(call.to),
								FunctionSelector.fromString(call.selector),
								fn.functionType,
								call.hideMsgSender === true,
								fn.isStatic,
								call.args.map((x) => Fr.fromString(x)),
								fn.returnTypes,
							),
							i,
							fn.functionType === FunctionType.PUBLIC ? publicCalls++ : privateCalls++,
							fn.returnTypes,
						])
					}
					this.logDebug("EncodedCall enqueued.")
					break
				}
			}
		}

		if (calls.length) {
			const payload = new ExecutionPayload(
				calls.map((x) => x[0]),
				[],
				[],
				[],
			)
			const txRequest = await account.buildTxExecutionRequest(node, pxe, payload, {
				cancellable: false,
				txNonce: Fr.random(),
				feePaymentMethodOptions: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE,
			})
			const simulatedTx = await pxe.simulateTx(txRequest, {
				simulatePublic: true,
				skipFeeEnforcement: true,
				scopes: [account.address],
			})

			const publicReturn = simulatedTx.getPublicReturnValues()
			const privateReturn =
				txRequest.origin.toString() === op.accountAddress
					? simulatedTx.getPrivateReturnValues().nested
					: simulatedTx.getPrivateReturnValues().nested[1].nested

			for (const [call, i, j, types] of calls) {
				const values = (call.type === FunctionType.PUBLIC ? publicReturn[j] : privateReturn[j]).values ?? []
				result.encoded[i] = values
				try {
					result.decoded[i] = decodeFromAbi(types, values)
				} catch (error) {
					this.logError("Failed to decode simulation results", types, values, getErrorMessage(error))
				}
			}
		}

		for (const [promise, i, types] of utility) {
			const { result: values } = await promise
			try {
				result.decoded[i] = decodeFromAbi(types, values)
			} catch (error) {
				this.logError("Failed to encode utility simulation results", types, values, getErrorMessage(error))
			}
			result.encoded[i] = values
		}

		return result
	}

	public async getGasBalances(networkId: string, accountAddress: string, forceRefresh?: boolean): Promise<GasBalances> {
		await this.ensureInitialized()

		const cacheKey = `${networkId}:${accountAddress}`
		if (!forceRefresh) {
			const cached = this.gasBalanceCache.get(cacheKey)
			if (cached && Date.now() - cached.fetchedAt < ExecutionService.GAS_BALANCE_TTL_MS) {
				return cached.result
			}
		}

		// Single-flight: coalesce concurrent callers for the same key onto
		// one in-flight promise. Fresh popup opens fire several of these
		// simultaneously (FeeSettingsCard + GasBalanceCard), and each
		// independently triggered FpcService discovery before this guard
		// existed — see project_getgasbalances_timeout_regression memory.
		const inFlight = this.gasBalanceInFlight.get(cacheKey)
		if (inFlight) {
			this.logDebug(`getGasBalances: dedup — awaiting in-flight request for ${cacheKey}`)
			return inFlight
		}
		const pending = this.#computeGasBalances(cacheKey, networkId, accountAddress).finally(() => {
			this.gasBalanceInFlight.delete(cacheKey)
		})
		this.gasBalanceInFlight.set(cacheKey, pending)
		return pending
	}

	async #computeGasBalances(cacheKey: string, networkId: string, accountAddress: string): Promise<GasBalances> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Wallet locked")
		}
		const network = await this.networkService.getNetwork(networkId)

		// Public FeeJuice balance via balance_of_public on the FeeJuice contract
		this.logDebug(`getGasBalances: networkId=${networkId}, accountAddress=${accountAddress}`)
		let publicFeeJuice = "0"
		try {
			const publicResult = await this.executeSimulateViews({
				kind: "simulate_views",
				networkId,
				accountAddress,
				calls: [
					{
						kind: "call",
						contract: feeJuiceAddress,
						method: "balance_of_public",
						args: [accountAddress],
					},
				],
			})
			if (publicResult.encoded[0]?.[0]) {
				publicFeeJuice = publicResult.encoded[0][0].toBigInt().toString()
			}
		} catch (err) {
			this.logDebug(`getGasBalances: Failed to get public FeeJuice balance:`, getErrorMessage(err))
			this.logError("Failed to get public FeeJuice balance", getErrorMessage(err))
		}
		this.logDebug(`getGasBalances: publicFeeJuice=${publicFeeJuice}`)

		// Private FeeJuice balance via balance_of on PrivateFPC
		let privateFeeJuice: string | null = null
		try {
			const fpcs = await this.fpcService.getFpcs(network.chainId)
			const bridgedFpc = fpcs.find((f) => f.type === FpcType.PrivateFpc)
			if (bridgedFpc) {
				const privateResult = await this.executeSimulateViews({
					kind: "simulate_views",
					networkId,
					accountAddress,
					calls: [
						{
							kind: "call",
							contract: bridgedFpc.address,
							method: "balance_of",
							args: [accountAddress],
						},
					],
				})
				if (privateResult.encoded[0]?.[0]) {
					privateFeeJuice = privateResult.encoded[0][0].toBigInt().toString()
				}
			}
		} catch (err) {
			this.logDebug(`getGasBalances: Failed to get private FeeJuice balance:`, getErrorMessage(err))
			this.logError("Failed to get private FeeJuice balance", getErrorMessage(err))
		}
		this.logDebug(`getGasBalances: publicFeeJuice=${publicFeeJuice}, privateFeeJuice=${privateFeeJuice}`)

		const result = { publicFeeJuice, privateFeeJuice }
		this.gasBalanceCache.set(cacheKey, { result, fetchedAt: Date.now() })
		return result
	}

	// Aztec.js interface:

	private async executeAztecGetContractClassMetadata(
		op: AztecGetContractClassMetadataOperation,
	): Promise<{ isContractClassPubliclyRegistered: boolean; isArtifactRegistered: boolean }> {
		const network = await this.networkService.getNetwork(op.networkId)
		const artifact = await this.pxeService.getContractArtifact(networkInfoFrom(network), op.id, { pxeOnly: true })
		return {
			isContractClassPubliclyRegistered: !!artifact,
			isArtifactRegistered: !!artifact,
		}
	}

	private async executeAztecGetContractMetadata(op: AztecGetContractMetadataOperation): Promise<{
		instance?: ContractInstanceWithAddress
		initializationStatus: ContractInitializationStatus
		isContractPublished: boolean
		isContractUpdated: boolean
		updatedContractClassId?: Fr
	}> {
		const network = await this.networkService.getNetwork(op.networkId)

		// Check PXE-local only: simulation requires both instance AND artifact
		// registered in PXE. The full cascade (node/known/registry) finds on-chain
		// data that PXE can't use for simulation.
		const localInstance = await this.pxeService.getContractInstance(networkInfoFrom(network), op.address, { pxeOnly: true })

		let hasArtifact = false
		if (localInstance) {
			try {
				const artifact = await this.pxeService.getContractArtifact(networkInfoFrom(network), localInstance.currentContractClassId, {
					pxeOnly: true,
				})
				hasArtifact = !!artifact
			} catch {
				hasArtifact = false
			}
		}

		const isLocallyRegistered = !!localInstance && hasArtifact

		// `isContractPublished` is a best-effort flag — the wallet-sdk doc treats
		// it as a hint, not a guarantee. `nodeBestEffort: true` keeps a transient
		// node failure (testnet RPC noise) from failing the whole metadata call;
		// the local known-bundle fallback still runs underneath.
		let isPublished = isLocallyRegistered
		if (!isPublished) {
			const fullInstance = await this.pxeService.getContractInstance(networkInfoFrom(network), op.address, {
				nodeBestEffort: true,
			})
			isPublished = !!fullInstance
		}

		return {
			instance: isLocallyRegistered ? localInstance : undefined,
			initializationStatus: isLocallyRegistered ? ContractInitializationStatus.INITIALIZED : ContractInitializationStatus.UNKNOWN,
			isContractPublished: isPublished,
			isContractUpdated: false,
			updatedContractClassId: undefined,
		}
	}

	private async executeAztecGetPrivateEvents(op: AztecGetPrivateEventsOperation): Promise<PackedPrivateEvent[]> {
		const network = await this.networkService.getNetwork(op.networkId)
		return this.pxeService.getPrivateEvents(networkInfoFrom(network), op.eventMetadata.eventSelector, op.eventFilter)
	}

	private async executeAztecGetChainInfo(op: AztecGetChainInfoOperation): Promise<ChainInfo> {
		const network = await this.networkService.getNetwork(op.networkId)
		const { l1ChainId, rollupVersion } = await this.networkService.withBinding(network.chainId, async (b) => b.node.getNodeInfo())
		return { chainId: new Fr(l1ChainId), version: new Fr(rollupVersion) }
	}

	private async executeAztecRegisterSender(op: AztecRegisterSenderOperation): Promise<AztecAddress> {
		const network = await this.networkService.getNetwork(op.networkId)
		return this.pxeService.registerSender(networkInfoFrom(network), op.address)
	}

	private async executeAztecGetAddressBook(_op: AztecGetAddressBookOperation): Promise<Aliased<AztecAddress>[]> {
		// TODO: filter by chainId
		return (await this.contactService.getContacts()).map((x) => ({
			alias: x.name,
			item: AztecAddress.fromString(x.address),
		}))
	}

	private async executeAztecRegisterContract(op: AztecRegisterContractOperation): Promise<ContractInstanceWithAddress> {
		const instance = await ContractInstanceWithAddressSchema.parseAsync(op.instance)
		const network = await this.networkService.getNetwork(op.networkId)

		const addressNum = instance.address.toBigInt()
		if (addressNum >= 0 && addressNum <= 6) {
			return instance
		}

		let providedArtifact: ContractArtifact | undefined
		try {
			providedArtifact = await ContractArtifactSchema.optional().parseAsync(op.artifact)
		} catch {
			// artifact parse failed — will fall back to lookup below
		}

		// Smart-tighten: if the dApp didn't pass an artifact, the wallet can
		// still resolve it via the chain's PXE (already-registered) or the
		// compiled-in known bundle (Aztec/Wonderland tokens, FPCs, NFTs,
		// etc.). When neither has it, fail loudly with a message telling
		// the dApp to pass `artifact` — there is no remote registry fallback.
		const classId = instance.currentContractClassId
		const artifact = providedArtifact ?? (await this.pxeService.getContractArtifact(networkInfoFrom(network), classId))
		if (!artifact) {
			throw new Error(
				`Contract artifact not found for class ${classId}. ` +
					"The wallet only ships artifacts for the standard bundled contracts; " +
					"pass the artifact in aztec_registerContract({ instance, artifact }) for custom contracts.",
			)
		}

		const contractClass = await getContractClassFromArtifact(artifact)
		if (contractClass.id.toString() !== instance.currentContractClassId.toString()) {
			throw new Error("Contract artifact doesn't match instance's current class id")
		}

		await this.pxeService.registerContract(networkInfoFrom(network), { instance, artifact })

		if (op.secretKey) {
			await this.pxeService.registerAccount(networkInfoFrom(network), op.secretKey, await computePartialAddress(instance))
		}

		return instance
	}

	private async executeAztecSimulateTx(op: AztecSimulateTxOperation): Promise<TxSimulationResult> {
		if (op.accountAddress !== op.opts?.from?.toString()) {
			throw new Error("Invalid `opts.from`")
		}

		// Mixed-payload fast path. The public-static *prefix* of
		// `op.exec.calls` runs directly against the node via
		// `simulateViaNode`; the remainder goes through PXE in parallel;
		// upstream's `buildMergedSimulationResult` stitches them back in
		// payload order. Mirrors `BaseWallet.simulateTx`.
		//
		// First-tx multicall init exception: when the user's account
		// hasn't sent its first tx yet, `nulo-account.buildTxExecutionRequest`
		// wraps `[ctor, entrypoint(appCalls)]` via `DefaultMultiCallEntrypoint`,
		// producing a doubly-nested execution tree. Upstream's flat
		// `appCallOffset` model can't express that. For mixed-with-remainder
		// payloads in this state, route entirely to the standard path; pure-
		// prefix is still optimized because `simulateViaNode` bypasses the
		// account entirely.
		const split = rehydrateOptimizablePrefix(op.exec?.calls)
		if (split === null) {
			return this.executeAztecSimulateTxStandard(op)
		}
		const { optimizableCalls, remainingRaw } = split

		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Wallet locked")
		}
		const network = await this.networkService.getNetwork(op.networkId)

		return this.networkService.withBinding(network.chainId, async (b) => {
			if (remainingRaw.length > 0) {
				const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)
				const needsInit = await account.requiresInitialization(b.node)
				if (needsInit) {
					// Mixed + first-tx → don't try to merge. The naive "normalize
					// the standard arm's private-execution tree onto the inner
					// entrypoint subtree" approach was audited (codex 019e1912
					// + opus 4.7, 2026-05-12) and rejected because:
					//   • publicInputs.gasUsed IS dApp-visible via
					//     TxSimulationResult.gasUsed and would over-report
					//     (ctor gas leaks into the projected result).
					//   • firstNullifier of the multicall result IS the account
					//     init nullifier; carrying it onto an entrypoint-rooted
					//     tree is semantically wrong.
					// See wallets-architecture-research/synthesis/
					// implementation-plan-p1-p3.md "Tracked follow-ups" §4 for
					// the trigger conditions to revisit.
					return this.executeAztecSimulateTxStandard(op)
				}
			}

			const pxe = this.pxeService.getPXE(b.info)

			const result = await runFastPath({
				node: b.node,
				pxe,
				fromAddr: AztecAddress.fromString(op.accountAddress),
				opts: op.opts,
				optimizableCalls,
				remainingRaw,
				runStandardArm: async (rawCalls) =>
					this.executeAztecSimulateTxStandard({ ...op, exec: { ...op.exec, calls: rawCalls as never } }),
				// Naive — upstream uses it only for error contextualization;
				// no functional impact on sim correctness.
				getContractName: async () => undefined,
				logError: (msg, err) => this.logError(msg, err),
			})
			if (result === null) {
				return this.executeAztecSimulateTxStandard(op)
			}
			return result
		})
	}

	/** Standard path: full PXE simulation through the account entrypoint
	 *  (with stub-account override). Used when the fast path's
	 *  `tryRehydratePureStaticPayload` returns `null` (any non-public-
	 *  static call disqualifies the fast path), when no node block is
	 *  synced, or when a fast-path-exclusive operation throws and signals
	 *  fallback. */
	private async executeAztecSimulateTxStandard(op: AztecSimulateTxOperation): Promise<TxSimulationResult> {
		const [actions, feePaymentMethod, fee] = await this.planner.processAztecJsPayload(op.exec, op.opts)
		// Thread the dApp's `opts.fee.gasSettings` (including
		// `maxPriorityFeesPerGas`) so `nulo-account.ts`'s
		// `completeFeeOptions` call uses the dApp-supplied values rather
		// than silently defaulting from `node.getCurrentMinFees() * 1.5`.
		const [txRequest, node, pxe, account] = await this.txBuilder.buildStandard(
			{ ...op, actions },
			feePaymentMethod,
			undefined,
			op.opts.fee?.gasSettings,
		)
		suggestGasLimits(txRequest, fee)
		await applyEmbeddedFpcGasCap(txRequest, fee, node)
		const additionalScopes = Array.isArray(op.opts.additionalScopes) ? op.opts.additionalScopes : []
		// Thread `stubAccountAddresses` so the simulated account contract
		// is the stubbed pass-through one (override path at
		// `pxe/service.ts:233-246`). Real signing keys never enter PXE
		// during a dApp `simulateTx` — defense-in-depth for read-heavy
		// dApp flows. The third-arg pattern matches `executeNoFromSendTx`'s
		// kernelless discovery sim, so the override mechanism is exercised
		// identically across all dApp-facing sim paths.
		return pxe.simulateTx(
			txRequest,
			{
				simulatePublic: true,
				skipTxValidation: op.opts.skipTxValidation,
				skipFeeEnforcement: op.opts.skipFeeEnforcement ?? true,
				scopes: [account.address, ...additionalScopes],
			},
			[account.address.toString()],
		)
	}

	private async executeAztecExecuteUtility(op: AztecExecuteUtilityOperation): Promise<UtilityExecutionResult> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Wallet locked")
		}
		const network = await this.networkService.getNetwork(op.networkId)
		const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)
		const pxe = this.pxeService.getPXE(networkInfoFrom(network))
		await account.ensureRegistered(pxe)
		return pxe.executeUtility(op.call, {
			authwits: await z.array(AuthWitness.schema).optional().parseAsync(op.opts.authWitnesses),
			scopes: await z.array(AztecAddress.schema).parseAsync(op.opts.scopes),
		})
	}

	private async executeAztecProfileTx(op: AztecProfileTxOperation): Promise<TxProfileResult> {
		if (op.accountAddress !== op.opts?.from?.toString()) {
			throw new Error("Invalid `opts.from`")
		}
		const [actions, feePaymentMethod, fee] = await this.planner.processAztecJsPayload(op.exec, op.opts)
		const [txRequest, node, pxe] = await this.txBuilder.buildStandard({ ...op, actions }, feePaymentMethod)
		suggestGasLimits(txRequest, fee)
		await applyEmbeddedFpcGasCap(txRequest, fee, node)
		const additionalScopes = Array.isArray(op.opts.additionalScopes) ? op.opts.additionalScopes : []
		return pxe.profileTx(txRequest, {
			profileMode: op.opts.profileMode,
			skipProofGeneration: op.opts.skipProofGeneration,
			scopes: [AztecAddress.fromString(op.accountAddress), ...additionalScopes],
		})
	}

	private async executeAztecSendTx(
		op: AztecSendTxOperation,
		origin: LocalTxOrigin,
		parentTask?: WrappedTask,
	): Promise<SendReturn<InteractionWaitOptions>> {
		// `default_entrypoint` is a special dApp path that bypasses the
		// standard tx-build pipeline and runs its own kernelless discovery.
		// Journal coverage for it is deferred — the typical dApp tx surface
		// (regular `aztec_sendTx` with `from`) is what users see day-to-day.
		if (op.executionMode === "default_entrypoint") {
			return this.executeNoFromSendTx(op, origin, parentTask)
		}

		// JS-context trust boundary: approveInteraction() ships popup-built
		// operations through without further validation. If the popup leaks
		// a draft op with feeSettings undefined, surface a clear error here
		// BEFORE buildAndEstimateTxRequest() dereferences feeSettings.priorityLevel
		// / paymentMethod.kind. (executeNoFromSendTx above tolerates missing
		// feeSettings by design — the dApp handles fee payment.)
		if (!op.feeSettings) {
			throw new Error("aztec_sendTx: feeSettings is required for the standard execution path")
		}

		// Durable journal record for dApp-initiated sends. Mirrors the
		// pattern `executeTransfer` uses for UI-initiated transfers, so
		// the activity feed stays consistent across SW restart + popup
		// close/reopen. Carries the dApp identity via `subtitle` so the
		// in-flight chip matches the settled chip rendered from the tx
		// itself.
		const primaryMethod = (Array.isArray(op.exec?.calls) ? op.exec.calls.find((c) => c?.name)?.name : undefined) ?? undefined
		const journalId = await this.beginDappExecuteJournal(
			op.networkId,
			op.accountAddress,
			origin,
			primaryMethod ? [{ method: primaryMethod }] : undefined,
		)

		const controller = journalId ? new AbortController() : undefined
		if (journalId && controller) this.activeControllers.set(journalId, controller)
		const checkCancelled = (): void => {
			if (controller?.signal.aborted) throw new JobCancelledSentinel(journalId ?? "")
		}

		try {
			if (op.accountAddress !== op.opts?.from?.toString()) {
				throw new Error("Invalid `opts.from`")
			}

			const [actions, _, fee] = await this.planner.processAztecJsPayload(op.exec, op.opts)

			// Skip auth witness discovery for embedded fee payments — the dApp handles its own
			// fee calls (e.g., FeeJuice:claim_and_end_setup) which conflict with the discovery
			// simulation's dummy fee method.
			if (!fee.embeddedFeePayment) {
				const authWitActions = await this.authwit.discoverPrivateAuthwits({ ...op, actions: [...actions] }, async (o, method) => {
					const [txRequest, node, pxe, account] = await this.txBuilder.buildStandard(o as SendTransactionOperation, method)
					return { txRequest, node, pxe, account }
				})
				if (authWitActions.length) {
					this.logDebug(`[executeAztecSendTx] Discovered ${authWitActions.length} auth witness(es) via offchain effects`)
					actions.push(...authWitActions)
				}
			}

			// Enter `simulating` before build/estimate — fee strategies inside
			// `buildAndEstimateTxRequest` run real simulateTx calls.
			await this.markJournal(journalId, { stage: "simulating" })
			checkCancelled()

			const [txRequest, node, pxe, account, network, nonce, txCalls, feePaymentMethod] = await this.buildAndEstimateTxRequest(
				{ ...op, actions, fee },
				op.feeSettings,
				parentTask,
			)

			checkCancelled()
			await this.markJournal(journalId, { stage: "proving", enteredProveAt: Date.now() })
			const sendAdditionalScopes = Array.isArray(op.opts.additionalScopes) ? op.opts.additionalScopes : []
			const provedTx = await this.coordinator.proveTxTask(pxe, txRequest, [account.address, ...sendAdditionalScopes], parentTask)
			checkCancelled()
			const timestamp = provedTx.publicInputs.constants.anchorBlockHeader.globalVariables.timestamp
			const offchainOutput = extractOffchainOutput(provedTx.getOffchainEffects(), BigInt(timestamp))
			const tx = await provedTx.toTx()
			await this.markJournal(journalId, { stage: "submitting" })
			checkCancelled()
			await this.networkService.withBinding(network.chainId, async (b) => this.coordinator.sendTxTask(b.node, tx, parentTask))

			const txHash = tx.getTxHash()
			await this.transactionService.addTransaction(
				origin,
				network.chainId,
				account.address.toString(),
				txCalls,
				nonce.toString(),
				feePaymentMethod,
				txHash.toString(),
				getEstimatedFee(txRequest),
				getGasDetails(txRequest),
			)

			await this.markJournal(journalId, { stage: "succeeded", txHash: txHash.toString() })

			if (op.opts.wait === "NO_WAIT") {
				return { txHash, ...offchainOutput } as SendReturn<InteractionWaitOptions>
			}
			const receipt = await node.getTxReceipt(txHash)
			return { receipt, ...offchainOutput } as SendReturn<InteractionWaitOptions>
		} catch (error) {
			if (error instanceof JobCancelledSentinel) {
				throw error
			}
			await this.markJournal(journalId, { stage: "failed" }, normalizeError(error, "dapp_execute"))
			throw error
		} finally {
			if (journalId) this.activeControllers.delete(journalId)
		}
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
	): Promise<SendReturn<InteractionWaitOptions>> {
		this.logDebug(
			`executeNoFromSendTx: starting, accountAddress=${op.accountAddress}, calls=${op.exec?.calls?.length}, additionalScopes=${JSON.stringify(op.opts?.additionalScopes)}`,
		)
		if (op.feeSettings?.paymentMethod?.kind && op.feeSettings.paymentMethod.kind !== "embedded") {
			throw new Error("DefaultEntrypoint transactions must use embedded fee payment")
		}

		// Phase 2: NO_FROM / default_entrypoint dApp paths get the same durable
		// coverage as the standard flows. Codex Week 1 review flagged that
		// the original "journal coverage deferred" comment left this path
		// without `profileId`, `enteredProveAt`, normalized failure envelope,
		// or cancel support.
		const primaryMethod = (Array.isArray(op.exec?.calls) ? op.exec.calls.find((c) => c?.name)?.name : undefined) ?? undefined
		const journalId = await this.beginDappExecuteJournal(
			op.networkId,
			op.accountAddress,
			origin,
			primaryMethod ? [{ method: primaryMethod }] : undefined,
		)

		const controller = journalId ? new AbortController() : undefined
		if (journalId && controller) this.activeControllers.set(journalId, controller)
		const checkCancelled = (): void => {
			if (controller?.signal.aborted) throw new JobCancelledSentinel(journalId ?? "")
		}

		try {
			await this.markJournal(journalId, { stage: "simulating" })

			const [txRequest, node, pxe, account, network, txCalls] = await this.txBuilder.buildNoFrom(op, parentTask)
			this.logDebug(
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
			this.logDebug(
				`executeNoFromSendTx: dappScopes=${JSON.stringify(dappScopes)}, additionalScopes=${JSON.stringify(additionalScopes)}, scopesWithAccount=${JSON.stringify(scopesWithAccount)}`,
			)

			this.logDebug(`executeNoFromSendTx: starting kernelless discovery simulation`)
			const discoveryResult = await pxe.simulateTx(
				txRequest,
				{ simulatePublic: true, skipTxValidation: true, skipFeeEnforcement: true, scopes: additionalScopes },
				[account.address.toString()],
			)

			this.logDebug(`executeNoFromSendTx: kernelless discovery completed`)
			// Extract auth witness requirements from CallAuthorizationRequest offchain effects
			const effects = collectOffchainEffects(discoveryResult.privateExecutionResult)
			this.logDebug(`executeNoFromSendTx: offchain effects found: ${effects.length}`)
			if (effects.length) {
				const nodeInfo2 = await node.getNodeInfo()
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

			this.logDebug(`executeNoFromSendTx: authwits added: ${txRequest.authWitnesses.length}, starting real simulation`)
			// Real simulation with actual auth witnesses and real account contract
			const simulatedTx = await this.coordinator.simulateTxTask(
				pxe,
				txRequest,
				{ simulatePublic: true, skipFeeEnforcement: true, scopes: scopesWithAccount },
				parentTask,
			)
			await finalizeGasLimits(node, txRequest, simulatedTx, 1, undefined, feeOpts, 1)

			// Prove with account in scope
			checkCancelled()
			await this.markJournal(journalId, { stage: "proving", enteredProveAt: Date.now() })
			const provedTx = await this.coordinator.proveTxTask(pxe, txRequest, scopesWithAccount, parentTask)
			checkCancelled()
			const timestamp = provedTx.publicInputs.constants.anchorBlockHeader.globalVariables.timestamp
			const offchainOutput = extractOffchainOutput(provedTx.getOffchainEffects(), BigInt(timestamp))
			const tx = await provedTx.toTx()
			await this.markJournal(journalId, { stage: "submitting" })
			checkCancelled()
			await this.networkService.withBinding(network.chainId, async (b) => this.coordinator.sendTxTask(b.node, tx, parentTask))

			const txHash = tx.getTxHash()
			await this.transactionService.addTransaction(
				origin,
				network.chainId,
				account.address.toString(),
				txCalls,
				Fr.ZERO.toString(),
				AccountFeePaymentMethodOptions.EXTERNAL,
				txHash.toString(),
				getEstimatedFee(txRequest),
				getGasDetails(txRequest),
			)

			await this.markJournal(journalId, { stage: "succeeded", txHash: txHash.toString() })

			if (op.opts.wait === "NO_WAIT") {
				return { txHash, ...offchainOutput } as SendReturn<InteractionWaitOptions>
			}
			const receipt = await node.getTxReceipt(txHash)
			return { receipt, ...offchainOutput } as SendReturn<InteractionWaitOptions>
		} catch (error) {
			if (error instanceof JobCancelledSentinel) {
				throw error
			}
			await this.markJournal(journalId, { stage: "failed" }, normalizeError(error, "dapp_execute"))
			throw error
		} finally {
			if (journalId) this.activeControllers.delete(journalId)
		}
	}

	public async executeAztecCreateAuthWit(op: AztecCreateAuthWitOperation): Promise<AuthWitness> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Wallet locked")
		}
		const network = await this.networkService.getNetwork(op.networkId)
		const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress.toString())

		const nodeInfo = await this.networkService.withBinding(network.chainId, async (b) => b.node.getNodeInfo())
		const metadata = {
			chainId: new Fr(nodeInfo.l1ChainId),
			version: new Fr(nodeInfo.rollupVersion),
		}

		let messageHash: Fr
		if (typeof op.messageHashOrIntent === "object" && "caller" in op.messageHashOrIntent) {
			const { caller, call } = op.messageHashOrIntent
			const intentAction: CallIntent = {
				caller: await AztecAddress.schema.parseAsync(caller),
				call: new FunctionCall(
					call.name,
					await AztecAddress.schema.parseAsync(call.to),
					await FunctionSelector.schema.parseAsync(call.selector),
					call.type,
					call.hideMsgSender,
					call.isStatic,
					await z.array(Fr.schema).parseAsync(call.args),
					await z.array(AbiTypeSchema).parseAsync(call.returnTypes),
				),
			}
			messageHash = await computeAuthWitMessageHash(intentAction, metadata)
		} else if (typeof op.messageHashOrIntent === "object" && "consumer" in op.messageHashOrIntent) {
			const { consumer, innerHash } = op.messageHashOrIntent
			const intentHash: IntentInnerHash = {
				consumer: await AztecAddress.schema.parseAsync(consumer),
				innerHash: await Fr.schema.parseAsync(innerHash),
			}
			messageHash = await computeAuthWitMessageHash(intentHash, metadata)
		} else {
			// Raw Fr message hash (pre-computed by wallet-sdk)
			messageHash = await Fr.schema.parseAsync(op.messageHashOrIntent)
		}

		const authWitness = await account.createAuthWit(messageHash)

		return authWitness
	}

	// internals

	/** Dispatcher — clones the op (`fjwc` / `fpc` mutate actions), looks
	 *  up the `FeeStrategy` by kind, and delegates. Replaces the
	 *  4-way switch from the pre-strategy era. Thin delegator only —
	 *  collaborators own the actual logic. */
	private async buildAndEstimateTxRequest(
		inputOp: {
			networkId: string
			accountAddress: string
			actions: Action[]
			fee?: FeeOptions
		},
		feeSettings: FeeSettings,
		parentTask?: WrappedTask,
	): Promise<FeeEstimateResult> {
		// Clone the op + its actions array. fjwc / fpc branches mutate
		// `op.actions` (unshift / splice) to prepend fee payloads; leaking
		// those mutations back to the caller breaks repeat estimates and
		// any caller that keeps a reference to the array.
		const op = { ...inputOp, actions: [...inputOp.actions] }
		const feeMultiplier = feeSettings.priorityLevel ? PRIORITY_MULTIPLIERS[feeSettings.priorityLevel] : undefined
		const gasPadding = op.fee?.gasPadding ?? 1.05
		const strategy = this.feeStrategies.get(feeSettings.paymentMethod.kind)
		if (!strategy) {
			throw new Error("Invalid fee payment method")
		}
		const ctx: FeeStrategyContext = {
			op,
			feeSettings,
			feeMultiplier,
			gasPadding,
			parentTask,
			deps: {
				txBuilder: this.txBuilder,
				simulateTxTask: (pxe, req, opts, task) => this.coordinator.simulateTxTask(pxe, req, opts, task),
				fpcService: this.fpcService,
				tasks: this.taskService,
				logger: this.logger,
			},
		}
		return strategy.buildAndEstimate(ctx)
	}
}
