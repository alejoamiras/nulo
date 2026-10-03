/**
 * Per-method scope-check function bodies + their helpers.
 *
 * The method-descriptors registry and scope-enforcement both import these checkers, so at runtime
 * this module imports only leaves (`./field-address`, `./scope-violation`; `MethodName` is
 * type-only), which is what keeps the registry↔scope-enforcement graph acyclic.
 *
 * Each checker mirrors a `WalletSchema` arg shape and must stay in sync with
 * `buildNetworkOperation` / `buildAccountOperation` in dispatcher.ts.
 */

import type { Capability, GrantedCapabilityRecord, Scope, ScopePattern } from "./capabilities"
import { sameFieldAddress } from "./field-address"
import type { MethodName } from "./method-descriptors"
import { scopeViolation } from "./scope-violation"

/** A per-method scope checker. Throws on a scope violation; returns on pass. */
export type ScopeCheck = (args: unknown[], grants: GrantedCapabilityRecord[]) => void

/** Shape of a function call as received over the wire (exec.calls entries). */
type WireCall = { to: unknown; name: string }

/** Shape of an execution payload containing calls. */
type WireExecPayload = { calls?: unknown }

// ── Helpers ───────────────────────────────────────────────────────────

export function matchesPattern(contract: string, fn: string, pattern: ScopePattern): boolean {
	return (
		(pattern.contract === "*" || sameFieldAddress(String(pattern.contract), contract)) &&
		(pattern.function === "*" || pattern.function === fn)
	)
}

function matchesScope(contract: string, fn: string, scope: Scope): boolean {
	// An EMPTY function name is never a legitimate call target. Refuse to match it
	// against ANY scope (including "*") so a `{function:""}` grant + a `name:""`
	// call cannot be authorized. This is the authorization-side half of the
	// empty-name defense; the ABI sinks separately reject an empty `name` (which
	// they would otherwise treat as "absent" and skip the name↔selector bind,
	// silently signing an authwit for a different selector).
	if (fn === "") return false
	if (scope === "*") return true
	return scope.some((p) => matchesPattern(contract, fn, p))
}

export function inAddressList(address: string, list: "*" | unknown[]): boolean {
	if (list === "*") return true
	return list.some((item) => sameFieldAddress(String(item), address))
}

/** Grants of one capability type, narrowed to that variant by the one cast. */
export function grantsOfType<K extends Capability["type"]>(grants: GrantedCapabilityRecord[], type: K): Extract<Capability, { type: K }>[] {
	return grants.filter((g) => g.capability.type === type).map((g) => g.capability as Extract<Capability, { type: K }>)
}

// ── Per-method checkers ───────────────────────────────────────────────

/** A contracts grant carrying `flag` must list `address`. No contracts grants at all — let
 *  type-level enforcement handle it. */
function requireContractsGrant(
	method: MethodName,
	address: string,
	flag: "canRegister" | "canGetMetadata",
	grants: GrantedCapabilityRecord[],
): void {
	const caps = grantsOfType(grants, "contracts")
	if (!caps.length) return
	if (!caps.some((c) => c[flag] && inAddressList(address, c.contracts))) {
		throw scopeViolation(`Scope violation: ${method} contract not permitted by granted contracts scope`)
	}
}

export function checkRegisterContract(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const instance = args[0] as Record<string, unknown> | undefined
	requireContractsGrant("registerContract", String(instance?.address ?? instance), "canRegister", grants)
}

export function checkGetContractMetadata(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	requireContractsGrant("getContractMetadata", String(args[0]), "canGetMetadata", grants)
}

/** Registration state is wallet-local metadata about a granted contract — the same consent
 *  surface as getContractMetadata. */
export function checkIsTokenRegistered(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	requireContractsGrant("isTokenRegistered", String(args[0]), "canGetMetadata", grants)
}

export function checkGetContractClassMetadata(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const id = String(args[0])

	const caps = grantsOfType(grants, "contractClasses")
	if (!caps.length) return

	const permitted = caps.some((c) => c.canGetMetadata && inAddressList(id, c.classes))
	if (!permitted) {
		throw scopeViolation("Scope violation: getContractClassMetadata class not permitted by granted contractClasses scope")
	}
}

