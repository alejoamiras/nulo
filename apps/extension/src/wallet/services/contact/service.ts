import type { BrowserApi } from "@nulo/wallet-core/ports"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import type { ILogger } from "@/wallet/logger"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { purgeMalformedRows, purgeRows } from "@/wallet/services/purge-rows"
import { assertRestoreEpoch, captureRestoreEpochs } from "@/wallet/services/restore-fence"
import { restoreRows } from "@/wallet/services/restore-rows"
import { nextRandomId, preferOrReallocId } from "@/wallet/services/id-allocators"
import { requireOwnedRow } from "@/wallet/services/require-owned-row"
import { type RestoreGate, NOOP_RESTORE_GATE } from "@/e2e/restore-gate"
import { EntityStorage } from "@/wallet/storage"
import { Lock } from "@/wallet/utils"
import { getInitials, sanitizeString } from "@/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { type Contact, CONTACT_SERVICE_NAME, CONTACT_STORAGE_ROOT, ContactSchema, type Events, type Methods } from "./spec"

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
	public constructor(
		logger: ILogger,
		browserApi?: BrowserApi,
		private readonly restoreGate: RestoreGate = NOOP_RESTORE_GATE,
	) {
		super(CONTACT_SERVICE_NAME, logger)
		this.storage = browserApi
			? new EntityStorage<Contact>(CONTACT_STORAGE_ROOT, browserApi.storage.local, (raw) => ContactSchema.parse(raw))
			: new EntityStorage<Contact>(CONTACT_STORAGE_ROOT, chrome.storage.local, (raw) => ContactSchema.parse(raw))
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		// Profile-delete cleanup is now the coordinator's awaited `purgeForProfile` (D).
	}

	public async getContacts(): Promise<Contact[]> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)

		return (await this.storage.getValues()).filter((c) => c.profileId === profile.id)
	}

	public async getContact(contactId: string): Promise<Contact> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)

		return requireOwnedRow(await this.storage.get(contactId), profile.id, "invalid id")
	}

	public async getContactByAddress(contactAddress: string): Promise<Contact | undefined> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)

		// Case-insensitive: hex casing doesn't make a different address, and
		// stored rows may predate canonical-lowercase-on-save.
		const contact = (await this.storage.getValues()).filter(
			(c) => c.profileId === profile.id && c.address.toLowerCase() === contactAddress.toLowerCase(),
		)

		if (!contact.length) return undefined

		return contact[0]
	}

	public async addContact(name: string, address: string): Promise<Contact> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)

		return await this.lock.withLock(async () => {
			const id = await nextRandomId(this.storage)

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
		})
	}

	public async updateContact(contactId: string, name?: string, address?: string): Promise<Contact> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)

		return await this.lock.withLock(async () => {
			const contact = requireOwnedRow(await this.storage.get(contactId), profile.id, "invalid id")

			const newContact = {
				...contact,
				name: name || contact.name,
				abbr: name ? this._getAbbreviation(name) : contact.abbr,
				address: address || contact.address,
			}

			await this.storage.set(contactId, newContact)

			this.emit("onContactUpdated", newContact)

			return newContact
		})
	}

	public async deleteContact(contactId: string): Promise<Contact> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)

		return await this.lock.withLock(async () => {
			const contact = requireOwnedRow(await this.storage.get(contactId), profile.id, "invalid id")

			this.logDebug(`Remove contact #${contact.id} - ${contact.name}`)
			await this.storage.delete(contactId)

			this.emit("onContactDeleted", contact)

			return contact
		})
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
		const profile = await requireActiveProfile(this.profileService)

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
	/** Awaited profile-scoped purge, called by the deletion coordinator (relocated
	 *  from the removed fire-and-forget `onProfileDeleted` sub — finding D). */
	public async purgeForProfile(profileId: string): Promise<void> {
		await this.ensureInitialized()
		this.logDebug(`purgeForProfile ${profileId}: remove related contacts`)
		await this.lock.withLock(async () => {
			const contacts = (await this.storage.getValues()).filter((c) => c.profileId === profileId)
			await purgeRows(
				contacts,
				(contact) => {
					this.logDebug(`Remove contact #${contact.id} - ${contact.name}`)
					return this.storage.delete(contact.id)
				},
				(contact) => this.emit("onContactDeleted", contact),
			)
			// F-B23: raw second pass — a validation-failed row this profile owns is
			// invisible to getValues() and would otherwise survive the purge forever.
			await purgeMalformedRows(
				this.storage,
				(raw) => raw.profileId === profileId,
				(id) => this.logDebug(`purged malformed contact row ${id}`),
			)
		})
	}

	private _getAbbreviation(name: string): string {
		return getInitials(name)
	}

	public async backup(): Promise<Contact[]> {
		return await this.getContacts()
	}

	public async restore(contacts: Contact[]): Promise<Restored<Contact>[]> {
		await this.ensureInitialized()
		// Deletion fence captured at entry — before the e2e hold gate, the lock,
		// and the collision reads — so a deleteProfile completing during ANY later
		// park (including an injected gate) rejects every subsequent row write
		// instead of landing orphans post-purge.
		const deletion = this.profileService.getDeletionState()
		const epochs = captureRestoreEpochs(
			deletion,
			contacts.map((c) => (c as { profileId?: unknown } | null)?.profileId),
		)
		// E2e hold point: "service-restore" parks a PRE-finalize import RPC here
		// (this service restores inside the per-service loop, before
		// finalizeRestore), so a crash test can kill the worker at a known
		// pre-finalize phase. Production resolves immediately.
		await this.restoreGate.waitAt("service-restore")

		return await this.lock.withLock(async () => {
			return await restoreRows(contacts, async (contact) => {
				const id = await preferOrReallocId(this.storage, contact.id)
				const written = { ...contact, id }
				// Parse the persisted shape so a malformed backup contact is recorded as
				// restoreError, not silently written + codec-hidden on read.
				ContactSchema.parse(written)
				assertRestoreEpoch(deletion, epochs, written.profileId)
				await this.storage.set(id, written)
				return written
			})
		})
	}
}
