import type { BrowserApi } from "@nulo/wallet-core/ports"
import { toRestoreError } from "@/utils/restore-error"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import type { ILogger } from "@/wallet/logger"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { purgeRows } from "@/wallet/services/purge-rows"
import { EntityStorage } from "@/wallet/storage"
import { getRandomHex, Lock } from "@/wallet/utils"
import { sanitizeString } from "@/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { type Contact, CONTACT_SERVICE_NAME, type Events, type Methods } from "./spec"

export * from "./spec"

export class ContactService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"getContacts",
		"getContact",
		"getContactByAddress",
		"addContact",
		"updateContact",
		"deleteContact",
		"exportContacts",
		"importContacts",
	)
	public static name = CONTACT_SERVICE_NAME

	/** Declared startup deps — ensures ProfileService is fully started before we touch it. */
	public readonly dependencies = [ProfileService.name] as const

	public readonly onContactAdded = new EventHandler<Contact>()
	public readonly onContactUpdated = new EventHandler<Contact>()
	public readonly onContactDeleted = new EventHandler<Contact>()

	private readonly storage: EntityStorage<Contact>
	private readonly lock = new Lock()

	private profileService: ProfileService = null!

	/**
	 * @param browserApi — optional; if omitted, falls back to `chrome.storage`
	 *        directly (legacy behavior). Passed explicitly by the composition
	 *        root and by tests via FakeBrowserApi.
	 */
	public constructor(logger: ILogger, browserApi?: BrowserApi) {
		super(CONTACT_SERVICE_NAME, logger)
		this.storage = browserApi
			? new EntityStorage<Contact>("nulo:core:contacts", browserApi.storage.local)
			: new EntityStorage<Contact>("nulo:core:contacts", chrome.storage.local)
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		this.profileService.onProfileDeleted.add(this.onProfileDeleted)
	}

	public async getContacts(): Promise<Contact[]> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}

		return (await this.storage.getValues()).filter((c) => c.profileId === profile.id)
	}

	public async getContact(contactId: string): Promise<Contact> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}

		const contact = await this.storage.get(contactId)
		if (contact?.profileId !== profile.id) {
			throw new Error("invalid id")
		}

		return contact
	}

	public async getContactByAddress(contactAddress: string): Promise<Contact | undefined> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}

		const contact = (await this.storage.getValues()).filter((c) => c.profileId === profile.id && c.address === contactAddress)

		if (!contact.length) return undefined

		return contact[0]
	}

	public async addContact(name: string, address: string): Promise<Contact> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}

		try {
			await this.lock.enter()

			let id: string
			do {
				id = getRandomHex(8)
			} while (await this.storage.contains(id))

			const contact: Contact = {
				id,
				profileId: profile.id,
				name,
				address,
				abbr: this._getAbbreviation(name),
			}

			await this.storage.set(contact.id, contact)

			this.emit("onContactAdded", contact)

			return contact
		} finally {
			this.lock.leave()
		}
	}

	public async updateContact(contactId: string, name?: string, address?: string): Promise<Contact> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}

		try {
			await this.lock.enter()

			const contact = await this.storage.get(contactId)
			if (contact?.profileId !== profile.id) {
				throw new Error("invalid id")
			}

			const newContact = {
				...contact,
				name: name || contact.name,
				abbr: name ? this._getAbbreviation(name) : contact.abbr,
				address: address || contact.address,
			}

			await this.storage.set(contactId, newContact)

			this.emit("onContactUpdated", newContact)

			return newContact
		} finally {
			this.lock.leave()
		}
	}

	public async deleteContact(contactId: string): Promise<Contact> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}

		try {
			await this.lock.enter()

			const contact = await this.storage.get(contactId)
			if (contact?.profileId !== profile.id) {
				throw new Error("invalid id")
			}

			this.logDebug(`Remove contact #${contact.id} - ${contact.name}`)
			await this.storage.delete(contactId)

			this.emit("onContactDeleted", contact)

			return contact
		} finally {
			this.lock.leave()
		}
	}

	public async exportContacts(): Promise<string> {
		const contacts = await this.getContacts()
		const data = contacts.map((contact) => ({
			name: contact.name,
			address: contact.address,
		}))

		return JSON.stringify(data, null, 2)
	}

	public async importContacts(data: string): Promise<Contact[]> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}

		const results: Contact[] = []

		type importedContact = { name: string; address: string }
		const importedContacts = JSON.parse(data)
			.map((c: importedContact) => ({
				name: sanitizeString(c.name, 20),
				address: sanitizeString(c.address, 66),
			}))
			.filter((c: importedContact) => !!c.name && !!c.address)

		if (importedContacts.length) {
			const existingContacts = (await this.storage.getValues()).filter((c) => c.profileId === profile.id)
			const contactsByAddress = new Map<string, Contact>()
			const contactsByName = new Map<string, Contact>()

			existingContacts.forEach((contact) => {
				contactsByAddress.set(contact.address, contact)
				contactsByName.set(contact.name, contact)
			})

			for (const _c of importedContacts) {
				try {
					let contact: Contact

					const existingByAddress = contactsByAddress.get(_c.address)
					const existingByName = contactsByName.get(_c.name)

					if (existingByAddress) {
						contact = await this.updateContact(existingByAddress.id, _c.name, _c.address)

						this.logDebug(`Updated existing contact by address: ${_c.address}`)
					} else if (existingByName) {
						contact = await this.updateContact(existingByName.id, _c.name, _c.address)

						this.logDebug(`Updated existing contact by name: ${_c.name}`)
					} else {
						contact = await this.addContact(_c.name, _c.address)

						this.logDebug(`Added new contact: ${_c.name} - ${_c.address}`)
					}

					results.push(contact!)
				} catch (error) {
					this.logError(`Failed to import contact ${_c.name} - ${_c.address}`, getErrorMessage(error))
				}
			}
		}

		return results
	}

	/**
	 * Cascade a profile delete to its contacts.
	 *
	 * Sender registrations are NOT touched here: `NetworkService.onProfileDeleted`
	 * (network/service.ts:617) already iterates the deleted profile's networks
	 * and calls `purgeChain → pxeServiceClient.clearChainState(profileId, chainId)`
	 * which deletes `indexedDB pxe/${profileId}/${chainId}` — wiping the entire
	 * PXE database for that profile + chain, senders included. So senders for
	 * deleted profiles are cleaned up as a side-effect of the chain purge,
	 * not by this listener.
	 */
	private readonly onProfileDeleted = async (profile: ProfileInfo) => {
		this.logDebug(`Profile ${profile.id} deleted, remove related contacts`)
		try {
			await this.lock.enter()
			const contacts = (await this.storage.getValues()).filter((c) => c.profileId === profile.id)
			await purgeRows(
				contacts,
				(contact) => {
					this.logDebug(`Remove contact #${contact.id} - ${contact.name}`)
					return this.storage.delete(contact.id)
				},
				(contact) => this.emit("onContactDeleted", contact),
			)
		} finally {
			this.lock.leave()
		}
	}

	private _getAbbreviation(name: string): string {
		const words = name.trim().split(/\s+/)

		if (words.length > 1) {
			return (words[0][0] + words[1][0]).toUpperCase()
		}

		if (words.length === 1) {
			return words[0].substring(0, Math.min(words[0].length, 2)).toUpperCase()
		}

		return "AZ"
	}

	public async backup(): Promise<Contact[]> {
		return await this.getContacts()
	}

	public async restore(contacts: Contact[]): Promise<Restored<Contact>[]> {
		await this.ensureInitialized()

		const result: Restored<Contact>[] = []
		try {
			await this.lock.enter()

			for (const contact of contacts) {
				try {
					let id = contact.id
					while (await this.storage.contains(id)) {
						id = getRandomHex(8)
					}

					await this.storage.set(id, { ...contact, id })

					result.push({ ...contact, id })
				} catch (err) {
					result.push({
						...contact,
						restoreError: toRestoreError(err),
					})
				}
			}

			return result
		} finally {
			this.lock.leave()
		}
	}
}
