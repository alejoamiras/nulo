/**
 * `handleDiscovery` through the origin's admission gate, driven end to end through the SDK
 * handler's callbacks with a fake clock: a remembered origin's reload loop is served three at
 * once and then one per refill, an untrusted one also waits for verify-window capacity, a fresh
 * connection reserves its window after the popup and gives it back on a rolled-back approval,
 * and the number of handshakes parked behind one popup is bounded.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { EventHandler } from "@nulo/wallet-core/utils"
import { DISCOVERY_STALE_MS } from "@nulo/wallet-bridge"

type Callbacks = {
	onPendingDiscovery: (d: unknown) => void
	onSessionEstablished: (s: unknown) => Promise<void> | void
	onSessionTerminated: (id: string) => void
}
let captured: Callbacks | undefined
const handlerCalls: string[] = []
const live = new Set<string>()

vi.mock("@aztec/wallet-sdk/extension/handlers", () => ({
	BackgroundConnectionHandler: class {
		constructor(_meta: unknown, _transport: unknown, callbacks: Callbacks) {
			captured = callbacks
		}
		handleEncryptedMessage() {
			return Promise.resolve()
		}
		getActiveSessions() {
			return [...live].map((sessionId) => ({ sessionId }))
		}
		approveDiscovery(id: string) {
			handlerCalls.push(`approve:${id}`)
			return true
		}
		rejectDiscovery(id: string) {
			handlerCalls.push(`reject:${id}`)
		}
		terminateSession(id: string) {
			live.delete(id)
			captured?.onSessionTerminated(id)
		}
		terminateForTab() {}
		initialize() {}
	},
}))
vi.mock("./content-message-relay", () => ({ attachContentListener: () => {} }))
vi.mock("./tab-lifecycle", () => ({ wireTabLifecycle: () => {} }))
vi.mock("@nulo/wallet-sdk-schema-patch/register", () => ({}))

import { initWalletSdkHandler } from "./background"
import { RECONNECT_REFILL_MS } from "./verify-admission"
import { fakeSdkPorts } from "./test-ports"

const ORIGIN = "https://dapp.example"
const noopLogger = { log: () => {} } as never

function deferred<T>() {
	let resolve!: (v: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

/** Boot the handler over a remembered session (`trusted` decides whether a verify window opens). */
function boot(opts: { remembered?: { trusted: boolean }; popup?: () => Promise<{ approved: boolean }> } = {}) {
	let created = 0
	const onRemoved: Array<(id: number) => void> = []
	const ports = fakeSdkPorts({
		create: async () => ({ id: ++created }),
		onRemoved: (listener) => {
			onRemoved.push(listener)
			return () => {}
		},
	})
	ports.clock = {
		...ports.clock,
		now: () => Date.now(),
		setTimeout: (fn, ms) => setTimeout(fn, ms),
		clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
	}
	const rows = new Map<string, { id: string; profileId: string; trustedVerification: boolean }>()
	if (opts.remembered) rows.set(`${ORIGIN}|0`, { id: "row-1", profileId: "p1", trustedVerification: opts.remembered.trusted })
	const services = {
		get: (name: string) =>
			({
				network: {},
				account: {},
				execution: {},
				profile: { onActiveProfileChanged: new EventHandler<unknown>(), getActiveProfile: async () => ({ id: "p1" }) },
				"dapp-interaction": { discover: opts.popup ?? (async () => ({ approved: true })) },
				"dapp-session": {
					onDappSessionDeleted: new EventHandler<unknown>(),
					tryGetDappSessionByOriginAndChain: async (origin: string, chainId: string) => rows.get(`${origin}|${chainId}`),
					addDappSession: async (_m: unknown, _p: unknown, _a: unknown, _l: unknown, chainId: string) => {
						const row = { id: `row-${rows.size + 1}`, profileId: "p1", trustedVerification: false }
						rows.set(`${ORIGIN}|${chainId}`, row)
						return row
					},
					setCapabilityGrants: async () => undefined,
					deleteDappSession: async () => undefined,
					setVerificationHash: async () => undefined,
				},
				"operation-journal": {},
				token: { getTokens: async () => [] },
			})[name],
	} as never
	initWalletSdkHandler(services, noopLogger, ports)
	const discover = (requestId: string, over: Record<string, unknown> = {}) =>
		captured?.onPendingDiscovery({
			requestId,
			origin: ORIGIN,
			appId: "app",
			appName: "App",
			chainInfo: { chainId: "1", version: "1" },
			timestamp: Date.now(),
			tabId: 7,
			...over,
		})
	/** The SDK finished key exchange for an approved request: establish it (opens the verify window if due). */
	const establish = async (requestId: string, over: Record<string, unknown> = {}) => {
		live.add(requestId)
		await captured?.onSessionEstablished({
			origin: ORIGIN,
			sessionId: requestId,
			verificationHash: "HASH",
			chainInfo: { chainId: "1", version: "1" },
			...over,
		})
	}
	const closeWindow = (id: number) => {
		for (const l of onRemoved) l(id)
	}
	return { discover, establish, closeWindow, windowsCreated: () => created }
}

