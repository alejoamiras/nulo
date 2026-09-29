/**
 * Component tests for the recovery-phrase page's Enter shortcut, agreed and with a password typed: an
 * Enter in the password field retrieves the phrase once, the back arrow only goes back, Retrieve
 * retrieves once, and a repeat Enter on it retrieves nothing.
 */

import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const exportMnemonic = vi.hoisted(() => vi.fn(async () => ["alpha", "bravo", "charlie"]))
vi.mock("@/utils/core", () => ({ managers: { profile: { exportMnemonic } } }))
const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }))
vi.mock("vue-router", () => ({ useRouter: () => router, useRoute: () => ({ query: {}, meta: {} }) }))
vi.mock("@/composables/toast.js", () => ({ useToast: () => ({ openToast: vi.fn() }) }))

import { Flex, Icon, Input, MaterialIcon, Text } from "@nulo/design"
import { pressOn } from "../../../../../../tests/helpers/press-key"
import SubPageHeader from "@/components/ui/SubPageHeader.vue"
import Seed from "./seed.vue"

const wrappers: VueWrapper[] = []

async function mountAgreedWithPassword() {
	const w = mount(Seed, {
		attachTo: document.body,
		global: {
			plugins: [
				createTestingPinia({ createSpy: vi.fn, initialState: { app: { profile: { id: "p1", name: "Main", type: "password" } } } }),
			],
			components: { Flex, Icon, Input, MaterialIcon, SubPageHeader, Text },
			stubs: {
				Button: { template: "<button><slot /></button>" },
				SecretRevealCard: true,
				SecretCountdownClose: true,
			},
		},
	})
	wrappers.push(w)
	await flushPromises()
	await w.get('[data-testid="agree-continue-btn"]').trigger("click")
	await w.get('[data-testid="unlock-password-input"] input').setValue("password123")
	return w
}

const retrieve = (w: VueWrapper) => w.get('[data-testid="unlock-submit-btn"]').element as HTMLElement

beforeEach(() => {
	vi.clearAllMocks()
	const c = (globalThis as { chrome?: { storage: Record<string, unknown> } }).chrome
	if (c) {
		c.storage.local = { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
		c.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() }
	}
})

afterEach(() => {
	for (const w of wrappers.splice(0)) w.unmount()
})

describe("recovery phrase — Enter does what the focused control says", () => {
	test("Enter on the back arrow goes back and retrieves nothing", async () => {
		const w = await mountAgreedWithPassword()
		// With no history behind the page, SubPageHeader pushes its backTo.
		expect(window.history.length).toBe(1)
		pressOn(w.get('[data-testid="subpage-back"]').element as HTMLElement, "Enter")
		await flushPromises()
		expect(router.push).toHaveBeenCalledWith("/popup/settings/security/export")
		expect(exportMnemonic).not.toHaveBeenCalled()
	})

	test("Enter on Retrieve retrieves once", async () => {
		const w = await mountAgreedWithPassword()
		pressOn(retrieve(w), "Enter")
		await flushPromises()
		expect(exportMnemonic).toHaveBeenCalledTimes(1)
		expect(exportMnemonic).toHaveBeenCalledWith("p1", "password123")
	})

	test("a repeat Enter on Retrieve retrieves nothing", async () => {
		const w = await mountAgreedWithPassword()
		pressOn(retrieve(w), "Enter", { repeat: true })
		await flushPromises()
		expect(exportMnemonic).not.toHaveBeenCalled()
	})

	test("(preservation) Enter in the password field retrieves once", async () => {
		const w = await mountAgreedWithPassword()
		const field = w.get('[data-testid="unlock-password-input"] input').element
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
		await flushPromises()
		expect(exportMnemonic).toHaveBeenCalledTimes(1)
	})
})
