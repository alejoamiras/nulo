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

import { type VueWrapper, flushPromises, mount as rawMount } from "@vue/test-utils"
import { reactive } from "vue"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// ── Reactive store stand-ins ────────────────────────────────────────────
//
// Real Pinia would also work but adds setup mass. The watcher inside
// PopupManager watches `popupStore.isOpened("incoming_trust")`, which is
// reactive via reading `target in popupsState` on each tracker tick — so
// a reactive() proxy here is enough to drive the close→dequeue cycle.

interface IncomingTrustState {
	tokenSymbol?: string
	tokenDecimals?: number
	amountRaw?: string
	contract?: string
	profileId?: string
	networkId?: string
	allow?: () => Promise<void>
	reject?: () => Promise<void>
}

const popupsState: Record<string, { order: number; payload?: unknown }> = reactive({})
const cacheState: { incomingTrust: IncomingTrustState } = reactive({ incomingTrust: {} })

const popupStore = {
	get popups() {
		return popupsState
	},
	get len() {
		return Object.keys(popupsState).length
	},
	isOpened: (target: string) => target in popupsState,
	open: (target: string) => {
		popupsState[target] = { order: Object.keys(popupsState).length }
	},
	close: (target: string) => {
		if (target in popupsState) delete popupsState[target]
	},
	getPayload: (target: string) => popupsState[target]?.payload,
}

// ── Captured listener bus ───────────────────────────────────────────────

interface PendingPayload {
	profileId: string
	networkId: string
	accountAddress: string
	contract: string
	tokenId: number
	tokenSymbol: string
	tokenDecimals: number
	amountRaw: string
}

const incomingPendingHandlers: Array<(p: PendingPayload) => void | Promise<void>> = []
const configUpdateHandlers: Array<(p: { key: string; value: unknown }) => void> = []
const incomingConnectedHandlers: Array<() => void | Promise<void>> = []

const setTrustAllow = vi.fn().mockResolvedValue(undefined)
const setTrustReject = vi.fn().mockResolvedValue(undefined)
const replayPendingPrompts = vi.fn().mockResolvedValue(undefined)

