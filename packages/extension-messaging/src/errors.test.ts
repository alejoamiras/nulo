import { describe, expect, test } from "vitest"
import {
	AccountAddressInconsistencyError,
	ChainNotSupportedError,
	DuplicateWalletError,
	RecoveryModeError,
	RestoreTornError,
	CapabilityNotGrantedError,
	CLIENT_DISCONNECTED_MESSAGE,
	ContractNotRegisteredError,
	DuplicateInitializationError,
	InvalidPasswordError,
	isClientDisconnectRejection,
	isReceiverGoneRejection,
	RECEIVER_GONE_MESSAGE,
	JobCancelledError,
	OperationNotRecordedError,
	ProfileIdConflictError,
	PxeStaleAnchorError,
	PxeStoreKeyMissingError,
	remoteErrorFromResponseContent,
	RpcConnectError,
	RpcDisconnectedError,
	RpcTimeoutError,
	ScopeViolationError,
	SessionEndedError,
	TermsAcceptanceRequiredError,
	TooManyPendingError,
	UnsupportedMethodError,
	UserRejectedError,
	ValidationError,
	WalletError,
	type WalletErrorPayload,
	walletErrorFromPayload,
} from "./errors"
import * as errorsModule from "./errors"

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

	test("RecoveryModeError round-trips with its recovery sentence intact", () => {
		// The PXE client and the profile service throw it in the SW; the popup keys the recovery
		// banner and the export flow's loss warning on `instanceof`, and the sentence IS the surface.
		const rebuilt = walletErrorFromPayload(new RecoveryModeError().toPayload())
		expect(rebuilt).toBeInstanceOf(RecoveryModeError)
		expect(rebuilt.code).toBe(RecoveryModeError.CODE)
		expect(rebuilt.message).toBe("Wallet keys need recovery. Export a backup and restore it")
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

	test("DuplicateWalletError round-trips with code + existingProfileName preserved", () => {
		// The dup-guard confirm-retry UX hinges on `instanceof` surviving the RPC boundary; a
		// missing dispatch case flattens it to a generic Error and the dialog never shows.
		const original = new DuplicateWalletError(undefined, { existingProfileName: "Main Profile" })
		const rebuilt = walletErrorFromPayload(original.toPayload())
		expect(rebuilt).toBeInstanceOf(DuplicateWalletError)
		expect(rebuilt).toBeInstanceOf(WalletError)
		expect(rebuilt.code).toBe(DuplicateWalletError.CODE)
		expect(rebuilt.message).toBe("A profile with this recovery phrase already exists")
		expect((rebuilt.details as { existingProfileName?: string })?.existingProfileName).toBe("Main Profile")
	})
})

