/**
 * The permission window's cards and the grant it sends back. Pure, so the defaults, the data
 * halves and what a decision grants are unit-testable without the popup runtime.
 *
 * A card with a `switchLabel` has a switch; every other card is granted as requested. The
 * authorizations card is derived from the accounts capability's `canCreateAuthWit`, never looked
 * up by a dApp-sent type, so a dApp cannot paint a recognized card.
 */
import {
	authorizationsEffective,
	type Capability,
	coversAnyContract,
	type DataCapability,
	dataFieldsCovered,
	effectiveGrants,
} from "@nulo/wallet-bridge"
import { getCapabilityInfo, getSafeDisplay, type CapabilityRisk } from "@/wallet/services/dapp-session/capability-meta"
import {
	addressBookRow,
	authorizationsDefault,
	authorizationsRow,
	consentLostOnWidening,
	holdsCallScope,
	holdsCanCreateAuthWit,
	type PermissionRowEntry,
	plainText,
	privateEventsDefault,
	privateEventsRow,
	type RowKey,
	unknownRow,
} from "./permission-rows"

export type UICapabilityItem = {
	/** What the card's detail panel shows: a data card holds only its half. */
	capability: Capability
	/** Every unknown type the one unknown card grants, all or none. */
	panelCapabilities?: Capability[]
	rowKey: RowKey
	/** `data-cap-id`; absent on the unknown card, which stands for several types. */
	capId?: string
	label: string
	/** The line under the title; a switch card reads it while on. */
	description: string
	descriptionOff?: string
	switchLabel?: string
	isNew: boolean
	isUnknown: boolean
	selected: boolean
	risk: CapabilityRisk
	reRequested: boolean
}

export type CapabilityWindowParams = {
	delta: Capability[]
	existingGrants: Capability[]
	heldGrants: Capability[]
	reRequested: ReadonlySet<string>
	accountsMembershipOnly: boolean
	consent: unknown
}

const HIGH: CapabilityRisk = "high"

export function currentLine(item: UICapabilityItem): string {
	return item.switchLabel && !item.selected && item.descriptionOff !== undefined ? item.descriptionOff : item.description
}

export function buildCapabilityItems(params: CapabilityWindowParams): UICapabilityItem[] {
	const resulting = effectiveGrants(params.heldGrants, params.delta) as Capability[]
	const fresh: UICapabilityItem[] = []
	const unknowns: Capability[] = []
	for (const cap of params.delta) {
		if (cap.type === "accounts") fresh.push(...authorizationsItems(cap, params, resulting))
		else if (cap.type === "data") fresh.push(...newDataItems(cap, params))
		else if (getSafeDisplay(cap.type).isUnknown) unknowns.push(cap)
		else fresh.push(plainItem(cap, true, params.reRequested.has(cap.type)))
	}
	if (unknowns.length > 0) fresh.push(unknownItem(unknowns, params.reRequested))
	const widened = wideningItem(params, resulting)
	return [
		...(widened ? [widened] : []),
		...fresh,
		...params.existingGrants.filter((cap) => cap.type !== "data").map((cap) => plainItem(cap, false, false)),
		...heldDataItems(params),
	]
}

function plainItem(cap: Capability, isNew: boolean, reRequested: boolean): UICapabilityItem {
	const safe = getSafeDisplay(cap.type)
	return {
		capability: cap,
		rowKey: plainRowKey(cap),
		capId: cap.type,
		label: safe.label,
		description: safe.description,
		isNew,
		isUnknown: safe.isUnknown,
		selected: true,
		risk: getCapabilityInfo(cap.type).risk,
		reRequested,
	}
}

function plainRowKey(cap: Capability): RowKey {
	switch (cap.type) {
		case "accounts":
			return "account-address"
		case "contracts":
			return cap.canRegister === true ? "contracts" : "contract-details"
		case "contractClasses":
			return "contract-classes"
		case "simulation":
			return "simulation"
		case "transaction":
			return "transaction"
		default:
			return "unknown"
	}
}

function rowItem(
	row: PermissionRowEntry,
	cap: Capability,
	fields: Pick<UICapabilityItem, "isNew" | "selected" | "reRequested">,
): UICapabilityItem {
	const hasSwitch = fields.isNew && row.switchLabel !== undefined
	return {
		capability: cap,
		rowKey: row.key,
		capId: cap.type,
		label: row.title,
		description: plainText(row.subOn),
		...(hasSwitch ? { descriptionOff: plainText(row.subOff), switchLabel: row.switchLabel } : {}),
		isUnknown: false,
		risk: HIGH,
		...fields,
	}
}

