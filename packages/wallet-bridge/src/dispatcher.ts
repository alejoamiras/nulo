/**
 * WalletSdkDispatcher — Central dispatch layer for wallet-sdk protocol messages.
 *
 * ## Purpose
 *
 * This module bridges the `@aztec-labs/wallet-sdk` communication protocol with the
 * extension's existing service layer. When a dApp sends a wallet method call
 * (e.g. `sendTx`, `simulateTx`, `registerToken`) over the wallet-sdk encrypted
 * channel, the BackgroundConnectionHandler decrypts it and delivers a
 * `WalletMessage` with `{ type: string, args: unknown[] }`.
 *
 * The dispatcher's job is to:
 *   1. Map the wallet-sdk method name to an internal `Operation` kind
 *   2. Resolve `SessionContext` (chainId, profileId) into concrete networkId / accountAddress
 *   3. Build the `Operation[]` array expected by `ExecutionService.executeOperations()`
 *   4. Return the result (or throw) so the caller can build a `WalletResponse`
 *
 * ## Architecture
 *
 * The dispatcher does NOT directly call PXE, account derivation, or transaction
 * building. It delegates everything to `ExecutionService`, which already handles
 * all operation kinds for both the Nulo custom interface and the Aztec.js
 * Wallet interface. This keeps business logic in one place.
 *
 * The session-to-network resolution mirrors `DappInteractionService.silentInteraction()`,
 * which converts CAIP-2 identifiers to internal network/account references.
 *
 * ## Usage
 *
 * ```typescript
 * const dispatcher = new WalletSdkDispatcher(
 *   networkService,
 *   accountService,
 *   executionService,
 *   dappInteractionService,
 *   dappSessionService,
 *   logger,
 * );
 *
 * // In BackgroundConnectionHandler.onWalletMessage callback:
 * const result = await dispatcher.dispatch(message.type, message.args, sessionContext);
 * await bgHandler.sendResponse(session.sessionId, {
 *     messageId: message.messageId,
 *     result,
 *     walletId: 'nulo',
 * });
 * ```
 */

// Every domain type the dispatcher touches now lives inside @nulo/wallet-bridge.
// Imports use relative paths because this file IS part of wallet-bridge — the
// package-name import (`@nulo/wallet-bridge`) would resolve at runtime but
// wires an unnecessary self-reference through the barrel.
import { isNoFromRequest, requestedSenderOf, resolveAuthorizedSessionAccount } from "./account-resolution"
import { formatCaipAccount, formatCaipChain, parseCaipAccount } from "./caip"
import type { AccountsCapability, GrantedCapabilityRecord } from "./capabilities"
import { getRequiredCapability, isCapabilityExempt } from "./capability-map"
import {
	type CapabilityManifest,
	type CapabilityPlan,
	computeCapabilityDelta,
	dataAnswer,
	grantsNothing,
	mergeGrantsAndRejections,
	planAccountsWidening,
	projectRequestedCapabilities,
	reRequestedTypes,
	sessionAccountsOf,
	storedGrantAnswer,
	ungrantedAccounts,
} from "./capability-negotiation"
import {
	BATCH_REFUSED_METHODS,
	METHOD_REGISTRY,
	METHOD_TO_KIND,
	NETWORK_ONLY_KINDS,
	ACCOUNT_KINDS,
	assertKnownMethod,
	type MethodName,
} from "./method-descriptors"
import type {
	AztecCreateAuthWitRequest,
	AztecSendTxRequest,
	CapabilityResult,
	ExecutionResult,
	RegisterTokenRequest,
	SendTransactionRequest,
} from "./dapp-interaction-protocol"
import type {
	AztecCreateAuthWitOperation,
	AztecExecuteUtilityOperation,
	AztecGetContractClassMetadataOperation,
	AztecGetContractMetadataOperation,
	AztecGetPrivateEventsOperation,
	AztecProfileTxOperation,
	AztecRegisterContractOperation,
	AztecRegisterSenderOperation,
	AztecSimulateTxOperation,
	Operation,
} from "./operation"
import type { OperationResult } from "./operation-result"
import { enforceScope, enforceScopeWithSession } from "./scope-enforcement"
import { scopeViolation } from "./scope-violation"
import { authorizationsEffective, grantsOfType, isCreateAuthWitCoveredByTxOrSimulationScope, readConsent } from "./method-scope-checkers"
import type { IAccountRef, IDappSessionRef, INetworkRef } from "./session-types"
import { OriginType, type LocalTxOrigin } from "./transaction-origin"
import type { SessionContext } from "./types"
import {
	CapabilityNotGrantedError,
	ChainNotSupportedError,
	JobCancelledError,
	walletErrorFromPayload,
} from "@nulo/extension-messaging/errors"
import type { ILogger } from "@nulo/wallet-core/logger"
import { LogLevel } from "@nulo/wallet-core/logger"
import { isObjectLike } from "@nulo/wallet-core/utils"
import { describeExternalId } from "./external-id"
import { WALLET_FEATURES } from "./wallet-features"
import type {
	IAccountProvisioner,
	IAccountReader,
	IDappInteractionRunner,
	IDappSessionWriter,
	IExecutionRunner,
	INetworkReader,
	ITokenRegistryReader,
} from "./services-contract"

/**
 * Hooks the wallet-sdk background message handler hands the dispatcher, kept
 * off `SessionContext` because the ctx reaches recursive batch-leg dispatches,
 * where hooks would break the batch's sequential-completion contract.
 *
 * Currently consumed only by the `sendTx` path (forwarded to
 * `DappInteractionService.execute` → `executionService.executeOperations`
 * → `executeAztecSendTx` / `executeNoFromSendTx`). Other methods ignore.
 */
export interface DispatchHooks {
	/**
	 * Invoked by the wallet once the approved request has enqueued on the
	 * per-(profileId, chainId) execution mutex. Releases the session FIFO baton
	 * so the next pending message's popup can open — safely, because this
	 * request is already ahead of any later one in the execution FIFO, so
	 * message/approval order is preserved. Popup/UI concurrency without
	 * reordering execution.
	 */
	onExecutionEnqueued?: () => void
	/**
	 * Pre-allocated journal id from `background.ts:onWalletMessage`. When
	 * present, the handler should TRANSITION this record (queued → pending
	 * → ...) instead of creating a new one. Lets the activity feed surface
	 * the request immediately on message arrival.
	 */
	queuedJournalId?: string
}

declare const __VERSION__: string

export { dataFieldsCovered, projectKnownCapability, ungrantedAccounts } from "./capability-negotiation"

