/**
 * Per-method scope-check function bodies + their helpers.
 *
 * Leaf module: imports only capability types from `./capabilities`. Both the
 * `method-descriptors` registry (which references these checkers in its
 * `scopeCheck` fields) and `scope-enforcement` (which derives the
 * method→checker map and owns the F-005 `enforceScopeWithSession` wrapper)
 * depend on this module. Keeping the bodies here — depended on, never
 * depending back — is what breaks the registry↔scope-enforcement cycle.
 *
 * Each checker mirrors a `WalletSchema` arg shape and must stay in sync with
 * `buildNetworkOperation` / `buildAccountOperation` in dispatcher.ts.
 */

import type {
	GrantedCapabilityRecord,
	Scope,
	ScopePattern,
	AccountsCapability,
	ContractsCapability,
	ContractClassesCapability,
	SimulationCapability,
	TransactionCapability,
	DataCapability,
} from "./capabilities"

/** A per-method scope checker. Throws on a scope violation; returns on pass. */
export type ScopeCheck = (args: unknown[], grants: GrantedCapabilityRecord[]) => void

/** Shape of a function call as received over the wire (exec.calls entries). */
type WireCall = { to: unknown; name: string }

/** Shape of an execution payload containing calls. */
type WireExecPayload = { calls?: unknown }

// ── Helpers ───────────────────────────────────────────────────────────

function matchesPattern(contract: string, fn: string, pattern: ScopePattern): boolean {
	return (pattern.contract === "*" || String(pattern.contract) === contract) && (pattern.function === "*" || pattern.function === fn)
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

function inAddressList(address: string, list: "*" | unknown[]): boolean {
	if (list === "*") return true
	return list.some((item) => String(item) === address)
}

function grantsOfType<T extends { type: string }>(grants: GrantedCapabilityRecord[], type: string): T[] {
	return grants.filter((g) => g.capability.type === type).map((g) => g.capability as T)
}

// ── Per-method checkers ───────────────────────────────────────────────

export function checkRegisterContract(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const instance = args[0] as Record<string, unknown> | undefined
	const address = String(instance?.address ?? instance)

	const caps = grantsOfType<ContractsCapability>(grants, "contracts")
	if (!caps.length) return // No contracts grants — let type-level enforcement handle it

	const permitted = caps.some((c) => c.canRegister && inAddressList(address, c.contracts))
	if (!permitted) {
		throw new Error(`Scope violation: registerContract targets ${address}, not permitted by granted contracts scope`)
	}
}

export function checkGetContractMetadata(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const address = String(args[0])

	const caps = grantsOfType<ContractsCapability>(grants, "contracts")
	if (!caps.length) return

	const permitted = caps.some((c) => c.canGetMetadata && inAddressList(address, c.contracts))
	if (!permitted) {
		throw new Error(`Scope violation: getContractMetadata targets ${address}, not permitted by granted contracts scope`)
	}
}

export function checkIsTokenRegistered(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const address = String(args[0])

	const caps = grantsOfType<ContractsCapability>(grants, "contracts")
	if (!caps.length) return

	// Registration state is wallet-local metadata about a granted contract - the same consent
	// surface as getContractMetadata; the capability copy names the check explicitly.
	const permitted = caps.some((c) => c.canGetMetadata && inAddressList(address, c.contracts))
	if (!permitted) {
		throw new Error(`Scope violation: isTokenRegistered targets ${address}, not permitted by granted contracts scope`)
	}
}

export function checkGetContractClassMetadata(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const id = String(args[0])

	const caps = grantsOfType<ContractClassesCapability>(grants, "contractClasses")
	if (!caps.length) return

	const permitted = caps.some((c) => c.canGetMetadata && inAddressList(id, c.classes))
	if (!permitted) {
		throw new Error(`Scope violation: getContractClassMetadata targets class ${id}, not permitted by granted contractClasses scope`)
	}
}

function checkTransactionCalls(methodName: string, args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const exec = args[0] as WireExecPayload
	const calls = exec?.calls
	if (!Array.isArray(calls)) {
		throw new Error(`Scope enforcement: ${methodName} expects exec.calls to be an array`)
	}
	if (calls.length === 0) return // Vacuously true — no calls to restrict

	const caps = grantsOfType<TransactionCapability>(grants, "transaction")
	if (!caps.length) return

	const typedCalls = calls as WireCall[]
	const permitted = caps.some((c) => typedCalls.every((call) => matchesScope(String(call.to), call.name, c.scope)))
	if (!permitted) {
		const desc = typedCalls.map((c) => `${c.name}@${String(c.to)}`).join(", ")
		throw new Error(`Scope violation: ${methodName} calls [${desc}], not permitted by granted transaction scope`)
	}
}

export function checkGrantPublicAuthwit(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	// Granting a public authwit for method@contract authorizes a FUTURE
	// call with the user's funds — at least as powerful as sending that
	// call now, so it is gated by the same transaction scope.
	const content = args[1] as { contract?: unknown; method?: unknown } | undefined
	const contract = String(content?.contract)
	const method = String(content?.method)

	const caps = grantsOfType<TransactionCapability>(grants, "transaction")
	if (!caps.length) return

	const permitted = caps.some((c) => matchesScope(contract, method, c.scope))
	if (!permitted) {
		throw new Error(`Scope violation: grantPublicAuthwit authorizes ${method}@${contract}, not permitted by granted transaction scope`)
	}
}

function checkSimulationTransactions(methodName: string, args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const exec = args[0] as WireExecPayload
	const calls = exec?.calls
	if (!Array.isArray(calls)) {
		throw new Error(`Scope enforcement: ${methodName} expects exec.calls to be an array`)
	}
	if (calls.length === 0) return

	const caps = grantsOfType<SimulationCapability>(grants, "simulation")
	if (!caps.length) return

	const typedCalls = calls as WireCall[]
	// F-08: never dereference a raw-unknown call element. A null/non-object entry
	// (or one missing `to`) is malformed — surface a controlled scope error rather
	// than a `TypeError: null is not an object` from `call.to`. (simulateTx/profileTx
	// are checker-owned post-merge, so this deep guard lives here, not in the
	// dispatcher's `assertAuthRelevantArgShape`.) A non-string `name` is coerced
	// safely below and rejected by the downstream execution-layer Zod.
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
		const desc = typedCalls.map((c) => `${c.name}@${String(c.to)}`).join(", ")
		throw new Error(`Scope violation: ${methodName} calls [${desc}], not permitted by granted simulation.transactions scope`)
	}
}

