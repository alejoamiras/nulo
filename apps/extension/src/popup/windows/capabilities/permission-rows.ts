/**
 * Every row the permission window can show: its group, icon, title, lines, switch, flag and
 * default. Pure, so the window and Settings read one table and the defaults match what the
 * dispatcher enforces.
 */
import type { ContractsCapability, SimulationCapability, TransactionCapability } from "@nulo/wallet-bridge"
import { authorizationsEffective, coversAnyContract, isAnyContractScope } from "@nulo/wallet-bridge"

export type RowKey =
	| "account-address"
	| "simulation"
	| "contracts"
	| "contract-details"
	| "contract-classes"
	| "authorizations"
	| "address-book"
	| "private-events"
	| "unknown"
	| "transaction"

/** The order rows take inside a group, as the row list draws them. */
export const ROW_ORDER: readonly RowKey[] = [
	"account-address",
	"simulation",
	"contracts",
	"contract-details",
	"contract-classes",
	"authorizations",
	"address-book",
	"private-events",
	"unknown",
	"transaction",
]

export type RowGroup = "without-asking" | "if-you-allow" | "always-asks"

export const GROUP_ORDER: readonly RowGroup[] = ["without-asking", "if-you-allow", "always-asks"]

export const GROUP_LABELS: Record<RowGroup, string> = {
	"without-asking": "Without asking, it can",
	"if-you-allow": "If you allow, it can",
	"always-asks": "Always asks you first",
}

/** A `term` segment is the visible word of the dotted "authorization" glossary entry. */
export type SubSegment = { text: string } | { term: string }

export type PermissionRowEntry = {
	key: RowKey
	group: RowGroup
	icon: string
	title: string
	/** The line under the title; a switch row reads it while on, and `subOff` while off. */
	subOn?: SubSegment[]
	subOff?: SubSegment[]
	/** The switch's accessible name; a row without one has no switch. */
	switchLabel?: string
	flagged: boolean
	chip?: string
}

export const ANY_CONTRACT = "Any contract"

const DATA_OFF: SubSegment[] = [{ text: "Not shared. The app may ask again later." }]
const AUTH_ON: SubSegment[] = [{ text: "Nulo signs its " }, { term: "authorizations" }, { text: " without asking." }]
const AUTH_OFF: SubSegment[] = [{ text: "You confirm each " }, { term: "authorization" }, { text: " first." }]
const AUTH_BROAD_ON: SubSegment[] = [{ text: "For any call, on any contract." }]
const AUTH_BROAD_OFF: SubSegment[] = [
	{ text: "You confirm each " },
	{ term: "authorization" },
	{ text: " first. Off because it listed any contract." },
]
const PRIVATE_BALANCES: SubSegment[] = [{ text: "Results can include your private balances." }]
const EVENTS_ON: SubSegment[] = [{ text: "Private messages its contracts sent to your accounts, like a transfer you received." }]
const UNKNOWN_SUB: SubSegment[] = [{ text: "Nulo can't tell you what it allows." }]

/** The segments as one plain string, for surfaces that show no dotted term. */
export function plainText(segments: readonly SubSegment[] | undefined): string {
	return (segments ?? []).map((segment) => ("term" in segment ? segment.term : segment.text)).join("")
}

/** Names the one account the app sees by its wallet name. Several, none, or one the wallet no
 *  longer names read the sentence that needs no name. */
export function accountAddressRow(accounts: readonly { name?: string }[]): PermissionRowEntry {
	const only = accounts.length === 1 ? accounts[0].name : undefined
	const title = only ? `See ${only}'s address` : "See the addresses of the accounts you share"
	return { key: "account-address", group: "without-asking", icon: "visibility", title, flagged: false }
}

/** Either sub-scope reaching any contract makes the row "any contract"; only transactions can
 *  make authorizations broad, since utilities never authorize a call intent. */
export function simulationRow(cap: SimulationCapability): PermissionRowEntry {
	const scopes = [cap.transactions, cap.utilities].filter((holder) => holder !== undefined)
	const any = scopes.some((holder) => isAnyContractScope(holder.scope))
	return {
		key: "simulation",
		group: "without-asking",
		icon: "play_circle",
		title: any ? "Run simulations on any contract" : "Run simulations and read the results",
		subOn: PRIVATE_BALANCES,
		flagged: any,
		...(any ? { chip: ANY_CONTRACT } : {}),
	}
}

/** Registering implies reading metadata, so a request with both shows only the add row. */
export function contractsRow(cap: ContractsCapability): PermissionRowEntry | undefined {
	if (cap.canRegister === true) {
		const any = cap.contracts === "*"
		return {
			key: "contracts",
			group: "without-asking",
			icon: "add_circle",
			title: any ? "Add any contract to your wallet" : "Add contracts to your wallet",
			flagged: any,
			...(any ? { chip: ANY_CONTRACT } : {}),
		}
	}
	if (cap.canGetMetadata === true) {
		return {
			key: "contract-details",
			group: "without-asking",
			icon: "info",
			title: "See details of contracts in your wallet",
			flagged: false,
		}
	}
	return undefined
}

