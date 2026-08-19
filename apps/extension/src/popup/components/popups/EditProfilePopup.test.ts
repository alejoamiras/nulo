/**
 * Component tests for EditProfilePopup — pins the popup's wiring onto the
 * shared `usePopupEntity` lifecycle (Q-14): Enter submits ONLY from an
 * input/textarea (a global Enter must not), the client's connect/populate
 * lives in onShow and disconnect/reset in onHide, and the F4 collision guard
 * still gates the Enter path. Composable mechanics are covered in
 * `usePopupEntity.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"

const profileServiceMock = {
	getProfiles: vi.fn(),
	changeProfileName: vi.fn(),
	disconnect: vi.fn(),
}
const openToastMock = vi.fn()

// Vitest requires `function` expressions (not arrows) for mocks used with `new`.
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return profileServiceMock
	}),
}))

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
}))

const appStoreState = { profile: { id: "p1", name: "Main" } }
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => appStoreState,
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { edit_profile: { order: 1 } } }),
}))

const STUBS = {
	Popup: { props: ["show", "displaceIdx"], template: "<div><slot /></div>" },
	PopupCard: { props: ["displaceIdx"], template: "<div><slot /></div>" },
	PopupHeader: { emits: ["onClose"], template: "<div><slot name='title' /></div>" },
	ItemsContainer: { template: "<div><slot /></div>" },
	SettingItem: { props: ["title", "description", "icon", "size", "raw"], template: "<div />" },
	Input: {
		props: ["modelValue"],
		emits: ["update:modelValue"],
		template: `<label><input data-testid="name-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /><slot name="right" /></label>`,
	},
	Button: { props: ["disabled", "loading"], template: "<button :disabled='disabled'><slot /></button>" },
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Transition: { template: "<div><slot /></div>" },
}

import EditProfilePopup from "./EditProfilePopup.vue"

function pressEnterOnInput() {
	const el = document.createElement("input")
	document.body.appendChild(el)
	el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}
function pressEnterOnBody() {
	document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}

async function mountShown(): Promise<VueWrapper> {
	const w = mount(EditProfilePopup, { props: { show: false }, global: { stubs: STUBS } })
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

/** Hide-then-unmount: the composable only removes its document listener on
 *  show → false (production popups never unmount), so tests must hide first or
 *  the listener leaks into the next test. */
async function dispose(w: VueWrapper) {
	await w.setProps({ show: false })
	w.unmount()
}

/** Type a new name through the stub input (drives v-model + isStartedEditing). */
async function typeName(w: VueWrapper, name: string) {
	await w.find('[data-testid="name-input"]').setValue(name)
}

beforeEach(() => {
	appStoreState.profile = { id: "p1", name: "Main" }
	profileServiceMock.getProfiles.mockResolvedValue([
		{ id: "p1", name: "Main" },
		{ id: "p2", name: "Backup" },
	])
	profileServiceMock.changeProfileName.mockResolvedValue({ id: "p1", name: "Renamed" })
})

afterEach(() => {
	vi.clearAllMocks()
	document.body.innerHTML = ""
})

describe("EditProfilePopup — Enter-submit wiring (usePopupEntity)", () => {
	test("show connects the client and populates the collision list", async () => {
		const w = await mountShown()
		expect(profileServiceMock.getProfiles).toHaveBeenCalledTimes(1)
		await dispose(w)
	})

	test("Enter while an input is focused submits (changeProfileName called, with fresh re-check)", async () => {
		const w = await mountShown()
		await typeName(w, "Renamed")
		pressEnterOnInput()
		await flushPromises()
		// The F4 defense re-fetches profiles inside the submit latch.
		expect(profileServiceMock.getProfiles).toHaveBeenCalledTimes(2)
		expect(profileServiceMock.changeProfileName).toHaveBeenCalledWith("p1", "Renamed")
		expect(w.emitted("onClose")).toBeTruthy()
		await dispose(w)
	})

	test("a global Enter (body focused) does NOT submit", async () => {
		const w = await mountShown()
		await typeName(w, "Renamed")
		pressEnterOnBody()
		await flushPromises()
		expect(profileServiceMock.changeProfileName).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("Enter does NOT submit on a collision with another profile's name", async () => {
		const w = await mountShown()
		await typeName(w, "Backup")
		pressEnterOnInput()
		await flushPromises()
		expect(profileServiceMock.changeProfileName).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("Enter does NOT submit while the name is unchanged", async () => {
		const w = await mountShown()
		await typeName(w, "Main")
		pressEnterOnInput()
		await flushPromises()
		expect(profileServiceMock.changeProfileName).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("Enter is LIVE during the unresolved initial getProfiles — the fresh re-check gates a collision the stale list missed", async () => {
		// The composable installs the keydown listener BEFORE onShow's await
		// (the hand-rolled watch installed it after). A collision typed during
		// that window must be caught by the F4 re-fetch inside the submit latch.
		profileServiceMock.getProfiles.mockReset()
		profileServiceMock.getProfiles
			.mockImplementationOnce(() => new Promise(() => {})) // initial population never resolves
			.mockResolvedValueOnce([
				{ id: "p1", name: "Main" },
				{ id: "p2", name: "Backup" },
			])
		const w = await mountShown()
		await typeName(w, "Backup")
		pressEnterOnInput()
		await flushPromises()
		expect(profileServiceMock.getProfiles).toHaveBeenCalledTimes(2)
		expect(profileServiceMock.changeProfileName).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("Enter during the unresolved initial getProfiles submits a non-colliding name (no deadlock)", async () => {
		profileServiceMock.getProfiles.mockReset()
		profileServiceMock.getProfiles
			.mockImplementationOnce(() => new Promise(() => {}))
			.mockResolvedValueOnce([
				{ id: "p1", name: "Main" },
				{ id: "p2", name: "Backup" },
			])
		const w = await mountShown()
		await typeName(w, "Renamed")
		pressEnterOnInput()
		await flushPromises()
		expect(profileServiceMock.changeProfileName).toHaveBeenCalledWith("p1", "Renamed")
		await dispose(w)
	})

	test("re-show resets the editing state (name back to the profile's, submit button disabled again)", async () => {
		const w = await mountShown()
		await typeName(w, "Renamed")
		await w.setProps({ show: false })
		await w.setProps({ show: true })
		await flushPromises()
		const input = w.find('[data-testid="name-input"]').element as HTMLInputElement
		expect(input.value).toBe("Main")
		// isStartedEditing was reset on hide — the template's submit button is
		// gated on it and must be disabled until the user types again.
		const submitBtn = w.findAll("button").at(0)
		expect(submitBtn?.attributes("disabled")).toBeDefined()
		await dispose(w)
	})

	test("Enter before any edit does NOT submit — isStartedEditing gates the shared submit-validity source", async () => {
		// Regression pin (was a BUG PIN): isAvailableToUpdateProfile now gates
		// on isStartedEditing itself, so the Enter path and the button agree by
		// construction and a pre-edit Enter cannot submit the unchanged name.
		const w = await mountShown()
		pressEnterOnInput()
		await flushPromises()
		expect(profileServiceMock.changeProfileName).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("hide disconnects the client; Enter after hide is inert", async () => {
		const w = await mountShown()
		await typeName(w, "Renamed")
		await w.setProps({ show: false })
		expect(profileServiceMock.disconnect).toHaveBeenCalledTimes(1)
		pressEnterOnInput()
		await flushPromises()
		expect(profileServiceMock.changeProfileName).not.toHaveBeenCalled()
		await dispose(w)
	})
})
