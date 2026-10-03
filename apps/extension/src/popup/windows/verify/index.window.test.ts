/**
 * The trust-confirmation window's own lifecycle and anti-phishing display, over wire-shaped rows:
 * `dappMetadata` as the worker writes it (a sanitized dApp name, the tab's serialized origin), a
 * 64-hex verification hash and CAIP accounts. The identity block is the real one, so the hostname
 * and its warning are read as rendered.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { ref } from "vue"
import DappIdentityBlock from "@/components/composite/DappIdentityBlock.vue"
import { sanitizeWireString } from "@/wallet/services/dapp-session/capability-meta"

const URL_HASH = "3c".repeat(32)
const ADDRESS = `0x${"0a".repeat(32)}`
const WIRE_NAME = sanitizeWireString(`‮Phishy​Dapp⁦Vault⁩${"x".repeat(70)}`, 64)

let routeQuery: Record<string, string> = {}
let sessionRow: unknown
const callLog: string[] = []
const getDappSession = vi.fn(async (id: string) => {
	callLog.push(`getDappSession:${id}`)
	if (sessionRow instanceof Error) throw sessionRow
	return sessionRow
})
const setTrustedVerification = vi.fn(async (id: string, trusted: boolean) => {
	callLog.push(`setTrustedVerification:${id}:${trusted}`)
})

/** The store's session flag, read through a counting getter so a watcher left running shows up. */
const sessionChecked = ref(true)
let sessionCheckedReads = 0

vi.mock("vue-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vue-router")>()
	return { ...actual, useRouter: () => ({ currentRoute: { value: { query: routeQuery } } }) }
})
vi.mock("@aztec-labs/wallet-sdk/crypto", () => ({ hashToEmoji: (hash: string) => `grid(${hash})` }))
vi.mock("@/wallet/services/dapp-session/client", () => ({
	DappSessionServiceClient: vi.fn(function () {
		return { connect: () => {}, disconnect: () => {}, getDappSession, setTrustedVerification }
	}),
}))
vi.mock("@/wallet/services/account/client", () => ({
	AccountServiceClient: vi.fn(function () {
		return { getAccount: async () => undefined, disconnect: () => {} }
	}),
}))
vi.mock("@/wallet/services/network/client", () => ({
	NetworkServiceClient: vi.fn(function () {
		return { getNetworks: async () => [], disconnect: () => {} }
	}),
}))
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({
		get isSessionChecked() {
			sessionCheckedReads++
			return sessionChecked.value
		},
		profile: { id: "p1" },
		networks: [],
	}),
}))

import Verify from "./index.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
	SectionLabel: { template: "<div />" },
	IdentityStrip: { template: "<div />" },
	EmojiGrid: { template: "<div />" },
	Toggle: {
		props: ["modelValue"],
		emits: ["update:modelValue"],
		template: `<button data-testid="toggle-stub" @click="$emit('update:modelValue', true)" />`,
	},
	Button: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
}

const row = (url: string) => ({
	id: "row-1",
	profileId: "p1",
	chainId: "0",
	accounts: [`aztec:0:${ADDRESS}`],
	verificationHash: "d1".repeat(32),
	dappMetadata: { name: WIRE_NAME, url },
})

let currentWindow: { id?: number } = { id: 7 }
const getCurrent = vi.fn((_options: unknown, cb: (w: { id?: number }) => void) => {
	callLog.push("getCurrent")
	cb(currentWindow)
})
const remove = vi.fn((id: number) => callLog.push(`remove:${id}`))

const wrappers: Array<ReturnType<typeof mount>> = []
const mountVerify = (query: Record<string, string> = { sessionId: "row-1", verificationHash: URL_HASH, isReconnect: "false" }) => {
	routeQuery = query
	const w = mount(Verify, { global: { stubs: STUBS, components: { DappIdentityBlock } } })
	wrappers.push(w)
	return w
}

/** Counts microtask rungs from the moment it starts, so a test can pin how many ticks an effect takes. */
function microtaskLadder(): () => number {
	let rung = 0
	const step = () => {
		rung++
		if (rung < 20) queueMicrotask(step)
	}
	queueMicrotask(step)
	return () => rung
}

