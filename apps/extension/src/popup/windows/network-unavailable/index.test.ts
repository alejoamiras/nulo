/**
 * The network-unavailable notice: it shows the app as the connect window does and the owner's
 * copy, and Close and Escape both dismiss it through the interaction's reject. Nothing in it can
 * resolve the interaction, so no answer from this window reads as an approval.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { reactive, ref, type Ref } from "vue"

const payloadMock: Ref<unknown> = ref(null)
const dappMock = ref<{ name: string; url: string } | null>(null)
const loadMock = vi.fn(async () => {
	payloadMock.value = { notice: "network-unavailable", params: { dappMetadata: dappMock.value, chainId: 1816023401 } }
})
const rejectMock = vi.fn()
const resolveInteractionMock = vi.fn(async () => undefined)
const windowsRemoveMock = vi.fn()

vi.mock("@/composables/useDappInteractionPayload", () => ({
	useDappInteractionPayload: vi.fn(() => ({
		requestId: ref("req-1"),
		payload: payloadMock,
		dapp: dappMock,
		isCancelled: ref(false),
		load: loadMock,
		reject: rejectMock,
	})),
}))

vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return {
			getActiveProfile: async () => ({ id: "p1" }),
			connect: vi.fn(),
			disconnect: vi.fn(),
			onActiveProfileChanged: { add: vi.fn() },
		}
	}),
}))

vi.mock("@/wallet/services/dapp-interaction/client", () => ({
	DappInteractionServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), resolveInteraction: resolveInteractionMock }
	}),
}))

vi.mock("@/stores/app.store", () => ({
	useAppStore: () =>
		reactive({
			isSessionChecked: true,
			isLogined: true,
			account: { name: "Account 1" },
			network: { name: "Testnet" },
			pageAwaitingAuth: "",
		}),
}))

vi.mock("vue-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vue-router")>()
	const router = { currentRoute: { value: { fullPath: "/windows/network-unavailable?requestId=req-1", query: { requestId: "req-1" } } } }
	return { ...actual, useRouter: () => router }
})

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Button: {
		emits: ["click"],
		template: `<button :data-testid="$attrs['data-testid']" @click="$emit('click', $event)"><slot /></button>`,
	},
	DappStatusStrip: { template: '<div data-testid="status-strip" />', props: ["accountName", "networkName", "status"] },
	DappIdentityBlock: {
		template:
			'<div data-testid="identity-block" :data-action="actionLabel" :data-hostname-testid="hostnameTestId" :data-name-testid="nameTestId" />',
		props: ["dapp", "hostname", "hostnameSuspicious", "actionLabel", "hostnameTestId", "nameTestId"],
	},
}

import NetworkUnavailable from "./index.vue"

let wrapper: ReturnType<typeof mount> | undefined
const factory = async () => {
	wrapper = mount(NetworkUnavailable, { global: { stubs: STUBS }, attachTo: document.body })
	await flushPromises()
	return wrapper
}
const text = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-testid="${id}"]`).text()
const pressEscape = () => {
	const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
	window.dispatchEvent(event)
	return event
}

beforeEach(() => {
	dappMock.value = { name: "Unleashed", url: "https://unleashed.example" }
	payloadMock.value = null
	// biome-ignore lint/suspicious/noExplicitAny: chrome runtime stub for tests
	;(globalThis as any).chrome = {
		windows: { getCurrent: (_o: unknown, cb: (w: { id?: number }) => void) => cb({ id: 42 }), remove: windowsRemoveMock },
	}
})

afterEach(() => {
	wrapper?.unmount()
	wrapper = undefined
	vi.clearAllMocks()
})

describe("network-unavailable window", () => {
	test("shows the owner's copy, the requested chain and one Close button", async () => {
		const w = await factory()

		expect(text(w, "network-unavailable-title")).toBe("Network not available")
		expect(text(w, "network-unavailable-body")).toBe(
			"This app asks for a network your wallet doesn't have. Switch the app to a network your wallet uses.",
		)
		expect(text(w, "network-unavailable-chain")).toBe("Requested chain: 1816023401")
		expect(w.findAll("button").map((b) => b.attributes("data-testid"))).toEqual(["network-unavailable-close-btn"])
		expect(text(w, "network-unavailable-close-btn")).toBe("Close")
	})

	test("names the app with the connect window's identity block and its own testids", async () => {
		const w = await factory()
		const identity = w.find('[data-testid="identity-block"]')

		expect(identity.attributes("data-action")).toBe("wants to connect to your wallet")
		expect(identity.attributes("data-hostname-testid")).toBe("network-unavailable-hostname")
		expect(identity.attributes("data-name-testid")).toBe("network-unavailable-dapp-name")
	})

	test("Close dismisses through the interaction's reject and closes the window, never resolving it", async () => {
		const w = await factory()

		await w.find('[data-testid="network-unavailable-close-btn"]').trigger("click")

		expect(rejectMock).toHaveBeenCalledTimes(1)
		expect(windowsRemoveMock).toHaveBeenCalledWith(42)
		expect(resolveInteractionMock).not.toHaveBeenCalled()
	})

	test("Escape does what Close does and marks the key handled", async () => {
		await factory()

		const event = pressEscape()

		expect(event.defaultPrevented).toBe(true)
		expect(rejectMock).toHaveBeenCalledTimes(1)
		expect(windowsRemoveMock).toHaveBeenCalledWith(42)
		expect(resolveInteractionMock).not.toHaveBeenCalled()
	})

	test("an Escape something else already handled, or any other key, does nothing", async () => {
		await factory()
		const handled = new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
		handled.preventDefault()

		window.dispatchEvent(handled)
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }))

		expect(rejectMock).not.toHaveBeenCalled()
		expect(windowsRemoveMock).not.toHaveBeenCalled()
	})

	test("after unmount Escape reaches nothing", async () => {
		const w = await factory()
		w.unmount()
		wrapper = undefined

		pressEscape()

		expect(rejectMock).not.toHaveBeenCalled()
	})
})
