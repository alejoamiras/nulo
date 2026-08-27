import { memoizeAsync } from "./async-memo"
import { _resetArtifactCatalogForTests, getCatalogEntry } from "./artifact-catalog"

/** Field types we know how to decode from a packed note. */
export type NoteFieldType = "u128" | "field" | "address"

export type NoteFieldSchema = {
	/** Field name as it appears in the source struct. */
	name: string
	/** Decoder type — drives how items[i] is rendered. */
	type: NoteFieldType
}

export type NoteSchema = {
	/** Display name for the note type (e.g., "UintNote", "NFTNote"). */
	noteName: string
	/** Friendly name of the parent contract (e.g., "Aztec Token", "Private FPC").
	 *  Surfaced in the notes-viewer header so a user can see what contract a
	 *  note came from without decoding the address. */
	contractName: string
	/** Schema fields in items[] order. */
	fields: NoteFieldSchema[]
}

/** Class id (hex) → storage slot (canonical hex `0x<lowercase>`) → schema. */
export type NoteSchemaMap = Map<string, Map<string, NoteSchema>>

/** Canonicalize a storage-slot Fr-string into the form used as map keys.
 *  Example: `0x0000…0003` → `0x3`. Stripping leading zeros makes the
 *  static schema map readable + matches the storageLayout slots. */
export function canonicalSlotHex(slotString: string): string {
	const v = BigInt(slotString)
	return `0x${v.toString(16)}`
}

const uintNote = (contractName: string): NoteSchema => ({
	noteName: "UintNote",
	contractName,
	fields: [{ name: "value", type: "u128" }],
})

const nftNote = (contractName: string): NoteSchema => ({
	noteName: "NFTNote",
	contractName,
	fields: [{ name: "token_id", type: "field" }],
})

/**
 * Production schemas for the bundled standards. Class ids come from the shared
 * {@link artifact-catalog} — the SAME computation `loadProductionKnownArtifacts`
 * uses — so a note schema can never be keyed off a class id that diverges from
 * known-artifact resolution. Resolved lazily on first call (the catalog hashes
 * each artifact once) and the built map is cached in a module-level promise.
 *
 * Only the four note-bearing artifacts are requested, so a transient failure
 * hashing an unrelated protocol artifact can't break note rendering.
 *
 * Slot numbers verified against each artifact's `storageLayout` at the pinned
 * aztec-packages release. Update this file when storage layouts shift in a
 * future bump.
 */
const schemasMemo = memoizeAsync<NoteSchemaMap>(async () => {
	const map: NoteSchemaMap = new Map()

	const token = await getCatalogEntry("token")
	map.set(token.classId, new Map([["0x3", uintNote("Aztec Token")]]))

	const nft = await getCatalogEntry("nft")
	map.set(nft.classId, new Map([["0x7", nftNote("Aztec NFT")]]))

	const wonderlandToken = await getCatalogEntry("wonderlandToken")
	map.set(wonderlandToken.classId, new Map([["0x7", uintNote("Wonderland Token")]]))

	const privateFpc = await getCatalogEntry("privateFpc")
	map.set(privateFpc.classId, new Map([["0x1", uintNote("Private FPC")]]))

	return map
})

export async function loadProductionNoteSchemas(): Promise<NoteSchemaMap> {
	return schemasMemo.get()
}

/** Reset the module-level cache. Test-only. Also resets the shared artifact
 *  catalog so class ids re-resolve — this stays the single authoritative reset
 *  note-schema callers/tests already use. */
export function _resetNoteSchemasForTests(): void {
	schemasMemo.reset()
	_resetArtifactCatalogForTests()
}
