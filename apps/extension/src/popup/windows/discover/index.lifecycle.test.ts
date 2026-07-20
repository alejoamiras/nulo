/**
 * Frozen-oracle characterization tests for the discover approval window's SHELL
 * lifecycle — the connect/wait/redirect/init/beforeunload skeleton, the unmount
 * disconnect ORDER, and the closeWindow/beforeunload reject routing. Discover
 * uses the same `useDappApprovalWindow` shell as capabilities/execute, so these
 * pin its composition of that shell the same way those windows' oracles do; the
 * per-pin rationale lives in the R3 characterization spec:
 * implementations-plan/harden-quality-arc/round-2/R3-characterization.md.
 *
 * Discover's business gate (the `isReady` phishing defense on the Allow button)
 * is pinned separately in `index.test.ts`; this file owns ONLY the shell skeleton.
 *
 * Pins covered here (spec ids): A1 connect set+order · A2 session gate ·
 * A3 auth redirect · A4 beforeunload-after-init (incl. init-throw) · A5 unmount
 * disconnect order · A6 closeWindow(true) vs closeWindow() incl. overlay dismiss ·
 * A7 no-double-reject · B8 reject two-layer order · B9 the reject bail-out
 * (discover DIVERGES from capabilities — it bails on !requestId; do NOT "fix") ·
 * B10 cancelled-reject inert · C12 onActiveProfileChanged guard.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { reactive, ref, type Ref } from "vue"

// ── Mock state (closure refs so tests can flip values mid-test) ──────

let requestIdMock = ref<string | undefined>(undefined)
let dappMock = ref<{ name: string; url: string } | null>(null)
let payloadMock: Ref<unknown> = ref(null)
let isCancelledMock = ref(false)
let loadPromiseResolve: (() => void) | undefined
let getActiveProfilePromiseResolve: ((p: unknown) => void) | undefined
let getActiveProfilePromiseReject: ((err: Error) => void) | undefined

/** Ordered lifecycle log — the load-bearing pins assert exact sequences on this. */
const callLog: string[] = []

const loadInteractionPayloadMock = vi.fn(() => {
	return new Promise<void>((resolve) => {
		loadPromiseResolve = () => {
			// Mirror the real composable: load() commits requestId first, then dapp.
			requestIdMock.value = "req-123"
			dappMock.value = { name: "Test DApp", url: "https://example.com" }
			resolve()
		}
	})
})

const rejectViaInteractionServiceMock = vi.fn((reason: string) => {
	callLog.push(`composableReject:${reason}`)
})
const resolveInteractionMock = vi.fn(async () => undefined)

const getActiveProfileMock = vi.fn(() => {
	return new Promise<unknown>((resolve, reject) => {
		getActiveProfilePromiseResolve = resolve
		getActiveProfilePromiseReject = reject
	})
})

const profileServiceConnectMock = vi.fn(() => callLog.push("profile.connect"))
const profileServiceDisconnectMock = vi.fn(() => callLog.push("profile.disconnect"))
const interactionServiceConnectMock = vi.fn(() => callLog.push("interaction.connect"))
const interactionServiceDisconnectMock = vi.fn(() => callLog.push("interaction.disconnect"))
const onActiveProfileChangedAddMock = vi.fn()
const windowsRemoveMock = vi.fn(() => callLog.push("windows.remove"))

const routerPushMock = vi.fn()
const routerMock = {
	currentRoute: { value: { fullPath: "/windows/discover?requestId=req-route", query: { requestId: "req-route" } } },
	push: routerPushMock,
}

const appStoreDefaults = () =>
	reactive({
		isSessionChecked: true,
		isLogined: true,
		account: { name: "TestAccount" },
		network: { name: "TestNet" },
		pageAwaitingAuth: "",
	})
let appStoreMock = appStoreDefaults()

// ── Mocks (vi.mock is hoisted; factories run lazily at component import) ────

vi.mock("@/composables/useDappInteractionPayload", () => ({
	useDappInteractionPayload: vi.fn(() => ({
		requestId: requestIdMock,
		payload: payloadMock,
		dapp: dappMock,
		isCancelled: isCancelledMock,
		load: loadInteractionPayloadMock,
		reject: rejectViaInteractionServiceMock,
	})),
}))

