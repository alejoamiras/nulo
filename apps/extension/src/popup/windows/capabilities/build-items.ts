/**
 * The permission window's rows and the grant it sends back. Pure, so the defaults, the data rows,
 * the fold and what a decision grants are unit-testable without the popup runtime.
 *
 * A new row with a `switchLabel` has a switch; every other new row is granted as requested. The
 * authorizations row is derived from the accounts capability's `canCreateAuthWit`, never looked up
 * by a dApp-sent type, so a dApp cannot paint a recognized row.
 */
import {
	type AccountsCapability,
	authorizationsEffective,
	type Capability,
	coversAnyContract,
	type DataCapability,
	dataFieldsCovered,
	effectiveGrants,
} from "@nulo/wallet-bridge"
import { isKnownCapability } from "@/wallet/services/dapp-session/capability-meta"
import {
	accountAddressRow,
	addressBookRow,
	authorizationsDefault,
	authorizationsRow,
	consentLostOnWidening,
	contractClassesRow,
	contractsRow,
	holdsCallScope,
	holdsCanCreateAuthWit,
	isBroadRequest,
	type PermissionRowEntry,
	privateEventsDefault,
	privateEventsRow,
	ROW_ORDER,
	type RowKey,
	type SubSegment,
	simulationRow,
	transactionRow,
	unknownRow,
} from "./permission-rows"

export type WindowRow = {
	entry: PermissionRowEntry
	/** `data-cap-id`; absent on the unknown row, which stands for several types. */
	capId?: string
	/** A new row sits in its group; a held one folds into "Already allowed", read-only. */
	isNew: boolean
	/** The switch's state; a row without a switch is granted as requested. */
	selected: boolean
	reRequested: boolean
}

export type CapabilityWindowParams = {
	delta: Capability[]
	existingGrants: Capability[]
	heldGrants: Capability[]
	reRequested: ReadonlySet<string>
	accountsMembershipOnly: boolean
	consent: unknown
	/** The dApp chain's name, which the contract-classes row names. */
	networkName: string
	/** The session's accounts, which the fold's address row names. */
	heldAccounts: readonly { name?: string }[]
}

export function currentLine(row: WindowRow): SubSegment[] {
	const { entry } = row
	return (entry.switchLabel !== undefined && !row.selected ? (entry.subOff ?? entry.subOn) : entry.subOn) ?? []
}

/** The new rows, then the held ones, each in the row list's order. */
export function buildCapabilityItems(params: CapabilityWindowParams): WindowRow[] {
	const resulting = effectiveGrants(params.heldGrants, params.delta) as Capability[]
	return [...byRowOrder(newRows(params, resulting)), ...byRowOrder(heldRows(params))]
}

function byRowOrder(rows: WindowRow[]): WindowRow[] {
	return [...rows].sort((a, b) => ROW_ORDER.indexOf(a.entry.key) - ROW_ORDER.indexOf(b.entry.key))
}

function newRows(params: CapabilityWindowParams, resulting: Capability[]): WindowRow[] {
	const broad = isBroadRequest(resulting)
	const rows: WindowRow[] = []
	const unknowns: Capability[] = []
	for (const cap of params.delta) {
		if (!isKnownCapability(cap.type)) {
			unknowns.push(cap)
			continue
		}
		const fresh = { isNew: true, selected: true, reRequested: params.reRequested.has(cap.type) }
		if (cap.type === "accounts") rows.push(...newAccountsRows(cap, params, resulting))
		else if (cap.type === "data") rows.push(...newDataRows(cap, params, broad))
		else rows.push(...plainRows(cap, params.networkName).map((entry) => ({ entry, capId: cap.type, ...fresh })))
	}
	if (unknowns.length > 0) {
		const reRequested = unknowns.some((cap) => params.reRequested.has(String(cap.type)))
		rows.push({ entry: unknownRow(unknowns.length, { broadRequest: broad }), isNew: true, selected: false, reRequested })
	}
	const widened = wideningRow(params, resulting)
	return widened ? [...rows, widened] : rows
}

