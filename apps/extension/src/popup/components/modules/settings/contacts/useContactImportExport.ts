import type { Ref } from "vue"
import { useToast, TOAST_DURATION } from "@/composables/toast"
import { downloadFile, pickFile, sanitizeString } from "@/utils"
import { ensurePermissions } from "@/utils/general"
import { MAX_CONTACT_IMPORT_BYTES, parseContactsExport } from "@/utils/contacts-export-format"
import type { AccountStateServiceClient } from "@/wallet/services/account-state/client"
import type { ContactServiceClient } from "@/wallet/services/contact/client"
import { ProfileServiceClient } from "@/wallet/services/profile/client"
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"

interface ContactRecord {
	id: string
	name: string
	address: string
}

export interface UseContactImportExportOptions {
	contacts: Ref<ContactRecord[]>
	contactService: ContactServiceClient
	accountStateService: AccountStateServiceClient
}

/**
 * Encapsulates the contacts page import/export flows: downloads
 * permission preflight, sender-union resolution for export, file
 * pick + parse + per-row upsert + sender restoration for import,
 * and the aggregate user-facing toasts.
 */
export function useContactImportExport(opts: UseContactImportExportOptions) {
	const { contacts, contactService, accountStateService } = opts
	const { openToast } = useToast()
	const appStore = useAppStore()
	const cacheStore = useCacheStore()
	const popupStore = usePopupStore()

	async function exportContacts() {
		// Ask for the downloads permission FIRST while the user-gesture is
		// still active. If we did the slow sender-union query first, Chrome
		// silently denies the permission prompt (gesture window expires
		// after async work).
		const hasDownloadsPermission = await ensurePermissions({ permissions: ["downloads"] })
		if (!hasDownloadsPermission) {
			openToast({ label: "Permission for downloads not granted", icon: "warning" }, TOAST_DURATION.LONG)
			return
		}

		// OR-across-networks sender membership: a contact is exported with
		// `isSender: true` if registered on any active-status network in the
		// active profile. Down networks are silently skipped.
		let senderUnion = new Set<string>()
		try {
			const list = await accountStateService.getSendersAcrossActiveNetworks()
			senderUnion = new Set(list)
		} catch (err) {
			console.warn("Failed to read sender union for export; isSender flags will all be false:", err)
		}

		const exportPayload = {
			version: 2,
			contacts: contacts.value.map((contact) => ({
				name: contact.name,
				address: contact.address,
				isSender: senderUnion.has(contact.address),
			})),
		}

		let filename = "contacts.json"

		const profileService = new ProfileServiceClient()
		profileService.connect()

		try {
			const profile = await profileService.getActiveProfile()
			if (profile?.name) filename = `${profile.name}_${filename}`

			try {
				await downloadFile({ data: JSON.stringify(exportPayload, null, 2), filename })
				openToast({ label: "Contacts exported successfully", icon: "download" })
			} catch (err) {
				console.error("Export failed:", (err as Error)?.message || err)
				openToast({ label: "Failed to export contacts", icon: "warning" }, TOAST_DURATION.LONG)
			}
		} catch (err) {
			console.error(err)
		} finally {
			profileService.disconnect()
		}
	}

	async function importContacts() {
		try {
			const file = await pickFile(".json", true)
			if (!file) return

			// Byte-level bound BEFORE reading — `raw.length` in the parser counts
			// UTF-16 code units, so a heavily multi-byte file could otherwise
			// exceed the advertised ceiling before the parser sees it.
			if (file.size > MAX_CONTACT_IMPORT_BYTES) {
				openToast({ label: "Contacts file is too large", icon: "warning" }, TOAST_DURATION.LONG)
				return
			}

			const data = await file.text()
			const { contacts: rawContacts } = parseContactsExport(data) as { contacts: Array<Record<string, unknown>> }
			const seenAddresses = new Set<string>()
			// Construct MINIMAL rows — never spread the hostile input object
			// (arbitrary extra properties would ride along into staging and
			// storage). Non-string name/address fields become "" (a single
			// malformed row must not abort the whole import); whitespace-only
			// names are dropped (sanitizeString keeps spaces). Addresses are
			// lowercased: hex is case-insensitive and the wallet emits
			// lowercase, so canonicalizing here keeps dedup and duplicate-
			// contact matching sound against mixed-case files.
			const importedContacts = rawContacts
				.map((c) => ({
					name: typeof c?.name === "string" ? sanitizeString(c.name, 20) : "",
					address: typeof c?.address === "string" ? sanitizeString(c.address, 66).toLowerCase() : "",
					isSender: c?.isSender === true,
				}))
				.filter((c) => !!c.name.trim() && !!c.address.trim())
				// Per-address dedup (first row wins): duplicate addresses in a
				// hostile file would multiply storage upserts and PXE sender
				// registrations for the same target.
				.filter((c) => {
					if (seenAddresses.has(c.address)) return false
					seenAddresses.add(c.address)
					return true
				})

			if (!importedContacts?.length) {
				openToast({ label: "No contacts found in file", icon: "info" })
				return
			}

			for (const _c of importedContacts) (cacheStore.importContacts as unknown[]).push(_c)

			const importPromise = new Promise<Array<ContactRecord & { isSender?: boolean }>>((resolve, reject) => {
				;(cacheStore as unknown as { importPromise: unknown }).importPromise = { resolve, reject }
			})
			popupStore.open("import_contacts")

			let res: Array<ContactRecord & { isSender?: boolean }>
			try {
				res = await importPromise
			} catch {
				openToast({ label: "Contact import canceled", icon: "info" })
				return
			}

			if (!res.length) {
				openToast({ label: "No contacts selected for import", icon: "info" })
				return
			}

			// Address keys are lowercased to match the canonicalized import rows —
			// an existing contact saved with mixed-case hex must merge, not
			// duplicate. (Name keys stay case-sensitive: names are labels.)
			const contactsByAddress = new Map<string, ContactRecord>()
			const contactsByName = new Map<string, ContactRecord>()
			for (const c of contacts.value) {
				contactsByAddress.set(c.address.toLowerCase(), c)
				contactsByName.set(c.name, c)
			}

			// Snapshot active network ONCE so a network swap mid-loop can't split
			// sender registrations across chains. Null-safe: if no network is
			// selected, isSender:true rows produce a per-row sender failure.
			const activeNetworkId = appStore.network?.id ?? null

			const errors: Array<{ name: string; address: string; operation: string; error: unknown }> = []
			let senderTotal = 0
			let senderOk = 0

			// Import is adds-only toward sender state: rows explicitly carrying
			// `isSender: true` (from a previous deliberate export) get registered
			// on the active network. It never deletes or migrates registrations —
			// those live in Settings → Advanced → Senders.
			for (const _c of res) {
				const existingByAddress = contactsByAddress.get(_c.address.toLowerCase())
				const existingByName = contactsByName.get(_c.name)
				try {
					if (existingByAddress) {
						await contactService.updateContact(existingByAddress.id, _c.name, _c.address)
					} else if (existingByName) {
						await contactService.updateContact(existingByName.id, _c.name, _c.address)
					} else {
						await contactService.addContact(_c.name, _c.address)
					}
				} catch (err) {
					errors.push({
						name: _c.name,
						address: _c.address,
						operation: existingByAddress || existingByName ? "update" : "create",
						error: err,
					})
				}

				// Sender registration is INDEPENDENT of the contact upsert's
				// outcome (decoupled state): an explicit isSender intent is
				// attempted — and counted — even when the address-book row
				// failed, so the toast accounting never silently drops it.
				if (_c.isSender) {
					senderTotal++
					if (activeNetworkId) {
						try {
							await accountStateService.addSender(activeNetworkId, _c.address)
							senderOk++
						} catch (err) {
							console.warn(`Failed to register sender ${_c.address}`, err)
						}
					} else {
						console.warn(`Skipping sender registration for ${_c.address}: no active network`)
					}
				}
			}

			if (errors.length) {
				for (const e of errors) {
					console.error(`Failed to ${e.operation} contact ${e.name} ${e.address}`, e.error)
				}
				openToast({ label: "Import ended with errors", icon: "warning" }, TOAST_DURATION.LONG)
			} else if (senderTotal > 0 && senderOk < senderTotal) {
				const detail = senderOk === 0 ? "sender registration failed" : `${senderOk} of ${senderTotal} senders registered`
				openToast({ label: `Contacts imported · ${detail}`, icon: "warning" }, TOAST_DURATION.LONG)
			} else if (senderTotal > 0) {
				openToast({ label: `Contacts imported · ${senderOk} ${senderOk === 1 ? "sender" : "senders"} registered`, icon: "info" })
			} else {
				openToast({ label: "Import completed successfully", icon: "info" })
			}
		} catch (err) {
			console.error("Error occurred during import", (err as Error)?.message || (err as Error)?.stack || err)
			openToast({ label: "Error occurred during import", icon: "warning" }, TOAST_DURATION.LONG)
		} finally {
			cacheStore.importContacts = []
			cacheStore.importPromise = null
		}
	}

	return { exportContacts, importContacts }
}
