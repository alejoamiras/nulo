import { type IntentInnerHash, type CallIntent, computeAuthWitMessageHash } from "@aztec/aztec.js/authorization"
import { Fr } from "@aztec/foundation/curves/bn254"
import { AbiTypeSchema, type ContractArtifact, ContractArtifactSchema, FunctionSelector, FunctionCall } from "@aztec/stdlib/abi"
import type { AuthWitness } from "@aztec/stdlib/auth-witness"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import {
	computeContractAddressFromInstance,
	type ContractInstanceWithAddress,
	ContractInstanceWithAddressSchema,
	getContractClassFromArtifact,
	computePartialAddress,
} from "@aztec/stdlib/contract"
import z from "zod"
import { NetworkService, networkInfoFrom } from "@/wallet/services/network/service"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { AccountService } from "@/wallet/services/account/service"
import { ContactService } from "@/wallet/services/contact/service"
import { ProfileService } from "@/wallet/services/profile/service"
import type { ExecutionFence, ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import { TokenService } from "@/wallet/services/token/service"
import { FpcService, FpcType } from "@/wallet/services/fpc/service"
import { TransactionService, OriginType, type TransferType, type LocalTxOrigin, TxStatus } from "@/wallet/services/transaction/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import type { OperationContext } from "@/wallet/services/operation-journal/spec"
import type { ExecutionHooks } from "@/wallet/services/dapp-interaction/spec"
import { TaskService, type WrappedTask, ExecuteOperationContent } from "@/wallet/services/task/service"
import type { ILogger } from "@/wallet/logger"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { classifyOperationCatch } from "./rpc-cancel"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { assertLiveChainIdentity } from "@nulo/aztec-runtime/utils"
import {
	EXECUTION_SERVICE_NAME,
	type Methods,
	type Operation,
	type RegisterSenderOperation,
	type RegisterContractOperation,
	type SendTransactionOperation,
	type OperationResult,
	type Action,
	type FeeSettings,
	PRIORITY_MULTIPLIERS,
	type AztecRegisterSenderOperation,
	type AztecRegisterContractOperation,
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
import { ViewExecutor } from "./view-executor"
import { ExecutionLane } from "./execution-lane"
import { GasBalanceReader } from "./gas-balance-reader"
import { ContractResolver } from "./contract-resolver"
import { getViewSimulationDeps } from "./helpers/get-view-simulation-deps"
import type { MaterializedRegisterTokenOperation } from "./models"
import { AuthwitDiscoverer } from "./authwit-discoverer"
import { TxRequestBuilder } from "./tx-request-builder"
import type { FeeEstimate, FeeStrategy, FeeStrategyContext, FeeStrategyDeps } from "./fee/fee-strategy"
import { FeeJuiceStrategy } from "./fee/fee-juice-strategy"
import { FeeJuiceWithClaimStrategy } from "./fee/fee-juice-with-claim-strategy"
import { FpcStrategy } from "./fee/fpc-strategy"
import { EmbeddedStrategy } from "./fee/embedded-strategy"
import { ExecutionCoordinator } from "./execution-coordinator"
import { type ProofGate, NOOP_PROOF_GATE } from "@/e2e/proof-gate"

export * from "./spec"

/** Default PXE-client factory: the real RPC-backed client. Exported so the
 *  construction seam (real client vs the composition-test fake) is unit-testable
 *  without spinning up `init()` + a full ServiceCollection. */
export const DEFAULT_PXE_CLIENT_FACTORY = (logger: ILogger): PxeServiceClient => new PxeServiceClient(logger)

export class ExecutionService extends Service<Methods> implements ServiceSpec<Methods> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"executeTransfer",
		"executeOperations",
		"getGasBalances",
		"estimateTransferFee",
		"estimateOperationFee",
		"cancelJob",
	)
	public static name = EXECUTION_SERVICE_NAME

	private pxeService: PxeServiceClient = null!
	private profileService: ProfileService = null!
	private networkService: NetworkService = null!
	private accountService: AccountService = null!
	private contactService: ContactService = null!
	private tokenService: TokenService = null!
	private fpcService: FpcService = null!
	private transactionService: TransactionService = null!
	private deletionState: ProfileDeletionState = null!
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
	 *  1-3s of post-confirm "estimating fee" UX delay.
	 *
	 *  Scope: Send-page transfer flow only. dApp paths (estimateOperationFee
	 *  + executeAztecSendTx) carve out per audit-codex-v3 — the embedded-fee
	 *  and default_entrypoint variants take divergent code paths that the
	 *  reuse contract doesn't yet cover. */
	private estimateReuse: TransferEstimateReuse = null!
	private transferExecutor: TransferExecutor = null!
	private dappSendExecutor: DappSendExecutor = null!
	private viewExecutor: ViewExecutor = null!
	private lane: ExecutionLane = null!

	public constructor(
		logger: ILogger,
		/** E2E-only proving hold-point, forwarded to the coordinator. The
		 *  no-op default keeps production proving unimpeded. */
		private readonly proofGate: ProofGate = NOOP_PROOF_GATE,
		/** PXE-client factory — the seam for in-process composition tests. The
		 *  default builds the real RPC-backed client, so production is unchanged;
		 *  tests inject a fake to drive the graph without the offscreen PXE /
		 *  Aztec sandbox. (Rollout: extract an `ExecutionPxePort` interface to
		 *  drop the test-side cast — deferred per the spike's codex audit.) */
		private readonly pxeClientFactory: (logger: ILogger) => PxeServiceClient = DEFAULT_PXE_CLIENT_FACTORY,
	) {
		super(EXECUTION_SERVICE_NAME, logger)
	}

	protected async init(services: ServiceCollection) {
		this.pxeService = this.pxeClientFactory(this.logger)
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
		this.deletionState = this.profileService.getDeletionState()
		this.planner = new OperationPlanner(this.profileService, this.tokenService)
		this.resolver = new ContractResolver(this.logger)
		this.authwit = new AuthwitDiscoverer(this.logger)
		this.coordinator = new ExecutionCoordinator(this.taskService, this.logger, this.proofGate)
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
		this.lane = new ExecutionLane({
			operationJournal: this.operationJournal,
			getActiveProfile: () => this.profileService.getActiveProfile(),
			getNetwork: (networkId) => this.networkService.getNetwork(networkId),
			logDebug: (msg, ...rest) => this.logDebug(msg, ...rest),
			logInfo: (msg, ...rest) => this.logInfo(msg, ...rest),
			logError: (msg, ...rest) => this.logError(msg, ...rest),
		})
		this.transferExecutor = new TransferExecutor({
			tasks: this.taskService,
			planner: this.planner,
			estimateReuse: this.estimateReuse,
			coordinator: this.coordinator,
			lane: {
				registerController: (journalId, controller) => this.lane.registerController(journalId, controller),
				deleteController: (journalId) => this.lane.deleteController(journalId),
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
				registerController: (journalId, controller) => this.lane.registerController(journalId, controller),
				deleteController: (journalId) => this.lane.deleteController(journalId),
				acquireSlot: (networkId, queuedJournalId, onEnqueued, originKey) =>
					this.lane.acquireSlot(networkId, queuedJournalId, onEnqueued, originKey),
				claimOrCreateJournal: (networkId, accountAddress, origin, calls, hooks, reuseController) =>
					this.lane.claimOrCreateJournal(networkId, accountAddress, origin, calls, hooks, reuseController),
				beginJournal: (networkId, accountAddress, origin, calls) =>
					this.lane.beginJournal(networkId, accountAddress, origin, calls),
				markJournal: (journalId, progress, error) => this.lane.markJournal(journalId, progress, error),
			},
			buildAndEstimate: (op, feeSettings, parentTask) => this.buildAndEstimateTxRequest(op, feeSettings, parentTask),
			addTransaction: (...args) => this.transactionService.addTransaction(...args),
			recordPendingAuthwits: (...args) => this.authRegistryService.recordPendingAuthwits(...args),
			logDebug: (msg) => this.logDebug(msg),
		})
		this.viewExecutor = new ViewExecutor({
			planner: this.planner,
			resolver: this.resolver,
			txBuilder: this.txBuilder,
			pxeService: this.pxeService,
			profileService: this.profileService,
			networkService: this.networkService,
			accountService: this.accountService,
			contactService: this.contactService,
			logDebug: (msg, ...rest) => this.logDebug(msg, ...rest),
			logError: (msg, ...rest) => this.logError(msg, ...rest),
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

	/** Capture the {profileId, epoch} fence at execution AUTHORIZATION (before the
	 *  slow prove) so `addTransaction` can reject a completing prove whose profile
	 *  was deleted meanwhile (D13). Capturing here — NOT inside proveAndSend — is
	 *  what makes the fence sound: an op that reaches proveAndSend after a delete
	 *  would otherwise capture the NEW epoch and slip through. */
	private async captureFence(): Promise<ExecutionFence> {
		const profile = await requireActiveProfile(this.profileService, "Wallet locked")
		return { profileId: profile.id, epoch: this.deletionState.capture(profile.id) }
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
		const fence = await this.captureFence()
		return this.transferExecutor.execute(
			{ networkId, accountAddress, tokenId, transferType, recipientAddress, amount, feeSettings },
			precomputedEstimateId,
			fence,
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

	/** Cancel an in-flight job. Semantics live on {@link ExecutionLane.cancelJob}
	 *  (journal-transition-first, abort-second; idempotent). */
	public async cancelJob(jobId: string): Promise<void> {
		await this.ensureInitialized()
		return this.lane.cancelJob(jobId)
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
						result = await this.viewExecutor.executeSimulateTransaction(operation)
						break
					}
					case "simulate_utility": {
						result = await this.viewExecutor.executeSimulateUtility(operation)
						break
					}
					// Aztec.js interface:
					case "aztec_getContractClassMetadata": {
						result = await this.viewExecutor.executeAztecGetContractClassMetadata(operation)
						break
					}
					case "aztec_getContractMetadata": {
						result = await this.viewExecutor.executeAztecGetContractMetadata(operation)
						break
					}
					case "aztec_getPrivateEvents": {
						result = await this.viewExecutor.executeAztecGetPrivateEvents(operation)
						break
					}
					case "aztec_getChainInfo": {
						result = await this.viewExecutor.executeAztecGetChainInfo(operation)
						break
					}
					case "aztec_registerSender": {
						result = await this.executeAztecRegisterSender(operation)
						break
					}
					case "aztec_getAddressBook": {
						result = await this.viewExecutor.executeAztecGetAddressBook(operation)
						break
					}
					case "aztec_registerContract": {
						result = await this.executeAztecRegisterContract(operation)
						break
					}
					case "aztec_simulateTx": {
						result = await this.viewExecutor.executeAztecSimulateTx(operation)
						break
					}
					case "aztec_executeUtility": {
						result = await this.viewExecutor.executeAztecExecuteUtility(operation)
						break
					}
					case "aztec_profileTx": {
						result = await this.viewExecutor.executeAztecProfileTx(operation)
						break
					}
					case "aztec_sendTx": {
						// Hooks forwarded ONLY to aztec_sendTx; other ops don't need them.
						// Capture the deletion fence HERE (a send op that writes a tx),
						// not at the batch top — read-only ops must not trip the
						// unlock check, and this is still before the prove (D13).
						const fence = await this.captureFence()
						result = await this.dappSendExecutor.executeAztecSendTx(operation, origin, operationTask, hooks, fence)
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
		const addressNum = AztecAddress.fromStringUnsafe(op.address).toBigInt()
		if (addressNum >= 0 && addressNum <= 6) {
			// ignore protocol contracts registration,
			// because we cannot validate it due to hardcoded addresses
			return
		}

		const network = await this.networkService.getNetwork(op.networkId)

		const providedInstance = await ContractInstanceWithAddressSchema.optional().parseAsync(op.instance)
		const instance =
			providedInstance ??
			(await this.pxeService.getContractInstance(networkInfoFrom(network), AztecAddress.fromStringUnsafe(op.address)))
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
		await this.pxeService.registerSender(networkInfoFrom(network), AztecAddress.fromStringUnsafe(op.address))
	}

	private async executeRegisterToken(
		op: MaterializedRegisterTokenOperation,
		origin: LocalTxOrigin,
		parentTask?: WrappedTask,
	): Promise<void> {
		const profile = await requireActiveProfile(this.profileService, "Wallet locked")
		const network = await this.networkService.getNetwork(op.networkId)

		// Honor the popup's pre-fetched interface (`previewedInterface`) if it
		// passes the contract+chainId sanity check (Opus F4). Otherwise fall back
		// to a fresh `parseTokenInterface`. The previewed interface is set by
		// the popup's approve mapper AFTER `previewTokenMetadata` resolves, so
		// it's extension-internal data — but we still validate it identifies
		// the same on-chain contract the dApp asked us to register, in case of
		// popup-side bugs.
		let ti: Awaited<ReturnType<TokenService["parseTokenInterface"]>>
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
		const fence = await this.captureFence()
		return this.dappSendExecutor.executeSendTransaction(op, origin, parentTask, fence)
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

	public async getGasBalances(networkId: string, accountAddress: string, forceRefresh?: boolean): Promise<GasBalances> {
		await this.ensureInitialized()
		return this.gasBalances.get(networkId, accountAddress, forceRefresh)
	}

	// Aztec.js interface:

	private async executeAztecRegisterSender(op: AztecRegisterSenderOperation): Promise<AztecAddress> {
		const network = await this.networkService.getNetwork(op.networkId)
		return this.pxeService.registerSender(networkInfoFrom(network), op.address)
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

	public async executeAztecCreateAuthWit(op: AztecCreateAuthWitOperation): Promise<AuthWitness> {
		const profile = await requireActiveProfile(this.profileService, "Wallet locked")
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
		}
		return strategy.buildAndEstimate(ctx)
	}
}
