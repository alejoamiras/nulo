/**
 * The two verify-window admissions a fresh connection makes: its own, after the popup's Allow
 * (`runDiscoveryPopup`), and a duplicate's, once that popup settles (`approveAfterPopup`). The
 * admission's answer is scripted, so each outcome's request, refusal, log line and the microtask on
 * which every later effect lands are pinned exactly: an added await anywhere on the path moves one.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { DISCOVERY_STALE_MS, describeExternalId } from "@nulo/wallet-bridge"

type Callbacks = { onPendingDiscovery: (d: unknown) => void }
let captured: Callbacks | undefined
/** Every effect after an admission, with the rung of the ladder that admission started. */
const effects: string[] = []
let rung = () => -1
const at = (effect: string) => effects.push(`${effect}@${rung()}`)

type Outcome = "rejected" | "expired" | "admitted"
let outcomes: Outcome[] = []
const admitAsync = vi.fn((_gate: unknown, _req: unknown) => {
	const outcome = outcomes.shift()
	rung = microtaskLadder()
	return Promise.resolve(outcome === "admitted" ? undefined : outcome)
})

vi.mock("./verify-admission", async (importOriginal) => ({
	...(await importOriginal<typeof import("./verify-admission")>()),
	admitAsync: (gate: unknown, req: unknown) => admitAsync(gate, req),
}))
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
		approveDiscovery(id: string) {
			at(`approve:${id}`)
			return true
		}
		rejectDiscovery(id: string) {
			at(`reject:${id}`)
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

/** Counts microtask rungs from the moment it starts. */
function microtaskLadder(): () => number {
	let n = 0
	const step = () => {
		n++
		if (n < 30) queueMicrotask(step)
	}
	queueMicrotask(step)
	return () => n
}

const flush = async () => {
	for (let i = 0; i < 40; i++) await Promise.resolve()
}

function deferred<T>() {
	let resolve!: (v: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

const logs: string[] = []
const logger = {
	log: (_scope: string, level: number, message: string) => {
		logs.push(`${level}:${message}`)
		if (message.startsWith("Discovery rejected")) at(`log:${level}`)
	},
} as never

/** Boots the handler; the connect popup answers when the test resolves it, with `windowId` if given. */
function boot(windowId?: number) {
	const popup = deferred<void>()
	const { services, rows } = fakeSdkServices({
		popup: async () => {
			await popup.promise
			return { approved: true, ...(windowId === undefined ? {} : { windowId }) }
		},
		served: () => {
			at("servesChain")
			return true
		},
	})
	const lookup = services as unknown as { get: (n: string) => Record<string, unknown> }
	const sessions = lookup.get("dapp-session") as { tryGetDappSessionByOriginAndChain: (o: string, c: string) => Promise<unknown> }
	const realLookup = sessions.tryGetDappSessionByOriginAndChain
	const ports = fakeSdkPorts({
		remove: async (id: number) => {
			at(`closeWindow:${id}`)
		},
	})
	const servicesWithLookup = {
		get: (name: string) => {
			const service = lookup.get(name)
			if (name !== "dapp-session") return service
			return {
				...service,
				tryGetDappSessionByOriginAndChain: (origin: string, chainId: string) => {
					at("duplicate:lookup")
					return realLookup(origin, chainId)
				},
			}
		},
	} as never
	initWalletSdkHandler(servicesWithLookup, logger, ports)
	const discover = (requestId: string) =>
		captured?.onPendingDiscovery({
			requestId,
			origin: ORIGIN,
			appId: "app",
			appName: "App",
			chainInfo: { chainId: "1", version: "1" },
			timestamp: Date.now(),
			tabId: 7,
		})
	return { discover, allow: () => popup.resolve(), rows }
}

/** A fresh handshake plus a duplicate parked on its popup, then the Allow. */
async function freshWithDuplicate(windowId?: number) {
	const env = boot(windowId)
	env.discover("fresh")
	await flush()
	env.discover("dup")
	await flush()
	effects.length = 0
	env.allow()
	await flush()
	return env
}

const request = (id: string) => ({
	id,
	origin: ORIGIN,
	deadline: Date.now() + DISCOVERY_STALE_MS,
	needsWindow: true,
	consumesToken: false,
})

beforeEach(() => {
	vi.useFakeTimers()
	effects.length = 0
	logs.length = 0
	outcomes = []
	rung = () => -1
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
afterEach(() => {
	vi.useRealTimers()
	vi.clearAllMocks()
})

describe("the fresh connection's own admission (runDiscoveryPopup)", () => {
	test.each([
		["rejected", "verify-window queue full"],
		["expired", "expired while queued"],
	] as const)("%s: refused and logged, the connect window closed, the duplicate released, nothing written", async (outcome, why) => {
		outcomes = [outcome]
		const { rows } = await freshWithDuplicate(5)
		expect(admitAsync).toHaveBeenCalledTimes(1)
		expect(admitAsync.mock.calls[0][1]).toEqual(request("fresh"))
		expect(logs.filter((l) => l.startsWith("2:"))).toEqual([`2:Discovery rejected (${why}): request ${describeExternalId("fresh")}`])
		expect(effects).toEqual(["reject:fresh@1", "log:2@1", "closeWindow:5@1", "duplicate:lookup@2", "reject:dup@3", "log:1@3"])
		expect(rows.size).toBe(0)
	})

	test("admitted: the session write starts on the admission's next tick", async () => {
		outcomes = ["admitted", "admitted"]
		await freshWithDuplicate()
		expect(admitAsync.mock.calls[0][1]).toEqual(request("fresh"))
		expect(effects[0]).toBe("servesChain@1")
		expect(effects.filter((e) => e.startsWith("approve:fresh"))).toHaveLength(1)
	})
})

describe("a duplicate's admission once its popup settles (approveAfterPopup)", () => {
	test.each([
		["rejected", "verify-window queue full"],
		["expired", "expired while queued"],
	] as const)("%s: the duplicate alone is refused and logged; its twin stays approved", async (outcome, why) => {
		outcomes = ["admitted", outcome]
		await freshWithDuplicate()
		expect(admitAsync).toHaveBeenCalledTimes(2)
		expect(admitAsync.mock.calls[1][1]).toEqual(request("dup"))
		expect(logs.filter((l) => l.startsWith("2:"))).toEqual([`2:Discovery rejected (${why}): request ${describeExternalId("dup")}`])
		expect(effects.filter((e) => e.startsWith("approve:"))).toEqual([expect.stringMatching(/^approve:fresh@/)])
		const afterLookup = effects.slice(effects.findIndex((e) => e.startsWith("duplicate:lookup")) + 1)
		expect(afterLookup).toEqual(["reject:dup@1", "log:2@1"])
	})

	test("admitted: the duplicate is approved on the admission's next tick", async () => {
		outcomes = ["admitted", "admitted"]
		await freshWithDuplicate()
		expect(admitAsync.mock.calls[1][1]).toEqual(request("dup"))
		expect(effects.at(-1)).toBe("approve:dup@1")
	})
})
