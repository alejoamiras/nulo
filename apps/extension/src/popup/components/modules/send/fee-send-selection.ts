import { UI_STORAGE_KEYS } from "@/popup/constants/storage-keys"
import { storageLocalGet, storageLocalRemove, storageLocalSet } from "@/utils/storage"
import type { SavedRecord, TransferSide } from "./fee-privacy"

const KEY = UI_STORAGE_KEYS.SEND_FEE_PAYMENT_METHODS
const SLOTS: readonly TransferSide[] = ["private", "public"]

type Blob = Record<string, unknown>

/** Extension storage is writable by anything that reaches the profile dir: every shape is checked, nothing is cast. */
const asObject = (value: unknown): Blob | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Blob) : undefined

function asRecord(value: unknown): SavedRecord | undefined {
	const obj = asObject(value)
	if (!obj) return undefined
	if (obj.type === "fj" || obj.type === "private_fpc") return { type: obj.type }
	if (obj.type !== "fpc") return undefined
	const id = asObject(obj.fpc)?.id
	return typeof id === "string" && id.length > 0 ? { type: "fpc", fpc: { id } } : undefined
}

function slotsOf(value: unknown): { private?: SavedRecord; public?: SavedRecord } {
	const obj = asObject(value)
	const out: { private?: SavedRecord; public?: SavedRecord } = {}
	if (!obj) return out
	for (const slot of SLOTS) {
		const rec = asRecord(obj[slot])
		if (rec) out[slot] = rec
	}
	return out
}

/** The account's two picks; anything malformed reads as absent. */
export function readSendSlots(raw: unknown, address: string): { private?: SavedRecord; public?: SavedRecord } {
	return slotsOf(asObject(raw)?.[address])
}

/** The whole map, re-parsed: a write never carries a malformed neighbour forward. */
function parseAll(raw: unknown): Record<string, { private?: SavedRecord; public?: SavedRecord }> {
	const out: Record<string, { private?: SavedRecord; public?: SavedRecord }> = {}
	for (const [address, value] of Object.entries(asObject(raw) ?? {})) {
		const slots = slotsOf(value)
		if (slots.private || slots.public) out[address] = slots
	}
	return out
}

export function withSendSlot(raw: unknown, address: string, slot: TransferSide, rec: SavedRecord): Blob {
	const all = parseAll(raw)
	const clean = asRecord(rec)
	if (clean) all[address] = { ...all[address], [slot]: clean }
	return all
}

/** Drops every pick naming the FPC, on every account and both slots. */
export function withoutFpc(raw: unknown, fpcId: string): Blob {
	const all = parseAll(raw)
	for (const [address, slots] of Object.entries(all)) {
		for (const slot of SLOTS) {
			if (slots[slot]?.fpc?.id === fpcId) delete slots[slot]
		}
		if (!slots.private && !slots.public) delete all[address]
	}
	return all
}

let chain: Promise<void> = Promise.resolve()

/** One link per call; the chain continues past a rejected link so a storage error cannot wedge later writes. */
function enqueue(step: () => Promise<void>): Promise<void> {
	const link = chain.then(step, step)
	chain = link.catch(() => undefined)
	return link
}

/**
 * The ONLY writer of the Send picks key. Read-modify-write on one module-scoped chain, so two
 * writers in one document cannot interleave their read and their write.
 */
export function mutateSendSelections(update: (raw: unknown) => Blob): Promise<void> {
	return enqueue(async () => {
		const stored = await storageLocalGet(KEY)
		await storageLocalSet({ [KEY]: update(stored[KEY]) })
	})
}

/** Removal rides the same chain: a pick queued before a reset must not land after it and resurrect the key. */
export function clearSendSelections(): Promise<void> {
	return enqueue(() => storageLocalRemove(KEY))
}

export async function loadSendSelections(): Promise<unknown> {
	return (await storageLocalGet(KEY))[KEY]
}
