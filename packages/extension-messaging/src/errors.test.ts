import { describe, expect, test } from "vitest"
import { JobCancelledError, UserRejectedError, WalletError, walletErrorFromPayload } from "./errors"

describe("walletErrorFromPayload", () => {
	test("JobCancelledError round-trips with code + jobId preserved", () => {
		// The popup-side `instanceof JobCancelledError` check depends on this.
		// Regression pin: if the dispatch table case is ever removed, the
		// classifier in `popup/utils/cancellable-rejection.ts` silently degrades
		// to "toast" for every cancel — and the wrong-toast UX bug returns.
		const original = new JobCancelledError("Transaction cancelled by user", { jobId: "abc-123" })
		const payload = original.toPayload()
		const rebuilt = walletErrorFromPayload(payload)

		expect(rebuilt).toBeInstanceOf(JobCancelledError)
		expect(rebuilt).toBeInstanceOf(WalletError)
		expect(rebuilt.code).toBe(JobCancelledError.CODE)
		expect(rebuilt.message).toBe("Transaction cancelled by user")
		expect((rebuilt.details as { jobId?: string })?.jobId).toBe("abc-123")
	})

	test("JobCancelledError default message is used when no message supplied", () => {
		const err = new JobCancelledError()
		expect(err.message).toBe("Transaction cancelled by user")
	})

	test("UserRejectedError still round-trips (regression — symmetric class neighbor)", () => {
		const original = new UserRejectedError()
		const rebuilt = walletErrorFromPayload(original.toPayload())
		expect(rebuilt).toBeInstanceOf(UserRejectedError)
	})
})
