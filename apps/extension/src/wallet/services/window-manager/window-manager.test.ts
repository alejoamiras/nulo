import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeBrowserApi, MockClock } from "@nulo/wallet-core/testing"
import type { ILogger } from "@/wallet/logger"
import { centerOn, WindowManager } from "./window-manager"

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
		})
		const b = manager.openAndAwait<string>({
			url: "b.html",
			width: 400,
			height: 600,
			timeoutMs: TIMEOUT_MS,
			kind: "b",
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
		const OPTS = { url: "popup.html", width: 400, height: 800, timeoutMs: TIMEOUT_MS, kind: "test" }
		/** Test-only surface of FakeWindowsAdapter. */
		const fake = () => browser.windows as unknown as { lastFocused?: unknown; creates: Array<Record<string, unknown>> }

		it("centers on the anchor, signed — a display left of the primary keeps its negative left", async () => {
			fake().lastFocused = { left: -1920, top: 0, width: 1920, height: 1080 }

			manager.openAndAwait<string>(OPTS)
			await flushCreate()

			expect(fake().creates[0]).toMatchObject({ type: "popup", width: 400, height: 800, left: -1160, top: 140 })
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
		const OPTS = { url: "popup.html", width: 400, height: 800, timeoutMs: TIMEOUT_MS, kind: "test" }
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
