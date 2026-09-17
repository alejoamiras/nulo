import { type IntentInnerHash, type CallIntent, computeAuthWitMessageHash } from "@aztec/aztec.js/authorization"
import { Fr } from "@aztec/foundation/curves/bn254"
import { type ContractArtifact, ContractArtifactSchema, FunctionSelector, FunctionCall } from "@aztec/stdlib/abi"
import type { AuthWitness } from "@aztec/stdlib/auth-witness"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import {
	computeContractAddressFromInstance,
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
import type { ExecutionFence } from "@/wallet/services/profile/profile-deletion-state"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import { TokenService } from "@/wallet/services/token/service"
import { FpcService, FpcType } from "@/wallet/services/fpc/service"
import { TransactionService, OriginType, type TransferType, type LocalTxOrigin, TxStatus } from "@/wallet/services/transaction/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import type { OperationContext } from "@/wallet/services/operation-journal/spec"
import { isApprovedSendInFlight } from "@/utils/in-flight-send"
import { DAPP_INTERACTION_SERVICE_NAME, type ExecutionHooks } from "@/wallet/services/dapp-interaction/spec"
import { TaskService, type WrappedTask, ExecuteOperationContent } from "@/wallet/services/task/service"
import type { ILogger } from "@/wallet/logger"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { classifyOperationCatch } from "./rpc-cancel"
import { EstimateCancelRegistry } from "./estimate-cancel-registry"
import { ContractNotRegisteredError, JobCancelledError } from "@nulo/extension-messaging/errors"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
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
	type OperationApprovalEnvelope,
	type OperationAuthwitPreview,
	type DecodedCall,
	type DisplayCallInput,
	type RegisterTokenOperation,
	type TransferFeeEstimate,
} from "./spec"
import type { LastProveOutcome } from "./models"
import { coerceAmount } from "./coerce-amount"
import { OperationPlanner } from "./operation-planner"
import { TransferEstimateReuse } from "./transfer-estimate-reuse"
import { OperationEstimateReuse } from "./operation-estimate-reuse"
import { PreviewSnapshots } from "./preview-snapshots"
import { TransferExecutor } from "./transfer-executor"
import { DappSendExecutor } from "./dapp-send-executor"
import { DiscoveryAwareEstimator, type DiscoveryProbe } from "./discovery-aware-estimator"
import { ViewExecutor } from "./view-executor"
import { ExecutionLane } from "./execution-lane"
import { GasBalanceReader } from "./gas-balance-reader"
import { ContractResolver, findFunctionBySelector } from "./contract-resolver"
import { type ArtifactLookup, decodeCallForDisplay } from "./call-decoder"
import { getViewSimulationDeps } from "./helpers/get-view-simulation-deps"
import { AuthwitDiscoverer } from "./authwit-discoverer"
import { TxRequestBuilder } from "./tx-request-builder"
import type { FeeEstimate, FeeStrategy, FeeStrategyContext, FeeStrategyDeps } from "./fee/fee-strategy"
import { buildFeeStrategies } from "./fee/build-fee-strategies"
import { ExecutionCoordinator } from "./execution-coordinator"
import { type ProofGate, NOOP_PROOF_GATE } from "@/e2e/proof-gate"

export * from "./spec"

/** The dApp-interaction service's SW-internal view of a stored request: the
 *  operation at `(interactionId, index)`, materialized and — when fee settings
 *  are given — completed with a validated fee path. The estimate and preview
 *  entry points read the operation THROUGH this, never from their caller. */
export interface InteractionOperationSource {
	materializeStoredOperation(interactionId: string, index: number, feeSettings?: FeeSettings): Promise<Operation>
}

/** Default PXE-client factory: the real RPC-backed client. Exported so the
 *  construction seam (real client vs the composition-test fake) is unit-testable
 *  without spinning up `init()` + a full ServiceCollection. */
export const DEFAULT_PXE_CLIENT_FACTORY = (logger: ILogger): PxeServiceClient => new PxeServiceClient(logger)

/** A popup decodes one approval window at a time; anything past this is not a display request. */
const MAX_DISPLAY_CALLS = 64

/** The operations that run under the authorizing session's fence. The wallet-sdk dispatcher sends
 *  a dApp's reads, registrations, simulations and silent authwits with none, and those never read one. */