export function checkExecuteUtility(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const call = args[0] as WireCall | undefined
	if (!call?.to || !call?.name) {
		throw new Error("Scope enforcement: executeUtility expects call with to and name fields")
	}
	const contract = String(call.to)
	const fn = call.name

	const caps = grantsOfType<SimulationCapability>(grants, "simulation")
	if (!caps.length) return

	const permitted = caps.some((c) => {
		const scope = c.utilities?.scope
		if (!scope) return false
		return matchesScope(contract, fn, scope)
	})
	if (!permitted) {
		throw new Error(`Scope violation: executeUtility calls ${fn}@${contract}, not permitted by granted simulation.utilities scope`)
	}
}

export function checkGetPrivateEvents(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const eventFilter = args[1] as Record<string, unknown> | undefined
	const address = String(eventFilter?.contractAddress)

	const caps = grantsOfType<DataCapability>(grants, "data")
	if (!caps.length) return

	const permitted = caps.some((c) => {
		const contracts = c.privateEvents?.contracts
		if (!contracts) return false
		return inAddressList(address, contracts)
	})
	if (!permitted) {
		throw new Error(`Scope violation: getPrivateEvents targets contract ${address}, not permitted by granted data.privateEvents scope`)
	}
}

/**
 * Check a call ({contract, function}) against the union of transaction and
 * simulation.transactions scopes on the given grants. Used by createAuthWit to
 * ensure an authwit cannot authorize a call broader than the dApp's granted
 * transaction scope.
 *
 * Returns true if any grant's scope covers the call, or if there are no
 * transaction/simulation grants at all (which means the authwit is being
 * requested without a transaction capability — let the accounts-level check
 * decide).
 */
