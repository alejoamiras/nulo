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

// Patch WalletSchema before wallet-sdk reads it (Nulo-custom `registerToken`).
// Must be the first import in this module — see @nulo/wallet-sdk-schema-patch.
import "@nulo/wallet-sdk-schema-patch/register"

import { BackgroundConnectionHandler, type PendingDiscovery, type ActiveSession } from "@aztec/wallet-sdk/extension/handlers"
import { NOOP_LOGGER, type WalletMessage, type WalletResponse } from "@aztec/wallet-sdk/types"
import { attachContentListener } from "./content-message-relay"
import { isSubframeSender, validateContentScriptMessage } from "./content-script-validator"
import { SESSION_INVALID_ERROR, toWalletResponseError } from "./error-envelope"
import { toJsonSafe } from "./to-json-safe"
import { deletePendingVerificationForTab, type PendingVerificationEntry } from "./pending-verification"
import {
	enforceSessionProfileBinding,
	type ProfileSwitchEpoch,
	stampSessionProfileGuarded,
	trackProfileSwitchEpoch,
	wireProfileSwitchTeardown,
} from "./profile-switch-teardown"

import type { ServiceCollection } from "@/wallet/base"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { ExecutionService } from "@/wallet/services/execution/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { DappInteractionService } from "@/wallet/services/dapp-interaction/service"
import { TokenService } from "@/wallet/services/token/service"
import type { DiscoveryParams } from "@/wallet/services/dapp-interaction/spec"
import { DappSessionService, AccessLevel } from "@/wallet/services/dapp-session/service"
import { sanitizeWireString } from "@/wallet/services/dapp-session/capability-meta"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import {
	describeExternalId,
	describeWireMethod,
	type DispatchHooks,
	DiscoveryQueue,
	isDiscoveryExpired,
	type SessionContext,
	WalletSdkDispatcher,
} from "@nulo/wallet-bridge"
import { getErrorMessage, KeyedLock } from "@nulo/wallet-core/utils"
import { approveOrRollbackDiscoverySession } from "./discovery-approval"
import { failQueuedIfUnclaimed, tryCreateQueuedJournal } from "./queued-journal"
import { chainSendTxWithVouching } from "./queued-wait-vouching"
import { createSessionBaton } from "./session-baton"
import { chainInfoToChainId, handleSessionEstablished } from "./session-established"
import { wireTabLifecycle } from "./tab-lifecycle"
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@/wallet/logger"

declare const __VERSION__: string

/**
 * F-001 / Phase 4: feature flag to allow iframe (subframe) dApps to talk to
 * the wallet. Default `false` — Nulo's wrapper rejects content-script
 * messages from subframes. Override by setting
 * `VITE_NULO_ALLOW_IFRAME_DAPPS=1` at build time (rare; research found no
 * legitimate iframe-dApp use cases in the Nulo ecosystem).
 *
 * Why a build-time env flag (not a runtime config) — runtime config opens a
 * widening primitive that an attacker could try to flip via storage poisoning
 * or popup compromise. Build-time keeps the policy immutable per release.
 */
const NULO_ALLOW_IFRAME_DAPPS: boolean = import.meta.env?.VITE_NULO_ALLOW_IFRAME_DAPPS === "1"

/**
 * Initialize the wallet-sdk BackgroundConnectionHandler and wire it
 * to the extension's service layer.
 *
 * Call this after `services.start()` in the service worker entry point.
 */
export function initWalletSdkHandler(services: ServiceCollection, logger: ILogger): BackgroundConnectionHandler {
	const deps = resolveSdkDeps(services, logger)
	const state = createSdkHandlerState()

	const handler = new BackgroundConnectionHandler(
		{
			walletId: "nulo",
			walletName: "Nulo",
			walletVersion: __VERSION__,
			walletIcon: chrome.runtime.getURL("/src/assets/logo.png"),
			// 5.0 added a required `logger`; NOOP preserves the prior no-SDK-logging behavior.
			// (Follow-up: route to the @nulo logger to surface channel/heartbeat diagnostics.)
			logger: NOOP_LOGGER,
		},
		buildContentTransport(logger),
		buildHandlerCallbacks(deps, state),
	)
	state.late.handler = handler
	state.late.discoveryQueue = new DiscoveryQueue(handler, logger)

	serializeDecryption(handler, state.decryptLocks)
	wireSessionTeardown(handler, deps.dappSessionService, logger)

	// Profile-bound channel teardown: a switch disconnects every live session
	// stamped to another profile (and unstamped debris) BEFORE the discovery
	// drain below can serve the new profile. The epoch tracker feeds the
	// response-delivery gate in handleWalletMessage.
	state.late.switchEpoch = trackProfileSwitchEpoch(deps.profileService.onActiveProfileChanged)
	wireProfileSwitchTeardown({
		onActiveProfileChanged: deps.profileService.onActiveProfileChanged,
		getActiveSessions: () => handler.getActiveSessions(),
		sessionProfiles: state.sessionProfiles,
		terminateSession: (sessionId) => handler.terminateSession(sessionId),
		logger,
	})
	wireDiscoveryDrain(deps, state)

	// Tab lifecycle (close + cross-origin navigation → session termination)
	// lives in `tab-lifecycle.ts` (Q-04 pilot); it MUST stay registered before
	// `handler.initialize()`. Handler methods are arrow-wrapped to keep `this`.
	wireTabLifecycle({
		onTabTeardown: (tabId) => deletePendingVerificationForTab(state.pendingVerification, tabId),
		terminateForTab: (tabId) => handler.terminateForTab(tabId),
		terminateSession: (sessionId) => handler.terminateSession(sessionId),
		getActiveSessions: () => handler.getActiveSessions(),
		logger,
	})

	handler.initialize()
	logger.log("wallet-sdk", LogLevel.Info, "BackgroundConnectionHandler initialized")

	return handler
}