/** The row a capability of a switchless type shows, whether new or held. */
function plainRows(cap: Capability, networkName: string): PermissionRowEntry[] {
	switch (cap.type) {
		case "contracts": {
			const entry = contractsRow(cap)
			return entry ? [entry] : []
		}
		case "contractClasses":
			return [contractClassesRow(networkName)]
		case "simulation":
			return [simulationRow(cap)]
		case "transaction":
			return [transactionRow(cap)]
		default:
			return []
	}
}

/** On a membership-only widening the flag is already granted: its row is the held one, and the
 *  decision never touches the consent. */
function newAccountsRows(cap: AccountsCapability, params: CapabilityWindowParams, resulting: Capability[]): WindowRow[] {
	const reRequested = params.reRequested.has("accounts")
	const rows: WindowRow[] = []
	if (cap.canGet === true) rows.push({ entry: accountAddressRow([]), capId: "accounts", isNew: true, selected: true, reRequested })
	if (cap.canCreateAuthWit !== true || params.accountsMembershipOnly) return rows
	const entry = authorizationsRow({ broad: coversAnyContract(resulting), noScope: !holdsCallScope(resulting) })
	const firstGrant = !holdsCanCreateAuthWit(params.heldGrants)
	const selected = entry.switchLabel !== undefined && authorizationsDefault({ firstGrant, consent: params.consent, resulting })
	return [...rows, { entry, capId: "accounts", isNew: true, selected, reRequested }]
}

/** A narrow consent the request widens to any contract no longer signs silently, so its row comes
 *  back among the new ones, Off, whenever the accounts flags are not asked for again: a
 *  membership-only widening asks only which accounts. */
function wideningRow(params: CapabilityWindowParams, resulting: Capability[]): WindowRow | undefined {
	const flagsAsked = params.delta.some((cap) => cap.type === "accounts") && !params.accountsMembershipOnly
	if (flagsAsked || !consentLostOnWidening(params.consent, params.heldGrants, resulting)) return undefined
	return {
		entry: authorizationsRow({ broad: true, noScope: false }),
		capId: "accounts",
		isNew: true,
		selected: false,
		reRequested: false,
	}
}

function heldData(params: CapabilityWindowParams): DataCapability | undefined {
	return params.heldGrants.find((cap): cap is DataCapability => cap.type === "data")
}

/** A data row is new only when the held record does not already give its field. */
function newDataFields(cap: DataCapability, held: DataCapability | undefined): { addressBook: boolean; privateEvents: boolean } {
	const covered = dataFieldsCovered(held ? [held] : [], cap)
	return {
		addressBook: cap.addressBook === true && !covered.addressBook,
		privateEvents: cap.privateEvents !== undefined && !covered.privateEvents,
	}
}

function newDataRows(cap: DataCapability, params: CapabilityWindowParams, broad: boolean): WindowRow[] {
	const fresh = newDataFields(cap, heldData(params))
	const base = { capId: "data", isNew: true, reRequested: params.reRequested.has("data") }
	const rows: WindowRow[] = []
	if (fresh.addressBook) rows.push({ ...base, entry: addressBookRow({ broadRequest: broad }), selected: true })
	if (fresh.privateEvents && cap.privateEvents) {
		const { contracts } = cap.privateEvents
		rows.push({ ...base, entry: privateEventsRow(contracts), selected: privateEventsDefault(contracts) })
	}
	return rows
}

/**
 * Every grant the app holds, from the snapshot's stored grants, so a grant whose widening was
 * declined still shows. Read-only: each switch row reads the line of its stored state.
 */
function heldRows(params: CapabilityWindowParams): WindowRow[] {
	const broad = isBroadRequest(params.heldGrants)
	const entries = params.heldGrants.flatMap((cap) => heldEntries(cap, params, broad).map((entry) => ({ entry, capId: cap.type })))
	const rows: WindowRow[] = entries.map(({ entry, capId }) => ({
		entry: readOnly(entry),
		capId,
		isNew: false,
		selected: true,
		reRequested: false,
	}))
	const unknowns = params.heldGrants.filter((cap) => !isKnownCapability(cap.type))
	if (unknowns.length === 0) return rows
	const entry = readOnly(unknownRow(unknowns.length, { broadRequest: broad }))
	return [...rows, { entry, isNew: false, selected: true, reRequested: false }]
}

