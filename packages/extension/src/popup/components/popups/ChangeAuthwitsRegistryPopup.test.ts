/**
 * Component tests for ChangeAuthwitsRegistryPopup. Pins the Enter-key
 * gate that mirrors the Send button's `:disabled` template gate:
 * Enter must require `isAllowedToExecute && !isLoading`. Pre-fix the
 * Enter handler skipped the isLoading check, so rapid Enter could
 * re-enter handleChangeRegistry while a request was in flight.
 * Archived analysis: implementations-plan/network-followups/audit-codex-fix-review.md §2.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"

const authwitsServiceMock = {
	getRegistryEnabled: vi.fn(),
	setRegistryEnabled: vi.fn(),
	disconnect: vi.fn(),
	onRegistryEnabled: { add: vi.fn(), remove: vi.fn() },
	onRegistryDisabled: { add: vi.fn(), remove: vi.fn() },
}

const openToastMock = vi.fn()

// Vitest 4 requires function expressions (not arrows) for `new`-constructed mocks.
vi.mock("@/wallet/services/auth-registry/client", () => ({
	AuthRegistryServiceClient: vi.fn(function () {
		return authwitsServiceMock
	}),
	MAX_REVOKES_PER_TX: 8,
}))

vi.mock("@/popup/utils/cancellable-rejection", () => ({
	classifyCancellableRejection: () => "fail",
}))

vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({
		network: { id: "net-1" },
		account: { address: "0xacct" },
		profile: { id: "p1" },
	}),
}))

vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({
		popups: { change_authwits_registry: { order: 1 } },
		len: 1,
	}),
}))

vi.mock("@/composables/toast", () => ({
	useToast: () => ({
		openToast: openToastMock,
		TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
	}),
}))

const STUBS = {
	Popup: { props: ["show", "displaceIdx"], template: `<div v-if="show"><slot /></div>` },
	PopupCard: { template: "<div><slot /></div>" },
	PopupHeader: { template: "<div><slot name='title' /></div>" },
	Banner: { template: "<div />" },
	FeeSettingsCard: {
		props: ["profile", "network", "account", "modelValue"],
		emits: ["update:modelValue"],
		template: `<button data-testid="set-fee" @click="$emit('update:modelValue', { gasLimit: 100 })">fee</button>`,
	},
	Button: {
		props: ["loading", "disabled"],
		template: `<button data-testid="registry-toggle-submit" :disabled="disabled || loading"><slot /></button>`,
	},
	Tooltip: { template: "<div><slot /><slot name='content' /></div>" },
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
}

import ChangeAuthwitsRegistryPopup from "./ChangeAuthwitsRegistryPopup.vue"

async function mountAndOpen() {
	authwitsServiceMock.getRegistryEnabled.mockResolvedValueOnce(true)
	const w = mount(ChangeAuthwitsRegistryPopup, {
		props: { show: false },
		global: { stubs: STUBS },
	})
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

function pressEnter() {
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
}

function setFee(w: ReturnType<typeof mount>) {
	return w.find('[data-testid="set-fee"]').trigger("click")
}

beforeEach(() => {
	authwitsServiceMock.getRegistryEnabled.mockReset()
	authwitsServiceMock.setRegistryEnabled.mockReset().mockResolvedValue(undefined)
	authwitsServiceMock.disconnect.mockReset()
	openToastMock.mockReset()
})

describe("ChangeAuthwitsRegistryPopup — Enter-key gate", () => {
	test("Enter fires handleChangeRegistry when fee is set and not loading", async () => {
		const w = await mountAndOpen()
		await setFee(w)
		pressEnter()
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).toHaveBeenCalledTimes(1)
	})

	test("Enter is a no-op when feeSettings is unset (!isAllowedToExecute)", async () => {
		const w = await mountAndOpen()
		// No setFee() call — feeSettings stays undefined → isAllowedToExecute=undefined
		pressEnter()
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).not.toHaveBeenCalled()
		// Send button mirrors the gate
		expect(w.find('[data-testid="registry-toggle-submit"]').attributes("disabled")).toBeDefined()
	})

	test("(REGRESSION-PIN) Enter is a no-op while in-flight (isLoading)", async () => {
		// Pre-fix this gate was missing — rapid Enter could re-enter
		// handleChangeRegistry mid-request. The fix added !isLoading.value
		// to the keydown predicate. This test pins that behavior.
		let resolveSet: (v?: unknown) => void = () => {}
		authwitsServiceMock.setRegistryEnabled.mockReturnValueOnce(
			new Promise((r) => {
				resolveSet = r
			}),
		)
		const w = await mountAndOpen()
		await setFee(w)
		pressEnter() // First Enter → starts request → isLoading flips true
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).toHaveBeenCalledTimes(1)
		// Now press Enter rapidly while in-flight — must NOT fire again
		pressEnter()
		pressEnter()
		pressEnter()
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).toHaveBeenCalledTimes(1)
		resolveSet()
	})

	test("non-Enter keys are ignored (handler is Enter-specific)", async () => {
		const w = await mountAndOpen()
		await setFee(w)
		document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }))
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).not.toHaveBeenCalled()
	})

	test("Send button click reaches handleChangeRegistry (parity with Enter path)", async () => {
		// Sanity: Enter and click drive the same path. If a future refactor
		// breaks click while leaving Enter working, this fails alongside test 1.
		const w = await mountAndOpen()
		await setFee(w)
		await w.find('[data-testid="registry-toggle-submit"]').trigger("click")
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).toHaveBeenCalledTimes(1)
	})
})
