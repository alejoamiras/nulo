/**
 * Wallet-SDK Background Integration
 *
 * Sets up the `BackgroundConnectionHandler` from `@aztec/wallet-sdk` in the
 * extension's service worker. This replaces the old `RpcService` + content
 * script proxy system with the standardized wallet-sdk discovery / key-exchange
 * / encrypted-channel protocol.
 *
 * ## How it works
 *
 * 1. **Discovery**: A dApp broadcasts a discovery request via postMessage.
 *    The content script forwards it to the background. We receive it via
 *    `onPendingDiscovery` and either auto-approve (returning user with valid
 *    session) or show a popup for user approval via `DappInteractionService`.
 *
 * 2. **Key Exchange**: After approval, the wallet-sdk performs ECDH P-256 key
 *    exchange to establish an AES-256-GCM encrypted channel.
 *
 * 3. **Wallet Messages**: Once connected, the dApp sends method calls (e.g.
 *    `sendTx`, `simulateTx`) encrypted over the channel. We decrypt them
 *    and route to `WalletSdkDispatcher` which delegates to `ExecutionService`.
 *
 * 4. **Responses**: Results are encrypted and sent back through the channel.
 */

import { BackgroundConnectionHandler, type PendingDiscovery, type ActiveSession } from "@aztec/wallet-sdk/extension/handlers"
import type { WalletMessage, WalletResponse } from "@aztec/wallet-sdk/types"
import { validateContentScriptMessage } from "./content-script-validator"
import { toWalletResponseError } from "./error-envelope"

import type { ServiceCollection } from "@/wallet/base"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { ExecutionService } from "@/wallet/services/execution/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { DappInteractionService } from "@/wallet/services/dapp-interaction/service"
import type { DiscoveryParams } from "@/wallet/services/dapp-interaction/spec"
import { DappSessionService, AccessLevel } from "@/wallet/services/dapp-session/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { DiscoveryQueue, type SessionContext, WalletSdkDispatcher } from "@nulo/wallet-bridge"
import { jsonStringify, getErrorMessage, Lock } from "@nulo/wallet-core/utils"
import type { CaipAccount } from "@/wallet/services/dapp-interaction/spec"
import { parseCaipAccount, resolveNetworkByChainId } from "@/wallet/utils/caip"
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@/wallet/logger"
import type { Fr } from "@aztec/foundation/curves/bn254"

declare const __VERSION__: string

/**
 * Initialize the wallet-sdk BackgroundConnectionHandler and wire it
 * to the extension's service layer.
 *
 * Call this after `services.start()` in the service worker entry point.
 */
