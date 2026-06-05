import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service } from "@nulo/extension-messaging/background"
import type { ILogger } from "@/wallet/logger"
import { ProfileService } from "@/wallet/services/profile/service"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { DappSessionService, AccessLevel, type DappSession } from "@/wallet/services/dapp-session/service"
import { ExecutionService, type Operation, type OperationKind } from "@/wallet/services/execution/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { JobCancelledError } from "@nulo/extension-messaging/errors"
import { OriginType, type LocalTxOrigin } from "@/wallet/services/transaction/service"
import { getRandomHex, Lock } from "@/wallet/utils"
import type { WindowManager } from "@/wallet/services/window-manager/window-manager"
import { parseCaipAccount, parseCaipChain, resolveNetworkByChainId } from "@/wallet/utils/caip"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { assertSilentExecutable, materializeRequest, type MaterializeDeps } from "./materialize"
import {
	DAPP_INTERACTION_SERVICE_NAME,
	type ExecutionPayload,
	type ExecutionResult,
	type CapabilityPayload,
	type CapabilityParams,
	type CapabilityResult,
	type DiscoveryPayload,
	type DiscoveryParams,
	type DiscoveryResult,
	type ExecutionHooks,
	type ExecutionParams,
	type CaipChain,
	type CaipAccount,
	type OperationRequest,
	type Methods,
	type Events,
	type DappInteraction,
} from "./spec"

export * from "./spec"

/**
 * Hard timeout for an approval popup. Bounds the worst case when neither the
 * user interacts nor `chrome.windows.onRemoved` fires (eg. extension reload,
 * popup crash, MV3 suspension races). Longer than the longest realistic
 * prove+approve flow so legitimate users aren't surprised.
 */
const INTERACTION_TIMEOUT_MS = 10 * 60 * 1000