/**
 * Unwrap an `OperationResult`, returning the value or throwing.
 *
 * `cancelled` throws a structured `JobCancelledError` so the wallet-sdk
 * handler can write `{ code: 4001, ... }` to the dApp response envelope —
 * distinct from `failed`, which the dApp surfaces as a real error. Exported
 * so the contract is unit-testable without standing up a full dispatcher.
 */
export function unwrapOperationResult(result: OperationResult): unknown {
	switch (result.status) {
		case "ok":
			return result.result
		case "cancelled":
			throw new JobCancelledError(undefined, { jobId: result.jobId })
		case "failed":
			// A typed executor failure crosses the boundary as { error, code };
			// re-materialize the WalletError so the wallet-sdk error envelope's
			// instanceof discrimination works — throwing a bare Error here is
			// exactly what made the envelope's typed branches dead code.
			if (result.code) throw walletErrorFromPayload({ code: result.code, message: result.error })
			throw new Error(result.error)
		case "skipped":
			throw new Error("Operation was skipped")
	}
}

/** Operation kinds whose wallet-sdk `opts.from` names the account to act as.
 *  `aztec_executeUtility` is deliberately absent: its account is `opts.scopes`,
 *  and `aztec_createAuthWit` resolves `args[0]` in its own handler. */
const FROM_ADDRESSED_KINDS: ReadonlySet<Operation["kind"]> = new Set(["aztec_simulateTx", "aztec_profileTx"])

// `METHOD_TO_KIND`, `NETWORK_ONLY_KINDS`, and `ACCOUNT_KINDS` are DERIVED from
// the method-descriptors registry (the single source of truth) and imported at
// the top of this file. sendTx / registerToken / grantPublicAuthwit are handled
// directly in dispatch() via DappInteractionService (popup); they carry no
// METHOD_TO_KIND entry (routing: "handler"). simulate_views and
// get_complete_address are fully retired (no descriptor → dispatch rejects them);
// the batching logic that lived behind `simulate_views` now lives in
// extension/.../execution/helpers/batched-view-simulation.ts.

/**
 * Structural arg-shape guard for authorization-sensitive dApp methods, run before
 * capability/scope enforcement so the scope checkers + handlers dereference validated
 * shapes rather than raw `unknown`. Deliberately dependency-free — wallet-bridge is
 * transport-shaped and does NOT import `WalletSchema`; it validates only the
 * authorization-relevant fields the scope/handler layer uses. Full Aztec-object parsing
 * stays downstream (execution-layer Zod). Residual: this is not a complete WalletSchema parse;
 * grantPublicAuthwit/registerToken rely on their handlers' own (String-coercion-tolerant) checks.
 */
function assertAuthRelevantArgShape(methodName: string, args: unknown[]): void {
	const bad = (m: string): never => {
		throw new Error(`Malformed ${methodName} request: ${m}`)
	}
	const assertCall = (c: unknown, where: string) => {
		if (!isObjectLike(c) || c.to === undefined || typeof c.name !== "string") {
			bad(`${where} must have \`to\` and a string \`name\``)
		}
	}
	const assertExecCalls = (exec: unknown) => {
		if (!isObjectLike(exec)) bad("exec payload must be an object")
		const calls = (exec as Record<string, unknown>).calls
		if (!Array.isArray(calls)) bad("exec.calls must be an array")
		for (const c of calls as unknown[]) assertCall(c, "each call")
	}

	switch (methodName) {
		case "sendTx":
		case "profileTx":
			// simulateTx is intentionally NOT guarded here: its exec validation is owned by
			// `checkSimulationTransactions` (optional-chains `exec?.calls`, requires
			// an array, coerces `to`/tolerates missing `name`) plus the downstream
			// execution-layer Zod — so a dispatcher-level shape guard is redundant and
			// would preempt the capability error that path pins.
			assertExecCalls(args[0])
			break
		case "executeUtility":
			assertCall(args[0], "call")
			break
		case "createAuthWit":
			// args[0] = from; args[1]'s CallIntent/IntentInnerHash shape is enforced by
			// checkCreateAuthWit (structured-intent requirement + raw-Fr reject).
			if (args[0] === undefined || args[0] === null) bad("`from` (args[0]) is required")
			break
		case "registerToken":
			if (args[0] === undefined || args[0] === null || args[1] === undefined || args[1] === null) {
				bad("both positional arguments are required")
			}
			break
	}
}

export class WalletSdkDispatcher {
	constructor(
		private readonly networkService: INetworkReader,
		private readonly accountService: IAccountReader & IAccountProvisioner,
		private readonly executionService: IExecutionRunner,
		private readonly dappInteractionService: IDappInteractionRunner,
		private readonly dappSessionService: IDappSessionWriter,
		private readonly logger: ILogger,
		private readonly tokenRegistryReader?: ITokenRegistryReader,
	) {}

	/**
	 * Dispatch a wallet-sdk method call to the execution layer.
	 *
	 * @param methodName - The wallet method name from `WalletMessage.type`
	 *   (e.g. "sendTx", "registerToken", "getCompleteAddress")
	 * @param args - The method arguments from `WalletMessage.args`
	 * @param ctx - Session context with chainId, profileId, origin, sessionId
	 * @returns The result value from the first (and only) operation
	 * @throws If the method is unsupported, the operation fails, or session context is invalid
	 */
	async dispatch(methodName: string, args: unknown[], ctx: SessionContext, hooks?: DispatchHooks): Promise<unknown> {
		// The dApp session is read ONCE here and threaded through every internal call, so every
		// check one message runs, the consent and the scopes included, sees the same row.
		// Anchored to ctx.profileId (the session's establishment-stamped
		// profile, guard-verified upstream): a profile switch landing mid-await
		// must not let this lookup resolve the NEW profile's row.
		const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(ctx.origin, String(ctx.chainId), ctx.profileId)
		const { method, grants } = this.enforceMethodAndScope(methodName, args, ctx, dappSession)

		// Methods that don't go through ExecutionService return the handler's
		// own promise, un-awaited here (rejection timing unchanged).
		const routed = this.routeHandlerMethod(method, args, ctx, dappSession, grants, hooks)
		if (routed !== undefined) return routed

		const kind = METHOD_TO_KIND[method]
		if (!kind) {
			throw new Error(`Unsupported wallet method: ${method}`)
		}

		const operation = await this.buildOperation(kind, args, ctx, dappSession)
		const origin: LocalTxOrigin = { type: OriginType.DAPP, name: ctx.origin }

		const results = await this.executionService.executeOperations([operation], origin)
		return unwrapOperationResult(results[0])
	}

