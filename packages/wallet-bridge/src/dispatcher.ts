/**
 * WalletSdkDispatcher — Central dispatch layer for wallet-sdk protocol messages.
 *
 * ## Purpose
 *
 * This module bridges the `@aztec/wallet-sdk` communication protocol with the
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
import { resolveAuthorizedSessionAccount } from "./account-resolution"
import { formatCaipAccount, formatCaipChain, parseCaipAccount, resolveNetworkByChainId } from "./caip"
import type {
	AccountsCapability,
	Capability,
	ContractsCapability,
	DataCapability,
	GrantedCapabilityRecord,
	RejectedCapabilityRecord,
	Scope,
	SimulationCapability,
	TransactionCapability,
} from "./capabilities"
import { getRequiredCapability, isCapabilityExempt } from "./capability-map"
import { METHOD_REGISTRY, METHOD_TO_KIND, NETWORK_ONLY_KINDS, ACCOUNT_KINDS, assertKnownMethod } from "./method-descriptors"
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
import { isCreateAuthWitCoveredByTxOrSimulationScope } from "./method-scope-checkers"
import type { IAccountRef, IDappSessionRef, INetworkRef } from "./session-types"
import { OriginType, type LocalTxOrigin } from "./transaction-origin"
import type { SessionContext } from "./types"
import { CapabilityNotGrantedError, JobCancelledError } from "@nulo/extension-messaging/errors"
import type { ILogger } from "@nulo/wallet-core/logger"
import { LogLevel } from "@nulo/wallet-core/logger"
import type {
	IAccountReader,
	IDappInteractionRunner,
	IDappSessionWriter,
	IExecutionRunner,
	INetworkReader,
	ITokenRegistryReader,
} from "./services-contract"

/**
 * Internal hooks bag the dispatcher accepts from its caller (the wallet-sdk
 * background message handler). NOT part of `SessionContext` — codex round-3
 * caught that putting hooks on the ctx would propagate them into recursive
 * batch-leg dispatches and break the batch's sequential-completion contract.
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
			throw new Error(result.error)
		case "skipped":
			throw new Error("Operation was skipped")
	}
}

/** Detects whether a sendTx `opts.from` value indicates NO_FROM
 *  (DefaultEntrypoint). Mirrors `execution/utils/fee-detection.ts:18`;
 *  inlined here so the dispatcher stays decoupled from extension
 *  internals. */
function isNoFromRequest(from: unknown): boolean {
	return from === "NO_FROM"
}

/** Compare two `accounts` capability shapes by the fields that affect
 *  authority. `canGet` and `canCreateAuthWit` are coerced via `Boolean(...)`
 *  so `undefined` is treated as `false` (matches the default semantics in
 *  scope-enforcement: missing flag = no permission). The `accounts` array
 *  field is dispatcher-emitted, not dApp-controlled, and is excluded from
 *  the comparison. */
/** Whether every address+flag the request needs is already covered by the UNION of stored
 *  contracts grants. NOT equality: shrinking requests must not re-prompt; growing ones must
 *  (the type-only delta silently stranded new addresses after redeploys). */
function contractsRequestCovered(existing: ContractsCapability[], requested: ContractsCapability): boolean {
	const flagCovered = (flag: "canRegister" | "canGetMetadata"): boolean => {
		if (!requested[flag]) return true
		if (requested.contracts === "*") return existing.some((e) => e[flag] && e.contracts === "*")
		return requested.contracts.every((addr) =>
			existing.some((e) => e[flag] && (e.contracts === "*" || e.contracts.some((x) => String(x) === String(addr)))),
		)
	}
	return flagCovered("canRegister") && flagCovered("canGetMetadata")
}

/** Pattern-list coverage: every requested pattern is satisfied by ONE existing scope. Coverage
 *  deliberately mirrors enforcement's shape (`checkTransactionCalls` requires a SINGLE cap to
 *  cover every call of a tx) - union-coverage here would approve requests enforcement then
 *  refuses. */
