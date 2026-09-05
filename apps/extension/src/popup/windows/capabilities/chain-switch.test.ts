/**
 * The capabilities window's chain-mismatch surface: the banner's two states and its gate, the
 * in-window switch holding the footer, and lifecycle rejection staying unconditional. Sibling of
 * `index.test.ts` (the shell-lifecycle oracle) with the same mock shape; the activation itself is
 * a deferred mock so every timing is deterministic.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { reactive, ref, type Ref } from "vue"

const LOCAL = { id: "n-local", chainId: 0, name: "Local Network" }
const TESTNET = { id: "n-testnet", chainId: 1816023401, name: "Testnet" }

let requestIdMock = ref<string | undefined>(undefined)
let dappMock = ref<{ name: string; url: string } | null>(null)
let payloadMock: Ref<unknown> = ref(null)
let isCancelledMock = ref(false)

const rejectViaInteractionServiceMock = vi.fn()
const resolveInteractionMock = vi.fn(async () => undefined)
const onActiveProfileChangedAddMock = vi.fn()

const activateMock = vi.fn()

const appStoreDefaults = () =>
	reactive({
		isSessionChecked: true,
		isLogined: true,
		account: { name: "TestAccount" },
		network: TESTNET as { id: string; chainId: number; name: string } | undefined,
		networks: [LOCAL, TESTNET],
		pageAwaitingAuth: "",
	})
let appStoreMock = appStoreDefaults()

const payloadFor = (sessionChainId: string, availableAccounts: unknown[]) => ({
	session: { chainId: sessionChainId },
	params: {
		delta: [{ type: "accounts", canGet: true, canCreateAuthWit: false }],
		existingGrants: [],
		reRequested: [],
		availableAccounts,
	},
})
const oneAccount = [{ address: "0xabc", name: "Account", chainId: 0 }]

vi.mock("@/composables/useDappInteractionPayload", () => ({
	useDappInteractionPayload: vi.fn(() => ({
		requestId: requestIdMock,
		payload: payloadMock,
		dapp: dappMock,
		isCancelled: isCancelledMock,
		load: vi.fn(async () => {
			requestIdMock.value = "req-1"
			dappMock.value = { name: "Test DApp", url: "https://example.com" }
		}),
		reject: rejectViaInteractionServiceMock,
	})),
}))
vi.mock("@/composables/useDappHostname", () => ({
	useDappHostname: vi.fn(() => ({ hostname: ref("example.com"), isSuspicious: ref(false) })),
}))
vi.mock("@/composables/useNetworkActivation", () => ({
	useNetworkActivation: vi.fn(() => ({ activate: activateMock })),
}))
vi.mock("@/utils/core", () => ({
	requireNetwork: () => ({ setActiveNetwork: vi.fn(), getActiveNetwork: vi.fn() }),
}))
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return {
			getActiveProfile: vi.fn(async () => ({ id: "p1" })),
			connect: vi.fn(),
			disconnect: vi.fn(),
			onActiveProfileChanged: { add: onActiveProfileChangedAddMock },
		}
	}),
}))
vi.mock("@/wallet/services/dapp-interaction/client", () => ({
	DappInteractionServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), resolveInteraction: resolveInteractionMock }
	}),
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => appStoreMock }))
vi.mock("vue-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vue-router")>()
	return {
		...actual,
		useRouter: () => ({
			currentRoute: { value: { fullPath: "/windows/capabilities?requestId=req-1", query: { requestId: "req-1" } } },
			push: vi.fn(),
		}),
	}
})

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
	Tooltip: { template: "<div><slot /><slot name='content' /></div>" },
	Button: {
		props: ["disabled", "loading"],
		emits: ["click"],
		template: `<button :data-testid="$attrs['data-testid']" :disabled="disabled || loading" @click="$emit('click', $event)"><slot /></button>`,
	},
	Banner: {
		props: ["variant", "direction", "wide", "action"],
		template: `
			<div :data-testid="$attrs['data-testid']" :data-state="$attrs['data-state']" :data-variant="variant">
				<span data-testid="banner-title"><slot name="title" /></span>
				<span data-testid="banner-desc"><slot name="description" /></span>
				<button v-if="action" :data-testid="action.testId" @click="action.callback()">{{ action.name }}</button>
			</div>`,
	},
	SectionLabel: { template: "<div />" },
	ItemsContainer: { template: "<div><slot /></div>" },
	CapabilityCard: { template: "<div />" },
	AccountSelectRow: { template: "<div />" },
	DappStatusStrip: { template: "<div />", props: ["accountName", "networkName", "status"] },
	DappIdentityBlock: {
		template: '<div data-testid="identity-block" :data-action-label="actionLabel" />',
		props: ["dapp", "hostname", "hostnameSuspicious", "actionLabel"],
	},
	DappCancelledOverlay: { template: "<div />" },
}

import Capabilities from "./index.vue"

let w: ReturnType<typeof mount> | undefined

const open = async (payload: unknown) => {
	payloadMock.value = payload
	// biome-ignore lint/suspicious/noExplicitAny: chrome runtime stub for tests
	;(globalThis as any).chrome = {
		windows: { getCurrent: (_o: unknown, cb: (x: { id?: number }) => void) => cb({ id: 1 }), remove: vi.fn() },
	}
	w = mount(Capabilities, { global: { stubs: STUBS } })
	await flushPromises()
	return w
}
const banner = () => w?.find('[data-testid="cap-chain-banner"]')
const approveBtn = () => w?.find('[data-testid="cap-approve-btn"]')
const rejectBtn = () => w?.find('[data-testid="cap-reject-btn"]')

/** A controllable activation: the test decides when and how it settles. */
const deferActivation = () => {
	let settle: (r: string) => void = () => {}
	activateMock.mockImplementation(() => new Promise<string>((r) => (settle = r)))
	return (result: string) => {
		settle(result)
		return flushPromises()
	}
}

