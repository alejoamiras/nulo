/**
 * `handleDiscovery` for a chain the profile has no network for, driven through the SDK handler's
 * callbacks: the dApp is refused (silence), the user gets the network-unavailable notice in place
 * of the connect window, no session is written, and a remembered row for the pair is dropped
 * instead of reconnecting. The notice shares the connect window's dedupe and caps, the unlock drain
 * reaches the same gate, and a served chain still connects.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

type Callbacks = {
	onPendingDiscovery: (d: unknown) => void
	onSessionEstablished: (s: unknown) => Promise<void> | void
	onSessionTerminated: (id: string) => void
}
let captured: Callbacks | undefined
const handlerCalls: string[] = []
const pending = new Map<string, Record<string, unknown>>()

vi.mock("@aztec-labs/wallet-sdk/extension/handlers", () => ({
	BackgroundConnectionHandler: class {
		constructor(_meta: unknown, _transport: unknown, callbacks: Callbacks) {
			captured = callbacks
		}
		handleEncryptedMessage() {
			return Promise.resolve()
		}
		getActiveSessions() {
			return []
		}
		getPendingDiscovery(id: string) {
			return pending.get(id)
		}
		approveDiscovery(id: string) {
			handlerCalls.push(`approve:${id}`)
			return true
		}
		rejectDiscovery(id: string) {
			handlerCalls.push(`reject:${id}`)
		}
		terminateSession() {}
		terminateForTab() {}
		initialize() {}
	},
}))
vi.mock("./content-message-relay", () => ({ attachContentListener: () => {} }))
vi.mock("./tab-lifecycle", () => ({ wireTabLifecycle: () => {} }))
vi.mock("@nulo/wallet-sdk-schema-patch/register", () => ({}))

import { initWalletSdkHandler } from "./background"
import { fakeSdkPorts } from "./test-ports"
import { FAKE_DAPP_ORIGIN as ORIGIN, fakeSdkServices } from "./test-services"

const noopLogger = { log: () => {} } as never

type NoticeParams = { dappMetadata: { name: string; url: string } }

function held() {
	let release!: () => void
	const promise = new Promise<void>((r) => {
		release = r
	})
	return { promise, release }
}

function boot(opts: Parameters<typeof fakeSdkServices>[0] = {}) {
	const fake = fakeSdkServices(opts)
	initWalletSdkHandler(fake.services, noopLogger, fakeSdkPorts())
	/** `chain` is the wallet chain id: `chainInfo` `{ chainId: n, version: 0 }` derives to `n`. */
	const discover = (requestId: string, chain = 0) => {
		const discovery = {
			requestId,
			origin: ORIGIN,
			appId: "app",
			appName: "App",
			chainInfo: { chainId: String(chain), version: "0" },
			timestamp: Date.now(),
			tabId: 7,
			status: "pending",
		}
		pending.set(requestId, discovery)
		captured?.onPendingDiscovery(discovery)
	}
	return { discover, rows: fake.rows, onActiveProfileChanged: fake.onActiveProfileChanged }
}

const flush = async () => {
	for (let i = 0; i < 30; i++) await Promise.resolve()
}
const approved = () => handlerCalls.filter((c) => c.startsWith("approve:")).map((c) => c.slice(8))
const rejected = () => handlerCalls.filter((c) => c.startsWith("reject:")).map((c) => c.slice(7))

beforeEach(() => {
	handlerCalls.length = 0
	pending.clear()
	captured = undefined
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub
	;(globalThis as any).chrome = {
		runtime: { getURL: (p: string) => p },
		tabs: { sendMessage: () => {} },
		action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
	}
	// biome-ignore lint/suspicious/noExplicitAny: vite define-injected global
	;(globalThis as any).__VERSION__ = "test"
})
afterEach(() => vi.restoreAllMocks())