vi.mock("@/composables/useDappHostname", () => ({
	useDappHostname: vi.fn(() => ({
		hostname: ref("example.com"),
		isSuspicious: ref(false),
	})),
}))

// Vitest 4 requires `function` expressions (not arrow functions) for mocks
// instantiated with `new`. Matches index.test.ts pattern.
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return {
			getActiveProfile: getActiveProfileMock,
			connect: profileServiceConnectMock,
			disconnect: profileServiceDisconnectMock,
			onActiveProfileChanged: { add: onActiveProfileChangedAddMock },
		}
	}),
}))

vi.mock("@/wallet/services/dapp-interaction/client", () => ({
	DappInteractionServiceClient: vi.fn(function () {
		return {
			connect: interactionServiceConnectMock,
			disconnect: interactionServiceDisconnectMock,
			resolveInteraction: resolveInteractionMock,
		}
	}),
}))

vi.mock("@/stores/app.store", () => ({
	useAppStore: () => appStoreMock,
}))

vi.mock("vue-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vue-router")>()
	return { ...actual, useRouter: () => routerMock }
})

// ── window listener spies (call-through so real registration still happens,
//    letting tests deliver a synthetic `beforeunload` to the live listener) ──

type WinListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void
let nativeAdd: WinListener
let nativeRemove: WinListener
let addSpy: ReturnType<typeof vi.fn<WinListener>>
let removeSpy: ReturnType<typeof vi.fn<WinListener>>

const beforeunloadAdds = () => addSpy.mock.calls.filter((c) => c[0] === "beforeunload").length
const beforeunloadRemoves = () => removeSpy.mock.calls.filter((c) => c[0] === "beforeunload").length

beforeEach(() => {
	nativeAdd = window.addEventListener.bind(window)
	nativeRemove = window.removeEventListener.bind(window)
	addSpy = vi.fn<WinListener>((type, listener, options) => {
		if (type === "beforeunload") callLog.push("addEventListener:beforeunload")
		nativeAdd(type, listener, options)
	})
	removeSpy = vi.fn<WinListener>((type, listener, options) => {
		if (type === "beforeunload") callLog.push("removeEventListener:beforeunload")
		nativeRemove(type, listener, options)
	})
	window.addEventListener = addSpy as unknown as typeof window.addEventListener
	window.removeEventListener = removeSpy as unknown as typeof window.removeEventListener

	// biome-ignore lint/suspicious/noExplicitAny: chrome runtime stub for tests
	;(globalThis as any).chrome = {
		windows: {
			getCurrent: (_o: unknown, cb: (w: { id?: number }) => void) => cb({ id: 42 }),
			remove: windowsRemoveMock,
		},
	}
})

let w: ReturnType<typeof factory> | undefined

afterEach(() => {
	// Unmount FIRST so the component's removeEventListener goes through the spy
	// and the real listener actually detaches (no cross-test beforeunload leaks).
	w?.unmount()
	w = undefined
	window.addEventListener = nativeAdd as unknown as typeof window.addEventListener
	window.removeEventListener = nativeRemove as unknown as typeof window.removeEventListener
	callLog.length = 0
	requestIdMock = ref<string | undefined>(undefined)
	dappMock = ref<{ name: string; url: string } | null>(null)
	payloadMock = ref(null)
	isCancelledMock = ref(false)
	appStoreMock = appStoreDefaults()
	loadPromiseResolve = undefined
	getActiveProfilePromiseResolve = undefined
	getActiveProfilePromiseReject = undefined
	vi.clearAllMocks()
})

// ── Stubs (children flattened; overlay stub re-emits dismiss on click) ──

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
	Tooltip: { template: "<div><slot /></div>" },
	Button: {
		props: ["disabled", "loading"],
		emits: ["click"],
		template: `
			<button
				:data-testid="$attrs['data-testid']"
				:disabled="disabled || loading"
				@click="$emit('click', $event)"
			>
				<slot />
			</button>
		`,
	},
	DappStatusStrip: { template: '<div data-testid="status-strip" />', props: ["accountName", "networkName", "status"] },
	DappIdentityBlock: {
		template: '<div data-testid="identity-block" />',
		props: ["dapp", "hostname", "hostnameSuspicious", "actionLabel", "hostnameTestId", "nameTestId"],
	},
	DappCancelledOverlay: {
		props: ["message"],
		emits: ["dismiss"],
		template: `<div data-testid="cancelled-overlay" :data-message="message" @click="$emit('dismiss')" />`,
	},
}