function checkTransactionCalls(methodName: MethodName, args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const exec = args[0] as WireExecPayload
	const calls = exec?.calls
	if (!Array.isArray(calls)) {
		throw new Error(`Scope enforcement: ${methodName} expects exec.calls to be an array`)
	}
	if (calls.length === 0) return // Vacuously true — no calls to restrict

	const caps = grantsOfType(grants, "transaction")
	if (!caps.length) return

	const typedCalls = calls as WireCall[]
	const permitted = caps.some((c) => typedCalls.every((call) => matchesScope(String(call.to), call.name, c.scope)))
	if (!permitted) {
		throw scopeViolation(`Scope violation: ${methodName} call not permitted by granted transaction scope`)
	}
}

export function checkGrantPublicAuthwit(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	// Granting a public authwit for method@contract authorizes a FUTURE
	// call with the user's funds — at least as powerful as sending that
	// call now, so it is gated by the same transaction scope.
	const content = args[1] as { contract?: unknown; method?: unknown } | undefined
	const contract = String(content?.contract)
	const method = String(content?.method)

	const caps = grantsOfType(grants, "transaction")
	if (!caps.length) return

	const permitted = caps.some((c) => matchesScope(contract, method, c.scope))
	if (!permitted) {
		throw scopeViolation("Scope violation: grantPublicAuthwit call not permitted by granted transaction scope")
	}
}

function checkSimulationTransactions(methodName: MethodName, args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const exec = args[0] as WireExecPayload
	const calls = exec?.calls
	if (!Array.isArray(calls)) {
		throw new Error(`Scope enforcement: ${methodName} expects exec.calls to be an array`)
	}
	if (calls.length === 0) return

	const caps = grantsOfType(grants, "simulation")
	if (!caps.length) return

	const typedCalls = calls as WireCall[]
	// Each element is unvalidated wire data: one that is not an object with a `to` is refused before
	// `call.to` is read, and a non-string `name` is left to the execution layer's schema.
	for (const call of typedCalls) {
		if (typeof call !== "object" || call === null || (call as WireCall).to === undefined) {
			throw new Error(`Scope enforcement: ${methodName} exec.calls entries must be objects with a \`to\` field`)
		}
	}
	const permitted = caps.some((c) => {
		const scope = c.transactions?.scope
		if (!scope) return false
		return typedCalls.every((call) => matchesScope(String(call.to), call.name, scope))
	})
	if (!permitted) {
		throw scopeViolation(`Scope violation: ${methodName} call not permitted by granted simulation.transactions scope`)
	}
}

export function checkExecuteUtility(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const call = args[0] as WireCall | undefined
	if (!call?.to || !call?.name) {
		throw new Error("Scope enforcement: executeUtility expects call with to and name fields")
	}
	const contract = String(call.to)
	const fn = call.name

	const caps = grantsOfType(grants, "simulation")
	if (!caps.length) return

	const permitted = caps.some((c) => {
		const scope = c.utilities?.scope
		if (!scope) return false
		return matchesScope(contract, fn, scope)
	})
	if (!permitted) {
		throw scopeViolation("Scope violation: executeUtility call not permitted by granted simulation.utilities scope")
	}
}

export function checkGetPrivateEvents(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const eventFilter = args[1] as Record<string, unknown> | undefined
	const address = String(eventFilter?.contractAddress)

	const caps = grantsOfType(grants, "data")
	if (!caps.length) return

	const permitted = caps.some((c) => {
		const contracts = c.privateEvents?.contracts
		if (!contracts) return false
		return inAddressList(address, contracts)
	})
	if (!permitted) {
		throw scopeViolation("Scope violation: getPrivateEvents contract not permitted by granted data.privateEvents scope")
	}
}

/**
 * Check a call ({contract, function}) against the union of transaction and
 * simulation.transactions scopes on the given grants, so an authwit cannot authorize a call
 * broader than the dApp's granted scope.
 *
 * `hasTxCaps` is false when no such scope is held, and `permitted` is then false too: the
 * caller decides what an absent scope means.
 */
function callWithinTxOrSimulationScope(
	contract: string,
	fn: string,
	grants: GrantedCapabilityRecord[],
): { hasTxCaps: boolean; permitted: boolean } {
	const txCaps = grantsOfType(grants, "transaction")
	const simCaps = grantsOfType(grants, "simulation")
	const hasTxCaps = txCaps.length > 0 || simCaps.some((c) => !!c.transactions?.scope)
	if (!hasTxCaps) return { hasTxCaps: false, permitted: false }

	const permitted =
		txCaps.some((c) => matchesScope(contract, fn, c.scope)) ||
		simCaps.some((c) => {
			const scope = c.transactions?.scope
			return scope ? matchesScope(contract, fn, scope) : false
		})
	return { hasTxCaps: true, permitted }
}

