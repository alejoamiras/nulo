import { describe, expect, test } from "vitest"
import {
	AccountAddressInconsistencyError,
	RestoreTornError,
	CapabilityNotGrantedError,
	CLIENT_DISCONNECTED_MESSAGE,
	InvalidPasswordError,
	isClientDisconnectRejection,
	JobCancelledError,
	ProfileIdConflictError,
	remoteErrorFromResponseContent,
	RpcDisconnectedError,
	RpcTimeoutError,
	TooManyPendingError,
	UserRejectedError,
	ValidationError,
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

	test("RestoreTornError round-trips with code + details preserved", () => {
		// auth.vue routes to the torn-import explanation via `instanceof`; a
		// dropped dispatch case would flatten it to a generic unlock failure.
		const original = new RestoreTornError(undefined, { profileId: "p1" })
		const rebuilt = walletErrorFromPayload(original.toPayload())
		expect(rebuilt).toBeInstanceOf(RestoreTornError)
		expect(rebuilt).toBeInstanceOf(WalletError)
		expect(rebuilt.code).toBe(RestoreTornError.CODE)
		expect(rebuilt.message).toBe("This profile's import didn't finish")
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

describe("constructor identity ritual (owned by the WalletError base)", () => {
	// Every subclass ctor is a pure `super(...)` call: the base assigns the frozen
	// literal name (passed as the 4th argument — never `new.target.name`, the
	// production minifier mangles class names) and restores `new.target.prototype`.
	// The sweep proves the base-owned ritual covers every subclass; a future
	// subclass that forgets the name argument degrades cosmetically to
	// "WalletError", while `instanceof` breakage is structurally impossible.
	const instances: Array<{ err: WalletError; ctor: new (...args: never[]) => WalletError; name: string; code: string }> = [
		{ err: new RpcTimeoutError("t"), ctor: RpcTimeoutError, name: "RpcTimeoutError", code: RpcTimeoutError.CODE },
		{ err: new RpcDisconnectedError("d"), ctor: RpcDisconnectedError, name: "RpcDisconnectedError", code: RpcDisconnectedError.CODE },
		{ err: new UserRejectedError(), ctor: UserRejectedError, name: "UserRejectedError", code: UserRejectedError.CODE },
		{ err: new JobCancelledError(), ctor: JobCancelledError, name: "JobCancelledError", code: JobCancelledError.CODE },
		{
			err: new CapabilityNotGrantedError("accounts"),
			ctor: CapabilityNotGrantedError,
			name: "CapabilityNotGrantedError",
			code: CapabilityNotGrantedError.CODE,
		},
		{ err: new TooManyPendingError(), ctor: TooManyPendingError, name: "TooManyPendingError", code: TooManyPendingError.CODE },
		{ err: new ValidationError("v"), ctor: ValidationError, name: "ValidationError", code: ValidationError.CODE },
		{ err: new InvalidPasswordError(), ctor: InvalidPasswordError, name: "InvalidPasswordError", code: InvalidPasswordError.CODE },
		{
			err: new AccountAddressInconsistencyError(),
			ctor: AccountAddressInconsistencyError,
			name: "AccountAddressInconsistencyError",
			code: AccountAddressInconsistencyError.CODE,
		},
		{ err: new RestoreTornError(), ctor: RestoreTornError, name: "RestoreTornError", code: RestoreTornError.CODE },
		{
			err: new ProfileIdConflictError(),
			ctor: ProfileIdConflictError,
			name: "ProfileIdConflictError",
			code: ProfileIdConflictError.CODE,
		},
	]

	test("all 11 subclasses: exact prototype, literal name, and code on direct construction", () => {
		for (const { err, ctor, name, code } of instances) {
			expect(Object.getPrototypeOf(err)).toBe(ctor.prototype)
			expect(err).toBeInstanceOf(WalletError)
			expect(err.name).toBe(name)
			expect(err.code).toBe(code)
		}
	})

	test("the 10 switch-covered codes round-trip to the exact subclass with name intact", () => {
		for (const { err, ctor, name } of instances) {
			if (ctor === TooManyPendingError) continue // see BUG PIN below
			const rebuilt = walletErrorFromPayload(err.toPayload())
			expect(Object.getPrototypeOf(rebuilt)).toBe(ctor.prototype)
			expect(rebuilt.name).toBe(name)
			expect(rebuilt.code).toBe(err.code)
			expect(rebuilt.message).toBe(err.message)
		}
	})

	test("(BUG PIN) TOO_MANY_PENDING reconstructs as base WalletError, not TooManyPendingError", () => {
		// `TooManyPendingError` is absent from `KnownWalletErrorPayload` and the
		// `walletErrorFromPayload` switch, so it falls to the default arm — a
		// client-side `instanceof TooManyPendingError` check would not survive the
		// wire today. Preserved verbatim (adding the arm is a behavior change);
		// tracked as an owner follow-up in the dedup-remediation report.
		const rebuilt = walletErrorFromPayload(new TooManyPendingError().toPayload())
		expect(rebuilt.constructor).toBe(WalletError)
		expect(rebuilt).not.toBeInstanceOf(TooManyPendingError)
		expect(rebuilt.code).toBe(TooManyPendingError.CODE)
		expect(rebuilt.message).toBe("Too many pending transactions; retry after the in-flight ones settle.")
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
