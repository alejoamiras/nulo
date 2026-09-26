import { Flex, Text } from "@nulo/design"
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { Ref } from "vue"

const footer = vi.hoisted(() => ({ values: [] as unknown[] }))
vi.mock("@/composables/snackInset", () => ({
	vSnackFooter: {
		mounted: (_: Element, { value }: { value: unknown }) => footer.values.push(value),
		updated: (_: Element, { value }: { value: unknown }) => footer.values.push(value),
	},
}))
vi.mock("@/composables/usePrestoCheck", async () => {
	const { ref } = await import("vue")
	const state = ref<{ kind: string; info?: object }>({ kind: "detecting" })
	return { usePrestoCheck: () => ({ state, start: vi.fn(async () => {}), check: vi.fn(async () => {}), dispose: vi.fn() }), state }
})
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return { disconnect: vi.fn() }
	}),
}))
vi.mock("@alejoamiras/presto-banners/register", () => ({}))
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }))

import * as prestoCheck from "@/composables/usePrestoCheck"
import OnboardingSkipLink from "../components/OnboardingSkipLink.vue"
import Presto from "./presto.vue"

const state = (prestoCheck as unknown as { state: Ref<{ kind: string; info?: object }> }).state

afterEach(() => {
	footer.values.length = 0
	state.value = { kind: "detecting" }
})

describe("onboarding presto", () => {
	test("the action slot counts as the page's bottom row only while Continue or the skip link renders", async () => {
		const w = mount(Presto, {
			global: {
				components: { Flex, Text, OnboardingSkipLink },
				stubs: {
					OnboardingPage: { template: "<div><slot /></div>" },
					Button: { template: '<button v-bind="$attrs"><slot /></button>' },
					StepIndicator: true,
					BrutalistTitle: true,
					SectionLabel: true,
					PrestoStatusCard: true,
					"presto-banner": true,
				},
			},
		})
		await flushPromises()
		expect(w.find("button").exists()).toBe(false)
		expect(footer.values.at(-1)).toBe(false)

		for (const [kind, action] of [
			["offline", "onboarding-presto-skip"],
			["available", "onboarding-presto-continue"],
		]) {
			state.value = { kind, info: {} }
			await flushPromises()
			expect(w.find(`[data-testid="${action}"]`).exists()).toBe(true)
			expect(footer.values.at(-1)).toBe(true)
		}

		state.value = { kind: "detecting" }
		await flushPromises()
		expect(w.find("button").exists()).toBe(false)
		expect(footer.values.at(-1)).toBe(false)
		w.unmount()
	})
})