	/** The synchronous guard ladder every dispatch runs after the session read —
	 *  known method → arg schema → auth-relevant arg shape → capability → scope.
	 *  Every throw keeps its exact message/class (dApp-visible contract). */
	private enforceMethodAndScope(
		methodName: string,
		args: unknown[],
		ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
	): { method: MethodName; grants: GrantedCapabilityRecord[] } {
		// Resolve the method's descriptor up front. A method that reaches dispatch()
		// without a registry row is unsupported (retired, or never-supported) —
		// reject it before any enforcement/routing. This is the RUNTIME half of the
		// silent-omission guard (the build-time exhaustiveness test is the other
		// half): "supported but missing metadata" is impossible in both. Preserves
		// the historical "Unsupported wallet method" string (pinned by the
		// retired-method guards in dispatcher.test.ts).
		// `Object.hasOwn`, not a truthy index, so prototype names (`toString`,
		// `constructor`, …) are rejected here rather than slipping into capability
		// handling and failing with a misleading CapabilityNotGrantedError.
		// The guard lives in `assertKnownMethod` (the single typed choke point);
		// on return `methodName` is narrowed to `MethodName`. Behavior is identical
		// to the former inline `Object.hasOwn` check (same throw string).
		assertKnownMethod(methodName)

		// Arg-shape guard: a pure pass/fail predicate over the ORIGINAL
		// args — runs BEFORE capability/scope enforcement and before any handler
		// destructuring, and never replaces the array, so scope checkers and
		// handlers keep seeing the exact wire values. Batch legs re-enter
		// dispatch() and hit their own method's guard here. Methods without an
		// argSchema keep their historical arg tolerance untouched.
		const argSchema = METHOD_REGISTRY[methodName].argSchema
		if (argSchema && !argSchema(args)) {
			throw new Error(`Invalid arguments for wallet method: ${methodName}`)
		}

		// Must run before any capability or scope logic dereferences the args.
		assertAuthRelevantArgShape(methodName, args)

		// Enforce capability grants (type-level) then scope (per-operation +
		// per-account allow-list).
		const grants = this.enforceCapability(methodName, ctx, dappSession)
		if (grants.length) {
			// enforceScopeWithSession includes account-scope-array validation. Build the
			// approved-accounts set from the session.
			// If the session is missing (shouldn't happen when grants.length>0
			// since enforceCapability would have returned []), fall back to
			// the plain enforceScope to avoid throwing on the wrong thing.
			if (dappSession) {
				enforceScopeWithSession(methodName, args, grants, sessionAccountsOf(dappSession))
			} else {
				enforceScope(methodName, args, grants)
			}
		}
		return { method: methodName, grants }
	}

	/** Routes the `via: "handler"` methods — returning the handler's EXACT promise
	 *  (never awaited here, so rejection timing is the handler's) — or `undefined`
	 *  for methods that take the generic build-and-execute path. */
	private routeHandlerMethod(
		methodName: MethodName,
		args: unknown[],
		ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
		grants: GrantedCapabilityRecord[],
		hooks: DispatchHooks | undefined,
	): Promise<unknown> | undefined {
		if (methodName === "requestCapabilities") {
			return this.handleRequestCapabilities(args[0] as CapabilityManifest, ctx, dappSession)
		}
		if (methodName === "getAccounts") {
			return this.handleGetAccounts(ctx, dappSession)
		}
		if (methodName === "getWalletFeatures") {
			return this.handleGetWalletFeatures()
		}
		if (methodName === "isTokenRegistered") {
			// A wallet-local registry read: no prompt, no execution op. Scope enforcement above
			// already required a contracts grant covering args[0].
			if (!this.tokenRegistryReader) throw new Error("isTokenRegistered is not available in this wallet build")
			return this.tokenRegistryReader.isTokenRegistered(String(args[0]), ctx.profileId, ctx.chainId)
		}
		if (methodName === "batch") {
			// CRITICAL: do NOT forward `hooks` into batch legs. handleBatch
			// recurses into dispatch() per-leg; forwarding hooks would let an
			// inner sendTx leg's `onExecutionEnqueued` release the top-level
			// FIFO baton before the batch finishes, breaking the batch's
			// sequential-completion contract.
			//
			// Note: batch legs re-enter dispatch(), which re-captures the
			// session — that's intentional. Each leg is a separate dispatch;
			// the consolidation is per-dispatch, not per-batch.
			return this.handleBatch(args[0] as Array<{ name: string; args: unknown[] }>, ctx)
		}

		// sendTx and registerToken both go through DappInteractionService for the
		// confirmation popup. sendTx also drives fee selection; registerToken pre-fetches
		// token metadata so the user sees name + symbol + decimals before approving.
		if (methodName === "sendTx") {
			return this.handleSendTx(args, ctx, dappSession, hooks)
		}
		if (methodName === "registerToken") {
			return this.handleRegisterToken(args, ctx, dappSession)
		}
		if (methodName === "grantPublicAuthwit") {
			return this.handleGrantPublicAuthwit(args, ctx, dappSession)
		}
		if (methodName === "createAuthWit") {
			return this.handleCreateAuthWit(args, ctx, dappSession, grants)
		}
		return undefined
	}

	private logDebug(message: string): void {
		this.logger.log("wallet-sdk", LogLevel.Debug, message)
	}

	private logWarn(message: string): void {
		this.logger.log("wallet-sdk", LogLevel.Warn, message)
	}

	/** `dappSession` is captured at dispatch entry and never re-looked-up here. */
	private requireSession(dappSession: IDappSessionRef | undefined, ctx: SessionContext): asserts dappSession is IDappSessionRef {
		if (!dappSession) throw new Error(`No dApp session found for origin ${ctx.origin}`)
	}

	/** The static feature list: no session data, no prompt. */
	private async handleGetWalletFeatures(): Promise<readonly string[]> {
		return WALLET_FEATURES
	}

	/**
	 * Return accounts for the current session's profile and chain.
	 * Scoped to session accounts only and uses per-app aliases.
	 * WalletSchema expects: Array<{ alias: string, item: AztecAddress }>
	 *
	 * Contract rows:
	 *  - Session not found → throws plain "No dApp session found" Error (unchanged
	 *    so dApps relying on the session-expired diagnostic see it intact).
	 *  - Session has ≥1 account → fast path, returns them.
	 *  - Session has 0 accounts + accounts grant exists (desync) → returns [] + warn
	 *    so the engineer sees the bad write but the dApp doesn't loop.
	 *  - Session has 0 accounts + NO grant → throws `CapabilityNotGrantedError`
	 *    (EIP-1193 4100). The dApp's existing `try { getAccounts } catch { requestCapabilities }`
	 *    fallback catches it and sends the full manifest. See wallet-bridge README
	 *    for the dApp-side parse recipe.
	 */
	private async handleGetAccounts(ctx: SessionContext, dappSession: IDappSessionRef | undefined): Promise<unknown> {
		this.requireSession(dappSession, ctx)

		// Fast path.
		if (dappSession.accounts && dappSession.accounts.length > 0) {
			return this.formatSessionAccounts(dappSession, ctx)
		}

		// Defensive: grant exists but accounts list is empty. Don't throw 4100
		// (the dApp may interpret that as "needs requestCapabilities" and loop);
		// return [] and warn so an engineer notices the bad write.
		const grants = dappSession.capabilityGrants ?? []
		const hasAccountsGrant = grants.some((g) => g.capability.type === "accounts")
		if (hasAccountsGrant) {
			this.logWarn(`Desync: accounts grant exists but session.accounts is empty for session ${describeExternalId(ctx.sessionId)}`)
			return []
		}

		// Pre-grant: throw structured 4100 so the dApp's fallback fires. Log level
		// is Debug because a misbehaving dApp may re-fire getAccounts() per render.
		this.logDebug(`getAccounts pre-grant from ${ctx.origin} — throwing CAPABILITY_NOT_GRANTED to nudge requestCapabilities()`)
		throw new CapabilityNotGrantedError("accounts")
	}

