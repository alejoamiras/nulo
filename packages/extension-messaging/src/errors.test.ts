import { describe, expect, test } from "vitest"
import {
	CapabilityNotGrantedError,
	JobCancelledError,
	remoteErrorFromResponseContent,
	UserRejectedError,
	WalletError,
	walletErrorFromPayload,
} from "./errors"

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

	test("CapabilityNotGrantedError round-trips with capabilityType + exact stable message", () => {
		// Stable-message contract: dApp authors substring-match on the literal
		// "Call requestCapabilities() first." Changing this wording silently
		// breaks any consumer that relies on it; the assertion below pins it.
		const original = new CapabilityNotGrantedError("accounts")
		expect(original.message).toBe("accounts capability not granted. Call requestCapabilities() first.")

		const rebuilt = walletErrorFromPayload(original.toPayload())
		expect(rebuilt).toBeInstanceOf(CapabilityNotGrantedError)
		expect(rebuilt).toBeInstanceOf(WalletError)
		expect(rebuilt.code).toBe(CapabilityNotGrantedError.CODE)
		expect(rebuilt.message).toBe(original.message)
		expect((rebuilt.details as { capabilityType?: string })?.capabilityType).toBe("accounts")
	})
})

describe("remoteErrorFromResponseContent", () => {
	// Pins the extraction shared by the background + offscreen clients' makeRemoteError.
	test("structured errorPayload → typed WalletError subclass (instanceof survives the boundary)", () => {
		const rebuilt = remoteErrorFromResponseContent({ errorPayload: new UserRejectedError().toPayload() })
		expect(rebuilt).toBeInstanceOf(UserRejectedError)
		expect(rebuilt).toBeInstanceOf(WalletError)
	})

	test("unknown code → base WalletError with the code preserved", () => {
		const rebuilt = remoteErrorFromResponseContent({ errorPayload: { code: "WEIRD", message: "huh" } })
		expect(rebuilt).toBeInstanceOf(WalletError)
		expect((rebuilt as WalletError).code).toBe("WEIRD")
		expect(rebuilt.message).toBe("huh")
	})

	test("no errorPayload, flat error string → plain Error (NOT a WalletError)", () => {
		const rebuilt = remoteErrorFromResponseContent({ error: "boom" })
		expect(rebuilt).toBeInstanceOf(Error)
		expect(rebuilt).not.toBeInstanceOf(WalletError)
		expect(rebuilt.message).toBe("boom")
	})

	test("neither payload nor message → Error('Unknown error')", () => {
		expect(remoteErrorFromResponseContent({}).message).toBe("Unknown error")
	})
})