function heldEntries(cap: Capability, params: CapabilityWindowParams, broad: boolean): PermissionRowEntry[] {
	if (cap.type === "accounts") {
		return [
			...(cap.canGet === true ? [accountAddressRow(params.heldAccounts)] : []),
			...(cap.canCreateAuthWit === true ? [heldAuthorizationsEntry(params)] : []),
		]
	}
	if (cap.type === "data") {
		return [
			...(cap.addressBook === true ? [addressBookRow({ broadRequest: broad })] : []),
			...(cap.privateEvents ? [privateEventsRow(cap.privateEvents.contracts)] : []),
		]
	}
	return plainRows(cap, params.networkName)
}

function heldAuthorizationsEntry(params: CapabilityWindowParams): PermissionRowEntry {
	const held = params.heldGrants
	const entry = authorizationsRow({ broad: coversAnyContract(held), noScope: !holdsCallScope(held) })
	const on = entry.switchLabel === undefined || authorizationsEffective(params.consent, held)
	return { ...entry, subOn: on ? entry.subOn : entry.subOff }
}

/** Read-only: no switch, and the one line the entry chose for the stored state. */
function readOnly(entry: PermissionRowEntry): PermissionRowEntry {
	const { switchLabel: _switch, subOff: _off, ...rest } = entry
	return rest
}

export type GrantInput = {
	rows: readonly WindowRow[]
	delta: readonly Capability[]
	existingGrants: readonly Capability[]
	heldGrants: readonly Capability[]
	/** The picker ran and at least one account is selected. */
	accountsSelected: boolean
}

export type GrantDecision = {
	granted: Capability[]
	rejected: string[]
	/** Present only when the authorizations row showed its switch. */
	authorizationsWithoutAsking?: boolean
}

/**
 * What the window grants: switchless rows as requested, `canCreateAuthWit` as requested (Off means
 * ask, not remove), `data` rebuilt field by field, unknown types all or none. The background
 * validates and projects whatever this returns; this only decides which rows the person left on.
 */
export function buildGrant(input: GrantInput): GrantDecision {
	const deltaTypes = new Set(input.delta.map((cap) => String(cap.type)))
	const unknownOn = input.rows.some((row) => row.entry.key === "unknown" && row.isNew && row.selected)
	const granted: Capability[] = []
	for (const cap of input.delta) {
		const decided = decideDeltaCap(cap, input, unknownOn)
		if (decided) granted.push(decided)
	}
	// An echo of a type the request also asks for would count as approving it.
	granted.push(...input.existingGrants.filter((cap) => !deltaTypes.has(String(cap.type))))
	const grantedTypes = new Set(granted.map((cap) => String(cap.type)))
	const authorizations = input.rows.find((row) => row.isNew && row.entry.key === "authorizations" && row.entry.switchLabel !== undefined)
	return {
		granted,
		rejected: [...deltaTypes].filter((type) => !grantedTypes.has(type)),
		...(authorizations ? { authorizationsWithoutAsking: authorizations.selected } : {}),
	}
}

function decideDeltaCap(cap: Capability, input: GrantInput, unknownOn: boolean): Capability | undefined {
	if (!isKnownCapability(cap.type)) return unknownOn ? cap : undefined
	if (cap.type === "accounts") return input.accountsSelected ? cap : undefined
	if (cap.type === "data") return dataGrant(cap, input)
	return cap
}

/**
 * A new data row switched On takes the requested field; one left Off, and a row the held record
 * already gives, keep the held field. With every new row Off the type is rejected, which keeps the
 * whole held record, and a record giving neither field is never sent.
 */
function dataGrant(cap: DataCapability, input: GrantInput): DataCapability | undefined {
	const held = input.heldGrants.find((grant): grant is DataCapability => grant.type === "data")
	const row = (key: RowKey) => input.rows.find((candidate) => candidate.entry.key === key && candidate.isNew)
	const book = row("address-book")
	const events = row("private-events")
	if (!book?.selected && !events?.selected) return undefined
	const addressBook = book?.selected ? cap.addressBook : held?.addressBook
	const privateEvents = events?.selected ? cap.privateEvents : held?.privateEvents
	if (addressBook !== true && privateEvents === undefined) return undefined
	return { type: "data", ...(addressBook === true ? { addressBook: true } : {}), ...(privateEvents ? { privateEvents } : {}) }
}
