import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeBrowserApi, MockClock } from "@nulo/wallet-core/testing"
import { LogLevel, type ILogger } from "@/wallet/logger"
import { centerOn, createPlaced, topRightOf, WindowManager } from "./window-manager"

const TIMEOUT_MS = 5_000

const nullLogger: ILogger = { log: () => {} } as unknown as ILogger

/** First window created per test always gets id 1000 (FakeBrowserApi resets on new instance). */
const FIRST_WINDOW_ID = 1000

/** Macrotask flush: drains the getLastFocused → create → continuation chain. */
async function flushCreate(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("WindowManager", () => {
	let clock: MockClock
	let browser: FakeBrowserApi
	let manager: WindowManager
	/** Cast for test-only helpers (closeByUser). */
	let fakeWindows: { closeByUser: (id: number) => void }

	beforeEach(() => {
		clock = new MockClock()
		browser = new FakeBrowserApi()
		browser.reset()
		manager = new WindowManager(browser.windows, clock, nullLogger)
		fakeWindows = browser.windows as unknown as { closeByUser: (id: number) => void }
	})

	it("normal settle resolves promise with value and calls windows.remove", async () => {
		const removeSpy = vi.spyOn(browser.windows, "remove")

		const { handleId, promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()

		manager.settle(handleId, "ok")

		await expect(promise).resolves.toBe("ok")
		expect(removeSpy).toHaveBeenCalledWith(FIRST_WINDOW_ID)
	})

	it("cancel rejects promise and calls windows.remove", async () => {
		const removeSpy = vi.spyOn(browser.windows, "remove")

		const { handleId, promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()

		manager.cancel(handleId, "rejected by caller")

		await expect(promise).rejects.toBe("rejected by caller")
		expect(removeSpy).toHaveBeenCalledWith(FIRST_WINDOW_ID)
	})

	it("cancel with an Error rejects with that same instance and calls windows.remove", async () => {
		const removeSpy = vi.spyOn(browser.windows, "remove")
		const reason = new Error("typed rejection")

		const { handleId, promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()

		manager.cancel(handleId, reason)

		await expect(promise).rejects.toBe(reason)
		expect(removeSpy).toHaveBeenCalledWith(FIRST_WINDOW_ID)
	})

	it("timeout rejects promise and calls windows.remove", async () => {
		const removeSpy = vi.spyOn(browser.windows, "remove")

		const { promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()

		clock.advance(TIMEOUT_MS)

		await expect(promise).rejects.toMatch(/timed out/i)
		expect(removeSpy).toHaveBeenCalledWith(FIRST_WINDOW_ID)
	})

	it("user-close rejects promise and does NOT call windows.remove", async () => {
		const removeSpy = vi.spyOn(browser.windows, "remove")

		const { promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()

		fakeWindows.closeByUser(FIRST_WINDOW_ID)

		await expect(promise).rejects.toMatch(/closed by user/i)
		expect(removeSpy).not.toHaveBeenCalled()
	})

	it("double-settle is a no-op after first settlement", async () => {
		const { handleId, promise } = manager.openAndAwait<number>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()

		manager.settle(handleId, 1)
		manager.settle(handleId, 2)

		await expect(promise).resolves.toBe(1)
	})

	it("settle-after-timeout is a no-op", async () => {
		const { handleId, promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()
		clock.advance(TIMEOUT_MS)
		await expect(promise).rejects.toBeDefined()

		// No throw — silently ignored.
		expect(() => manager.settle(handleId, "late")).not.toThrow()
	})

	it("cancel-after-settle is a no-op", async () => {
		const { handleId, promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()

		manager.settle(handleId, "done")
		await expect(promise).resolves.toBe("done")

		expect(() => manager.cancel(handleId, "too late")).not.toThrow()
	})

	it("spurious onRemoved for a different windowId does not settle the handle", async () => {
		const { handleId, promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()

		// Fire onRemoved for a different window — must not settle.
		fakeWindows.closeByUser(9999)

		// Settle ourselves to confirm the handle is still live.
		manager.settle(handleId, "still here")
		await expect(promise).resolves.toBe("still here")
	})

	it("windows.create returning id=undefined rejects promise", async () => {
		vi.spyOn(browser.windows, "create").mockResolvedValue({ id: undefined })

		const { promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})

		// No flush first: a macrotask boundary before the handler attaches would
		// surface the rejection as unhandled.
		await expect(promise).rejects.toMatch(/failed to open window/i)
	})

	it("concurrent openAndAwait calls settle independently", async () => {
		const a = manager.openAndAwait<string>({
			url: "a.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "a",
			placement: "top-right",
		})
		const b = manager.openAndAwait<string>({
			url: "b.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "b",
			placement: "top-right",
		})
		await flushCreate()

		manager.settle(a.handleId, "A result")
		manager.settle(b.handleId, "B result")

		await expect(a.promise).resolves.toBe("A result")
		await expect(b.promise).resolves.toBe("B result")
	})

	it("timeout is cleared on normal settle (no pending timers after)", async () => {
		const { handleId, promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()

		manager.settle(handleId, "done")
		await promise

		expect(clock.pendingCount).toBe(0)
	})

	it("detach: onRemoved after detach does not settle — subsequent settle wins", async () => {
		const { handleId, promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()

		// Simulate the approval path: detach before async work starts.
		manager.detach(handleId)

		// Popup closes while async work runs — must NOT settle the promise.
		fakeWindows.closeByUser(FIRST_WINDOW_ID)

		// Async work completes → settle wins.
		manager.settle(handleId, "exec result")

		await expect(promise).resolves.toBe("exec result")
	})

	it("detach: timeout after detach does not reject — subsequent settle wins", async () => {
		const { handleId, promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()

		manager.detach(handleId)

		// Advance well past the original timeout — must NOT fire.
		clock.advance(TIMEOUT_MS * 2)

		manager.settle(handleId, "late result")

		await expect(promise).resolves.toBe("late result")
	})

	it("a timeout during a slow create still closes the late-created window", async () => {
		// The timeout settles while windows.create is in flight: windowId is
		// still undefined, so _settle cannot remove anything — the create's own
		// continuation must clean up the window it just made, or a stray
		// approval popup lingers with no owner.
		const removeSpy = vi.spyOn(browser.windows, "remove")
		const realCreate = browser.windows.create.bind(browser.windows)
		let release!: () => void
		const parked = new Promise<void>((resolve) => {
			release = resolve
		})
		browser.windows.create = (async (opts: unknown) => {
			await parked
			return realCreate(opts as never)
		}) as typeof browser.windows.create

		const { promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		// Park AFTER creation starts: the timeout must land while create is in flight.
		await flushCreate()
		clock.advance(TIMEOUT_MS)
		await expect(promise).rejects.toMatch(/timed out/i)
		expect(removeSpy).not.toHaveBeenCalled()

		release()
		await flushCreate()
		await flushCreate()
		expect(removeSpy).toHaveBeenCalledWith(FIRST_WINDOW_ID)
	})

	it("a stale create cannot adopt a re-minted handle id (identity fence)", async () => {
		// After the original handle settles, its 8-hex id can be re-minted by a
		// NEWER request. The stale create's continuation must compare handle
		// OBJECTS, not map membership — and close its now-ownerless window.
		const removeSpy = vi.spyOn(browser.windows, "remove")
		const realCreate = browser.windows.create.bind(browser.windows)
		let release!: () => void
		const parked = new Promise<void>((resolve) => {
			release = resolve
		})
		browser.windows.create = (async (opts: unknown) => {
			await parked
			return realCreate(opts as never)
		}) as typeof browser.windows.create

		const { handleId, promise } = manager.openAndAwait<string>({
			url: "popup.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "test",
			placement: "top-right",
		})
		await flushCreate()
		clock.advance(TIMEOUT_MS)
		await expect(promise).rejects.toMatch(/timed out/i)

		const handles = (manager as unknown as { handles: Map<string, unknown> }).handles
		const impostor = { settled: false }
		handles.set(handleId, impostor)

		release()
		await flushCreate()
		await flushCreate()
		expect(removeSpy).toHaveBeenCalledWith(FIRST_WINDOW_ID)
		expect((impostor as { windowId?: number }).windowId).toBeUndefined()
		handles.delete(handleId)
	})

	describe("positioning on the last-focused window", () => {
		const OPTS = { url: "popup.html", width: 400, height: 800, timeoutMs: TIMEOUT_MS, kind: "test", placement: "top-right" as const }
		/** Test-only surface of FakeWindowsAdapter. */
		const fake = () => browser.windows as unknown as { lastFocused?: unknown; creates: Array<Record<string, unknown>> }
		const refused = () => new Error("Invalid value for bounds. Bounds must be at least 50% within visible screen space.")

		/** Park every `create` until released, then let it resolve through the fake or reject. */
		function parkCreates() {
			const realCreate = browser.windows.create.bind(browser.windows)
			const gates: Array<(outcome: Error | undefined) => void> = []
			const createSpy = vi.spyOn(browser.windows, "create").mockImplementation(
				(options) =>
					new Promise((resolve, reject) => {
						gates.push((outcome) => (outcome ? reject(outcome) : resolve(realCreate(options))))
					}),
			)
			return { createSpy, release: (index: number, outcome?: Error) => gates[index]?.(outcome) }
		}

		it("centers on the anchor, signed — a display left of the primary keeps its negative left", async () => {
			fake().lastFocused = { left: -1920, top: 0, width: 1920, height: 1080 }

			manager.openAndAwait<string>({ ...OPTS, placement: "center" })
			await flushCreate()

			expect(fake().creates[0]).toMatchObject({ type: "popup", width: 400, height: 800, left: -1160, top: 140 })
		})

		it("top-right: flush with the anchor's right edge and top, capped at the anchor's height", async () => {
			fake().lastFocused = { left: -1920, top: 30, width: 1920, height: 700 }

			manager.openAndAwait<string>(OPTS)
			await flushCreate()

			expect(fake().creates).toEqual([{ type: "popup", url: "popup.html", width: 400, height: 700, left: -400, top: 30 }])
		})

		it("center: a refused position is not retried and the handle fails", async () => {
			fake().lastFocused = { left: 0, top: 0, width: 1920, height: 1080 }
			const createSpy = vi.spyOn(browser.windows, "create").mockRejectedValueOnce(refused())

			const { promise } = manager.openAndAwait<string>({ ...OPTS, placement: "center" })

			await expect(promise).rejects.toBe("Failed to open window.")
			expect(createSpy).toHaveBeenCalledTimes(1)
		})

		it("top-right: a refused position opens the window with the size only and the handle resolves", async () => {
			fake().lastFocused = { left: 0, top: 0, width: 1920, height: 1080 }
			const removeSpy = vi.spyOn(browser.windows, "remove")
			const createSpy = vi.spyOn(browser.windows, "create").mockRejectedValueOnce(refused())

			const { handleId, promise } = manager.openAndAwait<string>(OPTS)
			await flushCreate()

			expect(createSpy.mock.calls.map(([options]) => options)).toEqual([
				{ type: "popup", url: "popup.html", width: 400, height: 800, left: 1520, top: 0 },
				{ type: "popup", url: "popup.html", width: 400, height: 800 },
			])
			manager.settle(handleId, "ok")
			await expect(promise).resolves.toBe("ok")
			expect(removeSpy).toHaveBeenCalledWith(FIRST_WINDOW_ID)
		})

		it("a handle cancelled during the first attempt gets no second create", async () => {
			fake().lastFocused = { left: 0, top: 0, width: 1920, height: 1080 }
			const { createSpy, release } = parkCreates()

			const { handleId, promise } = manager.openAndAwait<string>(OPTS)
			await flushCreate()
			manager.cancel(handleId, "cancelled")
			await expect(promise).rejects.toBe("cancelled")

			release(0, refused())
			await flushCreate()
			expect(createSpy).toHaveBeenCalledTimes(1)
		})

		it("a window arriving after cancellation is closed, and a rejected close is swallowed", async () => {
			const { release } = parkCreates()
			// Not a vi.fn: a spy observes the promises it returns, which would handle the rejection.
			const removed: number[] = []
			browser.windows.remove = (windowId: number) => {
				removed.push(windowId)
				return Promise.reject(new Error(`No window with id: ${windowId}.`))
			}

			const { handleId, promise } = manager.openAndAwait<string>(OPTS)
			await flushCreate()
			manager.cancel(handleId, "cancelled")
			await expect(promise).rejects.toBe("cancelled")

			release(0)
			await flushCreate()
			await flushCreate()
			expect(removed).toEqual([FIRST_WINDOW_ID])
		})

		it("a stale rejection leaves a re-minted handle with the same id untouched", async () => {
			const { release } = parkCreates()

			const { handleId, promise } = manager.openAndAwait<string>(OPTS)
			await flushCreate()
			clock.advance(TIMEOUT_MS)
			await expect(promise).rejects.toMatch(/timed out/i)

			const handles = (manager as unknown as { handles: Map<string, unknown> }).handles
			const impostor = {
				settled: false,
				windowId: undefined,
				unsubOnRemoved: null,
				timeoutHandle: null,
				resolve: vi.fn(),
				reject: vi.fn(),
			}
			handles.set(handleId, impostor)

			release(0, refused())
			await flushCreate()
			expect(handles.get(handleId)).toBe(impostor)
			expect(impostor.settled).toBe(false)
			expect(impostor.reject).not.toHaveBeenCalled()
			handles.delete(handleId)
		})

		it("a browser error carrying the window's URL reaches neither a log line nor the settle reason", async () => {
			const sentinels = ["moz-extension://4f1c", "verificationHash=0xfeedface", "requestId=9d3b7a"]
			const leak = () =>
				new Error(`Invalid bounds for ${sentinels[0]}/src/popup/index.html#/windows/verify?${sentinels[1]}&${sentinels[2]}`)
			const log = vi.fn()
			manager = new WindowManager(browser.windows, clock, { log } as unknown as ILogger)
			fake().lastFocused = { left: 0, top: 0, width: 1920, height: 1080 }
			const createSpy = vi.spyOn(browser.windows, "create").mockRejectedValueOnce(leak()).mockRejectedValueOnce(leak())

			const { promise } = manager.openAndAwait<string>(OPTS)
			const reason = await promise.catch((err: unknown) => err)

			expect(createSpy).toHaveBeenCalledTimes(2)
			expect(reason).toBe("Failed to open window.")
			const logged = log.mock.calls.flat().map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg)))
			for (const sentinel of sentinels) expect(logged.join("\n")).not.toContain(sentinel)
		})

		it("no last-focused window → create carries no left/top (Chrome picks)", async () => {
			manager.openAndAwait<string>(OPTS)
			await flushCreate()

			expect(fake().creates[0]).not.toHaveProperty("left")
			expect(fake().creates[0]).not.toHaveProperty("top")
		})

		it("a timeout during the bounds lookup skips create entirely", async () => {
			const createSpy = vi.spyOn(browser.windows, "create")
			let release!: () => void
			browser.windows.getLastFocused = () =>
				new Promise((resolve) => {
					release = () => resolve(undefined)
				})

			const { handleId, promise } = manager.openAndAwait<string>(OPTS)
			clock.advance(TIMEOUT_MS)
			await expect(promise).rejects.toMatch(/timed out/i)

			// A re-minted handle under the same id must not be adopted by the
			// stale lookup either (identity, not membership).
			const handles = (manager as unknown as { handles: Map<string, unknown> }).handles
			const impostor = { settled: false }
			handles.set(handleId, impostor)

			release()
			await flushCreate()
			expect(createSpy).not.toHaveBeenCalled()
			expect(impostor).toEqual({ settled: false })
			handles.delete(handleId)
		})
	})

	describe("focus", () => {
		const OPTS = { url: "popup.html", width: 400, height: 800, timeoutMs: TIMEOUT_MS, kind: "test", placement: "top-right" as const }
		const updates = () => (browser.windows as unknown as { updates: unknown[] }).updates

		it("a live handle → update(focused + drawAttention + state normal) and true", async () => {
			const { handleId } = manager.openAndAwait<string>(OPTS)
			await flushCreate()

			await expect(manager.focus(handleId)).resolves.toBe(true)
			expect(updates()).toEqual([{ windowId: FIRST_WINDOW_ID, options: { focused: true, drawAttention: true, state: "normal" } }])
		})

		it("an unknown handle → false, no update", async () => {
			await expect(manager.focus("nope")).resolves.toBe(false)
			expect(updates()).toEqual([])
		})

		it("a rejecting update (window closed underneath) → false", async () => {
			const { handleId } = manager.openAndAwait<string>(OPTS)
			await flushCreate()
			vi.spyOn(browser.windows, "update").mockRejectedValueOnce(new Error("No window with id"))

			await expect(manager.focus(handleId)).resolves.toBe(false)
		})
	})
})

describe("centerOn", () => {
	it("centers on a positive anchor, rounding half-pixels", () => {
		expect(centerOn({ left: 100, top: 50, width: 1001, height: 601 }, 400, 800)).toEqual({ left: 401, top: -49 })
	})

	it("keeps signed coordinates on an anchor left of / above the primary display", () => {
		expect(centerOn({ left: -1920, top: -1080, width: 1920, height: 1080 }, 400, 800)).toEqual({ left: -1160, top: -940 })
	})

	it("missing anchor or any missing bound → {} so Chrome picks", () => {
		expect(centerOn(undefined, 400, 800)).toEqual({})
		expect(centerOn({ left: 0, top: 0, width: 1920 }, 400, 800)).toEqual({})
	})
})

describe("topRightOf", () => {
	it("puts the window's right edge on the anchor's and its top on the anchor's top", () => {
		expect(topRightOf({ left: 100, top: 50, width: 1200, height: 900 }, 400, 800)).toEqual({ left: 900, top: 50, height: 800 })
	})

	it("keeps signed coordinates on an anchor left of / above the primary display", () => {
		expect(topRightOf({ left: -1920, top: -1080, width: 1920, height: 1080 }, 400, 800)).toEqual({
			left: -400,
			top: -1080,
			height: 800,
		})
	})

	it("caps the height at a short anchor's and leaves it alone under a tall one", () => {
		expect(topRightOf({ left: 0, top: 0, width: 1000, height: 600 }, 400, 800).height).toBe(600)
		expect(topRightOf({ left: 0, top: 0, width: 1000, height: 1400 }, 400, 800).height).toBe(800)
	})

	it("missing anchor or any missing bound → no position, the requested height", () => {
		expect(topRightOf(undefined, 400, 800)).toEqual({ height: 800 })
		expect(topRightOf({ left: 0, top: 0, width: 1920 }, 400, 800)).toEqual({ height: 800 })
	})
})

describe("createPlaced", () => {
	const PLACED = { type: "popup" as const, url: "popup.html", width: 400, height: 700, left: -400, top: 30 }
	const SIZE_ONLY = { type: "popup" as const, url: "popup.html", width: 400, height: 700 }

	function setup(outcomes: Array<Error | number>) {
		const create = vi.fn(async (_options: unknown) => {
			const outcome = outcomes.shift()
			if (outcome instanceof Error) throw outcome
			return { id: outcome }
		})
		const log = vi.fn()
		return { create, log, logger: { log } as unknown as ILogger }
	}

	it("retries a refused position once without left/top, everything else identical", async () => {
		const { create, logger } = setup([new Error("bounds refused"), 7])

		await expect(createPlaced({ create }, PLACED, () => true, logger, "src")).resolves.toEqual({ id: 7 })
		expect(create.mock.calls).toEqual([[PLACED], [SIZE_ONLY]])
	})

	it("logs the recovered refusal as one constant debug line", async () => {
		const { create, log, logger } = setup([new Error("bounds refused for chrome-extension://abc"), 7])

		await createPlaced({ create }, PLACED, () => true, logger, "src")
		expect(log.mock.calls).toEqual([["src", LogLevel.Debug, "window position refused; opened with the size only"]])
	})

	it("never retries a size-only create", async () => {
		const refusal = new Error("refused")
		const { create, log, logger } = setup([refusal, 7])

		await expect(createPlaced({ create }, SIZE_ONLY, () => true, logger, "src")).rejects.toBe(refusal)
		expect(create).toHaveBeenCalledTimes(1)
		expect(log).not.toHaveBeenCalled()
	})

	it("no retry once stillWanted() is false", async () => {
		const refusal = new Error("refused")
		const { create, logger } = setup([refusal, 7])

		await expect(createPlaced({ create }, PLACED, () => false, logger, "src")).rejects.toBe(refusal)
		expect(create).toHaveBeenCalledTimes(1)
	})

	it("a second refusal propagates", async () => {
		const second = new Error("still refused")
		const { create, log, logger } = setup([new Error("refused"), second])

		await expect(createPlaced({ create }, PLACED, () => true, logger, "src")).rejects.toBe(second)
		expect(create).toHaveBeenCalledTimes(2)
		expect(log).not.toHaveBeenCalled()
	})
})