/** Settle the handler's pending microtasks without moving the clock. */
const flush = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve()
}
const approved = () => handlerCalls.filter((c) => c.startsWith("approve:")).map((c) => c.slice(8))
const rejected = () => handlerCalls.filter((c) => c.startsWith("reject:")).map((c) => c.slice(7))

beforeEach(() => {
	vi.useFakeTimers()
	handlerCalls.length = 0
	live.clear()
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
afterEach(() => vi.useRealTimers())

describe("handleDiscovery — remembered origin, trusted (token budget only)", () => {
	test("12 back-to-back handshakes: 3 now, then one per refill until the deadline, 5 rejected outright", async () => {
		const { discover } = boot({ remembered: { trusted: true } })
		for (let i = 1; i <= 12; i++) discover(`r${i}`)
		await flush()
		expect(approved()).toEqual(["r1", "r2", "r3"])
		expect(rejected()).toEqual(["r8", "r9", "r10", "r11", "r12"])

		await vi.advanceTimersByTimeAsync(RECONNECT_REFILL_MS)
		expect(approved()).toEqual(["r1", "r2", "r3", "r4"])
		await vi.advanceTimersByTimeAsync(RECONNECT_REFILL_MS)
		expect(approved()).toEqual(["r1", "r2", "r3", "r4", "r5"])
		// The third refill lands past the 55 s discovery deadline: the rest are rejected, not approved.
		await vi.advanceTimersByTimeAsync(RECONNECT_REFILL_MS)
		expect(approved()).toEqual(["r1", "r2", "r3", "r4", "r5"])
		expect(rejected()).toEqual(expect.arrayContaining(["r6", "r7"]))
		expect(handlerCalls).toHaveLength(12)
	})
})

describe("handleDiscovery — remembered origin, untrusted (token + verify-window budget)", () => {
	test("2 approved, 4 queued, 6 rejected; a refill admits nothing while both windows stay open", async () => {
		const { discover, establish } = boot({ remembered: { trusted: false } })
		for (let i = 1; i <= 12; i++) discover(`r${i}`)
		await flush()
		expect(approved()).toEqual(["r1", "r2"])
		expect(rejected()).toEqual(["r7", "r8", "r9", "r10", "r11", "r12"])
		await establish("r1")
		await establish("r2")
		await vi.advanceTimersByTimeAsync(RECONNECT_REFILL_MS)
		expect(approved()).toEqual(["r1", "r2"])
	})

	test("closing both windows serves the 3rd at once; the 4th waits for the token refill", async () => {
		const { discover, establish, closeWindow } = boot({ remembered: { trusted: false } })
		for (let i = 1; i <= 4; i++) discover(`r${i}`)
		await flush()
		await establish("r1")
		await establish("r2")
		await vi.advanceTimersByTimeAsync(5_000)
		closeWindow(1)
		closeWindow(2)
		await flush()
		expect(approved()).toEqual(["r1", "r2", "r3"])
		await vi.advanceTimersByTimeAsync(RECONNECT_REFILL_MS - 5_000 - 1)
		expect(approved()).toEqual(["r1", "r2", "r3"])
		await vi.advanceTimersByTimeAsync(2)
		expect(approved()).toEqual(["r1", "r2", "r3", "r4"])
	})

	test("a terminated transport keeps its open window's slot: the reconnect waits until the window closes", async () => {
		const { discover, establish, closeWindow } = boot({ remembered: { trusted: false } })
		discover("r1")
		discover("r2")
		await flush()
		await establish("r1")
		await establish("r2")
		captured?.onSessionTerminated("r1")
		discover("r3")
		await flush()
		expect(approved()).toEqual(["r1", "r2"])
		closeWindow(1)
		await flush()
		expect(approved()).toEqual(["r1", "r2", "r3"])
	})
})

describe("handleDiscovery — fresh connection and dedupe waiters", () => {
	const chain = (n: number) => ({ chainInfo: { chainId: String(n), version: "0" } })

	test("the fresh branch reserves after its popup, keeps its duplicate pending through creation, and a waiter with occupied capacity queues", async () => {
		const popups = new Map<number, ReturnType<typeof deferred<{ approved: boolean }>>>()
		let opened = 0
		const { discover, establish, closeWindow } = boot({
			popup: () => {
				const d = deferred<{ approved: boolean }>()
				popups.set(++opened, d)
				return d.promise
			},
		})
		discover("f1", chain(1))
		discover("f2", chain(2))
		await flush()
		popups.get(1)!.resolve({ approved: true })
		popups.get(2)!.resolve({ approved: true })
		await flush()
		expect(approved()).toEqual(["f1", "f2"])
		await establish("f1", chain(1))
		await establish("f2", chain(2))

		// A third fresh handshake and its duplicate: the popup approves, but both window slots are held.
		discover("f3", chain(3))
		await flush()
		discover("f3dup", chain(3))
		await flush()
		popups.get(3)!.resolve({ approved: true })
		await flush()
		expect(approved()).toEqual(["f1", "f2"])
		expect(rejected()).toEqual([])
		closeWindow(1)
		await flush()
		// f3 got the slot and its session; its duplicate now waits for the next slot.
		expect(approved()).toEqual(["f1", "f2", "f3"])
		expect(rejected()).toEqual([])
		await establish("f3", chain(3))
		closeWindow(2)
		await flush()
		expect(approved()).toEqual(["f1", "f2", "f3", "f3dup"])
	})

	test("a rolled-back approval releases the reservation", async () => {
		const popup = deferred<{ approved: boolean }>()
		const { discover, windowsCreated } = boot({ popup: () => popup.promise })
		discover("f1", { timestamp: Date.now() - DISCOVERY_STALE_MS + 1_000 })
		await flush()
		await vi.advanceTimersByTimeAsync(2_000)
		popup.resolve({ approved: true })
		await flush()
		expect(rejected()).toEqual(["f1"])
		expect(windowsCreated()).toBe(0)
		// The slot came back: two more window-needing handshakes are admitted at once.
		discover("f2", chain(5))
		discover("f3", chain(6))
		await flush()
		expect(approved()).toEqual(["f2", "f3"])
	})

	test("the 9th handshake waiting on one popup is rejected; the first 8 all settle with the popup", async () => {
		const popup = deferred<{ approved: boolean }>()
		const { discover } = boot({ popup: () => popup.promise })
		for (let i = 0; i <= 9; i++) discover(`d${i}`)
		await flush()
		expect(rejected()).toEqual(["d9"])
		expect(handlerCalls).toHaveLength(1)
		popup.resolve({ approved: true })
		await flush()
		await vi.advanceTimersByTimeAsync(DISCOVERY_STALE_MS + 20_000)
		const settled = new Set(handlerCalls.map((c) => c.split(":")[1]))
		for (let i = 0; i <= 9; i++) expect(settled.has(`d${i}`)).toBe(true)
	})
})
