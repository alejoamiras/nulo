import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeBrowserApi, MockClock } from "@nulo/wallet-core/testing"
import type { ILogger } from "@/wallet/logger"
import { WindowManager } from "./window-manager"

const TIMEOUT_MS = 5_000

const nullLogger: ILogger = { log: () => {} } as unknown as ILogger

/** First window created per test always gets id 1000 (FakeBrowserApi resets on new instance). */
const FIRST_WINDOW_ID = 1000

/** Two-tick flush so the async windows.create().then() handler runs. */
async function flushCreate(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
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
		await flushCreate()

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
})
