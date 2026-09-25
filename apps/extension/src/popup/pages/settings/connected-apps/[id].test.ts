import { createTestingPinia } from "@pinia/testing"
import { Icon, MaterialIcon, Toggle, Tooltip } from "@nulo/design"
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import PermissionRow from "@/components/composite/capabilities/PermissionRow.vue"
import ConnectedApp from "./[id].vue"

const mocks = vi.hoisted(() => ({
	openToast: vi.fn(),
	getDappSession: vi.fn(),
	setAuthorizationsWithoutAsking: vi.fn(),
	updated: [] as Array<(session: unknown) => void>,
}))

vi.mock("@/composables/toast.js", () => ({ useToast: () => ({ openToast: mocks.openToast }) }))
vi.mock("vue-router", () => ({ useRoute: () => ({ params: { id: "s1" } }), useRouter: () => ({ push: vi.fn(), go: vi.fn() }) }))
vi.mock("@aztec/wallet-sdk/crypto", () => ({ hashToEmoji: () => "" }))
vi.mock("@/wallet/services/account/client", () => ({ AccountServiceClient: vi.fn() }))
vi.mock("@/wallet/services/network/client", () => ({ NetworkServiceClient: vi.fn() }))
vi.mock("@/wallet/services/dapp-session/client", () => ({
	DappSessionServiceClient: vi.fn(function () {
		return {
			getDappSession: mocks.getDappSession,
			setAuthorizationsWithoutAsking: mocks.setAuthorizationsWithoutAsking,
			disconnect: vi.fn(),
			onDappSessionUpdated: { add: (fn: (session: unknown) => void) => mocks.updated.push(fn) },
			onDappSessionDeleted: { add: vi.fn() },
		}
	}),
}))

