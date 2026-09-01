/**
 * Pre-extraction pins (codex condition, round-2 plan 5) for `initWalletSdkHandler`
 * and its discovery handler, driven through a mocked SDK `BackgroundConnectionHandler`
 * that captures the wired callbacks:
 *   - every listener/subscription installs ONCE, in the frozen order, with
 *     `handler.initialize()` exactly once and LAST (after the tab-lifecycle wiring);
 *   - a denied discovery rejects AND releases its `(origin, chainId)` dedupe slot
 *     (a later discovery for the same key runs its own popup instead of waiting);
 *   - an approval that lands past the dApp's freshness cutoff is rejected BEFORE
 *     the durable session write, and the slot is still released.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { EventHandler } from "@nulo/wallet-core/utils"

const log: string[] = []
type Callbacks = { onPendingDiscovery: (d: unknown) => void }
let captured: Callbacks | undefined
const handlerCalls: string[] = []

vi.mock("@aztec/wallet-sdk/extension/handlers", () => ({
	BackgroundConnectionHandler: class {
		constructor(_meta: unknown, _transport: unknown, callbacks: Callbacks) {
			captured = callbacks
			log.push("handler:new")
		}
		handleEncryptedMessage() {
			return Promise.resolve()
		}
		getActiveSessions() {
			return []
		}
		approveDiscovery(id: string) {
			handlerCalls.push(`approve:${id}`)
		}
		rejectDiscovery(id: string) {
			handlerCalls.push(`reject:${id}`)
		}
		terminateSession() {}
		terminateForTab() {}
		initialize() {
			log.push("handler:initialize")
		}
	},
}))
vi.mock("./content-message-relay", () => ({
	attachContentListener: () => {
		log.push("relay:attach")
	},
}))
vi.mock("./tab-lifecycle", () => ({
	wireTabLifecycle: () => {
		log.push("tabs:wire")
	},
}))
vi.mock("@nulo/wallet-sdk-schema-patch/register", () => ({}))

import { initWalletSdkHandler } from "./background"

function makeServices(discoverImpl: () => Promise<{ approved: boolean }>) {
	const onActiveProfileChanged = new EventHandler<unknown>()
	const onDappSessionDeleted = new EventHandler<unknown>()
	const origAdd = onActiveProfileChanged.add.bind(onActiveProfileChanged)
	onActiveProfileChanged.add = ((fn: never) => {
		log.push("profile:add")
		return origAdd(fn)
	}) as never
	const origDelAdd = onDappSessionDeleted.add.bind(onDappSessionDeleted)
	onDappSessionDeleted.add = ((fn: never) => {
		log.push("sessionDeleted:add")
		return origDelAdd(fn)
	}) as never
	const sessions = new Map<string, { id: string; profileId: string }>()
	const stubs: Record<string, unknown> = {
		network: {},
		account: {},
		execution: {},
		profile: { onActiveProfileChanged, getActiveProfile: async () => ({ id: "p1" }) },
		"dapp-interaction": {
			discover: async () => {
				log.push("discover")
				return discoverImpl()
			},
		},
		"dapp-session": {
			onDappSessionDeleted,
			tryGetDappSessionByOriginAndChain: async () => undefined,
			addDappSession: async () => {
				const s = { id: `s${sessions.size + 1}`, profileId: "p1" }
				sessions.set(s.id, s)
				log.push("session:add")
				return s
			},
			setCapabilityGrants: async () => undefined,
			deleteDappSession: async (id: string) => {
				sessions.delete(id)
				log.push("session:delete")
			},
		},
		"operation-journal": {},
		token: { getTokens: async () => [] },
	}
	const services = { get: (name: string) => stubs[name] } as never
	return { services, sessions }
}

const noopLogger = { log: () => {} } as never

beforeEach(() => {
	log.length = 0
	handlerCalls.length = 0
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

describe("initWalletSdkHandler install order", () => {
	test("handler → decrypt patch → session-deleted → profile subscriptions → tab lifecycle → initialize (once, last)", () => {
		const { services } = makeServices(async () => ({ approved: true }))
		initWalletSdkHandler(services, noopLogger)
		expect(log.indexOf("handler:new")).toBe(0)
		expect(log.filter((l) => l === "handler:initialize")).toHaveLength(1)
		expect(log.at(-1)).toBe("handler:initialize")
		expect(log.indexOf("tabs:wire")).toBe(log.length - 2)
		expect(log.indexOf("sessionDeleted:add")).toBeLessThan(log.indexOf("profile:add"))
		// Three profile subscriptions: switch-epoch tracker, teardown, the drain.
		expect(log.filter((l) => l === "profile:add")).toHaveLength(3)
		expect(captured).toBeDefined()
	})
})

describe("handleDiscovery cleanup", () => {
	const discovery = (requestId: string, timestampOffsetMs = 0) => ({
		requestId,
		origin: "https://dapp.example",
		appId: "app",
		appName: "App",
		chainInfo: { chainId: "1", version: "1" },
		timestamp: Date.now() + timestampOffsetMs,
	})

	test("a denied popup rejects the request AND releases the dedupe slot", async () => {
		const { services } = makeServices(async () => ({ approved: false }))
		initWalletSdkHandler(services, noopLogger)
		captured?.onPendingDiscovery(discovery("r1"))
		await vi.waitFor(() => expect(handlerCalls).toContain("reject:r1"))
		// Same (origin, chainId) again: the slot was released, so a NEW popup runs
		// instead of awaiting the finished one.
		captured?.onPendingDiscovery(discovery("r2"))
		await vi.waitFor(() => expect(handlerCalls).toContain("reject:r2"))
		expect(log.filter((l) => l === "discover")).toHaveLength(2)
	})

	test("an approval past the freshness cutoff is rejected before the session write, slot still released", async () => {
		const { services, sessions } = makeServices(async () => ({ approved: true }))
		initWalletSdkHandler(services, noopLogger)
		// A discovery already older than Nulo's cutoff when the popup resolves.
		captured?.onPendingDiscovery(discovery("r3", -10 * 60_000))
		await vi.waitFor(() => expect(handlerCalls).toContain("reject:r3"))
		expect(log).not.toContain("session:add")
		expect(sessions.size).toBe(0)
		captured?.onPendingDiscovery(discovery("r4", -10 * 60_000))
		await vi.waitFor(() => expect(handlerCalls).toContain("reject:r4"))
		expect(log.filter((l) => l === "discover")).toHaveLength(2)
	})
})
