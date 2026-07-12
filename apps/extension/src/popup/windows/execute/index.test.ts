/**
 * Frozen-oracle characterization tests for the execute approval window's SHELL
 * lifecycle — the connect/wait/redirect/init/beforeunload skeleton, the unmount
 * disconnect ORDER (4 services + listener last), the lazy execution-transport
 * asymmetry, and the wrong-profile overlay whose rejection is delivered via the
 * beforeunload route. These pin CURRENT behavior verbatim so the planned shell
 * extraction can be graded against them; they must pass unchanged before AND
 * after it. Spec: implementations-plan/harden-quality-arc/round-2/R3-characterization.md.
 *
 * Pins covered here (spec ids): A1 connect set+order (+ executionService NEVER
 * eager-connected) · A2 session gate · A3 auth redirect · A4 beforeunload-after-
 * init (incl. init-throw) · A5 unmount disconnect order · A6 closeWindow(true)
 * vs closeWindow() · A7 no-double-reject · B8 reject two-layer order · B9-mirror
 * (execute DOES bail on !requestId — the guard capabilities lacks) · C12
 * onActiveProfileChanged guard · D13 wrong-profile init check · D14 wrong-profile
 * rejection delivered on dismiss→unload · D16 connect/disconnect asymmetry.
 *
 * Out of scope (window-specific business pins D15: approve gating stack, fee
 * selection, token-metadata loading) — deferred; the network e2e dApp-execute
 * flow covers them end-to-end today.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { reactive, ref, type Ref } from "vue"

// ── Mock state (closure refs so tests can flip values mid-test) ──────

let requestIdMock = ref<string | undefined>(undefined)
let dappMock = ref<{ name: string; url: string } | null>(null)
let payloadMock: Ref<unknown> = ref(null)
let isCancelledMock = ref(false)
let payloadToLoad: unknown = null
let loadPromiseResolve: (() => void) | undefined
let loadPromiseReject: ((err: Error) => void) | undefined
let getActiveProfilePromiseResolve: ((p: unknown) => void) | undefined
let getActiveProfilePromiseReject: ((err: Error) => void) | undefined

/** Ordered lifecycle log — the load-bearing pins assert exact sequences on this. */
const callLog: string[] = []

const loadInteractionPayloadMock = vi.fn(() => {
	return new Promise<void>((resolve, reject) => {
		loadPromiseResolve = () => {
			// Mirror the real composable: load() commits requestId first, then payload + dapp.
			requestIdMock.value = "req-123"
			dappMock.value = { name: "Test DApp", url: "https://example.com" }
			payloadMock.value = payloadToLoad
			resolve()
		}
		loadPromiseReject = reject
	})
})

const rejectViaInteractionServiceMock = vi.fn((reason: string) => {
	callLog.push(`composableReject:${reason}`)
})
const approveInteractionMock = vi.fn(async () => undefined)

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
const executionServiceConnectMock = vi.fn(() => callLog.push("execution.connect"))
const executionServiceDisconnectMock = vi.fn(() => callLog.push("execution.disconnect"))
const tokenServiceConnectMock = vi.fn(() => callLog.push("token.connect"))
const tokenServiceDisconnectMock = vi.fn(() => callLog.push("token.disconnect"))
const onActiveProfileChangedAddMock = vi.fn()
const windowsRemoveMock = vi.fn(() => callLog.push("windows.remove"))

// Transient clients constructed INSIDE init() — the wrong-profile throw happens
// BEFORE their construction, which D13 pins via these constructor spies.
// vi.hoisted: these are referenced DIRECTLY in vi.mock factory bodies (not
// inside closures), so they must initialize before the hoisted mocks evaluate.
const { accountServiceCtorMock, networkServiceCtorMock } = vi.hoisted(() => ({
	accountServiceCtorMock: vi.fn(function () {
		return { getAccount: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }
	}),
	networkServiceCtorMock: vi.fn(function () {
		return { getNetworks: vi.fn(async () => []), connect: vi.fn(), disconnect: vi.fn() }
	}),
}))

const routerPushMock = vi.fn()
const routerMock = {
	currentRoute: { value: { fullPath: "/windows/execute?requestId=req-route", query: { requestId: "req-route" } } },
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

vi.mock("@/composables/useFeeEstimationMap", () => ({
	useFeeEstimationMap: vi.fn(() => ({
		results: ref({}),
		estimating: ref({}),
		estimate: vi.fn(),
	})),
}))

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: vi.fn() }),
	TOAST_DURATION: { SHORT: 2000, LONG: 5000 },
}))

// Vitest 4 requires `function` expressions (not arrow functions) for mocks
// instantiated with `new`. Matches discover/index.test.ts pattern.
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
			approveInteraction: approveInteractionMock,
		}
	}),
}))

vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			connect: executionServiceConnectMock,
			disconnect: executionServiceDisconnectMock,
			estimateOperationFee: vi.fn(async () => undefined),
		}
	}),
}))

vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return {
			connect: tokenServiceConnectMock,
			disconnect: tokenServiceDisconnectMock,
			previewTokenMetadata: vi.fn(async () => undefined),
		}
	}),
}))

vi.mock("@/wallet/services/account/client", () => ({
	AccountServiceClient: accountServiceCtorMock,
}))

vi.mock("@/wallet/services/network/client", () => ({
	NetworkServiceClient: networkServiceCtorMock,
}))

vi.mock("@/wallet/services/transaction/client", () => ({
	OriginType: { UI: "ui", DAPP: "dapp" },
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
		runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
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
	payloadToLoad = null
	requestIdMock = ref<string | undefined>(undefined)
	dappMock = ref<{ name: string; url: string } | null>(null)
	payloadMock = ref(null)
	isCancelledMock = ref(false)
	appStoreMock = appStoreDefaults()
	loadPromiseResolve = undefined
	loadPromiseReject = undefined
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
	SectionLabel: { template: "<div />" },
	OperationCard: { template: "<div />" },
	SignerIdentityStrip: { template: '<div data-testid="signer-strip" />', props: ["signerAccounts", "signerNetworks", "status"] },
	DappIdentityBlock: {
		template: '<div data-testid="identity-block" />',
		props: ["dapp", "hostname", "hostnameSuspicious", "actionLabel"],
	},
	DappCancelledOverlay: {
		props: ["message"],
		emits: ["dismiss"],
		template: `<div data-testid="cancelled-overlay" :data-message="message" @click="$emit('dismiss')" />`,
	},
}

// Lazy import after vi.mock hoist
import Execute from "./index.vue"

const factory = () => mount(Execute, { global: { stubs: STUBS } })

type ExecVm = {
	reject: () => Promise<void>
	closeWindow: (interactionCompleted?: boolean) => void
	isWrongProfile: boolean
	initComplete: boolean
}

/** Drive init to completion: resolve the profile fetch, then the payload load. */
const completeInit = async (profile: { id: string } = { id: "p1" }) => {
	await flushPromises()
	getActiveProfilePromiseResolve?.(profile)
	await flushPromises()
	loadPromiseResolve?.()
	await flushPromises()
}

/** Payload whose session belongs to a DIFFERENT profile than the active one. */
const wrongProfilePayload = () => ({
	session: { profileId: "p-OTHER", dappMetadata: { name: "Test DApp", url: "https://example.com" } },
	params: { operations: [] },
})

describe("execute window — shell lifecycle frozen oracle", () => {
	test("A1: onMounted eager-connects exactly profile → interaction → token; execution NEVER", async () => {
		w = factory()
		await flushPromises()
		expect(callLog.filter((c) => c.endsWith(".connect"))).toEqual(["profile.connect", "interaction.connect", "token.connect"])
		// The execution transport opens lazily on first request (fee estimation);
		// an eager connect here would change WHEN that transport opens. D16.
		expect(executionServiceConnectMock).not.toHaveBeenCalled()
	})

	test("A2: session gate — init and beforeunload wait for isSessionChecked", async () => {
		appStoreMock.isSessionChecked = false
		w = factory()
		await flushPromises()
		expect(getActiveProfileMock).not.toHaveBeenCalled()
		expect(beforeunloadAdds()).toBe(0)
		appStoreMock.isSessionChecked = true
		await flushPromises()
		expect(getActiveProfileMock).toHaveBeenCalledTimes(1)
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
		expect(beforeunloadAdds()).toBe(0)
		getActiveProfilePromiseResolve?.({ id: "p1" })
		await flushPromises()
		expect(beforeunloadAdds()).toBe(0)
		loadPromiseResolve?.()
		await flushPromises()
		expect(beforeunloadAdds()).toBe(1)
	})

	test("A4: beforeunload is STILL added when init throws internally", async () => {
		w = factory()
		await flushPromises()
		getActiveProfilePromiseReject?.(new Error("profile-fetch-failed"))
		await flushPromises()
		expect(beforeunloadAdds()).toBe(1)
		expect(w.find('[data-testid="error-text"]').exists()).toBe(true)
	})

	test("A5/D16: unmount disconnect ORDER verbatim — profile, interaction, execution, token, listener LAST", async () => {
		w = factory()
		await completeInit()
		callLog.length = 0
		w.unmount()
		w = undefined
		// executionService.disconnect IS here even though it was never eager-connected:
		// it tears down a possibly-lazily-opened fee-estimation transport. Not dead code.
		expect(callLog).toEqual([
			"profile.disconnect",
			"interaction.disconnect",
			"execution.disconnect",
			"token.disconnect",
			"removeEventListener:beforeunload",
		])
		expect(executionServiceConnectMock).not.toHaveBeenCalled()
	})

	test("A6: closeWindow(true) removes the beforeunload listener; closeWindow() keeps it; both close", async () => {
		w = factory()
		await completeInit()
		const vm = w.vm as unknown as ExecVm
		vm.closeWindow()
		expect(beforeunloadRemoves()).toBe(0)
		expect(windowsRemoveMock).toHaveBeenCalledTimes(1)
		vm.closeWindow(true)
		expect(beforeunloadRemoves()).toBe(1)
		expect(windowsRemoveMock).toHaveBeenCalledTimes(2)
	})

	test("A7: no double-reject — a decided reject detaches the listener before the window unloads", async () => {
		w = factory()
		await completeInit()
		await (w.vm as unknown as ExecVm).reject()
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(1)
		window.dispatchEvent(new Event("beforeunload"))
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(1)
	})

	test("B8: window-local reject() = composable reject THEN closeWindow(true) — order pinned", async () => {
		w = factory()
		await completeInit()
		callLog.length = 0
		await (w.vm as unknown as ExecVm).reject()
		expect(callLog).toEqual(["composableReject:User rejected", "removeEventListener:beforeunload", "windows.remove"])
	})

	test("B9-mirror: reject() with NO requestId is fully inert (the guard capabilities lacks)", async () => {
		// execute's reject() bails on `isInteractionCancelled || !requestId` BEFORE
		// touching the composable or the window — the exact clause capabilities'
		// reject() drops (R3-characterization.md §6.5). Pinned from both sides.
		w = factory()
		await flushPromises()
		expect(requestIdMock.value).toBeUndefined()
		await (w.vm as unknown as ExecVm).reject()
		expect(rejectViaInteractionServiceMock).not.toHaveBeenCalled()
		expect(beforeunloadRemoves()).toBe(0)
		expect(windowsRemoveMock).not.toHaveBeenCalled()
	})

	test("C12: onActiveProfileChanged — undefined or different id rejects; same id is a no-op", async () => {
		w = factory()
		expect(onActiveProfileChangedAddMock).toHaveBeenCalledTimes(1)
		const handler = onActiveProfileChangedAddMock.mock.calls[0][0] as (p?: { id: string }) => void
		await completeInit({ id: "p1" })
		handler({ id: "p1" })
		await flushPromises()
		expect(rejectViaInteractionServiceMock).not.toHaveBeenCalled()
		expect(windowsRemoveMock).not.toHaveBeenCalled()
		handler({ id: "p-other" })
		await flushPromises()
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(1)
		handler(undefined)
		await flushPromises()
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(2)
	})

	test("D13: wrong-profile init check — overlay wins, initComplete stays false, beforeunload still added", async () => {
		payloadToLoad = wrongProfilePayload()
		w = factory()
		await completeInit({ id: "p1" })
		const vm = w.vm as unknown as ExecVm
		expect(vm.isWrongProfile).toBe(true)
		expect(vm.initComplete).toBe(false)
		// The throw happens BEFORE the transient account/network clients are built.
		expect(accountServiceCtorMock).not.toHaveBeenCalled()
		expect(networkServiceCtorMock).not.toHaveBeenCalled()
		// init's catch also set the generic error, but the wrong-profile overlay
		// wins the template precedence chain.
		const overlay = w.find('[data-testid="cancelled-overlay"]')
		expect(overlay.exists()).toBe(true)
		expect(overlay.attributes("data-message")).toContain("different profile")
		// The request must still be rejectable on close.
		expect(beforeunloadAdds()).toBe(1)
	})

	test("D14: wrong-profile rejection is delivered on dismiss → unload, not inline", async () => {
		payloadToLoad = wrongProfilePayload()
		w = factory()
		await completeInit({ id: "p1" })
		// No rejection has happened yet — the overlay is just showing.
		expect(rejectViaInteractionServiceMock).not.toHaveBeenCalled()
		callLog.length = 0
		// OK on the overlay → closeWindow() with NO arg → listener stays attached.
		await w.find('[data-testid="cancelled-overlay"]').trigger("click")
		expect(windowsRemoveMock).toHaveBeenCalledTimes(1)
		expect(beforeunloadRemoves()).toBe(0)
		// The real window would now unload; the still-attached handler delivers
		// the rejection (requestId was set by load() before the profile check).
		window.dispatchEvent(new Event("beforeunload"))
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledWith("User rejected")
		expect(callLog).toEqual(["windows.remove", "composableReject:User rejected", "removeEventListener:beforeunload", "windows.remove"])
	})
})