export function initWalletSdkHandler(services: ServiceCollection, logger: ILogger): BackgroundConnectionHandler {
	const networkService: NetworkService = services.get(NetworkService.name)
	const accountService: AccountService = services.get(AccountService.name)
	const executionService: ExecutionService = services.get(ExecutionService.name)
	const profileService: ProfileService = services.get(ProfileService.name)
	const dappInteractionService: DappInteractionService = services.get(DappInteractionService.name)
	const dappSessionService: DappSessionService = services.get(DappSessionService.name)
	const operationJournal: OperationJournalService = services.get(OperationJournalService.name)

	const dispatcher = new WalletSdkDispatcher(
		networkService,
		accountService,
		executionService,
		dappInteractionService,
		dappSessionService,
		logger,
	)

	/**
	 * Track new connections (user-approved via popup) keyed by
	 * `(origin, chainId)` so verification fires for the right session when
	 * the dApp holds concurrent sessions on different chains for the same
	 * origin.
	 */
	const pendingVerification = new Set<string>()

	/**
	 * Guard against concurrent discoveries for the same `(origin, chainId)`
	 * pair (prevents duplicate connect popups). Stores a promise that
	 * resolves when the connect popup completes, so duplicate discoveries
	 * wait for the session to exist before being approved. Keying on the
	 * `(origin, chainId)` tuple lets a dApp open a connect popup for chain A
	 * and chain B concurrently without one waiting on the other (and without
	 * the chain-B discovery being auto-approved against a chain-A session).
	 */
	const pendingDiscoveryPromises = new Map<string, Promise<void>>()

	/** Composite key used by both maps above. */
	const pendingKey = (origin: string, chainId: string) => `${origin}|${chainId}`

	/**
	 * Per-session message queue — ensures messages from the same dApp session
	 * are processed sequentially (FIFO). Without this, the fire-and-forget
	 * onWalletMessage callback processes messages concurrently, causing race
	 * conditions (e.g. executeUtility runs before registerContract completes).
	 */
	const sessionQueues = new Map<string, Promise<void>>()

	let discoveryQueue: DiscoveryQueue

	const handler = new BackgroundConnectionHandler(
		{
			walletId: "nulo",
			walletName: "Nulo",
			walletVersion: __VERSION__,
			walletIcon: chrome.runtime.getURL("/src/assets/logo.png"),
		},
		{
			sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
			addContentListener: (listener) => {
				// biome-ignore lint/suspicious/noExplicitAny: Chrome message listener provides untyped messages
				chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender) => {
					// Zod-validate content-script-originated envelopes before
					// forwarding to the upstream handler. `passthrough` lets
					// non-content-script messages through (ServiceClient
					// responses, offscreen pings, etc.) — the upstream handler
					// filters those by `origin`. `invalid` drops adversarial /
					// malformed envelopes early with a structured debug log.
					const verdict = validateContentScriptMessage(message)
					if (verdict.kind === "invalid") {
						logger.log("wallet-sdk-bg", LogLevel.Debug, "Dropping malformed content-script envelope", verdict.reason)
						return undefined
					}
					listener(message, sender)
					return undefined
				})
			},
		},
		{
			onPendingDiscovery: (discovery) => {
				handleDiscovery(
					discovery,
					handler,
					profileService,
					dappInteractionService,
					dappSessionService,
					pendingVerification,
					pendingDiscoveryPromises,
					discoveryQueue,
					logger,
				)
			},

			onSessionEstablished: async (session) => {
				// Sessions are per-`(origin, chainId)`. The upstream
				// `ActiveSession` carries `chainInfo` (set from the matching
				// discovery during key exchange — see the wallet-sdk
				// `BackgroundConnectionHandler` source), so derive `chainId`
				// directly from the session being established. No side-channel
				// map needed.
				const chainId = String(chainInfoToChainId(session))
				const dappSession = await dappSessionService.tryGetDappSessionByOriginAndChain(session.origin, chainId)
				if (dappSession) {
					await dappSessionService.setVerificationHash(dappSession.id, session.verificationHash)
				}

				const verifKey = pendingKey(session.origin, chainId)
				const isNewConnection = pendingVerification.has(verifKey)
				if (isNewConnection) pendingVerification.delete(verifKey)

				const needsVerification = isNewConnection || (dappSession && !dappSession.trustedVerification)

				if (needsVerification && dappSession) {
					chrome.windows.create({
						type: "popup",
						url: chrome.runtime.getURL(
							`src/popup/index.html#/windows/verify?sessionId=${dappSession.id}&isReconnect=${!isNewConnection}`,
						),
						height: 800,
						width: 400,
					})
				}
			},

			onSessionTerminated: (sessionId) => {
				sessionQueues.delete(sessionId)
				decryptQueues.delete(sessionId)
			},

			onWalletMessage: (session, message) => {
				const key = session.sessionId
				const prev = sessionQueues.get(key) ?? Promise.resolve()

				// New baton-based FIFO. The baton resolves when the handler
				// either:
				//   (a) explicitly calls `releaseFifo()` mid-execution (the
				//       sendTx path does this after tx-build), OR
				//   (b) completes (the safety-net `.finally(releaseFifo)`),
				// whichever fires first. Allows concurrent dApp sendTx to
				// proceed past the popup-wait phase while previous proving
				// continues in the background.
				let resolveBaton!: () => void
				const baton = new Promise<void>((resolve) => {
					resolveBaton = resolve
				})
				let released = false
				const releaseFifo = () => {
					if (released) return
					released = true
					resolveBaton()
				}

				// Only top-level `sendTx` messages get a pre-allocated queued
				// journal record. `batch` is excluded by design — the recursive
				// dispatch in WalletSdkDispatcher.handleBatch can't safely
				// route hooks per-leg, so we'd end up with a batch-level
				// queued record that no inner leg knows to claim.
				// TODO(queued-visibility-for-batch): batched sendTx legs
				// currently bypass the queued-record creation path. Lifting
				// this requires a per-leg queued-record model or a relaxation
				// of the batch contract; out of scope for the
				// concurrent-dApp-sendTx fix.
				const queuedJournalIdPromise: Promise<string | undefined> =
					message.type === "sendTx"
						? tryCreateQueuedJournal(
								message,
								session,
								operationJournal,
								profileService,
								dappSessionService,
								networkService,
								logger,
							)
						: Promise.resolve(undefined)

				const handlerChain = queuedJournalIdPromise.then((queuedJournalId) =>
					prev.then(() =>
						handleWalletMessage(session, message, handler, dispatcher, profileService, operationJournal, logger, {
							releaseFifo,
							queuedJournalId,
						}),
					),
				)
				// Safety-net release for handlers that don't call releaseFifo
				// explicitly (every non-sendTx path) — preserves backward-
				// compatible FIFO semantics for those. `.catch(() => {})` on
				// the ignored side prevents an unhandled-rejection warning
				// if the handler throws.
				handlerChain.finally(releaseFifo).catch(() => {})
				sessionQueues.set(
					key,
					baton.catch(() => {}),
				)
			},
		},
	)

	discoveryQueue = new DiscoveryQueue(handler, logger)

	/**
	 * Serialize decryption per-session to prevent message reordering.
	 * The wallet-sdk uses `void this.handleEncryptedMessage(...)` (fire-and-forget),
	 * so two messages can have their decryptions race.
	 * TODO: Remove this monkey-patch if wallet-sdk adds a proper serialization API.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: monkey-patching private method on BackgroundConnectionHandler to serialize decryption
	const origDecrypt = (handler as any).handleEncryptedMessage.bind(handler)
	const decryptQueues = new Map<string, Promise<void>>()
	// biome-ignore lint/suspicious/noExplicitAny: monkey-patching private method on BackgroundConnectionHandler to serialize decryption
	;(handler as any).handleEncryptedMessage = async (sessionId: string, encrypted: unknown) => {
		const prev = decryptQueues.get(sessionId) ?? Promise.resolve()
		const next = prev.then(() => origDecrypt(sessionId, encrypted))
		decryptQueues.set(
			sessionId,
			next.catch(() => {}),
		)
		return next
	}

	/** On unlock, drain any queued discovery requests */
	profileService.onActiveProfileChanged.add((profile) => {
		if (profile) {
			logger.log("wallet-sdk", LogLevel.Info, `Profile unlocked, draining discovery queue (${discoveryQueue.size} queued)`)
			discoveryQueue.drain(async (discovery) => {
				const p = await profileService.getActiveProfile()
				if (!p) {
					logger.log("wallet-sdk", LogLevel.Warn, "Wallet locked mid-drain, stopping")
					return false
				}
				logger.log(
					"wallet-sdk",
					LogLevel.Info,
					`Processing queued discovery: ${discovery.origin} (requestId: ${discovery.requestId})`,
				)
				await handleDiscovery(
					discovery,
					handler,
					profileService,
					dappInteractionService,
					dappSessionService,
					pendingVerification,
					pendingDiscoveryPromises,
					discoveryQueue,
					logger,
				)
				logger.log("wallet-sdk", LogLevel.Info, `Queued discovery processed: ${discovery.origin}`)
				return true
			})
		} else {
			logger.log("wallet-sdk", LogLevel.Info, `Profile locked (${discoveryQueue.size} in queue)`)
		}
	})

	// Terminate sessions when a tab is closed
	chrome.tabs.onRemoved.addListener((tabId) => {
		handler.terminateForTab(tabId)
	})

	// Terminate sessions when a tab navigates to a different origin.
	// SPA navigations (e.g. Next.js router.push) fire tabs.onUpdated with
	// status "loading" but stay on the same origin — these must NOT kill
	// the session. (backport of upstream #56)
	chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
		if (changeInfo.status === "loading" && changeInfo.url) {
			try {
				const newOrigin = new URL(changeInfo.url).origin
				const sessions = handler.getActiveSessions().filter((s) => s.tabId === tabId)
				for (const session of sessions) {
					if (session.origin !== newOrigin) {
						logger.log(
							"wallet-sdk",
							LogLevel.Info,
							`Tab ${tabId} navigated to ${newOrigin}, terminating session ${session.sessionId}`,
						)
						handler.terminateSession(session.sessionId)
					}
				}
			} catch {
				handler.terminateForTab(tabId)
			}
		}
	})

	handler.initialize()
	logger.log("wallet-sdk", LogLevel.Info, "BackgroundConnectionHandler initialized")

	return handler
}