export function contractClassesRow(networkName: string): PermissionRowEntry {
	return {
		key: "contract-classes",
		group: "without-asking",
		icon: "code_blocks",
		title: `Look up contract code on ${networkName}`,
		subOn: [{ text: "Public information any node can give it." }],
		flagged: false,
	}
}

/** With no transaction or simulation scope every authorization asks, so a switch would do
 *  nothing and the row says so instead. */
export function authorizationsRow(state: { broad: boolean; noScope: boolean }): PermissionRowEntry {
	const base = { key: "authorizations", icon: "signature", title: "Act for you in transactions you approve" } as const
	if (state.noScope) return { ...base, group: "always-asks", subOn: AUTH_OFF, flagged: false }
	return {
		...base,
		group: "if-you-allow",
		subOn: state.broad ? AUTH_BROAD_ON : AUTH_ON,
		subOff: state.broad ? AUTH_BROAD_OFF : AUTH_OFF,
		switchLabel: "Authorizations without asking",
		flagged: state.broad,
	}
}

export function addressBookRow(state: { broadRequest: boolean }): PermissionRowEntry {
	return {
		key: "address-book",
		group: "if-you-allow",
		icon: "contacts",
		title: "See your address book",
		subOn: [{ text: "Every name and address you saved." }],
		subOff: DATA_OFF,
		switchLabel: "Share address book",
		flagged: state.broadRequest,
	}
}

export function privateEventsRow(contracts: "*" | readonly string[]): PermissionRowEntry {
	const any = contracts === "*"
	return {
		key: "private-events",
		group: "if-you-allow",
		icon: "mail_lock",
		title: any ? "See private events from any contract" : "See private events from its contracts",
		subOn: EVENTS_ON,
		subOff: DATA_OFF,
		switchLabel: "Share private events",
		flagged: any,
		...(any ? { chip: ANY_CONTRACT } : {}),
	}
}

export function unknownRow(count: number, state: { broadRequest: boolean }): PermissionRowEntry {
	return {
		key: "unknown",
		group: "if-you-allow",
		icon: "help",
		title: `Use ${count} ${count === 1 ? "permission" : "permissions"} Nulo doesn't recognize`,
		subOn: UNKNOWN_SUB,
		subOff: UNKNOWN_SUB,
		switchLabel: "Unknown permission",
		flagged: state.broadRequest,
	}
}

export function transactionRow(cap: TransactionCapability): PermissionRowEntry {
	const any = isAnyContractScope(cap.scope)
	return {
		key: "transaction",
		group: "always-asks",
		icon: "task_alt",
		title: any ? "Every transaction, on any contract" : "Every transaction",
		flagged: false,
	}
}

/** A request whose transactions or simulations reach any contract: the address-book and unknown
 *  rows are flagged only then. */
export function isBroadRequest(caps: readonly unknown[]): boolean {
	return (
		coversAnyContract(caps) ||
		caps.some((cap) => isRecord(cap) && cap.type === "simulation" && simulationRow(cap as SimulationCapability).flagged)
	)
}

/** Mirrors the dispatcher: without a transaction or `simulation.transactions` scope no call intent
 *  is ever covered, so every authorization opens the confirmation window. */
export function holdsCallScope(caps: readonly unknown[]): boolean {
	return caps.some((cap) => {
		if (!isRecord(cap)) return false
		if (cap.type === "transaction") return true
		return cap.type === "simulation" && isRecord(cap.transactions) && Boolean(cap.transactions.scope)
	})
}

export function holdsCanCreateAuthWit(caps: readonly unknown[]): boolean {
	return caps.some((cap) => isRecord(cap) && cap.type === "accounts" && Boolean(cap.canCreateAuthWit))
}

/**
 * The authorizations switch's starting state. A first grant starts On unless the grants reach any
 * contract; a re-request starts from the consent the window was opened with, over the grants the
 * app would hold after Allow.
 */
export function authorizationsDefault(input: { firstGrant: boolean; consent: unknown; resulting: readonly unknown[] }): boolean {
	if (input.firstGrant) return !coversAnyContract(input.resulting)
	return authorizationsEffective(input.consent, input.resulting)
}

/** A consent that signs silently today but would stop once the request widens the scopes to any
 *  contract, so the window asks about it again. */
export function consentLostOnWidening(consent: unknown, held: readonly unknown[], resulting: readonly unknown[]): boolean {
	return holdsCanCreateAuthWit(held) && authorizationsEffective(consent, held) && !authorizationsEffective(consent, resulting)
}

export function privateEventsDefault(contracts: "*" | readonly string[]): boolean {
	return contracts !== "*"
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}
