import { describe, expect, test } from "vitest"
import {
	AccountAddressInconsistencyError,
	CapabilityNotGrantedError,
	CLIENT_DISCONNECTED_MESSAGE,
	isClientDisconnectRejection,
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

	test("AccountAddressInconsistencyError round-trips with code + details preserved", () => {
		// The popup routes to the integrity blocking state via `instanceof`; a dropped
		// dispatch case would silently degrade the mismatch to a generic error.
		const original = new AccountAddressInconsistencyError(undefined, { profileId: "p1", chainId: 0 })
		const rebuilt = walletErrorFromPayload(original.toPayload())
		expect(rebuilt).toBeInstanceOf(AccountAddressInconsistencyError)
		expect(rebuilt).toBeInstanceOf(WalletError)
		expect(rebuilt.code).toBe(AccountAddressInconsistencyError.CODE)
		expect(rebuilt.message).toBe("Account address inconsistency")
		expect((rebuilt.details as { profileId?: string })?.profileId).toBe("p1")
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

	test("unknown code → base WalletError, code + message preserved (default arm)", () => {
		const rebuilt = walletErrorFromPayload({ code: "SOME_FUTURE_CODE", message: "hi", details: { x: 1 } })
		expect(rebuilt).toBeInstanceOf(WalletError)
		expect(rebuilt.constructor).toBe(WalletError) // base, not a subclass
		expect(rebuilt.code).toBe("SOME_FUTURE_CODE")
		expect(rebuilt.message).toBe("hi")
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

describe("isClientDisconnectRejection", () => {
	test("matches the exact teardown rejection both transports emit", () => {
		expect(isClientDisconnectRejection(new Error(CLIENT_DISCONNECTED_MESSAGE))).toBe(true)
	})

	test("does not match other errors, non-Errors, or message-shaped strings", () => {
		expect(isClientDisconnectRejection(new Error("port disconnected"))).toBe(false)
		expect(isClientDisconnectRejection(CLIENT_DISCONNECTED_MESSAGE)).toBe(false)
		expect(isClientDisconnectRejection(undefined)).toBe(false)
		expect(isClientDisconnectRejection({ message: CLIENT_DISCONNECTED_MESSAGE })).toBe(false)
	})
})
