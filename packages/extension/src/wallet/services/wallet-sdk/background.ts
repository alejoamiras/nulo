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
import { E2E_PROBE_ENABLED, hashSid, probe } from "@/wallet/utils/probe"

import type { ServiceCollection } from "@/wallet/base"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { ExecutionService } from "@/wallet/services/execution/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { DappInteractionService } from "@/wallet/services/dapp-interaction/service"
import type { DiscoveryParams } from "@/wallet/services/dapp-interaction/spec"
import { DappSessionService, AccessLevel } from "@/wallet/services/dapp-session/service"
import { DiscoveryQueue, type SessionContext, WalletSdkDispatcher } from "@nulo/wallet-bridge"
import { jsonStringify } from "@nulo/wallet-core/utils"
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
				if (E2E_PROBE_ENABLED) probe("SESSION-EST", { sidH: hashSid(session.sessionId), origin: session.origin })
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
				if (E2E_PROBE_ENABLED) probe("SESSION-TERM", { sidH: hashSid(sessionId) })
				sessionQueues.delete(sessionId)
				decryptQueues.delete(sessionId)
			},

			onWalletMessage: (session, message) => {
				if (E2E_PROBE_ENABLED) {
					probe("BCH-RECV", {
						sidH: hashSid(session.sessionId),
						method: message.type,
						messageId: message.messageId,
						queueDepth: sessionQueues.size,
					})
				}
				const key = session.sessionId
				const prev = sessionQueues.get(key) ?? Promise.resolve()
				const next = prev.then(() => handleWalletMessage(session, message, handler, dispatcher, profileService, logger))
				sessionQueues.set(
					key,
					next.catch(() => {}),
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
		if (E2E_PROBE_ENABLED) {
			// biome-ignore lint/suspicious/noExplicitAny: reading upstream's private activeSessions map for session-lookup-miss visibility — the upstream silently returns on miss, which is what we're tracing.
			const activeSessions = (handler as any).activeSessions as Map<string, unknown> | undefined
			const hasSession = activeSessions?.has(sessionId) ?? false
			probe("BCH-DECRYPT-IN", {
				sidH: hashSid(sessionId),
				hasSession,
				activeCount: activeSessions?.size ?? 0,
				queueDepth: decryptQueues.size,
			})
			if (!hasSession) {
				// Upstream's handleEncryptedMessage at background_connection_handler.js:173
				// is about to silently `return` because activeSessions.get(sessionId)
				// is undefined. This is THE H2 falsification signal.
				probe("BCH-SESSION-LOOKUP-MISS", { sidH: hashSid(sessionId), activeCount: activeSessions?.size ?? 0 })
			}
		}
		const prev = decryptQueues.get(sessionId) ?? Promise.resolve()
		const decryptStartedAt = E2E_PROBE_ENABLED ? Date.now() : 0
		const next = prev.then(async () => {
			try {
				const result = await origDecrypt(sessionId, encrypted)
				if (E2E_PROBE_ENABLED) {
					probe("BCH-DECRYPT-OUT", { sidH: hashSid(sessionId), status: "ok", elapsedMs: Date.now() - decryptStartedAt })
				}
				return result
			} catch (err) {
				if (E2E_PROBE_ENABLED) {
					probe("BCH-DECRYPT-OUT", {
						sidH: hashSid(sessionId),
						status: "throw",
						elapsedMs: Date.now() - decryptStartedAt,
					})
				}
				throw err
			}
		})
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
	logger: ILogger,
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

		const raw = await dispatcher.dispatch(message.type, message.args, ctx)
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
	}

	if (E2E_PROBE_ENABLED) {
		// biome-ignore lint/suspicious/noExplicitAny: reading upstream's private activeSessions map to detect mid-RPC session loss before the send attempts.
		const activeSessions = (handler as any).activeSessions as Map<string, unknown> | undefined
		probe("BCH-SEND-WIRE", {
			sidH: hashSid(session.sessionId),
			method: message.type,
			messageId: message.messageId,
			hasSession: activeSessions?.has(session.sessionId) ?? false,
			isError: response.error !== undefined,
		})
	}
	try {
		await handler.sendResponse(session.sessionId, response)
		if (E2E_PROBE_ENABLED) {
			probe("BCH-SEND", { sidH: hashSid(session.sessionId), method: message.type, status: "ok" })
		}
	} catch (sendError) {
		if (E2E_PROBE_ENABLED) {
			probe("BCH-SEND", { sidH: hashSid(session.sessionId), method: message.type, status: "throw" })
		}
		logger.log(
			"wallet-sdk",
			LogLevel.Error,
			`Failed to send response for ${message.type}: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
		)
	}
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
