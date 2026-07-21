/**
 * Unit tests for the contacts import/export composable, pinning the
 * decoupled sender semantics: import is ADDS-ONLY toward sender state
 * (explicit `isSender: true` rows, active network only, counted) and
 * never deletes or migrates a registration — including the merge-by-name
 * address-swap path that used to unregister the old address.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ref } from "vue"

// ── Mocks ────────────────────────────────────────────────────────────

const openToastMock = vi.fn()
const pickFileMock = vi.fn()
const ensurePermissionsMock = vi.fn()
const popupOpenMock = vi.fn()

const appStoreState: { network: { id: string; name: string } | null } = {
	network: { id: "net-1", name: "Testnet" },
}
const cacheStoreState: {
	importContacts: unknown[]
	importPromise: { resolve: (rows: unknown[]) => void; reject: (v: unknown) => void } | null
} = {
	importContacts: [],
	importPromise: null,
}

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
	TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
}))
vi.mock("@/utils", () => ({
	downloadFile: vi.fn(),
	pickFile: (...args: unknown[]) => pickFileMock(...args),
	sanitizeString: (s: unknown, max: number) =>
		String(s ?? "")
			.trim()
			.slice(0, max),
}))
vi.mock("@/utils/general", () => ({
	ensurePermissions: (...args: unknown[]) => ensurePermissionsMock(...args),
}))
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), getActiveProfile: vi.fn().mockResolvedValue({ name: "p" }) }
	}),
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => appStoreState }))
vi.mock("@/stores/cache.store", () => ({ useCacheStore: () => cacheStoreState }))
vi.mock("@/stores/popup.store", () => ({ usePopupStore: () => ({ open: popupOpenMock }) }))

import { useContactImportExport } from "./useContactImportExport"

// ── Helpers ──────────────────────────────────────────────────────────

function makeServices() {
	const contactService = {
		addContact: vi.fn().mockResolvedValue(undefined),
		updateContact: vi.fn().mockResolvedValue(undefined),
	}
	const accountStateService = {
		addSender: vi.fn().mockResolvedValue(undefined),
		deleteSender: vi.fn().mockResolvedValue(undefined),
		getSenders: vi.fn().mockResolvedValue([]),
		getSendersAcrossActiveNetworks: vi.fn().mockResolvedValue([]),
	}
	return { contactService, accountStateService }
}

function fileWith(payload: unknown) {
	const raw = JSON.stringify(payload)
	pickFileMock.mockResolvedValueOnce({ size: raw.length, text: async () => raw })
}

/** Drives importContacts() to its selection gate, then confirms ALL
 *  staged rows (what the popup's confirm does for a select-all user). */
async function runImport(api: ReturnType<typeof useContactImportExport>) {
	const done = api.importContacts()
	await vi.waitFor(() => {
		if (!cacheStoreState.importPromise) throw new Error("selection gate not reached")
	})
	cacheStoreState.importPromise?.resolve([...(cacheStoreState.importContacts as never[])])
	await done
}

const ADDR_A = `0x${"a".repeat(64)}`
const ADDR_B = `0x${"b".repeat(64)}`

beforeEach(() => {
	vi.clearAllMocks()
	appStoreState.network = { id: "net-1", name: "Testnet" }
	cacheStoreState.importContacts = []
	cacheStoreState.importPromise = null
})
afterEach(() => {
	vi.restoreAllMocks()
})