function scopeCovers(existing: Scope, requested: Scope): boolean {
	if (existing === "*") return true
	if (requested === "*") return false
	return requested.every((rp) =>
		existing.some(
			(ep) =>
				(ep.contract === "*" || String(ep.contract) === String(rp.contract)) &&
				(ep.function === "*" || ep.function === rp.function),
		),
	)
}

function transactionRequestCovered(existing: TransactionCapability[], requested: TransactionCapability): boolean {
	if (!requested.scope) return existing.length > 0
	return existing.some((e) => scopeCovers(e.scope, requested.scope))
}

/** Sub-scopes (transactions / utilities) check independently - enforcement's per-sub `caps.some`
 *  lets different caps cover different sub-scopes. */
function simulationRequestCovered(existing: SimulationCapability[], requested: SimulationCapability): boolean {
	for (const sub of ["transactions", "utilities"] as const) {
		const rs = requested[sub]?.scope
		if (!rs) continue
		if (
			!existing.some((e) => {
				const es = e[sub]?.scope
				return es !== undefined && scopeCovers(es, rs)
			})
		) {
			return false
		}
	}
	return true
}

function dataRequestCovered(existing: DataCapability[], requested: DataCapability): boolean {
	const rc = requested.privateEvents?.contracts
	if (!rc) return existing.length > 0
	if (rc === "*") return existing.some((e) => e.privateEvents?.contracts === "*")
	return rc.every((addr) =>
		existing.some((e) => {
			const list = e.privateEvents?.contracts
			return list === "*" || (Array.isArray(list) && list.some((x) => String(x) === String(addr)))
		}),
	)
}

function accountsCapsEqual(a: AccountsCapability, b: AccountsCapability): boolean {
	return Boolean(a.canGet) === Boolean(b.canGet) && Boolean(a.canCreateAuthWit) === Boolean(b.canCreateAuthWit)
}

/** The known `Capability` discriminants, as an exhaustive record so adding a
 *  `Capability` variant is a compile error until it's classified here (and in
 *  `isCapabilityCovered` below). A wire capability whose `type` is NOT in this set
 *  is an UNKNOWN-type cap: it flows through untouched to the popup, where it renders
 *  default-off — do NOT drop or coerce it (that would hide the warning path). */
const KNOWN_CAPABILITY_TYPES: Record<Capability["type"], true> = {
	accounts: true,
	contracts: true,
	contractClasses: true,
	simulation: true,
	transaction: true,
	data: true,
}

function isKnownCapabilityType(type: string): type is Capability["type"] {
	return Object.hasOwn(KNOWN_CAPABILITY_TYPES, type)
}

/** Grants of one capability type, narrowed to that variant. The single typed cast
 *  lives here instead of the `existing.capability as XCapability` casts scattered
 *  across the coverage branches. */
function grantsOfType<K extends Capability["type"]>(grants: GrantedCapabilityRecord[], type: K): Extract<Capability, { type: K }>[] {
	return grants.filter((g) => g.capability.type === type).map((g) => g.capability as Extract<Capability, { type: K }>)
}

/** Is `requested` already covered by the existing grants of its type — i.e. NO
 *  re-prompt needed? Field-aware for accounts/contracts/transaction/simulation/data;
 *  TYPE-ONLY for `contractClasses` (the field-blind coverage drift filed as the
 *  out-of-arc `wallet-sdk-capability-field-diff` finding, pinned in dispatcher.test.ts).
 *  Exhaustive over `Capability["type"]`: a new variant forces a coverage decision here
 *  rather than silently defaulting to covered (fail-open) or not (spurious re-prompt).
 *  `cap` is the discriminated union, so the branches narrow WITHOUT per-branch casts. */