	/**
	 * Project a session's account list into the `Array<{ alias, item }>` shape
	 * WalletSchema expects. Extracted so the fast path in `handleGetAccounts`
	 * and the granted-accounts emission in `enrichGrantedCapabilities` use the
	 * same projection — format parity is pinned by the dispatcher unit tests.
	 */
	private async formatSessionAccounts(dappSession: IDappSessionRef, ctx: SessionContext): Promise<unknown> {
		const network = await this.resolveNetwork(ctx)
		const allAccounts = await this.accountService.getAccounts(ctx.profileId, network.chainId)
		const sessionAccountAddresses = this.getSessionAccountAddresses(dappSession, ctx.chainId)
		return this.projectSessionAccounts(allAccounts, sessionAccountAddresses, ctx.chainId, dappSession.accountAliases)
	}

	/**
	 * The drift-prone `{ alias, item }` projection shared by `formatSessionAccounts`
	 * and `enrichGrantedCapabilities`: filter to session members, CAIP-key the alias
	 * lookup, fall back to the account name then "". Callers own their own
	 * network/account resolution so each keeps its exact control flow — the grant
	 * path resolves unconditionally, BEFORE its `canGet` gate, and must keep doing so.
	 */
	private projectSessionAccounts<T extends { address: string; name?: string }>(
		allAccounts: readonly T[],
		sessionAddresses: Set<string>,
		chainId: number,
		aliases: Record<string, string> | undefined,
	): Array<{ alias: string; item: string }> {
		return allAccounts
			.filter((acc) => sessionAddresses.has(acc.address))
			.map((acc) => {
				const caip = formatCaipAccount(chainId, acc.address)
				const alias = aliases?.[caip] ?? acc.name ?? ""
				return { alias, item: acc.address }
			})
	}

	/**
	 * Sequential batch dispatch. The first per-leg failure aborts and propagates;
	 * subsequent legs never run.
	 *
	 * The wallet-sdk batch return type is a closed `discriminatedUnion("name", …)`
	 * over per-method return schemas — no error variant, no opt-out — so any
	 * substituted "empty" leg Zod-fails on the dApp side. The dApp's
	 * `handleEncryptedResponse` rejects on the error envelope before Zod runs, so
	 * throwing is the only contract-compatible failure signal.
	 */
	private async handleBatch(methods: Array<{ name: string; args: unknown[] }>, ctx: SessionContext): Promise<unknown> {
		// Refuse legs whose semantics rely on a confirmation popup. Upstream
		// `BatchedMethodSchema` is built from the canonical `WalletMethodSchemas`
		// (not from runtime-patched `WalletSchema`), so a stock SDK already
		// Zod-blocks these on the dApp side. But a raw protocol client could
		// bypass the SDK and send the leg directly; we close that hole here
		// so the README's "not in batch" contract is enforced server-side.
		for (const method of methods) {
			if (BATCH_REFUSED_METHODS.has(method.name)) {
				throw new Error(`Method "${method.name}" cannot be used inside batch — it requires a confirmation popup`)
			}
		}

		const results: Array<{ name: string; result: unknown }> = []
		for (const method of methods) {
			const result = await this.dispatch(method.name, method.args, ctx)
			results.push({ name: method.name, result })
		}
		return results
	}

	/**
	 * Handle sendTx by routing through DappInteractionService.
	 *
	 * Unlike other methods that go directly to ExecutionService, sendTx needs
	 * the confirmation popup for fee selection. DappInteractionService.execute()
	 * validates the session, checks if confirmation is needed, and opens the
	 * popup for user approval + fee method selection.
	 */
	private async handleSendTx(
		args: unknown[],
		ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
		hooks?: DispatchHooks,
	): Promise<unknown> {
		const rawOpts = (args[1] as Record<string, unknown>) ?? {}
		const isNoFrom = isNoFromRequest(rawOpts.from)
		// An explicit `from` (a real address — not the NO_FROM sentinel, not omitted) names
		// the account the dApp wants to send from. Resolve to THAT account (validated against
		// the session) instead of defaulting to the first session account, which silently
		// ignored a multi-account dApp's choice and could send from the wrong account.
		const requestedFrom = requestedSenderOf(rawOpts)
		const [_network, account] = await this.resolveNetworkAndAccount(ctx, dappSession, requestedFrom)
		const caipAccount = formatCaipAccount(ctx.chainId, account.address)

		this.requireSession(dappSession, ctx)

		const opts = isNoFrom ? rawOpts : { ...rawOpts, from: account.address }

		const sendOp: AztecSendTxRequest = {
			kind: "aztec_sendTx" as const,
			account: caipAccount,
			exec: args[0] as AztecSendTxRequest["exec"],
			opts: opts as AztecSendTxRequest["opts"],
			...(isNoFrom ? { executionMode: "default_entrypoint" as const } : {}),
		}

		const results: ExecutionResult = await this.dappInteractionService.execute(
			{
				sessionId: dappSession.id,
				operations: [sendOp],
			},
			// Arg 2 is the existing cancellationToken slot — leave undefined when
			// hooks are the only thing we're forwarding. Arg 3 is the hooks bag
			// (see services-contract.ts:IDappInteractionRunner). `originKey` is
			// ALWAYS set from ctx.origin (not gated on `hooks`) so the per-origin
			// backpressure cap applies to every dApp sendTx, even ones that arrive
			// without the FIFO-baton hooks.
			undefined,
			{ onExecutionEnqueued: hooks?.onExecutionEnqueued, queuedJournalId: hooks?.queuedJournalId, originKey: ctx.origin },
		)

		return unwrapOperationResult(results[0])
	}

