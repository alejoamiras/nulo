export const NOTE_SERVICE_NAME = "note"

export type Note = {
	/** The contract address this note is created in. */
	contract: string
	/** The specific storage location of the note on the contract. */
	storageSlot: string
	/** The hash of the tx the note was created in. */
	txHash: string
	/** Data stored inside the note (decoded if it's a known type, or encoded otherwise). */
	rawContent: string[]
	/** Guessed type of the note (e.g., "UintNote", "NFTNote"). */
	type?: string
	/** Friendly name of the parent contract (e.g., "Aztec Token", "Private FPC"),
	 *  populated when the contract's class id is in the bundled-standards set. */
	contractName?: string
	/** Location in the contract storage. */
	location?: string
	/** Parsed (according to the guessed type) content. */
	content?: Record<string, string>
	/** When set, this note failed to parse — the page renders a fallback card. */
	renderError?: string
}

/** Note shape extended with the raw `NoteDao` identity + ordering fields that
 *  the popup-friendly `Note` shape strips. Used by background-side consumers
 *  (incoming-transfer discovery) that need the cryptographically-unique
 *  `siloedNullifier` for idempotent records and the block-index tuple for
 *  ordering. */
export type RawNote = Note & {
	/** Cryptographically unique per note (nullifier siloed under the
	 *  contract's address). Stable across PXE syncs; the unique key for
	 *  incoming-transfer records. */
	siloedNullifier: string
	/** Note's commitment hash. Stable per note. */
	noteHash: string
	/** L2 block the note was created in. Ordering field. */
	l2BlockNumber: number
	/** Index of the parent tx within the block. Ordering tiebreaker. */
	txIndexInBlock: number
	/** Index of the note within the tx. Ordering tiebreaker. */
	noteIndexInTx: number
}

export type Methods = {
	/**
	 * Returns a list of private notes (popup-friendly shape).
	 * @param networkId Network id.
	 * @param account Account address.
	 * @param contract Contract address the note belongs to.
	 */
	getNotes(networkId: string, account: string, contract?: string): Note[]
	/**
	 * Same as `getNotes` but exposes the raw `NoteDao` identity + ordering
	 * fields. Reserved for background-side consumers that key records by
	 * `siloedNullifier` or order by `(l2BlockNumber, txIndexInBlock,
	 * noteIndexInTx)`.
	 */
	getNotesRaw(networkId: string, account: string, contract?: string): RawNote[]
}
