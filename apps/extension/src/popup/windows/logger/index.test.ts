import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"

let onProfile: ((profile: unknown) => void) | undefined

vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return {
			connect: async () => {},
			disconnect: () => {},
			subscribeActiveProfile: async (fn: (profile: unknown) => void) => {
				onProfile = fn
				return () => {}
			},
		}
	}),
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => ({ loggerWindowId: 7 }) }))

import LoggerWindow from "./index.vue"

const STUBS = { Flex: { template: "<div><slot /></div>" }, LogsViewer: { template: "<div />" } }

let currentWindow: { id?: number } | undefined = { id: 7 }
const getCurrent = vi.fn((...args: unknown[]) => (args.at(-1) as (w?: { id?: number }) => void)(currentWindow))
const remove = vi.fn()

const wrappers: Array<ReturnType<typeof mount>> = []
async function mountWindow(): Promise<(profile: unknown) => void> {
	wrappers.push(mount(LoggerWindow, { global: { stubs: STUBS } }))
	await flushPromises()
	if (!onProfile) throw new Error("the window never subscribed to the active profile")
	return onProfile
}

beforeEach(() => {
	onProfile = undefined
	currentWindow = { id: 7 }
	vi.stubGlobal("chrome", { windows: { getCurrent, remove } })
})
afterEach(() => {
	for (const w of wrappers.splice(0)) w.unmount()
	vi.clearAllMocks()
})

describe("windows/logger — closing when the profile goes away", () => {
	test("a profile keeps the window; no profile removes the current window by its id, inside the event", async () => {
		const handler = await mountWindow()
		handler({ id: "p1" })
		expect(getCurrent).not.toHaveBeenCalled()
		handler(undefined)
		expect(getCurrent).toHaveBeenCalledTimes(1)
		expect(remove.mock.calls).toEqual([[7]])
	})

	test("a current window without an id is not removed", async () => {
		currentWindow = {}
		const handler = await mountWindow()
		handler(undefined)
		expect(getCurrent).toHaveBeenCalledTimes(1)
		expect(remove).not.toHaveBeenCalled()
	})

	test("a callback without a window (the lastError path) throws the engine's TypeError naming window.id", async () => {
		currentWindow = undefined
		const handler = await mountWindow()
		expect(() => handler(undefined)).toThrow(new TypeError("undefined is not an object (evaluating 'window.id')"))
		expect(remove).not.toHaveBeenCalled()
	})
})
