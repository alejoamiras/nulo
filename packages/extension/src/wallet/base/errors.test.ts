import { describe, expect, test } from "vitest"
import {
	InvalidPasswordError,
	RpcTimeoutError,
	UserRejectedError,
	ValidationError,
	WalletError,
	walletErrorFromPayload,
	type WalletErrorPayload,
} from "@nulo/extension-messaging/errors"

describe("WalletError", () => {
	test("is an Error subclass with code and details", () => {
		const err = new WalletError("SOMETHING", "oh no", { foo: 1 })
		expect(err).toBeInstanceOf(Error)
		expect(err).toBeInstanceOf(WalletError)
		expect(err.code).toBe("SOMETHING")
		expect(err.message).toBe("oh no")
		expect(err.details).toEqual({ foo: 1 })
	})

	test("toPayload round-trip preserves fields", () => {
		const err = new WalletError("X", "why", { a: 1 })
		expect(err.toPayload()).toEqual({ code: "X", message: "why", details: { a: 1 } })
	})

	test("toPayload omits details when undefined (but key may be present with undefined)", () => {
		const err = new WalletError("X", "why")
		const payload = err.toPayload()
		expect(payload.code).toBe("X")
		expect(payload.message).toBe("why")
		// Not asserting `'details' in payload` — implementation detail; the
		// contract is that deserialization handles both shapes.
	})
})

describe("RpcTimeoutError", () => {
	test("has the expected code and name", () => {
		const err = new RpcTimeoutError("too slow")
		expect(err.code).toBe("RPC_TIMEOUT")
		expect(err.name).toBe("RpcTimeoutError")
	})

	test("instanceof chains hold", () => {
		const err = new RpcTimeoutError("too slow")
		expect(err).toBeInstanceOf(RpcTimeoutError)
		expect(err).toBeInstanceOf(WalletError)
		expect(err).toBeInstanceOf(Error)
	})
})

describe("UserRejectedError", () => {
	test("has default message when none supplied", () => {
		const err = new UserRejectedError()
		expect(err.code).toBe("USER_REJECTED")
		expect(err.message).toContain("rejected")
	})

	test("instanceof chains hold", () => {
		const err = new UserRejectedError("nope")
		expect(err).toBeInstanceOf(UserRejectedError)
		expect(err).toBeInstanceOf(WalletError)
	})
})

describe("ValidationError", () => {
	test("carries details", () => {
		const err = new ValidationError("bad input", { field: "amount" })
		expect(err.code).toBe("VALIDATION")
		expect(err.details).toEqual({ field: "amount" })
	})
})

describe("InvalidPasswordError", () => {
	test("has the expected code and default legacy message", () => {
		const err = new InvalidPasswordError()
		expect(err.code).toBe("INVALID_PASSWORD")
		expect(err.message).toBe(InvalidPasswordError.LEGACY_MESSAGE)
	})

	test("instanceof chains hold across round-trip", () => {
		const original = new InvalidPasswordError()
		const reconstructed = walletErrorFromPayload(original.toPayload())
		expect(reconstructed).toBeInstanceOf(InvalidPasswordError)
		expect(reconstructed).toBeInstanceOf(WalletError)
		expect(reconstructed).toBeInstanceOf(Error)
	})
})

describe("walletErrorFromPayload", () => {
	test("reconstructs RpcTimeoutError with instanceof", () => {
		const payload: WalletErrorPayload = { code: "RPC_TIMEOUT", message: "t", details: { x: 1 } }
		const err = walletErrorFromPayload(payload)
		expect(err).toBeInstanceOf(RpcTimeoutError)
		expect(err).toBeInstanceOf(WalletError)
		expect(err.message).toBe("t")
		expect(err.details).toEqual({ x: 1 })
	})

	test("reconstructs UserRejectedError with instanceof", () => {
		const payload: WalletErrorPayload = { code: "USER_REJECTED", message: "no" }
		const err = walletErrorFromPayload(payload)
		expect(err).toBeInstanceOf(UserRejectedError)
		expect(err).toBeInstanceOf(WalletError)
	})

	test("reconstructs ValidationError with instanceof", () => {
		const payload: WalletErrorPayload = { code: "VALIDATION", message: "bad", details: { f: "x" } }
		const err = walletErrorFromPayload(payload)
		expect(err).toBeInstanceOf(ValidationError)
		expect(err.details).toEqual({ f: "x" })
	})

	test("unknown code falls back to WalletError base class", () => {
		const payload: WalletErrorPayload = { code: "SOMETHING_NEW", message: "future" }
		const err = walletErrorFromPayload(payload)
		expect(err).toBeInstanceOf(WalletError)
		// Not an instance of any known subclass.
		expect(err).not.toBeInstanceOf(RpcTimeoutError)
		expect(err).not.toBeInstanceOf(UserRejectedError)
		expect(err).not.toBeInstanceOf(ValidationError)
		expect(err.code).toBe("SOMETHING_NEW")
	})

	test("round-trip: subclass → toPayload → walletErrorFromPayload", () => {
		const original = new ValidationError("bad", { where: "amount" })
		const reconstructed = walletErrorFromPayload(original.toPayload())
		expect(reconstructed).toBeInstanceOf(ValidationError)
		expect(reconstructed.message).toBe(original.message)
		expect(reconstructed.code).toBe(original.code)
		expect(reconstructed.details).toEqual(original.details)
	})
})
