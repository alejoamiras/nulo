/**
 * Pre-extraction pins for the contacts import flow (codex conditions), complementing the sibling
 * suite (which already proves the byte cap, minimal rows, dedupe and adds-only senders):
 *   - the selection promise's CONTROLS are registered on the cache store BEFORE the popup opens, with
 *     the staged rows already in place, and settling through those controls settles the import;
 *   - per row the contact upsert settles before that row's sender attempt, which is counted even
 *     when the upsert failed;
 *   - every early exit clears the cache store's staging + controls;
 *   - the toast ladder: contact errors (logged in order with the ORIGINAL error objects) win over
 *     sender failures; partial and total sender failures read differently.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ref } from "vue"

const openToastMock = vi.fn()
const pickFileMock = vi.fn()
const popupOpenMock = vi.fn()
const trace: string[] = []

const appStoreState: { network: { id: string; name: string } | null } = { network: { id: "net-1", name: "Testnet" } }
const cacheStoreState: {
	importContacts: unknown[]
	importPromise: { resolve: (rows: unknown[]) => void; reject: (v: unknown) => void } | null
} = { importContacts: [], importPromise: null }

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
	TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
}))
vi.mock("@/utils", () => ({
	FileTooLargeError: class FileTooLargeError extends Error {},
	downloadFile: vi.fn(),
	pickFile: (...args: unknown[]) => pickFileMock(...args),
	sanitizeString: (s: unknown, max: number) =>
		String(s ?? "")
			.trim()
			.slice(0, max),
}))
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), getActiveProfile: vi.fn().mockResolvedValue({ name: "p" }) }
	}),
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => appStoreState }))
vi.mock("@/stores/cache.store", () => ({ useCacheStore: () => cacheStoreState }))
vi.mock("@/stores/popup.store", () => ({ usePopupStore: () => ({ open: (...args: unknown[]) => popupOpenMock(...args) }) }))

import { FileTooLargeError } from "@/utils"
import { MAX_CONTACT_IMPORT_BYTES } from "@/utils/contacts-export-format"
import { useContactImportExport } from "./useContactImportExport"

const ADDR_A = `0x${"a".repeat(64)}`
const ADDR_B = `0x${"b".repeat(64)}`

function makeServices() {
	const contactService = {
		addContact: vi.fn(async (name: string) => {
			trace.push(`add:${name}`)
		}),
		updateContact: vi.fn(async () => {}),
	}
	const accountStateService = {
		addSender: vi.fn(async (_net: string, address: string) => {
			trace.push(`sender:${address === ADDR_A ? "A" : "B"}`)
		}),
		getSendersAcrossActiveNetworks: vi.fn().mockResolvedValue([]),
	}
	return { contactService, accountStateService }
}

function fileWith(payload: unknown, size?: number) {
	const raw = JSON.stringify(payload)
	pickFileMock.mockResolvedValueOnce({ size: size ?? raw.length, text: async () => raw })
}

const api = (services = makeServices(), contacts = ref([])) => useContactImportExport({ contacts, ...services } as never)

async function untilSelectionGate() {
	await vi.waitFor(() => {
		if (!cacheStoreState.importPromise) throw new Error("selection gate not reached")
	})
}

const twoSenders = {
	version: 2,
	contacts: [
		{ name: "A", address: ADDR_A, isSender: true },
		{ name: "B", address: ADDR_B, isSender: true },
	],
}

beforeEach(() => {
	vi.clearAllMocks()
	popupOpenMock.mockReset()
	trace.length = 0
	appStoreState.network = { id: "net-1", name: "Testnet" }
	cacheStoreState.importContacts = []
	cacheStoreState.importPromise = null
	vi.spyOn(console, "error").mockImplementation(() => {})
	vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
	vi.restoreAllMocks()
})

describe("importContacts — selection gate", () => {
	test("rows are staged and the promise CONTROLS are registered before the popup opens; settling through them settles the import", async () => {
		popupOpenMock.mockImplementation((name: string) => {
			trace.push(
				`open:${name}:${cacheStoreState.importPromise ? "controls-ready" : "no-controls"}:${cacheStoreState.importContacts.length}`,
			)
		})
		fileWith(twoSenders)
		const done = api().importContacts()
		await untilSelectionGate()
		expect(trace).toEqual(["open:import_contacts:controls-ready:2"])
		cacheStoreState.importPromise?.resolve([...(cacheStoreState.importContacts as never[])])
		await done
		expect(openToastMock).toHaveBeenLastCalledWith({ label: "Contacts imported · 2 senders registered", icon: "info" })
	})
})

describe("importContacts — per-row order and early exits", () => {
	test("a row's contact upsert settles BEFORE its sender attempt; the attempt is counted even when the upsert failed", async () => {
		const services = makeServices()
		let releaseA: () => void = () => {}
		services.contactService.addContact.mockImplementationOnce(
			() =>
				new Promise<void>((_, reject) => {
					releaseA = () => {
						trace.push("add:A:rejected")
						reject(new Error("row A failed"))
					}
				}),
		)
		fileWith(twoSenders)
		const done = api(services).importContacts()
		await untilSelectionGate()
		cacheStoreState.importPromise?.resolve([...(cacheStoreState.importContacts as never[])])
		await vi.waitFor(() => expect(services.contactService.addContact).toHaveBeenCalledTimes(1))
		expect(trace).toEqual([]) // row A's sender attempt waits for its upsert to settle
		releaseA()
		await done
		expect(trace).toEqual(["add:A:rejected", "sender:A", "add:B", "sender:B"])
		expect(services.accountStateService.addSender).toHaveBeenCalledTimes(2)
		// Contact errors win the toast and are logged with the ORIGINAL error object.
		expect(openToastMock).toHaveBeenLastCalledWith({ label: "Import ended with errors", icon: "warning" }, 4000)
		expect(console.error).toHaveBeenCalledWith("Failed to create a contact", expect.objectContaining({ message: "row A failed" }))
	})

	test.each<[string, () => void, string | null]>([
		["no file picked", () => pickFileMock.mockResolvedValueOnce(null), null],
		["file over the byte cap", () => fileWith(twoSenders, MAX_CONTACT_IMPORT_BYTES + 1), "Contacts file is too large"],
		["picker threw FileTooLargeError", () => pickFileMock.mockRejectedValueOnce(new FileTooLargeError()), "Contacts file is too large"],
		["no rows in the file", () => fileWith({ version: 2, contacts: [] }), "No contacts found in file"],
		[
			"read threw",
			() =>
				pickFileMock.mockResolvedValueOnce({
					size: 10,
					text: async () => {
						throw new Error("boom")
					},
				}),
			"Error occurred during import",
		],
	])("early exit (%s) clears the staging + controls", async (_label, arrange, toast) => {
		// Leftover staging from an interrupted earlier run must be wiped by this run's `finally` too.
		cacheStoreState.importContacts = ["stale-staging"]
		arrange()
		await api().importContacts()
		expect(cacheStoreState.importContacts).toEqual([])
		expect(cacheStoreState.importPromise).toBeNull()
		if (toast) expect(openToastMock.mock.calls.map((c) => (c[0] as { label: string }).label)).toContain(toast)
	})

	test.each<[string, (c: typeof cacheStoreState.importPromise) => void, string]>([
		["cancel", (c) => c?.reject(new Error("closed")), "Contact import canceled"],
		["nothing selected", (c) => c?.resolve([]), "No contacts selected for import"],
	])("selection gate exit (%s) toasts and clears", async (_label, settle, toast) => {
		fileWith(twoSenders)
		const done = api().importContacts()
		await untilSelectionGate()
		settle(cacheStoreState.importPromise)
		await done
		expect(openToastMock).toHaveBeenCalledWith(expect.objectContaining({ label: toast }))
		expect(cacheStoreState.importContacts).toEqual([])
		expect(cacheStoreState.importPromise).toBeNull()
	})
})

describe("importContacts — sender-failure toasts", () => {
	test("partial sender failure: `1 of 2 senders registered` (warning)", async () => {
		const services = makeServices()
		services.accountStateService.addSender.mockRejectedValueOnce(new Error("pxe down"))
		fileWith(twoSenders)
		const done = api(services).importContacts()
		await untilSelectionGate()
		cacheStoreState.importPromise?.resolve([...(cacheStoreState.importContacts as never[])])
		await done
		expect(openToastMock).toHaveBeenLastCalledWith({ label: "Contacts imported · 1 of 2 senders registered", icon: "warning" }, 4000)
	})

	test("total sender failure: `sender registration failed` (warning)", async () => {
		const services = makeServices()
		services.accountStateService.addSender.mockRejectedValue(new Error("pxe down"))
		fileWith(twoSenders)
		const done = api(services).importContacts()
		await untilSelectionGate()
		cacheStoreState.importPromise?.resolve([...(cacheStoreState.importContacts as never[])])
		await done
		expect(openToastMock).toHaveBeenLastCalledWith({ label: "Contacts imported · sender registration failed", icon: "warning" }, 4000)
	})
})