const FENCED_OPERATION_KINDS: ReadonlySet<Operation["kind"]> = new Set(["send_transaction", "aztec_sendTx", "register_token"])

export class ExecutionService extends Service<Methods> implements ServiceSpec<Methods> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"executeTransfer",
		"executeOperations",
		"getGasBalances",
		"peekGasBalances",
		"estimateTransferFee",
		"estimateOperationFee",
		"previewOperationAuthwits",
		"decodeCallsForDisplay",
		"cancelJob",
		"cancelEstimate",
		"getLastProveOutcome",
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

	/** Estimate→confirm reuse caches. The popup-side estimators write; the
	 *  confirm paths consume when the caller passes an estimate id AND the
	 *  validation snapshot matches the SW's current view — skipping the
	 *  `buildAndEstimateTxRequest` round-trip (and, for dApp ops, the
	 *  authwit-discovery simulation) on the happy path.
	 *
	 *  Scope: `estimateReuse` covers the Send-page transfer flow
	 *  (`estimateTransferFee` → `executeTransfer`); `operationEstimateReuse`
	 *  covers standard-mode `aztec_sendTx` (`estimateOperationFee` →
	 *  `executeAztecSendTx`, ids threaded via the popup-privileged
	 *  `approveInteraction` envelope). Still carved out: `send_transaction`
	 *  (its confirm path skips discovery today — reusing a
	 *  discovery-inclusive estimate would change behavior), embedded-fee,
	 *  `default_entrypoint`/NO_FROM, and `fjwc`. */
	private estimateReuse: TransferEstimateReuse = null!
	private operationEstimateReuse: OperationEstimateReuse = null!
	private estimateCancel: EstimateCancelRegistry = null!
	private previewSnapshots: PreviewSnapshots = null!
	/** Resolved lazily: the dApp-interaction service registers after this one
	 *  and depends on it, so the lookup happens at first use, not at init. */
	private services: ServiceCollection = null!
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
		this.services = services
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
		this.planner = new OperationPlanner(this.profileService, this.tokenService)
		this.resolver = new ContractResolver(this.logger)
		this.authwit = new AuthwitDiscoverer(this.logger)
		this.coordinator = new ExecutionCoordinator(this.taskService, this.logger, this.proofGate, {
			updateProvingBackend: (journalId, backend) => this.operationJournal.updateProvingBackend(journalId, backend),
		})
		this.pxeService.onProvePhase.add((event) => void this.coordinator.onProvePhase(event))
		this.wireGasBalancesAndEstimateCaches()
		this.wireExecutors()
		// The deps literal stays HERE (Q-04 pilot): every eager `this.*` read and
		// the lazy coordinator closure keep their capture point at the root.
		const feeDeps: FeeStrategyDeps = {
			txBuilder: this.txBuilder,
			simulateTxTask: (pxe, req, opts, parentTask) => this.coordinator.simulateTxTask(pxe, req, opts, parentTask),
			fpcService: this.fpcService,
			tasks: this.taskService,
			logger: this.logger,
		}
		this.feeStrategies = buildFeeStrategies(feeDeps)
		this.wireCacheInvalidation()
		// Every session open and close fires this inside the session transition, so the sweep is
		// started here and never awaited; it logs its own failures.
		this.profileService.onActiveProfileChanged.add(() => void this.lane.abandonDeadSessions())
		this.profileService.setExpiryDeferral((profileId) => this.hasApprovedSendsInFlight(profileId))
	}

	/** Reads the journal in-process: its gated RPC read asks for the active profile, which waits on
	 *  the facade lock the expiry decision's caller may already hold. */
	private async hasApprovedSendsInFlight(profileId: string): Promise<boolean> {
		const operations = await this.operationJournal.getOperations({ profileId })
		return operations.some(isApprovedSendInFlight)
	}

	/** Wiring only — every lambda reads `this.*` lazily at call time, so
	 *  construction order relative to init's tail is not observable. */
	private wireGasBalancesAndEstimateCaches(): void {
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
			getNetwork: (networkId) => this.networkService.getNetwork(networkId),
			getNode: (chainId) => this.networkService.getNode(chainId),
			getPendingForAccount: (account) => this.transactionService.getPendingForAccount(account),
			logDebug: (msg) => this.logDebug(msg),
		})
		this.operationEstimateReuse = new OperationEstimateReuse({
			getNetwork: (networkId) => this.networkService.getNetwork(networkId),
			getNode: (chainId) => this.networkService.getNode(chainId),
			getLiveChainIdentity: async (network) => {
				const node = await this.networkService.getNode(network.chainId)
				const info = await node.getNodeInfo()
				assertLiveChainIdentity(network, info)
				return { l1ChainId: info.l1ChainId, rollupVersion: info.rollupVersion }
			},
			getFpcInfo: (fpcId) => this.fpcService.getFpc(fpcId),
			getPendingForAccount: (account) => this.transactionService.getPendingForAccount(account),
			logDebug: (msg) => this.logDebug(msg),
		})
		this.previewSnapshots = new PreviewSnapshots()
		this.estimateCancel = new EstimateCancelRegistry({
			// Ids are UUID-unique across the caches — evict from each.
			evictStash: (estimateId) => {
				this.estimateReuse.evict(estimateId)
				this.operationEstimateReuse.evict(estimateId)
				this.previewSnapshots.evict(estimateId)
			},
			logDebug: (msg) => this.logDebug(msg),
		})
	}

	private wireExecutors(): void {
		this.wireLaneAndTransferExecutor()
		this.wireDappSendAndViewExecutors()
	}

	private wireLaneAndTransferExecutor(): void {
		this.lane = new ExecutionLane({
			operationJournal: this.operationJournal,
			getActiveProfile: () => this.profileService.getActiveProfile(),
			captureProfileEpoch: (profileId) => this.profileService.getDeletionState().capture(profileId),
			assertFence: (fence) => this.profileService.assertFence(fence),
			peekLiveSerial: () => this.profileService.peekLiveSerial(),
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
				registerInFlight: (journalId, serial, controller) => this.lane.registerInFlight(journalId, serial, controller),
				deleteController: (journalId) => this.lane.deleteController(journalId),
			},
			getActiveProfile: () => this.profileService.getActiveProfile(),
			captureExecutionFence: () => this.captureFence(),
			assertFence: (fence) => this.profileService.assertFence(fence),
			isFenceLive: (fence) => this.profileService.isFenceLive(fence),
			getNetwork: (networkId) => this.networkService.getNetwork(networkId),
			getNode: (chainId) => this.networkService.getNode(chainId),
			getPXE: (network) => this.pxeService.getPXE(networkInfoFrom(network)),
			getAccountContract: (profileId, chainId, address) => this.accountService.getAccountContract(profileId, chainId, address),
			getPendingForAccount: (account) => this.transactionService.getPendingForAccount(account),
			addTransaction: (...args) => this.transactionService.addTransaction(...args),
			buildAndEstimate: (op, feeSettings, fence, parentTask, signal) =>
				this.buildAndEstimateTxRequest(op, feeSettings, fence, parentTask, signal),
			createJournalOperation: (input) => this.operationJournal.createOperation(input),
			transitionJournal: (journalId, progress, error) => this.operationJournal.transitionOperation(journalId, progress, error),
			logDebug: (msg, ...rest) => this.logDebug(msg, ...rest),
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
	}

	private wireDappSendAndViewExecutors(): void {
		const estimateWithDiscovery = new DiscoveryAwareEstimator({
			authwit: this.authwit,
			buildAndEstimateValidated: (op, feeSettings, fence, parentTask, signal) =>
				this.buildAndEstimateTxRequest(op, feeSettings, fence, parentTask, signal),
			buildAndEstimateFolded: (op, feeSettings, fence, probe, parentTask, signal) =>
				this.buildAndEstimateTxRequest(op, feeSettings, fence, parentTask, signal, probe),
			buildForDiscovery: async (op, method, fence) => {
				const { txRequest, node, pxe, account, network } = await this.txBuilder.buildStandard(
					op as SendTransactionOperation,
					fence,
					method,
				)
				return { txRequest, node, pxe, account, network }
			},
		})
		this.dappSendExecutor = new DappSendExecutor({
			planner: this.planner,
			txBuilder: this.txBuilder,
			coordinator: this.coordinator,
			estimateWithDiscovery,
			operationEstimateReuse: this.operationEstimateReuse,
			previewSnapshots: this.previewSnapshots,
			getActiveProfile: () => this.profileService.getActiveProfile(),
			captureExecutionFence: () => this.captureFence(),
			assertFence: (fence) => this.profileService.assertFence(fence),
			isFenceLive: (fence) => this.profileService.isFenceLive(fence),
			getNetwork: (networkId) => this.networkService.getNetwork(networkId),
			getNode: (chainId) => this.networkService.getNode(chainId),
			getPXE: (network) => this.pxeService.getPXE(networkInfoFrom(network)),
			getAccountContract: (profileId, chainId, address) => this.accountService.getAccountContract(profileId, chainId, address),
			getPendingForAccount: (account) => this.transactionService.getPendingForAccount(account),
			getFpcInfo: (fpcId) => this.fpcService.getFpc(fpcId),
			lane: {
				deleteController: (journalId) => this.lane.deleteController(journalId),
				acquireSlot: (networkId, queuedJournalId, fence, onEnqueued, originKey) =>
					this.lane.acquireSlot(networkId, queuedJournalId, fence, onEnqueued, originKey),
				claimOrCreateJournal: (networkId, accountAddress, origin, calls, hooks, reuseController, fence) =>
					this.lane.claimOrCreateJournal(networkId, accountAddress, origin, calls, hooks, reuseController, fence),
				beginJournal: (networkId, accountAddress, origin, calls, fence) =>
					this.lane.beginJournal(networkId, accountAddress, origin, calls, fence),
				markJournal: (journalId, progress, error) => this.lane.markJournal(journalId, progress, error),
			},
			buildAndEstimateValidated: (op, feeSettings, fence, parentTask, signal) =>
				this.buildAndEstimateTxRequest(op, feeSettings, fence, parentTask, signal),
			addTransaction: (...args) => this.transactionService.addTransaction(...args),
			recordPendingAuthwits: (...args) => this.authRegistryService.recordPendingAuthwits(...args),
			logDebug: (msg, ...rest) => this.logDebug(msg, ...rest),
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
	}

	private wireCacheInvalidation(): void {
		// Invalidate gas balance cache when a transaction settles
		this.transactionService.onTransactionUpdated.add((tx) => {
			if (tx.status !== TxStatus.Pending) {
				this.gasBalances.invalidateAccount(tx.account)
			}
		})

		// The cache key is profile-FREE while the private leg reads through the
		// profile-FILTERED getFpcs — without this, switching profiles can serve
		// profile A's cached PrivateFPC balance to profile B for up to the TTL.
		// EVICT (not stale-mark): a stale-marked last-known would still be
		// peekable, painting the old profile's figures dimmed under the new one.
		this.profileService.onActiveProfileChanged.add(() => this.gasBalances.evictAll())

		// PrivateFPC address is read on every getGasBalances() call to fetch
		// `balance_of`. The cache is keyed only by `${networkId}:${account}`,
		// so swapping the PrivateFPC address would otherwise serve stale
		// private-FJ readouts for up to GAS_BALANCE_TTL_MS. Invalidate on any
		// PrivateFpc mutation (stale-marked, peek keeps serving last-known).
		// Coarse but correct.
		const invalidateOnPrivateFpc = (fpc: { type: FpcType }) => {
			if (fpc.type === FpcType.PrivateFpc) this.gasBalances.invalidateAll()
		}
		this.fpcService.onFpcUpdated.add(invalidateOnPrivateFpc)
		this.fpcService.onFpcDeleted.add(invalidateOnPrivateFpc)
	}

	/** Capture the {profileId, epoch, session} fence at execution AUTHORIZATION (before the
	 *  slow prove) so `addTransaction` can reject a completing prove whose profile
	 *  was deleted meanwhile. Delegates to ProfileService so the active-read +
	 *  reserved-check + epoch-capture are ATOMIC under the facade lock — composing
	 *  requireActiveProfile + capture here would leave a TOCTOU. */
	private async captureFence(): Promise<ExecutionFence> {
		return this.profileService.captureExecutionFence()
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
		estimateToken?: string,
	): Promise<TransferFeeEstimate> {
		await this.ensureInitialized()
		amount = coerceAmount(amount)
		return this.withEstimateAdmission(estimateToken, "send", (signal) =>
			this.transferExecutor.estimateFee(
				{
					networkId,
					accountAddress,
					tokenId,
					transferType,
					recipientAddress,
					amount,
					feeSettings,
				},
				signal,
			),
		)
	}

	/** Admission + cancellation envelope for the estimate entry points.
	 *  Tokenless calls (legacy/internal) run un-tracked; tokened calls are
	 *  admitted through the registry's per-profile cap, get an AbortSignal
	 *  for stage-boundary checks, and ALWAYS settle — the settle carries the
	 *  stashed estimateId so a post-completion `cancelEstimate` can still
	 *  evict the cached signed request. The internal sentinel converts to the
	 *  structured `JobCancelledError` at this RPC boundary. */
	private async withEstimateAdmission<T extends { estimateId?: string; previewId?: string }>(
		estimateToken: string | undefined,
		flowKey: string,
		run: (signal?: AbortSignal) => Promise<T>,
	): Promise<T> {
		if (!estimateToken) return run()
		const profile = await requireActiveProfile(this.profileService, "Wallet locked")
		let admitted = false
		let estimateId: string | undefined
		try {
			// Inside the try: a parked admission rejected by supersede/cancel
			// throws the internal sentinel too, and it must cross the RPC
			// boundary as the structured error like every other cancel.
			const signal = await this.estimateCancel.admit(estimateToken, profile.id, flowKey)
			admitted = true
			const result = await run(signal)
			// One id evicts every cache: a standard estimate's preview id IS its
			// estimate id, and a preview-only result has nothing else stashed.
			estimateId = result.previewId ?? result.estimateId
			return result
		} catch (error) {
			if (error instanceof JobCancelledSentinel) {
				throw new JobCancelledError(undefined, { jobId: estimateToken })
			}
			throw error
		} finally {
			if (admitted) this.estimateCancel.settle(estimateToken, estimateId)
		}
	}

	/** Cancel an in-flight or just-completed estimate. Best-effort: locked
	 *  wallet or unknown/foreign tokens no-op silently. */
	public async cancelEstimate(estimateToken: string): Promise<void> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) return
		this.estimateCancel.cancel(estimateToken, profile.id)
	}

	public async getLastProveOutcome(): Promise<LastProveOutcome> {
		await this.ensureInitialized()
		return this.coordinator.getLastProveOutcome()
	}

	/** Cancel an in-flight job. Semantics live on {@link ExecutionLane.cancelJob}
	 *  (journal-transition-first, abort-second; idempotent). */
	public async cancelJob(jobId: string): Promise<void> {
		await this.ensureInitialized()
		return this.lane.cancelJob(jobId)
	}

	/** Start pre-claim liveness vouching for a queued journal record — see
	 *  {@link ExecutionLane.beginQueuedWait}. Called by the wallet-sdk handler
	 *  at queued-record creation; SW-internal, never RPC-exposed. */
	public beginQueuedWait(journalId: string): void {
		this.lane.beginQueuedWait(journalId)
	}

	/** Stop pre-claim vouching (handler settled). Idempotent backstop — the
	 *  normal removal is the ownership migration at mutex enqueue. */
	public endQueuedWait(journalId: string): void {
		this.lane.endQueuedWait(journalId)
	}

	public async estimateOperationFee(
		interactionId: string,
		index: number,
		feeSettings: FeeSettings,
		estimateToken?: string,
		flowKey?: string,
	): Promise<TransferFeeEstimate> {
		await this.ensureInitialized()
		const operation = await this.interactionOperations().materializeStoredOperation(interactionId, index, feeSettings)
		return this.withEstimateAdmission(estimateToken, flowKey ?? "op", (signal) =>
			this.dappSendExecutor.estimateOperationFee(operation, feeSettings, signal, { interactionId, index }),
		)
	}

	public async previewOperationAuthwits(
		interactionId: string,
		index: number,
		estimateToken?: string,
		flowKey?: string,
	): Promise<OperationAuthwitPreview> {
		await this.ensureInitialized()
		const operation = await this.interactionOperations().materializeStoredOperation(interactionId, index)
		return this.withEstimateAdmission(estimateToken, flowKey ?? "op", (signal) =>
			this.dappSendExecutor.previewOperationAuthwits(operation, { interactionId, index }, signal),
		)
	}

	private interactionOperations(): InteractionOperationSource {
		return this.services.get<InteractionOperationSource & { name: string; start(): Promise<void> }>(DAPP_INTERACTION_SERVICE_NAME)
	}

	public async decodeCallsForDisplay(networkId: string, calls: DisplayCallInput[]): Promise<DecodedCall[]> {
		await this.ensureInitialized()
		if (!Array.isArray(calls) || calls.length > MAX_DISPLAY_CALLS) throw new Error("Invalid calls")
		const profile = await this.profileService.getActiveProfile()
		const network = await this.networkService.getNetwork(networkId)
		if (!profile || network.profileId !== profile.id) throw new Error("unauthorized profile")
		const info = networkInfoFrom(network)
		// One artifact fetch per contract for the whole batch: a multicall usually targets one contract.
		const artifacts = new Map<string, Promise<ContractArtifact | undefined>>()
		const lookup: ArtifactLookup = (address) => {
			const pending = artifacts.get(address)
			if (pending) return pending
			const fresh = (async () => {
				const instance = await this.pxeService.getContractInstance(info, AztecAddress.fromStringUnsafe(address))
				if (!instance) return undefined
				return (await this.pxeService.getContractArtifact(info, instance.currentContractClassId)) ?? undefined
			})()
			artifacts.set(address, fresh)
			return fresh
		}
		return Promise.all(calls.map((call) => decodeCallForDisplay(lookup, call)))
	}

	public async executeOperations(
		operations: Operation[],
		origin: LocalTxOrigin,
		parentTask?: WrappedTask,
		hooks?: ExecutionHooks,
		/** Popup approval envelopes, index-aligned with `operations`: the
		 *  interaction each operation was materialized from plus the SW-minted
		 *  estimate/preview ids the popup handed back. Never part of the shared
		 *  `Operation` wire shape — a dApp cannot reach this parameter. */
		approvals?: readonly (OperationApprovalEnvelope | undefined)[],
		/** TRUSTED-INTERNAL parameter (like `estimateIds`): the fence captured
		 *  at the dApp interaction's session re-validation — the authorization
		 *  moment. Every send and token commit runs under it, so a lock, a
		 *  switch, a re-unlock or a delete + same-id re-import parked anywhere
		 *  between approval and commit fails closed. Required for a DAPP-origin
		 *  send or token commit: without it the dispatch would capture whatever
		 *  session is live when the op finally runs. NOT structurally unreachable over the wire (RPC
		 *  dispatch forwards extra positional params) — the boundary is
		 *  same-extension sender authentication, so only popup/SW code can
		 *  supply it; dApps route through the wallet-bridge dispatcher, which
		 *  never forwards it. */
		authorizedFence?: ExecutionFence,
	): Promise<OperationResult[]> {
		await this.ensureInitialized()
		if (origin.type === OriginType.DAPP && !authorizedFence && operations.some((op) => FENCED_OPERATION_KINDS.has(op.kind))) {
			throw new Error("a dApp send requires the fence of the session that authorized it")
		}
		const results: OperationResult[] = []
		let operationIndex = -1
		for (const operation of operations) {
			operationIndex++
			if (results.length && results.at(-1)!.status !== "ok") {
				results.push({ status: "skipped" })
				continue
			}

			const traceId = crypto.randomUUID().slice(0, 8)
			this.logDebug(`[${traceId}] executeOperations: starting ${operation.kind}`)

			const content = new ExecuteOperationContent(operation.kind, this.planner.extractPrimaryMethod(operation))
			const operationTask = parentTask ? parentTask.startSubtask(content) : this.taskService.startNewTask(content, undefined, origin)

			try {
				const result = await this.dispatchOperation(
					operation,
					origin,
					operationTask,
					hooks,
					authorizedFence,
					approvals?.[operationIndex],
				)
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

	/** Per-operation dispatch — one contiguous awaited region (every arm was
	 *  already awaited at this position in the pre-split loop). Without an
	 *  `authorizedFence` (UI origin) the send arms capture INSIDE the arm, not
	 *  at the batch top: read-only ops must not trip the unlock check, and the
	 *  capture still precedes the prove. */
	private async dispatchOperation(
		operation: Operation,
		origin: LocalTxOrigin,
		operationTask: WrappedTask,
		hooks: ExecutionHooks | undefined,
		authorizedFence: ExecutionFence | undefined,
		approval: OperationApprovalEnvelope | undefined,
	): Promise<unknown> {
		switch (operation.kind) {
			case "register_contract": {
				return this.executeRegisterContract(operation)
			}
			case "register_sender": {
				return this.executeRegisterSender(operation)
			}
			case "register_token": {
				return this.executeRegisterToken(operation, origin, operationTask, authorizedFence)
			}
			case "send_transaction": {
				// B-02: forward hooks so the slot buckets per-origin (grantPublicAuthwit
				// carries { originKey }); without it hostile-dApp grants + UI auth ops
				// collapse into one __no_origin__ capacity bucket, losing fairness.
				const fence = authorizedFence ?? (await this.captureFence())
				return this.executeSendTransaction(operation, origin, operationTask, hooks, fence)
			}
			case "simulate_transaction": {
				return this.viewExecutor.executeSimulateTransaction(operation)
			}
			case "simulate_utility": {
				return this.viewExecutor.executeSimulateUtility(operation)
			}
			// Aztec.js interface:
			case "aztec_getContractClassMetadata": {
				return this.viewExecutor.executeAztecGetContractClassMetadata(operation)
			}
			case "aztec_getContractMetadata": {
				return this.viewExecutor.executeAztecGetContractMetadata(operation)
			}
			case "aztec_getPrivateEvents": {
				return this.viewExecutor.executeAztecGetPrivateEvents(operation)
			}
			case "aztec_getChainInfo": {
				return this.viewExecutor.executeAztecGetChainInfo(operation)
			}
			case "aztec_registerSender": {
				return this.executeAztecRegisterSender(operation)
			}
			case "aztec_getAddressBook": {
				return this.viewExecutor.executeAztecGetAddressBook(operation)
			}
			case "aztec_registerContract": {
				return this.executeAztecRegisterContract(operation)
			}
			case "aztec_simulateTx": {
				return this.viewExecutor.executeAztecSimulateTx(operation)
			}
			case "aztec_executeUtility": {
				return this.viewExecutor.executeAztecExecuteUtility(operation)
			}
			case "aztec_profileTx": {
				return this.viewExecutor.executeAztecProfileTx(operation)
			}
			case "aztec_sendTx": {
				// Hooks forwarded ONLY to aztec_sendTx; other ops don't need them.
				const fence = authorizedFence ?? (await this.captureFence())
				return this.dappSendExecutor.executeAztecSendTx(operation, origin, operationTask, hooks, fence, approval)
			}
			case "aztec_createAuthWit": {
				return this.executeAztecCreateAuthWit(operation)
			}
			default: {
				throw new Error("Invalid operation")
			}
		}
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
			throw new ContractNotRegisteredError("Contract instance not found")
		}

		const providedArtifact = await ContractArtifactSchema.optional().parseAsync(op.artifact)
		const artifact =
			providedArtifact ?? (await this.pxeService.getContractArtifact(networkInfoFrom(network), instance.currentContractClassId))
		if (!artifact) {
			throw new ContractNotRegisteredError("Contract artifact not found")
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
		op: RegisterTokenOperation,
		origin: LocalTxOrigin,
		parentTask?: WrappedTask,
		authorizedFence?: ExecutionFence,
	): Promise<void> {
		// The deletion fence anchors the whole approval→commit chain: the dApp
		// path threads the capture made AT the interaction's session
		// re-validation (upstream of the refreshSession park); popup-origin
		// dispatches capture here, where dispatch IS the authorization. A
		// deletion (or a delete + same-id re-import) landing anywhere after the
		// capture moves the epoch, so the commit's assert against it fails
		// closed. Token ops are not switch-blocked (not a SENDING kind), so
		// every identity below must derive from this one capture plus the
		// ownership-checked network row — never a live re-read. The capture's
		// only throw is the locked gate; re-thrown under the pinned message.
		let fence: ExecutionFence
		if (authorizedFence) {
			fence = authorizedFence
		} else {
			try {
				fence = await this.profileService.captureExecutionFence()
			} catch {
				throw new Error("Wallet locked")
			}
		}
		const network = await this.networkService.getNetwork(op.networkId)
		// `getNetwork` anchors the row to the ACTIVE profile; tying it to the
		// fence makes the write identity and the commit assert one chain.
		if (network.profileId !== fence.profileId) throw new Error("unauthorized profile")

		// Always parsed here: a popup-supplied interface would carry function
		// mappings nothing authenticated, and they are what gets persisted.
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
		await this.tokenService.addTokenAuthorized(fence, fence.profileId, op.networkId, op.accountAddress, ti, opContext)
	}

	/** `fence` absent ⇒ captured now, which is right only for a caller that
	 *  awaited nothing between the user's action and this call. */
	public async executeSendTransaction(
		op: SendTransactionOperation,
		origin: LocalTxOrigin,
		parentTask?: WrappedTask,
		hooks?: ExecutionHooks,
		fence?: ExecutionFence,
	): Promise<string> {
		await this.ensureInitialized()
		const authorized = fence ?? (await this.captureFence())
		return this.dappSendExecutor.executeSendTransaction(op, origin, parentTask, authorized, hooks)
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

	public async peekGasBalances(networkId: string, accountAddress: string): Promise<{ balances: GasBalances; stale: boolean } | null> {
		await this.ensureInitialized()
		return this.gasBalances.peek(networkId, accountAddress)
	}

	// Aztec.js interface:

	private async executeAztecRegisterSender(op: AztecRegisterSenderOperation): Promise<AztecAddress> {
		const network = await this.networkService.getNetwork(op.networkId)
		return this.pxeService.registerSender(networkInfoFrom(network), op.address)
	}

	// Resolves to void: the 5.0.1 wallet-sdk WalletSchema declares
	// `registerContract(): Promise<void>`, and the dApp-side proxy validates the
	// response with z.void() — any non-undefined result rejects the whole call
	// on the dApp even though registration succeeded wallet-side.
	private async executeAztecRegisterContract(op: AztecRegisterContractOperation): Promise<void> {
		const instance = await ContractInstanceWithAddressSchema.parseAsync(op.instance)
		const network = await this.networkService.getNetwork(op.networkId)

		const addressNum = instance.address.toBigInt()
		if (addressNum >= 0 && addressNum <= 6) {
			return
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
			throw new ContractNotRegisteredError(
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
			// Bind the dApp-supplied name to the selector's real ABI function before
			// signing an authwit over it. No artifact was resolved here pre-fix, so a dApp
			// could obtain an authwit for a selector that did not match the claimed name.
			// Fail closed if the contract/artifact is unregistered — the dApp registers it
			// first. Build the call from ABI truth; never trust dApp name/type/isStatic.
			const authwitInstance = await this.pxeService.getContractInstance(networkInfoFrom(network), call.to)
			if (!authwitInstance) {
				throw new ContractNotRegisteredError("Contract not found")
			}
			const authwitArtifact = await this.pxeService.getContractArtifact(
				networkInfoFrom(network),
				authwitInstance.currentContractClassId,
			)
			if (!authwitArtifact) {
				throw new ContractNotRegisteredError("Contract artifact not found")
			}
			const authwitFn = await findFunctionBySelector(authwitArtifact, call.selector.toString())
			if (!authwitFn) {
				throw new Error("Method not found")
			}
			if (call.name !== undefined && call.name !== authwitFn.name) {
				throw new Error(
					`Scope violation: authwit call name "${call.name}" does not match selector's function "${authwitFn.name}" on ${call.to}`,
				)
			}
			const intentAction: CallIntent = {
				caller: await AztecAddress.schema.parseAsync(caller),
				call: new FunctionCall(
					authwitFn.name,
					await AztecAddress.schema.parseAsync(call.to),
					await FunctionSelector.schema.parseAsync(call.selector),
					authwitFn.functionType,
					call.hideMsgSender,
					authwitFn.isStatic,
					await z.array(Fr.schema).parseAsync(call.args),
					authwitFn.returnTypes,
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
		fence: ExecutionFence,
		parentTask?: WrappedTask,
		signal?: AbortSignal,
		probe?: DiscoveryProbe,
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
			fence,
			feeSettings,
			feeMultiplier,
			gasPadding,
			parentTask,
			signal,
			probe,
		}
		return strategy.buildAndEstimate(ctx)
	}
}
