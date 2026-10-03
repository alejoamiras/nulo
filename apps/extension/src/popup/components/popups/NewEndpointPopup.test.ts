/**
 * Component tests for NewEndpointPopup — pins the popup's wiring onto the
 * shared `usePopupEntity` lifecycle: Enter submits ONLY while an
 * input/textarea is focused (a global Enter must not), the listener dies with
 * the popup, and show resets the fields. The composable's own mechanics are
 * covered in `usePopupEntity.test.ts`; these pins prove THIS popup is wired
 * through it and that its submit guard still gates the Enter path. The error
 * copy per rejection is pinned at the end, byte for byte.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"

const addEndpointMock = vi.fn()
const getNetworksMock = vi.fn()
const openToastMock = vi.fn()

vi.mock("@/utils/core", () => ({
	managers: {
		network: {
			addEndpoint: (...args: unknown[]) => addEndpointMock(...args),
			getNetworks: (...args: unknown[]) => getNetworksMock(...args),
		},
	},
}))

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
}))

// One reactive store, so a test can take the network away while a request is in flight.
const { app, NETWORKS } = vi.hoisted(() => ({
	app: { store: undefined as unknown as { networks: { id: string; chainId: number; name: string }[] } },
	NETWORKS: [{ id: "net-1", chainId: 1, name: "Local" }],
}))
vi.mock("@/stores/app.store", async () => {
	const { reactive } = await import("vue")
	app.store = reactive({ networks: [...NETWORKS] })
	return { useAppStore: () => app.store }
})
vi.mock("@/stores/cache.store", () => ({
	useCacheStore: () => ({ endpointEditNetworkId: "net-1" }),
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { new_endpoint: { order: 1 } } }),
}))

const STUBS = {
	FormPopup: {
		props: ["show", "submitLabel", "submitDisabled", "submitLoading", "displaceIdx", "submitTestId"],
		emits: ["onClose", "submit"],
		template: `<div><slot name="title" /><slot /><slot name="belowSubmit" /></div>`,
	},
	Input: {
		props: ["modelValue", "label"],
		emits: ["update:modelValue"],
		template: `<label><input :data-input-label="label" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /><slot name="right" /></label>`,
	},
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Transition: { template: "<div><slot /></div>" },
}

import NewEndpointPopup from "./NewEndpointPopup.vue"

/** Bubbling keydown FROM a real document-level input so the document listener
 *  sees `event.target` as an input (the composable's submit guard). */
function pressEnterOnInput() {
	const el = document.createElement("input")
	document.body.appendChild(el)
	el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}
function pressEnterOnBody() {
	document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}

const wrappers: VueWrapper[] = []