/** The rung at which the read runs today; an extra `async` layer around the wait moves it. */
const SLOW_PATH_RUNG = 1

beforeEach(() => {
	sessionRow = row("https://dapp.example")
	sessionChecked.value = true
	sessionCheckedReads = 0
	currentWindow = { id: 7 }
	// biome-ignore lint/suspicious/noExplicitAny: chrome runtime stub for tests
	;(globalThis as any).chrome = { windows: { getCurrent, remove } }
})
afterEach(() => {
	for (const w of wrappers.splice(0)) w.unmount()
	callLog.length = 0
	vi.clearAllMocks()
})

describe("windows/verify — the hostname the user is asked to trust", () => {
	test.each([
		["https://dapp.example:8443", "dapp.example", false],
		["http://[::1]:5173", "[::1]", false],
		["https://xn--exmple-cua.com", "xn--exmple-cua.com", true],
		["https://dapp.example.evil.example", "dapp.example.evil.example", false],
		["null", "null", false],
		["unknown", "unknown", false],
		["https://dapp.example@evil.example", "evil.example", false],
	])("%s renders %s, warning %s", async (url, hostname, warned) => {
		sessionRow = row(url)
		const w = mountVerify()
		await flushPromises()
		const block = w.findComponent(DappIdentityBlock)
		expect(block.props("hostname")).toBe(hostname)
		expect(block.props("hostnameSuspicious")).toBe(warned)
		expect(block.text()).toContain(hostname)
		expect(block.find('[data-testid="dapp-hostname-warning"]').exists()).toBe(warned)
		for (const part of ["‮", "​", "⁦"]) expect(block.text()).not.toContain(part)
	})
})

describe("windows/verify — closing", () => {
	test.each([
		["no sessionId in the URL", () => mountVerify({ verificationHash: URL_HASH })],
		[
			"no row for the session",
			() => {
				sessionRow = undefined
				return mountVerify()
			},
		],
		[
			"a failed row read",
			() => {
				sessionRow = new Error("port gone")
				return mountVerify()
			},
		],
	])("%s closes the current window by id", async (_, open) => {
		open()
		await flushPromises()
		expect(getCurrent).toHaveBeenCalledTimes(1)
		expect(getCurrent.mock.calls[0][0]).toBeUndefined()
		expect(typeof getCurrent.mock.calls[0][1]).toBe("function")
		expect(remove.mock.calls).toEqual([[7]])
	})

	test("a current window without an id is not removed", async () => {
		currentWindow = {}
		mountVerify({ verificationHash: URL_HASH })
		await flushPromises()
		expect(getCurrent).toHaveBeenCalledTimes(1)
		expect(remove).not.toHaveBeenCalled()
	})

	test("OK with Always trust records the trust before the window closes", async () => {
		const w = mountVerify()
		await flushPromises()
		await w.get('[data-testid="toggle-stub"]').trigger("click")
		await w.get('[data-testid="verify-confirm-btn"]').trigger("click")
		await flushPromises()
		expect(callLog).toEqual(["getDappSession:row-1", "setTrustedVerification:row-1:true", "getCurrent", "remove:7"])
	})
})

describe("windows/verify — the session wait", () => {
	test("an already checked session is read inside mount, before any tick", () => {
		mountVerify()
		expect(getDappSession).toHaveBeenCalledTimes(1)
	})

	test("an unchecked session is read on a fixed tick after the flag flips, and the watcher stops", async () => {
		sessionChecked.value = false
		let readAt = -1
		const w = mountVerify()
		await flushPromises()
		expect(getDappSession).not.toHaveBeenCalled()

		sessionChecked.value = true
		const rung = microtaskLadder()
		getDappSession.mockImplementationOnce(async (id: string) => {
			readAt = rung()
			callLog.push(`getDappSession:${id}`)
			return sessionRow
		})
		await flushPromises()
		expect(getDappSession).toHaveBeenCalledTimes(1)
		expect(readAt).toBe(SLOW_PATH_RUNG)

		const reads = sessionCheckedReads
		sessionChecked.value = false
		await flushPromises()
		sessionChecked.value = true
		await flushPromises()
		expect(sessionCheckedReads).toBe(reads)
		expect(getDappSession).toHaveBeenCalledTimes(1)
		void w
	})
})
