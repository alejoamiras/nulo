import { describe, expect, test, vi } from "vitest"
import { UserRejectedError, ValidationError, WalletError } from "../errors"
import { decodeResult } from "./decode"
import { buildErrorResponseContent } from "./error-response"
import { awaitInitialized } from "./initialization"

describe("decodeResult", () => {
	test("JSON.parses a string result when resultIsJson is true", () => {
		const parsed = decodeResult(JSON.stringify({ a: 1, b: "x" }), true)
		expect(parsed).toEqual({ a: 1, b: "x" })
	})

	test("passes the result through unchanged when resultIsJson is absent", () => {
		// Looks like JSON but must NOT be parsed — callers may legitimately
		// want a string-shaped result back.
		expect(decodeResult('{"raw":"string"}')).toBe('{"raw":"string"}')
	})

	test("passes the result through unchanged when resultIsJson is false", () => {
		expect(decodeResult('{"a":1}', false)).toBe('{"a":1}')
	})

	test("ignores resultIsJson when the result is not a string", () => {
		const obj = { obj: true }
		expect(decodeResult(obj as unknown as string, true)).toBe(obj)
	})
})

describe("buildErrorResponseContent", () => {
	test("WalletError serializes a structured errorPayload", () => {
		const out = buildErrorResponseContent(new UserRejectedError("nope"))
		expect(out.error).toBe("nope")
		expect(out.errorPayload).toEqual({ code: "USER_REJECTED", message: "nope", details: undefined })
	})

	test("WalletError details round-trip through the payload", () => {
		const out = buildErrorResponseContent(new ValidationError("bad", { field: "amount" }))
		expect(out.errorPayload?.code).toBe("VALIDATION")
		expect(out.errorPayload?.details).toEqual({ field: "amount" })
	})

	test("plain Error flattens to a message with no errorPayload", () => {
		const out = buildErrorResponseContent(new Error("plain boom"))
		expect(out.error).toBe("plain boom")
		expect(out.errorPayload).toBeUndefined()
	})

	test("base WalletError still carries its code", () => {
		const out = buildErrorResponseContent(new WalletError("CUSTOM", "msg"))
		expect(out.errorPayload?.code).toBe("CUSTOM")
	})
})

describe("awaitInitialized", () => {
	test("resolves immediately when already initialized (no timers needed)", async () => {
		await expect(awaitInitialized(() => true)).resolves.toBeUndefined()
	})

	test("resolves once the live getter flips to true mid-wait", async () => {
		vi.useFakeTimers()
		try {
			let ready = false
			const p = awaitInitialized(() => ready)
			await vi.advanceTimersByTimeAsync(500)
			ready = true
			await vi.advanceTimersByTimeAsync(500)
			await expect(p).resolves.toBeUndefined()
		} finally {
			vi.useRealTimers()
		}
	})

	test("throws after the budget when never initialized", async () => {
		vi.useFakeTimers()
		try {
			const p = awaitInitialized(() => false, 30_000).catch((e) => e)
			await vi.advanceTimersByTimeAsync(30_000)
			const err = await p
			expect(err).toBeInstanceOf(Error)
			expect((err as Error).message).toBe("Service not initialized")
		} finally {
			vi.useRealTimers()
		}
	})
})