afterEach(() => {
	w?.unmount()
	w = undefined
	requestIdMock = ref(undefined)
	dappMock = ref(null)
	payloadMock = ref(null)
	isCancelledMock = ref(false)
	appStoreMock = appStoreDefaults()
	vi.clearAllMocks()
})

describe("capabilities window — chain mismatch banner and switch", () => {
	test("a session on another chain renders the invitation, its action, and the chain in the identity line", async () => {
		await open(payloadFor("0", oneAccount))
		expect(banner()?.attributes("data-state")).toBe("mismatch")
		expect(banner()?.attributes("data-variant")).toBe("info")
		expect(banner()?.find('[data-testid="banner-title"]').text()).toBe("Connecting on Local Network")
		expect(banner()?.find('[data-testid="banner-desc"]').text()).toBe(
			"Your wallet is on Testnet. Approve as is, or switch to see Local Network balances.",
		)
		expect(banner()?.find('[data-testid="cap-switch-network-btn"]').text()).toBe("Switch wallet to Local Network")
		expect(w?.find('[data-testid="identity-block"]').attributes("data-action-label")).toBe("is requesting permissions on Local Network")
		expect(approveBtn()?.attributes("disabled")).toBeUndefined()
	})

	test("a session on the active chain renders no banner", async () => {
		await open(payloadFor(String(TESTNET.chainId), [{ ...oneAccount[0], chainId: TESTNET.chainId }]))
		expect(banner()?.exists()).toBe(false)
	})

	test("the hard error hides the invitation and names the chain in its remedy", async () => {
		await open(payloadFor("0", []))
		expect(banner()?.exists()).toBe(false)
		expect(w?.text()).toContain("No accounts on this chain")
		expect(w?.text()).toContain("Switch the wallet to Local Network in Settings")
		expect(approveBtn()?.attributes("disabled")).toBeDefined()
	})

	test("a chain with no row keeps the invitation but offers no switch", async () => {
		appStoreMock.networks = [TESTNET]
		await open(payloadFor("0", oneAccount))
		expect(banner()?.attributes("data-state")).toBe("mismatch")
		expect(banner()?.find('[data-testid="cap-switch-network-btn"]').exists()).toBe(false)
	})

	test("a running switch holds the footer and ignores a second click; activated settles to the done state", async () => {
		const settle = deferActivation()
		await open(payloadFor("0", oneAccount))
		await banner()?.find('[data-testid="cap-switch-network-btn"]').trigger("click")
		await banner()?.find('[data-testid="cap-switch-network-btn"]').trigger("click")
		expect(activateMock).toHaveBeenCalledTimes(1)
		expect(activateMock.mock.calls[0]?.[0]).toMatchObject({ id: "n-local" })
		expect(approveBtn()?.attributes("disabled")).toBeDefined()
		expect(rejectBtn()?.attributes("disabled")).toBeDefined()

		appStoreMock.network = LOCAL
		await settle("activated")
		expect(banner()?.attributes("data-state")).toBe("switched")
		expect(banner()?.attributes("data-variant")).toBe("done")
		expect(banner()?.find('[data-testid="banner-title"]').text()).toBe("Wallet switched to Local Network")
		expect(banner()?.find('[data-testid="cap-switch-network-btn"]').exists()).toBe(false)
		expect(approveBtn()?.attributes("disabled")).toBeUndefined()
		expect(rejectBtn()?.attributes("disabled")).toBeUndefined()
	})

	test("a blocked switch leaves the invitation in place and releases the footer", async () => {
		const settle = deferActivation()
		await open(payloadFor("0", oneAccount))
		await banner()?.find('[data-testid="cap-switch-network-btn"]').trigger("click")
		await settle("blocked")
		expect(banner()?.attributes("data-state")).toBe("mismatch")
		expect(banner()?.find('[data-testid="cap-switch-network-btn"]').exists()).toBe(true)
		expect(approveBtn()?.attributes("disabled")).toBeUndefined()
	})

	test("a profile change during a running switch still rejects the request (lifecycle rejection is unconditional)", async () => {
		deferActivation()
		await open(payloadFor("0", oneAccount))
		await banner()?.find('[data-testid="cap-switch-network-btn"]').trigger("click")
		const guard = onActiveProfileChangedAddMock.mock.calls[0]?.[0] as (p?: { id: string }) => void
		guard({ id: "p2" })
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledWith("User rejected")
	})

	test("approve during a running switch is refused", async () => {
		deferActivation()
		const wrapper = await open(payloadFor("0", oneAccount))
		await banner()?.find('[data-testid="cap-switch-network-btn"]').trigger("click")
		await (wrapper.vm as unknown as { approve: () => Promise<void> }).approve()
		expect(resolveInteractionMock).not.toHaveBeenCalled()
	})
})