type CallIntentShape = { caller: unknown; call: { to: unknown; name: string } }
type IntentInnerHashShape = { consumer: unknown; innerHash: unknown }

function isCallIntent(x: unknown): x is CallIntentShape {
	if (!x || typeof x !== "object") return false
	const obj = x as Record<string, unknown>
	if (!("caller" in obj) || !("call" in obj)) return false
	const call = obj.call
	if (!call || typeof call !== "object") return false
	const c = call as Record<string, unknown>
	return "to" in c && "name" in c && typeof c.name === "string"
}

function isIntentInnerHash(x: unknown): x is IntentInnerHashShape {
	if (!x || typeof x !== "object") return false
	const obj = x as Record<string, unknown>
	return "consumer" in obj && "innerHash" in obj
}

/**
 * Whether a dApp createAuthWit intent's target call is covered by a granted
 * transaction/simulation scope. An `IntentInnerHash` carries no call, so it is never covered.
 * Coverage alone never signs silently: the dispatcher also requires the app's authorizations
 * consent.
 */
export function isCreateAuthWitCoveredByTxOrSimulationScope(intent: unknown, grants: GrantedCapabilityRecord[]): boolean {
	if (!isCallIntent(intent)) return false
	const { permitted } = callWithinTxOrSimulationScope(String(intent.call.to), intent.call.name, grants)
	return permitted
}

export function checkCreateAuthWit(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const from = String(args[0])

	const caps = grantsOfType(grants, "accounts")
	if (caps.length) {
		// A granted accounts capability legitimately omits an explicit `accounts` list: a dApp can't
		// enumerate the wallet's accounts at connect time (it connects in order to learn them). Treat a
		// missing list as "no per-account restriction" — `canCreateAuthWit` alone permits it. The authwit
		// stays bounded: the wallet only signs for its own account, and the call-scope check below limits
		// what the authwit may authorize. An explicit list, when present, is still enforced.
		const permitted = caps.some(
			(c) => c.canCreateAuthWit && (!Array.isArray(c.accounts) || c.accounts.some((a) => String(a.item) === from)),
		)
		if (!permitted) {
			throw scopeViolation("Scope violation: createAuthWit account not permitted by granted accounts scope")
		}
	}

	// Validate the authorized call itself against transaction / simulation scope.
	// An authwit authorizes a specific call on behalf of `from`; a dApp must not
	// be able to obtain an authwit for calls broader than its granted transaction
	// or simulation scope.
	const intent = args[1]

	if (isCallIntent(intent)) {
		const contract = String(intent.call.to)
		const fn = intent.call.name
		const { hasTxCaps, permitted } = callWithinTxOrSimulationScope(contract, fn, grants)
		if (hasTxCaps && !permitted) {
			throw scopeViolation("Scope violation: createAuthWit call not permitted by granted transaction or simulation scope")
		}
		return
	}

	if (isIntentInnerHash(intent)) {
		// We only know the consumer (target contract). Require that at least one
		// transaction / simulation grant's scope covers that contract at any
		// function (wildcard). This is the strongest check possible without the
		// function name.
		const consumer = String(intent.consumer)
		const { hasTxCaps, permitted } = callWithinTxOrSimulationScope(consumer, "*", grants)
		if (hasTxCaps && !permitted) {
			throw scopeViolation(
				"Scope violation: createAuthWit inner-hash consumer not permitted by granted transaction or simulation scope",
			)
		}
		return
	}

	// Raw Fr message hash: a dApp-supplied pre-computed hash carries no semantic
	// info to scope-check, so it cannot be proven within the granted scope. Reject
	// it — a dApp must pass a structured CallIntent. (An inner-hash is handled above;
	// the dispatcher routes createAuthWit to explicit user confirmation.)
	throw new Error("Scope violation: createAuthWit requires a structured call intent; a raw message hash cannot be authorized")
}

/** No accounts grant passes here: type-level enforcement refuses that call first. */
export function checkGetAccounts(_args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const caps = grantsOfType(grants, "accounts")
	if (!caps.length) return
	if (!caps.some((c) => c.canGet === true)) {
		throw scopeViolation("Scope violation: getAccounts requires accounts.canGet=true")
	}
}

