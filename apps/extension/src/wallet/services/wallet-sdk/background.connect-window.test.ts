/**
 * The connect window through the SDK handler's callbacks: an Allow hands its window to the
 * connection, which shows the emoji check in it, and every exit before the check closes it. Tab
 * lifecycle runs for real over a `chrome.tabs` stub that captures its listeners.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { WindowPort } from "@nulo/wallet-core/ports"
import { DISCOVERY_STALE_MS, WalletSdkDispatcher } from "@nulo/wallet-bridge"

type Callbacks = {
	onPendingDiscovery: (d: unknown) => void
	onSessionEstablished: (s: unknown) => Promise<void> | void
	onSessionTerminated: (id: string) => void
	onWalletMessage: (session: unknown, message: unknown) => void
}
let captured: Callbacks | undefined
const handlerCalls: string[] = []
const live = new Set<string>()
const discoveryTabs = new Map<string, number>()
const droppedTabs = new Set<number>()
let approveReturns = true

vi.mock("@aztec-labs/wallet-sdk/extension/handlers", () => ({
	BackgroundConnectionHandler: class {
		constructor(_meta: unknown, _transport: unknown, callbacks: Callbacks) {
			captured = callbacks
		}
		handleEncryptedMessage() {
			return Promise.resolve()
		}
		getActiveSessions() {
			return [...live].map((sessionId) => ({ sessionId, tabId: discoveryTabs.get(sessionId) }))
		}
		approveDiscovery(id: string) {
			handlerCalls.push(`approve:${id}`)
			return approveReturns && !droppedTabs.has(discoveryTabs.get(id) ?? -1)
		}
		rejectDiscovery(id: string) {
			handlerCalls.push(`reject:${id}`)
		}
		sendResponse() {
			return Promise.resolve()
		}
		terminateSession(id: string) {
			handlerCalls.push(`terminate:${id}`)
			live.delete(id)
			captured?.onSessionTerminated(id)
		}
		/** The SDK drops the tab's discoveries and ends its sessions. */
		terminateForTab(tabId: number) {
			droppedTabs.add(tabId)
			for (const id of [...live]) if (discoveryTabs.get(id) === tabId) this.terminateSession(id)
		}
		initialize() {}
	},
}))
vi.mock("./content-message-relay", () => ({ attachContentListener: () => {} }))
vi.mock("@nulo/wallet-sdk-schema-patch/register", () => ({}))
vi.mock("./discovery-approval", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./discovery-approval")>()
	return { ...actual, approveOrRollbackDiscoverySession: vi.fn(actual.approveOrRollbackDiscoverySession) }
})

import { initWalletSdkHandler } from "./background"
import { approveOrRollbackDiscoverySession } from "./discovery-approval"
import type { PendingVerificationEntry } from "./pending-verification"
import { RESERVATION_GRACE_MS, VerifyAdmissionGate } from "./verify-admission"
import { fakeSdkPorts } from "./test-ports"
import { FAKE_DAPP_ORIGIN as ORIGIN, FAKE_SENDER, fakeSdkServices } from "./test-services"

const OTHER_ORIGIN = "https://other.example"
const noopLogger = { log: () => {} } as never
const tabRemoved: Array<(tabId: number) => void> = []
const admit = vi.spyOn(VerifyAdmissionGate.prototype, "admit")
const dispatch = vi.spyOn(WalletSdkDispatcher.prototype, "dispatch")

