/**
 * Per-operation scope enforcement for wallet-sdk method calls.
 *
 * Checks that the specific contracts/functions targeted by a dApp operation
 * fall within the scope of the dApp's granted capabilities. This runs AFTER
 * type-level enforcement (enforceCapability) which ensures the capability
 * type itself is granted.
 *
 * The args structures mirror WalletSchema signatures and must be kept in sync
 * with buildNetworkOperation / buildAccountOperation in dispatcher.ts.
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

/** Shape of a function call as received over the wire (exec.calls entries). */
type WireCall = { to: unknown; name: string }

/** Shape of an execution payload containing calls. */
type WireExecPayload = { calls?: unknown }

// ── Helpers ───────────────────────────────────────────────────────────

function matchesPattern(contract: string, fn: string, pattern: ScopePattern): boolean {
	return (pattern.contract === "*" || String(pattern.contract) === contract) && (pattern.function === "*" || pattern.function === fn)
}

function matchesScope(contract: string, fn: string, scope: Scope): boolean {
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

function checkRegisterContract(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const instance = args[0] as Record<string, unknown> | undefined
	const address = String(instance?.address ?? instance)

	const caps = grantsOfType<ContractsCapability>(grants, "contracts")
	if (!caps.length) return // No contracts grants — let type-level enforcement handle it

	const permitted = caps.some((c) => c.canRegister && inAddressList(address, c.contracts))
	if (!permitted) {
		throw new Error(`Scope violation: registerContract targets ${address}, not permitted by granted contracts scope`)
	}
}

function checkGetContractMetadata(args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const address = String(args[0])

	const caps = grantsOfType<ContractsCapability>(grants, "contracts")
	if (!caps.length) return

	const permitted = caps.some((c) => c.canGetMetadata && inAddressList(address, c.contracts))
	if (!permitted) {
		throw new Error(`Scope violation: getContractMetadata targets ${address}, not permitted by granted contracts scope`)
	}
}

function checkGetContractClassMetadata(args: unknown[], grants: GrantedCapabilityRecord[]): void {
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

function checkExecuteUtility(args: unknown[], grants: GrantedCapabilityRecord[]): void {
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

function checkGetPrivateEvents(args: unknown[], grants: GrantedCapabilityRecord[]): void {
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

function checkCreateAuthWit(args: unknown[], grants: GrantedCapabilityRecord[]): void {
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

	// Raw Fr message hash (pre-computed by wallet-sdk) — no semantic info to
	// validate beyond the accounts-level check above.
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
function checkGetAccounts(_args: unknown[], grants: GrantedCapabilityRecord[]): void {
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
function checkGetAddressBook(_args: unknown[], grants: GrantedCapabilityRecord[]): void {
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
function checkRegisterSender(_args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const caps = grantsOfType<DataCapability>(grants, "data")
	if (!caps.length) return
	if (!caps.some((c) => c.addressBook === true)) {
		throw new Error("Scope violation: registerSender requires data.addressBook=true")
	}
}

/**
 * F-005: validate dApp-supplied account-scope arrays against the session's
 * approved account list. The dApp can pass `eventFilter.scopes`,
 * `opts.scopes`, or `opts.additionalScopes` — arrays of CAIP-10 accounts
 * the wallet should expose private state for during execution. Prior to
 * this helper, the dispatcher forwarded these arrays unchanged to PXE,
 * silently widening one granted account into N accounts.
 *
 * sessionAccounts is the set of CAIP-10 account identifiers the session
 * has approved (built from `dappSession.accounts`).
 *
 * Throws if any entry in the scope array is not in the approved set.
 * Returns silently if the scope field is absent or not an array (i.e. the
 * caller didn't pass it).
 */
function validateAccountScopes(scopeField: unknown, sessionAccounts: Set<string>, fieldName: string): void {
	if (!Array.isArray(scopeField)) return
	for (const entry of scopeField) {
		const addr = String(entry)
		if (!sessionAccounts.has(addr)) {
			throw new Error(`Scope violation: ${fieldName} contains ${addr}, not in session's approved accounts`)
		}
	}
}

// ── Method → checker map ──────────────────────────────────────────────

const METHOD_SCOPE_CHECKER: Record<string, (args: unknown[], grants: GrantedCapabilityRecord[]) => void> = {
	registerContract: checkRegisterContract,
	getContractMetadata: checkGetContractMetadata,
	getContractClassMetadata: checkGetContractClassMetadata,
	sendTx: (args, grants) => checkTransactionCalls("sendTx", args, grants),
	simulateTx: (args, grants) => checkSimulationTransactions("simulateTx", args, grants),
	profileTx: (args, grants) => checkSimulationTransactions("profileTx", args, grants),
	executeUtility: checkExecuteUtility,
	getPrivateEvents: checkGetPrivateEvents,
	createAuthWit: checkCreateAuthWit,
	// Phase 1 additions (F-003 + F-004):
	getAccounts: checkGetAccounts,
	getAddressBook: checkGetAddressBook,
	registerSender: checkRegisterSender,
}

// ── Main entry point ──────────────────────────────────────────────────

/**
 * Enforce per-operation scope against granted capabilities.
 *
 * Call this after enforceCapability() (type-level check). This function
 * checks that the specific contracts/functions targeted by the operation
 * fall within the scope of at least one matching grant.
 *
 * Methods without a scope dimension (getChainInfo, registerSender, etc.)
 * are silently skipped.
 */
export function enforceScope(methodName: string, args: unknown[], grants: GrantedCapabilityRecord[]): void {
	const checker = METHOD_SCOPE_CHECKER[methodName]
	if (!checker) return
	checker(args, grants)
}

/**
 * F-005: extended scope enforcement that ALSO validates dApp-supplied
 * account-scope arrays against the session's approved accounts.
 *
 * Closes the empty-`calls` fast path: F-005's account-scope check fires
 * even when `exec.calls = []` (which short-circuited `checkTransactionCalls`
 * and friends). A dApp could previously pass `{ calls: [], additionalScopes: [<other-account>] }`
 * and bypass enforcement because the contract/function checker exited
 * early on the empty-calls branch.
 *
 * `sessionAccounts` is the set of CAIP-10 account identifiers approved
 * for this session. Pass an empty set if no session — the caller (the
 * dispatcher) decides how to handle missing sessions; this function just
 * fails closed.
 */
export function enforceScopeWithSession(
	methodName: string,
	args: unknown[],
	grants: GrantedCapabilityRecord[],
	sessionAccounts: Set<string>,
): void {
	// First run the standard scope check.
	enforceScope(methodName, args, grants)

	// Then run the F-005 account-scope check. Runs regardless of whether
	// the calls-array check was satisfied or short-circuited.
	const exec = args[0] as Record<string, unknown> | undefined
	const opts = args[1] as Record<string, unknown> | undefined

	validateAccountScopes(exec?.scopes, sessionAccounts, `${methodName}.exec.scopes`)
	validateAccountScopes(opts?.scopes, sessionAccounts, `${methodName}.opts.scopes`)
	validateAccountScopes(opts?.additionalScopes, sessionAccounts, `${methodName}.opts.additionalScopes`)

	// getPrivateEvents takes `(eventMetadata, eventFilter)` where eventFilter
	// can also include a `scopes` array.
	if (methodName === "getPrivateEvents") {
		const eventFilter = args[1] as Record<string, unknown> | undefined
		validateAccountScopes(eventFilter?.scopes, sessionAccounts, `${methodName}.eventFilter.scopes`)
	}
}
