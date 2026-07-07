export const CONTACT_SERVICE_NAME = "contact"

/** EntityStorage root for contact rows (keyed by `contact.id`). Frozen:
 *  renaming detaches every existing row; the backup-migration registry pins it. */
export const CONTACT_STORAGE_ROOT = "nulo:core:contacts"

export type Contact = {
	/** Randomly generated contact id. */
	id: string
	/** Profile id. */
	profileId: string
	/** Contact name. */
	name: string
	/** Contact address. */
	address: string
	/** Contact name abbreviation (1–2 letters). */
	abbr: string
	// TODO: add chainId
}

export type Methods = {
	/**
	 * Returns a list of contacts.
	 */
	getContacts(): Contact[]

	/**
	 * Returns a contact with the specified id.
	 * @param id Contact id.
	 */
	getContact(id: string): Contact

	/**
	 * Returns a contact with the specified address.
	 * @param address Contact address.
	 */
	getContactByAddress(address: string): Contact | undefined

	/**
	 * Creates and returns a new contact.
	 * @param name Display name.
	 * @param address contact address.
	 */
	addContact(name: string, address: string): Contact

	/**
	 * Changes contact name and address and returns the updated contact.
	 * @param id Contact id.
	 * @param name New contact name.
	 * @param address New contact address.
	 */
	updateContact(id: string, name?: string, address?: string): Contact

	/**
	 * Deletes contact with the specified id.
	 * @param id Contact id.
	 */
	deleteContact(id: string): Contact

	/**
	 * Export all existing contacts to json.
	 */
	exportContacts(): string

	/**
	 * Import contacts from JSON.
	 * @param data Contact list in JSON format.
	 */
	importContacts(data: string): Contact[]
}

export type Events = {
	/** Emitted when a new contact is added */
	onContactAdded: Contact
	/** Emitted when an existing contact is updated */
	onContactUpdated: Contact
	/** Emitted when an existing contact is deleted */
	onContactDeleted: Contact
}
