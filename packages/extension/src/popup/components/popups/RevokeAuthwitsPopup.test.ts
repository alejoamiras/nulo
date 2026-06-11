/**
 * Component tests for RevokeAuthwitsPopup. Pins the Enter-key gate
 * that mirrors the Revoke button's `:disabled` template gate AND adds
 * `!isLoading`: Enter must require
 * `isAllowedToExecute && !isErrorOccurred && !isLoading`. Pre-fix the
 * Enter handler skipped both isLoading and isErrorOccurred, so a
 * keyboard user could re-enter handleRevokeAuthwits mid-request or
 * after an error surfaced.
 * Archived analysis: implementations-plan/network-followups/audit-codex-fix-review.md §3.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"

const authwitsServiceMock = {
	getRegistryEnabled: vi.fn(),
	revokeAuthwits: vi.fn(),
	disconnect: vi.fn(),
	onRegistryEnabled: { add: vi.fn(), remove: vi.fn() },
	onRegistryDisabled: { add: vi.fn(), remove: vi.fn() },
}

const openToastMock = vi.fn()
const preselected = { preselectedAuthwits: [] as { id: string; content: string }[] }

vi.mock("@/wallet/services/auth-registry/client", () => ({
	AuthRegistryServiceClient: vi.fn(() => authwitsServiceMock),
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

vi.mock("@/stores/cache.store", () => ({
	useCacheStore: () => preselected,
}))

vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({
		popups: { revoke_authwits: { order: 1 } },
		len: 1,
		open: vi.fn(),
	}),
}))

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
	TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
}))

const STUBS = {
	Popup: { props: ["show", "displaceIdx"], template: `<div v-if="show"><slot /></div>` },
	PopupCard: { template: "<div><slot /></div>" },
	PopupHeader: { template: "<div><slot name='title' /></div>" },
	Banner: { template: "<div />" },
	FeeSettingsCard: {
		props: ["profile", "network", "account", "modelValue"],
		emits: ["update:modelValue"],
		// Single button per chunk that emits a fee. Tests can target by index.
		template: `<button class="set-fee" @click="$emit('update:modelValue', { gasLimit: 100 })">fee</button>`,
	},
	Button: {
		props: ["loading", "disabled"],
		template: `<button data-testid="revoke-btn" :disabled="disabled || loading"><slot /></button>`,
	},
	Tooltip: { template: "<div><slot /><slot name='content' /></div>" },
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
}

import RevokeAuthwitsPopup from "./RevokeAuthwitsPopup.vue"

// Track every mounted wrapper so afterEach can tear down via show=false,
// which triggers the popup's else-branch document.removeEventListener.
// Without this, test #1's keydown listener leaks into test #2 and the
// stale onKeydown closure makes pressEnter() fire the old handler.
const wrappers: ReturnType<typeof mount>[] = []

async function mountAndOpen(authwits: { id: string; content: string }[] = [{ id: "aw-1", content: "c1" }]) {
	preselected.preselectedAuthwits = authwits
	authwitsServiceMock.getRegistryEnabled.mockResolvedValueOnce(true)
	const w = mount(RevokeAuthwitsPopup, {
		props: { show: false },
		global: { stubs: STUBS },
	})
	wrappers.push(w)
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

function pressEnter() {
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
}

async function setAllFees(w: ReturnType<typeof mount>) {
	const feeBtns = w.findAll(".set-fee")
	for (const btn of feeBtns) await btn.trigger("click")
}

beforeEach(() => {
	authwitsServiceMock.getRegistryEnabled.mockReset()
	authwitsServiceMock.revokeAuthwits.mockReset().mockResolvedValue(undefined)
	authwitsServiceMock.disconnect.mockReset()
	openToastMock.mockReset()
	preselected.preselectedAuthwits = []
})

afterEach(async () => {
	for (const w of wrappers) {
		await w.setProps({ show: false })
		await flushPromises()
		w.unmount()
	}
	wrappers.length = 0
})

describe("RevokeAuthwitsPopup — Enter-key gate", () => {
	test("Enter fires handleRevokeAuthwits when all chunks have fee set", async () => {
		const w = await mountAndOpen([{ id: "aw-1", content: "c1" }])
		await setAllFees(w)
		pressEnter()
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).toHaveBeenCalledTimes(1)
	})

	test("Enter is a no-op when any chunk's fee is unset (!isAllowedToExecute)", async () => {
		const w = await mountAndOpen([{ id: "aw-1", content: "c1" }])
		// No setAllFees() — chunk has no feeSettings → isAllowedToExecute=undefined
		pressEnter()
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
		expect(w.find('[data-testid="revoke-btn"]').attributes("disabled")).toBeDefined()
	})

	test("(REGRESSION-PIN) Enter is a no-op while in-flight (isLoading)", async () => {
		// Pre-fix the Enter predicate ignored isLoading; rapid Enter could
		// re-enter the handler mid-request. Pin the !isLoading.value gate.
		let resolveRevoke: (v?: unknown) => void = () => {}
		authwitsServiceMock.revokeAuthwits.mockReturnValueOnce(
			new Promise((r) => {
				resolveRevoke = r
			}),
		)
		const w = await mountAndOpen([{ id: "aw-1", content: "c1" }])
		await setAllFees(w)
		pressEnter() // First Enter → starts request → isLoading=true
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).toHaveBeenCalledTimes(1)
		// Rapid re-press while in-flight — must NOT fire again
		pressEnter()
		pressEnter()
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).toHaveBeenCalledTimes(1)
		resolveRevoke()
	})

	test("(REGRESSION-PIN) Enter is a no-op when isErrorOccurred (error.value set)", async () => {
		// Pre-fix the Enter predicate ignored isErrorOccurred even though the
		// Revoke button template gate includes it. Pin the !isErrorOccurred.value gate.
		// Drive error.value via fetchRegistryStatus catch — avoids the TOAST_DURATION
		// auto-import call site that triggers if we error inside handleRevokeAuthwits.
		preselected.preselectedAuthwits = [{ id: "aw-1", content: "c1" }]
		authwitsServiceMock.getRegistryEnabled.mockRejectedValueOnce(new Error("PXE down"))
		const w = mount(RevokeAuthwitsPopup, {
			props: { show: false },
			global: { stubs: STUBS },
		})
		wrappers.push(w)
		await w.setProps({ show: true })
		await flushPromises()
		await setAllFees(w)
		// error.value was set by fetchRegistryStatus catch → isErrorOccurred=true
		pressEnter()
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
	})

	test("Revoke button click reaches handleRevokeAuthwits (parity with Enter path)", async () => {
		// Sanity: Enter and click drive the same path. If a future refactor
		// breaks click while leaving Enter working, this fails alongside test 1.
		const w = await mountAndOpen([{ id: "aw-1", content: "c1" }])
		await setAllFees(w)
		await w.find('[data-testid="revoke-btn"]').trigger("click")
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).toHaveBeenCalledTimes(1)
	})
})
