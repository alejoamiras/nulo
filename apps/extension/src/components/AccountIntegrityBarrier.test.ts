import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { reactive } from "vue"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { useAppStore } from "@/stores/app.store"
import { ACCOUNT_INTEGRITY_BLOCKED_ROOT } from "@/wallet/services/account-integrity/types"
import { installChromeStorage } from "../../tests/helpers/chrome-storage-mock"
import AccountIntegrityBarrier from "./AccountIntegrityBarrier.vue"

// Router-aware route, controllable per test. `route.name` is what the barrier reads.
const mockRoute = reactive<{ name: string }>({ name: "popup-general" })
vi.mock("vue-router", async (importOriginal) => {
	const mod = await importOriginal<typeof import("vue-router")>()
	return { ...mod, useRoute: () => mockRoute }
})

const stubs = { MaterialIcon: true, Teleport: true }
const KEY = `${ACCOUNT_INTEGRITY_BLOCKED_ROOT}@p1`

function record(profileId: string): string {
	return JSON.stringify({
		profileId,
		chainId: 0,
		accountIndex: 0,
		storedAddress: "0xstored",
		derivedAddress: "0xderived",
		regimeId: "nulo-v5",
		walletVersion: "0.0.0",
		detectedAt: 1,
	})
}

/** Mount with a controllable presented profile (the app store's `profile.id`). */
function mountBarrier(presentedProfileId: string | undefined = "p1") {
	const pinia = createTestingPinia({ stubActions: false })
	const appStore = useAppStore(pinia)
	appStore.profile = presentedProfileId ? ({ id: presentedProfileId } as never) : undefined
	const wrapper = mount(AccountIntegrityBarrier, { global: { stubs, plugins: [pinia] } })
	return wrapper
}

const blocked = (w: ReturnType<typeof mountBarrier>) => w.find("[data-testid='account-integrity-blocked']").exists()

describe("AccountIntegrityBarrier", () => {
	beforeEach(() => {
		document.body.innerHTML = ""
		mockRoute.name = "popup-general"
	})
	afterEach(() => {
		mockRoute.name = "popup-general"
	})

	test("no blocking record: renders nothing", async () => {
		installChromeStorage({})
		const w = mountBarrier("p1")
		await flushPromises()
		expect(blocked(w)).toBe(false)
	})

	test("record for the PRESENTED profile: full-screen barrier with the required copy", async () => {
		installChromeStorage({ [KEY]: record("p1") })
		const w = mountBarrier("p1")
		await flushPromises()
		expect(blocked(w)).toBe(true)
		expect(w.text()).toContain("ACCOUNT VERIFICATION FAILED")
		expect(w.text()).toContain("derives a different address")
		expect(w.text()).toContain("seed phrase still derives your accounts")
		expect(w.text()).not.toContain("funds are safe")
	})

	test("record for a DIFFERENT profile than the presented one does not brick it", async () => {
		installChromeStorage({ [KEY]: record("p1") })
		const w = mountBarrier("other-profile")
		await flushPromises()
		expect(blocked(w)).toBe(false)
	})

	test("FAIL CLOSED: a block while the presented profile is UNRESOLVED still shows the barrier", async () => {
		installChromeStorage({ [KEY]: record("p1") })
		const w = mountBarrier(undefined)
		await flushPromises()
		expect(blocked(w)).toBe(true)
	})

	test("a CORRUPT record blocks regardless of profile (fail-closed presence semantics)", async () => {
		installChromeStorage({ [KEY]: "{truncated" })
		const w = mountBarrier("unrelated")
		await flushPromises()
		expect(blocked(w)).toBe(true)
	})

	test("phishing-surface bans: no inputs, no links, no buttons", async () => {
		installChromeStorage({ [KEY]: record("p1") })
		const w = mountBarrier("p1")
		await flushPromises()
		expect(w.find("input").exists()).toBe(false)
		expect(w.find("textarea").exists()).toBe(false)
		expect(w.find("a").exists()).toBe(false)
		expect(w.find("button").exists()).toBe(false)
	})

	test("yields on the auth route so unlock (the heal vector) stays reachable", async () => {
		mockRoute.name = "popup-auth"
		installChromeStorage({ [KEY]: record("p1") })
		const w = mountBarrier("p1")
		await flushPromises()
		expect(blocked(w)).toBe(false)
	})

	test("yields on the register route too", async () => {
		mockRoute.name = "popup-register"
		installChromeStorage({ [KEY]: record("p1") })
		const w = mountBarrier("p1")
		await flushPromises()
		expect(blocked(w)).toBe(false)
	})

	test("live updates: appears on record write, disappears on heal", async () => {
		const storage = installChromeStorage({})
		const w = mountBarrier("p1")
		await flushPromises()
		expect(blocked(w)).toBe(false)

		storage.data[KEY] = record("p1")
		storage.fire({ [KEY]: { newValue: storage.data[KEY] } })
		await flushPromises()
		expect(blocked(w)).toBe(true)

		delete storage.data[KEY]
		storage.fire({ [KEY]: { newValue: undefined } })
		await flushPromises()
		expect(blocked(w)).toBe(false)
	})

	test("changes in other storage areas are ignored", async () => {
		const storage = installChromeStorage({})
		const w = mountBarrier("p1")
		await flushPromises()
		storage.data[KEY] = record("p1")
		storage.fire({ [KEY]: { newValue: storage.data[KEY] } }, "session")
		await flushPromises()
		expect(blocked(w)).toBe(false)
	})
})