	/**
	 * Handle createAuthWit: resolve the signer from args[0] (not the session default), then
	 * route. A CallIntent covered by a granted tx/sim scope signs silently only while the app's
	 * authorizations consent is effective; every other intent, and any IntentInnerHash (whose
	 * inner hash is fully attacker-chosen), opens the confirmation popup. No sendTx FIFO hooks:
	 * the background's non-send safety-net releases the baton.
	 */
	private async handleCreateAuthWit(
		args: unknown[],
		ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
		grants: GrantedCapabilityRecord[],
	): Promise<unknown> {
		this.requireSession(dappSession, ctx)
		const requestedFrom = String(args[0])
		const [network, account] = await this.resolveNetworkAndAccount(ctx, dappSession, requestedFrom)
		const messageHashOrIntent = args[1] as AztecCreateAuthWitOperation["messageHashOrIntent"]

		// Both read the dispatch-entry snapshot: a Settings change applies from the next message, so
		// a call already past dispatch entry keeps the consent it entered with.
		if (
			isCreateAuthWitCoveredByTxOrSimulationScope(messageHashOrIntent, grants) &&
			authorizationsEffective(
				dappSession.authorizationsWithoutAsking,
				grants.map((g) => g.capability),
			)
		) {
			// A silently-signed authwit runs under the session's admission fence, like a send:
			// createAuthWit derives key material for the resolved account, so a lock, switch,
			// re-unlock or same-id re-import parked before the sign must fail closed. The wire
			// handler always sets ctx.fence; a missing or foreign-profile fence is refused here,
			// and the runner rechecks it (aztec_createAuthWit is a fenced kind).
			if (!ctx.fence || ctx.fence.profileId !== ctx.profileId) {
				throw new Error("createAuthWit requires the fence of the session that authorized it")
			}
			const operation: AztecCreateAuthWitOperation = {
				kind: "aztec_createAuthWit",
				networkId: network.id,
				accountAddress: account.address,
				messageHashOrIntent,
			}
			const origin: LocalTxOrigin = { type: OriginType.DAPP, name: ctx.origin }
			const results = await this.executionService.executeOperations([operation], origin, undefined, undefined, undefined, ctx.fence)
			return unwrapOperationResult(results[0])
		}

		const authwitReq: AztecCreateAuthWitRequest = {
			kind: "aztec_createAuthWit",
			account: formatCaipAccount(ctx.chainId, account.address),
			messageHashOrIntent,
		}
		const results = await this.dappInteractionService.execute({
			sessionId: dappSession.id,
			operations: [authwitReq],
		})
		return unwrapOperationResult(results[0])
	}

	/**
	 * Handle registerToken by routing through DappInteractionService.
	 *
	 * Unlike straight-to-execution methods, registerToken needs the confirmation
	 * popup so the user can see the resolved token name + symbol + decimals
	 * (pre-fetched by the popup via parseTokenInterface) before approving. The
	 * popup gate is the only per-call defense against silent token-list pollution
	 * once the `accounts` capability has been granted.
	 *
	 * The dApp-supplied account (args[0]) is honored: it's validated against the
	 * session's authorized accounts and forwarded to the popup + execution
	 * service + journal. Storage scoping is profile+chain (the token shows up
	 * for every account on this chain), but the account argument still carries
	 * audit value — the journal records "which account did the dApp ask on
	 * behalf of." Without validation, a dApp could pass any account address
	 * (including ones not in their session); with validation, the wallet
	 * refuses with a clear error instead of silently substituting a different
	 * authorized account.
	 */
	private async handleRegisterToken(args: unknown[], ctx: SessionContext, dappSession: IDappSessionRef | undefined): Promise<unknown> {
		this.requireSession(dappSession, ctx)

		// Resolve the dApp-supplied account through the SAME session-authorization
		// helper sendTx/createAuthWit use — one implementation of "which account
		// may this dApp act as", with its distinct no-accounts / empty-session /
		// not-authorized failure messages.
		const requestedAccount = String(args[0])
		const [, account] = await this.resolveNetworkAndAccount(ctx, dappSession, requestedAccount)
		const caipAccount = formatCaipAccount(ctx.chainId, account.address)

		const tokenAddress = String(args[1])

		const registerOp: RegisterTokenRequest = {
			kind: "register_token" as const,
			account: caipAccount,
			address: tokenAddress,
		}

		const results: ExecutionResult = await this.dappInteractionService.execute({
			sessionId: dappSession.id,
			operations: [registerOp],
		})

		return unwrapOperationResult(results[0])
	}

	/** Nulo-custom `grantPublicAuthwit`: writes a public authwit for
	 *  `method@contract` (caller = the authorized spender) into the on-chain
	 *  AuthRegistry via a `send_transaction` carrying a single
	 *  `add_public_authwit` action. Routed through DappInteractionService so
	 *  the user approves (and selects the fee for) the registry write like
	 *  any other dApp transaction; `buildStandard` computes the message
	 *  hash, records it via `trackAuthwit` (settings revoke UI), and injects
	 *  the `set_authorized` call. Returns the tx hash. */
	private async handleGrantPublicAuthwit(
		args: unknown[],
		ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
	): Promise<unknown> {
		this.requireSession(dappSession, ctx)

		// Same shared session-authorization resolve as registerToken/sendTx.
		const requestedAccount = String(args[0])
		const [, account] = await this.resolveNetworkAndAccount(ctx, dappSession, requestedAccount)
		const caipAccount = formatCaipAccount(ctx.chainId, account.address)

		const content = args[1] as { caller: string; contract: string; method: string; args: unknown[] }
		const grantOp: SendTransactionRequest = {
			kind: "send_transaction" as const,
			account: caipAccount,
			actions: [
				{
					kind: "add_public_authwit" as const,
					content: {
						kind: "call" as const,
						caller: content.caller,
						contract: content.contract,
						method: content.method,
						args: content.args,
					},
				},
			],
		}

		const results: ExecutionResult = await this.dappInteractionService.execute(
			{
				sessionId: dappSession.id,
				operations: [grantOp],
			},
			// `originKey` applies the per-origin backpressure cap to grants too,
			// matching sendTx; without it the execution lane buckets the grant
			// under "__no_origin__" and loses per-origin fairness.
			undefined,
			{ originKey: ctx.origin },
		)

		return unwrapOperationResult(results[0])
	}