function isCapabilityCovered(cap: Capability, existingGrants: GrantedCapabilityRecord[], grantedTypes: Set<string>): boolean {
	switch (cap.type) {
		case "accounts": {
			const existing = grantsOfType(existingGrants, "accounts")[0]
			return existing !== undefined && accountsCapsEqual(existing, cap)
		}
		case "contracts": {
			const existing = grantsOfType(existingGrants, "contracts")
			return existing.length > 0 && contractsRequestCovered(existing, cap)
		}
		case "transaction": {
			const existing = grantsOfType(existingGrants, "transaction")
			return existing.length > 0 && transactionRequestCovered(existing, cap)
		}
		case "simulation": {
			const existing = grantsOfType(existingGrants, "simulation")
			return existing.length > 0 && simulationRequestCovered(existing, cap)
		}
		case "data": {
			const existing = grantsOfType(existingGrants, "data")
			return existing.length > 0 && dataRequestCovered(existing, cap)
		}
		case "contractClasses":
			return grantedTypes.has("contractClasses")
	}
}

/** Shape of the capability manifest sent by the dApp via requestCapabilities(). */
type CapabilityManifest = {
	capabilities?: unknown[]
	[key: string]: unknown
}

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
 * shapes rather than raw `unknown` (F-08). Deliberately dependency-free — wallet-bridge is
 * transport-shaped and does NOT import `WalletSchema`; it validates only the
 * authorization-relevant fields the scope/handler layer uses. Full Aztec-object parsing
 * stays downstream (execution-layer Zod). Residual: this is not a complete WalletSchema parse;
 * grantPublicAuthwit/registerToken rely on their handlers' own (String-coercion-tolerant) checks.
 */
