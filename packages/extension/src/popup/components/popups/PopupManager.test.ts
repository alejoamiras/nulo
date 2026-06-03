/**
 * Tests for the multi-contract pending-prompts queue in PopupManager.
 *
 * The IncomingTransferService can emit-storm a batch of Pending events
 * (e.g. via replayPendingPrompts on reconnect for N pending contracts),
 * but the popup can only show one at a time. PopupManager owns the
 * queue that serializes them.
 *
 * Coverage:
 *   - dedupe by (profileId, networkId, contract) triple: duplicate event
 *     for the same triple is dropped while still queued.
 *   - same contract on DIFFERENT networks → both surface (codex M3 +
 *     opus C3: bare-contract dedup was the original bug).
 *   - close → opens the next queued payload, in arrival order.
 *   - queue empty on close → popup stays closed.
 *   - dedupe also covers the currently-open popup (codex final-review L):
 *     a replay-while-open for the same triple does NOT enqueue a dup.
 */

import { flushPromises, mount } from "@vue/test-utils"
import { reactive } from "vue"
import { beforeEach, describe, expect, test, vi } from "vitest"

// ── Reactive store stand-ins ────────────────────────────────────────────
//
// Real Pinia would also work but adds setup mass. The watcher inside
// PopupManager watches `popupStore.isOpened("incoming_trust")`, which is
// reactive via reading `target in popupsState` on each tracker tick — so
// a reactive() proxy here is enough to drive the close→dequeue cycle.

const popupsState = reactive({})
const cacheState = reactive({ incomingTrust: {} })

const popupStore = {
	get popups() {
		return popupsState
	},
	get len() {
		return Object.keys(popupsState).length
	},
	isOpened: (target) => target in popupsState,
	open: (target) => {
		popupsState[target] = { order: Object.keys(popupsState).length }
	},
	close: (target) => {
		if (target in popupsState) delete popupsState[target]
	},
	getPayload: (target) => popupsState[target]?.payload,
}

// ── Captured listener bus ───────────────────────────────────────────────

const incomingPendingHandlers = []
const configUpdateHandlers = []
const incomingConnectedHandlers = []

const setTrustAllow = vi.fn().mockResolvedValue(undefined)
const setTrustReject = vi.fn().mockResolvedValue(undefined)
const replayPendingPrompts = vi.fn().mockResolvedValue(undefined)

vi.mock("@/wallet/services/incoming-transfer/client", () => ({
	IncomingTransferServiceClient: vi.fn(function () {
		return {
			onIncomingTransferPending: {
				add: (h) => incomingPendingHandlers.push(h),
				remove: () => {},
			},
			onConnected: {
				add: (h) => incomingConnectedHandlers.push(h),
				remove: () => {},
			},
			connect: vi.fn().mockResolvedValue(undefined),
			disconnect: vi.fn(),
			setTrustAllow,
			setTrustReject,
			replayPendingPrompts,
		}
	}),
}))

vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return {
			onUpdate: {
				add: (h) => configUpdateHandlers.push(h),
				remove: () => {},
			},
			connect: vi.fn().mockResolvedValue(undefined),
			disconnect: vi.fn(),
			getValue: vi.fn().mockResolvedValue(true),
		}
	}),
}))

vi.mock("@/stores/cache.store.ts", () => ({
	useCacheStore: () => cacheState,
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => popupStore,
}))
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({
		profile: { id: "p1" },
		network: { id: "net-1", chainId: 1 },
		account: { address: "0xacct" },
	}),
}))

// `shallow: true` auto-stubs every child component. The queue logic lives
// in PopupManager's <script>; the template just renders child popups.
const SHALLOW = true

import PopupManager from "./PopupManager.vue"

// ── Helpers ─────────────────────────────────────────────────────────────

function payload(overrides = {}) {
	return {
		profileId: "p1",
		networkId: "net-1",
		accountAddress: "0xacct",
		contract: "0xcontractA",
		tokenId: 1,
		tokenSymbol: "TST",
		tokenDecimals: 18,
		amountRaw: "1000",
		...overrides,
	}
}

async function firePending(p) {
	for (const h of incomingPendingHandlers) {
		await h(p)
	}
}

async function fireAndFlush(p) {
	await firePending(p)
	await flushPromises()
}