/**
 * F-004: enforce `DataCapability.addressBook === true` before allowing
 * a dApp to read the user's address book via `getAddressBook`. Prior to
 * this checker, the `data` capability type-check passed regardless of
 * whether the `addressBook` sub-bit was set.
 */
export function checkGetAddressBook(_args: unknown[], grants: GrantedCapabilityRecord[]): void {
	requireAddressBookGrant("getAddressBook", grants)
}

/**
 * F-004 (paired): same sub-grant check applies to `registerSender` — a
 * dApp with only an `addressBook: false` data grant should not be able to
 * inject sender aliases into the user's address book.
 */
export function checkRegisterSender(_args: unknown[], grants: GrantedCapabilityRecord[]): void {
	requireAddressBookGrant("registerSender", grants)
}

/** The sub-bit must be literally `true`: a data grant with anything else denies. */
function requireAddressBookGrant(method: MethodName, grants: GrantedCapabilityRecord[]): void {
	const caps = grantsOfType(grants, "data")
	if (!caps.length) return
	if (!caps.some((c) => c.addressBook === true)) {
		throw scopeViolation(`Scope violation: ${method} requires data.addressBook=true`)
	}
}

// ── Named wrappers ──
// The registry's `scopeCheck` holds these stable references, which the parity tests compare by
// identity.

export function checkSendTx(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	checkTransactionCalls("sendTx", args, grants)
}

export function checkSimulateTx(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	checkSimulationTransactions("simulateTx", args, grants)
}

export function checkProfileTx(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	checkSimulationTransactions("profileTx", args, grants)
}

/**
 * `registerContractClass` (added to WalletSchema in @aztec 5.0) is intentionally NOT dApp-exposed:
 * it's an unbound PXE artifact write with no chain check, and Nulo's authz cannot scope it correctly
 * yet — `contractClasses` is read-only (no `canRegister`), and ScopeCheck is synchronous while the
 * artifact's class-id derivation is async. Deny it at scope-enforcement (the single source of truth;
 * scope runs before routing, so no dispatcher branch is needed). Revisit when canRegister + a
 * class-id-scoped async gate land.
 */
export function checkRegisterContractClassDisabled(): never {
	throw new Error(
		"registerContractClass is intentionally disabled in Nulo pending contractClasses.canRegister support and class-id-scoped enforcement.",
	)
}

// ── Authorizations consent ────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function typeOf(cap: unknown): string | undefined {
	return isRecord(cap) && typeof cap.type === "string" ? cap.type : undefined
}

/** Whether a scope reaches any contract. A malformed scope counts as any contract, so it never
 *  keeps a narrow consent effective. */
export function isAnyContractScope(scope: unknown): boolean {
	if (!Array.isArray(scope)) return true
	return scope.some((p) => !isRecord(p) || typeof p.contract !== "string" || typeof p.function !== "string" || p.contract === "*")
}

/** Whether a transaction or `simulation.transactions` scope reaches any contract. Utility scopes
 *  are left out: they never authorize a call intent. */
export function coversAnyContract(caps: readonly unknown[]): boolean {
	return caps.some((cap) => {
		if (!isRecord(cap)) return false
		if (cap.type === "transaction") return isAnyContractScope(cap.scope)
		if (cap.type !== "simulation" || cap.transactions === undefined) return false
		return !isRecord(cap.transactions) || isAnyContractScope(cap.transactions.scope)
	})
}

/** The stored consent, read strictly: it crosses `IDappSessionRef` as `unknown`, and a tolerant
 *  read would let a truthy junk value sign silently. */
export function readConsent(value: unknown): { broad: boolean } | undefined {
	if (!isRecord(value) || typeof value.broad !== "boolean" || Object.keys(value).length !== 1) return undefined
	return { broad: value.broad }
}

/** Whether the consent lets a covered call intent sign without asking. A narrow consent holds
 *  only while no scope reaches any contract. */
export function authorizationsEffective(consent: unknown, caps: readonly unknown[]): boolean {
	const read = readConsent(consent)
	return read !== undefined && (read.broad || !coversAnyContract(caps))
}

/** The grants a decision leaves in force, by the same per-type replacement the session writer
 *  applies; `existing` is every stored grant, a rejected type's included. */
export function effectiveGrants(existing: readonly unknown[], delta: readonly unknown[]): unknown[] {
	const replaced = new Set(delta.map(typeOf))
	return [...existing.filter((cap) => !replaced.has(typeOf(cap))), ...delta]
}