function assertAuthRelevantArgShape(methodName: string, args: unknown[]): void {
	const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null
	const bad = (m: string): never => {
		throw new Error(`Malformed ${methodName} request: ${m}`)
	}
	const assertCall = (c: unknown, where: string) => {
		if (!isObj(c) || c.to === undefined || typeof c.name !== "string") {
			bad(`${where} must have \`to\` and a string \`name\``)
		}
	}
	const assertExecCalls = (exec: unknown) => {
		if (!isObj(exec)) bad("exec payload must be an object")
		const calls = (exec as Record<string, unknown>).calls
		if (!Array.isArray(calls)) bad("exec.calls must be an array")
		for (const c of calls as unknown[]) assertCall(c, "each call")
	}

	switch (methodName) {
		case "sendTx":
		case "profileTx":
			// simulateTx is intentionally NOT guarded here: post-merge with dev's
			// arg-guard refactor, its exec validation is owned by
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
		private readonly accountService: IAccountReader,
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
		// F-006 / audit cross-cutting #1 / Phase 0.5: capture the dApp session
		// ONCE at dispatch entry and thread it through every internal call.
		// Closes the TOCTOU window where 6 separate `tryGetDappSessionByOriginAndChain`
		// calls previously gave different handlers different views of the same
		// session (e.g. if the session was deleted mid-dispatch).
		const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(ctx.origin, String(ctx.chainId))

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

		// F-08: structural arg-shape guard for authorization-sensitive methods, before any
		// capability/scope logic dereferences the args.
		assertAuthRelevantArgShape(methodName, args)

		// Enforce capability grants (type-level) then scope (per-operation +
		// per-account allow-list).
		const grants = this.enforceCapability(methodName, ctx, dappSession)
		if (grants.length) {
			// F-005: enforceScopeWithSession includes account-scope-array
			// validation. Build the approved-accounts set from the session.
			// If the session is missing (shouldn't happen when grants.length>0
			// since enforceCapability would have returned []), fall back to
			// the plain enforceScope to avoid throwing on the wrong thing.
			if (dappSession) {
				// The session stores CAIP-10 identifiers ("aztec:<chainId>:0x…") but dApps send RAW
				// hex addresses in scope arrays (the wallet-sdk serializes AztecAddress as hex), so
				// the set carries BOTH representations. Without this, every fresh session failed
				// account-scope validation deterministically; pre-CAIP sessions masked the mismatch.
				const sessionAccounts = new Set<string>()
				for (const entry of dappSession.accounts ?? []) {
					sessionAccounts.add(entry)
					try {
						sessionAccounts.add(parseCaipAccount(entry).address)
					} catch {
						// A raw (pre-CAIP) entry: keep it as-is; nothing extra to add.
					}
				}
				enforceScopeWithSession(methodName, args, grants, sessionAccounts)
			} else {
				enforceScope(methodName, args, grants)
			}
		}

		// Handle methods that don't go through ExecutionService
		if (methodName === "requestCapabilities") {
			return this.handleRequestCapabilities(args[0] as CapabilityManifest, ctx, dappSession)
		}
		if (methodName === "getAccounts") {
			return this.handleGetAccounts(ctx, dappSession)
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

		const kind = METHOD_TO_KIND[methodName]
		if (!kind) {
			throw new Error(`Unsupported wallet method: ${methodName}`)
		}

		const operation = await this.buildOperation(kind, args, ctx, dappSession)
		const origin: LocalTxOrigin = { type: OriginType.DAPP, name: ctx.origin }

		const results = await this.executionService.executeOperations([operation], origin)
		return this.unwrapResult(results[0])
	}

	/**
	 * Return accounts for the current session's profile and chain.
	 * Scoped to session accounts only and uses per-app aliases.
	 * WalletSchema expects: Array<{ alias: string, item: AztecAddress }>
	 *
	 * Contract rows (see plan-v3 §3):
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
		// Phase 0.5: dappSession captured at dispatch entry, not re-looked-up here.
		if (!dappSession) {
			throw new Error(`No dApp session found for origin ${ctx.origin}`)
		}

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
			this.logger.log("wallet-sdk", LogLevel.Warn, `Desync: accounts grant exists but session.accounts is empty for ${ctx.origin}`)
			return []
		}

		// Pre-grant: throw structured 4100 so the dApp's fallback fires. Log level
		// is Debug because a misbehaving dApp may re-fire getAccounts() per render.
		this.logger.log(
			"wallet-sdk",
			LogLevel.Debug,
			`getAccounts pre-grant from ${ctx.origin} — throwing CAPABILITY_NOT_GRANTED to nudge requestCapabilities()`,
		)
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
		//
		// `sendTx` and `registerToken` are the popup-gated methods. Both
		// require user interaction (fee selection / token metadata review)
		// that isn't representable in a batch result.
		for (const method of methods) {
			if (method.name === "sendTx" || method.name === "registerToken") {
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
		// Phase 0.5: dappSession captured at dispatch entry.
		const rawOpts = (args[1] as Record<string, unknown>) ?? {}
		const isNoFrom = isNoFromRequest(rawOpts.from)
		// An explicit `from` (a real address — not the NO_FROM sentinel, not omitted) names
		// the account the dApp wants to send from. Resolve to THAT account (validated against
		// the session) instead of defaulting to the first session account, which silently
		// ignored a multi-account dApp's choice and could send from the wrong account.
		const requestedFrom = isNoFrom || rawOpts.from == null ? undefined : String(rawOpts.from)
		const [_network, account] = await this.resolveNetworkAndAccount(ctx, dappSession, requestedFrom)
		const caipAccount = formatCaipAccount(ctx.chainId, account.address)
		this.logger.log(
			"wallet-sdk",
			LogLevel.Debug,
			`handleSendTx: account=${account.address}, chainId=${ctx.chainId}, origin=${ctx.origin}`,
		)

		if (!dappSession) {
			throw new Error(`No dApp session found for origin ${ctx.origin}`)
		}
		this.logger.log(
			"wallet-sdk",
			LogLevel.Debug,
			`handleSendTx: session=${dappSession.id}, sessionAccounts=${JSON.stringify(dappSession.accounts)}`,
		)

		const opts = isNoFrom ? rawOpts : { ...rawOpts, from: account.address }
		const execPayload = args[0] as Record<string, unknown> | undefined
		this.logger.log(
			"wallet-sdk",
			LogLevel.Debug,
			`handleSendTx: isNoFrom=${isNoFrom}, exec.feePayer=${execPayload?.feePayer}, exec.calls=${(execPayload?.calls as unknown[] | undefined)?.length}, additionalScopes=${JSON.stringify(rawOpts.additionalScopes)}`,
		)

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

		return this.unwrapResult(results[0])
	}

	/**
	 * Handle createAuthWit: resolve the signer from args[0] (not the session default),
	 * then route by scope coverage. A CallIntent covered by a granted tx/sim scope is
	 * within authority the dApp already holds → sign silently. An uncovered call, or any
	 * IntentInnerHash (whose inner hash is fully attacker-chosen), → confirmation popup.
	 * No sendTx FIFO hooks: the background's non-send safety-net releases the baton.
	 */
	private async handleCreateAuthWit(
		args: unknown[],
		ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
		grants: GrantedCapabilityRecord[],
	): Promise<unknown> {
		if (!dappSession) {
			throw new Error(`No dApp session found for origin ${ctx.origin}`)
		}
		const requestedFrom = String(args[0])
		const [network, account] = await this.resolveNetworkAndAccount(ctx, dappSession, requestedFrom)
		const messageHashOrIntent = args[1] as AztecCreateAuthWitOperation["messageHashOrIntent"]

		if (isCreateAuthWitCoveredByTxOrSimulationScope(messageHashOrIntent, grants)) {
			const operation: AztecCreateAuthWitOperation = {
				kind: "aztec_createAuthWit",
				networkId: network.id,
				accountAddress: account.address,
				messageHashOrIntent,
			}
			const origin: LocalTxOrigin = { type: OriginType.DAPP, name: ctx.origin }
			const results = await this.executionService.executeOperations([operation], origin)
			return this.unwrapResult(results[0])
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
		return this.unwrapResult(results[0])
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
		// Phase 0.5: dappSession captured at dispatch entry.
		if (!dappSession) {
			throw new Error(`No dApp session found for origin ${ctx.origin}`)
		}

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

		return this.unwrapResult(results[0])
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
		if (!dappSession) {
			throw new Error(`No dApp session found for origin ${ctx.origin}`)
		}

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

		return this.unwrapResult(results[0])
	}

	/**
	 * Handle requestCapabilities with 3-phase approach:
	 * 1. Check stored grants → compute delta (new/changed types)
	 *    - Previously rejected types are included in delta (re-request)
	 * 2. Early return if delta is empty (all already granted)
	 * 3. Show popup for delta → user approves → merge and store
	 *    - Track rejected types for future re-request detection
	 */
	private async handleRequestCapabilities(
		manifest: CapabilityManifest,
		ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
	): Promise<unknown> {
		// Phase 0.5: dappSession captured at dispatch entry.
		if (!dappSession) {
			throw new Error(`No dApp session found for origin ${ctx.origin}`)
		}

		const requestedCapabilities = (manifest?.capabilities ?? []) as Record<string, unknown>[]
		if (requestedCapabilities.length === 0) {
			return {
				version: "1.0" as const,
				granted: [],
				wallet: { name: "Nulo", version: __VERSION__ },
			}
		}

		// Phase 1: Check existing grants and rejections
		const existingGrants = dappSession.capabilityGrants ?? []
		const existingRejections = dappSession.capabilityRejections ?? []
		const grantedTypes = new Set<string>(existingGrants.map((g) => g.capability.type))
		const rejectedTypes = new Set(existingRejections.map((r) => r.capabilityType))

		// Delta: capabilities not yet granted OR previously rejected (re-request).
		//
		// For `accounts` specifically, compare full shape — `canGet` /
		// `canCreateAuthWit` — not just type. Without this, a dApp granted
		// `{canGet:true, canCreateAuthWit:false}` could later request
		// `{canCreateAuthWit:true}` and the type-only filter would return empty,
		// silently authorising the upgrade. The breadth fix for other cap types
		// is filed as `wallet-sdk-capability-field-diff`.
		const delta = requestedCapabilities.filter((cap) => {
			const type = cap.type as string
			if (rejectedTypes.has(type)) return true
			// Unknown wire types keep the type-only default: they flow through to the
			// popup and render default-off — do NOT drop or coerce them. Known types are
			// trusted as their `Capability` variant (the same trust the removed per-branch
			// `as unknown as XCapability` casts encoded) and checked field-aware via
			// `isCapabilityCovered`. (Grant-path semantics unchanged: contracts APPENDS a
			// grant, transaction REPLACES; scope checkers union across grants downstream.)
			if (!isKnownCapabilityType(type)) return !grantedTypes.has(type)
			return !isCapabilityCovered(cap as unknown as Capability, existingGrants, grantedTypes)
		})
		// Track which delta items are re-requests (previously rejected)
		const reRequested = requestedCapabilities.filter((cap) => rejectedTypes.has(cap.type as string)).map((cap) => cap.type as string)

		// Phase 2: Early return if all types already granted and none re-requested
		if (delta.length === 0) {
			const granted = await this.enrichGrantedCapabilities(
				existingGrants.map((g) => g.capability),
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

		// Phase 3: Show capability popup for delta
		const existingCaps = existingGrants
			.filter((g) => !rejectedTypes.has(g.capability.type)) // Don't show re-requested as "existing"
			.map((g) => g.capability)

		// If `accounts` type is in the delta, load available accounts for the popup
		const hasAccountsInDelta = delta.some((cap) => cap.type === "accounts")
		let availableAccounts: Array<{ address: string; name: string; chainId: number }> | undefined
		if (hasAccountsInDelta) {
			const network = await this.resolveNetwork(ctx)
			const accounts = await this.accountService.getAccounts(ctx.profileId, network.chainId)
			availableAccounts = accounts.map((acc) => ({
				address: acc.address,
				name: acc.name,
				chainId: acc.chainId,
			}))
		}

		let result: CapabilityResult
		try {
			result = await this.dappInteractionService.requestCapabilities({
				sessionId: dappSession.id,
				manifest,
				delta,
				existingGrants: existingCaps,
				reRequested,
				availableAccounts,
			})
		} catch (err) {
			// On popup reject/close, persist rejection for all delta items so the
			// next request renders the "previously denied" badge. The grant-path
			// write below is unreachable when this throws.
			const rejectedAt = Date.now()
			const newRejections: RejectedCapabilityRecord[] = delta.map((cap) => ({
				capabilityType: cap.type as string,
				rejectedAt,
			}))
			const deltaTypes = new Set(delta.map((cap) => cap.type as string))
			const mergedRejections = [...existingRejections.filter((r) => !deltaTypes.has(r.capabilityType)), ...newRejections]
			await this.dappSessionService.setCapabilityRejections(dappSession.id, mergedRejections)
			throw err
		}

		// Safety net: ensure accounts capability is in granted when accounts were selected
		const grantedResults = result.granted as Record<string, unknown>[]
		if (result.selectedAccounts && result.selectedAccounts.length > 0) {
			const hasAccountsInGranted = grantedResults.some((cap) => cap.type === "accounts")
			if (!hasAccountsInGranted) {
				const accountsCap = delta.find((cap) => cap.type === "accounts")
				if (accountsCap) {
					grantedResults.push(accountsCap)
				}
			}
		}

		// If accounts were selected in the popup, merge with existing (don't replace)
		if (result.selectedAccounts && result.selectedAccounts.length > 0) {
			const existingAccounts = new Set(dappSession.accounts ?? [])
			for (const acc of result.selectedAccounts) {
				existingAccounts.add(acc)
			}
			const mergedAccounts = [...existingAccounts]

			await this.dappSessionService.updateDappSession(
				dappSession.id,
				dappSession.permissions,
				mergedAccounts,
				dappSession.confirmationLevel,
			)
			if (result.accountAliases) {
				await this.dappSessionService.setAccountAliases(dappSession.id, result.accountAliases)
			}
		}

		// Compute which delta types were approved vs rejected
		const approvedTypes = new Set(grantedResults.map((cap) => cap.type as string))
		const now = Date.now()

		// Approved DELTA types REPLACE their stored grant (never-granted types simply append).
		// The old type-only filter silently dropped re-approved types: a contracts re-consent
		// (field-diff, e.g. after a redeploy adds token addresses) was REPORTED granted but never
		// persisted - every later call still refused on the stale grant. Same hole applied to
		// accounts upgrades. The popup echoes existing caps alongside the newly approved delta,
		// so for replaced types we take the LAST result entry of that type that differs from the
		// stored capability (falling back to the delta's requested shape).
		const deltaApprovedTypes = new Set(delta.filter((cap) => approvedTypes.has(cap.type as string)).map((cap) => cap.type as string))
		const replacementFor = (type: string): Capability | undefined => {
			const stored = existingGrants.find((g) => g.capability.type === type)?.capability
			const candidates = grantedResults.filter((cap) => cap.type === type)
			const changed = candidates.filter((cap) => JSON.stringify(cap) !== JSON.stringify(stored))
			return (changed[changed.length - 1] ?? candidates[candidates.length - 1]) as Capability | undefined
		}
		const newGrants: GrantedCapabilityRecord[] = []
		for (const cap of grantedResults) {
			const type = cap.type as string
			if (deltaApprovedTypes.has(type)) continue // handled via replacement below (dedupes echoes).
			if (!grantedTypes.has(type as Capability["type"]) || rejectedTypes.has(type)) {
				newGrants.push({ capability: cap as Capability, grantedAt: now })
			}
		}
		for (const type of deltaApprovedTypes) {
			const replacement = replacementFor(type) ?? (delta.find((c) => c.type === type) as unknown as Capability)
			newGrants.push({ capability: replacement, grantedAt: now })
		}
		// Merge: keep existing grants minus rejected AND minus replaced types, then the new records.
		const mergedGrants = [
			...existingGrants.filter((g) => !rejectedTypes.has(g.capability.type) && !deltaApprovedTypes.has(g.capability.type)),
			...newGrants,
		]

		await this.dappSessionService.setCapabilityGrants(dappSession.id, mergedGrants)

		// Track rejections: delta items that were NOT approved
		const newRejections: RejectedCapabilityRecord[] = delta
			.filter((cap) => !approvedTypes.has(cap.type as string))
			.map((cap) => ({ capabilityType: cap.type as string, rejectedAt: now }))
		// Merge: keep old rejections for types not in this delta + new rejections
		const deltaTypes = new Set(delta.map((cap) => cap.type as string))
		const mergedRejections = [...existingRejections.filter((r) => !deltaTypes.has(r.capabilityType)), ...newRejections]
		await this.dappSessionService.setCapabilityRejections(dappSession.id, mergedRejections)

		// Reload session to pick up updated accounts/aliases
		const updatedSession = await this.dappSessionService.getDappSession(dappSession.id)

		const granted = await this.enrichGrantedCapabilities(
			mergedGrants.map((g) => g.capability),
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
		// Use requested caps as the template to preserve the dApp's original fields
		const grantedTypes = new Set(grantedCaps.map((c) => (c as Record<string, unknown>).type))

		for (const cap of requestedCaps) {
			if (!grantedTypes.has(cap.type)) continue

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

				// F-003: honor canGet on the GRANT-RESPONSE path. Previously the
				// accounts list was echoed unconditionally — a dApp could request
				// `canGet:false` and still receive the full account list in the
				// grant response (and later via getAccounts because that method
				// was exempt). Both paths now require `canGet === true`.
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
			} else {
				result.push(cap)
			}
		}
		return result
	}

	/**
	 * Enforce capability grants before dispatching a method call.
	 *
	 * - Exempt methods (getChainInfo, requestCapabilities, batch) skip enforcement.
	 *   NOTE: getAccounts is NOT exempt — F-003 made it require accounts.canGet=true.
	 * - The method's required capability type must be in the session's grants.
	 * - Sessions without grants (new or pre-migration) are treated as having no grants,
	 *   so non-exempt methods are blocked until requestCapabilities() is called.
	 */
	private enforceCapability(
		methodName: string,
		_ctx: SessionContext,
		dappSession: IDappSessionRef | undefined,
	): GrantedCapabilityRecord[] {
		// Phase 0.5: dappSession captured at dispatch entry; no async lookup
		// here. Method is now synchronous; callers that did `await this.enforceCapability(...)`
		// can drop the await (no behavior change because the promise resolved
		// synchronously when the inner lookup was the only async point).
		if (isCapabilityExempt(methodName)) return []

		const requiredType = getRequiredCapability(methodName)
		if (!requiredType) return [] // Unknown method — let dispatch() handle it

		if (!dappSession) {
			// F-006: fail-closed when the stored DappSession is missing. Pre-fix,
			// this returned [] and the dispatcher fell through to the sink with
			// no grants — network-only methods (getPrivateEvents, getAddressBook,
			// registerSender, registerContract, getContractMetadata,
			// getContractClassMetadata) executed unchecked after the user
			// disconnected the dApp from Settings or after session expiry.
			//
			// Throwing CapabilityNotGrantedError gives the dApp a structured
			// signal to re-request capabilities (the same path used for
			// pre-grant calls), and is paired with the live-transport teardown
			// in wallet-sdk/background.ts that prevents the channel from
			// staying useful after revocation.
			this.logger.log(
				"wallet-sdk",
				LogLevel.Debug,
				`${methodName} from ${_ctx.origin} — no DappSession found; throwing CAPABILITY_NOT_GRANTED (F-006 fail-closed)`,
			)
			throw new CapabilityNotGrantedError(requiredType)
		}

		const grants = dappSession.capabilityGrants ?? []
		const grantedTypes = new Set(grants.map((g) => g.capability.type))
		if (!grantedTypes.has(requiredType)) {
			// Debug (not Info): dApps may re-fire methods per render, so the
			// pre-grant throw must not spam the log. The existing log-noise
			// pattern at handleGetAccounts is preserved here for any method
			// reaching enforceCapability without the required grant type.
			this.logger.log(
				"wallet-sdk",
				LogLevel.Debug,
				`${methodName} from ${_ctx.origin} — throwing CAPABILITY_NOT_GRANTED to nudge requestCapabilities()`,
			)
			// CapabilityNotGrantedError is the public contract — dApps substring-
			// match on the error code and message. The plain `Error` form was a
			// pre-Phase-1 mistake; F-003's removal of `getAccounts` from
			// EXEMPT_METHODS made this code path reachable by `getAccounts`,
			// which has an existing CapabilityNotGrantedError-pinned test.
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
		// Phase 0.5: dappSession threaded through from dispatch() entry.
		if (NETWORK_ONLY_KINDS.has(kind)) {
			const network = await this.resolveNetwork(ctx)
			return this.buildNetworkOperation(kind, args, network.id)
		}

		if (ACCOUNT_KINDS.has(kind)) {
			const [network, account] = await this.resolveNetworkAndAccount(ctx, dappSession)
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
		return resolveNetworkByChainId(this.networkService, ctx.chainId)
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
		// Phase 0.5: dappSession captured at dispatch entry; no inline lookup here.
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
				throw new Error(`Requested account ${requestedFrom} is not authorized for this dApp session`)
			}
			throw new Error("No authorized accounts found for this dApp session")
		}

		// No session or no accounts on session — require account authorization
		throw new Error("No accounts authorized. The dApp must call requestCapabilities() with accounts type first.")
	}

	private unwrapResult(result: OperationResult): unknown {
		return unwrapOperationResult(result)
	}
}
