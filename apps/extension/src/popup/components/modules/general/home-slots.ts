/**
 * Home's token rows before ordering and the cap. A listed default holds ONE slot from its
 * placeholder, through the import row its own persist step journals, to its token row. Until that
 * row lands it sorts as a never-synced row holding nothing, under its compiled-in name, which is how
 * its token row sorts: adding the defaults never shows a row and then takes it away. Matched by
 * contract, never by symbol.
 */
import { HOME_TOKEN_ROWS, type OrderableRow, capTokenRows } from "@/utils/token-order"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import type { SeedStatus, SeedStatusEntry } from "@/wallet/services/token/spec"

export type SlotTokenRow = OrderableRow & { id: number | string }
export type SlotImportOp = Pick<OperationRecord, "id" | "contractAddress" | "terminalAt">
export type SlotSeed = Pick<SeedStatusEntry, "chainId" | "contract" | "symbol" | "displayName" | "status">

export type HomeSlot<R extends SlotTokenRow, O extends SlotImportOp, S extends SlotSeed> = OrderableRow & {
	key: string
} & ({ kind: "token"; tb: R } | { kind: "import"; op: O } | { kind: "seed"; entry: S })

export type HomeSlots<R extends SlotTokenRow, O extends SlotImportOp, S extends SlotSeed> = {
	slots: HomeSlot<R, O, S>[]
	/** Imports of anything but a listed default: they stay above the list until they end. */
	userImports: O[]
}

const contractOf = (address: string | undefined) => address?.toLowerCase() ?? ""

/** `seeded` stays working until its balance row lands; `failed` and `rejected` have stopped. */
export const isSeedWorking = (status: SeedStatus) => status === "pending" || status === "seeding" || status === "seeded"

function pendingRow(seed: SlotSeed): OrderableRow {
	return {
		// Any valid decimals do: a zero balance reads the same at every scale.
		token: { chainId: seed.chainId, contract: seed.contract, name: seed.displayName, symbol: seed.symbol, decimals: 0 },
		publicBalance: "0",
		privateBalance: "0",
		updatedAt: 0,
	}
}

/** A running attempt stands for its default over a failed one still on show. */
const outranks = (op: SlotImportOp, held: SlotImportOp | undefined) =>
	held === undefined || (held.terminalAt !== null && op.terminalAt === null)

function splitImports<O extends SlotImportOp>(imports: readonly O[], defaults: ReadonlySet<string>, landed: ReadonlySet<string>) {
	const standing = new Map<string, O>()
	const userImports: O[] = []
	for (const op of imports) {
		const contract = contractOf(op.contractAddress)
		if (!defaults.has(contract)) userImports.push(op)
		else if (!landed.has(contract) && outranks(op, standing.get(contract))) standing.set(contract, op)
	}
	return { standing, userImports }
}

export function homeSlots<R extends SlotTokenRow, O extends SlotImportOp, S extends SlotSeed>(input: {
	rows: readonly R[]
	imports: readonly O[]
	seeds: readonly S[]
	chainId: number | undefined
}): HomeSlots<R, O, S> {
	const seeds = new Map(input.seeds.filter((s) => s.chainId === input.chainId).map((s) => [contractOf(s.contract), s]))
	const landed = new Set(input.rows.map((tb) => contractOf(tb.token.contract)))
	const { standing, userImports } = splitImports(input.imports, new Set(seeds.keys()), landed)
	const slots: HomeSlot<R, O, S>[] = input.rows.map((tb) => ({
		token: tb.token,
		publicBalance: tb.publicBalance,
		privateBalance: tb.privateBalance,
		updatedAt: tb.updatedAt,
		key: `token:${tb.id}`,
		kind: "token",
		tb,
	}))
	for (const [contract, seed] of seeds) {
		if (landed.has(contract)) continue
		const op = standing.get(contract)
		if (op) slots.push({ ...pendingRow(seed), key: `import:${op.id}`, kind: "import", op })
		else slots.push({ ...pendingRow(seed), key: `seed:${contract}`, kind: "seed", entry: seed })
	}
	return { slots, userImports }
}

const hasStopped = (slot: { kind: string; entry?: SlotSeed }) =>
	slot.kind === "seed" && slot.entry !== undefined && !isSeedWorking(slot.entry.status)

/** Home's cap, except that a default which stopped is never hidden: Home is the only place that
 *  shows it, with its reason and its Retry, so past the cap it follows the capped rows. */
export function capHomeSlots<T extends { kind: string; entry?: SlotSeed }>(ordered: readonly T[], budget = HOME_TOKEN_ROWS) {
	const { shown, overflow } = capTokenRows(ordered, budget)
	const stopped = ordered.slice(shown.length).filter(hasStopped)
	return { shown: [...shown, ...stopped], overflow: overflow - stopped.length }
}
