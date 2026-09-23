/**
 * Component tests for the wallet picker modal — the provider-supplied-content
 * hardening (name capping, icon protocol allowlist) and the interaction
 * contract (per-row connect by key, Escape/backdrop cancel, collision strip,
 * scanning hint).
 */

import { mount } from "@vue/test-utils"
import { ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TESTIDS } from "@/lib/testids"
import type { ConnectStatus, DiscoveredWallet } from "@/composables/useWalletConnection"

const status = ref<ConnectStatus>("choosing")
const discoveredWallets = ref<DiscoveredWallet[]>([])
const scanning = ref(true)
const pickerOpen = ref(true)
const selectWallet = vi.fn()
const cancelChoice = vi.fn()

vi.mock("@/composables/useWalletConnection", () => ({
	useWalletConnection: () => ({ status, discoveredWallets, scanning, pickerOpen, selectWallet, cancelChoice }),
}))

import WalletPickerModal from "./WalletPickerModal.vue"

function row(over: Partial<DiscoveredWallet> = {}): DiscoveredWallet {
	return { key: over.key ?? 0, id: over.id ?? "nulo", name: over.name ?? "Nulo", type: over.type ?? "extension", icon: over.icon }
}

function mountModal() {
	// Teleport target is document.body — query through document, not the wrapper.
	return mount(WalletPickerModal, { attachTo: document.body })
}

function q(testid: string): HTMLElement | null {
	return document.querySelector(`[data-testid="${testid}"]`)
}
function qa(testid: string): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)]
}

let wrapper: ReturnType<typeof mountModal> | null = null

beforeEach(() => {
	status.value = "choosing"
	discoveredWallets.value = []
	scanning.value = true
	pickerOpen.value = true
	selectWallet.mockReset()
	cancelChoice.mockReset()
})
afterEach(() => {
	wrapper?.unmount()
	wrapper = null
	document.body.innerHTML = ""
})

describe("WalletPickerModal", () => {
	it("visibility follows the session's pickerOpen; rows append progressively", async () => {
		pickerOpen.value = false
		wrapper = mountModal()
		expect(q(TESTIDS.walletPicker)).toBeNull()

		// Opens EMPTY (fresh connect, nothing answered yet): waiting hint shows.
		pickerOpen.value = true
		await wrapper.vm.$nextTick()
		expect(q(TESTIDS.walletPicker)).not.toBeNull()
		expect(q(TESTIDS.walletPickerWaiting)).not.toBeNull()
		expect(qa(TESTIDS.walletPickerRow)).toHaveLength(0)

		discoveredWallets.value = [row({ key: 1 })]
		await wrapper.vm.$nextTick()
		expect(q(TESTIDS.walletPickerWaiting)).toBeNull()
		expect(qa(TESTIDS.walletPickerRow)).toHaveLength(1)

		discoveredWallets.value = [...discoveredWallets.value, row({ key: 2, id: "acme", name: "Acme", type: "web" })]
		await wrapper.vm.$nextTick()
		expect(qa(TESTIDS.walletPickerRow)).toHaveLength(2)
	})

	it("per-row Connect emits the announcement KEY (not an index or claimed id)", async () => {
		discoveredWallets.value = [row({ key: 7 }), row({ key: 9, id: "acme", name: "Acme" })]
		wrapper = mountModal()
		await wrapper.vm.$nextTick()
		qa(TESTIDS.walletPickerConnect)[1].click()
		expect(selectWallet).toHaveBeenCalledWith(9)
	})

	it("renders an HTML-bearing name inert and caps its length by string", async () => {
		const evil = `<img src=x onerror=alert(1)>${"A".repeat(80)}`
		discoveredWallets.value = [row({ key: 1, name: evil })]
		wrapper = mountModal()
		await wrapper.vm.$nextTick()
		const rowEl = q(TESTIDS.walletPickerRow)
		expect(rowEl?.querySelector("img[src='x']")).toBeNull() // interpolated, not parsed
		const nameText = rowEl?.querySelector(".name")?.textContent ?? ""
		expect(nameText.length).toBeLessThanOrEqual(49) // 48 + ellipsis
	})

	it("icon protocol allowlist: https/chrome-extension/data:image pass, others fall back", async () => {
		discoveredWallets.value = [
			row({ key: 1, icon: "https://a.example/icon.png" }),
			row({ key: 2, id: "b", icon: "chrome-extension://abc/icon.png" }),
			row({ key: 3, id: "c", icon: "data:image/png;base64,AAAA" }),
			row({ key: 4, id: "d", icon: "javascript:alert(1)" }),
			row({ key: 5, id: "e", icon: "http://a.example/icon.png" }),
			row({ key: 6, id: "f", icon: `data:image/png;base64,${"A".repeat(5000)}` }), // over the source cap
		]
		wrapper = mountModal()
		await wrapper.vm.$nextTick()
		const rows = qa(TESTIDS.walletPickerRow)
		expect(rows[0].querySelector("img")).not.toBeNull()
		expect(rows[1].querySelector("img")).not.toBeNull()
		expect(rows[2].querySelector("img")).not.toBeNull()
		expect(rows[3].querySelector("img")).toBeNull()
		expect(rows[4].querySelector("img")).toBeNull()
		expect(rows[5].querySelector("img")).toBeNull()
	})

	it("shows the collision warning only when two rows claim one id", async () => {
		discoveredWallets.value = [row({ key: 1 }), row({ key: 2, id: "acme", name: "Acme" })]
		wrapper = mountModal()
		await wrapper.vm.$nextTick()
		expect(q(TESTIDS.walletPickerWarning)).toBeNull()

		discoveredWallets.value = [...discoveredWallets.value, row({ key: 3, id: "nulo", name: "Nulo" })]
		await wrapper.vm.$nextTick()
		expect(q(TESTIDS.walletPickerWarning)).not.toBeNull()
	})

	it("scanning hint tracks discovery liveness", async () => {
		discoveredWallets.value = [row({ key: 1 })]
		wrapper = mountModal()
		await wrapper.vm.$nextTick()
		expect(q(TESTIDS.walletPickerScanning)).not.toBeNull()
		scanning.value = false
		await wrapper.vm.$nextTick()
		expect(q(TESTIDS.walletPickerScanning)).toBeNull()
	})

	it("Escape and backdrop click cancel; the Cancel button cancels", async () => {
		discoveredWallets.value = [row({ key: 1 })]
		wrapper = mountModal()
		await wrapper.vm.$nextTick()

		q(TESTIDS.walletPickerCancel)?.click()
		expect(cancelChoice).toHaveBeenCalledTimes(1)

		document
			.querySelector<HTMLElement>('[role="dialog"]')
			?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
		expect(cancelChoice).toHaveBeenCalledTimes(2)

		q(TESTIDS.walletPicker)?.click() // backdrop (self) click
		expect(cancelChoice).toHaveBeenCalledTimes(3)
	})

	it("moves focus into the dialog on open", async () => {
		wrapper = mountModal()
		discoveredWallets.value = [row({ key: 1 })]
		pickerOpen.value = false
		await wrapper.vm.$nextTick()
		pickerOpen.value = true
		await wrapper.vm.$nextTick()
		await wrapper.vm.$nextTick()
		expect(document.activeElement?.getAttribute("role")).toBe("dialog")
	})
})
