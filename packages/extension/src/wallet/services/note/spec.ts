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

export type Methods = {
	/**
	 * Returns a list of private notes.
	 * @param networkId Network id.
	 * @param account Account address.
	 * @param contract Contract address the note belongs to.
	 */
	getNotes(networkId: string, account: string, contract?: string): Note[]
}