describe("useContactImportExport — import sender semantics (adds-only)", () => {
	test("isSender:true rows register on the ACTIVE network, counted in the toast", async () => {
		const { contactService, accountStateService } = makeServices()
		const api = useContactImportExport({ contacts: ref([]), contactService, accountStateService } as never)
		fileWith({
			version: 2,
			contacts: [
				{ name: "A", address: ADDR_A, isSender: true },
				{ name: "B", address: ADDR_B, isSender: false },
			],
		})

		await runImport(api)

		expect(contactService.addContact).toHaveBeenCalledTimes(2)
		expect(accountStateService.addSender).toHaveBeenCalledTimes(1)
		expect(accountStateService.addSender).toHaveBeenCalledWith("net-1", ADDR_A)
		expect(accountStateService.deleteSender).not.toHaveBeenCalled()
		expect(openToastMock).toHaveBeenCalledWith({ label: "Contacts imported · 1 sender registered", icon: "info" })
	})

	test("merge-by-name address swap NEVER unregisters the old address (adds-only pin)", async () => {
		const { contactService, accountStateService } = makeServices()
		// The old address IS a registered sender — the removed migration used
		// to delete it here even for isSender:false rows.
		accountStateService.getSenders.mockResolvedValue([ADDR_A])
		const existing = ref([{ id: "c1", name: "Alice", address: ADDR_A }])
		const api = useContactImportExport({ contacts: existing, contactService, accountStateService } as never)
		fileWith({ version: 2, contacts: [{ name: "Alice", address: ADDR_B, isSender: false }] })

		await runImport(api)

		expect(contactService.updateContact).toHaveBeenCalledWith("c1", "Alice", ADDR_B)
		expect(accountStateService.deleteSender).not.toHaveBeenCalled()
		expect(accountStateService.addSender).not.toHaveBeenCalled()
	})

	test("no active network: contact rows land, sender registration is skipped and surfaced", async () => {
		const { contactService, accountStateService } = makeServices()
		appStoreState.network = null
		const api = useContactImportExport({ contacts: ref([]), contactService, accountStateService } as never)
		fileWith({ version: 2, contacts: [{ name: "A", address: ADDR_A, isSender: true }] })

		await runImport(api)

		expect(contactService.addContact).toHaveBeenCalledTimes(1)
		expect(accountStateService.addSender).not.toHaveBeenCalled()
		// "Skipped", not "failed" — matches the popup banner's promise.
		expect(openToastMock).toHaveBeenCalledWith(
			{ label: "Contacts imported · sender registrations skipped (no active network)", icon: "warning" },
			expect.anything(),
		)
	})

	test("duplicate addresses in the file are deduped (first row wins) before any service call", async () => {
		const { contactService, accountStateService } = makeServices()
		const api = useContactImportExport({ contacts: ref([]), contactService, accountStateService } as never)
		fileWith({
			version: 2,
			contacts: [
				{ name: "First", address: ADDR_A, isSender: true },
				{ name: "Second", address: ADDR_A, isSender: true },
			],
		})

		await runImport(api)

		expect(contactService.addContact).toHaveBeenCalledTimes(1)
		expect(contactService.addContact).toHaveBeenCalledWith("First", ADDR_A)
		expect(accountStateService.addSender).toHaveBeenCalledTimes(1)
	})

	test("mixed-case duplicates canonicalize to one lowercase row (hex is case-insensitive)", async () => {
		const { contactService, accountStateService } = makeServices()
		const api = useContactImportExport({ contacts: ref([]), contactService, accountStateService } as never)
		fileWith({
			version: 2,
			contacts: [
				{ name: "Lower", address: ADDR_A, isSender: true },
				{ name: "Upper", address: ADDR_A.toUpperCase().replace("0X", "0x"), isSender: true },
			],
		})

		await runImport(api)

		expect(contactService.addContact).toHaveBeenCalledTimes(1)
		expect(contactService.addContact).toHaveBeenCalledWith("Lower", ADDR_A)
		expect(accountStateService.addSender).toHaveBeenCalledTimes(1)
		expect(accountStateService.addSender).toHaveBeenCalledWith("net-1", ADDR_A)
	})

	test("hostile extra properties are stripped at the boundary (minimal rows only)", async () => {
		const { contactService, accountStateService } = makeServices()
		const api = useContactImportExport({ contacts: ref([]), contactService, accountStateService } as never)
		fileWith({
			version: 2,
			contacts: [{ name: "A", address: ADDR_A, isSender: false, __proto__pollution: "x", selected: true, idx: 99 }],
		})

		const done = api.importContacts()
		await vi.waitFor(() => {
			if (!cacheStoreState.importPromise) throw new Error("selection gate not reached")
		})
		// Snapshot BEFORE resolving — the composable clears the staging
		// array once the import completes.
		const staged = { ...(cacheStoreState.importContacts[0] as Record<string, unknown>) }
		cacheStoreState.importPromise?.resolve([...(cacheStoreState.importContacts as never[])])
		await done

		expect(Object.keys(staged).sort()).toEqual(["address", "isSender", "name"])
	})

	test("a mixed-case existing contact MERGES with its lowercase import (no duplicate)", async () => {
		const { contactService, accountStateService } = makeServices()
		const existing = ref([{ id: "c1", name: "Alice", address: ADDR_A.toUpperCase().replace("0X", "0x") }])
		const api = useContactImportExport({ contacts: existing, contactService, accountStateService } as never)
		fileWith({ version: 2, contacts: [{ name: "Alice2", address: ADDR_A, isSender: false }] })

		await runImport(api)

		expect(contactService.addContact).not.toHaveBeenCalled()
		expect(contactService.updateContact).toHaveBeenCalledWith("c1", "Alice2", ADDR_A)
	})

	test("a malformed row (non-string fields) is dropped without aborting the import", async () => {
		const { contactService, accountStateService } = makeServices()
		const api = useContactImportExport({ contacts: ref([]), contactService, accountStateService } as never)
		fileWith({
			version: 2,
			contacts: [null, { name: 42, address: { evil: true } }, { name: "   ", address: ADDR_B }, { name: "Good", address: ADDR_A }],
		})

		await runImport(api)

		expect(contactService.addContact).toHaveBeenCalledTimes(1)
		expect(contactService.addContact).toHaveBeenCalledWith("Good", ADDR_A)
	})

	test("an explicit isSender intent is attempted and counted even when the contact upsert fails", async () => {
		const { contactService, accountStateService } = makeServices()
		contactService.addContact.mockRejectedValueOnce(new Error("storage down"))
		const api = useContactImportExport({ contacts: ref([]), contactService, accountStateService } as never)
		fileWith({ version: 2, contacts: [{ name: "A", address: ADDR_A, isSender: true }] })

		await runImport(api)

		expect(accountStateService.addSender).toHaveBeenCalledWith("net-1", ADDR_A)
		expect(openToastMock).toHaveBeenCalledWith({ label: "Import ended with errors", icon: "warning" }, expect.anything())
	})

	test("an oversized file is rejected by byte size before it is read", async () => {
		const { contactService, accountStateService } = makeServices()
		const api = useContactImportExport({ contacts: ref([]), contactService, accountStateService } as never)
		pickFileMock.mockResolvedValueOnce({
			size: 2_000_000,
			text: async () => {
				throw new Error("text() must not be called on an oversized file")
			},
		})

		await api.importContacts()

		expect(contactService.addContact).not.toHaveBeenCalled()
		expect(openToastMock).toHaveBeenCalledWith({ label: "Contacts file is too large", icon: "warning" }, expect.anything())
	})

	test("a sender-free import toasts plain success", async () => {
		const { contactService, accountStateService } = makeServices()
		const api = useContactImportExport({ contacts: ref([]), contactService, accountStateService } as never)
		fileWith([{ name: "A", address: ADDR_A }])

		await runImport(api)

		expect(contactService.addContact).toHaveBeenCalledTimes(1)
		expect(accountStateService.addSender).not.toHaveBeenCalled()
		expect(openToastMock).toHaveBeenCalledWith({ label: "Import completed successfully", icon: "info" })
	})
})

