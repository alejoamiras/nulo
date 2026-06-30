import { describe, expect, test } from "vitest"
import { JobCancelledError } from "@nulo/extension-messaging/errors"
import { classifyCancellableRejection } from "./cancellable-rejection"

describe("classifyCancellableRejection", () => {
	test("JobCancelledError → silent (user intentionally cancelled)", () => {
		// Pin: if the classifier ever stops recognising this class, every
		// popup catch falls back to the failure toast — the exact UX bug
		// we shipped this whole architecture to fix.
		expect(classifyCancellableRejection(new JobCancelledError())).toBe("silent")
	})

	test("generic Error → toast (real failure)", () => {
		expect(classifyCancellableRejection(new Error("simulation failed"))).toBe("toast")
	})

	test("null / undefined → toast (defensive; can't suppress an unknown signal)", () => {
		expect(classifyCancellableRejection(null)).toBe("toast")
		expect(classifyCancellableRejection(undefined)).toBe("toast")
	})
})
