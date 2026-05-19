import { describe, expect, test } from "vitest"
import { InvalidPasswordError, UserRejectedError, WalletError } from "@nulo/extension-messaging/errors"
import { jsonSanitize, jsonStringify } from "@nulo/wallet-core/utils"

describe("jsonStringify primitives + containers", () => {
	test("bigint → string", () => {
		expect(jsonStringify({ big: 9999999999999999n })).toBe('{"big":"9999999999999999"}')
	})

	test("Map → entries array", () => {
		const m = new Map<string, number>([
			["a", 1],
			["b", 2],
		])
		expect(JSON.parse(jsonStringify(m))).toEqual([
			["a", 1],
			["b", 2],
		])
	})

	test("Set → values array", () => {
		const s = new Set([1, 2, 3])
		expect(JSON.parse(jsonStringify(s))).toEqual([1, 2, 3])
	})
})

describe("jsonStringify on Error instances (regression guard)", () => {
	// Bug: `JSON.stringify(new Error("x")) === "{}"` — `Error`'s
	// `name` / `message` / `stack` are non-enumerable. Without this fix,
	// any error sent over the wire via `LoggerServiceClient` (or any
	// other `jsonSanitize` path) surfaces as `{}` on the receiving side —
	// exactly the visibility regression introduced when RPC rejections
	// were upgraded from raw strings to `Error` instances.

	test("plain Error preserves name + message", () => {
		const out = JSON.parse(jsonStringify(new Error("boom")))
		expect(out.name).toBe("Error")
		expect(out.message).toBe("boom")
	})

	test("plain Error preserves stack when present", () => {
		const err = new Error("boom")
		const out = JSON.parse(jsonStringify(err))
		// stack is engine-dependent but always set on real throws; at minimum
		// it should be a non-empty string if it survived the round-trip.
		if (err.stack) {
			expect(typeof out.stack).toBe("string")
			expect(out.stack.length).toBeGreaterThan(0)
		}
	})

	test("WalletError preserves code + details", () => {
		const err = new WalletError("MY_CODE", "problem", { foo: 1 })
		const out = JSON.parse(jsonStringify(err))
		expect(out.code).toBe("MY_CODE")
		expect(out.details).toEqual({ foo: 1 })
	})

	test("UserRejectedError preserves its subclass name", () => {
		const err = new UserRejectedError("no thanks")
		const out = JSON.parse(jsonStringify(err))
		expect(out.name).toBe("UserRejectedError")
		expect(out.message).toBe("no thanks")
		expect(out.code).toBe("USER_REJECTED")
	})

	test("InvalidPasswordError round-trips the legacy message", () => {
		const err = new InvalidPasswordError()
		const out = JSON.parse(jsonStringify(err))
		expect(out.code).toBe("INVALID_PASSWORD")
		expect(out.message).toBe(InvalidPasswordError.LEGACY_MESSAGE)
	})

	test("Error nested inside an array stays visible", () => {
		const payload = ["prefix", new Error("inside"), 42]
		const out = JSON.parse(jsonStringify(payload))
		expect(out[0]).toBe("prefix")
		expect(out[1].name).toBe("Error")
		expect(out[1].message).toBe("inside")
		expect(out[2]).toBe(42)
	})

	test("Error nested in object keyed under arbitrary name", () => {
		const out = JSON.parse(jsonStringify({ cause: new Error("why") }))
		expect(out.cause.message).toBe("why")
	})

	test("jsonSanitize preserves the shape", () => {
		const round = jsonSanitize(new Error("boom"))
		expect(round).toMatchObject({ name: "Error", message: "boom" })
	})
})
