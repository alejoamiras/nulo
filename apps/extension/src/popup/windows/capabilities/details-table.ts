/**
 * The Details table: every contract the grants reach, once, with the functions each permission
 * lists for it. Pure, over the grants the app would hold after Allow and the contracts the wallet
 * names, so a retained grant is listed and a name never comes from the request.
 */
import { ANY_CONTRACT } from "./permission-rows"

export type DetailsRow = {
	/** The contract as the app sent it; absent on the "Any contract" row. */
	address?: string
	/** The wallet's name for it, or "Any contract"; absent for a contract the wallet doesn't know. */
	name?: string
	/** Each column's functions as sent, "*" read as "Any function"; empty when not in the column. */
	simulate: string[]
	add: boolean
	transact: string[]
}

export type DetailsTable = {
	known: DetailsRow[]
	unknown: DetailsRow[]
	anyContract: DetailsRow | null
	/** What follows "Details ·". */
	label: string
}

const ANY_FUNCTION = "Any function"

type Collected = { listed: Map<string, DetailsRow>; anyContract: DetailsRow | null }

export function buildDetailsTable(grants: readonly unknown[], knownContracts: readonly { address: string; name: string }[]): DetailsTable {
	const into: Collected = { listed: new Map(), anyContract: null }
	for (const cap of grants) if (isRecord(cap)) collect(into, cap)
	const names = new Map(knownContracts.map((entry) => [entry.address, entry.name]))
	const rows = [...into.listed.entries()].map(([key, row]) => {
		const name = names.get(key)
		return name === undefined ? row : { ...row, name }
	})
	return {
		known: rows.filter((row) => row.name !== undefined),
		unknown: rows.filter((row) => row.name === undefined),
		anyContract: into.anyContract,
		label: tableLabel(rows.length, into.anyContract !== null),
	}
}

function collect(into: Collected, cap: Record<string, unknown>): void {
	if (cap.type === "simulation") {
		for (const part of [cap.transactions, cap.utilities]) if (isRecord(part)) addScope(into, part.scope, "simulate")
	} else if (cap.type === "transaction") {
		addScope(into, cap.scope, "transact")
	} else if (cap.type === "contracts" && cap.canRegister === true) {
		for (const contract of Array.isArray(cap.contracts) ? cap.contracts : ["*"]) rowFor(into, contract).add = true
	}
}

/** A scope or pattern the wallet cannot read as one listed contract is read as any contract, as
 *  the scope checks read it, so the table never shows less reach than the grant has. */
function addScope(into: Collected, scope: unknown, column: "simulate" | "transact"): void {
	const patterns = Array.isArray(scope) ? scope : [{ contract: "*", function: "*" }]
	for (const pattern of patterns) {
		const record = isRecord(pattern) ? pattern : {}
		const fn = typeof record.function === "string" && record.function !== "*" ? record.function : ANY_FUNCTION
		const list = rowFor(into, record.contract)[column]
		if (!list.includes(fn)) list.push(fn)
	}
}

/** One row per contract, matched case-blind, in the order the grants first name it. */
function rowFor(into: Collected, contract: unknown): DetailsRow {
	if (typeof contract !== "string" || contract === "*") {
		into.anyContract ??= { name: ANY_CONTRACT, simulate: [], add: false, transact: [] }
		return into.anyContract
	}
	const key = contract.toLowerCase()
	const row = into.listed.get(key) ?? { address: contract, simulate: [], add: false, transact: [] }
	into.listed.set(key, row)
	return row
}

function tableLabel(listedCount: number, reachesAny: boolean): string {
	if (reachesAny) return "any contract"
	return `${listedCount} ${listedCount === 1 ? "contract" : "contracts"}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}