describe("every WalletError subclass: identity and wire shape", () => {
	// The base assigns the literal name passed as `super`'s 4th argument (never `new.target.name`:
	// the production minifier mangles class names) and restores `new.target.prototype`. Every
	// expected value below is written out, never read off the classes or the rebuild path.
	type Rebuild =
		| { kind: "pass" } // message and details as sent
		| { kind: "drop-details" } // message as sent, no details
		| { kind: "constant"; message: string } // neither: the class's own sentence
		| { kind: "capability" } // see the capabilityType table
		| { kind: "base" } // not rebuilt: a plain WalletError keeps code, message and details
	type Ctor = new (...args: never[]) => WalletError
	type Row = { ctor: Ctor; make: () => WalletError; name: string; code: string; rebuild: Rebuild }
	type Expected = { ctor: Ctor; name: string; message: string; details: unknown }

	const pass: Rebuild = { kind: "pass" }
	const base: Rebuild = { kind: "base" }
	const rows: Row[] = [
		{ ctor: RpcTimeoutError, make: () => new RpcTimeoutError("t"), name: "RpcTimeoutError", code: "RPC_TIMEOUT", rebuild: pass },
		{
			ctor: RpcDisconnectedError,
			make: () => new RpcDisconnectedError("d"),
			name: "RpcDisconnectedError",
			code: "RPC_DISCONNECTED",
			rebuild: pass,
		},
		// Client-local: never crosses the wire.
		{
			ctor: RpcConnectError,
			make: () => new RpcConnectError("svc", new Error("gone")),
			name: "RpcConnectError",
			code: "RPC_CONNECT_FAILED",
			rebuild: base,
		},
		{ ctor: UserRejectedError, make: () => new UserRejectedError(), name: "UserRejectedError", code: "USER_REJECTED", rebuild: pass },
		{ ctor: JobCancelledError, make: () => new JobCancelledError(), name: "JobCancelledError", code: "JOB_CANCELLED", rebuild: pass },
		{
			ctor: CapabilityNotGrantedError,
			make: () => new CapabilityNotGrantedError("accounts"),
			name: "CapabilityNotGrantedError",
			code: "CAPABILITY_NOT_GRANTED",
			rebuild: { kind: "capability" },
		},
		{
			ctor: ScopeViolationError,
			make: () => new ScopeViolationError("s"),
			name: "ScopeViolationError",
			code: "SCOPE_VIOLATION",
			rebuild: { kind: "drop-details" },
		},
		{
			ctor: TooManyPendingError,
			make: () => new TooManyPendingError(),
			name: "TooManyPendingError",
			code: "TOO_MANY_PENDING",
			rebuild: base,
		},
		{
			ctor: DuplicateInitializationError,
			make: () => new DuplicateInitializationError(),
			name: "DuplicateInitializationError",
			code: "DUPLICATE_INITIALIZATION",
			rebuild: pass,
		},
		{
			ctor: UnsupportedMethodError,
			make: () => UnsupportedMethodError.forMethod("m"),
			name: "UnsupportedMethodError",
			code: "UNSUPPORTED_METHOD",
			rebuild: pass,
		},
		{
			ctor: PxeStaleAnchorError,
			make: () => new PxeStaleAnchorError("s"),
			name: "PxeStaleAnchorError",
			code: "PXE_STALE_ANCHOR",
			rebuild: pass,
		},
		{
			ctor: ContractNotRegisteredError,
			make: () => new ContractNotRegisteredError("Contract not found"),
			name: "ContractNotRegisteredError",
			code: "CONTRACT_NOT_REGISTERED",
			rebuild: pass,
		},
		{
			ctor: ChainNotSupportedError,
			make: () => new ChainNotSupportedError(),
			name: "ChainNotSupportedError",
			code: "CHAIN_NOT_SUPPORTED",
			rebuild: {
				kind: "constant",
				message: "The wallet has no network for the requested chain. Switch the app to a network the wallet uses.",
			},
		},
		{
			ctor: PxeStoreKeyMissingError,
			make: () => new PxeStoreKeyMissingError("PXE_STORE_KEY_MISSING: p1"),
			name: "PxeStoreKeyMissingError",
			code: "PXE_STORE_KEY_MISSING",
			rebuild: pass,
		},
		{
			ctor: TermsAcceptanceRequiredError,
			make: () => new TermsAcceptanceRequiredError(),
			name: "TermsAcceptanceRequiredError",
			code: "TERMS_ACCEPTANCE_REQUIRED",
			rebuild: { kind: "constant", message: "Open Nulo and accept the Terms to continue." },
		},
		{
			ctor: SessionEndedError,
			make: () => new SessionEndedError(),
			name: "SessionEndedError",
			code: "SESSION_ENDED",
			rebuild: { kind: "constant", message: "The wallet session that approved this request has ended." },
		},
		{
			ctor: OperationNotRecordedError,
			make: () => new OperationNotRecordedError(),
			name: "OperationNotRecordedError",
			code: "OPERATION_NOT_RECORDED",
			rebuild: { kind: "constant", message: "The operation could not be recorded, so it was not started." },
		},
		{ ctor: ValidationError, make: () => new ValidationError("v"), name: "ValidationError", code: "VALIDATION", rebuild: pass },
		{
			ctor: InvalidPasswordError,
			make: () => new InvalidPasswordError(),
			name: "InvalidPasswordError",
			code: "INVALID_PASSWORD",
			rebuild: pass,
		},
		{
			ctor: AccountAddressInconsistencyError,
			make: () => new AccountAddressInconsistencyError(),
			name: "AccountAddressInconsistencyError",
			code: "ACCOUNT_ADDRESS_INCONSISTENCY",
			rebuild: pass,
		},
		{ ctor: RestoreTornError, make: () => new RestoreTornError(), name: "RestoreTornError", code: "RESTORE_TORN", rebuild: pass },
		{
			ctor: ProfileIdConflictError,
			make: () => new ProfileIdConflictError(),
			name: "ProfileIdConflictError",
			code: "PROFILE_ID_CONFLICT",
			rebuild: pass,
		},
		{
			ctor: DuplicateWalletError,
			make: () => new DuplicateWalletError(),
			name: "DuplicateWalletError",
			code: "DUPLICATE_WALLET",
			rebuild: pass,
		},
		{ ctor: RecoveryModeError, make: () => new RecoveryModeError(), name: "RecoveryModeError", code: "RECOVERY_MODE", rebuild: pass },
	]

	function expected(row: Row, payload: WalletErrorPayload): Expected {
		const own = { ctor: row.ctor, name: row.name }
		switch (row.rebuild.kind) {
			case "pass":
				return { ...own, message: payload.message, details: payload.details }
			case "drop-details":
				return { ...own, message: payload.message, details: undefined }
			case "constant":
				return { ...own, message: row.rebuild.message, details: undefined }
			case "capability":
				throw new Error("capability rows have their own table")
			case "base":
				return { ctor: WalletError, name: "WalletError", message: payload.message, details: payload.details }
		}
	}

	function expectRebuilt(payload: WalletErrorPayload, want: Expected): void {
		const rebuilt = walletErrorFromPayload(payload)
		expect(rebuilt.constructor).toBe(want.ctor)
		expect(Object.getPrototypeOf(rebuilt)).toBe(want.ctor.prototype)
		expect(rebuilt).toBeInstanceOf(WalletError)
		expect(rebuilt.name).toBe(want.name)
		expect(rebuilt.code).toBe(payload.code)
		expect(rebuilt.message).toBe(want.message)
		expect(rebuilt.details).toBe(want.details)
	}

	test("the table lists exactly the module's exported WalletError subclasses", () => {
		const exported = Object.entries(errorsModule).filter(
			([, value]) => typeof value === "function" && value.prototype instanceof WalletError,
		)
		expect(exported.map(([key]) => key).sort()).toEqual(rows.map((row) => row.name).sort())
		for (const [key, value] of exported) expect(rows.find((row) => row.name === key)?.ctor).toBe(value)
	})

	test.each(rows)("$name: exact prototype, literal name and literal code on construction", ({ ctor, make, name, code }) => {
		const err = make()
		expect(Object.getPrototypeOf(err)).toBe(ctor.prototype)
		expect(err).toBeInstanceOf(WalletError)
		expect(err).toBeInstanceOf(Error)
		expect(err.name).toBe(name)
		expect(err.code).toBe(code)
	})

	test.each(rows)("$name: its own payload rebuilds with class, name, code, message and details intact", (row) => {
		const err = row.make()
		const rebuilt = walletErrorFromPayload(err.toPayload())
		const rebuiltAsBase = row.rebuild.kind === "base"
		expect(rebuilt.constructor).toBe(rebuiltAsBase ? WalletError : row.ctor)
		expect(rebuilt.name).toBe(rebuiltAsBase ? "WalletError" : row.name)
		expect(rebuilt.code).toBe(row.code)
		expect(rebuilt.message).toBe(err.message)
		expect(rebuilt.details).toStrictEqual(err.details)
	})

	test.each<[name: string, make: () => WalletError, message: string]>([
		["UserRejectedError", () => new UserRejectedError(), "User rejected the request"],
		[
			"DuplicateInitializationError",
			() => new DuplicateInitializationError(),
			"Another first transaction initialized this account — wait for network sync, then retry.",
		],
		["InvalidPasswordError", () => new InvalidPasswordError(), "Invalid profile password"],
		[
			"ProfileIdConflictError",
			() => new ProfileIdConflictError(),
			"Profile id was claimed during WebAuthn prompt; retry with a new id.",
		],
	])("%s keeps its default message", (_name, make, message) => {
		expect(make().message).toBe(message)
	})

	const foreignDetails = { jobId: "j", existingProfileName: "n", capabilityType: "accounts", k: 1 }
	const payloadShapes: Array<[label: string, extra: { details?: unknown }]> = [
		["foreign details", { details: foreignDetails }],
		["message only (the operation-result channel)", {}],
		["null details", { details: null }],
	]
	const nonCapabilityRows = rows.filter((row) => row.rebuild.kind !== "capability")

	describe.each(payloadShapes)("a payload with %s", (_label, extra) => {
		test.each(nonCapabilityRows)("$code rebuilds by its rule", (row) => {
			const payload = { code: row.code, message: "wire text", ...extra } as WalletErrorPayload
			expectRebuilt(payload, expected(row, payload))
		})
	})

	// `capabilityType ?? "unknown"` into a fresh object: `??` keeps an empty or non-string value, and
	// no other detail field survives.
	test.each<[label: string, details: unknown, want: { capabilityType: unknown }]>([
		["a string capabilityType beside another field", { capabilityType: "accounts", k: 1 }, { capabilityType: "accounts" }],
		["an empty capabilityType", { capabilityType: "" }, { capabilityType: "" }],
		["a non-string capabilityType beside another field", { capabilityType: 7, k: 1 }, { capabilityType: 7 }],
		["no capabilityType", { k: 1 }, { capabilityType: "unknown" }],
		["no details", undefined, { capabilityType: "unknown" }],
		["null details", null, { capabilityType: "unknown" }],
		["string details", "accounts", { capabilityType: "unknown" }],
	])("CAPABILITY_NOT_GRANTED with %s", (_label, details, want) => {
		const rebuilt = walletErrorFromPayload({ code: "CAPABILITY_NOT_GRANTED", message: "wire text", details })
		expect(rebuilt.constructor).toBe(CapabilityNotGrantedError)
		expect(rebuilt.name).toBe("CapabilityNotGrantedError")
		expect(rebuilt.message).toBe("wire text")
		expect(rebuilt.details).toStrictEqual(want)
		expect(rebuilt.details).not.toBe(details)
	})

	test.each<[label: string, code: unknown]>([
		["__proto__", "__proto__"],
		["constructor", "constructor"],
		["toString", "toString"],
		["hasOwnProperty", "hasOwnProperty"],
		["an unknown code", "SOME_FUTURE_CODE"],
		["a number", 7],
		["null", null],
		["undefined", undefined],
		["an object", {}],
		["a boxed known code", Object("USER_REJECTED")],
	])("a code that is %s rebuilds as the base WalletError with code, message and details kept", (_label, code) => {
		const details = { k: 1 }
		const rebuilt = walletErrorFromPayload({ code, message: "wire text", details } as WalletErrorPayload)
		expect(rebuilt.constructor).toBe(WalletError)
		expect(rebuilt.name).toBe("WalletError")
		expect(rebuilt.code).toBe(code)
		expect(rebuilt.message).toBe("wire text")
		expect(rebuilt.details).toBe(details)
	})

	test("(BUG PIN) TOO_MANY_PENDING reconstructs as base WalletError, not TooManyPendingError", () => {
		// Port consumers receive the base class today, so rebuilding this one would change their behaviour.
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

describe("isReceiverGoneRejection", () => {
	test("matches Chrome's exact receiver-gone text", () => {
		expect(isReceiverGoneRejection(new Error(RECEIVER_GONE_MESSAGE))).toBe(true)
	})

	test("does not match a prefix, another connection error, a non-Error, or a message-shaped object", () => {
		expect(isReceiverGoneRejection(new Error("Could not establish connection."))).toBe(false)
		expect(isReceiverGoneRejection(new Error(`${RECEIVER_GONE_MESSAGE} (tab 4)`))).toBe(false)
		expect(isReceiverGoneRejection(new Error("Could not establish connection. The message port closed."))).toBe(false)
		expect(isReceiverGoneRejection(RECEIVER_GONE_MESSAGE)).toBe(false)
		expect(isReceiverGoneRejection({ message: RECEIVER_GONE_MESSAGE })).toBe(false)
	})
})