/**
 * Handle a new discovery request from a dApp.
 *
 * Flow:
 * 1. Check if the wallet is unlocked (active profile exists)
 * 2. Check if a valid DappSession already exists for this origin (returning user)
 *    - If yes: auto-approve discovery without showing popup
 *    - If no: show connect popup via DappInteractionService
 * 3. On approval, the wallet-sdk proceeds with ECDH key exchange
 */
async function handleDiscovery(
	discovery: PendingDiscovery,
	handler: BackgroundConnectionHandler,
	profileService: ProfileService,
	dappInteractionService: DappInteractionService,
	dappSessionService: DappSessionService,
	pendingVerification: Set<string>,
	pendingDiscoveryPromises: Map<string, Promise<void>>,
	discoveryQueue: DiscoveryQueue,
	logger: ILogger,
): Promise<void> {
	try {
		const profile = await profileService.getActiveProfile()
		if (!profile) {
			discoveryQueue.enqueue(discovery.requestId, discovery.origin)
			return
		}

		// Resolve discovery → chainId once: needed for the auto-approve lookup,
		// the new-session creation, AND the pending-chainId stash below.
		const chainId = String(chainInfoToChainId(discovery))

		// Check for existing valid session (returning user on this chain → auto-approve).
		// Lookup is by `(origin, chainId)` so a session remembered on testnet does
		// NOT silently auto-approve on mainnet (AUDIT plan A12).
		const existingSession = await dappSessionService.tryGetDappSessionByOriginAndChain(discovery.origin, chainId)
		if (existingSession) {
			handler.approveDiscovery(discovery.requestId)
			logger.log("wallet-sdk", LogLevel.Info, `Discovery auto-approved (existing session): ${discovery.origin} chain=${chainId}`)
			return
		}

		// Deduplicate: if a connect popup is already showing for this
		// `(origin, chainId)` pair, wait for it to complete (so the
		// DappSession exists) then approve. Without the wait, key exchange
		// completes before the user approves and the dApp sends messages
		// (e.g. requestCapabilities) before the DappSession is persisted.
		// Keying on the tuple lets a dApp connect to chain A and chain B
		// concurrently without one waiting on the other, and prevents a
		// chain-B discovery from being auto-approved against the popup
		// outcome of a chain-A discovery (which is what would happen with
		// origin-only keying).
		const dedupeKey = `${discovery.origin}|${chainId}`
		const pendingPopup = pendingDiscoveryPromises.get(dedupeKey)
		if (pendingPopup) {
			await pendingPopup
			// The popup may have resolved with rejection (or with approval
			// for a different chain — impossible under tuple keying, but
			// defense in depth): re-check the session exists for THIS
			// `(origin, chainId)` before auto-approving. If the user
			// declined, reject this duplicate too instead of inheriting an
			// approval the user never gave.
			const settledSession = await dappSessionService.tryGetDappSessionByOriginAndChain(discovery.origin, chainId)
			if (settledSession) {
				handler.approveDiscovery(discovery.requestId)
				logger.log(
					"wallet-sdk",
					LogLevel.Info,
					`Discovery auto-approved (pending popup resolved): ${discovery.origin} chain=${chainId}`,
				)
			} else {
				handler.rejectDiscovery(discovery.requestId)
				logger.log(
					"wallet-sdk",
					LogLevel.Info,
					`Discovery rejected (pending popup resolved without session): ${discovery.origin} chain=${chainId}`,
				)
			}
			return
		}

		// New dApp → show discovery popup (Allow/Deny)
		const params: DiscoveryParams = {
			dappMetadata: {
				name: discovery.appName ?? discovery.appId,
				url: discovery.origin,
			},
		}

		// Store a promise that resolves when the popup completes so duplicate
		// discoveries can await it.
		let resolvePopup: () => void
		const popupPromise = new Promise<void>((r) => {
			resolvePopup = r
		})
		pendingDiscoveryPromises.set(dedupeKey, popupPromise)

		try {
			const result = await dappInteractionService.discover(params, discovery.requestId)
			if (!result.approved) {
				handler.rejectDiscovery(discovery.requestId)
				logger.log("wallet-sdk", LogLevel.Info, `Discovery denied: ${discovery.origin}`)
				return
			}

			// User approved — create a DappSession with empty accounts.
			// Accounts will be shared later via the getAccounts authorization
			// popup. Sessions are per-`(origin, chainId, profileId)`; the
			// `chainId` is required and scopes the entire session. No
			// `chains` field on `DappPermissions` — it would duplicate the
			// parent session's `chainId`.
			const newSession = await dappSessionService.addDappSession(
				params.dappMetadata,
				[{ methods: [] }],
				[], // empty accounts — populated via requestCapabilities() (or the dApp falls back when getAccounts() throws CAPABILITY_NOT_GRANTED)
				AccessLevel.Transactions,
				chainId,
			)

			// Initialize with empty capability grants so enforceCapability()
			// blocks non-exempt methods until requestCapabilities() is called.
			await dappSessionService.setCapabilityGrants(newSession.id, [])

			pendingVerification.add(dedupeKey)
			handler.approveDiscovery(discovery.requestId)
			logger.log("wallet-sdk", LogLevel.Info, `Discovery approved: ${discovery.origin} chain=${chainId}`)
		} finally {
			resolvePopup!()
			pendingDiscoveryPromises.delete(dedupeKey)
		}
	} catch (error) {
		// User rejected or popup was closed
		handler.rejectDiscovery(discovery.requestId)
		logger.log(
			"wallet-sdk",
			LogLevel.Warn,
			`Discovery rejected for ${discovery.origin}: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

/**
 * Per-message hooks passed to `handleWalletMessage` from `onWalletMessage`.
 * Concurrent-sendTx wiring (see `onWalletMessage` doc comment).
 */
type WalletMessageHooks = {
	/**
	 * Release the per-session FIFO baton. Called by handlers that have
	 * finished their FIFO-ordered work (e.g., sendTx after tx-build) but
	 * still have background work to do (e.g., proving). The next message's
	 * handler can start while this one's tail runs.
	 *
	 * The dispatcher forwards this down through DispatchHooks. Most
	 * handlers don't call it explicitly; the safety-net `.finally`
	 * in `onWalletMessage` releases the baton at handler completion.
	 */
	releaseFifo?: () => void
	/**
	 * Pre-allocated journal id from `tryCreateQueuedJournal`. The sendTx
	 * handler claims (queued → pending) instead of creating new. The
	 * `handleWalletMessage` catch block uses the journal record state
	 * (not a mutable flag) to decide whether to transition to `failed`
	 * on an unclaimed-error.
	 */
	queuedJournalId?: string
}

/**
 * Handle an incoming wallet message from a connected dApp.
 *
 * Dispatches the method call to the WalletSdkDispatcher, then encrypts
 * and sends the response back through the BackgroundConnectionHandler.
 */
async function handleWalletMessage(
	session: ActiveSession,
	message: WalletMessage,
	handler: BackgroundConnectionHandler,
	dispatcher: WalletSdkDispatcher,
	profileService: ProfileService,
	operationJournal: OperationJournalService,
	logger: ILogger,
	hooks?: WalletMessageHooks,
): Promise<void> {
	const response: WalletResponse = {
		messageId: message.messageId,
		walletId: "nulo",
	}

	try {
		const profile = await profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Wallet is locked")
		}

		const ctx: SessionContext = {
			chainId: chainInfoToChainId(session),
			profileId: profile.id,
			origin: session.origin,
			sessionId: session.sessionId,
		}

		// Hooks ride as an internal 4th arg — deliberately NOT on `ctx` so
		// `dispatch("batch", ...)`'s recursive ctx forwarding can't leak them
		// into batch legs (would let an inner sendTx release the top-level
		// baton before the batch finishes).
		const raw = await dispatcher.dispatch(message.type, message.args, ctx, hooks)
		response.result = toJsonSafe(raw)
	} catch (error) {
		// Structured EIP-1193-aligned envelope for recognised WalletError subclasses
		// (JobCancelledError → 4001, CapabilityNotGrantedError → 4100). Upstream
		// `@aztec/wallet-sdk` collapses `response.error` to
		// `new Error(JSON.stringify(error))` at `extension_wallet.ts:181`, so dApps
		// that want to discriminate parse the message — see the wallet-bridge
		// README for the recipe. Mapping lives in `error-envelope.ts` so it can be
		// unit-tested in isolation; everything not recognised collapses to a
		// string, preserving the original wire contract.
		response.error = toWalletResponseError(error)
		// `response.error` may be an object now — stringify for the log line so
		// logs don't read "[object Object]".
		const logMsg = typeof response.error === "string" ? response.error : jsonStringify(response.error)
		logger.log("wallet-sdk", LogLevel.Error, `Method ${message.type} failed for ${session.origin}: ${logMsg}`)

		// If a queued journal record exists and is STILL at queued stage,
		// the handler failed before claiming it. Transition to failed so
		// the UI doesn't show a permanently-stuck "Queued..." card.
		// Use the journal record as source of truth (not a mutable flag)
		// to disambiguate "handler claimed and then failed" (terminal state
		// already correct) from "handler failed before claim" (we own the
		// terminal state).
		if (hooks?.queuedJournalId) {
			try {
				const record = await operationJournal.getOperation(hooks.queuedJournalId)
				if (record?.progress?.stage === "queued") {
					await operationJournal.transitionOperation(
						hooks.queuedJournalId,
						{ stage: "failed" },
						{
							kind: "popup_bound",
							message: getErrorMessage(error),
							normalizedRaw: null,
						},
					)
				}
			} catch (transitionError) {
				logger.log(
					"wallet-sdk",
					LogLevel.Warn,
					`Failed to mark queued record ${hooks.queuedJournalId} as failed: ${getErrorMessage(transitionError)}`,
				)
			}
		}
	}

	try {
		await handler.sendResponse(session.sessionId, response)
	} catch (sendError) {
		logger.log(
			"wallet-sdk",
			LogLevel.Error,
			`Failed to send response for ${message.type}: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
		)
	}
}