export class DappInteractionService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	public static name = DAPP_INTERACTION_SERVICE_NAME

	public readonly onInteractionCancelled = new EventHandler<string>()

	private readonly storage: Map<string, DappInteraction> = new Map()
	private readonly lock = new Lock()

	private profileService: ProfileService = null!
	private networkService: NetworkService = null!
	private accountService: AccountService = null!
	private dappSessionService: DappSessionService = null!
	private executionService: ExecutionService = null!
	private operationJournal: OperationJournalService = null!

	public constructor(
		logger: ILogger,
		private readonly windowManager: WindowManager,
	) {
		super(DAPP_INTERACTION_SERVICE_NAME, logger)
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		this.networkService = services.get(NetworkService.name)
		this.accountService = services.get(AccountService.name)
		this.dappSessionService = services.get(DappSessionService.name)
		this.executionService = services.get(ExecutionService.name)
		this.operationJournal = services.get(OperationJournalService.name)
	}

	public async getInteractionPayload(id: string): Promise<ExecutionPayload | CapabilityPayload | DiscoveryPayload> {
		const interactionRequest = this.storage.get(id)
		if (!interactionRequest) {
			throw new Error("Invalid id")
		}
		return interactionRequest.payload
	}

	public async approveInteraction(id: string, operations: Operation[], origin: LocalTxOrigin): Promise<void> {
		const interaction = this.storage.get(id)
		if (!interaction) {
			throw new Error("Invalid id")
		}
		this.storage.delete(id)
		// Detach before handing off to executeAndResolve: the approval popup
		// closes immediately after the user approves, and the onRemoved event
		// would race with the async execution that follows. Detach stops the
		// listener; executeAndResolve settles the promise when it completes.
		this.windowManager.detach(interaction.handleId)
		// The session FIFO baton is released downstream (ExecutionService, once
		// the request enqueues on the execution mutex) via the hooks carried on
		// `interaction`, NOT here — releasing at approval would let a later
		// request overtake this one in the execution FIFO.
		this.executeAndResolve(interaction, operations, origin)
	}

	public async resolveInteraction(id: string, result: ExecutionResult | CapabilityResult | DiscoveryResult): Promise<void> {
		const interactionRequest = this.storage.get(id)
		if (!interactionRequest) {
			throw new Error("Invalid id")
		}
		this.storage.delete(id)
		// Detach before settling: popup may close in the same event-loop turn
		// as the resolveInteraction RPC, and the onRemoved event could race
		// with settle if it arrives first.
		this.windowManager.detach(interactionRequest.handleId)
		this.windowManager.settle(interactionRequest.handleId, result)
	}

	public async rejectInteraction(id: string, reason: string): Promise<void> {
		const interactionRequest = this.storage.get(id)
		if (!interactionRequest) {
			return
		}
		this.storage.delete(id)
		this.windowManager.cancel(interactionRequest.handleId, reason)
	}

	private async executeAndResolve(interaction: DappInteraction, operations: Operation[], origin: LocalTxOrigin): Promise<void> {
		const kinds = operations.map((o) => o.kind).join(", ")
		this.logInfo(`executeAndResolve: starting [${kinds}] for ${origin.name}`)
		try {
			// Re-validate the active profile still matches the session this popup
			// was approved under. A popup is a separate window that can outlive a
			// profile switch or a wallet lock (up to INTERACTION_TIMEOUT_MS). Without
			// this guard, approval would execute against whatever profile is active
			// NOW — the wrong PXE if the same account exists in another profile, and
			// a SPLIT execution-mutex lane (the mutex keys on the active profile, so
			// two requests from one session would serialize on different lanes if the
			// profile changed between them, breaking the in-order guarantee). Mirrors
			// the silentInteraction guard.
			const payload = interaction.payload
			if ("session" in payload) {
				const active = await this.profileService.getActiveProfile()
				if (active?.id !== payload.session.profileId) {
					throw new Error("Active profile changed since approval; aborting to avoid executing against the wrong profile")
				}
			}
			await this.profileService.refreshSession()
			// Forward hooks captured at interaction-creation time. Survives the
			// popup handoff because we stash them on the interaction record.
			const result = await this.executionService.executeOperations(operations, origin, undefined, interaction.hooks)
			this.logInfo(`executeAndResolve: resolved [${kinds}]`)
			this.windowManager.settle(interaction.handleId, result)
		} catch (error) {
			this.logError(`executeAndResolve: failed [${kinds}]`, getErrorMessage(error))
			this.windowManager.cancel(interaction.handleId, error instanceof Error ? error.message : "Execution failed")
		}
	}

	public cancelInteraction(cancellationToken: string) {
		const interaction = [...this.storage.values()].find((x) => x.cancellationToken === cancellationToken)
		if (interaction) {
			this.emit("onInteractionCancelled", interaction.id)
		}
	}

	public async execute(params: ExecutionParams, cancellationToken?: string, hooks?: ExecutionHooks): Promise<ExecutionResult> {
		await this.ensureInitialized()
		const session = await this.validateSession(params)
		const payload: ExecutionPayload = { params, session }

		// Cancel-before-claim short-circuit (codex F2 / post-impl review):
		// If the user cancelled this sendTx while it was queued, the journal
		// record is now at stage `cancelled`. Throw the cancelled-pipeline
		// error directly so the popup never opens — without this, the user
		// would see an approval popup for a request they already cancelled.
		// Reads the journal AS THE SOURCE OF TRUTH; the journal mutex on
		// `transitionOperation` ensures we see a consistent stage.
		if (hooks?.queuedJournalId) {
			const queuedRec = await this.operationJournal.getOperation(hooks.queuedJournalId).catch(() => null)
			if (queuedRec && queuedRec.progress?.stage !== "queued") {
				this.logInfo(
					`execute: queued record ${hooks.queuedJournalId} is ${queuedRec.progress?.stage}; short-circuiting before popup`,
				)
				throw new JobCancelledError("Request was cancelled before approval")
			}
		}

		if (!(await this.isConfirmationNeeded(payload))) {
			return await this.silentInteraction(payload, hooks)
		}
		return (await this.interaction("execute", payload, cancellationToken, hooks)) as ExecutionResult
	}

	public async requestCapabilities(params: CapabilityParams, cancellationToken?: string): Promise<CapabilityResult> {
		await this.ensureInitialized()
		const session = await this.dappSessionService.getDappSession(params.sessionId)
		const payload: CapabilityPayload = { params, session }
		return (await this.interaction("capabilities", payload, cancellationToken)) as CapabilityResult
	}

	public async discover(params: DiscoveryParams, cancellationToken?: string): Promise<DiscoveryResult> {
		const payload: DiscoveryPayload = { params }
		return (await this.interaction("discover", payload, cancellationToken)) as DiscoveryResult
	}

	private async interaction(
		type: string,
		payload: ExecutionPayload | CapabilityPayload | DiscoveryPayload,
		cancellationToken?: string,
		hooks?: ExecutionHooks,
	): Promise<ExecutionResult | CapabilityResult | DiscoveryResult> {
		let interaction: DappInteraction

		try {
			await this.lock.enter()

			let id: string
			do {
				// 16 bytes / 128 bits (codex-round-1 defense-in-depth).
				id = getRandomHex(16)
			} while (this.storage.has(id))

			const handle = this.windowManager.openAndAwait<ExecutionResult | CapabilityResult | DiscoveryResult>({
				url: chrome.runtime.getURL(`src/popup/index.html#/windows/${type}?requestId=${id}`),
				width: 400,
				height: 800,
				timeoutMs: INTERACTION_TIMEOUT_MS,
				kind: type,
			})

			interaction = {
				id,
				payload,
				handleId: handle.handleId,
				cancellationToken: cancellationToken ?? id,
				// Hooks persist on the interaction so they survive across the
				// popup handoff (interaction() returns → user approves → popup
				// calls approveInteraction → executeAndResolve picks hooks up).
				hooks,
			}

			this.storage.set(id, interaction)

			return handle.promise.finally(() => {
				this.storage.delete(id)
			})
		} finally {
			this.lock.leave()
		}
	}

	private async silentInteraction(payload: ExecutionPayload, hooks?: ExecutionHooks): Promise<ExecutionResult> {
		const profile = await this.profileService.getActiveProfile()
		if (profile?.id !== payload.session.profileId) {
			throw new Error("Wallet locked")
		}
		// Phase 2 follow-up: request→operation logic lives in the shared
		// materializer. Pre-followup this path and the popup Execute window
		// each had their own switch; they diverged on the send-like feeSettings
		// rule, which is exactly how the goswap aztec_sendTx priorityLevel
		// crash came about. Same shared path now means same shape.
		const deps: MaterializeDeps = {
			resolveNetwork: async (caipChain: string) => {
				const { chainId } = parseCaipChain(caipChain as CaipChain)
				return resolveNetworkByChainId(this.networkService, chainId)
			},
			resolveNetworkAndAccount: async (caipAccount: string) => {
				const { chainId, address } = parseCaipAccount(caipAccount as CaipAccount)
				const network = await resolveNetworkByChainId(this.networkService, chainId)
				const account = await this.accountService.getAccount(profile!.id, network.chainId, address)
				if (!account) {
					throw new Error("Account no longer exists")
				}
				return [network, account]
			},
		}
		const operations: Operation[] = []
		for (const op of payload.params.operations) {
			const materialized = await materializeRequest(op, deps)
			// Silent path only sees send-like ops where the dApp self-paid
			// (isConfirmationNeeded gates the rest out). Materializer already
			// set feeSettings = embedded for those. The assertion is the
			// drift alarm: if isConfirmationNeeded ever lets a non-self-fee'd
			// send-like through, we want to know LOUDLY, not crash deep in
			// the execution pipeline.
			assertSilentExecutable(materialized)
			operations.push(materialized as unknown as Operation)
		}
		await this.profileService.refreshSession()

		// Silent path (self-paid sendTx, no popup): fast-forward the queued
		// record to `pending` so the UI shows "Preparing..." immediately
		// instead of briefly showing "Queued..." for a request that never
		// opens a popup (opus post-impl F7).
		//
		// CRITICAL ORDERING (codex closeout F1): this fast-forward MUST stay
		// immediately before `executeOperations()`. If we hoisted it to the
		// top of the method, a throw in `materializeRequest` /
		// `refreshSession` / profile-check would leave the record stranded
		// at `pending` — the `handleWalletMessage` safety net only
		// terminalizes records still at `queued` (background.ts), so the UI
		// would show "Preparing..." until the reaper's `pending` grace
		// expires (~2 min). Keeping the transition here ensures that any
		// pre-execute throw leaves the record at `queued` for the safety
		// net to catch.
		//
		// The claim helper in `claimOrCreateDappExecuteJournal` accepts BOTH
		// `queued` and `pending` as legitimate pre-claim stages — if we
		// fast-forward to pending here, the claim path skips its own
		// transition and just registers the controller. Failure here is
		// non-fatal: if a cancel races us and wins, the claim path's
		// recheck logic catches the cancelled record and throws the
		// JobCancelledSentinel correctly.
		if (hooks?.queuedJournalId) {
			try {
				await this.operationJournal.transitionOperation(hooks.queuedJournalId, { stage: "pending" })
			} catch (err) {
				this.logDebug(
					`silent-path fast-forward queued→pending failed (likely cancel race); claim helper will handle: ${getErrorMessage(err)}`,
				)
			}
		}

		// The FIFO baton is released downstream (ExecutionService, once the
		// request enqueues on the execution mutex) via the forwarded `hooks`, NOT
		// here — see acquireExecutionSlot. Releasing before executeOperations
		// would let a later request overtake this one in the execution FIFO.
		return await this.executionService.executeOperations(
			operations,
			{
				type: OriginType.DAPP,
				name: payload.session.dappMetadata.name ?? "Unknown dapp",
			},
			undefined,
			hooks,
		)
	}

	private async validateSession({ sessionId, operations }: ExecutionParams): Promise<DappSession> {
		const session = await this.dappSessionService.tryGetDappSession(sessionId)
		if (!session) {
			throw new Error("Invalid session")
		}
		// validate permissions
		for (const operation of operations) {
			switch (operation.kind) {
				case "register_contract":
				case "register_sender":
				case "aztec_getContractClassMetadata":
				case "aztec_getContractMetadata":
				case "aztec_getChainInfo":
				case "aztec_registerSender":
				case "aztec_getAddressBook":
				case "aztec_registerContract": {
					this.checkMethodPermission(session, operation.kind, operation.chain)
					break
				}
				case "aztec_getPrivateEvents": {
					this.checkMethodPermission(session, operation.kind, operation.chain)
					this.checkScopesPermissions(session, operation.eventFilter.scopes)
					break
				}
				case "register_token":
				case "simulate_utility":
				case "aztec_simulateTx":
				case "aztec_executeUtility":
				case "aztec_profileTx":
				case "aztec_sendTx":
				case "aztec_createAuthWit": {
					const chain = operation.account.substring(0, operation.account.lastIndexOf(":"))
					this.checkAccountPermission(session, operation.account)
					this.checkMethodPermission(session, operation.kind, chain)
					break
				}
				case "send_transaction":
				case "simulate_transaction": {
					const chain = operation.account.substring(0, operation.account.lastIndexOf(":"))
					this.checkAccountPermission(session, operation.account)
					this.checkMethodPermission(session, operation.kind, chain)
					operation.actions.forEach((x) => this.checkMethodPermission(session, x.kind, chain))
					break
				}
			}
		}
		return session
	}

	private checkAccountPermission(session: DappSession, account: string) {
		if (!session.accounts.includes(account)) {
			throw new Error("Unauthorized account")
		}
	}

	private checkMethodPermission(session: DappSession, method: string, chain: string) {
		// Sessions are per-`(origin, chainId)` — chain authorization lives
		// on the parent session, not in the permissions array. A mismatch
		// here means the caller routed this request to the wrong session.
		//
		// `chain` arrives as a CAIP-2 string (`aztec:<chainId>`) from
		// `OperationRequest.chain` in dapp-interaction-protocol.ts;
		// `session.chainId` stores the raw chainId-as-string (`"0"`,
		// `"31337"`). Parse the CAIP form so we compare like-with-like —
		// without this conversion the `!==` always fired and every dApp
		// `sendTx`/`simulate*`/`registerContract` would 401 even though
		// the session was for the right chain.
		const { chainId } = parseCaipChain(chain)
		if (session.chainId !== String(chainId)) {
			throw new Error("Unauthorized method/chain")
		}
		// Empty methods list (in any permissions record) means "all methods
		// allowed" — wallet-SDK sessions use this, capability enforcement
		// handles authorization separately. Non-empty methods lists (legacy
		// connect sessions) must include the method.
		const allMethodsAllowed = session.permissions.some((p) => !p.methods || p.methods.length === 0)
		if (allMethodsAllowed) return
		const methodAllowed = session.permissions.some((p) => p.methods?.includes(method))
		if (!methodAllowed) {
			throw new Error("Unauthorized method")
		}
	}

	private checkScopesPermissions(session: DappSession, scopes: AztecAddress[]) {
		for (const address of scopes.map((x) => x.toString())) {
			if (!session.accounts.some((x) => x.endsWith(address))) {
				throw new Error("Unauthorized scopes")
			}
		}
	}

	private async isConfirmationNeeded(payload: ExecutionPayload): Promise<boolean> {
		const profile = await this.profileService.getActiveProfile()
		if (profile?.id !== payload.session.profileId) {
			return true
		}
		const accessLevel = this.getAccessLevel(payload.params.operations)
		if (accessLevel >= payload.session.confirmationLevel) {
			return true
		}
		if (
			payload.params.operations.find(
				(x) =>
					(x.kind === "send_transaction" && x.fee?.embeddedFeePayment === undefined) ||
					(x.kind === "aztec_sendTx" && x.exec.feePayer === undefined),
			)
		) {
			return true
		}
		// `register_token` is always per-call confirmable — the popup carries the
		// resolved token name/symbol/decimals/contract address so the user can
		// recognise phishing attempts. Driven by an explicit kind match rather
		// than the (accessLevel, confirmationLevel) gate because the latter is
		// seeded to `Transactions` for wallet-sdk sessions and would otherwise
		// silence the popup.
		if (payload.params.operations.find((x) => x.kind === "register_token")) {
			return true
		}
		return false
	}

	private getAccessLevel(ops: OperationRequest[]): AccessLevel {
		let level = AccessLevel.None
		for (const op of ops) {
			level = Math.max(level, this.getOperationAccessLevel(op.kind))
		}
		return level
	}

	private getOperationAccessLevel(kind: OperationKind): AccessLevel {
		switch (kind) {
			case "register_token":
				return AccessLevel.AppState
			case "register_contract":
				return AccessLevel.PxeState
			case "register_sender":
				return AccessLevel.PxeState
			case "simulate_transaction":
				return AccessLevel.PrivateData
			case "simulate_utility":
				return AccessLevel.PrivateData
			case "send_transaction":
				return AccessLevel.Transactions
			case "aztec_getContractClassMetadata":
				return AccessLevel.PxeState
			case "aztec_getContractMetadata":
				return AccessLevel.PxeState
			case "aztec_getPrivateEvents":
				return AccessLevel.PrivateData
			case "aztec_getChainInfo":
				return AccessLevel.PublicData
			case "aztec_registerSender":
				return AccessLevel.PxeState
			case "aztec_getAddressBook":
				return AccessLevel.AppState
			case "aztec_registerContract":
				return AccessLevel.PxeState
			case "aztec_simulateTx":
				return AccessLevel.PrivateData
			case "aztec_executeUtility":
				return AccessLevel.PrivateData
			case "aztec_profileTx":
				return AccessLevel.PrivateData
			case "aztec_sendTx":
				return AccessLevel.Transactions
			case "aztec_createAuthWit":
				return AccessLevel.PrivateData
			default:
				return AccessLevel.None
		}
	}
}