/** On a membership-only widening the flag is already granted: the card is the held one, reading
 *  its stored state, and the decision never touches the consent. When the same request widens the
 *  scopes past a narrow consent, the widening card stands in for it. */
function authorizationsItems(cap: Capability, params: CapabilityWindowParams, resulting: Capability[]): UICapabilityItem[] {
	if (!Boolean((cap as { canCreateAuthWit?: unknown }).canCreateAuthWit)) return []
	if (params.accountsMembershipOnly) {
		return consentLostOnWidening(params.consent, params.heldGrants, resulting) ? [] : [heldAuthorizationsItem(cap, params)]
	}
	const row = authorizationsRow({ broad: coversAnyContract(resulting), noScope: !holdsCallScope(resulting) })
	const firstGrant = !holdsCanCreateAuthWit(params.heldGrants)
	const selected = row.switchLabel !== undefined && authorizationsDefault({ firstGrant, consent: params.consent, resulting })
	return [rowItem(row, cap, { isNew: true, selected, reRequested: params.reRequested.has("accounts") })]
}

function heldAuthorizationsItem(cap: Capability, params: CapabilityWindowParams): UICapabilityItem {
	const held = params.heldGrants
	const row = authorizationsRow({ broad: coversAnyContract(held), noScope: !holdsCallScope(held) })
	const effective = authorizationsEffective(params.consent, held)
	const item = rowItem(row, cap, { isNew: false, selected: true, reRequested: false })
	return { ...item, description: plainText(effective || !row.subOff ? row.subOn : row.subOff) }
}

/** A narrow consent the request widens to any contract no longer signs silently, so its card
 *  comes back first among the new ones, Off, whenever the accounts flags are not asked for again:
 *  a membership-only widening asks only which accounts. */
function wideningItem(params: CapabilityWindowParams, resulting: Capability[]): UICapabilityItem | undefined {
	const flagsAsked = params.delta.some((cap) => cap.type === "accounts") && !params.accountsMembershipOnly
	if (flagsAsked || !consentLostOnWidening(params.consent, params.heldGrants, resulting)) return undefined
	const accounts = params.heldGrants.find((cap) => cap.type === "accounts")
	if (!accounts) return undefined
	const row = authorizationsRow({ broad: true, noScope: false })
	return rowItem(row, accounts, { isNew: true, selected: false, reRequested: false })
}

function heldData(params: CapabilityWindowParams): DataCapability | undefined {
	return params.heldGrants.find((cap): cap is DataCapability => cap.type === "data")
}

/** A data row is new only when the held record does not already give its field. */
function newDataRows(cap: DataCapability, held: DataCapability | undefined): { addressBook: boolean; privateEvents: boolean } {
	const covered = dataFieldsCovered(held ? [held] : [], cap)
	return {
		addressBook: cap.addressBook === true && !covered.addressBook,
		privateEvents: cap.privateEvents !== undefined && !covered.privateEvents,
	}
}

function newDataItems(cap: DataCapability, params: CapabilityWindowParams): UICapabilityItem[] {
	const fresh = newDataRows(cap, heldData(params))
	const reRequested = params.reRequested.has("data")
	const items: UICapabilityItem[] = []
	if (fresh.addressBook) {
		const half: DataCapability = { type: "data", addressBook: true }
		items.push(rowItem(addressBookRow({ broadRequest: false }), half, { isNew: true, selected: true, reRequested }))
	}
	if (fresh.privateEvents && cap.privateEvents) {
		const half: DataCapability = { type: "data", privateEvents: cap.privateEvents }
		const selected = privateEventsDefault(cap.privateEvents.contracts)
		items.push(rowItem(privateEventsRow(cap.privateEvents.contracts), half, { isNew: true, selected, reRequested }))
	}
	return items
}

/** The halves of the held record the request does not newly ask for, read from every stored
 *  grant, so a record whose widening was declined still shows what it keeps. */