async function mountShown(): Promise<VueWrapper> {
	const w = mount(NewEndpointPopup, { props: { show: false }, global: { stubs: STUBS } })
	wrappers.push(w)
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

/** Plain unmount suffices since usePopupEntity's scope cleanup removes the
 *  document listener; onHide side effects are NOT run here — tests that need
 *  them hide explicitly. */
async function dispose(w: VueWrapper) {
	w.unmount()
}

async function fillRpcUrl(w: VueWrapper, url: string) {
	const rpc = w.findAll("input").find((i) => i.attributes("data-input-label") === "RPC URL")
	if (!rpc) throw new Error("RPC input not rendered")
	await rpc.setValue(url)
}

beforeEach(() => {
	addEndpointMock.mockResolvedValue(undefined)
	getNetworksMock.mockResolvedValue([])
	app.store.networks = [...NETWORKS]
})

afterEach(() => {
	// Guaranteed net — runs even when an assertion skipped the in-test dispose.
	for (const w of wrappers.splice(0)) {
		try {
			w.unmount()
		} catch {
			/* already unmounted by the test */
		}
	}
	vi.clearAllMocks()
	document.body.innerHTML = ""
})

describe("NewEndpointPopup — Enter-submit wiring (usePopupEntity)", () => {
	test("Enter while an input is focused submits (addEndpoint called)", async () => {
		const w = await mountShown()
		await fillRpcUrl(w, "https://rpc.example.com")
		pressEnterOnInput()
		await flushPromises()
		expect(addEndpointMock).toHaveBeenCalledWith("net-1", undefined, "https://rpc.example.com")
		await dispose(w)
	})

	test("a global Enter (body focused) does NOT submit", async () => {
		const w = await mountShown()
		await fillRpcUrl(w, "https://rpc.example.com")
		pressEnterOnBody()
		await flushPromises()
		expect(addEndpointMock).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("Enter does NOT submit while the guard rejects (URL too short)", async () => {
		const w = await mountShown()
		await fillRpcUrl(w, "http")
		pressEnterOnInput()
		await flushPromises()
		expect(addEndpointMock).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("after hide, Enter is inert (listener removed)", async () => {
		const w = await mountShown()
		await fillRpcUrl(w, "https://rpc.example.com")
		await w.setProps({ show: false })
		pressEnterOnInput()
		await flushPromises()
		expect(addEndpointMock).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("re-show resets the fields (label + URL cleared)", async () => {
		const w = await mountShown()
		const label = w.findAll("input").find((i) => i.attributes("data-input-label") === "Label (optional)")
		await label?.setValue("Backup")
		await fillRpcUrl(w, "https://rpc.example.com")
		await w.setProps({ show: false })
		await w.setProps({ show: true })
		await flushPromises()
		const rpc = w.findAll("input").find((i) => i.attributes("data-input-label") === "RPC URL")
		expect((rpc?.element as HTMLInputElement | undefined)?.value).toBe("")
		const labelAfter = w.findAll("input").find((i) => i.attributes("data-input-label") === "Label (optional)")
		expect((labelAfter?.element as HTMLInputElement | undefined)?.value).toBe("")
		// And the cleared URL fails the submit guard again.
		pressEnterOnInput()
		await flushPromises()
		expect(addEndpointMock).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("(RE-ENTRANCY PIN) repeated Enter during an in-flight probe fires addEndpoint ONCE", async () => {
		addEndpointMock.mockImplementationOnce(() => new Promise(() => {}))
		const w = await mountShown()
		await fillRpcUrl(w, "https://rpc.example.com")
		pressEnterOnInput()
		await flushPromises()
		pressEnterOnInput()
		await flushPromises()
		// Cleanup BEFORE the assertion: a failing expect must not skip dispose
		// and leak this instance's document listener into the next test.
		const calls = addEndpointMock.mock.calls.length
		await dispose(w)
		expect(calls).toBe(1)
	})

	test("submit success closes the popup and toasts", async () => {
		const w = await mountShown()
		await fillRpcUrl(w, "https://rpc.example.com")
		pressEnterOnInput()
		await flushPromises()
		expect(w.emitted("onClose")).toBeTruthy()
		expect(openToastMock).toHaveBeenCalledWith({ kind: "success", label: "Endpoint added" })
		await dispose(w)
	})
})

/** A submit button routes the handler's own rejection to the app error handler, as Vue does for a
 *  component event, instead of the document listener's unhandled promise. */
const SUBMIT_STUBS = {
	...STUBS,
	FormPopup: {
		props: ["show", "submitLabel", "submitDisabled", "submitLoading", "displaceIdx", "submitTestId"],
		emits: ["onClose", "submit"],
		template: `<div><slot name="title" /><slot /><button data-testid="submit" :data-loading="String(!!submitLoading)" @click="$emit('submit')">go</button></div>`,
	},
}

async function mountForErrors(): Promise<{ w: VueWrapper; errors: unknown[] }> {
	const errors: unknown[] = []
	const w = mount(NewEndpointPopup, {
		props: { show: false },
		global: { stubs: SUBMIT_STUBS, config: { errorHandler: (err) => errors.push(err) } },
	})
	wrappers.push(w)
	await w.setProps({ show: true })
	await flushPromises()
	await fillRpcUrl(w, "https://rpc.example.com")
	return { w, errors }
}

const fieldText = (w: VueWrapper) =>
	w
		.findAll("label")
		.find((l) => l.find("input").attributes("data-input-label") === "RPC URL")
		?.text() ?? ""

describe("NewEndpointPopup: the RPC URL field's error copy", () => {
	test.each([
		["ENDPOINT_CHAIN_MISMATCH: This RPC reports chainId 5, but this network is chain 1.", "Wrong chain. This network is chain 1."],
		["ENDPOINT_CHAIN_MISMATCH: This RPC reports L1 chain 2, but this network is L1 chain 0.", "Wrong chain. This network is chain 1."],
		["DUPLICATE_ENDPOINT: This URL is already an endpoint of this network.", "This URL is already an endpoint of this network."],
		["Failed to fetch node info", "RPC didn't respond. Check the URL."],
		["Failed to fetch node info.", "Something went wrong."],
		["DUPLICATE_ENDPOINT then ENDPOINT_CHAIN_MISMATCH", "Wrong chain. This network is chain 1."],
		["Invalid params for addEndpoint: RPC URL must use https://", "Something went wrong."],
	])("a rejection %j shows %j", async (message, copy) => {
		addEndpointMock.mockRejectedValueOnce(new Error(message))
		const { w, errors } = await mountForErrors()
		await w.find('[data-testid="submit"]').trigger("click")
		await flushPromises()
		expect(fieldText(w)).toBe(copy)
		expect(errors).toEqual([])
	})

	describe("the network leaves the store while the request is in flight", () => {
		async function rejectAfterNetworkLeaves(message: string) {
			let reject!: (e: Error) => void
			addEndpointMock.mockImplementationOnce(
				() =>
					new Promise((_resolve, rej) => {
						reject = rej
					}),
			)
			const ctx = await mountForErrors()
			await ctx.w.find('[data-testid="submit"]').trigger("click")
			await flushPromises()
			app.store.networks = []
			await flushPromises()
			reject(new Error(message))
			await flushPromises()
			return ctx
		}

		test("a duplicate reads no chain id and shows its copy", async () => {
			const { w, errors } = await rejectAfterNetworkLeaves("DUPLICATE_ENDPOINT: x")
			expect(fieldText(w)).toBe("This URL is already an endpoint of this network.")
			expect(errors).toEqual([])
			expect(w.find('[data-testid="submit"]').attributes("data-loading")).toBe("false")
		})

		test("a chain mismatch reads the chain id optionally and interpolates undefined", async () => {
			const { w, errors } = await rejectAfterNetworkLeaves("ENDPOINT_CHAIN_MISMATCH: x")
			expect(fieldText(w)).toBe("Wrong chain. This network is chain undefined.")
			expect(errors).toEqual([])
			expect(w.find('[data-testid="submit"]').attributes("data-loading")).toBe("false")
		})
	})
})
