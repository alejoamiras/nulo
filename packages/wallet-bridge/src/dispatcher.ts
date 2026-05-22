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
import { formatCaipAccount, formatCaipChain, parseCaipAccount, resolveNetworkByChainId } from "./caip"
import type { AccountsCapability, Capability, GrantedCapabilityRecord, RejectedCapabilityRecord } from "./capabilities"
import { getRequiredCapability, isCapabilityExempt } from "./capability-map"
import type { AztecSendTxRequest, CapabilityResult, ExecutionResult, RegisterTokenRequest } from "./dapp-interaction-protocol"
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
import { enforceScope } from "./scope-enforcement"
import type { IAccountRef, IDappSessionRef, INetworkRef } from "./session-types"
import { OriginType, type LocalTxOrigin } from "./transaction-origin"
import type { SessionContext } from "./types"
import { CapabilityNotGrantedError, JobCancelledError } from "@nulo/extension-messaging/errors"
import type { ILogger } from "@nulo/wallet-core/logger"
import { LogLevel } from "@nulo/wallet-core/logger"
import type { IAccountReader, IDappInteractionRunner, IDappSessionWriter, IExecutionRunner, INetworkReader } from "./services-contract"

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
function accountsCapsEqual(a: AccountsCapability, b: AccountsCapability): boolean {
	return Boolean(a.canGet) === Boolean(b.canGet) && Boolean(a.canCreateAuthWit) === Boolean(b.canCreateAuthWit)
}

/** Shape of the capability manifest sent by the dApp via requestCapabilities(). */
type CapabilityManifest = {
	capabilities?: unknown[]
	[key: string]: unknown
}

/**
 * Maps wallet-sdk method names to internal Operation kinds.
 *
 * The wallet-sdk ExtensionWallet proxy calls methods by their WalletSchema key name.
 * On the dApp side these are camelCase method names (e.g. `sendTx`, `simulateTx`).
 * We map each to the corresponding `Operation.kind` that `ExecutionService` understands.
 */
const METHOD_TO_KIND: Record<string, Operation["kind"]> = {
	// --- Standard Wallet interface (from @aztec/aztec.js/wallet WalletSchema) ---
	getChainInfo: "aztec_getChainInfo",
	getContractClassMetadata: "aztec_getContractClassMetadata",
	getContractMetadata: "aztec_getContractMetadata",
	getPrivateEvents: "aztec_getPrivateEvents",
	registerSender: "aztec_registerSender",
	getAddressBook: "aztec_getAddressBook",
	registerContract: "aztec_registerContract",
	simulateTx: "aztec_simulateTx",
	executeUtility: "aztec_executeUtility",
	profileTx: "aztec_profileTx",
	// sendTx and registerToken are handled directly in dispatch() via
	// DappInteractionService — both need the confirmation popup.
	createAuthWit: "aztec_createAuthWit",
}

/**
 * Operations that only need a network (no account context).
 * These map chainId → networkId.
 */
const NETWORK_ONLY_KINDS = new Set<Operation["kind"]>([
	"aztec_getChainInfo",
	"aztec_getContractClassMetadata",
	"aztec_getContractMetadata",
	"aztec_getPrivateEvents",
	"aztec_registerSender",
	"aztec_getAddressBook",
	"aztec_registerContract",
])

/**
 * Operations that need both network AND account context.
 * These map chainId → networkId AND resolve the first session account.
 */
const ACCOUNT_KINDS = new Set<Operation["kind"]>(["aztec_simulateTx", "aztec_executeUtility", "aztec_profileTx", "aztec_createAuthWit"])

// Note: sendTx and registerToken are handled separately via DappInteractionService
// (handleSendTx / handleRegisterToken). simulate_views and get_complete_address are no
// longer dApp-facing — `simulate_views` op kind is retained for internal callers (the
// balance projector + gas-balance code); `get_complete_address` is dropped entirely.

