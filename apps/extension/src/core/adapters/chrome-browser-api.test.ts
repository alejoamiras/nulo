import { describe, expect, test, vi } from "vitest"
import { deferred } from "@nulo/wallet-core/utils"
import { RealChromeBrowserApi } from "./chrome-browser-api"

type Win = { id: number; type: string; left: number; top: number; width: number; height: number }
type Stub = (...args: unknown[]) => unknown

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The suite's `chrome` stub has no `windows`; install one per test. `firefox` adds
 *  `runtime.getBrowserInfo`, the Firefox-only API the adapter keys its focus tracker on. */
function stubWindows(impl: Partial<{ getLastFocused: unknown; update: unknown; get: unknown }>, { firefox = false } = {}) {
	const getLastFocused = vi.fn<Stub>(impl.getLastFocused as Stub)
	const update = vi.fn<Stub>(impl.update as Stub)
	const get = vi.fn<Stub>(impl.get as Stub)
	const focusListeners: Array<(windowId: number) => void> = []
	const onFocusChanged = { addListener: vi.fn((listener: (windowId: number) => void) => focusListeners.push(listener)) }
	const base = (globalThis as { chrome?: { runtime?: object } }).chrome
	const runtime = firefox ? { ...base?.runtime, getBrowserInfo: vi.fn() } : base?.runtime
	vi.stubGlobal("chrome", { ...base, runtime, windows: { getLastFocused, update, get, onFocusChanged, WINDOW_ID_NONE: -1 } })
	const focus = (windowId: number) => {
		for (const listener of focusListeners) listener(windowId)
	}
	return { getLastFocused, update, get, onFocusChanged, focus, windows: new RealChromeBrowserApi().windows }
}

describe("ChromeWindowsAdapter", () => {
	test("getLastFocused asks for NORMAL windows only and returns the bounds", async () => {
		const { getLastFocused, onFocusChanged, windows } = stubWindows({
			getLastFocused: async () => ({ id: 7, type: "normal", left: -1920, top: 0, width: 1920, height: 1080, focused: true }),
		})

		await expect(windows.getLastFocused()).resolves.toEqual({ left: -1920, top: 0, width: 1920, height: 1080 })
		await expect(windows.getLastFocused()).resolves.toEqual({ left: -1920, top: 0, width: 1920, height: 1080 })
		expect(getLastFocused).toHaveBeenCalledWith({ windowTypes: ["normal"] })
		// Chrome honours the filter; a listener there would wake the service worker on every focus change.
		expect(onFocusChanged.addListener).not.toHaveBeenCalled()
	})

	test("getLastFocused never throws: a rejecting lookup and non-numeric bounds both yield undefined", async () => {
		const throwing = stubWindows({
			getLastFocused: async () => {
				throw new Error("No window with id")
			},
		})
		await expect(throwing.windows.getLastFocused()).resolves.toBeUndefined()

		const partial = stubWindows({ getLastFocused: async () => ({ id: 7, type: "normal", left: 10, top: 20 }) })
		await expect(partial.windows.getLastFocused()).resolves.toBeUndefined()
	})

	test("update forwards the window id and options", async () => {
		const { update, windows } = stubWindows({ update: async () => ({}) })

		await windows.update(42, { focused: true, drawAttention: true, state: "normal" })
		expect(update).toHaveBeenCalledWith(42, { focused: true, drawAttention: true, state: "normal" })
	})
})

