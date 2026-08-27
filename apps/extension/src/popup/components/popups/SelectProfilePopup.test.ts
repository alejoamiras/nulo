/**
 * B-09: the "Select Profile" popup must route its scope switch through
 * `appStore.commitScopeChange`, like every other scope-mutating call site — a
 * raw `appStore.profile = profile` bypasses the in-flight-send guard, letting a
 * send that is mid-build/prove finish against the wrong profile.
 */
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const H = vi.hoisted(() => {
	const profiles = [
		{ id: "p1", name: "Alpha" },
		{ id: "p2", name: "Beta" },
	]
	const appStoreState = {
		profile: null as unknown,
		blockSend: false,
		commitScopeChange: vi.fn(),
	}
	appStoreState.commitScopeChange.mockImplementation(async (commit: () => void) => {
		if (appStoreState.blockSend) return false
		commit()
		return true
	})
	return {
		profiles,
		appStoreState,
		openToastMock: vi.fn(),
		setLastActiveProfileIdMock: vi.fn().mockResolvedValue(undefined),
	}
})

vi.mock("@/stores/app.store", () => ({ useAppStore: () => H.appStoreState }))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { select_profile: { order: 0 } }, closeAll: vi.fn() }),
}))
vi.mock("@/composables/toast", () => ({ useToast: () => ({ openToast: H.openToastMock }) }))
vi.mock("@/utils/lastActiveProfile", () => ({ setLastActiveProfileId: H.setLastActiveProfileIdMock }))
vi.mock("@/utils/string", () => ({ stringCompare: (a: string, b: string) => a.localeCompare(b) }))
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: class {
		onProfileAdded = { add: vi.fn() }
		onProfileUpdated = { add: vi.fn() }
		onProfileDeleted = { add: vi.fn() }
		disconnect = vi.fn()
		getProfiles = vi.fn().mockResolvedValue(H.profiles)
	},
}))

const STUBS = {
	Popup: { props: ["show", "displaceIdx"], emits: ["onClose"], template: '<div v-if="show"><slot /></div>' },
	PopupCard: { template: "<div><slot /></div>" },
	Flex: { template: "<div><slot /></div>" },
	ItemsContainer: { template: "<div><slot /></div>" },
	SettingItem: {
		props: ["title"],
		emits: ["click"],
		template: "<button :data-testid=\"$attrs['data-testid']\" @click=\"$emit('click')\"><slot /></button>",
		inheritAttrs: false,
	},
	Icon: { props: ["name", "size", "color"], template: "<i />" },
	Button: { emits: ["click"], template: "<button @click=\"$emit('click')\"><slot /></button>" },
}

import SelectProfilePopup from "./SelectProfilePopup.vue"

async function mountOpen() {
	const w = mount(SelectProfilePopup, { props: { show: false }, global: { stubs: STUBS } })
	await w.setProps({ show: true }) // the show-watch loads + renders profiles
	await flushPromises()
	return w
}

beforeEach(() => {
	H.openToastMock.mockClear()
	H.setLastActiveProfileIdMock.mockClear()
	H.appStoreState.commitScopeChange.mockClear()
	H.appStoreState.profile = null
	H.appStoreState.blockSend = false
})

afterEach(() => vi.restoreAllMocks())

describe("SelectProfilePopup — scope-switch guard (B-09)", () => {
	test("switches, persists, and closes when no send is in flight", async () => {
		const w = await mountOpen()
		await w.find('[data-testid="select-profile-row"]').trigger("click")
		await flushPromises()

		expect(H.appStoreState.commitScopeChange).toHaveBeenCalledTimes(1)
		expect(H.appStoreState.profile).toEqual(H.profiles[0]) // commit ran → scope changed
		expect(H.setLastActiveProfileIdMock).toHaveBeenCalledWith("p1")
		expect(w.emitted("onClose")?.length).toBe(1)
	})

	test("(B-09) a double-click switches once — the second is dropped by the submit latch", async () => {
		// Hold the first commit in flight so the second click lands while it's still submitting.
		let releaseCommit!: (v: boolean) => void
		H.appStoreState.commitScopeChange.mockImplementationOnce(
			(commit: () => void) =>
				new Promise((resolve) => {
					releaseCommit = (v: boolean) => {
						if (v) commit()
						resolve(v)
					}
				}),
		)
		const w = await mountOpen()
		const row = w.find('[data-testid="select-profile-row"]')
		await row.trigger("click") // first click → commit pending, latch set
		await row.trigger("click") // second click → dropped by the latch
		expect(H.appStoreState.commitScopeChange).toHaveBeenCalledTimes(1)

		releaseCommit(true)
		await flushPromises()
		expect(w.emitted("onClose")?.length).toBe(1) // exactly one switch completed
	})

	test("refuses the switch when a send is in flight: no scope change, no persist, no close, toast shown", async () => {
		H.appStoreState.blockSend = true
		const w = await mountOpen()
		await w.find('[data-testid="select-profile-row"]').trigger("click")
		await flushPromises()

		expect(H.appStoreState.commitScopeChange).toHaveBeenCalledTimes(1)
		expect(H.appStoreState.profile).toBeNull() // commit was NOT run
		expect(H.setLastActiveProfileIdMock).not.toHaveBeenCalled()
		expect(w.emitted("onClose")).toBeUndefined()
		expect(H.openToastMock).toHaveBeenCalledWith(
			expect.objectContaining({ label: "Finish or cancel your pending transaction first" }),
			3_000,
		)
	})
})