	/**
	 * Handle requestCapabilities with 3-phase approach:
	 * 1. Check stored grants → compute delta (new/changed types)
	 *    - A previously rejected type rejoins the delta unless the held grant covers it
	 * 2. Early return if delta is empty (all already granted)
	 * 3. Show popup for delta → user approves → merge and store
	 *    - Track rejected types for future re-request detection
	 */
	private async handleRequestCapabilities(
		manifest: CapabilityManifest,
		ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
	): Promise<unknown> {
		this.requireSession(dappSession, ctx)

		const requestedCapabilities = projectRequestedCapabilities(manifest?.capabilities ?? [])
		if (requestedCapabilities.length === 0) {
			return {
				version: "1.0" as const,
				granted: [],
				wallet: { name: "Nulo", version: __VERSION__ },
			}
		}

		// Phase 1: existing grants/rejections → the delta to negotiate.
		const negotiated = requestedCapabilities.filter((cap) => !grantsNothing(cap))
		const plan = computeCapabilityDelta(negotiated, dappSession)
		const requestedAccounts = requestedCapabilities.find((cap) => cap.type === "accounts")
		if (requestedAccounts !== undefined && grantsOfType(plan.existingGrants, "accounts").length > 0) {
			await this.applyAccountsWidening(plan, requestedAccounts as unknown as AccountsCapability, ctx, dappSession)
		}

		// Phase 2: Early return if all types already granted and none re-requested
		if (plan.delta.length === 0) {
			const granted = await this.enrichGrantedCapabilities(
				plan.existingGrants.map((g) => g.capability),
				requestedCapabilities,
				ctx,
				dappSession,
			)
			return {
				version: "1.0" as const,
				granted,
				wallet: { name: "Nulo", version: __VERSION__ },
			}
		}

		const result = await this.askCapabilities(plan, { ...manifest, capabilities: negotiated }, ctx, dappSession)

		// ONE atomic decision: accounts + aliases + grants + rejections merged
		// against the LATEST row under a single lock — no interleaving between the
		// formerly-separate writes, and a concurrent revoke fails cleanly (no
		// half-written row) instead of collapsing to a bare "Invalid id". Different-type
		// concurrent approvals both survive (the merge reads the latest row).
		const updatedSession = await this.dappSessionService.applyCapabilityDecision(dappSession.id, mergeGrantsAndRejections(result, plan))

		const granted = await this.enrichGrantedCapabilities(
			(updatedSession.capabilityGrants ?? []).map((g) => g.capability),
			requestedCapabilities,
			ctx,
			updatedSession,
		)

		return {
			version: "1.0" as const,
			granted,
			wallet: { name: "Nulo", version: __VERSION__ },
		}
	}

	/** Opens the capability window for the plan's delta; a close or reject records every delta type
	 *  as rejected. */
	private async askCapabilities(
		plan: CapabilityPlan,
		manifest: CapabilityManifest,
		ctx: SessionContext,
		dappSession: IDappSessionRef,
	): Promise<CapabilityResult> {
		const availableAccounts = plan.delta.some((cap) => cap.type === "accounts")
			? await this.loadAvailableAccountsForPopup(ctx)
			: undefined
		plan.availableAccounts = availableAccounts
		const consent = readConsent(dappSession.authorizationsWithoutAsking)
		const heldAccounts = await this.heldAccountsOf(dappSession, ctx)
		try {
			return await this.dappInteractionService.requestCapabilities({
				sessionId: dappSession.id,
				manifest,
				delta: plan.delta,
				existingGrants: plan.existingCaps,
				heldGrants: plan.existingGrants.map((g) => g.capability),
				heldAccounts,
				...(consent !== undefined ? { authorizationsWithoutAsking: consent } : {}),
				reRequested: reRequestedTypes(plan),
				availableAccounts,
				grantedAccounts: plan.accountsWidening?.granted,
				accountsMembershipOnly: plan.accountsWidening?.membershipOnly,
			})
		} catch (err) {
			await this.persistRejectionOnPopupFailure(dappSession.id, plan.delta)
			throw err
		}
	}

	/** A session that already holds accounts: the picker locks the held rows, and a membership-only
	 *  request (equal flags) only adds — the stored grant is never replaced; a flag change still
	 *  takes the replacement path. Chain-scoped — the session stores CAIP-10 entries and a profile
	 *  can hold accounts on other chains; hidden accounts are not offered (`getAccounts` lists
	 *  visible ones). */
	private async applyAccountsWidening(
		plan: CapabilityPlan,
		requested: AccountsCapability,
		ctx: SessionContext,
		dappSession: IDappSessionRef,
	): Promise<void> {
		const network = await this.resolveNetwork(ctx)
		const profileAccounts = await this.accountService.getAccounts(ctx.profileId, network.chainId)
		const held = this.getSessionAccountAddresses(dappSession, network.chainId)
		planAccountsWidening(
			plan,
			requested,
			held,
			ungrantedAccounts(
				profileAccounts.map((acc) => acc.address),
				held,
			),
		)
	}

	/** The session's members on its chain, named only by the wallet's own account records: never
	 *  by a per-app alias or anything the request carries. A member the wallet no longer lists stays,
	 *  unnamed, so the window never counts two members as one. */
	private async heldAccountsOf(dappSession: IDappSessionRef, ctx: SessionContext): Promise<Array<{ address: string; name?: string }>> {
		const members = new Map([...this.getSessionAccountAddresses(dappSession, ctx.chainId)].map((a) => [a.toLowerCase(), a]))
		if (members.size === 0) return []
		const named = (await this.accountService.getAccounts(ctx.profileId, ctx.chainId))
			.filter((acc) => members.has(acc.address.toLowerCase()))
			.map((acc) => ({ address: acc.address, ...(acc.name ? { name: acc.name } : {}) }))
		const namedKeys = new Set(named.map((acc) => acc.address.toLowerCase()))
		const unnamed = [...members].filter(([key]) => !namedKeys.has(key)).map(([, address]) => ({ address }))
		return [...named, ...unnamed]
	}

	/** The dApp's chain may be one the user has never activated, so its default account may not
	 *  exist yet; provisioning it here is what lets the picker list it instead of blocking. The
	 *  re-read (not the provisioner's result) is what the popup sees — the network switch's pattern. */
	private async loadAvailableAccountsForPopup(ctx: SessionContext): Promise<Array<{ address: string; name: string; chainId: number }>> {
		const network = await this.resolveNetwork(ctx)
		let accounts = await this.accountService.getAccounts(ctx.profileId, network.chainId)
		if (accounts.length === 0) {
			await this.accountService.provisionDefaultAccount(ctx.profileId, network.chainId)
			accounts = await this.accountService.getAccounts(ctx.profileId, network.chainId)
		}
		return accounts.map((acc) => ({
			address: acc.address,
			name: acc.name,
			chainId: acc.chainId,
		}))
	}