export class WalletSdkDispatcher {
	constructor(
		private readonly networkService: INetworkReader,
		private readonly accountService: IAccountReader,
		private readonly executionService: IExecutionRunner,
		private readonly dappInteractionService: IDappInteractionRunner,
		private readonly dappSessionService: IDappSessionWriter,
		private readonly logger: ILogger,
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
	async dispatch(methodName: string, args: unknown[], ctx: SessionContext): Promise<unknown> {
		// Enforce capability grants (type-level) then scope (per-operation)
		const grants = await this.enforceCapability(methodName, ctx)
		if (grants.length) {
			enforceScope(methodName, args, grants)
		}

		// Handle methods that don't go through ExecutionService
		if (methodName === "requestCapabilities") {
			return this.handleRequestCapabilities(args[0] as CapabilityManifest, ctx)
		}
		if (methodName === "getAccounts") {
			return this.handleGetAccounts(ctx)
		}
		if (methodName === "batch") {
			return this.handleBatch(args[0] as Array<{ name: string; args: unknown[] }>, ctx)
		}

		// sendTx and registerToken both go through DappInteractionService for the
		// confirmation popup. sendTx also drives fee selection; registerToken pre-fetches
		// token metadata so the user sees name + symbol + decimals before approving.
		if (methodName === "sendTx") {
			return this.handleSendTx(args, ctx)
		}
		if (methodName === "registerToken") {
			return this.handleRegisterToken(args, ctx)
		}

		const kind = METHOD_TO_KIND[methodName]
		if (!kind) {
			throw new Error(`Unsupported wallet method: ${methodName}`)
		}

		const operation = await this.buildOperation(kind, args, ctx)
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
	private async handleGetAccounts(ctx: SessionContext): Promise<unknown> {
		const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(ctx.origin, String(ctx.chainId))
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

		return allAccounts
			.filter((acc) => sessionAccountAddresses.has(acc.address))
			.map((acc) => {
				const caip = formatCaipAccount(ctx.chainId, acc.address)
				const alias = dappSession.accountAliases?.[caip] ?? acc.name ?? ""
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
	private async handleSendTx(args: unknown[], ctx: SessionContext): Promise<unknown> {
		const [_network, account] = await this.resolveNetworkAndAccount(ctx)
		const caipAccount = formatCaipAccount(ctx.chainId, account.address)
		this.logger.log(
			"wallet-sdk",
			LogLevel.Debug,
			`handleSendTx: account=${account.address}, chainId=${ctx.chainId}, origin=${ctx.origin}`,
		)

		const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(ctx.origin, String(ctx.chainId))
		if (!dappSession) {
			throw new Error(`No dApp session found for origin ${ctx.origin}`)
		}
		this.logger.log(
			"wallet-sdk",
			LogLevel.Debug,
			`handleSendTx: session=${dappSession.id}, sessionAccounts=${JSON.stringify(dappSession.accounts)}`,
		)

		const rawOpts = (args[1] as Record<string, unknown>) ?? {}
		const isNoFrom = isNoFromRequest(rawOpts.from)
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

		const results: ExecutionResult = await this.dappInteractionService.execute({
			sessionId: dappSession.id,
			operations: [sendOp],
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
	private async handleRegisterToken(args: unknown[], ctx: SessionContext): Promise<unknown> {
		const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(ctx.origin, String(ctx.chainId))
		if (!dappSession) {
			throw new Error(`No dApp session found for origin ${ctx.origin}`)
		}

		// Resolve the dApp-supplied account against the session's authorized
		// list. Falls back to the first session-authorized account if args[0]
		// isn't a valid address (lenient parsing — old SDK shapes pass the
		// address as a raw string vs. AztecAddress instance).
		const requestedAccount = String(args[0])
		const network = await this.resolveNetwork(ctx)
		const allAccounts = await this.accountService.getAccounts(ctx.profileId, network.chainId)
		const sessionAddresses = this.getSessionAccountAddresses(dappSession, ctx.chainId)
		const account = allAccounts.find((acc) => sessionAddresses.has(acc.address) && acc.address === requestedAccount)
		if (!account) {
			// Either the dApp passed an unknown account, or the requested
			// account isn't in this session's authorized set. Refuse rather
			// than silently substituting — the user granted permission for a
			// specific subset of accounts via requestCapabilities.
			throw new Error(`registerToken: account ${requestedAccount} is not authorized for this dApp session`)
		}
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

	/**
	 * Handle requestCapabilities with 3-phase approach:
	 * 1. Check stored grants → compute delta (new/changed types)
	 *    - Previously rejected types are included in delta (re-request)
	 * 2. Early return if delta is empty (all already granted)
	 * 3. Show popup for delta → user approves → merge and store
	 *    - Track rejected types for future re-request detection
	 */
	private async handleRequestCapabilities(manifest: CapabilityManifest, ctx: SessionContext): Promise<unknown> {
		const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(ctx.origin, String(ctx.chainId))
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
		const grantedTypes = new Set(existingGrants.map((g) => g.capability.type))
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
			if (rejectedTypes.has(cap.type as string)) return true
			if (cap.type === "accounts") {
				const existing = existingGrants.find((g) => g.capability.type === "accounts")
				return !existing || !accountsCapsEqual(existing.capability as AccountsCapability, cap as unknown as AccountsCapability)
			}
			return !grantedTypes.has(cap.type as Capability["type"])
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

		// New grants: approved delta items that weren't already granted
		const newGrants: GrantedCapabilityRecord[] = grantedResults
			.filter((cap) => !grantedTypes.has(cap.type as Capability["type"]) || rejectedTypes.has(cap.type as string))
			.map((cap) => ({ capability: cap as Capability, grantedAt: now }))
		// Merge: keep existing grants (excluding re-approved types) + new grants
		const mergedGrants = [...existingGrants.filter((g) => !rejectedTypes.has(g.capability.type)), ...newGrants]

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
				const sessionAccounts = allAccounts.filter((acc) => sessionAddresses.has(acc.address))

				// Read canGet / canCreateAuthWit from the STORED grant, not the
				// requested cap. The wire response must reflect what was actually
				// granted — otherwise a dApp that requested `canCreateAuthWit:true`
				// would see `true` in the response even when storage has `false`,
				// then scope-enforcement would later refuse the createAuthWit call.
				const storedAccounts = grantedCaps.find((g) => (g as Record<string, unknown>).type === "accounts") as
					| AccountsCapability
					| undefined

				result.push({
					...cap,
					canGet: storedAccounts?.canGet ?? false,
					canCreateAuthWit: storedAccounts?.canCreateAuthWit ?? false,
					accounts: sessionAccounts.map((acc) => {
						const caip = formatCaipAccount(ctx.chainId, acc.address)
						const alias = dappSession.accountAliases?.[caip] ?? acc.name ?? ""
						return { alias, item: acc.address }
					}),
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
	 * - Exempt methods (getChainInfo, requestCapabilities, batch, getAccounts) skip enforcement.
	 * - The method's required capability type must be in the session's grants.
	 * - Sessions without grants (new or pre-migration) are treated as having no grants,
	 *   so non-exempt methods are blocked until requestCapabilities() is called.
	 */
	private async enforceCapability(methodName: string, ctx: SessionContext): Promise<GrantedCapabilityRecord[]> {
		if (isCapabilityExempt(methodName)) return []

		const requiredType = getRequiredCapability(methodName)
		if (!requiredType) return [] // Unknown method — let dispatch() handle it

		const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(ctx.origin, String(ctx.chainId))
		if (!dappSession) return [] // No session yet — let the method handler deal with it

		const grants = dappSession.capabilityGrants ?? []
		const grantedTypes = new Set(grants.map((g) => g.capability.type))
		if (!grantedTypes.has(requiredType)) {
			throw new Error(`Capability "${requiredType}" not granted. The dApp must call requestCapabilities() first.`)
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
	private async buildOperation(kind: Operation["kind"], args: unknown[], ctx: SessionContext): Promise<Operation> {
		if (NETWORK_ONLY_KINDS.has(kind)) {
			const network = await this.resolveNetwork(ctx)
			return this.buildNetworkOperation(kind, args, network.id)
		}

		if (ACCOUNT_KINDS.has(kind)) {
			const [network, account] = await this.resolveNetworkAndAccount(ctx)
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
	private async resolveNetworkAndAccount(ctx: SessionContext): Promise<[INetworkRef, IAccountRef]> {
		const network = await this.resolveNetwork(ctx)
		const allAccounts = await this.accountService.getAccounts(ctx.profileId, network.chainId)
		if (allAccounts.length === 0) {
			throw new Error(`No accounts found for profile ${ctx.profileId} on chainId ${ctx.chainId}`)
		}

		const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(ctx.origin, String(ctx.chainId))
		if (dappSession?.accounts && dappSession.accounts.length > 0) {
			const sessionAddresses = this.getSessionAccountAddresses(dappSession, ctx.chainId)
			const sessionAccount = allAccounts.find((acc) => sessionAddresses.has(acc.address))
			if (sessionAccount) {
				return [network, sessionAccount]
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