// The stores read `chrome.storage.local` through the migration-aware facade on setup.
beforeEach(() => {
	vi.stubGlobal("chrome", {
		storage: {
			local: {
				get: vi.fn(async () => ({})),
				set: vi.fn(async () => undefined),
				remove: vi.fn(async () => undefined),
			},
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
		runtime: { connect: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
	mocks.updated.length = 0
})

// Wire-shaped: 0x + 64 hex, below the field modulus.
const TOKEN = `0x${"1b".repeat(32)}`
const accounts = (canCreateAuthWit: boolean) => ({ type: "accounts", canGet: true, canCreateAuthWit })
const txListed = { type: "transaction", scope: [{ contract: TOKEN, function: "transfer_public_to_public" }] }
const txAny = { type: "transaction", scope: "*" }
const contracts = { type: "contracts", contracts: [TOKEN], canRegister: true, canGetMetadata: true }

const session = (grants: unknown[], consent?: { broad: boolean }) => ({
	id: "s1",
	dappMetadata: { name: "nulo-playground", url: "http://localhost:5173" },
	accounts: [],
	permissions: [{ methods: [] }],
	chainId: 1,
	capabilityGrants: grants.map((capability) => ({ capability, grantedAt: 1 })),
	...(consent ? { authorizationsWithoutAsking: consent } : {}),
})

async function mountPage(initial: ReturnType<typeof session>) {
	mocks.getDappSession.mockResolvedValue(initial)
	const w = mount(ConnectedApp, {
		global: {
			plugins: [createTestingPinia({ createSpy: vi.fn })],
			components: { Icon, MaterialIcon, Toggle, Tooltip },
			mocks: { confirmationPolicies: [] },
			stubs: {
				SettingsPageShell: { template: "<div><slot /></div>" },
				Dropdown: true,
				Flex: { inheritAttrs: false, template: "<div v-bind='$attrs'><slot /></div>" },
				Text: { template: "<span><slot /></span>" },
				SectionLabel: { props: ["label"], template: "<h2>{{ label }}</h2>" },
				ItemsContainer: { template: "<div><slot /></div>" },
				GrantedCapabilitiesList: true,
			},
		},
	})
	await flushPromises()
	return w
}

const row = (w: Awaited<ReturnType<typeof mountPage>>) => w.find('[data-testid="connected-app-authorizations"]')
const toggle = (w: Awaited<ReturnType<typeof mountPage>>) => w.find('[data-testid="connected-app-authorizations-toggle"]')
/** The line as read: the dotted term's always-mounted definition copy is `hidden`. */
const line = (w: Awaited<ReturnType<typeof mountPage>>) => {
	const copy = w.find('[data-testid="cap-row-sub"]').element.cloneNode(true) as HTMLElement
	for (const hidden of copy.querySelectorAll("[hidden]")) hidden.remove()
	return copy.textContent?.replace(/\s+/g, " ").trim()
}
const FLAGGED = (PermissionRow as unknown as { __cssModules: { $style: Record<string, string> } }).__cssModules.$style.flagged

describe("Settings › Connected app › If you allow, it can", () => {
	test("the row shows the consent, with the dotted term, and its switch writes it", async () => {
		const w = await mountPage(session([accounts(true), txListed], { broad: false }))
		expect(w.text()).toContain("If you allow, it can")
		expect(row(w).text()).toContain("Act for you in transactions you approve")
		expect(toggle(w).attributes("aria-checked")).toBe("true")
		expect(toggle(w).attributes("aria-label")).toBe("Authorizations without asking")
		expect(line(w)).toBe("Nulo signs its authorizations without asking.")
		expect(w.find('[data-testid="cap-auth-term"]').text()).toBe("authorizations")

		mocks.setAuthorizationsWithoutAsking.mockResolvedValueOnce(session([accounts(true), txListed]))
		await toggle(w).trigger("click")
		await flushPromises()
		expect(mocks.setAuthorizationsWithoutAsking).toHaveBeenCalledWith("s1", false)
		expect(toggle(w).attributes("aria-checked")).toBe("false")
		expect(line(w)).toBe("You confirm each authorization first.")
		expect(w.find('[data-testid="cap-auth-term"]').text()).toBe("authorization")
	})

	test("absent when the app cannot ask for authorizations", async () => {
		const w = await mountPage(session([accounts(false), txListed]))
		expect(row(w).exists()).toBe(false)
		expect(w.text()).not.toContain("If you allow, it can")
	})

	test("with no transaction or simulation scope: no switch, and the off line", async () => {
		const w = await mountPage(session([accounts(true), contracts]))
		expect(row(w).exists()).toBe(true)
		expect(toggle(w).exists()).toBe(false)
		expect(line(w)).toBe("You confirm each authorization first.")
	})

	test("a widening to any contract refreshes the row: Off, flagged, the broad lines, still a switch", async () => {
		const w = await mountPage(session([accounts(true), txListed], { broad: false }))
		expect(toggle(w).attributes("aria-checked")).toBe("true")
		for (const notify of mocks.updated) notify(session([accounts(true), txAny], { broad: false }))
		await flushPromises()
		expect(toggle(w).attributes("aria-checked")).toBe("false")
		expect(row(w).classes()).toContain(FLAGGED)
		expect(line(w)).toBe("You confirm each authorization first. Off because it listed any contract.")

		mocks.setAuthorizationsWithoutAsking.mockResolvedValueOnce(session([accounts(true), txAny], { broad: true }))
		await toggle(w).trigger("click")
		await flushPromises()
		expect(mocks.setAuthorizationsWithoutAsking).toHaveBeenCalledWith("s1", true)
		expect(line(w)).toBe("For any call, on any contract.")
	})

	test("a failed write puts the switch back and says so", async () => {
		const w = await mountPage(session([accounts(true), txListed], { broad: false }))
		mocks.setAuthorizationsWithoutAsking.mockRejectedValueOnce(new Error("storage unavailable"))
		await toggle(w).trigger("click")
		await flushPromises()
		expect(toggle(w).attributes("aria-checked")).toBe("true")
		expect(line(w)).toBe("Nulo signs its authorizations without asking.")
		expect(mocks.openToast).toHaveBeenCalledWith({ kind: "error", label: "Couldn't save this setting" })
	})
})