vi.mock("@/wallet/services/incoming-transfer/client", () => ({
	IncomingTransferServiceClient: vi.fn(function () {
		return {
			onIncomingTransferPending: {
				add: (h: (p: PendingPayload) => void | Promise<void>) => incomingPendingHandlers.push(h),
				remove: () => {},
			},
			onConnected: {
				add: (h: () => void | Promise<void>) => incomingConnectedHandlers.push(h),
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

// Controllable getValue resolver for P6 seed-race tests. Tests can swap
// this to a deferred to simulate the connect-vs-seed window.
let configGetValueImpl: () => Promise<boolean> = () => Promise.resolve(true)
const configUpdateRemoveSpy = vi.fn()
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return {
			onUpdate: {
				add: (h: (p: { key: string; value: unknown }) => void) => configUpdateHandlers.push(h),
				remove: (h: (p: { key: string; value: unknown }) => void) => {
					configUpdateRemoveSpy(h)
					const idx = configUpdateHandlers.indexOf(h)
					if (idx >= 0) configUpdateHandlers.splice(idx, 1)
				},
			},
			connect: vi.fn().mockResolvedValue(undefined),
			disconnect: vi.fn(),
			getValue: vi.fn().mockImplementation(() => configGetValueImpl()),
		}
	}),
}))

vi.mock("@/stores/cache.store.ts", () => ({
	useCacheStore: () => cacheState,
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => popupStore,
}))
// Controllable appStore for the P8 triple-ready watcher tests. Reactive
// so the watcher inside PopupManager observes changes.
const appStoreState = reactive({
	profile: { id: "p1" } as { id?: string } | null,
	network: { id: "net-1", chainId: 1 } as { id?: string; chainId?: number } | null,
	account: { address: "0xacct" } as { address?: string } | null,
})
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => appStoreState,
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

async function firePending(p: PendingPayload) {
	for (const h of incomingPendingHandlers) {
		await h(p)
	}
}

async function fireAndFlush(p: PendingPayload) {
	await firePending(p)
	await flushPromises()
}

function reset() {
	incomingPendingHandlers.length = 0
	configUpdateHandlers.length = 0
	incomingConnectedHandlers.length = 0
	for (const k of Object.keys(popupsState)) delete popupsState[k]
	for (const k of Object.keys(cacheState.incomingTrust)) delete (cacheState.incomingTrust as Record<string, unknown>)[k]
	setTrustAllow.mockClear()
	setTrustReject.mockClear()
	replayPendingPrompts.mockClear()
	configUpdateRemoveSpy.mockClear()
	configGetValueImpl = () => Promise.resolve(true)
	appStoreState.profile = { id: "p1" }
	appStoreState.network = { id: "net-1", chainId: 1 }
	appStoreState.account = { address: "0xacct" }
}

// Track mounted wrappers so afterEach can unmount them. Required because
// the P8 watcher in PopupManager listens to the shared reactive
// `appStoreState` — without unmounting, watchers from prior test mounts
// continue firing on subsequent tests' state mutations.
const trackedWrappers: VueWrapper<unknown>[] = []
function mount(component: unknown, options?: Parameters<typeof rawMount>[1]): VueWrapper<unknown> {
	const w = rawMount(component as never, options)
	trackedWrappers.push(w)
	return w
}

beforeEach(reset)
afterEach(() => {
	while (trackedWrappers.length > 0) {
		const w = trackedWrappers.pop()
		w?.unmount()
	}
})

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
		// Post-impl audit High #1: the stale-triple guard drops payloads
		// whose triple doesn't match the live appStore. To still exercise
		// the queue's triple-key dedup (vs bare-contract dedup), switch
		// `appStoreState.network` between firing the two payloads so each
		// is valid at fire-time. This models the real scenario where the
		// user changes network between two pending-prompt events.
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()

		// Fire net-1 payload while appStore is on net-1.
		await fireAndFlush(payload({ networkId: "net-1", contract: "0xUSDC" }))
		expect(cacheState.incomingTrust.contract).toBe("0xUSDC")
		expect(cacheState.incomingTrust.networkId).toBe("net-1")
		expect(popupStore.isOpened("incoming_trust")).toBe(true)

		popupStore.close("incoming_trust")
		await flushPromises()

		// Switch the live triple to net-2 before firing the net-2 payload.
		appStoreState.network = { id: "net-2", chainId: 2 }
		await flushPromises()
		await fireAndFlush(payload({ networkId: "net-2", contract: "0xUSDC" }))

		// Net-2 twin surfaces — would have been suppressed under bare-contract dedup.
		expect(cacheState.incomingTrust.contract).toBe("0xUSDC")
		expect(cacheState.incomingTrust.networkId).toBe("net-2")
		expect(popupStore.isOpened("incoming_trust")).toBe(true)
	})

	test("(post-impl) stale-triple defense: payload for non-active triple is dropped", async () => {
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()
		// appStore is on net-1; fire a payload for net-2 → must NOT enqueue.
		await fireAndFlush(payload({ networkId: "net-2", contract: "0xstaleNet" }))
		expect(popupStore.isOpened("incoming_trust")).toBe(false)
		expect(cacheState.incomingTrust.contract).toBeUndefined()
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
		await cacheState.incomingTrust.allow?.()

		expect(setTrustAllow).toHaveBeenCalledExactlyOnceWith("p1", "net-1", "0xcA")
	})
})