describe("discovery for a chain the profile has no network for", () => {
	test("a new origin is refused, sees the notice instead of the connect window, and gets no session", async () => {
		const popup = vi.fn(async () => ({ approved: true }))
		const notice = vi.fn(async (_p: NoticeParams) => {})
		const { discover, rows } = boot({ popup, notice, served: () => false })

		discover("u1", 1816023401)
		await flush()

		expect(rejected()).toEqual(["u1"])
		expect(approved()).toEqual([])
		expect(popup).not.toHaveBeenCalled()
		expect(notice).toHaveBeenCalledTimes(1)
		expect(notice.mock.calls[0]?.[0]).toEqual({ dappMetadata: { name: "App", url: ORIGIN } })
		expect(rows.size).toBe(0)
	})

	test("the dApp is refused before the notice opens, so no answer from the window can approve it", async () => {
		const window = held()
		const { discover } = boot({ notice: () => window.promise, served: () => false })

		discover("u1", 5)
		await flush()

		expect(rejected()).toEqual(["u1"])
		window.release()
		await flush()
		expect(approved()).toEqual([])
	})

	test("a remembered row does not reconnect: it is dropped and the notice opens", async () => {
		const notice = vi.fn(async (_p: NoticeParams) => {})
		const { discover, rows } = boot({ remembered: { trusted: true }, notice, served: () => false })
		expect(rows.has(`${ORIGIN}|0`)).toBe(true)

		discover("s1", 0)
		await flush()

		expect(approved()).toEqual([])
		expect(rejected()).toEqual(["s1"])
		expect(notice).toHaveBeenCalledTimes(1)
		expect(rows.has(`${ORIGIN}|0`)).toBe(false)
	})

	test("a duplicate while the notice is open is refused without a second notice; the next try after it closes gets one", async () => {
		const window = held()
		const notice = vi.fn((_p: NoticeParams) => window.promise)
		const { discover } = boot({ notice, served: () => false })

		discover("d1", 9)
		await flush()
		discover("d2", 9)
		await flush()
		expect(rejected()).toEqual(["d1", "d2"])
		expect(notice).toHaveBeenCalledTimes(1)

		window.release()
		await flush()
		discover("d3", 9)
		await flush()
		expect(notice).toHaveBeenCalledTimes(2)
		expect(approved()).toEqual([])
	})

	test("notices count against the connect window's per-origin cap", async () => {
		const window = held()
		const notice = vi.fn((_p: NoticeParams) => window.promise)
		const { discover } = boot({ notice, served: () => false })

		for (let chain = 1; chain <= 5; chain++) discover(`c${chain}`, chain)
		await flush()

		expect(notice).toHaveBeenCalledTimes(4)
		expect(rejected()).toEqual(["c1", "c2", "c3", "c4", "c5"])
		window.release()
	})

	test("a profile switch during the reads refuses the discovery: no notice, and the remembered row is kept", async () => {
		const reads = held()
		const notice = vi.fn(async (_p: NoticeParams) => {})
		const { discover, rows, onActiveProfileChanged } = boot({
			remembered: { trusted: true },
			notice,
			served: () => reads.promise.then(() => false),
		})

		discover("sw1", 0)
		await flush()
		onActiveProfileChanged.invoke({ id: "p2" })
		reads.release()
		await flush()

		expect(rejected()).toEqual(["sw1"])
		expect(notice).not.toHaveBeenCalled()
		expect(rows.has(`${ORIGIN}|0`)).toBe(true)
	})

	test("the drop re-reads the row's own chain: a network added back meanwhile keeps the row", async () => {
		let reads = 0
		const notice = vi.fn(async (_p: NoticeParams) => {})
		const { discover, rows } = boot({ remembered: { trusted: true }, notice, served: () => reads++ > 0 })

		discover("back1", 0)
		await flush()

		expect(rejected()).toEqual(["back1"])
		expect(notice).toHaveBeenCalledTimes(1)
		expect(rows.has(`${ORIGIN}|0`)).toBe(true)
	})

	test("a discovery queued while locked reaches the same gate on unlock", async () => {
		let unlocked = false
		const notice = vi.fn(async (_p: NoticeParams) => {})
		const { discover, rows, onActiveProfileChanged } = boot({
			notice,
			served: () => false,
			activeProfile: async () => (unlocked ? { id: "p1" } : undefined),
		})

		discover("q1", 1816023401)
		await flush()
		expect(rejected()).toEqual([])
		expect(notice).not.toHaveBeenCalled()

		unlocked = true
		onActiveProfileChanged.invoke({ id: "p1" })
		await flush()

		expect(rejected()).toEqual(["q1"])
		expect(notice).toHaveBeenCalledTimes(1)
		expect(rows.size).toBe(0)
	})
})

describe("discovery for a chain the profile serves", () => {
	test("opens the connect window and approves on Allow, with no notice", async () => {
		const popup = vi.fn(async () => ({ approved: true }))
		const notice = vi.fn(async (_p: NoticeParams) => {})
		const { discover, rows } = boot({ popup, notice, served: (chain) => chain === 0 })

		discover("ok1", 0)
		await flush()

		expect(popup).toHaveBeenCalledTimes(1)
		expect(notice).not.toHaveBeenCalled()
		expect(approved()).toEqual(["ok1"])
		expect(rows.has(`${ORIGIN}|0`)).toBe(true)
	})

	test("a network removed while its connect window is open: Allow writes no row and the dApp is refused", async () => {
		const window = held()
		let servedNow = true
		const popup = vi.fn(() => window.promise.then(() => ({ approved: true })))
		const { discover, rows } = boot({ popup, served: () => servedNow })

		discover("gone1", 0)
		await flush()
		expect(popup).toHaveBeenCalledTimes(1)
		servedNow = false
		window.release()
		await flush()

		expect(approved()).toEqual([])
		expect(rejected()).toEqual(["gone1"])
		expect(rows.size).toBe(0)
	})

	test("a profile switch during the re-read before the write refuses the Allow: no row for either profile", async () => {
		const reread = held()
		let active = "p1"
		let reads = 0
		const { discover, rows } = boot({
			served: () => (reads++ === 0 ? true : reread.promise.then(() => true)),
			activeProfile: async () => ({ id: active }),
		})

		discover("sw2", 0)
		await flush()
		expect(reads).toBe(2)
		active = "p2"
		reread.release()
		await flush()

		expect(approved()).toEqual([])
		expect(rejected()).toEqual(["sw2"])
		expect(rows.size).toBe(0)
	})

	test("a remembered row on a served chain still reconnects without a window", async () => {
		const popup = vi.fn(async () => ({ approved: true }))
		const { discover } = boot({ remembered: { trusted: true }, popup, served: () => true })

		discover("again-1", 0)
		await flush()

		expect(approved()).toEqual(["again-1"])
		expect(popup).not.toHaveBeenCalled()
	})
})