function deferred<T>() {
	let resolve!: (v: T) => void
	let reject!: (e: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

/** A browser that knows which windows are open: `remove` or `navigate` of a gone window rejects,
 *  and every removal reaches the listeners a turn later, as `chrome.windows.onRemoved` does. */
function fakeWindows() {
	const open = new Set<number>()
	const removed: number[] = []
	const created: Array<{ url?: string }> = []
	const navigated: Array<{ windowId: number; url: string }> = []
	const focused: number[] = []
	const listeners: Array<(id: number) => void> = []
	let nextId = 100
	/** Replaces the next navigation's outcome, once. */
	let nextNavigation: Promise<void> | undefined
	const fire = (id: number) => {
		void Promise.resolve().then(() => {
			for (const l of listeners) l(id)
		})
	}
	const port: WindowPort = {
		create: async (options) => {
			created.push(options)
			const id = nextId++
			open.add(id)
			return { id }
		},
		onRemoved: (listener) => {
			listeners.push(listener)
			return () => {}
		},
		remove: async (id) => {
			removed.push(id)
			if (!open.delete(id)) throw new Error(`No window with id: ${id}.`)
			fire(id)
		},
		update: async (id, options) => {
			if (options.focused) focused.push(id)
		},
		navigate: async (windowId, url) => {
			navigated.push({ windowId, url })
			const outcome = nextNavigation
			nextNavigation = undefined
			if (outcome) return outcome
			if (!open.has(windowId)) throw new Error(`No window with id: ${windowId}.`)
		},
		getLastFocused: async () => undefined,
	}
	const closeByUser = (id: number) => {
		if (open.delete(id)) fire(id)
	}
	const holdNextNavigation = (outcome: Promise<void>) => {
		nextNavigation = outcome
	}
	return { port, open, removed, created, navigated, focused, closeByUser, holdNextNavigation }
}

const chain = (n: number) => ({ chainInfo: { chainId: String(n), version: "0" } })

function boot(opts: { setCapabilityGrants?: () => Promise<unknown> } = {}) {
	const windows = fakeWindows()
	const popups = new Map<string, (answer: { approved: boolean; windowId?: number }) => void>()
	const journal = { countOperations: vi.fn(async () => 0), createOperation: vi.fn(async () => ({ id: "queued-1" })) }
	let activeProfile: { id: string } | undefined = { id: "p1" }
	const { services, rows } = fakeSdkServices({
		popup: (_params, requestId) => new Promise((resolve) => popups.set(requestId, resolve)),
		activeProfile: async () => activeProfile,
		setCapabilityGrants: opts.setCapabilityGrants,
		operationJournal: journal,
	})
	initWalletSdkHandler(services, noopLogger, fakeSdkPorts(windows.port))
	const discover = (requestId: string, over: Record<string, unknown> = {}) => {
		const discovery = { requestId, origin: ORIGIN, appId: "app", appName: "App", ...chain(1), timestamp: Date.now(), tabId: 7, ...over }
		discoveryTabs.set(requestId, discovery.tabId)
		captured?.onPendingDiscovery(discovery)
	}
	/** The person clicks Allow in `requestId`'s connect window, which the browser knows as `windowId`. */
	const allow = (requestId: string, windowId: number) => {
		windows.open.add(windowId)
		popups.get(requestId)?.({ approved: true, windowId })
	}
	/** The SDK finished key exchange for `requestId`; its hash is `HASH-<requestId>` unless given. */
	const establish = async (requestId: string, over: Record<string, unknown> = {}) => {
		live.add(requestId)
		await captured?.onSessionEstablished({
			origin: ORIGIN,
			sessionId: requestId,
			verificationHash: `HASH-${requestId}`,
			...chain(1),
			...over,
		})
	}
	const closeTab = (tabId: number) => {
		for (const l of tabRemoved) l(tabId)
	}
	const setProfile = (profile: { id: string } | undefined) => {
		activeProfile = profile
	}
	return { discover, allow, establish, closeTab, setProfile, windows, rows, journal }
}

/** Settle the handler's pending microtasks without moving the clock. */
const flush = async () => {
	for (let i = 0; i < 50; i++) await Promise.resolve()
}
const approved = () => handlerCalls.filter((c) => c.startsWith("approve:")).map((c) => c.slice(8))
const rejected = () => handlerCalls.filter((c) => c.startsWith("reject:")).map((c) => c.slice(7))
const terminated = () => handlerCalls.filter((c) => c.startsWith("terminate:")).map((c) => c.slice(10))
/** The worker's admission gate, as the handler admitted through it. */
const gate = () => admit.mock.contexts.at(-1) as VerifyAdmissionGate
/** The worker's pending-verification markers, as the approval wrote them. */
const markers = () =>
	vi.mocked(approveOrRollbackDiscoverySession).mock.calls.at(-1)?.[0].pendingVerification as Map<string, PendingVerificationEntry>

beforeEach(() => {
	vi.useFakeTimers()
	handlerCalls.length = 0
	live.clear()
	discoveryTabs.clear()
	droppedTabs.clear()
	tabRemoved.length = 0
	approveReturns = true
	captured = undefined
	admit.mockClear()
	dispatch.mockClear()
	vi.mocked(approveOrRollbackDiscoverySession).mockClear()
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub
	;(globalThis as any).chrome = {
		runtime: { getURL: (p: string) => p },
		tabs: {
			sendMessage: () => {},
			onRemoved: { addListener: (fn: (tabId: number) => void) => tabRemoved.push(fn) },
			onUpdated: { addListener: () => {} },
		},
		action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
	}
	// biome-ignore lint/suspicious/noExplicitAny: vite define-injected global
	;(globalThis as any).__VERSION__ = "test"
})
afterEach(() => vi.useRealTimers())

describe("the connect window after Allow", () => {
	test("an approved connection keeps its connect window as the check's standby window and creates none", async () => {
		const h = boot()
		h.discover("f1")
		await flush()
		h.allow("f1", 41)
		await flush()

		expect(approved()).toEqual(["f1"])
		expect(gate().reservation("f1")?.status).toBe("standby")
		expect(gate().reservation("f1")?.windowId).toBe(41)
		expect(markers().get("f1")?.tabId).toBe(7)
		expect(h.windows.created).toEqual([])
		expect(h.windows.removed).toEqual([])
	})

	test("an Allow past the discovery cutoff is rejected and its window closed", async () => {
		const h = boot()
		h.discover("f1", { timestamp: Date.now() - DISCOVERY_STALE_MS + 1_000 })
		await flush()
		await vi.advanceTimersByTimeAsync(2_000)
		h.allow("f1", 41)
		await flush()

		expect(rejected()).toEqual(["f1"])
		expect(approved()).toEqual([])
		expect(h.windows.removed).toEqual([41])
	})

	test("an Allow that meets another active profile is rejected and its window closed", async () => {
		const h = boot()
		h.discover("f1")
		await flush()
		h.setProfile({ id: "p2" })
		h.allow("f1", 41)
		await flush()

		expect(rejected()).toEqual(["f1"])
		expect(approved()).toEqual([])
		expect(h.windows.removed).toEqual([41])
		expect(gate().windowsHeld(ORIGIN)).toBe(0)
	})

	test("an approval that does not land closes the window and leaves no marker", async () => {
		const h = boot()
		approveReturns = false
		h.discover("f1")
		await flush()
		h.allow("f1", 41)
		await flush()

		expect(h.windows.removed).toEqual([41])
		expect(markers().has("f1")).toBe(false)
		expect(gate().windowsHeld(ORIGIN)).toBe(0)
	})

	test("a window closed while the approval's writes run: rejected, the row deleted, no marker set", async () => {
		const grants = deferred<undefined>()
		const h = boot({ setCapabilityGrants: () => grants.promise })
		h.discover("f1")
		await flush()
		h.allow("f1", 41)
		await flush()
		expect(h.rows.size).toBe(1)

		h.windows.closeByUser(41)
		await flush()
		grants.resolve(undefined)
		await flush()

		expect(rejected()).toEqual(["f1"])
		expect(approved()).toEqual([])
		expect(h.rows.size).toBe(0)
		expect(markers().has("f1")).toBe(false)
		expect(h.windows.removed).toEqual([])
	})

	test("the dApp's tab closing after the approval closes the window and deletes the marker", async () => {
		const h = boot()
		h.discover("f1")
		await flush()
		h.allow("f1", 41)
		await flush()
		expect(markers().has("f1")).toBe(true)

		h.closeTab(7)
		await flush()

		expect(h.windows.removed).toEqual([41])
		expect(markers().has("f1")).toBe(false)
		expect(gate().windowsHeld(ORIGIN)).toBe(0)
	})
})

describe("an Allow while the origin's two verification slots are held", () => {
	/** Two approved connections on standby windows 41 and 42, then a third Allow in window 43. */
	async function thirdAllowQueued(third: Record<string, unknown> = {}) {
		const h = boot()
		h.discover("f1", chain(1))
		h.discover("f2", chain(2))
		await flush()
		h.allow("f1", 41)
		h.allow("f2", 42)
		await flush()
		expect(approved()).toEqual(["f1", "f2"])
		h.discover("f3", { ...chain(3), ...third })
		await flush()
		h.allow("f3", 43)
		await flush()
		return h
	}

	test("keeps its window open while queued, and attaches it when a slot frees", async () => {
		const h = await thirdAllowQueued()
		expect(approved()).toEqual(["f1", "f2"])
		expect(gate().queued(ORIGIN)).toBe(1)
		expect(h.windows.removed).toEqual([])

		h.windows.closeByUser(41)
		await flush()

		expect(approved()).toEqual(["f1", "f2", "f3"])
		expect(gate().reservation("f3")?.status).toBe("standby")
		expect(h.windows.removed).toEqual([])
	})

	test("is rejected and its window closed when its discovery expires in the queue", async () => {
		const h = await thirdAllowQueued()
		await vi.advanceTimersByTimeAsync(DISCOVERY_STALE_MS + 1)

		expect(rejected()).toEqual(["f3"])
		expect(approved()).toEqual(["f1", "f2"])
		expect(h.windows.removed).toEqual([43])
	})

	test("whose window is closed while queued fails its attach when a slot frees, and is rejected", async () => {
		const h = await thirdAllowQueued()
		h.windows.closeByUser(43)
		await flush()
		h.windows.closeByUser(41)
		await flush()

		expect(rejected()).toEqual(["f3"])
		expect(approved()).toEqual(["f1", "f2"])
		expect(gate().windowsHeld(ORIGIN)).toBe(1)
	})

	test("whose dApp tab closes while it is queued has its window closed at once", async () => {
		const h = await thirdAllowQueued({ tabId: 9 })
		h.closeTab(9)
		await flush()
		expect(h.windows.removed).toEqual([43])

		h.windows.closeByUser(41)
		await flush()
		expect(rejected()).toEqual(["f3"])
		expect(approved()).toEqual(["f1", "f2"])
	})
})

describe("establishment shows the check in the connect window", () => {
	/** One approved connection for `requestId` waiting in `windowId`. */
	async function approvedIn(h: ReturnType<typeof boot>, requestId: string, windowId: number, over: Record<string, unknown> = {}) {
		h.discover(requestId, over)
		await flush()
		h.allow(requestId, windowId)
		await flush()
	}

	test("the approved connection navigates window 41 to its own hash and creates no window", async () => {
		const h = boot()
		await approvedIn(h, "f1", 41)
		await h.establish("f1")

		expect(h.windows.navigated).toHaveLength(1)
		expect(h.windows.navigated[0].windowId).toBe(41)
		expect(h.windows.navigated[0].url).toContain("verificationHash=HASH-f1&isReconnect=false")
		expect(h.windows.focused).toEqual([41])
		expect(h.windows.created).toEqual([])
		expect(terminated()).toEqual([])
		expect(markers().has("f1")).toBe(false)
	})

	test("two origins connecting at once, established in reverse order, each get their own grid in their own window", async () => {
		const h = boot()
		await approvedIn(h, "a1", 41)
		await approvedIn(h, "b1", 42, { origin: OTHER_ORIGIN, tabId: 8 })
		await h.establish("b1", { origin: OTHER_ORIGIN })
		await h.establish("a1")

		expect(h.windows.navigated.map((n) => n.windowId)).toEqual([42, 41])
		expect(h.windows.navigated[0].url).toContain("verificationHash=HASH-b1")
		expect(h.windows.navigated[1].url).toContain("verificationHash=HASH-a1")
		expect(h.windows.created).toEqual([])
		expect(terminated()).toEqual([])
	})

	test("the twin of a pending popup opens its own window with its own hash while 41 shows the first's", async () => {
		const h = boot()
		h.discover("f1")
		await flush()
		h.discover("twin")
		await flush()
		h.allow("f1", 41)
		await flush()
		expect(approved()).toEqual(["f1", "twin"])

		await h.establish("f1")
		await h.establish("twin")

		expect(h.windows.navigated).toHaveLength(1)
		expect(h.windows.navigated[0].url).toContain("verificationHash=HASH-f1")
		expect(h.windows.created).toHaveLength(1)
		expect(h.windows.created[0].url).toContain("verificationHash=HASH-twin&isReconnect=true")
		expect(terminated()).toEqual([])
	})

	test("the window closed after the approval terminates the session on establishment and keeps the row", async () => {
		const h = boot()
		await approvedIn(h, "f1", 41)
		h.windows.closeByUser(41)
		await flush()
		await h.establish("f1")

		expect(terminated()).toEqual(["f1"])
		expect(h.windows.navigated).toEqual([])
		expect(h.windows.created).toEqual([])
		expect(h.rows.size).toBe(1)
	})

	/** A sendTx from `f1`, whose row could journal and dispatch it, arrives while its check loads in 41. */
	async function sendTxWhileNavigating(h: ReturnType<typeof boot>, settle: (navigation: ReturnType<typeof deferred<void>>) => void) {
		await approvedIn(h, "f1", 41)
		Object.assign([...h.rows.values()][0], {
			accounts: [`aztec:1:${FAKE_SENDER}`],
			capabilityGrants: [{ capability: { type: "transaction" } }],
		})
		const navigation = deferred<void>()
		h.windows.holdNextNavigation(navigation.promise)
		const establishing = h.establish("f1")
		await vi.waitFor(() => expect(h.windows.navigated).toHaveLength(1))

		captured?.onWalletMessage({ sessionId: "f1", origin: ORIGIN, tabId: 7, ...chain(1) }, { type: "sendTx", args: [], messageId: "m1" })
		settle(navigation)
		await establishing
		await flush()
	}

	test("a sendTx arriving while the check loads is journaled and dispatched once it shows", async () => {
		const h = boot()
		dispatch.mockResolvedValueOnce(undefined)
		await sendTxWhileNavigating(h, (navigation) => navigation.resolve())

		await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
		expect(dispatch.mock.calls[0][0]).toBe("sendTx")
		expect(h.journal.createOperation).toHaveBeenCalledTimes(1)
		expect(terminated()).toEqual([])
	})

	test("a sendTx arriving while the navigation fails is never dispatched and never journaled", async () => {
		const h = boot()
		await sendTxWhileNavigating(h, (navigation) => navigation.reject(new Error("No tab with id: 314.")))

		expect(terminated()).toEqual(["f1"])
		expect(dispatch).not.toHaveBeenCalled()
		expect(h.journal.createOperation).not.toHaveBeenCalled()
		expect(h.windows.removed).toEqual([41])
	})

	const abandonments: Array<[string, (h: ReturnType<typeof boot>) => Promise<void>]> = [
		[
			"its slot expired",
			async () => {
				await vi.advanceTimersByTimeAsync(DISCOVERY_STALE_MS + RESERVATION_GRACE_MS + 1)
				await flush()
			},
		],
		[
			"a lock closed its window",
			async (h) => {
				h.windows.closeByUser(41)
				await flush()
			},
		],
	]

	test.each(abandonments)("an attempt abandoned because %s never establishes, even once a sibling trusts the row", async (_, abandon) => {
		const h = boot()
		await approvedIn(h, "f1", 41)
		await abandon(h)
		expect(markers().get("f1")?.cancelled).toBe(true)
		expect(h.windows.open.has(41)).toBe(false)

		// A new discovery from the origin is a reconnect: its own window, since the row is untrusted.
		h.discover("r2")
		await flush()
		await h.establish("r2")
		expect(h.windows.created).toHaveLength(1)
		expect(h.windows.created[0].url).toContain("verificationHash=HASH-r2&isReconnect=true")

		// A sibling's check set "Always trust" on the row the abandoned attempt wrote.
		const row = [...h.rows.values()][0]
		row.trustedVerification = true
		await h.establish("f1")
		await h.establish("f1")
		expect(terminated()).toEqual(["f1", "f1"])
		expect(h.windows.navigated).toEqual([])
		expect(h.windows.created).toHaveLength(1)

		// The trusted skip is unchanged for a new request id.
		h.discover("r3")
		await flush()
		await h.establish("r3")
		expect(terminated()).toEqual(["f1", "f1"])
		expect(h.windows.created).toHaveLength(1)
	})
})
