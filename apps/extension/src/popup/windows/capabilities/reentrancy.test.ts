/**
 * Component pin for the capabilities approval window — the most
 * security-adjacent site of the submit re-entrancy sweep: `approve()` had no
 * self-guard and `:confirm-disabled` omitted `isLoading`, so a keyboard-focused
 * Approve could re-fire mid-grant (Button's `loading` is only pointer-events
 * CSS). Pins the double-approve latch end to end through the footer's event.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { ref } from "vue"

const resolveInteractionMock = vi.fn()
const getActiveProfileMock = vi.fn()

vi.mock("vue-router", () => ({
	useRouter: () => ({ currentRoute: ref({ query: { requestId: "req-1" } }) }),
	useRoute: () => ({ query: { requestId: "req-1" } }),
}))
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({ isLogined: true, network: { id: "net-1", chainId: 1 }, networks: [], account: { address: "0xacct" } }),
}))
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			getActiveProfile: getActiveProfileMock,
			onActiveProfileChanged: { add: vi.fn(), remove: vi.fn() },
		}
	}),
}))
vi.mock("@/wallet/services/dapp-interaction/client", () => ({
	DappInteractionServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), resolveInteraction: resolveInteractionMock }
	}),
}))

const payloadRef = ref<Record<string, unknown> | undefined>(undefined)
vi.mock("@/composables/useDappInteractionPayload", () => ({
	useDappInteractionPayload: () => ({
		requestId: ref("req-1"),
		payload: payloadRef,
		dapp: ref({ name: "Test dApp", url: "https://dapp.example" }),
		isCancelled: ref(false),
		load: vi.fn(async () => {}),
		reject: vi.fn(),
	}),
}))
vi.mock("@/composables/useDappHostname", () => ({
	useDappHostname: () => ({ hostname: ref("dapp.example"), isSuspicious: ref(false) }),
}))
// The approval-window composable is mocked thin: `start` runs the real init
// thunk (so initComplete flips through the REAL code path), the rest are
// inert holders.
vi.mock("@/composables/useDappApprovalWindow", () => ({
	useDappApprovalWindow: (cfg: { init: () => Promise<void> }) => ({
		start: () => cfg.init(),
		dispose: vi.fn(),
		closeWindow: vi.fn(),
		onActiveProfileChanged: vi.fn(),
		stripStatus: ref("idle"),
		processingError: ref(null),
		setError: vi.fn(),
		clearError: vi.fn(),
	}),
}))

const STUBS = {
	DappStatusStrip: { template: "<div />" },
	DappIdentityBlock: { template: "<div />" },
	DappCancelledOverlay: { template: "<div />" },
	DappApprovalFooter: {
		name: "DappApprovalFooter",
		props: ["processingError", "rejectDisabled", "confirmLoading", "confirmDisabled", "rejectLabel", "confirmLabel"],
		emits: ["reject", "approve"],
		template: `<div><button data-testid="stub-approve" :disabled="confirmDisabled" @click="$emit('approve')">Approve</button></div>`,
	},
	CapabilityCard: { template: "<div />" },
	AccountSelectRow: { template: "<div />" },
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
	Transition: { template: "<div><slot /></div>" },
}

import CapabilitiesWindow from "./index.vue"

beforeEach(() => {
	getActiveProfileMock.mockResolvedValue({ id: "p1", name: "Main" })
	resolveInteractionMock.mockResolvedValue(undefined)
	payloadRef.value = {
		params: { delta: [{ type: "simulation" }], existingGrants: [], reRequested: [] },
		session: { chainId: "1", dappMetadata: { name: "Test dApp", url: "https://dapp.example" } },
	}
})

afterEach(() => {
	vi.clearAllMocks()
})

describe("capabilities window — approve latch", () => {
	test("(RE-ENTRANCY PIN) double-approve mid-grant resolves the interaction ONCE, and the confirm control disables", async () => {
		let resolveGrant!: (v?: unknown) => void
		resolveInteractionMock.mockImplementationOnce(() => new Promise((r) => (resolveGrant = r)))
		const w = mount(CapabilitiesWindow, { global: { stubs: STUBS } })
		await flushPromises() // onMounted → start → real init → initComplete

		const approveBtn = w.find('[data-testid="stub-approve"]')
		expect(approveBtn.attributes("disabled")).toBeUndefined()

		await approveBtn.trigger("click") // grant starts, hangs
		await flushPromises()
		// The confirm control is disabled mid-grant (isLoading joined
		// confirm-disabled)…
		expect(approveBtn.attributes("disabled")).toBeDefined()
		// …and even a direct re-emit (keyboard-focused activation bypasses
		// pointer-events) is dropped by the handler's self-guard.
		w.findComponent({ name: "DappApprovalFooter" }).vm.$emit("approve")
		await flushPromises()
		expect(resolveInteractionMock).toHaveBeenCalledTimes(1)

		resolveGrant()
		await flushPromises()
		w.unmount()
	})
})
