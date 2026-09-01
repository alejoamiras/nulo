/**
 * Helper-seam pin for the discovery handler's dedupe window (codex condition):
 * from the moment the "existing session" lookup resolves to the popup-promise
 * registration there must be NO yield. Otherwise a same-key discovery B whose
 * lookup resolves right before popup A is denied resumes AFTER A's `finally`
 * has released the slot, misses the dedupe map, and opens a second popup.
 *
 * The scenario resolves B's lookup and A's denial back-to-back (no await in
 * between) and asserts ONE popup ran and both requests were rejected.
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
		initialize() {}
	},
}))
vi.mock("./content-message-relay", () => ({ attachContentListener: () => {} }))
vi.mock("./tab-lifecycle", () => ({ wireTabLifecycle: () => {} }))
vi.mock("@nulo/wallet-sdk-schema-patch/register", () => ({}))

import { initWalletSdkHandler } from "./background"

function deferred<T>() {
	let resolve!: (v: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

function makeServices(popup: Promise<{ approved: boolean }>, timedLookup: Promise<undefined>) {
	let lookups = 0
	const timedLookupRequested = deferred<void>()
	const stubs: Record<string, unknown> = {
		network: {},
		account: {},
		execution: {},
		profile: { onActiveProfileChanged: new EventHandler<unknown>(), getActiveProfile: async () => ({ id: "p1" }) },
		"dapp-interaction": {
			discover: () => {
				log.push("discover")
				return popup
			},
		},
		"dapp-session": {
			onDappSessionDeleted: new EventHandler<unknown>(),
			// The SECOND lookup is the one the test times (discovery B's up-front one);
			// every other lookup (A's, B's post-popup re-check) resolves at once.
			tryGetDappSessionByOriginAndChain: () => {
				if (++lookups !== 2) return Promise.resolve(undefined)
				timedLookupRequested.resolve()
				return timedLookup
			},
			addDappSession: async () => {
				log.push("session:add")
				return { id: "s1", profileId: "p1" }
			},
			setCapabilityGrants: async () => undefined,
			deleteDappSession: async () => undefined,
		},
		"operation-journal": {},
		token: { getTokens: async () => [] },
	}
	return { services: { get: (name: string) => stubs[name] } as never, timedLookupRequested: timedLookupRequested.promise }
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

describe("handleDiscovery dedupe window", () => {
	const discovery = (requestId: string) => ({
		requestId,
		origin: "https://dapp.example",
		appId: "app",
		appName: "App",
		chainInfo: { chainId: "1", version: "1" },
		timestamp: Date.now(),
	})

	test("B's lookup resolving right before A's denial still dedupes: one popup, both rejected", async () => {
		const popupA = deferred<{ approved: boolean }>()
		const lookupB = deferred<undefined>()
		const { services, timedLookupRequested } = makeServices(popupA.promise, lookupB.promise)
		initWalletSdkHandler(services, noopLogger)

		captured?.onPendingDiscovery(discovery("a"))
		await vi.waitFor(() => expect(log).toContain("discover"))
		// B enters while A's popup is pending; park it on its (controlled) lookup.
		captured?.onPendingDiscovery(discovery("b"))
		await timedLookupRequested

		// Back-to-back, no yield between them: B's lookup settles, then A is denied.
		lookupB.resolve(undefined)
		popupA.resolve({ approved: false })

		await vi.waitFor(() => expect(handlerCalls).toContain("reject:b"))
		expect(handlerCalls).toContain("reject:a")
		expect(log.filter((l) => l === "discover")).toHaveLength(1)
		expect(log).not.toContain("session:add")
	})
})
