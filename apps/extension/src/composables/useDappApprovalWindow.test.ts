/**
 * Direct unit tests for the dApp approval-window shell. The per-window frozen
 * oracles (windows/{discover,capabilities,execute}/index.test.ts) prove the
 * shell composes correctly inside each window; this suite pins the shell's own
 * contract in isolation — start/dispose ordering, the closeWindow completion
 * semantics, the listener identity pairing, the profile-change guard, and the
 * strip/error state.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises } from "@vue/test-utils"
import { reactive, ref, type Ref } from "vue"
import type { ProfileInfo } from "@/wallet/services/profile/client"

const routerPushMock = vi.fn()
const routerMock = {
	currentRoute: { value: { fullPath: "/windows/test?requestId=req-1", query: {} } },
	push: routerPushMock,
}

const appStoreDefaults = () =>
	reactive({
		isSessionChecked: true,
		isLogined: true,
		pageAwaitingAuth: "",
	})
let appStoreMock = appStoreDefaults()

vi.mock("@/stores/app.store", () => ({
	useAppStore: () => appStoreMock,
}))

vi.mock("vue-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vue-router")>()
	return { ...actual, useRouter: () => routerMock }
})

import { useDappApprovalWindow } from "./useDappApprovalWindow"

type WinListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void
let nativeAdd: WinListener
let nativeRemove: WinListener
let addSpy: ReturnType<typeof vi.fn<WinListener>>
let removeSpy: ReturnType<typeof vi.fn<WinListener>>
const callLog: string[] = []
const windowsRemoveMock = vi.fn(() => callLog.push("windows.remove"))

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

let activeDispose: (() => void) | undefined

afterEach(() => {
	// Detach any listener a test's start() left behind, then restore natives.
	activeDispose?.()
	activeDispose = undefined
	window.addEventListener = nativeAdd as unknown as typeof window.addEventListener
	window.removeEventListener = nativeRemove as unknown as typeof window.removeEventListener
	callLog.length = 0
	appStoreMock = appStoreDefaults()
	vi.clearAllMocks()
})

const makeShell = (overrides: Partial<Parameters<typeof useDappApprovalWindow>[0]> = {}) => {
	const profile: Ref<ProfileInfo | undefined> = ref(undefined)
	const isInteractionCancelled = ref(false)
	const isLoading = ref(false)
	const connectServices = vi.fn(() => callLog.push("connect"))
	const disconnectServices = vi.fn(() => callLog.push("disconnect"))
	let resolveInit: (() => void) | undefined
	const init = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				resolveInit = () => resolve()
			}),
	)
	const reject = vi.fn(() => callLog.push("reject"))
	const shell = useDappApprovalWindow({
		connectServices,
		disconnectServices,
		init,
		reject,
		profile,
		isInteractionCancelled,
		isLoading,
		...overrides,
	})
	activeDispose = shell.dispose
	return {
		shell,
		profile,
		isInteractionCancelled,
		isLoading,
		connectServices,
		disconnectServices,
		init,
		reject,
		resolveInit: () => resolveInit?.(),
	}
}

describe("useDappApprovalWindow", () => {
	test("start() runs connectServices first, before init", async () => {
		const { shell, init } = makeShell()
		const p = shell.start()
		expect(callLog[0]).toBe("connect")
		expect(init).toHaveBeenCalledTimes(1)
		await Promise.resolve()
		void p
	})

	test("session gate — init waits for isSessionChecked, then proceeds", async () => {
		appStoreMock.isSessionChecked = false
		const { shell, init, resolveInit } = makeShell()
		void shell.start()
		await flushPromises()
		expect(init).not.toHaveBeenCalled()
		appStoreMock.isSessionChecked = true
		await flushPromises()
		expect(init).toHaveBeenCalledTimes(1)
		resolveInit()
	})

	test("auth redirect — pageAwaitingAuth set, /popup/auth pushed, no init, no listener", async () => {
		appStoreMock.isLogined = false
		const { shell, init } = makeShell()
		await shell.start()
		expect(appStoreMock.pageAwaitingAuth).toBe(routerMock.currentRoute.value.fullPath)
		expect(routerPushMock).toHaveBeenCalledWith({ path: "/popup/auth" })
		expect(init).not.toHaveBeenCalled()
		expect(beforeunloadAdds()).toBe(0)
	})

	test("beforeunload is registered only AFTER init resolves", async () => {
		const { shell, resolveInit } = makeShell()
		void shell.start()
		await flushPromises()
		expect(beforeunloadAdds()).toBe(0)
		resolveInit()
		await flushPromises()
		expect(beforeunloadAdds()).toBe(1)
	})

	test("the registered listener delivers reject on a (simulated) unload", async () => {
		const { shell, resolveInit, reject } = makeShell()
		void shell.start()
		resolveInit()
		await flushPromises()
		window.dispatchEvent(new Event("beforeunload"))
		expect(reject).toHaveBeenCalledTimes(1)
	})

	test("dispose() disconnects first, removes the listener LAST", async () => {
		const { shell, resolveInit } = makeShell()
		void shell.start()
		resolveInit()
		await flushPromises()
		callLog.length = 0
		shell.dispose()
		expect(callLog).toEqual(["disconnect", "removeEventListener:beforeunload"])
	})

	test("closeWindow(true) removes the listener; closeWindow() keeps it; both close the window", async () => {
		const { shell, resolveInit } = makeShell()
		void shell.start()
		resolveInit()
		await flushPromises()
		shell.closeWindow()
		expect(beforeunloadRemoves()).toBe(0)
		expect(windowsRemoveMock).toHaveBeenCalledTimes(1)
		shell.closeWindow(true)
		expect(beforeunloadRemoves()).toBe(1)
		expect(windowsRemoveMock).toHaveBeenCalledTimes(2)
	})

	test("closeWindow(true) detaches the exact registered listener — later unloads no longer reject", async () => {
		const { shell, resolveInit, reject } = makeShell()
		void shell.start()
		resolveInit()
		await flushPromises()
		shell.closeWindow(true)
		window.dispatchEvent(new Event("beforeunload"))
		expect(reject).not.toHaveBeenCalled()
	})

	test("onActiveProfileChanged — undefined or different id rejects; same id is a no-op", () => {
		const { shell, profile, reject } = makeShell()
		profile.value = { id: "p1" } as ProfileInfo
		shell.onActiveProfileChanged({ id: "p1" } as ProfileInfo)
		expect(reject).not.toHaveBeenCalled()
		shell.onActiveProfileChanged({ id: "other" } as ProfileInfo)
		expect(reject).toHaveBeenCalledTimes(1)
		shell.onActiveProfileChanged(undefined)
		expect(reject).toHaveBeenCalledTimes(2)
	})

	test("stripStatus precedence — cancelled over loading over ready", () => {
		const { shell, isInteractionCancelled, isLoading } = makeShell()
		expect(shell.stripStatus.value).toBe("ready")
		isLoading.value = true
		expect(shell.stripStatus.value).toBe("loading")
		isInteractionCancelled.value = true
		expect(shell.stripStatus.value).toBe("cancelled")
	})

	test("setError defaults tooltip to the title and type to error; explicit values pass through", () => {
		const { shell } = makeShell()
		shell.setError("Oops")
		expect(shell.processingError.value).toEqual({ title: "Oops", tooltip: "Oops", type: "error" })
		shell.setError("Pick one", "Select an account", "warning")
		expect(shell.processingError.value).toEqual({ title: "Pick one", tooltip: "Select an account", type: "warning" })
	})

	test("clearError resets processingError", () => {
		const { shell } = makeShell()
		shell.setError("Oops")
		shell.clearError()
		expect(shell.processingError.value).toBeUndefined()
	})
})
