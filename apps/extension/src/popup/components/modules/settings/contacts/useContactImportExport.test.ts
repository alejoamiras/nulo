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
	pickFileMock.mockResolvedValueOnce({ text: async () => JSON.stringify(payload) })
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
		expect(openToastMock).toHaveBeenCalledWith({ label: "Contacts imported · 1 senders registered", icon: "info" })
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
		expect(openToastMock).toHaveBeenCalledWith(
			{ label: "Contacts imported · sender registration failed", icon: "warning" },
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
