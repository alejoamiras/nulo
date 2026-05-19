import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import { loadContractArtifact } from "@aztec/stdlib/abi"
import { NFTContractArtifact } from "@aztec/noir-contracts.js/NFT"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
// @ts-expect-error — raw JSON import via vite alias
import WonderlandTokenJson from "@wonderland-token-artifact"
// @ts-expect-error — raw JSON import via vite alias
import PrivateFPCJson from "@private-fpc-artifact"

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
 * Production schemas for the bundled standards. Class ids are computed
 * lazily on first call (Poseidon hashing the artifact) and the result is
 * cached in a module-level promise — same loader pattern as
 * `loadProductionKnownArtifacts`.
 *
 * Slot numbers verified against each artifact's `storageLayout` at the
 * pinned aztec-packages release. Update this file when storage layouts
 * shift in a future bump.
 */
let cachedSchemas: Promise<NoteSchemaMap> | null = null

export async function loadProductionNoteSchemas(): Promise<NoteSchemaMap> {
	if (cachedSchemas) return cachedSchemas
	cachedSchemas = (async () => {
		const map: NoteSchemaMap = new Map()

		const tokenClass = await getContractClassFromArtifact(TokenContractArtifact)
		map.set(tokenClass.id.toString(), new Map([["0x3", uintNote("Aztec Token")]]))

		const nftClass = await getContractClassFromArtifact(NFTContractArtifact)
		map.set(nftClass.id.toString(), new Map([["0x7", nftNote("Aztec NFT")]]))

		const wonderlandTokenArtifact = loadContractArtifact(WonderlandTokenJson)
		const wonderlandTokenClass = await getContractClassFromArtifact(wonderlandTokenArtifact)
		map.set(wonderlandTokenClass.id.toString(), new Map([["0x7", uintNote("Wonderland Token")]]))

		const privateFpcArtifact = loadContractArtifact(PrivateFPCJson)
		const privateFpcClass = await getContractClassFromArtifact(privateFpcArtifact)
		map.set(privateFpcClass.id.toString(), new Map([["0x1", uintNote("Private FPC")]]))

		return map
	})()
	try {
		return await cachedSchemas
	} catch (err) {
		// Allow retry after transient failure (matches ArtifactRegistry pattern).
		cachedSchemas = null
		throw err
	}
}

/** Reset the module-level cache. Test-only. */
export function _resetNoteSchemasForTests(): void {
	cachedSchemas = null
}