describe("PopupManager — P6 visibility race + onUnmount listener cleanup", () => {
	test("(post-init) OFF→ON config event calls replayPendingPrompts with active triple", async () => {
		// Seed reads false (persisted OFF state).
		configGetValueImpl = () => Promise.resolve(false)
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()

		// Fire the OFF→ON event after init completes.
		for (const h of configUpdateHandlers) h({ key: "incomingTransfersVisible", value: true })
		await flushPromises()

		expect(replayPendingPrompts).toHaveBeenCalledExactlyOnceWith("p1", "net-1", "0xacct")
	})

	test("(pre-init) config event fired BEFORE seed resolves is ignored", async () => {
		// Hold getValue in a never-resolving promise so init can't complete.
		let resolveGet: (v: boolean) => void = () => {}
		configGetValueImpl = () =>
			new Promise<boolean>((r) => {
				resolveGet = r
			})
		mount(PopupManager, { shallow: SHALLOW })
		// flush microtasks so connect() resolves but getValue stays pending
		await flushPromises()

		// At this point: connect resolved, getValue still pending. The
		// listener should NOT be registered yet OR (if it is) the gate
		// flag should suppress.
		// The handler may have been added BEFORE the gate landed in P6 v1;
		// in P6, registration is INSIDE onMounted AFTER seed resolves, so
		// configUpdateHandlers should still be empty here.
		expect(configUpdateHandlers.length).toBe(0)

		// Resolve seed, finalize init.
		resolveGet(false)
		await flushPromises()

		// Listener now registered.
		expect(configUpdateHandlers.length).toBe(1)

		// Fire post-init OFF→ON: replay called once.
		for (const h of configUpdateHandlers) h({ key: "incomingTransfersVisible", value: true })
		await flushPromises()
		expect(replayPendingPrompts).toHaveBeenCalledTimes(1)
	})

	test("mount → unmount removes the config listener (no listener leak)", async () => {
		const w = mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()
		expect(configUpdateHandlers.length).toBe(1)

		w.unmount()
		await flushPromises()

		expect(configUpdateRemoveSpy).toHaveBeenCalledTimes(1)
		// And the handlers array reflects the removal (our mock spliced).
		expect(configUpdateHandlers.length).toBe(0)
	})

	test("mount → unmount → mount: exactly one listener registered after the second mount", async () => {
		const w1 = mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()
		w1.unmount()
		await flushPromises()
		expect(configUpdateHandlers.length).toBe(0)

		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()
		expect(configUpdateHandlers.length).toBe(1)
	})
})

describe("PopupManager — P8 triple-ready replay (C2 tactical)", () => {
	test("onConnected with active triple ready: replayPendingPrompts called once", async () => {
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()
		// Fire onConnected; triple is populated from the default reset state.
		for (const h of incomingConnectedHandlers) await h()
		await flushPromises()
		expect(replayPendingPrompts).toHaveBeenCalledExactlyOnceWith("p1", "net-1", "0xacct")
	})

	test("onConnected with empty triple, then triple populates: replay fires via watcher", async () => {
		appStoreState.profile = null
		appStoreState.network = null
		appStoreState.account = null
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()
		// onConnected fires while triple unset → early-return, no replay.
		for (const h of incomingConnectedHandlers) await h()
		await flushPromises()
		expect(replayPendingPrompts).not.toHaveBeenCalled()

		// Now populate the triple → watcher fires tryReplay → replay called.
		appStoreState.profile = { id: "p1" }
		appStoreState.network = { id: "net-1", chainId: 1 }
		appStoreState.account = { address: "0xacct" }
		await flushPromises()
		expect(replayPendingPrompts).toHaveBeenCalledExactlyOnceWith("p1", "net-1", "0xacct")
	})

	test("idempotency: onConnected fires twice for the same triple → replay called only once", async () => {
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()
		for (const h of incomingConnectedHandlers) await h()
		await flushPromises()
		for (const h of incomingConnectedHandlers) await h()
		await flushPromises()
		expect(replayPendingPrompts).toHaveBeenCalledTimes(1)
	})

	test("profile switch: triple .id changes → replay re-fires for the new profile", async () => {
		mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()
		for (const h of incomingConnectedHandlers) await h()
		await flushPromises()
		expect(replayPendingPrompts).toHaveBeenCalledExactlyOnceWith("p1", "net-1", "0xacct")

		// Profile switch — watcher fires, replay re-runs for the new triple.
		appStoreState.profile = { id: "p2" }
		await flushPromises()
		expect(replayPendingPrompts).toHaveBeenCalledTimes(2)
		expect(replayPendingPrompts).toHaveBeenLastCalledWith("p2", "net-1", "0xacct")
	})

	test("unmount: watcher deregistered → triple changes after unmount do not call replay", async () => {
		const w = mount(PopupManager, { shallow: SHALLOW })
		await flushPromises()
		for (const h of incomingConnectedHandlers) await h()
		await flushPromises()
		w.unmount()
		await flushPromises()
		replayPendingPrompts.mockClear()
		// Triple changes post-unmount.
		appStoreState.profile = { id: "p2" }
		await flushPromises()
		expect(replayPendingPrompts).not.toHaveBeenCalled()
	})
})
