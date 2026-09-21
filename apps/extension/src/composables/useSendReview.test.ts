import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { effectScope, ref } from "vue"
import { REVIEW_ARM_MS, useSendReview } from "./useSendReview"

function setup(initial: { gated: boolean; open?: boolean }) {
	const gated = ref(initial.gated)
	const open = ref(initial.open ?? false)
	const top = ref(true)
	/** Reads recomputed without changing must not restart the wait; this counts as such a read. */
	const noise = ref(0)
	const scope = effectScope()
	const review = scope.run(() =>
		useSendReview({
			isGated: () => {
				noise.value
				return gated.value
			},
			isOpen: () => open.value,
			isTop: () => top.value,
		}),
	)
	if (!review) throw new Error("scope did not run")
	return { gated, open, top, noise, scope, review }
}

describe("composables/useSendReview", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	test.each([true, false])("closed (gated: %s): not ready, and nothing is authorised", (gated) => {
		const { review } = setup({ gated })
		expect(review.ready.value).toBe(false)
		expect(review.authorises("review")).toBe(false)
		expect(review.authorises("primary")).toBe(false)
	})

	test("gated: not ready until the full wait has passed", () => {
		const { open, review } = setup({ gated: true })
		open.value = true
		expect(review.ready.value).toBe(false)
		vi.advanceTimersByTime(REVIEW_ARM_MS - 1)
		expect(review.ready.value).toBe(false)
		expect(review.authorises("review")).toBe(false)
		vi.advanceTimersByTime(1)
		expect(review.ready.value).toBe(true)
		expect(review.authorises("review")).toBe(true)
	})

	test("not gated: ready the moment the sheet opens", () => {
		const { open, review } = setup({ gated: false })
		open.value = true
		expect(review.ready.value).toBe(true)
		expect(review.authorises("review")).toBe(true)
	})

	test("the primary button never authorises, even with the sheet open and ready", () => {
		const { open, review } = setup({ gated: true })
		open.value = true
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		expect(review.authorises("primary")).toBe(false)
	})

	test("a sheet already open when the composable starts is armed like any other", () => {
		const { review } = setup({ gated: true, open: true })
		expect(review.ready.value).toBe(false)
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		expect(review.ready.value).toBe(true)
	})

	test("turning gated while open drops ready in the same tick and starts the wait again", () => {
		const { gated, open, review } = setup({ gated: false })
		open.value = true
		gated.value = true
		expect(review.ready.value).toBe(false)
		expect(review.authorises("review")).toBe(false)
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		expect(review.authorises("review")).toBe(true)
	})

	test("no longer gated while open: ready at once, and the pending wait is dropped", () => {
		const { gated, open, review } = setup({ gated: true })
		open.value = true
		vi.advanceTimersByTime(100)
		gated.value = false
		expect(review.ready.value).toBe(true)
		expect(vi.getTimerCount()).toBe(0)
	})

	test("a reading recomputed to the same answer does not restart the wait", () => {
		const { noise, open, review } = setup({ gated: true })
		open.value = true
		vi.advanceTimersByTime(REVIEW_ARM_MS - 1)
		noise.value++
		vi.advanceTimersByTime(1)
		expect(review.ready.value).toBe(true)
		noise.value++
		expect(review.ready.value).toBe(true)
	})

	test("closing drops ready; a stale sheet authorises nothing even after the wait has elapsed", () => {
		const { open, review } = setup({ gated: true })
		open.value = true
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		open.value = false
		expect(review.ready.value).toBe(false)
		expect(review.authorises("review")).toBe(false)
	})

	test("closing mid-wait cancels it, and reopening waits the full time again", () => {
		const { open, review } = setup({ gated: true })
		open.value = true
		vi.advanceTimersByTime(REVIEW_ARM_MS - 1)
		open.value = false
		expect(vi.getTimerCount()).toBe(0)
		open.value = true
		vi.advanceTimersByTime(REVIEW_ARM_MS - 1)
		expect(review.ready.value).toBe(false)
		vi.advanceTimersByTime(1)
		expect(review.ready.value).toBe(true)
	})

	test("covered by a newer popup: ready drops in the same tick; back on top, a gated sheet waits the full time again", () => {
		const { open, top, review } = setup({ gated: true })
		open.value = true
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		expect(review.ready.value).toBe(true)

		top.value = false
		expect(review.ready.value).toBe(false)
		expect(review.authorises("review")).toBe(false)
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		expect(review.ready.value).toBe(false)

		top.value = true
		vi.advanceTimersByTime(REVIEW_ARM_MS - 1)
		expect(review.ready.value).toBe(false)
		vi.advanceTimersByTime(1)
		expect(review.ready.value).toBe(true)
	})

	test("not gated: ready follows the top slot", () => {
		const { open, top, review } = setup({ gated: false })
		open.value = true
		expect(review.ready.value).toBe(true)
		top.value = false
		expect(review.ready.value).toBe(false)
		top.value = true
		expect(review.ready.value).toBe(true)
	})

	test("disposing the scope clears the pending wait", () => {
		const { open, scope, review } = setup({ gated: true })
		open.value = true
		expect(vi.getTimerCount()).toBe(1)
		scope.stop()
		expect(vi.getTimerCount()).toBe(0)
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		expect(review.ready.value).toBe(false)
	})
})