/** Per-session queued-record cap. Prevents a flooding dApp from filling
 *  the activity feed with hundreds of "Queued..." cards. Beyond this cap,
 *  new sendTx still processes normally — just without queued visibility. */
const MAX_QUEUED_PER_SESSION = 8
/** Global queued-record cap across all sessions. Coarser DoS backstop. */
const MAX_QUEUED_GLOBAL = 32

/**
 * Module-level lock around the `countOperations + createOperation` section
 * of `tryCreateQueuedJournal`. Without this, two concurrent `onWalletMessage`
 * invocations both read the same count, both pass the cap check, and both
 * create records — making the per-session / global caps advisory rather
 * than protective. Codex + opus post-impl reviews flagged this as F1.
 *
 * Held briefly (~1ms — one count + one storage write per acquisition); the
 * worst case is N concurrent message arrivals serializing here. Bounds
 * journal-storage growth under burst floods.
 */
const queuedCreationLock = new Lock("wallet-sdk-bg:queued-creation")

/**
 * Create a journal record at `queued` stage so the activity feed surfaces
 * an incoming sendTx the moment it arrives — BEFORE the per-session FIFO
 * lets the handler open the approval popup.
 *
 * Returns the new record's id, or `undefined` on any failure. Best-effort
 * visibility: a failure here NEVER blocks the actual handler from running
 * (the handler falls back to creating its own in-flight record via
 * `beginDappExecuteJournal`).
 *
 * Cheap pre-auth gates: skip queued visibility when there's no active
 * profile, no dapp session, or no sendTx capability grant. Avoids
 * surfacing requests that the handler will reject anyway.
 *
 * Cap enforcement is atomic: the count-then-create section runs under
 * `queuedCreationLock` so concurrent arrivals can't all see a stale
 * "below cap" count and over-create.
 */