type SdkDeps = {
	networkService: NetworkService
	accountService: AccountService
	executionService: ExecutionService
	profileService: ProfileService
	dappInteractionService: DappInteractionService
	dappSessionService: DappSessionService
	operationJournal: OperationJournalService
	tokenService: TokenService
	dispatcher: WalletSdkDispatcher
	logger: ILogger
}

function resolveSdkDeps(services: ServiceCollection, logger: ILogger): SdkDeps {
	const networkService: NetworkService = services.get(NetworkService.name)
	const accountService: AccountService = services.get(AccountService.name)
	const executionService: ExecutionService = services.get(ExecutionService.name)
	const profileService: ProfileService = services.get(ProfileService.name)
	const dappInteractionService: DappInteractionService = services.get(DappInteractionService.name)
	const dappSessionService: DappSessionService = services.get(DappSessionService.name)
	const operationJournal: OperationJournalService = services.get(OperationJournalService.name)
	const tokenService: TokenService = services.get(TokenService.name)

	const dispatcher = new WalletSdkDispatcher(
		networkService,
		accountService,
		executionService,
		dappInteractionService,
		dappSessionService,
		logger,
		{
			// The isTokenRegistered custom RPC: a wallet-local registry read, scope-gated upstream.
			isTokenRegistered: async (address, profileId, chainId) => {
				const tokens = await tokenService.getTokens(profileId, chainId)
				const target = address.toLowerCase()
				return tokens.some((t) => t.contract.toLowerCase() === target)
			},
		},
	)
	return {
		networkService,
		accountService,
		executionService,
		profileService,
		dappInteractionService,
		dappSessionService,
		operationJournal,
		tokenService,
		dispatcher,
		logger,
	}
}

/** SW-lifetime state shared by the handler callbacks and the wiring around them. */
type SdkHandlerState = {
	/**
	 * Track new connections (user-approved via popup) keyed by the discovery
	 * REQUEST id — which upstream reuses verbatim as the sessionId — so
	 * establishment can only ever read its OWN approval's marker: concurrent
	 * same-`(origin, chainId)` handshakes and reconnects can't cross-consume,
	 * and the entry's `profileId` pins WHO approved for the skew check.
	 */
	pendingVerification: Map<string, PendingVerificationEntry>
	/**
	 * Live-channel identity binding: sessionId → owning profileId, stamped at
	 * establishment from the validated DappSession row (approver-checked via
	 * the pending-verification marker). Consumed by the dispatch guard and the
	 * profile-switch teardown; same lifetime as the upstream activeSessions
	 * (both die with the SW), cleaned in onSessionTerminated.
	 */
	sessionProfiles: Map<string, string>
	/**
	 * Guard against concurrent discoveries for the same `(origin, chainId)`
	 * pair (prevents duplicate connect popups). Stores a promise that
	 * resolves when the connect popup completes, so duplicate discoveries
	 * wait for the session to exist before being approved. Keying on the
	 * `(origin, chainId)` tuple lets a dApp open a connect popup for chain A
	 * and chain B concurrently without one waiting on the other (and without
	 * the chain-B discovery being auto-approved against a chain-A session).
	 */
	pendingDiscoveryPromises: Map<string, Promise<void>>
	/**
	 * Per-session message queue — ensures messages from the same dApp session
	 * are processed sequentially (FIFO). Without this, the fire-and-forget
	 * onWalletMessage callback processes messages concurrently, causing race
	 * conditions (e.g. executeUtility runs before registerContract completes).
	 */
	sessionQueues: Map<string, Promise<void>>
	/**
	 * Per-session establishment-validation result (B-13). The SDK sends the
	 * key-exchange response BEFORE invoking `onSessionEstablished`, whose async
	 * validation (row lookup, hash persist, verify-window open) may then TERMINATE
	 * the session as unverified. `onWalletMessage` awaits this promise before
	 * dispatching, so a message can never ride a session that's concurrently being
	 * torn down. Resolves `true` when established, `false` when terminated.
	 */
	establishmentStatus: Map<string, Promise<boolean>>
	/** Per-session decryption serializer (see `serializeDecryption`). */
	decryptLocks: KeyedLock
	/**
	 * Bound right after the handler is constructed, before `initialize()`
	 * attaches any listener; callbacks read these at call time, never earlier.
	 */
	late: { handler?: BackgroundConnectionHandler; discoveryQueue?: DiscoveryQueue; switchEpoch?: ProfileSwitchEpoch }
}

