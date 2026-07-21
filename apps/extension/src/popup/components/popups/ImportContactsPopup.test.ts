/**
 * Component tests for ImportContactsPopup's sender-consent banner: the
 * count of sender registrations the confirm would trigger is stated
 * explicitly, tracks selection, and disappears at zero.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"

// ── Mocks ────────────────────────────────────────────────────────────

const contactServiceMock = {
	getContacts: vi.fn().mockResolvedValue([]),
	disconnect: vi.fn(),
	onContactAdded: { add: vi.fn(), remove: vi.fn() },
	onContactUpdated: { add: vi.fn(), remove: vi.fn() },
	onContactDeleted: { add: vi.fn(), remove: vi.fn() },
}

const cacheStoreState: {
	importContacts: unknown[]
	importContact: unknown
	importPromise: unknown
} = { importContacts: [], importContact: null, importPromise: null }

// Vitest 4 requires `function` expressions (not arrow functions) for mocks
// instantiated with `new`.
vi.mock("@/wallet/services/contact/client", () => ({
	ContactServiceClient: vi.fn(function () {
		return contactServiceMock
	}),
}))
const appStoreState: { network: { id: string; name: string } | null } = {
	network: { id: "net-1", name: "Testnet" },
}
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => appStoreState,
}))
vi.mock("@/stores/cache.store", () => ({ useCacheStore: () => cacheStoreState }))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { import_contacts: { order: 1 } } }),
}))
vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: vi.fn() }),
	TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
}))

const STUBS = {
	Popup: { props: ["show"], template: "<div v-if='show'><slot /></div>" },
	PopupCard: { template: "<div><slot /></div>" },
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
	Button: { template: "<button><slot /></button>" },
	Checkbox: { template: "<input type='checkbox' />" },
	Transition: { template: "<div><slot /></div>" },
}

// Lazy import after vi.mock calls hoist
import ImportContactsPopup from "./ImportContactsPopup.vue"

const VALID_A = `0x${"a".repeat(64)}`
const VALID_B = `0x${"b".repeat(64)}`

async function mountWithStaged(staged: Array<Record<string, unknown>>) {
	cacheStoreState.importContacts = staged
	const w = mount(ImportContactsPopup, { props: { show: false }, global: { stubs: STUBS } })
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

beforeEach(() => {
	vi.clearAllMocks()
	appStoreState.network = { id: "net-1", name: "Testnet" }
	cacheStoreState.importContacts = []
	cacheStoreState.importPromise = null
	cacheStoreState.importContact = null
})
afterEach(() => {
	vi.restoreAllMocks()
})

describe("ImportContactsPopup — counted sender banner", () => {
	test("states the exact number of senders that will be registered", async () => {
		const w = await mountWithStaged([
			{ name: "A", address: VALID_A, isSender: true },
			{ name: "B", address: VALID_B, isSender: true },
		])
		expect(w.text()).toContain("2")
		expect(w.text()).toContain("senders will be registered on")
		expect(w.text()).toContain("Testnet")
	})

	test("uses the singular form for one sender", async () => {
		const w = await mountWithStaged([
			{ name: "A", address: VALID_A, isSender: true },
			{ name: "B", address: VALID_B, isSender: false },
		])
		expect(w.text()).toContain("sender will be registered on")
		expect(w.text()).not.toContain("senders will be registered on")
	})

	test("no banner when nothing selected would register a sender", async () => {
		const w = await mountWithStaged([{ name: "A", address: VALID_A, isSender: false }])
		expect(w.text()).not.toContain("will be registered on")
	})

	test("a mixed-case EXISTING contact marks its lowercase import row as an address duplicate", async () => {
		contactServiceMock.getContacts.mockResolvedValueOnce([
			{ id: "c1", name: "Legacy", address: VALID_A.toUpperCase().replace("0X", "0x") },
		])
		const w = await mountWithStaged([{ name: "Other", address: VALID_A, isSender: false }])
		// The "existing" tag renders for the staged row (canonical map lookup)
		// — a legacy mixed-case save must not present as a fresh row.
		expect(w.text()).toContain("existing")
	})

	test("no active network: states that registrations will be skipped (not a contradictory network name)", async () => {
		appStoreState.network = null
		const w = await mountWithStaged([{ name: "A", address: VALID_A, isSender: true }])
		expect(w.text()).toContain("No active network — sender registrations will be skipped.")
		expect(w.text()).not.toContain("will be registered on")
	})
})
