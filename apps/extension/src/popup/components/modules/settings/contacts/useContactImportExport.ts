import type { Ref } from "vue"
import { useToast, TOAST_DURATION } from "@/composables/toast"
import { FileTooLargeError, downloadFile, pickFile, sanitizeString } from "@/utils"
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
 * Encapsulates the contacts page import/export flows: sender-union resolution
 * for export, file pick + parse + per-row upsert + sender restoration for
 * import, and the aggregate user-facing toasts.
 */
export function useContactImportExport(opts: UseContactImportExportOptions) {
	const { contacts, contactService, accountStateService } = opts
	const { openToast } = useToast()
	const deps: ContactIoDeps = {
		contacts,
		contactService,
		accountStateService,
		openToast,
		appStore: useAppStore(),
		cacheStore: useCacheStore(),
		popupStore: usePopupStore(),
	}
	return { exportContacts: () => exportContacts(deps), importContacts: () => importContacts(deps) }
}

interface ContactIoDeps {
	contacts: Ref<ContactRecord[]>
	contactService: ContactServiceClient
	accountStateService: AccountStateServiceClient
	openToast: ReturnType<typeof useToast>["openToast"]
	appStore: ReturnType<typeof useAppStore>
	cacheStore: ReturnType<typeof useCacheStore>
	popupStore: ReturnType<typeof usePopupStore>
}

type ImportRow = { name: string; address: string; isSender: boolean }
type SelectedRow = ContactRecord & { isSender?: boolean }
type UpsertError = { name: string; address: string; operation: string; error: unknown }
interface ImportTally {
	errors: UpsertError[]
	senderTotal: number
	senderOk: number
	senderSkippedNoNetwork: number
}