	/** On popup reject/close, persist rejection for all delta items so the next
	 *  request renders the "previously denied" badge. One atomic decision,
	 *  and if the row was revoked meanwhile just surface the popup error. */
	private async persistRejectionOnPopupFailure(sessionId: string, delta: Record<string, unknown>[]): Promise<void> {
		try {
			await this.dappSessionService.applyCapabilityDecision(sessionId, {
				addAccounts: [],
				aliasPatch: {},
				grantRecords: [],
				replaceTypes: [],
				approvedTypes: [],
				rejectedTypes: delta.map((cap) => cap.type as string),
			})
		} catch {
			// Session already revoked — nothing to persist.
		}
	}

	/**
	 * Enrich granted capabilities with runtime data.
	 * For "accounts" type: inject the actual account list with per-app aliases.
	 */
	private async enrichGrantedCapabilities(
		grantedCaps: unknown[],
		requestedCaps: Record<string, unknown>[],
		ctx: SessionContext,
		dappSession: IDappSessionRef,
	): Promise<Record<string, unknown>[]> {
		const result: Record<string, unknown>[] = []
		// The answer follows the request's order, and every value in it is what the wallet stores and
		// enforces: the person may have granted less than was asked, or already hold more.
		const grantedTypes = new Set(grantedCaps.map((c) => (c as Record<string, unknown>).type))

		for (const cap of requestedCaps) {
			if (!grantedTypes.has(cap.type) && !grantsNothing(cap)) continue

			if (cap.type === "accounts") {
				const network = await this.resolveNetwork(ctx)
				const allAccounts = await this.accountService.getAccounts(ctx.profileId, network.chainId)
				const sessionAddresses = this.getSessionAccountAddresses(dappSession, ctx.chainId)

				// Read canGet / canCreateAuthWit from the STORED grant, not the
				// requested cap. The wire response must reflect what was actually
				// granted — otherwise a dApp that requested `canCreateAuthWit:true`
				// would see `true` in the response even when storage has `false`,
				// then scope-enforcement would later refuse the createAuthWit call.
				const storedAccounts = grantedCaps.find((g) => (g as Record<string, unknown>).type === "accounts") as
					| AccountsCapability
					| undefined

				// Return account identities only when the stored grant permits `canGet`,
				// matching `getAccounts`.
				const canGet = storedAccounts?.canGet === true
				const grantedAccounts = canGet
					? this.projectSessionAccounts(allAccounts, sessionAddresses, ctx.chainId, dappSession.accountAliases)
					: []

				result.push({
					...cap,
					canGet,
					canCreateAuthWit: storedAccounts?.canCreateAuthWit ?? false,
					accounts: grantedAccounts,
				})
			} else if (cap.type === "data") {
				result.push(dataAnswer(grantedCaps))
			} else {
				result.push(storedGrantAnswer(grantedCaps, cap))
			}
		}
		return result
	}

	/**
	 * Enforce capability grants before dispatching a method call.
	 *
	 * - Exempt methods (getChainInfo, requestCapabilities, batch) skip enforcement.
	 *   NOTE: getAccounts is NOT exempt: it requires accounts.canGet=true.
	 * - The method's required capability type must be in the session's grants.
	 * - Sessions without grants (new or pre-migration) are treated as having no grants,
	 *   so non-exempt methods are blocked until requestCapabilities() is called.
	 */
	private enforceCapability(
		methodName: string,
		_ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
	): GrantedCapabilityRecord[] {
		if (isCapabilityExempt(methodName)) return []

		const requiredType = getRequiredCapability(methodName)
		if (!requiredType) return [] // Unknown method — let dispatch() handle it

		if (!dappSession) {
			// Fail closed when the stored DappSession is missing: returning [] here would
			// fall through to the sink with no grants, and network-only methods
			// (getPrivateEvents, getAddressBook, registerSender, registerContract,
			// getContractMetadata, getContractClassMetadata) would run unchecked after the
			// user disconnects the dApp in Settings or the session expires.
			//
			// Throwing CapabilityNotGrantedError gives the dApp a structured
			// signal to re-request capabilities (the same path used for
			// pre-grant calls), and is paired with the live-transport teardown
			// in wallet-sdk/background.ts that prevents the channel from
			// staying useful after revocation.
			this.logDebug(`${methodName} from ${_ctx.origin} — no DappSession found; throwing CAPABILITY_NOT_GRANTED (F-006 fail-closed)`)
			throw new CapabilityNotGrantedError(requiredType)
		}

		const grants = dappSession.capabilityGrants ?? []
		const grantedTypes = new Set(grants.map((g) => g.capability.type))
		if (!grantedTypes.has(requiredType)) {
			// Debug (not Info): dApps may re-fire methods per render, so the
			// pre-grant throw must not spam the log. The existing log-noise
			// pattern at handleGetAccounts is preserved here for any method
			// reaching enforceCapability without the required grant type.
			this.logDebug(`${methodName} from ${_ctx.origin} — throwing CAPABILITY_NOT_GRANTED to nudge requestCapabilities()`)
			// CapabilityNotGrantedError is the public contract — dApps substring-
			// match on the error code and message. getAccounts reaches this path too, since
			// it is not exempt, and a test pins its CapabilityNotGrantedError.
			throw new CapabilityNotGrantedError(requiredType)
		}
		return grants
	}

	/**
	 * Build an Operation from wallet-sdk method args and session context.
	 *
	 * The wallet-sdk sends args as positional arrays matching the WalletSchema
	 * function signatures. For Aztec.js Wallet methods, the args map directly
	 * to the operation fields. For Nulo custom methods, we unpack them
	 * according to the schema_patch.ts definitions.
	 */
	private async buildOperation(
		kind: Operation["kind"],
		args: unknown[],
		ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
	): Promise<Operation> {
		// `dappSession` is the one lookup dispatch() made at entry; a second lookup here could
		// see another session.
		if (NETWORK_ONLY_KINDS.has(kind)) {
			const network = await this.resolveNetwork(ctx)
			return this.buildNetworkOperation(kind, args, network.id)
		}

		if (ACCOUNT_KINDS.has(kind)) {
			// A simulate or profile runs as the account the dApp named, exactly as sendTx
			// does: resolving another session account misclassifies a self-paid payload as
			// externally paid, which leaves the setup phase open.
			const requestedFrom = FROM_ADDRESSED_KINDS.has(kind) ? requestedSenderOf(args[1]) : undefined
			const [network, account] = await this.resolveNetworkAndAccount(ctx, dappSession, requestedFrom)
			return this.buildAccountOperation(kind, args, network.id, account.address)
		}

		throw new Error(`Unhandled operation kind: ${kind}`)
	}