// Lazy import after vi.mock hoist
import Discover from "./index.vue"

const factory = () => mount(Discover, { global: { stubs: STUBS } })

type DiscoverVm = { reject: () => Promise<void>; closeWindow: (interactionCompleted?: boolean) => void }

/** Drive init to completion: resolve the profile fetch, then the payload load. */
const completeInit = async (profile: { id: string } = { id: "p1" }) => {
	await flushPromises()
	getActiveProfilePromiseResolve?.(profile)
	await flushPromises()
	loadPromiseResolve?.()
	await flushPromises()
}

describe("discover window — shell lifecycle frozen oracle", () => {
	test("A1: onMounted eager-connects exactly profile → interaction, in order", async () => {
		w = factory()
		await flushPromises()
		expect(callLog.filter((c) => c.endsWith(".connect"))).toEqual(["profile.connect", "interaction.connect"])
	})

	test("A2: session gate — init and beforeunload wait for isSessionChecked, then the delayed path completes", async () => {
		appStoreMock.isSessionChecked = false
		w = factory()
		await flushPromises()
		expect(getActiveProfileMock).not.toHaveBeenCalled()
		expect(beforeunloadAdds()).toBe(0)
		appStoreMock.isSessionChecked = true
		await flushPromises()
		expect(getActiveProfileMock).toHaveBeenCalledTimes(1)
		// Drive the unblocked init through to completion: the listener must register
		// exactly once on the delayed path too (not only the session-ready-at-mount path).
		// Flush between the two resolves — loadInteractionPayload is only called after
		// getActiveProfile resolves, so loadPromiseResolve isn't wired until then.
		getActiveProfilePromiseResolve?.({ id: "p1" })
		await flushPromises()
		loadPromiseResolve?.()
		await flushPromises()
		expect(beforeunloadAdds()).toBe(1)
	})

	test("A3: auth redirect short-circuits — pageAwaitingAuth set, no init, no beforeunload", async () => {
		appStoreMock.isLogined = false
		w = factory()
		await flushPromises()
		expect(appStoreMock.pageAwaitingAuth).toBe(routerMock.currentRoute.value.fullPath)
		expect(routerPushMock).toHaveBeenCalledWith({ path: "/popup/auth" })
		expect(getActiveProfileMock).not.toHaveBeenCalled()
		expect(beforeunloadAdds()).toBe(0)
	})

	test("A4: beforeunload is added AFTER init resolves — exactly once", async () => {
		w = factory()
		await flushPromises()
		// init is suspended on getActiveProfile — listener must not exist yet.
		expect(beforeunloadAdds()).toBe(0)
		getActiveProfilePromiseResolve?.({ id: "p1" })
		await flushPromises()
		// Still inside init (payload load pending).
		expect(beforeunloadAdds()).toBe(0)
		loadPromiseResolve?.()
		await flushPromises()
		expect(beforeunloadAdds()).toBe(1)
	})

	test("A4: beforeunload is STILL added when init throws internally", async () => {
		// init swallows its own errors into the error strip; the listener must be
		// registered anyway so a failed popup still rejects the request on close.
		w = factory()
		await flushPromises()
		getActiveProfilePromiseReject?.(new Error("profile-fetch-failed"))
		await flushPromises()
		expect(beforeunloadAdds()).toBe(1)
	})

	test("A5: unmount disconnect ORDER verbatim — profile, interaction, listener removal LAST", async () => {
		w = factory()
		await completeInit()
		callLog.length = 0
		w.unmount()
		w = undefined
		expect(callLog).toEqual(["profile.disconnect", "interaction.disconnect", "removeEventListener:beforeunload"])
	})

	test("A6: closeWindow(true) removes the beforeunload listener; closeWindow() keeps it; both close", async () => {
		w = factory()
		await completeInit()
		const vm = w.vm as unknown as DiscoverVm
		vm.closeWindow()
		expect(beforeunloadRemoves()).toBe(0)
		expect(windowsRemoveMock).toHaveBeenCalledTimes(1)
		vm.closeWindow(true)
		expect(beforeunloadRemoves()).toBe(1)
		expect(windowsRemoveMock).toHaveBeenCalledTimes(2)
	})

	test("A6: overlay @dismiss wires to closeWindow() with NO arg — listener stays attached", async () => {
		w = factory()
		await completeInit()
		isCancelledMock.value = true
		await w.vm.$nextTick()
		const overlay = w.find('[data-testid="cancelled-overlay"]')
		expect(overlay.exists()).toBe(true)
		await overlay.trigger("click")
		// Dismiss closes WITHOUT detaching beforeunload — the rejection is
		// deliberately delivered by the unload event, not a direct call.
		expect(windowsRemoveMock).toHaveBeenCalledTimes(1)
		expect(beforeunloadRemoves()).toBe(0)
	})

	test("A7: no double-reject — a decided reject detaches the listener before the window unloads", async () => {
		w = factory()
		await completeInit()
		await (w.vm as unknown as DiscoverVm).reject()
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(1)
		window.dispatchEvent(new Event("beforeunload"))
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(1)
	})

	test("B8: window-local reject() = composable reject THEN closeWindow(true) — order pinned", async () => {
		w = factory()
		await completeInit()
		callLog.length = 0
		await (w.vm as unknown as DiscoverVm).reject()
		expect(callLog).toEqual(["composableReject:User rejected", "removeEventListener:beforeunload", "windows.remove"])
	})

	test("B9 (DIVERGENCE): reject() with NO requestId is a COMPLETE no-op — discover bails where capabilities proceeds", async () => {
		// discover's reject() guards on `isInteractionCancelled || !requestId`, so a
		// pre-init reject (requestId still undefined) neither calls the composable
		// reject nor closes the window. Capabilities deliberately does the opposite
		// (R3-characterization.md §6.5) — this asymmetry is preserved verbatim.
		w = factory()
		await flushPromises()
		expect(requestIdMock.value).toBeUndefined()
		await (w.vm as unknown as DiscoverVm).reject()
		expect(rejectViaInteractionServiceMock).not.toHaveBeenCalled()
		expect(beforeunloadRemoves()).toBe(0)
		expect(windowsRemoveMock).not.toHaveBeenCalled()
	})

	test("B10: a cancelled overlay dismiss keeps the listener, and the LIVE beforeunload reject is inert", async () => {
		// Exercises the real chain end-to-end (not a direct reject() call): overlay
		// dismiss → closeWindow() with no arg → beforeunload stays attached → the
		// browser unloads → the LIVE listener calls reject() → which must be a no-op
		// because the request is already cancelled, or a dismiss would double-reject.
		w = factory()
		await completeInit()
		isCancelledMock.value = true
		await w.vm.$nextTick()
		await w.find('[data-testid="cancelled-overlay"]').trigger("click")
		expect(beforeunloadRemoves()).toBe(0) // dismiss did NOT detach the listener
		callLog.length = 0
		window.dispatchEvent(new Event("beforeunload")) // fire the live listener
		await flushPromises()
		expect(rejectViaInteractionServiceMock).not.toHaveBeenCalled()
		expect(callLog).toEqual([])
	})

	test("C12: onActiveProfileChanged — undefined or different id rejects; same id is a no-op", async () => {
		w = factory()
		// The window subscribes to onActiveProfileChanged exactly once during init.
		expect(onActiveProfileChangedAddMock).toHaveBeenCalledTimes(1)
		const handler = onActiveProfileChangedAddMock.mock.calls[0][0] as (p?: { id: string }) => void
		await completeInit({ id: "p1" })
		handler({ id: "p1" })
		await flushPromises()
		expect(rejectViaInteractionServiceMock).not.toHaveBeenCalled()
		handler({ id: "p-other" })
		await flushPromises()
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(1)
		handler(undefined)
		await flushPromises()
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(2)
	})
})
