import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"

const OWNER = `0x${"0a".repeat(32)}`
const PAYLOAD = {
	params: {
		operations: [
			{
				kind: "aztec_sendTx",
				account: `aztec:1:${OWNER}`,
				exec: { calls: [{ name: "transfer_in_private", to: `0x${"1c".repeat(32)}`, args: [`0x${"00".repeat(31)}05`] }] },
				opts: { from: OWNER },
			},
		],
	},
}

let onProfile: ((profile: unknown) => void) | undefined

vi.mock("@/wallet/services/dapp-interaction/client", () => ({
	DappInteractionServiceClient: vi.fn(function () {
		return { getInteractionPayload: async () => PAYLOAD, disconnect: () => {} }
	}),
}))
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return {
			onActiveProfileChanged: { add: (fn: (profile: unknown) => void) => (onProfile = fn) },
			connect: async () => {},
			disconnect: () => {},
		}
	}),
}))

import JsonWindow from "./index.vue"

const STUBS = { Flex: { template: "<div><slot /></div>" }, JsonViewer: { template: "<div />" } }

let currentWindow: { id?: number } | undefined = { id: 7 }
const getCurrent = vi.fn((...args: unknown[]) => (args.at(-1) as (w?: { id?: number }) => void)(currentWindow))
const remove = vi.fn()

const wrappers: Array<ReturnType<typeof mount>> = []
async function mountWindow(): Promise<(profile: unknown) => void> {
	wrappers.push(mount(JsonWindow, { global: { stubs: STUBS } }))
	await flushPromises()
	if (!onProfile) throw new Error("the window never registered its profile handler")
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

describe("windows/json — closing when the profile goes away", () => {
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