	/**
	 * Build operations that only need network context.
	 *
	 * Wallet-sdk args for these methods:
	 *   - getChainInfo(): []
	 *   - getContractClassMetadata(id): [Fr]
	 *   - getContractMetadata(address): [AztecAddress]
	 *   - getPrivateEvents(eventMetadata, eventFilter): [EventMetadataDefinition, PrivateEventFilter]
	 *   - registerSender(address, alias?): [AztecAddress, string?]
	 *   - getAddressBook(): []
	 *   - registerContract(instance, artifact?, secretKey?): [ContractInstanceWithAddress, ContractArtifact?, Fr?]
	 */
	private buildNetworkOperation(kind: Operation["kind"], args: unknown[], networkId: string): Operation {
		switch (kind) {
			case "aztec_getChainInfo":
				return { kind, networkId }
			case "aztec_getContractClassMetadata":
				return { kind, networkId, id: args[0] as AztecGetContractClassMetadataOperation["id"] }
			case "aztec_getContractMetadata":
				return { kind, networkId, address: args[0] as AztecGetContractMetadataOperation["address"] }
			case "aztec_getPrivateEvents":
				return {
					kind,
					networkId,
					eventMetadata: args[0] as AztecGetPrivateEventsOperation["eventMetadata"],
					eventFilter: args[1] as AztecGetPrivateEventsOperation["eventFilter"],
				}
			case "aztec_registerSender":
				return {
					kind,
					networkId,
					address: args[0] as AztecRegisterSenderOperation["address"],
					alias: args[1] as string | undefined,
				}
			case "aztec_getAddressBook":
				return { kind, networkId }
			case "aztec_registerContract":
				return {
					kind,
					networkId,
					instance: args[0] as AztecRegisterContractOperation["instance"],
					artifact: args[1] as AztecRegisterContractOperation["artifact"],
					secretKey: args[2] as AztecRegisterContractOperation["secretKey"],
				}
			default:
				throw new Error(`Unknown network operation: ${kind}`)
		}
	}

	/**
	 * Build operations that need account context.
	 *
	 * Wallet-sdk args for these methods:
	 *   - simulateTx(exec, opts): [ExecutionPayload, SimulateOptions]
	 *   - executeUtility(call, opts): [FunctionCall, ExecuteUtilityOptions]
	 *   - profileTx(exec, opts): [ExecutionPayload, ProfileOptions]
	 *   - createAuthWit(messageHashOrIntent): [IntentInnerHash | CallIntent]
	 *
	 * registerToken / sendTx are handled separately via handleRegisterToken /
	 * handleSendTx, which route through DappInteractionService for the popup gate.
	 */
	private buildAccountOperation(kind: Operation["kind"], args: unknown[], networkId: string, accountAddress: string): Operation {
		switch (kind) {
			case "aztec_simulateTx":
				return {
					kind,
					networkId,
					accountAddress,
					exec: args[0] as AztecSimulateTxOperation["exec"],
					opts: { ...((args[1] as Record<string, unknown>) ?? {}), from: accountAddress } as AztecSimulateTxOperation["opts"],
				}
			case "aztec_executeUtility":
				return {
					kind,
					networkId,
					accountAddress,
					call: args[0] as AztecExecuteUtilityOperation["call"],
					opts: {
						...((args[1] as Record<string, unknown>) ?? {}),
						from: accountAddress,
					} as unknown as AztecExecuteUtilityOperation["opts"],
				}
			case "aztec_profileTx":
				return {
					kind,
					networkId,
					accountAddress,
					exec: args[0] as AztecProfileTxOperation["exec"],
					opts: { ...((args[1] as Record<string, unknown>) ?? {}), from: accountAddress } as AztecProfileTxOperation["opts"],
				}
			case "aztec_createAuthWit":
				// WalletSchema: createAuthWit(from: AztecAddress, messageHashOrIntent) — args[0] is from, args[1] is the intent
				return {
					kind,
					networkId,
					accountAddress,
					messageHashOrIntent: args[1] as AztecCreateAuthWitOperation["messageHashOrIntent"],
				}
			default:
				throw new Error(`Unknown account operation: ${kind}`)
		}
	}

	/**
	 * Extract account addresses from a dApp session's CAIP accounts for the given chain.
	 */
	private getSessionAccountAddresses(dappSession: IDappSessionRef, chainId: number): Set<string> {
		const prefix = `${formatCaipChain(chainId)}:`
		return new Set(
			dappSession.accounts?.filter((caip: string) => caip.startsWith(prefix)).map((caip: string) => parseCaipAccount(caip).address) ??
				[],
		)
	}

	/**
	 * Resolve a session's chainId to a Network.
	 */
	private async resolveNetwork(ctx: SessionContext): Promise<INetworkRef> {
		// Anchored to the session's stamped profile (never the active one): a
		// profile switch landing mid-dispatch leaves the op carrying the
		// COMPOSING profile's network row, and the extension's `getNetwork`
		// ownership check then fails closed at execution instead of letting an
		// accountless mutation write into the newly active profile's world.
		const networks = await this.networkService.getNetworksRaw(ctx.profileId, ctx.chainId)
		if (networks.length === 0) {
			// Typed, so the dApp can tell "this session's chain is gone" from a wallet fault: an
			// untyped throw reaches it as the unclassified constant.
			throw new ChainNotSupportedError()
		}
		return networks[0]!
	}

	/**
	 * Resolve a session's chainId to a Network + an authorized Account.
	 *
	 * Filters accounts to those authorized in the dApp session. If the session
	 * has explicit accounts, only those are eligible. This ensures account-scoped
	 * operations (simulateTx, sendTx, etc.) use session-authorized accounts,
	 * not just the first global account.
	 */
	private async resolveNetworkAndAccount(
		ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
		requestedFrom?: string,
	): Promise<[INetworkRef, IAccountRef]> {
		const network = await this.resolveNetwork(ctx)
		const allAccounts = await this.accountService.getAccounts(ctx.profileId, network.chainId)
		if (allAccounts.length === 0) {
			throw new Error(`No accounts found for profile ${ctx.profileId} on chainId ${ctx.chainId}`)
		}

		if (dappSession?.accounts && dappSession.accounts.length > 0) {
			const sessionAddresses = this.getSessionAccountAddresses(dappSession, ctx.chainId)
			// Shared with the journal's arrival-time resolution, so the account an
			// operation is FILED under is always the account it is SENT from.
			const resolved = resolveAuthorizedSessionAccount({ walletAccounts: allAccounts, sessionAddresses, requestedFrom })
			if (resolved.ok) {
				return [network, resolved.account]
			}
			if (resolved.reason === "not-authorized") {
				throw scopeViolation("Scope violation: requested account not authorized for this dApp session")
			}
			throw new Error("No authorized accounts found for this dApp session")
		}

		// No session or no accounts on session — require account authorization
		throw new Error("No accounts authorized. The dApp must call requestCapabilities() with accounts type first.")
	}
}
