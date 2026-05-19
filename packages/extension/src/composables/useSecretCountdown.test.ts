import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { effectScope, nextTick } from "vue"
import { useSecretCountdown } from "./useSecretCountdown"

describe("composables/useSecretCountdown", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("initial state: deadline 0, label empty, not disabled", () => {
		const scope = effectScope()
		scope.run(() => {
			const c = useSecretCountdown({ autoCloseMs: 60_000, onTimeout: () => {} })
			expect(c.closeDeadline.value).toBe(0)
			expect(c.countdownLabel.value).toBe("")
			expect(c.isAutoCloseDisabled.value).toBe(false)
		})
		scope.stop()
	})

	test("start() sets deadline = now + autoCloseMs", () => {
		const fixedNow = 1_700_000_000_000
		vi.setSystemTime(fixedNow)
		const scope = effectScope()
		scope.run(() => {
			const c = useSecretCountdown({ autoCloseMs: 120_000, onTimeout: () => {} })
			c.start()
			expect(c.closeDeadline.value).toBe(fixedNow + 120_000)
		})
		scope.stop()
	})

	test("countdownLabel formats remaining time as M:SS after start()", async () => {
		vi.setSystemTime(1_700_000_000_000)
		const scope = effectScope()
		scope.run(() => {
			const c = useSecretCountdown({ autoCloseMs: 120_000, onTimeout: () => {} })
			c.start()
			expect(c.countdownLabel.value).toBe("2:00")
		})
		scope.stop()
	})

	test("countdownLabel updates as time advances", async () => {
		vi.setSystemTime(1_700_000_000_000)
		const scope = effectScope()
		await scope.run(async () => {
			const c = useSecretCountdown({ autoCloseMs: 120_000, onTimeout: () => {} })
			c.start()
			expect(c.countdownLabel.value).toBe("2:00")
			vi.advanceTimersByTime(60_000)
			await nextTick()
			expect(c.countdownLabel.value).toBe("1:00")
		})
		scope.stop()
	})

	test("onTimeout fires after autoCloseMs elapses", () => {
		const onTimeout = vi.fn()
		const scope = effectScope()
		scope.run(() => {
			const c = useSecretCountdown({ autoCloseMs: 120_000, onTimeout })
			c.start()
			vi.advanceTimersByTime(120_000)
		})
		expect(onTimeout).toHaveBeenCalledTimes(1)
		scope.stop()
	})

	test("disable() clears the deadline, flips flag, and prevents onTimeout firing", () => {
		const onTimeout = vi.fn()
		const scope = effectScope()
		scope.run(() => {
			const c = useSecretCountdown({ autoCloseMs: 120_000, onTimeout })
			c.start()
			c.disable()
			expect(c.isAutoCloseDisabled.value).toBe(true)
			expect(c.closeDeadline.value).toBe(0)
			vi.advanceTimersByTime(120_000)
		})
		expect(onTimeout).not.toHaveBeenCalled()
		scope.stop()
	})

	test("clear() prevents onTimeout firing without flipping disabled flag", () => {
		const onTimeout = vi.fn()
		const scope = effectScope()
		scope.run(() => {
			const c = useSecretCountdown({ autoCloseMs: 120_000, onTimeout })
			c.start()
			c.clear()
			vi.advanceTimersByTime(120_000)
			expect(c.isAutoCloseDisabled.value).toBe(false)
		})
		expect(onTimeout).not.toHaveBeenCalled()
		scope.stop()
	})

	test("scope dispose clears pending timeout", () => {
		const onTimeout = vi.fn()
		const scope = effectScope()
		scope.run(() => {
			const c = useSecretCountdown({ autoCloseMs: 120_000, onTimeout })
			c.start()
		})
		scope.stop()
		vi.advanceTimersByTime(120_000)
		expect(onTimeout).not.toHaveBeenCalled()
	})

	test("countdownLabel returns '0:00' once deadline is reached", async () => {
		vi.setSystemTime(1_700_000_000_000)
		const scope = effectScope()
		await scope.run(async () => {
			const c = useSecretCountdown({ autoCloseMs: 60_000, onTimeout: () => {} })
			c.start()
			vi.advanceTimersByTime(60_000)
			await nextTick()
			expect(c.countdownLabel.value).toBe("0:00")
		})
		scope.stop()
	})

	test("label pads single-digit seconds", async () => {
		vi.setSystemTime(1_700_000_000_000)
		const scope = effectScope()
		await scope.run(async () => {
			const c = useSecretCountdown({ autoCloseMs: 65_000, onTimeout: () => {} })
			c.start()
			expect(c.countdownLabel.value).toBe("1:05")
		})
		scope.stop()
	})
})
