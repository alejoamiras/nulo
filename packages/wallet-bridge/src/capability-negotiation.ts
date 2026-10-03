/**
 * Consent planning for `requestCapabilities`: request projection, coverage of a request by the
 * stored grants, and the one decision a window's answer folds into. Pure: the dispatcher owns every
 * service call around it.
 */
import { formatCaipAccount, parseCaipAccount } from "./caip"
import type {
	AccountsCapability,
	Capability,
	ContractsCapability,
	DataCapability,
	GrantedCapabilityRecord,
	Scope,
	ScopePattern,
	SimulationCapability,
	TransactionCapability,
} from "./capabilities"
import type { CapabilityResult } from "./dapp-interaction-protocol"
import { isFieldAddress, sameFieldAddress } from "./field-address"
import { coversAnyContract, effectiveGrants, grantsOfType } from "./method-scope-checkers"
import type { IDappSessionRef } from "./session-types"
import { ValidationError } from "@nulo/extension-messaging/errors"
import { isRecord } from "@nulo/wallet-core/utils"

/** Whether every address+flag the request needs is already covered by the UNION of stored
 *  contracts grants. NOT equality: shrinking requests must not re-prompt; growing ones must
 *  (the type-only delta silently stranded new addresses after redeploys). */
function contractsRequestCovered(existing: ContractsCapability[], requested: ContractsCapability): boolean {
	const flagCovered = (flag: "canRegister" | "canGetMetadata"): boolean => {
		if (!requested[flag]) return true
		if (requested.contracts === "*") return existing.some((e) => e[flag] && e.contracts === "*")
		// Kept inline, not the checker's matcher: a malformed stored element must throw the same text.
		return requested.contracts.every((addr) =>
			existing.some((e) => e[flag] && (e.contracts === "*" || e.contracts.some((x) => sameFieldAddress(String(x), String(addr))))),
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
	// Kept inline, not the checker's matcher: a malformed stored element must throw the same text.
	return requested.every((rp) =>
		existing.some(
			(ep) =>
				(ep.contract === "*" || sameFieldAddress(String(ep.contract), String(rp.contract))) &&
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

/** Which of a `data` request's fields the held grants already give; a field the request does
 *  not ask for counts as given. */
export function dataFieldsCovered(held: DataCapability[], requested: DataCapability): { addressBook: boolean; privateEvents: boolean } {
	return {
		addressBook: requested.addressBook !== true || held.some((h) => h.addressBook === true),
		privateEvents: privateEventsCovered(held, requested.privateEvents?.contracts),
	}
}

function privateEventsCovered(held: DataCapability[], requested: "*" | string[] | undefined): boolean {
	if (!requested) return true
	if (requested === "*") return held.some((h) => h.privateEvents?.contracts === "*")
	return requested.every((addr) =>
		held.some((h) => {
			// An address-book-only grant legitimately has no list.
			const list = h.privateEvents?.contracts
			// Kept inline, not the checker's matcher: a malformed stored element must throw the same text.
			return list === "*" || (Array.isArray(list) && list.some((x) => sameFieldAddress(String(x), String(addr))))
		}),
	)
}

function dataRequestCovered(existing: DataCapability[], requested: DataCapability): boolean {
	const covered = dataFieldsCovered(existing, requested)
	return covered.addressBook && covered.privateEvents
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

function knownTypeOf(cap: unknown): Capability["type"] | undefined {
	return isRecord(cap) && typeof cap.type === "string" && isKnownCapabilityType(cap.type) ? cap.type : undefined
}

function malformed(): never {
	throw new Error("malformed capability")
}

function flagOf(cap: Record<string, unknown>, key: string): Record<string, boolean> {
	const value = cap[key]
	if (value === undefined) return {}
	if (typeof value !== "boolean") malformed()
	return { [key]: value }
}

function patternOf(pattern: unknown): ScopePattern {
	if (!isRecord(pattern)) malformed()
	const { contract, function: fn } = pattern
	if (!(contract === "*" || isFieldAddress(contract)) || typeof fn !== "string" || fn === "") malformed()
	return { contract, function: fn }
}

function scopeOf(scope: unknown): Scope {
	if (scope === "*") return "*"
	if (!Array.isArray(scope)) malformed()
	return scope.map(patternOf)
}

function scopeHolderOf(holder: unknown): { scope: Scope } {
	if (!isRecord(holder)) malformed()
	return { scope: scopeOf(holder.scope) }
}

function addressListOf(list: unknown): "*" | string[] {
	if (list === "*") return "*"
	if (!Array.isArray(list) || !list.every(isFieldAddress)) malformed()
	return [...list]
}

function accountListOf(list: unknown): Record<string, unknown>[] {
	if (!Array.isArray(list)) malformed()
	return list.map((entry) => {
		if (!isRecord(entry) || typeof entry.item !== "string") malformed()
		return { ...(typeof entry.alias === "string" ? { alias: entry.alias } : {}), item: entry.item }
	})
}

function optional<T>(cap: Record<string, unknown>, key: string, project: (value: unknown) => T): Record<string, T> {
	return cap[key] === undefined ? {} : { [key]: project(cap[key]) }
}

function projectData(cap: Record<string, unknown>): Record<string, unknown> {
	const addressBook = flagOf(cap, "addressBook")
	const privateEvents = optional(cap, "privateEvents", (holder) => {
		if (!isRecord(holder)) malformed()
		return { contracts: addressListOf(holder.contracts) }
	})
	// Asking for neither would open a window with no data row and record a rejection nobody chose;
	// an empty contract list asks for no private events.
	const events = privateEvents.privateEvents?.contracts
	const asksEvents = events === "*" || (events !== undefined && events.length > 0)
	if (addressBook.addressBook !== true && !asksEvents) malformed()
	return { type: "data", ...addressBook, ...privateEvents }
}

/** Copies only the fields the window, the predicates and the checkers read, validated and kept
 *  wire-shaped so the row MAC signs exactly what enforcement reads. */
const CAPABILITY_PROJECTORS: Record<Capability["type"], (cap: Record<string, unknown>) => Record<string, unknown>> = {
	accounts: (cap) => ({
		type: "accounts",
		...flagOf(cap, "canGet"),
		...flagOf(cap, "canCreateAuthWit"),
		...optional(cap, "accounts", accountListOf),
	}),
	contracts: (cap) => ({
		type: "contracts",
		contracts: addressListOf(cap.contracts),
		...flagOf(cap, "canRegister"),
		...flagOf(cap, "canGetMetadata"),
	}),
	contractClasses: (cap) => ({ type: "contractClasses", classes: addressListOf(cap.classes), ...flagOf(cap, "canGetMetadata") }),
	simulation: (cap) => ({
		type: "simulation",
		...optional(cap, "transactions", scopeHolderOf),
		...optional(cap, "utilities", scopeHolderOf),
	}),
	transaction: (cap) => ({ type: "transaction", scope: scopeOf(cap.scope) }),
	data: projectData,
}

/** A contracts permission with neither flag grants nothing the checkers honour, and wallet-sdk
 *  requires neither, so it is answered as asked and never negotiated or stored. */
export function grantsNothing(cap: Record<string, unknown>): boolean {
	return cap.type === "contracts" && cap.canRegister !== true && cap.canGetMetadata !== true
}

/** Validates a known capability and copies only its known fields; unknown types pass untouched.
 *  Every failure, a throw on a hostile value included, becomes one error naming only the type, so
 *  no request value reaches a log line. */
export function projectKnownCapability(cap: unknown): unknown {
	const type = knownTypeOf(cap)
	if (type === undefined) return cap
	try {
		return CAPABILITY_PROJECTORS[type](cap as Record<string, unknown>)
	} catch {
		throw new ValidationError(`Malformed ${type} capability`, { capabilityType: type })
	}
}

/** A known type named twice is refused: the grant would keep only one of them, so what the
 *  window shows and what is granted could differ. */
export function projectRequestedCapabilities(caps: readonly unknown[]): Record<string, unknown>[] {
	const seen = new Set<string>()
	return caps.map((cap) => {
		const projected = projectKnownCapability(cap)
		const type = knownTypeOf(projected)
		if (type !== undefined && seen.has(type)) {
			throw new ValidationError(`Duplicate ${type} capability`, { capabilityType: type })
		}
		if (type !== undefined) seen.add(type)
		return projected as Record<string, unknown>
	})
}

/** The session stores CAIP-10 identifiers ("aztec:<chainId>:0x…") but dApps send RAW
 *  hex addresses in scope arrays (the wallet-sdk serializes AztecAddress as hex), so
 *  the set carries BOTH representations. Without this, every fresh session failed
 *  account-scope validation deterministically; pre-CAIP sessions masked the mismatch. */
export function sessionAccountsOf(dappSession: IDappSessionRef): Set<string> {
	const sessionAccounts = new Set<string>()
	for (const entry of dappSession.accounts ?? []) {
		sessionAccounts.add(entry)
		try {
			sessionAccounts.add(parseCaipAccount(entry).address)
		} catch {
			// A raw (pre-CAIP) entry: keep it as-is; nothing extra to add.
		}
	}
	return sessionAccounts
}

export type CapabilityPlan = {
	existingGrants: GrantedCapabilityRecord[]
	grantedTypes: Set<string>
	rejectedTypes: Set<string>
	/** Capabilities the stored grants do not cover, plus rejected types whose coverage cannot be
	 *  read from their fields. */
	delta: Record<string, unknown>[]
	/** Existing grants shown to the popup — re-requested types are not "existing". */
	existingCaps: Capability[]
	/** The session's stored accounts, CAIP-10 and raw hex alike (`sessionAccountsOf`). */
	sessionAccounts: Set<string>
	/** The rows the picker was given (wallet-derived): the only accounts a decision may add. */
	availableAccounts?: Array<{ address: string; chainId: number }>
	/** Set when the popup's picker opens for a session that already holds an accounts grant: the
	 *  held rows are locked, and the decision only ever ADDS membership — with equal flags the
	 *  stored grant is never replaced (the popup's echo could otherwise drop `canCreateAuthWit`). */
	accountsWidening?: { granted: string[]; membershipOnly: boolean }
}

/** Profile accounts (raw hex) the session does not hold on this chain; hex compared case-blind. */
export function ungrantedAccounts(profileAddresses: readonly string[], sessionAddresses: ReadonlySet<string>): string[] {
	const held = new Set([...sessionAddresses].map((a) => a.toLowerCase()))
	return profileAddresses.filter((a) => !held.has(a.toLowerCase()))
}

/** Widening classification for a session that already holds an accounts grant. Membership-only
 *  (flags equal) is covered, so it joins the delta only with an account left to add; a field-diff
 *  is already in the delta and keeps the replacement path. */
export function planAccountsWidening(
	plan: CapabilityPlan,
	requested: AccountsCapability,
	held: ReadonlySet<string>,
	ungranted: readonly string[],
): void {
	const stored = grantsOfType(plan.existingGrants, "accounts")[0]
	if (stored === undefined) return
	const membershipOnly = accountsCapsEqual(stored, requested)
	const inDelta = plan.delta.some((cap) => cap.type === "accounts")
	if (membershipOnly && ungranted.length > 0 && !inDelta) plan.delta.push(requested as unknown as Record<string, unknown>)
	if (plan.delta.some((cap) => cap.type === "accounts")) plan.accountsWidening = { granted: [...held], membershipOnly }
}

/** Delta types with a stored rejection, read once the accounts widening is planned, so a type that
 *  left the delta carries no badge. */
export function reRequestedTypes(plan: CapabilityPlan): string[] {
	return plan.delta.map((cap) => cap.type as string).filter((type) => plan.rejectedTypes.has(type))
}

export function computeCapabilityDelta(requestedCapabilities: Record<string, unknown>[], dappSession: IDappSessionRef): CapabilityPlan {
	const existingGrants = dappSession.capabilityGrants ?? []
	const existingRejections = dappSession.capabilityRejections ?? []
	const grantedTypes = new Set<string>(existingGrants.map((g) => g.capability.type))
	const rejectedTypes = new Set(existingRejections.map((r) => r.capabilityType))

	// Unknown wire types keep the type-only rule: they flow through to the popup and render
	// default-off, so they are never dropped or coerced. Known types are projected by now and
	// checked field-aware, so a flag upgrade on a held type still opens the window.
	const delta = requestedCapabilities.filter((cap) => {
		const type = cap.type as string
		if (!isKnownCapabilityType(type)) return rejectedTypes.has(type) || !grantedTypes.has(type)
		// A declined widening left the held grant in force, so a request inside it needs no window;
		// not for `contractClasses`, whose coverage is type-only.
		if (type === "contractClasses" && rejectedTypes.has(type)) return true
		return !isCapabilityCovered(cap as unknown as Capability, existingGrants, grantedTypes)
	})
	const existingCaps = existingGrants.filter((g) => !rejectedTypes.has(g.capability.type)).map((g) => g.capability)
	return {
		existingGrants,
		grantedTypes,
		rejectedTypes,
		delta,
		existingCaps,
		sessionAccounts: sessionAccountsOf(dappSession),
	}
}

type CapabilityDecisionInput = {
	addAccounts: NonNullable<CapabilityResult["selectedAccounts"]>
	aliasPatch: NonNullable<CapabilityResult["accountAliases"]>
	grantRecords: GrantedCapabilityRecord[]
	replaceTypes: string[]
	approvedTypes: string[]
	rejectedTypes: string[]
	requiresGrant?: string[]
	authorizations?: { broad: boolean } | null
}

/** Folds the popup's answer into the ONE atomic decision the session row takes. */
export function mergeGrantsAndRejections(result: CapabilityResult, plan: CapabilityPlan): CapabilityDecisionInput {
	const grantedResults = ensureAccountsGrant(result, plan.delta)

	const approvedTypes = new Set(grantedResults.map((cap) => cap.type as string))
	const now = Date.now()
	const deltaApprovedTypes = new Set(plan.delta.filter((cap) => approvedTypes.has(cap.type as string)).map((cap) => cap.type as string))
	// A membership-only widening keeps the stored accounts grant: the popup's echo is not a
	// re-consent of the flags, so it must never replace the record.
	const keepAccountsGrant = plan.accountsWidening?.membershipOnly === true && deltaApprovedTypes.has("accounts")
	const newGrants = collectNewGrants(grantedResults, plan, deltaApprovedTypes, now).filter(
		(g) => !(keepAccountsGrant && g.capability.type === "accounts"),
	)

	const rejectedDeltaTypes = plan.delta.filter((cap) => !approvedTypes.has(cap.type as string)).map((cap) => cap.type as string)

	return {
		...accountsAdditions(result, plan),
		grantRecords: newGrants,
		replaceTypes: [...deltaApprovedTypes].filter((type) => !(keepAccountsGrant && type === "accounts")),
		// ONLY the delta types that were approved clear their rejection — NOT the
		// full grantedResults set (the popup echoes untouched existing caps, and
		// clearing their rejections would erase a concurrent unrelated rejection).
		approvedTypes: [...deltaApprovedTypes],
		rejectedTypes: rejectedDeltaTypes,
		...requiredGrants(result, plan, deltaApprovedTypes),
		...consentDecision(result, plan, newGrants),
	}
}

/** An added account and a consent are both given against the accounts grant the popup showed;
 *  revoked meanwhile, the writer refuses instead of writing to a session that no longer holds it. */
function requiredGrants(
	result: CapabilityResult,
	plan: CapabilityPlan,
	deltaApprovedTypes: Set<string>,
): Pick<CapabilityDecisionInput, "requiresGrant"> {
	const widening = plan.accountsWidening !== undefined && deltaApprovedTypes.has("accounts")
	const consentOnHeldAccounts = result.authorizationsWithoutAsking === true && !plan.delta.some((cap) => cap.type === "accounts")
	return widening || consentOnHeldAccounts ? { requiresGrant: ["accounts"] } : {}
}

/** The window's switch, read strictly since the popup's result arrives unvalidated: `true` stores a
 *  consent whose `broad` comes from the snapshot's grants as this decision leaves them, never from
 *  the popup or a later row; `false` deletes it. */
function consentDecision(
	result: CapabilityResult,
	plan: CapabilityPlan,
	grantRecords: GrantedCapabilityRecord[],
): Pick<CapabilityDecisionInput, "authorizations"> {
	if (result.authorizationsWithoutAsking === false) return { authorizations: null }
	if (result.authorizationsWithoutAsking !== true) return {}
	const after = effectiveGrants(
		plan.existingGrants.map((g) => g.capability),
		grantRecords.map((g) => g.capability),
	)
	return { authorizations: { broad: coversAnyContract(after) } }
}

/** Only accounts the picker OFFERED and the session does not already hold are added, and only
 *  their aliases are written. The popup's echo is not trusted for identity: a row the wallet never
 *  showed cannot be added, a held row's stored alias is never overwritten by the picker's default,
 *  and an alias for anything but an accepted addition is dropped. */
function accountsAdditions(result: CapabilityResult, plan: CapabilityPlan): Pick<CapabilityDecisionInput, "addAccounts" | "aliasPatch"> {
	if ((result.selectedAccounts?.length ?? 0) === 0) return { addAccounts: [], aliasPatch: {} }
	// Identities are the wallet's own CAIP spelling, never the echo's: the session stores and
	// projects them case-sensitively, so a re-spelled echo must map back or be dropped.
	const offered = new Map<string, string>(
		(plan.availableAccounts ?? []).map((a) => [
			formatCaipAccount(a.chainId, a.address).toLowerCase(),
			formatCaipAccount(a.chainId, a.address),
		]),
	)
	const held = new Set([...plan.sessionAccounts].map((entry) => entry.toLowerCase()))
	const addAccounts = [
		...new Set(
			(result.selectedAccounts ?? [])
				.map((caip) => offered.get(caip.toLowerCase()))
				.filter((caip): caip is string => caip !== undefined && !held.has(caip.toLowerCase())),
		),
	]
	const accepted = new Map(addAccounts.map((caip) => [caip.toLowerCase(), caip]))
	const aliasPatch: Record<string, string> = {}
	for (const [caip, alias] of Object.entries(result.accountAliases ?? {})) {
		const canonical = accepted.get(caip.toLowerCase())
		if (canonical !== undefined) aliasPatch[canonical] = alias
	}
	return { addAccounts, aliasPatch }
}

function ensureAccountsGrant(result: CapabilityResult, delta: Record<string, unknown>[]): Record<string, unknown>[] {
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
	return grantedResults
}

/** Approved DELTA types REPLACE their stored grant; never-granted types append. The popup echoes
 *  held caps beside the approved delta, so a replaced type takes the last answer entry of that type
 *  that differs from the stored capability, else the last answer entry of that type, and only when
 *  the answer has none, the delta's requested shape. */
function collectNewGrants(
	popupResults: Record<string, unknown>[],
	plan: CapabilityPlan,
	deltaApprovedTypes: Set<string>,
	now: number,
): GrantedCapabilityRecord[] {
	// Every cap stored from the popup's answer is projected like the manifest, so no field the page
	// adds is stored; an echo of a held grant the decision leaves alone is not re-validated.
	const project = (cap: Record<string, unknown>) => projectKnownCapability(cap) as Capability
	const replacementFor = (type: string): Capability | undefined => {
		const stored = plan.existingGrants.find((g) => g.capability.type === type)?.capability
		const candidates = popupResults.filter((cap) => cap.type === type).map(project)
		const changed = candidates.filter((cap) => JSON.stringify(cap) !== JSON.stringify(stored))
		return changed[changed.length - 1] ?? candidates[candidates.length - 1]
	}
	const newGrants: GrantedCapabilityRecord[] = []
	for (const cap of popupResults) {
		const type = cap.type as string
		if (deltaApprovedTypes.has(type)) continue // handled via replacement below (dedupes echoes).
		if (!plan.grantedTypes.has(type as Capability["type"]) || plan.rejectedTypes.has(type)) {
			newGrants.push({ capability: project(cap), grantedAt: now })
		}
	}
	for (const type of deltaApprovedTypes) {
		const replacement = replacementFor(type) ?? (plan.delta.find((c) => c.type === type) as unknown as Capability)
		newGrants.push({ capability: replacement, grantedAt: now })
	}
	return newGrants
}

/** Whether the held grants of `cap`'s type already cover it, so no window opens. Field-aware for
 *  every type but `contractClasses`, whose coverage is type-only (pinned in dispatcher.test.ts).
 *  Exhaustive over `Capability["type"]`, so a new variant forces a coverage decision instead of
 *  defaulting to covered (fail-open) or not (a spurious window). */
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

/** The `data` answer from the stored grant, so a field left off, or a widening declined, is not
 *  reported as granted. */
export function dataAnswer(grantedCaps: unknown[]): Record<string, unknown> {
	const stored = grantedCaps.find((c) => (c as Record<string, unknown>).type === "data") as DataCapability | undefined
	return {
		type: "data",
		addressBook: stored?.addressBook === true,
		...(stored?.privateEvents !== undefined ? { privateEvents: stored.privateEvents } : {}),
	}
}

/** The stored grant of the request's type. Only a request that grants nothing reaches the answer
 *  with none stored, so it answers for itself. */
export function storedGrantAnswer(grantedCaps: unknown[], requested: Record<string, unknown>): Record<string, unknown> {
	const stored = grantedCaps.find((c) => (c as Record<string, unknown>).type === requested.type)
	return (stored as Record<string, unknown> | undefined) ?? requested
}

/** Shape of the capability manifest sent by the dApp via requestCapabilities(). */
export type CapabilityManifest = {
	capabilities?: unknown[]
	[key: string]: unknown
}
