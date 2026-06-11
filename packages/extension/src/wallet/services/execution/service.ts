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
import type { ExecutionHooks } from "@/wallet/services/dapp-interaction/spec"
import { claimOrCreateDappExecuteJournal as claimOrCreateDappExecuteJournalImpl } from "./claim-helper"
import {
	type AcquireCaps,
	ExecutionMutex,
	ExecutionMutexAbortError,
	ExecutionMutexCapacityError,
	type ExecutionMutexRelease,
} from "./execution-mutex"
import { TaskService, type WrappedTask, ExecuteOperationContent, TransferContent } from "@/wallet/services/task/service"
import type { ILogger } from "@/wallet/logger"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service } from "@nulo/extension-messaging/background"
import { TooManyPendingError } from "@nulo/extension-messaging/errors"
import { type JobError, type JobProgress, JobCancelledSentinel, normalizeError } from "@nulo/wallet-core/jobs"
import { classifyOperationCatch, maybeRethrowAsRpcCancel } from "./rpc-cancel"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { assertLiveChainIdentity } from "@nulo/aztec-runtime/utils"
import {
	EXECUTION_SERVICE_NAME,
	type Methods,
	type Operation,
	type RegisterSenderOperation,
	type RegisterTokenOperation,
	type RegisterContractOperation,
	type SendTransactionOperation,
	type SimulateTransactionOperation,
	type SimulateUtilityOperation,
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
import { TransferEstimateReuse } from "./transfer-estimate-reuse"
import { TransferExecutor } from "./transfer-executor"
import { DappSendExecutor } from "./dapp-send-executor"
import { GasBalanceReader } from "./gas-balance-reader"
import { getEstimatedFee, getGasDetails } from "./tx-fee-details"
import { ContractResolver, findFunctionByName } from "./contract-resolver"
import { batchedViewSimulation } from "./helpers/batched-view-simulation"
import { getViewSimulationDeps } from "./helpers/get-view-simulation-deps"
import type { MaterializedRegisterTokenOperation } from "./models"
import { AuthwitDiscoverer } from "./authwit-discoverer"
import { TxRequestBuilder } from "./tx-request-builder"
import {
	type FeeEstimate,
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
import { pickPrimaryMethod } from "@/utils/primary-method"

export * from "./spec"

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

	/**
	 * Public read-only access to the `ContractResolver` instance so external
	 * callers (BalanceProjector, getViewSimulationDeps) get the same instance
	 * rather than reaching into `this.resolver` via a private-state escape
	 * hatch (codex final-pass FC6).
	 */
	public get contractResolver(): ContractResolver {
		return this.resolver
	}
	private authwit: AuthwitDiscoverer = null!
	private txBuilder: TxRequestBuilder = null!
	private feeStrategies: Map<FeeSettings["paymentMethod"]["kind"], FeeStrategy> = null!
	private coordinator: ExecutionCoordinator = null!

	/** TTL cache for gas balance queries (survives popup reopens). */
	private gasBalances: GasBalanceReader = null!

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
	private estimateReuse: TransferEstimateReuse = null!
	private transferExecutor: TransferExecutor = null!
	private dappSendExecutor: DappSendExecutor = null!

	/** Phase 2 cancel surface: jobId → AbortController. SW-internal only,
	 *  never crosses the wire. `cancelJob(id)` aborts the controller; the
	 *  in-flight prove pipeline checks `signal.aborted` at each stage
	 *  boundary and short-circuits with {@link JobCancelledSentinel}. */
	private activeControllers = new Map<string, AbortController>()

	/** v3: per-(profileId, chainId) FIFO mutex serializing dApp sendTx
	 *  EXECUTION (build → simulate → prove → submit). Once the session-FIFO
	 *  baton releases at popup approval, two approved sendTx can both reach
	 *  execution; this mutex keeps them sequential so T2 doesn't simulate
	 *  against T1's not-yet-spent private notes (which would get T2 rejected
	 *  on-chain). Keyed to match PXE's own `chainGuard` scope. Held from
	 *  before authwit discovery through submit, both send paths. */
	private readonly executionMutex = new ExecutionMutex()

	/** v3: journal ids currently WAITING on `executionMutex.acquire` (not yet
	 *  holding). While non-empty, `executionHeartbeatTimer` bumps each record's
	 *  `updatedAt` so the periodic reaper doesn't false-declare a legitimately-
	 *  waiting record "stuck" — the Nth concurrent sendTx can wait (N-1)×per-tx
	 *  while queued, which can exceed the 10-min queued / 2-min pending grace.
	 *  Membership spans only the acquire wait: a holder uses its stage-transition
	 *  `updatedAt` bumps (proving grace is 35 min). Stage-agnostic by design —
	 *  silent-path waiters fast-forward to `pending` before executing. */
	private readonly executionWaiters = new Set<string>()
	private executionHeartbeatTimer?: ReturnType<typeof setInterval>
	private static readonly EXECUTION_WAIT_HEARTBEAT_MS = 30_000
	/** Backpressure caps on the per-(profileId, chainId) execution lane. The
	 *  per-origin cap stops one dApp monopolizing the shared lane and starving
	 *  another; the lane cap is a coarse total ceiling. Mirror the journal
	 *  in-flight visibility caps (8 / 32). */
	private static readonly EXECUTION_ORIGIN_CAP = 8
	private static readonly EXECUTION_LANE_CAP = 32

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
		this.gasBalances = new GasBalanceReader({
			getChainId: async (networkId) => (await this.networkService.getNetwork(networkId)).chainId,
			getViewDeps: (networkId, accountAddress) =>
				getViewSimulationDeps(
					{
						profiles: this.profileService,
						networks: this.networkService,
						accounts: this.accountService,
						pxeService: this.pxeService,
						contractResolver: this.resolver,
						logger: this.logger,
					},
					networkId,
					accountAddress,
				),
			getFpcs: (chainId) => this.fpcService.getFpcs(chainId),
			logDebug: (msg, ...rest) => this.logDebug(msg, ...rest),
			logError: (msg, ...rest) => this.logError(msg, ...rest),
		})
		this.estimateReuse = new TransferEstimateReuse({
			getActiveProfile: () => this.profileService.getActiveProfile(),
			getNetwork: (networkId) => this.networkService.getNetwork(networkId),
			getNode: (chainId) => this.networkService.getNode(chainId),
			getPendingForAccount: (account) => this.transactionService.getPendingForAccount(account),
			logDebug: (msg) => this.logDebug(msg),
		})
		this.transferExecutor = new TransferExecutor({
			tasks: this.taskService,
			planner: this.planner,
			estimateReuse: this.estimateReuse,
			coordinator: this.coordinator,
			lane: {
				registerController: (journalId, controller) => this.activeControllers.set(journalId, controller),
				deleteController: (journalId) => this.activeControllers.delete(journalId),
			},
			getActiveProfile: () => this.profileService.getActiveProfile(),
			getNetwork: (networkId) => this.networkService.getNetwork(networkId),
			getNode: (chainId) => this.networkService.getNode(chainId),
			getPXE: (network) => this.pxeService.getPXE(networkInfoFrom(network)),
			getAccountContract: (profileId, chainId, address) => this.accountService.getAccountContract(profileId, chainId, address),
			getPendingForAccount: (account) => this.transactionService.getPendingForAccount(account),
			addTransaction: (...args) => this.transactionService.addTransaction(...args),
			buildAndEstimate: (op, feeSettings, parentTask) => this.buildAndEstimateTxRequest(op, feeSettings, parentTask),
			createJournalOperation: (input) => this.operationJournal.createOperation(input),
			transitionJournal: (journalId, progress, error) => this.operationJournal.transitionOperation(journalId, progress, error),
			logDebug: (msg) => this.logDebug(msg),
			logError: (msg, ...rest) => this.logError(msg, ...rest),
		})
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
		this.dappSendExecutor = new DappSendExecutor({
			planner: this.planner,
			authwit: this.authwit,
			txBuilder: this.txBuilder,
			coordinator: this.coordinator,
			lane: {
				registerController: (journalId, controller) => this.activeControllers.set(journalId, controller),
				deleteController: (journalId) => this.activeControllers.delete(journalId),
				acquireSlot: (networkId, queuedJournalId, onEnqueued, originKey) =>
					this.acquireExecutionSlot(networkId, queuedJournalId, onEnqueued, originKey),
				claimOrCreateJournal: (networkId, accountAddress, origin, calls, hooks, reuseController) =>
					this.claimOrCreateDappExecuteJournal(networkId, accountAddress, origin, calls, hooks, reuseController),
				beginJournal: (networkId, accountAddress, origin, calls) =>
					this.beginDappExecuteJournal(networkId, accountAddress, origin, calls),
				markJournal: (journalId, progress, error) => this.markJournal(journalId, progress, error),
			},
			buildAndEstimate: (op, feeSettings, parentTask) => this.buildAndEstimateTxRequest(op, feeSettings, parentTask),
			addTransaction: (...args) => this.transactionService.addTransaction(...args),
			logDebug: (msg) => this.logDebug(msg),
		})
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
				this.gasBalances.invalidateAccount(tx.account)
			}
		})

		// PrivateFPC address is read on every getGasBalances() call to fetch
		// `balance_of`. The cache is keyed only by `${networkId}:${account}`,
		// so swapping the PrivateFPC address would otherwise serve stale
		// private-FJ readouts for up to GAS_BALANCE_TTL_MS. Clear the cache
		// on any PrivateFpc mutation. Coarse but correct.
		const invalidateOnPrivateFpc = (fpc: { type: FpcType }) => {
			if (fpc.type === FpcType.PrivateFpc) this.gasBalances.clear()
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
		return this.transferExecutor.execute(
			{ networkId, accountAddress, tokenId, transferType, recipientAddress, amount, feeSettings },
			precomputedEstimateId,
		)
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
		return this.transferExecutor.estimateFee({
			networkId,
			accountAddress,
			tokenId,
			transferType,
			recipientAddress,
			amount,
			feeSettings,
		})
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
		return this.dappSendExecutor.estimateOperationFee(operation, feeSettings)
	}

	public async executeOperations(
		operations: Operation[],
		origin: LocalTxOrigin,
		parentTask?: WrappedTask,
		hooks?: ExecutionHooks,
	): Promise<OperationResult[]> {
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
						// Hooks forwarded ONLY to aztec_sendTx; other ops don't need them.
						result = await this.dappSendExecutor.executeAztecSendTx(operation, origin, operationTask, hooks)
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

	private async executeRegisterToken(
		op: MaterializedRegisterTokenOperation,
		origin: LocalTxOrigin,
		parentTask?: WrappedTask,
	): Promise<void> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Wallet locked")
		}
		const network = await this.networkService.getNetwork(op.networkId)

		// Honor the popup's pre-fetched interface (`previewedInterface`) if it
		// passes the contract+chainId sanity check (Opus F4). Otherwise fall back
		// to a fresh `parseTokenInterface`. The previewed interface is set by
		// the popup's approve mapper AFTER `previewTokenMetadata` resolves, so
		// it's extension-internal data — but we still validate it identifies
		// the same on-chain contract the dApp asked us to register, in case of
		// popup-side bugs.
		let ti
		if (
			op.previewedInterface &&
			op.previewedInterface.contract.toLowerCase() === op.address.toLowerCase() &&
			op.previewedInterface.chainId === network.chainId
		) {
			ti = op.previewedInterface
		} else {
			if (op.previewedInterface) {
				this.logError(
					"executeRegisterToken: discarding previewedInterface — contract/chainId mismatch",
					op.previewedInterface.contract,
					op.previewedInterface.chainId,
					op.address,
					network.chainId,
				)
			}
			ti = await this.tokenService.parseTokenInterface(op.networkId, op.address, parentTask)
		}

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
		return this.dappSendExecutor.executeSendTransaction(op, origin, parentTask)
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
			const primaryMethod = pickPrimaryMethod(calls)
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

	/**
	 * Claim a pre-allocated queued journal record (transition queued → pending)
	 * OR create a new in-flight record if no queued id was provided.
	 *
	 * Decision tree + invariants live in `./claim-helper.ts` so they're
	 * unit-testable without spinning up the full ExecutionService harness.
	 * This thin wrapper just binds `this.*` dependencies into the helper's
	 * dependency injection shape.
	 */
	/** Resolve the execution-mutex key for a dApp sendTx: `(profileId, chainId)`,
	 *  matching PXE's `chainGuard` scope exactly. Both lookups are metadata-only
	 *  (no PXE call), so calling them before acquiring the mutex is safe — they
	 *  don't contend on the chain guard. `getNetwork` is re-resolved inside
	 *  `buildAndEstimateTxRequest` later; the duplicate lookup is a negligible
	 *  in-memory cost paid for keying correctness. */
	private async resolveExecutionMutexKey(networkId: string): Promise<string> {
		const profile = await this.profileService.getActiveProfile()
		const network = await this.networkService.getNetwork(networkId)
		return `${profile?.id ?? "noprofile"}:${network.chainId}`
	}

	/**
	 * Acquire the per-(profileId, chainId) execution slot for a dApp sendTx,
	 * FIFO. When a `queuedJournalId` exists (a "Queued" record the user can see
	 * + cancel), an AbortController is registered under it BEFORE the acquire so
	 * a user-cancel during the wait aborts `acquire` → surfaces as
	 * `JobCancelledSentinel` → the dApp sees EIP-1193 4001. That same controller
	 * is reused by the journal claim (claimed id === queuedJournalId), so it
	 * lives in `activeControllers` continuously from before the wait through
	 * execution — strictly safer for the cancel-vs-claim race than registering
	 * one only after the claim transition.
	 *
	 * The waiting record is heartbeated (updatedAt bumped) for the duration of
	 * the wait so the periodic reaper doesn't declare it stuck.
	 *
	 * Returns the mutex release callback (call in `finally`) and the
	 * pre-acquire controller to thread into the claim.
	 */
	private async acquireExecutionSlot(
		networkId: string,
		queuedJournalId: string | undefined,
		onEnqueued?: () => void,
		originKey?: string,
	): Promise<{ release: ExecutionMutexRelease; preController: AbortController | undefined }> {
		const mutexKey = await this.resolveExecutionMutexKey(networkId)
		// Per-origin + total-lane backpressure cap. `originKey` is the canonical
		// dApp origin (threaded from ctx.origin); the sentinel keeps an unexpected
		// absent origin capped under one bucket rather than bypassing the cap.
		const caps: AcquireCaps = {
			originKey: originKey ?? "__no_origin__",
			maxOriginDepth: ExecutionService.EXECUTION_ORIGIN_CAP,
			maxLaneDepth: ExecutionService.EXECUTION_LANE_CAP,
		}

		let preController: AbortController | undefined
		if (queuedJournalId) {
			preController = new AbortController()
			this.activeControllers.set(queuedJournalId, preController)
			this.beginExecutionWait(queuedJournalId)
		}

		try {
			// `acquire` installs this request as the FIFO tail SYNCHRONOUSLY, before
			// its first await (execution-mutex.ts). The instant we've called it we
			// are enqueued ahead of anyone who calls `acquire` later. Fire the baton
			// release HERE — before awaiting the grant — so the next session
			// message's popup opens immediately WHILE execution order is preserved:
			// that later request can only reach its own `acquire` after the baton
			// advances, i.e. strictly behind us in the FIFO. Releasing at popup
			// approval (before this point) would let a faster successor overtake us.
			// (On a capacity reject `acquire`'s synchronous cap-check rejects before
			// enqueue; onEnqueued still fires, which is a harmless early baton-advance
			// for a request that has just failed.)
			const acquirePromise = this.executionMutex.acquire(mutexKey, preController?.signal, caps)
			onEnqueued?.()
			const release = await acquirePromise
			return { release, preController }
		} catch (err) {
			// Clean the pre-acquire controller for any non-grant exit.
			if (queuedJournalId) this.activeControllers.delete(queuedJournalId)
			if (err instanceof ExecutionMutexCapacityError) {
				// Lane/origin backpressure. Terminalize the journal record HERE: the
				// caller's claim never runs, and the background safety-net only
				// terminalizes records still at `queued` — but the silent path
				// fast-forwards to `pending` before executing, so without this an
				// over-cap silent sendTx would leave a stuck `pending` card until the
				// reaper grace expires. Surface to the dApp as -32005.
				await this.markJournal(queuedJournalId, { stage: "failed" }, normalizeError(err, "dapp_execute"))
				throw new TooManyPendingError()
			}
			// Aborted while waiting (user cancelled the Queued record) — surface via
			// the cancelled pipeline.
			if (err instanceof ExecutionMutexAbortError) throw new JobCancelledSentinel(queuedJournalId ?? "")
			throw err
		} finally {
			// Wait is over (granted, aborted, or capacity-rejected). A holder no
			// longer needs the heartbeat — its stage transitions bump updatedAt;
			// proving grace is 35 min.
			if (queuedJournalId) this.endExecutionWait(queuedJournalId)
		}
	}

	private beginExecutionWait(journalId: string): void {
		this.executionWaiters.add(journalId)
		if (!this.executionHeartbeatTimer) {
			this.executionHeartbeatTimer = setInterval(() => {
				void this.heartbeatExecutionWaiters()
			}, ExecutionService.EXECUTION_WAIT_HEARTBEAT_MS)
		}
	}

	private endExecutionWait(journalId: string): void {
		this.executionWaiters.delete(journalId)
		if (this.executionWaiters.size === 0 && this.executionHeartbeatTimer) {
			clearInterval(this.executionHeartbeatTimer)
			this.executionHeartbeatTimer = undefined
		}
	}

	private async heartbeatExecutionWaiters(): Promise<void> {
		// Snapshot — touchOperation awaits and the set can mutate mid-iteration.
		for (const id of [...this.executionWaiters]) {
			try {
				await this.operationJournal.touchOperation(id)
			} catch {
				// Record gone (reaped / cancelled / completed) — harmless; the next
				// settle removes it from the wait-set.
			}
		}
	}

	private async claimOrCreateDappExecuteJournal(
		networkId: string,
		accountAddress: string,
		origin: LocalTxOrigin,
		calls: { method?: string }[] | undefined,
		hooks: ExecutionHooks | undefined,
		reuseController?: AbortController,
	): Promise<{ journalId: string | undefined; controller: AbortController | undefined }> {
		return claimOrCreateDappExecuteJournalImpl(
			{
				operationJournal: this.operationJournal,
				activeControllers: this.activeControllers,
				createFreshRecord: (n, a, o, c) => this.beginDappExecuteJournal(n, a, o, c),
				logger: {
					debug: (msg) => this.logDebug(msg),
					info: (msg) => this.logInfo(msg),
					error: (msg, raw) => this.logError(msg, raw),
				},
			},
			{ networkId, accountAddress, origin, calls, queuedJournalId: hooks?.queuedJournalId, reuseController },
		)
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
		const { txRequest, pxe, account } = await this.txBuilder.buildStandard(op, AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
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

		const fn = findFunctionByName(artifact, op.method)
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

	public async getGasBalances(networkId: string, accountAddress: string, forceRefresh?: boolean): Promise<GasBalances> {
		await this.ensureInitialized()
		return this.gasBalances.get(networkId, accountAddress, forceRefresh)
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
		const node = await this.networkService.getNode(network.chainId)
		const nodeInfo = await node.getNodeInfo()
		// F-012 / A-01 V-01: this API returns chain identity to the dApp.
		// A drifted RPC must be reported as a mismatch rather than silently
		// reporting whatever the RPC claims.
		assertLiveChainIdentity(network, nodeInfo)
		return { chainId: new Fr(nodeInfo.l1ChainId), version: new Fr(nodeInfo.rollupVersion) }
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
		const node = await this.networkService.getNode(network.chainId)

		if (remainingRaw.length > 0) {
			const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)
			const needsInit = await account.requiresInitialization(node)
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

		const pxe = this.pxeService.getPXE(networkInfoFrom(network))

		const result = await runFastPath({
			node,
			pxe,
			network,
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
		const { txRequest, node, pxe, account } = await this.txBuilder.buildStandard(
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
		const { txRequest, node, pxe } = await this.txBuilder.buildStandard({ ...op, actions }, feePaymentMethod)
		suggestGasLimits(txRequest, fee)
		await applyEmbeddedFpcGasCap(txRequest, fee, node)
		const additionalScopes = Array.isArray(op.opts.additionalScopes) ? op.opts.additionalScopes : []
		return pxe.profileTx(txRequest, {
			profileMode: op.opts.profileMode,
			skipProofGeneration: op.opts.skipProofGeneration,
			scopes: [AztecAddress.fromString(op.accountAddress), ...additionalScopes],
		})
	}

	public async executeAztecCreateAuthWit(op: AztecCreateAuthWitOperation): Promise<AuthWitness> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Wallet locked")
		}
		const network = await this.networkService.getNetwork(op.networkId)
		const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress.toString())

		const node = await this.networkService.getNode(network.chainId)
		const nodeInfo = await node.getNodeInfo()
		// F-012 / A-01 V-01: createAuthWit derives chain identity from the live
		// node; rebind to the user-selected network before consuming.
		assertLiveChainIdentity(network, nodeInfo)
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
	): Promise<FeeEstimate> {
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