function reset() {
	incomingPendingHandlers.length = 0
	configUpdateHandlers.length = 0
	incomingConnectedHandlers.length = 0
	for (const k of Object.keys(popupsState)) delete popupsState[k]
	for (const k of Object.keys(cacheState.incomingTrust)) delete cacheState.incomingTrust[k]
	setTrustAllow.mockClear()
	setTrustReject.mockClear()
	replayPendingPrompts.mockClear()
}

beforeEach(reset)

// ── Tests ───────────────────────────────────────────────────────────────

describe("PopupManager — pending-trust queue + triple-key dedup", () => {
	test("single event: enqueues, opens popup, populates cacheStore", async () => {
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()

		await fireAndFlush(payload({ contract: "0xcA" }))

		expect(popupStore.isOpened("incoming_trust")).toBe(true)
		expect(cacheState.incomingTrust.contract).toBe("0xcA")
		expect(cacheState.incomingTrust.profileId).toBe("p1")
		expect(cacheState.incomingTrust.networkId).toBe("net-1")
	})

	test("duplicate event for queued triple: dropped silently", async () => {
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()

		await fireAndFlush(payload({ contract: "0xcA" }))
		// Same triple while popup is open → already-open coalesce: no-op.
		await fireAndFlush(payload({ contract: "0xcA" }))

		// Close popup; queue should be empty (the duplicate was dropped, not queued).
		popupStore.close("incoming_trust")
		await flushPromises()
		expect(popupStore.isOpened("incoming_trust")).toBe(false)
	})

	test("3 events across 2 contracts (1 repeat): open A → close → open B → close → stays closed", async () => {
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()

		await fireAndFlush(payload({ contract: "0xcA" })) // → opens A
		await fireAndFlush(payload({ contract: "0xcA" })) // → dedup (already open)
		await fireAndFlush(payload({ contract: "0xcB" })) // → queued behind A

		expect(cacheState.incomingTrust.contract).toBe("0xcA")
		expect(popupStore.isOpened("incoming_trust")).toBe(true)

		popupStore.close("incoming_trust")
		await flushPromises()

		// Queue dequeued: B surfaces.
		expect(cacheState.incomingTrust.contract).toBe("0xcB")
		expect(popupStore.isOpened("incoming_trust")).toBe(true)

		popupStore.close("incoming_trust")
		await flushPromises()

		// Queue empty: stays closed.
		expect(popupStore.isOpened("incoming_trust")).toBe(false)
	})

	test("same contract on DIFFERENT networks: BOTH surface (triple-key dedup, not bare-contract)", async () => {
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()

		// Same contract address (e.g. USDC twin), two networks.
		await fireAndFlush(payload({ networkId: "net-1", contract: "0xUSDC" }))
		await fireAndFlush(payload({ networkId: "net-2", contract: "0xUSDC" }))

		expect(cacheState.incomingTrust.contract).toBe("0xUSDC")
		expect(cacheState.incomingTrust.networkId).toBe("net-1")
		expect(popupStore.isOpened("incoming_trust")).toBe(true)

		popupStore.close("incoming_trust")
		await flushPromises()

		// Net-2 twin surfaces — would have been suppressed under bare-contract dedup.
		expect(cacheState.incomingTrust.contract).toBe("0xUSDC")
		expect(cacheState.incomingTrust.networkId).toBe("net-2")
		expect(popupStore.isOpened("incoming_trust")).toBe(true)
	})

	test("currently-open popup coalesce: dup fired while open does NOT add to queue", async () => {
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()

		await fireAndFlush(payload({ contract: "0xcA" })) // → opens A
		// Same triple fires repeatedly while open (replay-while-open case).
		await fireAndFlush(payload({ contract: "0xcA" }))
		await fireAndFlush(payload({ contract: "0xcA" }))
		await fireAndFlush(payload({ contract: "0xcA" }))

		popupStore.close("incoming_trust")
		await flushPromises()

		// All dups were coalesced — queue must be empty after close.
		expect(popupStore.isOpened("incoming_trust")).toBe(false)
	})

	test("allow/reject closures bind to the dequeued payload's triple, not the most recent event", async () => {
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()

		await fireAndFlush(payload({ networkId: "net-1", contract: "0xcA" }))
		await fireAndFlush(payload({ networkId: "net-2", contract: "0xcB" }))

		// Popup is for the FIRST event (net-1, 0xcA). The allow closure must
		// call setTrustAllow(p1, net-1, 0xcA) — NOT the most recent (net-2, 0xcB).
		await cacheState.incomingTrust.allow()

		expect(setTrustAllow).toHaveBeenCalledExactlyOnceWith("p1", "net-1", "0xcA")
	})
})