describe("useContactImportExport — export", () => {
	test("a mixed-case stored contact still exports isSender:true (canonical union compare)", async () => {
		const { contactService, accountStateService } = makeServices()
		ensurePermissionsMock.mockResolvedValue(true)
		accountStateService.getSendersAcrossActiveNetworks.mockResolvedValue([ADDR_A])
		const { downloadFile } = await import("@/utils")
		const mixedCase = ADDR_A.toUpperCase().replace("0X", "0x")
		const api = useContactImportExport({
			contacts: ref([{ id: "c1", name: "Legacy", address: mixedCase }]),
			contactService,
			accountStateService,
		} as never)

		await api.exportContacts()

		const payload = JSON.parse((vi.mocked(downloadFile).mock.calls.at(-1)?.[0] as { data: string }).data)
		expect(payload.contacts[0]).toEqual({ name: "Legacy", address: mixedCase, isSender: true })
	})

	test("isSender flags come from the cross-network sender union", async () => {
		const { contactService, accountStateService } = makeServices()
		ensurePermissionsMock.mockResolvedValue(true)
		accountStateService.getSendersAcrossActiveNetworks.mockResolvedValue([ADDR_A])
		const { downloadFile } = await import("@/utils")
		const contacts = ref([
			{ id: "c1", name: "A", address: ADDR_A },
			{ id: "c2", name: "B", address: ADDR_B },
		])
		const api = useContactImportExport({ contacts, contactService, accountStateService } as never)

		await api.exportContacts()

		const payload = JSON.parse((vi.mocked(downloadFile).mock.calls[0][0] as { data: string }).data)
		expect(payload.version).toBe(2)
		expect(payload.contacts).toEqual([
			{ name: "A", address: ADDR_A, isSender: true },
			{ name: "B", address: ADDR_B, isSender: false },
		])
	})
})