describe("ChromeWindowsAdapter on Firefox (getLastFocused ignores windowTypes)", () => {
	const boundsOf = ({ left, top, width, height }: Win) => ({ left, top, width, height })

	/** A Firefox desktop: dApp window A, a second normal window B and an approval popup. `answer` is
	 *  what `windows.getLastFocused` returns; `windows.get` reads the desktop as it is at call time. */
	function firefoxDesktop() {
		const A: Win = { id: 1, type: "normal", left: 0, top: 0, width: 1000, height: 900 }
		const B: Win = { id: 2, type: "normal", left: 1200, top: 40, width: 800, height: 700 }
		const POPUP: Win = { id: 3, type: "popup", left: 600, top: 100, width: 400, height: 800 }
		const desktop = new Map([A, B, POPUP].map((win) => [win.id, win]))
		const state = { answer: A as Win }
		const stub = stubWindows(
			{
				getLastFocused: async () => state.answer,
				get: async (id: number) => {
					const win = desktop.get(id)
					if (!win) throw new Error(`No window with id: ${id}.`)
					return { ...win }
				},
			},
			{ firefox: true },
		)
		return { ...stub, A, B, POPUP, desktop, state }
	}

	test("the first lookup adds exactly one focus listener; later lookups add none", async () => {
		const { onFocusChanged, windows } = firefoxDesktop()

		await windows.getLastFocused()
		await windows.getLastFocused()
		await windows.getLastFocused()

		expect(onFocusChanged.addListener).toHaveBeenCalledTimes(1)
	})

	test("normal A answered, B focused, the popup focused, the popup answered → B's re-read bounds", async () => {
		const { windows, focus, A, B, POPUP, state } = firefoxDesktop()
		await expect(windows.getLastFocused()).resolves.toEqual(boundsOf(A))

		focus(B.id)
		focus(POPUP.id)
		await flush()
		B.left = 1300
		state.answer = POPUP

		await expect(windows.getLastFocused()).resolves.toEqual(boundsOf(B))
	})

	test("an older focus result cannot replace a newer one", async () => {
		const { windows, focus, get, A, B, POPUP, state } = firefoxDesktop()
		await windows.getLastFocused()
		const slowB = deferred<Win>()
		get.mockImplementationOnce(() => slowB.promise)

		focus(B.id)
		focus(A.id)
		await flush()
		slowB.resolve({ ...B })
		await flush()
		state.answer = POPUP

		await expect(windows.getLastFocused()).resolves.toEqual(boundsOf(A))
	})

	test("a focus that started after a lookup wins over that lookup's answer", async () => {
		const { windows, focus, getLastFocused, A, B, POPUP, state } = firefoxDesktop()
		await windows.getLastFocused()
		const slowAnswer = deferred<Win>()
		getLastFocused.mockImplementationOnce(() => slowAnswer.promise)

		const first = windows.getLastFocused()
		focus(B.id)
		await flush()
		slowAnswer.resolve({ ...A })
		await expect(first).resolves.toEqual(boundsOf(A))
		state.answer = POPUP

		await expect(windows.getLastFocused()).resolves.toEqual(boundsOf(B))
	})

	test("B's lookup still pending when the popup answer arrives: it waits for B, not the cached A", async () => {
		const { windows, focus, get, B, POPUP, state } = firefoxDesktop()
		await windows.getLastFocused()
		const slowB = deferred<Win>()
		get.mockImplementationOnce(() => slowB.promise)

		focus(B.id)
		state.answer = POPUP
		let settled = false
		const placed = windows.getLastFocused().finally(() => {
			settled = true
		})
		await flush()
		expect(settled).toBe(false)

		slowB.resolve({ ...B })
		await expect(placed).resolves.toEqual(boundsOf(B))
	})

	test("WINDOW_ID_NONE is ignored", async () => {
		const { windows, focus, get, A, POPUP, state } = firefoxDesktop()
		await windows.getLastFocused()

		focus(-1)
		await flush()
		state.answer = POPUP

		await expect(windows.getLastFocused()).resolves.toEqual(boundsOf(A))
		expect(get).not.toHaveBeenCalledWith(-1)
	})

	test("undefined, never a throw, when the remembered window is gone or no longer normal", async () => {
		const { windows, A, POPUP, desktop, state } = firefoxDesktop()
		await windows.getLastFocused()
		state.answer = POPUP

		A.type = "popup"
		await expect(windows.getLastFocused()).resolves.toBeUndefined()
		desktop.delete(A.id)
		await expect(windows.getLastFocused()).resolves.toBeUndefined()
	})

	test("undefined when no normal window was ever recorded", async () => {
		const { windows, get, POPUP, state } = firefoxDesktop()
		state.answer = POPUP

		await expect(windows.getLastFocused()).resolves.toBeUndefined()
		expect(get).not.toHaveBeenCalled()
	})
})
