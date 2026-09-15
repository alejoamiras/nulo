/**
 * The Home banner for a session open WITHOUT its imported-keys DEK: keyed on the live
 * `ProfileInfo.recoveryMode` projection so a popup opened after the degraded unlock (which
 * missed the toast) still sees the repair instruction.
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"
import RecoveryModeBanner from "./RecoveryModeBanner.vue"

vi.mock("@/stores/app.store", async () => {
	const { reactive } = await import("vue")
	const fake = reactive({
		profile: { id: "p1", name: "One", type: "password" } as
			| { id: string; name: string; type: string; recoveryMode?: boolean }
			| undefined,
	})
	return { useAppStore: () => fake, __mockAppStore: fake }
})

async function appStoreMock() {
	const mod = (await import("@/stores/app.store")) as unknown as { __mockAppStore: { profile?: { recoveryMode?: boolean } } }
	return mod.__mockAppStore
}

const stubs = {
	Banner: { template: '<div data-testid="recovery-mode-banner"><slot name="title" /><slot name="description" /></div>' },
	Text: { template: "<span><slot /></span>" },
}

describe("RecoveryModeBanner", () => {
	test("hidden for a healthy session, shown once the active profile reports recovery mode, hidden again after a healthy re-unlock", async () => {
		const store = await appStoreMock()
		const wrapper = mount(RecoveryModeBanner, { global: { stubs } })
		expect(wrapper.find('[data-testid="recovery-mode-banner"]').exists()).toBe(false)

		store.profile = { id: "p1", name: "One", type: "password", recoveryMode: true } as never
		await wrapper.vm.$nextTick()
		expect(wrapper.find('[data-testid="recovery-mode-banner"]').exists()).toBe(true)
		expect(wrapper.text()).toContain("Wallet keys need recovery")
		expect(wrapper.text()).toContain("Export a backup")

		store.profile = { id: "p1", name: "One", type: "password" } as never
		await wrapper.vm.$nextTick()
		expect(wrapper.find('[data-testid="recovery-mode-banner"]').exists()).toBe(false)
	})

	test("renders nothing with no profile at all", async () => {
		const store = await appStoreMock()
		store.profile = undefined
		const wrapper = mount(RecoveryModeBanner, { global: { stubs } })
		expect(wrapper.find('[data-testid="recovery-mode-banner"]').exists()).toBe(false)
	})
})