async function tryCreateQueuedJournal(
	message: WalletMessage,
	session: ActiveSession,
	journal: OperationJournalService,
	profile: ProfileService,
	dappSession: DappSessionService,
	networkSvc: NetworkService,
	logger: ILogger,
): Promise<string | undefined> {
	try {
		const activeProfile = await profile.getActiveProfile()
		if (!activeProfile) return undefined

		const chainId = chainInfoToChainId(session)
		const dapp = await dappSession.tryGetDappSessionByOriginAndChain(session.origin, String(chainId))
		if (!dapp?.accounts?.length) return undefined

		// sendTx requires the `transaction` capability (the capability type
		// scoped to send-like operations). Pre-auth-gate skip when missing.
		const hasSendTxGrant = (dapp.capabilityGrants ?? []).some((g) => g.capability.type === "transaction")
		if (!hasSendTxGrant) return undefined

		// DappSession.accounts is string[] of CAIP. Parse to get the bare address.
		const firstCaipAccount = dapp.accounts[0] as CaipAccount
		const { address: accountAddress } = parseCaipAccount(firstCaipAccount)

		// `networkId` for activity-feed scoping must be the INTERNAL network row id
		// (RecentActivityView.journalRecordInScope filters on `network.id`), NOT
		// `String(chainId)`. Without this resolution the queued card never renders.
		const network = await resolveNetworkByChainId(networkSvc, chainId)
		if (!network) return undefined

		// Critical section: cap check + record create must be atomic.
		// Otherwise N concurrent arrivals all see a stale "below cap" count
		// and over-create. Codex F1 / Opus F1.
		await queuedCreationLock.enter()
		try {
			const sessionQueuedCount = await journal.countOperations({
				sessionId: session.sessionId,
				stage: "queued",
			})
			if (sessionQueuedCount >= MAX_QUEUED_PER_SESSION) {
				logger.log(
					"wallet-sdk-bg",
					LogLevel.Debug,
					`Per-session queued cap reached for ${session.sessionId}; skipping queued visibility`,
				)
				return undefined
			}
			const globalQueuedCount = await journal.countOperations({ stage: "queued" })
			if (globalQueuedCount >= MAX_QUEUED_GLOBAL) {
				logger.log("wallet-sdk-bg", LogLevel.Warn, `Global queued cap reached (${MAX_QUEUED_GLOBAL}); skipping queued visibility`)
				return undefined
			}

			const primaryMethod = extractPrimaryMethodFromSendTx(message)
			const record = await journal.createOperation({
				kind: "dapp_execute",
				origin: "dapp",
				profileId: activeProfile.id,
				sessionId: session.sessionId,
				accountAddress,
				networkId: network.id,
				title: primaryMethod ?? "Transaction",
				subtitle: session.origin,
				initialStage: { stage: "queued" },
			})
			return record.id
		} finally {
			queuedCreationLock.leave()
		}
	} catch (error) {
		logger.log("wallet-sdk-bg", LogLevel.Warn, `tryCreateQueuedJournal failed: ${getErrorMessage(error)}`)
		return undefined
	}
}