function createSdkHandlerState(): SdkHandlerState {
	return {
		pendingVerification: new Map(),
		sessionProfiles: new Map(),
		pendingDiscoveryPromises: new Map(),
		sessionQueues: new Map(),
		establishmentStatus: new Map(),
		// maxHoldMs: null — the prior hand-rolled decrypt chain had no watchdog (Q-08).
		decryptLocks: new KeyedLock({ maxHoldMs: null }),
		late: {},
	}
}

function buildContentTransport(logger: ILogger): ConstructorParameters<typeof BackgroundConnectionHandler>[1] {
	return {
		sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
		addContentListener: (listener) => {
			// The chrome.runtime.onMessage registration lives in the module-scope
			// content-message-relay (cold-wake fix): registering a SECOND chrome
			// listener here would double-deliver — a duplicate discovery's
			// coalesce→reject path deletes the entry its twin queued, and a
			// duplicate secure-message double-journals a sendTx. Attach to the
			// relay instead; buffered cold-wake messages flush through this same
			// validated wrapper.
			// biome-ignore lint/suspicious/noExplicitAny: Chrome message listener provides untyped messages
			attachContentListener((message: any, sender: chrome.runtime.MessageSender) => {
				// F-001: subframe rejection. Upstream `BackgroundConnectionHandler`
				// attributes origin via `sender.tab?.url` (top-frame URL), so an
				// iframe at https://evil.com/x.html embedded in https://app.example.com
				// would be credited to https://app.example.com — inheriting any
				// grants the user gave to the parent page.
				//
				// Nulo-side defense-in-depth: reject content-script messages
				// from subframes at the wrapper layer. `sender.frameId === 0`
				// is the top frame; any other value (or undefined for
				// non-tab senders) is a subframe.
				//
				// Feature flag: `NULO_ALLOW_IFRAME_DAPPS` (env / build-time)
				// disables this check. Default is "reject subframes" because
				// research found NO legitimate iframe-dApp use cases in the
				// Nulo ecosystem. If a counterexample surfaces, set the env
				// var rather than removing this check.
				//
				// Frame-targeted send replies (F-002 full fix) require upstream
				// `chrome.tabs.sendMessage(tabId, msg, { frameId })` support
				// in `BackgroundConnectionHandler`'s sendToTab signature —
				// upstream's `(tabId, msg)` interface doesn't pass frameId
				// through, so this remains an upstream coordination item.
				if (NULO_ALLOW_IFRAME_DAPPS !== true && isSubframeSender(sender)) {
					logger.log(
						"wallet-sdk-bg",
						LogLevel.Debug,
						// The tab and sender URLs are the user's browsing history, and any subframe on any
						// page can trigger this line. The frame identity is what diagnoses the rejection.
						`Rejected content-script message from subframe (frameId=${sender.frameId}, tabId=${sender.tab?.id}) — F-001 defense-in-depth`,
					)
					return undefined
				}

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
	}
}

function buildHandlerCallbacks(deps: SdkDeps, state: SdkHandlerState): ConstructorParameters<typeof BackgroundConnectionHandler>[2] {
	return {
		onPendingDiscovery: (discovery) => {
			handleDiscovery(discovery, discoveryDeps(deps, state))
		},

		onSessionEstablished: (session) => {
			const handler = state.late.handler!
			// Record the validation promise SYNCHRONOUSLY (before its first await)
			// so onWalletMessage can gate on it even if a message arrives in the
			// gap between the SDK's key-exchange response and this validation (B-13).
			const validated = handleSessionEstablished(session, {
				dappSessionService: deps.dappSessionService,
				terminateSession: (sessionId) => handler.terminateSession(sessionId),
				pendingVerification: state.pendingVerification,
				stampSessionProfile: (sessionId, profileId) =>
					stampSessionProfileGuarded(state.sessionProfiles, sessionId, profileId, (id) =>
						handler.getActiveSessions().some((s) => s.sessionId === id),
					),
				isSessionLive: (sessionId) => handler.getActiveSessions().some((s) => s.sessionId === sessionId),
				logger: deps.logger,
			})
			state.establishmentStatus.set(session.sessionId, validated)
			return validated.then(() => undefined)
		},

		onSessionTerminated: (sessionId) => {
			state.sessionProfiles.delete(sessionId)
			state.sessionQueues.delete(sessionId)
			state.decryptLocks.delete(sessionId)
			state.establishmentStatus.delete(sessionId)
		},

		onWalletMessage: (session, message) => onWalletMessage(session, message, deps, state),
	}
}

function onWalletMessage(session: ActiveSession, message: WalletMessage, deps: SdkDeps, state: SdkHandlerState): void {
	const key = session.sessionId
	const prev = state.sessionQueues.get(key) ?? Promise.resolve()

	// Baton-based FIFO (see `session-baton.ts` for mechanics).
	// Resolves when the sendTx handler enqueues on the execution mutex
	// (via `onExecutionEnqueued`) OR when the handler completes
	// (safety-net `.finally(releaseFifo)`), whichever fires first.
	const { baton, releaseFifo } = createSessionBaton()

	// B-13: gate on establishment validation. Between the SDK's
	// key-exchange response and onSessionEstablished's async validation, a
	// message must not ride a session being terminated as unverified — and
	// must not persist a durable journal record for it. Capture the
	// per-session validation promise and re-check its identity after the
	// await: a termination during the wait deletes (or replaces) the entry,
	// so an already-waiting handler drops. This gate is computed on message
	// ARRIVAL, NOT behind the FIFO baton — so a queued sibling still gets its
	// durable queued-journal record immediately. Two concurrent `sendTx`
	// requests must BOTH show as `queued` before either is approved (the
	// anti-lost-tx invariant `concurrent-sendtx.test.ts` pins); serializing
	// only execution — never record creation — behind the baton preserves it.
	const validation = state.establishmentStatus.get(key)
	const establishedPromise = (validation ?? Promise.resolve(false)).then(
		(established) => established && state.establishmentStatus.get(key) === validation,
	)

	// Queued journal is created on arrival (concurrent across siblings),
	// gated on establishment. Only top-level `sendTx` gets a pre-allocated
	// record — `batch` is excluded by design: the recursive dispatch in
	// WalletSdkDispatcher.handleBatch can't safely route hooks per-leg, so
	// we'd end up with a batch-level record no inner leg knows to claim.
	// TODO(queued-visibility-for-batch): batched sendTx legs currently
	// bypass the queued-record creation path.
	const queuedJournalIdPromise: Promise<string | undefined> =
		message.type === "sendTx"
			? establishedPromise.then((ok) => createQueuedJournalIfStamped(ok, message, session, deps, state))
			: Promise.resolve(undefined)

	// Pre-claim liveness: the record ages in `queued` through the whole
	// session-FIFO wait + its own approval popup — a legitimate wait
	// the reaper's grace cannot distinguish from a lost handler. The
	// begin/end PLACEMENT invariants live (unit-pinned) in
	// `queued-wait-vouching.ts`.
	chainSendTxWithVouching({
		queuedJournalIdPromise,
		prev,
		vouch: deps.executionService,
		releaseFifo,
		run: (queuedJournalId) => runEstablishedMessage(queuedJournalId, establishedPromise, releaseFifo, session, message, deps, state),
	})
	state.sessionQueues.set(
		key,
		baton.catch(() => {}),
	)
}

/** The stamp guard runs BEFORE the durable journal write: this path
 *  independently resolves profile/session/account/network, so without the
 *  anchor an A-era message racing a switch could persist a B-profile
 *  operation. Establishment stamps before its validation promise resolves, so
 *  a missing stamp here means a superseded/foreign session — skip the record
 *  (the handler's own guard rejects the message itself). */
function createQueuedJournalIfStamped(
	ok: boolean,
	message: WalletMessage,
	session: ActiveSession,
	deps: SdkDeps,
	state: SdkHandlerState,
): ReturnType<typeof tryCreateQueuedJournal> | undefined {
	const stampedProfileId = state.sessionProfiles.get(session.sessionId)
	return ok && stampedProfileId !== undefined
		? tryCreateQueuedJournal(message, session, {
				journal: deps.operationJournal,
				profile: deps.profileService,
				dappSession: deps.dappSessionService,
				networkSvc: deps.networkService,
				account: deps.accountService,
				stampedProfileId,
				logger: deps.logger,
			})
		: undefined
}

async function runEstablishedMessage(
	queuedJournalId: string | undefined,
	establishedPromise: Promise<boolean>,
	releaseFifo: ReturnType<typeof createSessionBaton>["releaseFifo"],
	session: ActiveSession,
	message: WalletMessage,
	deps: SdkDeps,
	state: SdkHandlerState,
): Promise<void> {
	// B-13: re-gate execution behind the baton. A session that
	// failed/lost establishment must not execute either — not just skip
	// its journal. Same promise as the journal gate, so it resolves once.
	if (!(await establishedPromise)) {
		deps.logger.log(
			"wallet-sdk-bg",
			LogLevel.Warn,
			`Dropping message for session ${describeExternalId(session.sessionId)}: failed/lost establishment validation`,
		)
		return
	}
	return handleWalletMessage(
		session,
		message,
		state.late.handler!,
		deps.dispatcher,
		deps.profileService,
		deps.operationJournal,
		state.sessionProfiles,
		state.late.switchEpoch!,
		deps.logger,
		{
			// Bind the baton release into the `onExecutionEnqueued`
			// slot — fired downstream by ExecutionService the instant
			// the approved request enqueues on the execution mutex
			// (which preserves execution order). The field name is
			// shared across DispatchHooks → ExecutionHooks so the wiring
			// is type-checked end-to-end (a past field-name drift here
			// is exactly what left this release dead before).
			onExecutionEnqueued: releaseFifo,
			queuedJournalId,
		},
	)
}

/**
 * Serialize decryption per-session to prevent message reordering.
 * The wallet-sdk uses `void this.handleEncryptedMessage(...)` (fire-and-forget),
 * so two messages can have their decryptions race.
 * TODO: Remove this monkey-patch if wallet-sdk adds a proper serialization API.
 */
function serializeDecryption(handler: BackgroundConnectionHandler, decryptLocks: KeyedLock): void {
	// biome-ignore lint/suspicious/noExplicitAny: monkey-patching private method on BackgroundConnectionHandler to serialize decryption
	const origDecrypt = (handler as any).handleEncryptedMessage.bind(handler)
	// biome-ignore lint/suspicious/noExplicitAny: monkey-patching private method on BackgroundConnectionHandler to serialize decryption
	;(handler as any).handleEncryptedMessage = (sessionId: string, encrypted: unknown) =>
		decryptLocks.withLock(sessionId, () => origDecrypt(sessionId, encrypted))
}

/** F-006: when a stored DappSession is deleted (settings disconnect OR
 *  TTL expiry — both emit the same event), tear down every matching
 *  live wallet-sdk ActiveSession so the dApp can't keep calling
 *  network-only methods over the still-open channel.
 *
 *  Tuple-match by `(origin, chainId)` — per audit Round 1 reversal of
 *  Decision 8, NOT a single `walletSdkSessionId` field, because a single
 *  stored DappSession may correspond to MULTIPLE live ActiveSessions
 *  (multi-tab same dApp). O(n) iteration where n is bounded by tabs-with-
 *  dApp-loaded — typically <10. */
function wireSessionTeardown(handler: BackgroundConnectionHandler, dappSessionService: DappSessionService, logger: ILogger): void {
	dappSessionService.onDappSessionDeleted.add((deleted) => {
		try {
			const origin = deleted.dappMetadata?.url
			const chainId = deleted.chainId
			if (!origin || !chainId) {
				logger.log(
					"wallet-sdk-bg",
					LogLevel.Warn,
					`DappSession deleted with missing origin/chainId — cannot match active sessions; skipping teardown`,
				)
				return
			}
			const matches = handler.getActiveSessions().filter((s) => s.origin === origin && String(chainInfoToChainId(s)) === chainId)
			for (const match of matches) {
				logger.log(
					"wallet-sdk-bg",
					LogLevel.Info,
					`Terminating live session ${describeExternalId(match.sessionId)} on chain ${chainId} — dApp access revoked`,
				)
				handler.terminateSession(match.sessionId)
			}
		} catch (err) {
			logger.log("wallet-sdk-bg", LogLevel.Error, `Failed to terminate live sessions on dapp-session-deleted: ${err}`)
		}
	})
}

/** On unlock, drain any queued discovery requests */
function wireDiscoveryDrain(deps: SdkDeps, state: SdkHandlerState): void {
	const { profileService, logger } = deps
	profileService.onActiveProfileChanged.add((profile) => {
		const discoveryQueue = state.late.discoveryQueue!
		if (profile) {
			logger.log("wallet-sdk", LogLevel.Info, `Profile unlocked, draining discovery queue (${discoveryQueue.size} queued)`)
			discoveryQueue.drain((discovery) => drainQueuedDiscovery(discovery, deps, state))
		} else {
			logger.log("wallet-sdk", LogLevel.Info, `Profile locked (${discoveryQueue.size} in queue)`)
		}
	})
}

async function drainQueuedDiscovery(discovery: PendingDiscovery, deps: SdkDeps, state: SdkHandlerState): Promise<boolean> {
	const { profileService, logger } = deps
	const p = await profileService.getActiveProfile()
	if (!p) {
		logger.log("wallet-sdk", LogLevel.Warn, "Wallet locked mid-drain, stopping")
		return false
	}
	logger.log("wallet-sdk", LogLevel.Info, `Processing queued discovery: request ${describeExternalId(discovery.requestId)}`)
	await handleDiscovery(discovery, discoveryDeps(deps, state))
	logger.log("wallet-sdk", LogLevel.Info, `Queued discovery processed: request ${describeExternalId(discovery.requestId)}`)
	return true
}

type DiscoveryDeps = {
	handler: BackgroundConnectionHandler
	profileService: ProfileService
	dappInteractionService: DappInteractionService
	dappSessionService: DappSessionService
	pendingVerification: Map<string, PendingVerificationEntry>
	pendingDiscoveryPromises: Map<string, Promise<void>>
	discoveryQueue: DiscoveryQueue
	logger: ILogger
}

function discoveryDeps(deps: SdkDeps, state: SdkHandlerState): DiscoveryDeps {
	return {
		handler: state.late.handler!,
		profileService: deps.profileService,
		dappInteractionService: deps.dappInteractionService,
		dappSessionService: deps.dappSessionService,
		pendingVerification: state.pendingVerification,
		pendingDiscoveryPromises: state.pendingDiscoveryPromises,
		discoveryQueue: state.late.discoveryQueue!,
		logger: deps.logger,
	}
}

// F-04: caps on concurrent connect popups — the unlocked-path analog of the
// locked-queue caps in `DiscoveryQueue`. Same values: a legitimate dApp needs
// at most a handful of concurrent discoveries; past this, a flooding dApp's
// requests are rejected before any popup work.
const DISCOVERY_PENDING_GLOBAL_CAP = 32
const DISCOVERY_PENDING_PER_ORIGIN_CAP = 4

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
async function handleDiscovery(discovery: PendingDiscovery, deps: DiscoveryDeps): Promise<void> {
	const { handler, logger } = deps
	try {
		// F-04: resolve chainId up-front — the locked-queue coalesce/cap and the
		// popup caps below all key on `(origin,chainId)`, not just the
		// auto-approve lookup and new-session creation.
		const chainId = String(chainInfoToChainId(discovery))

		const profile = await deps.profileService.getActiveProfile()
		if (!profile) {
			// F-04: `enqueue` returns false when it coalesces a duplicate or hits a
			// cap. The upstream `pendingDiscoveries` map (keyed by the dApp-controlled
			// requestId) is NOT bounded, so a dropped request must be rejected there
			// or it leaks one pending entry per requestId — a flood of distinct
			// requestIds under a single (origin,chainId) would grow it without limit,
			// defeating the queue cap. The still-queued first entry has a different
			// requestId and is untouched; it drains on unlock.
			if (!deps.discoveryQueue.enqueue(discovery.requestId, discovery.origin, chainId)) {
				handler.rejectDiscovery(discovery.requestId)
			}
			return
		}

		// Check for existing valid session (returning user on this chain → auto-approve).
		// Lookup is by `(origin, chainId)` so a session remembered on testnet does
		// NOT silently auto-approve on mainnet (AUDIT plan A12). The lookup is awaited
		// HERE: from its resolution to the popup-promise registration below there is
		// no yield, so two same-key discoveries can never both miss the dedupe map.
		const existingSession = await deps.dappSessionService.tryGetDappSessionByOriginAndChain(discovery.origin, chainId)
		if (existingSession) {
			autoApproveExistingSession(discovery, chainId, deps)
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
		const pendingPopup = deps.pendingDiscoveryPromises.get(dedupeKey)
		if (pendingPopup) {
			await awaitPendingPopupDedupe(pendingPopup, discovery, chainId, deps)
			return
		}

		if (checkDiscoveryPopupCaps(discovery, deps)) return

		await runDiscoveryPopup(discovery, chainId, dedupeKey, deps)
	} catch {
		// User rejected or popup was closed
		handler.rejectDiscovery(discovery.requestId)
		logger.log("wallet-sdk", LogLevel.Warn, `Discovery rejected for request ${describeExternalId(discovery.requestId)}`)
	}
}

/** B-16: reject an approval the dApp can no longer receive. The drain-gate
 *  staleness check is not enough — an interactive Allow/Deny popup (or a wait
 *  on a concurrent popup for the same (origin, chainId)) can resolve after the
 *  dApp's 60s discovery window closes. Re-check immediately before EVERY
 *  approval, and before the durable DappSession write, so a slow approval
 *  doesn't strand a half-open handshake or persist a session the dApp never
 *  learns about. */
function rejectIfExpired(discovery: PendingDiscovery, deps: DiscoveryDeps): boolean {
	if (isDiscoveryExpired(discovery)) {
		deps.handler.rejectDiscovery(discovery.requestId)
		deps.logger.log(
			"wallet-sdk",
			LogLevel.Warn,
			`Discovery rejected (past Nulo's 55s freshness cutoff): request ${describeExternalId(discovery.requestId)}`,
		)
		return true
	}
	return false
}

/** Returning user on this chain: approve unless the request already expired. Synchronous. */
function autoApproveExistingSession(discovery: PendingDiscovery, chainId: string, deps: DiscoveryDeps): void {
	if (rejectIfExpired(discovery, deps)) return
	deps.handler.approveDiscovery(discovery.requestId)
	deps.logger.log(
		"wallet-sdk",
		LogLevel.Info,
		`Discovery auto-approved (existing session): request ${describeExternalId(discovery.requestId)} chain=${chainId}`,
	)
}

async function awaitPendingPopupDedupe(
	pendingPopup: Promise<void>,
	discovery: PendingDiscovery,
	chainId: string,
	deps: DiscoveryDeps,
): Promise<void> {
	const { handler, logger } = deps
	await pendingPopup
	// The popup may have resolved with rejection (or with approval
	// for a different chain — impossible under tuple keying, but
	// defense in depth): re-check the session exists for THIS
	// `(origin, chainId)` before auto-approving. If the user
	// declined, reject this duplicate too instead of inheriting an
	// approval the user never gave.
	const settledSession = await deps.dappSessionService.tryGetDappSessionByOriginAndChain(discovery.origin, chainId)
	if (settledSession) {
		if (rejectIfExpired(discovery, deps)) return
		handler.approveDiscovery(discovery.requestId)
		logger.log(
			"wallet-sdk",
			LogLevel.Info,
			`Discovery auto-approved (pending popup resolved): request ${describeExternalId(discovery.requestId)} chain=${chainId}`,
		)
	} else {
		handler.rejectDiscovery(discovery.requestId)
		logger.log(
			"wallet-sdk",
			LogLevel.Info,
			`Discovery rejected (pending popup resolved without session): request ${describeExternalId(discovery.requestId)} chain=${chainId}`,
		)
	}
}

/** F-04: cap concurrent connect popups per-origin and globally. The
 *  `(origin,chainId)` dedupe collapses exact duplicates; this bounds the
 *  distinct-key fan-out so a dApp can't spawn unbounded popup work via many
 *  chainIds (or a botnet of origins). Returns true when rejected at the cap. */
function checkDiscoveryPopupCaps(discovery: PendingDiscovery, deps: DiscoveryDeps): boolean {
	const { pendingDiscoveryPromises } = deps
	const originPopups = [...pendingDiscoveryPromises.keys()].filter((k) => k.startsWith(`${discovery.origin}|`)).length
	if (originPopups >= DISCOVERY_PENDING_PER_ORIGIN_CAP || pendingDiscoveryPromises.size >= DISCOVERY_PENDING_GLOBAL_CAP) {
		deps.handler.rejectDiscovery(discovery.requestId)
		deps.logger.log(
			"wallet-sdk",
			LogLevel.Warn,
			`Discovery rejected (popup cap) [origin=${originPopups}, global=${pendingDiscoveryPromises.size}]`,
		)
		return true
	}
	return false
}

/** New dApp → show discovery popup (Allow/Deny), then persist + approve. The
 *  dedupe registration, the durable writes and the `finally` release are one
 *  unit: no await separates registering the popup promise from creating it. */
async function runDiscoveryPopup(discovery: PendingDiscovery, chainId: string, dedupeKey: string, deps: DiscoveryDeps): Promise<void> {
	const { handler, dappSessionService, pendingDiscoveryPromises, logger } = deps
	// Sanitize dApp-controlled strings at the persistence boundary so downstream
	// render sites never see raw bidi / zero-width / mixed-direction payloads (F-009 A-03).
	const rawAppName = discovery.appName ?? discovery.appId
	const params: DiscoveryParams = {
		dappMetadata: {
			name: sanitizeWireString(rawAppName, 64),
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
		const result = await deps.dappInteractionService.discover(params, discovery.requestId)
		if (!result.approved) {
			handler.rejectDiscovery(discovery.requestId)
			logger.log("wallet-sdk", LogLevel.Info, `Discovery denied: request ${describeExternalId(discovery.requestId)}`)
			return
		}

		// B-16: the user may have taken longer than the dApp's 60s window to
		// click Allow. Reject BEFORE the durable DappSession write so we never
		// persist a session the dApp has already stopped waiting for.
		if (rejectIfExpired(discovery, deps)) return

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

		// B-16: re-check freshness AFTER the durable writes (which can
		// themselves cross the deadline) and approve, or roll back + reject.
		const approved = await approveOrRollbackDiscoverySession({
			discovery,
			sessionId: newSession.id,
			approverProfileId: newSession.profileId,
			approveDiscovery: (id) => handler.approveDiscovery(id),
			rejectDiscovery: (id) => handler.rejectDiscovery(id),
			deleteSession: (id) => dappSessionService.deleteDappSession(id),
			pendingVerification: deps.pendingVerification,
			logger,
		})
		if (approved) {
			logger.log(
				"wallet-sdk",
				LogLevel.Info,
				`Discovery approved: request ${describeExternalId(discovery.requestId)} chain=${chainId}`,
			)
		}
	} finally {
		resolvePopup!()
		pendingDiscoveryPromises.delete(dedupeKey)
	}
}

/**
 * Handle an incoming wallet message from a connected dApp.
 *
 * Dispatches the method call to the WalletSdkDispatcher, then encrypts
 * and sends the response back through the BackgroundConnectionHandler.
 *
 * `hooks` is the wallet-bridge `DispatchHooks` contract (imported, not a
 * local mirror) so the `onExecutionEnqueued` baton wiring is type-checked
 * against the dispatcher's expectation — preventing a recurrence of the
 * field-name drift that left the release dead. `onExecutionEnqueued` rides
 * to the sendTx path; `queuedJournalId` is used here (identity-guard fail
 * and catch paths) to decide whether an unclaimed `queued` record should be
 * transitioned to `failed`.
 */
async function handleWalletMessage(
	session: ActiveSession,
	message: WalletMessage,
	handler: BackgroundConnectionHandler,
	dispatcher: WalletSdkDispatcher,
	profileService: ProfileService,
	operationJournal: OperationJournalService,
	sessionProfiles: Map<string, string>,
	switchEpoch: ProfileSwitchEpoch,
	logger: ILogger,
	hooks?: DispatchHooks,
): Promise<void> {
	const response: WalletResponse = {
		messageId: message.messageId,
		walletId: "nulo",
	}
	// The switch epoch the response is composed under — gates delivery at the
	// tail. Captured BEFORE the awaited profile read: a switch landing inside
	// that await must register as a bump AFTER this baseline, or the stale
	// `profile` would pass the entry guard and the tail would see no change.
	const preEntryEpoch = switchEpoch.current()
	let entryEpoch: number | undefined

	try {
		const profile = await requireActiveProfile(profileService, "Wallet is locked")
		entryEpoch = preEntryEpoch

		// Identity guard: the channel serves ONLY the profile that established
		// it (map-miss = fail closed). The dApp gets the error envelope, then
		// the standard disconnect. `ctx.profileId` below is therefore always
		// the session's OWN profile, and the dispatcher's session lookup
		// anchors on it — an in-flight message that outlives a later switch
		// stays A-consistent or fails closed; it can never observe the new
		// profile.
		const mayProceed = await enforceSessionProfileBinding({
			sessionId: session.sessionId,
			origin: session.origin,
			activeProfileId: profile.id,
			sessionProfiles,
			respond: () => {
				response.error = SESSION_INVALID_ERROR
				return handler.sendResponse(session.sessionId, response)
			},
			terminateSession: (sessionId) => handler.terminateSession(sessionId),
			logger,
		})
		if (!mayProceed) {
			// The guard's early return bypasses the catch below — close a
			// pre-created queued record here too, or it sits at "Queued..."
			// until the reaper's stuck sweep.
			if (hooks?.queuedJournalId) {
				await failQueuedIfUnclaimed(operationJournal, hooks.queuedJournalId, "Session no longer valid — reconnect", logger)
			}
			return
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
		// Pass the error as an OBJECT, never pre-stringified: a finished string is opaque to the
		// logger's redaction, so interpolating it here would smuggle whatever the error carries
		// (endpoint URLs, argument values) straight into the log store.
		logger.log(
			"wallet-sdk",
			LogLevel.Error,
			`Method ${describeWireMethod(message.type)} failed for session ${describeExternalId(session.sessionId)}`,
			response.error,
		)

		if (hooks?.queuedJournalId) {
			await failQueuedIfUnclaimed(operationJournal, hooks.queuedJournalId, getErrorMessage(error), logger)
		}
	}

	// The entry guard is one-shot: a switch landing mid-dispatch normally tears
	// the session down (upstream sendResponse then no-ops), but a teardown
	// hiccup can leave the channel live — and a response composed with the NEW
	// profile's reads must never reach the old channel. The EPOCH comparison
	// (not an active-identity check) also catches switch-then-lock, where the
	// active profile reads `undefined` and an identity check would wave the
	// response through. Pure lock/unlock-to-same bumps nothing, so those
	// pinned flows still deliver.
	if (entryEpoch !== undefined && switchEpoch.current() !== entryEpoch) {
		logger.log(
			"wallet-sdk",
			LogLevel.Warn,
			`Suppressing ${describeWireMethod(message.type)} response for session ${describeExternalId(session.sessionId)}: profile switched mid-dispatch`,
		)
		return
	}

	try {
		await handler.sendResponse(session.sessionId, response)
	} catch (sendError) {
		// The error goes as an OBJECT, not interpolated: this is an internal transport failure worth
		// diagnosing, and passing it whole lets the logger's projection scrub and cap it.
		logger.log("wallet-sdk", LogLevel.Error, `Failed to send response for ${describeWireMethod(message.type)}`, sendError)
	}
}