async function exportContacts(deps: ContactIoDeps): Promise<void> {
	const { contacts, accountStateService, openToast } = deps
	// `downloads` is a required manifest permission (always granted), so no runtime prompt/gesture
	// dance is needed — the download just happens.
	// OR-across-networks sender membership: a contact is exported with
	// `isSender: true` if registered on any active-status network in the
	// active profile. Down networks are silently skipped.
	let senderUnion = new Set<string>()
	try {
		const list = await accountStateService.getSendersAcrossActiveNetworks()
		senderUnion = new Set(list.map((a) => a.toLowerCase()))
	} catch (err) {
		console.warn("Failed to read sender union for export; isSender flags will all be false:", err)
	}

	const exportPayload = {
		version: 2,
		contacts: contacts.value.map((contact) => ({
			name: contact.name,
			address: contact.address,
			// Canonical compare: PXE senders are lowercase; a stored contact
			// may predate canonical-on-save — its registration must still
			// export as isSender:true or a file round-trip drops the flag.
			isSender: senderUnion.has(contact.address.toLowerCase()),
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

async function importContacts(deps: ContactIoDeps): Promise<void> {
	const { openToast, cacheStore, popupStore } = deps
	try {
		// The `.json` accept filter is UI guidance, not a boundary — a
		// `.gz`-named pick still auto-decompresses inside pickFile, so the
		// byte cap must ride along there too.
		const file = await pickFile(".json", true, true, MAX_CONTACT_IMPORT_BYTES)
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
		const importedContacts = normalizeImportRows(rawContacts)

		if (!importedContacts?.length) {
			openToast({ label: "No contacts found in file", icon: "info" })
			return
		}

		let res: SelectedRow[]
		try {
			res = await openImportSelection(cacheStore, popupStore, importedContacts)
		} catch {
			openToast({ label: "Contact import canceled", icon: "info" })
			return
		}

		if (!res.length) {
			openToast({ label: "No contacts selected for import", icon: "info" })
			return
		}

		const tally = await applyImportRows(deps, res)
		toastImportOutcome(openToast, tally)
	} catch (err) {
		if (err instanceof FileTooLargeError) {
			openToast({ label: "Contacts file is too large", icon: "warning" }, TOAST_DURATION.LONG)
			return
		}
		console.error("Error occurred during import", (err as Error)?.message || (err as Error)?.stack || err)
		openToast({ label: "Error occurred during import", icon: "warning" }, TOAST_DURATION.LONG)
	} finally {
		cacheStore.importContacts = []
		cacheStore.importPromise = null
	}
}

/** Construct MINIMAL rows — never spread the hostile input object (arbitrary extra properties
 *  would ride along into staging and storage). Non-string name/address fields become "" (a single
 *  malformed row must not abort the whole import); whitespace-only names are dropped
 *  (sanitizeString keeps spaces). Addresses are lowercased: hex is case-insensitive and the wallet
 *  emits lowercase, so canonicalizing here keeps dedup and duplicate-contact matching sound against
 *  mixed-case files. Per-address dedup (first row wins): duplicate addresses in a hostile file would
 *  multiply storage upserts and PXE sender registrations for the same target. */
function normalizeImportRows(rawContacts: Array<Record<string, unknown>>): ImportRow[] {
	const seenAddresses = new Set<string>()
	return rawContacts
		.map((c) => ({
			name: typeof c?.name === "string" ? sanitizeString(c.name, 20) : "",
			address: typeof c?.address === "string" ? sanitizeString(c.address, 66).toLowerCase() : "",
			isSender: c?.isSender === true,
		}))
		.filter((c) => !!c.name.trim() && !!c.address.trim())
		.filter((c) => {
			if (seenAddresses.has(c.address)) return false
			seenAddresses.add(c.address)
			return true
		})
}

/** Stage the rows, create the selection promise, REGISTER its controls on the cache store and open
 *  the popup — one synchronous unit; the caller awaits the returned promise (reject = canceled). */
function openImportSelection(
	cacheStore: ContactIoDeps["cacheStore"],
	popupStore: ContactIoDeps["popupStore"],
	rows: ImportRow[],
): Promise<SelectedRow[]> {
	for (const _c of rows) (cacheStore.importContacts as unknown[]).push(_c)

	const importPromise = new Promise<SelectedRow[]>((resolve, reject) => {
		;(cacheStore as unknown as { importPromise: unknown }).importPromise = { resolve, reject }
	})
	popupStore.open("import_contacts")
	return importPromise
}

/** Upsert every selected row, then register its sender intent. Import is adds-only toward sender
 *  state: rows explicitly carrying `isSender: true` (from a previous deliberate export) get registered
 *  on the active network. It never deletes or migrates registrations — those live in
 *  Settings → Advanced → Senders. */
async function applyImportRows(deps: ContactIoDeps, res: SelectedRow[]): Promise<ImportTally> {
	// Address keys are lowercased to match the canonicalized import rows —
	// an existing contact saved with mixed-case hex must merge, not
	// duplicate. (Name keys stay case-sensitive: names are labels.)
	const contactsByAddress = new Map<string, ContactRecord>()
	const contactsByName = new Map<string, ContactRecord>()
	for (const c of deps.contacts.value) {
		contactsByAddress.set(c.address.toLowerCase(), c)
		contactsByName.set(c.name, c)
	}

	// Snapshot active network ONCE so a network swap mid-loop can't split
	// sender registrations across chains. Null-safe: if no network is
	// selected, isSender:true rows produce a per-row sender failure.
	const activeNetworkId = deps.appStore.network?.id ?? null

	const tally: ImportTally = { errors: [], senderTotal: 0, senderOk: 0, senderSkippedNoNetwork: 0 }
	for (const _c of res) {
		const existingByAddress = contactsByAddress.get(_c.address.toLowerCase())
		const existingByName = contactsByName.get(_c.name)
		const error = await upsertOneContact(deps.contactService, _c, existingByAddress, existingByName)
		if (error) tally.errors.push(error)

		// Sender registration is INDEPENDENT of the contact upsert's
		// outcome (decoupled state): an explicit isSender intent is
		// attempted — and counted — even when the address-book row
		// failed, so the toast accounting never silently drops it.
		if (_c.isSender) {
			const pending = registerSenderForRow(deps.accountStateService, _c, activeNetworkId, tally)
			if (pending) await pending
		}
	}
	return tally
}

async function upsertOneContact(
	contactService: ContactServiceClient,
	row: SelectedRow,
	existingByAddress: ContactRecord | undefined,
	existingByName: ContactRecord | undefined,
): Promise<UpsertError | null> {
	try {
		if (existingByAddress) {
			await contactService.updateContact(existingByAddress.id, row.name, row.address)
		} else if (existingByName) {
			await contactService.updateContact(existingByName.id, row.name, row.address)
		} else {
			await contactService.addContact(row.name, row.address)
		}
		return null
	} catch (err) {
		return { name: row.name, address: row.address, operation: existingByAddress || existingByName ? "update" : "create", error: err }
	}
}

/** Counts the intent, then registers on the active network; returns the pending registration, or
 *  nothing when there is no network to register on (a synchronous skip, as before). */
function registerSenderForRow(
	accountStateService: AccountStateServiceClient,
	row: SelectedRow,
	activeNetworkId: string | null,
	tally: ImportTally,
): Promise<void> | undefined {
	tally.senderTotal++
	if (!activeNetworkId) {
		tally.senderSkippedNoNetwork++
		console.warn("Skipping sender registration: no active network")
		return undefined
	}
	return accountStateService.addSender(activeNetworkId, row.address).then(
		() => {
			tally.senderOk++
		},
		(err) => {
			// The counterparty address is PII and this fires per failed row; the counts below carry
			// the diagnosis.
			console.warn("Failed to register a sender", err)
		},
	)
}

function toastImportOutcome(openToast: ContactIoDeps["openToast"], tally: ImportTally): void {
	const { errors, senderTotal, senderOk, senderSkippedNoNetwork } = tally
	if (errors.length) {
		for (const e of errors) {
			// The contact's name and address are PII; the operation and the error are the
			// diagnosis, and the toast below already tells the user the import had failures.
			console.error(`Failed to ${e.operation} a contact`, e.error)
		}
		openToast({ label: "Import ended with errors", icon: "warning" }, TOAST_DURATION.LONG)
	} else if (senderTotal > 0 && senderOk < senderTotal) {
		// "Skipped" ≠ "failed": the no-network case was announced as a
		// skip by the import banner — the toast must say the same thing.
		const allSkipped = senderSkippedNoNetwork === senderTotal - senderOk && senderOk === 0
		const detail = allSkipped
			? "sender registrations skipped (no active network)"
			: senderOk === 0
				? "sender registration failed"
				: `${senderOk} of ${senderTotal} senders registered`
		openToast({ label: `Contacts imported · ${detail}`, icon: "warning" }, TOAST_DURATION.LONG)
	} else if (senderTotal > 0) {
		openToast({ label: `Contacts imported · ${senderOk} ${senderOk === 1 ? "sender" : "senders"} registered`, icon: "info" })
	} else {
		openToast({ label: "Import completed successfully", icon: "info" })
	}
}