function callWithinTxOrSimulationScope(
	contract: string,
	fn: string,
	grants: GrantedCapabilityRecord[],
): { hasTxCaps: boolean; permitted: boolean } {
	const txCaps = grantsOfType<TransactionCapability>(grants, "transaction")
	const simCaps = grantsOfType<SimulationCapability>(grants, "simulation")
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
 * transaction/simulation scope. The dispatcher uses this to route a covered call
 * to silent execution and an uncovered call — or any `IntentInnerHash`, which
 * carries no call to check — to an explicit confirmation popup.
 */
export function isCreateAuthWitCoveredByTxOrSimulationScope(intent: unknown, grants: GrantedCapabilityRecord[]): boolean {
	if (!isCallIntent(intent)) return false
	const { permitted } = callWithinTxOrSimulationScope(String(intent.call.to), intent.call.name, grants)
	return permitted
}

export function checkCreateAuthWit(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const from = String(args[0])

	const caps = grantsOfType<AccountsCapability>(grants, "accounts")
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
			throw new Error(`Scope violation: createAuthWit for account ${from}, not permitted by granted accounts scope`)
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
			throw new Error(
				`Scope violation: createAuthWit authorizes ${fn}@${contract}, not permitted by granted transaction or simulation scope`,
			)
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
			throw new Error(
				`Scope violation: createAuthWit inner-hash authorizes consumer ${consumer}, not permitted by granted transaction or simulation scope`,
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

/**
 * F-003: enforce `AccountsCapability.canGet === true` before allowing a
 * dApp to read its session's account addresses via `getAccounts`. Prior to
 * this checker, the `getAccounts` method was in `EXEMPT_METHODS` and the
 * `canGet` sub-grant was decorative — the UI exposed the toggle but the
 * dispatcher ignored it.
 *
 * The `accounts` cap is "any-of": if at least one granted accounts cap has
 * `canGet === true`, the read is permitted. (Multiple `accounts` grants
 * exist in some legacy session shapes; `.some()` mirrors the existing
 * pattern in `checkCreateAuthWit`.)
 */
export function checkGetAccounts(_args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const caps = grantsOfType<AccountsCapability>(grants, "accounts")
	if (!caps.length) return
	if (!caps.some((c) => c.canGet === true)) {
		throw new Error("Scope violation: getAccounts requires accounts.canGet=true")
	}
}

/**
 * F-004: enforce `DataCapability.addressBook === true` before allowing
 * a dApp to read the user's address book via `getAddressBook`. Prior to
 * this checker, the `data` capability type-check passed regardless of
 * whether the `addressBook` sub-bit was set.
 */
export function checkGetAddressBook(_args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const caps = grantsOfType<DataCapability>(grants, "data")
	if (!caps.length) return
	if (!caps.some((c) => c.addressBook === true)) {
		throw new Error("Scope violation: getAddressBook requires data.addressBook=true")
	}
}

/**
 * F-004 (paired): same sub-grant check applies to `registerSender` — a
 * dApp with only an `addressBook: false` data grant should not be able to
 * inject sender aliases into the user's address book.
 */
export function checkRegisterSender(_args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const caps = grantsOfType<DataCapability>(grants, "data")
	if (!caps.length) return
	if (!caps.some((c) => c.addressBook === true)) {
		throw new Error("Scope violation: registerSender requires data.addressBook=true")
	}
}

// ── Named wrappers (lifted from the former inline arrows in METHOD_SCOPE_CHECKER) ──
// These exist so the registry's scopeCheck field can hold a STABLE function
// reference that parity tests compare by identity. Behavior is identical to the
// previous `(args, grants) => checkX("name", args, grants)` arrows.

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
 * class-id-scoped async gate land. (codex audit, aztec-5.0-upgrade.)
 */
export function checkRegisterContractClassDisabled(): never {
	throw new Error(
		"registerContractClass is intentionally disabled in Nulo pending contractClasses.canRegister support and class-id-scoped enforcement.",
	)
}