/**
 * Best-effort primary-method extraction from a sendTx wallet message.
 * Mirrors what `executeAztecSendTx` does to compute the title at journal
 * creation time, so the title is consistent between the queued surface
 * and the post-claim in-flight surface (the claim helper doesn't update
 * the title — its only mutation is the FSM stage).
 */
function extractPrimaryMethodFromSendTx(message: WalletMessage): string | undefined {
	if (message.type !== "sendTx") return undefined
	const args = message.args as unknown[] | undefined
	if (!Array.isArray(args)) return undefined
	const exec = args[0] as { calls?: Array<{ name?: string }> } | undefined
	if (!exec?.calls) return undefined
	return exec.calls.find((c) => typeof c?.name === "string")?.name
}

/**
 * Recursively convert a value to a JSON-safe structure.
 *
 * JSON.stringify cannot handle BigInt (throws) and silently drops undefined.
 * PXE results are full of BigInt (Fr fields, addresses, etc). This function
 * converts BigInt → string and recurses through arrays/objects so the
 * wallet-sdk's plain JSON.stringify call succeeds.
 */
function toJsonSafe(value: unknown, seen = new WeakSet()): unknown {
	if (value === null || value === undefined) return value
	if (typeof value === "bigint") return value.toString()
	if (typeof value !== "object") return value

	if (seen.has(value as object)) return "[Circular]"
	seen.add(value as object)

	if (Array.isArray(value)) return value.map((v) => toJsonSafe(v, seen))
	if (value instanceof Map) {
		return Array.from(value.entries(), ([k, v]) => [toJsonSafe(k, seen), toJsonSafe(v, seen)])
	}
	if (value instanceof Set) {
		return Array.from(value, (v) => toJsonSafe(v, seen))
	}
	// Objects with a toJSON method (Fr, AztecAddress, etc.) — let JSON.stringify
	// call it naturally, but still recurse in case the result contains BigInts.
	const obj = value as Record<string, unknown>
	if (typeof obj.toJSON === "function") {
		return toJsonSafe(obj.toJSON(), seen)
	}
	const out: Record<string, unknown> = {}
	for (const key of Object.keys(obj)) {
		out[key] = toJsonSafe(obj[key], seen)
	}
	return out
}

/**
 * Extract numeric chain ID from ChainInfo or ActiveSession/PendingDiscovery.
 *
 * ChainInfo arrives as serialized JSON (hex strings) after passing through
 * postMessage + JSON.parse, not as Fr instances. We parse the hex strings
 * to numbers and XOR chainId with rollup version, matching the convention
 * used by NetworkService (chainId = l1ChainId ^ rollupVersion).
 */
function chainInfoToChainId(obj: { chainInfo: { chainId: Fr | string; version: Fr | string } }): number {
	const raw = obj.chainInfo
	const chainId = typeof raw.chainId === "string" ? Number(BigInt(raw.chainId)) : Number(raw.chainId.toBigInt())
	const version = typeof raw.version === "string" ? Number(BigInt(raw.version)) : Number(raw.version.toBigInt())
	return (chainId ^ version) >>> 0
}