function heldDataItems(params: CapabilityWindowParams): UICapabilityItem[] {
	const held = heldData(params)
	if (!held) return []
	const requested = params.delta.find((cap): cap is DataCapability => cap.type === "data")
	const fresh = requested ? newDataRows(requested, held) : { addressBook: false, privateEvents: false }
	const items: UICapabilityItem[] = []
	const kept = { isNew: false, selected: true, reRequested: false }
	if (held.addressBook === true && !fresh.addressBook) {
		items.push(rowItem(addressBookRow({ broadRequest: false }), { type: "data", addressBook: true }, kept))
	}
	if (held.privateEvents && !fresh.privateEvents) {
		const half: DataCapability = { type: "data", privateEvents: held.privateEvents }
		items.push(rowItem(privateEventsRow(held.privateEvents.contracts), half, kept))
	}
	return items
}

/** Every unknown type is one card with one switch, Off: a later wallet that learns a type would
 *  honor a stored grant for it, so it is never granted by accident. */
function unknownItem(unknowns: Capability[], reRequested: ReadonlySet<string>): UICapabilityItem {
	const safe = getSafeDisplay(String(unknowns[0].type))
	return {
		capability: unknowns[0],
		panelCapabilities: unknowns,
		rowKey: "unknown",
		label: safe.label,
		description: safe.description,
		descriptionOff: safe.description,
		switchLabel: unknownRow(unknowns.length, { broadRequest: false }).switchLabel,
		isNew: true,
		isUnknown: true,
		selected: false,
		risk: getCapabilityInfo(String(unknowns[0].type)).risk,
		reRequested: unknowns.some((cap) => reRequested.has(String(cap.type))),
	}
}

export type GrantInput = {
	items: readonly UICapabilityItem[]
	delta: readonly Capability[]
	existingGrants: readonly Capability[]
	heldGrants: readonly Capability[]
	/** The picker ran and at least one account is selected. */
	accountsSelected: boolean
}

export type GrantDecision = {
	granted: Capability[]
	rejected: string[]
	/** Present only when the authorizations card showed its switch. */
	authorizationsWithoutAsking?: boolean
}

/**
 * What the window grants: switchless cards as requested, `canCreateAuthWit` as requested (Off means
 * ask, not remove), `data` rebuilt field by field, unknown types all or none. The background
 * validates and projects whatever this returns; this only decides which cards the person left on.
 */
export function buildGrant(input: GrantInput): GrantDecision {
	const deltaTypes = new Set(input.delta.map((cap) => String(cap.type)))
	const unknownOn = input.items.some((item) => item.rowKey === "unknown" && item.isNew && item.selected)
	const granted: Capability[] = []
	for (const cap of input.delta) {
		const decided = decideDeltaCap(cap, input, unknownOn)
		if (decided) granted.push(decided)
	}
	// An echo of a type the request also asks for would count as approving it.
	granted.push(...input.existingGrants.filter((cap) => !deltaTypes.has(String(cap.type))))
	const grantedTypes = new Set(granted.map((cap) => String(cap.type)))
	const authorizations = input.items.find((item) => item.rowKey === "authorizations" && item.switchLabel !== undefined)
	return {
		granted,
		rejected: [...deltaTypes].filter((type) => !grantedTypes.has(type)),
		...(authorizations ? { authorizationsWithoutAsking: authorizations.selected } : {}),
	}
}

function decideDeltaCap(cap: Capability, input: GrantInput, unknownOn: boolean): Capability | undefined {
	if (cap.type === "accounts") return input.accountsSelected ? cap : undefined
	if (cap.type === "data") return dataGrant(cap, input)
	if (getSafeDisplay(cap.type).isUnknown) return unknownOn ? cap : undefined
	return cap
}

/**
 * A new data row switched On takes the requested field; one left Off, and a row the held record
 * already gives, keep the held field. With every new row Off the type is rejected, which keeps the
 * whole held record, and a record giving neither field is never sent.
 */
function dataGrant(cap: DataCapability, input: GrantInput): DataCapability | undefined {
	const held = input.heldGrants.find((grant): grant is DataCapability => grant.type === "data")
	const row = (key: RowKey) => input.items.find((item) => item.rowKey === key && item.isNew)
	const book = row("address-book")
	const events = row("private-events")
	if (!book?.selected && !events?.selected) return undefined
	const addressBook = book?.selected ? cap.addressBook : held?.addressBook
	const privateEvents = events?.selected ? cap.privateEvents : held?.privateEvents
	if (addressBook !== true && privateEvents === undefined) return undefined
	return { type: "data", ...(addressBook === true ? { addressBook: true } : {}), ...(privateEvents ? { privateEvents } : {}) }
}
