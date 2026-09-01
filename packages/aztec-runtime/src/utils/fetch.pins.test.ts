/**
 * Pre-extraction pins for the timeout-fetch closure — its first tests. Every
 * error message and status-classification branch is the contract callers
 * (connectivity classification, retry policy) match on.
 */
import { NoRetryError } from "@aztec/foundation/retry"
import { afterEach, describe, expect, test, vi } from "vitest"
import { makeSingleAttemptFetch } from "./fetch"

const realFetch = globalThis.fetch

function jsonResponse(body: unknown, init: { ok: boolean; status?: number; statusText?: string }) {
	return {
		ok: init.ok,
		status: init.status ?? (init.ok ? 200 : 500),
		statusText: init.statusText ?? "",
		headers: { get: (h: string) => (h === "x-pin" ? "yes" : null) },
		json: async () => body,
	} as unknown as Response
}

afterEach(() => {
	globalThis.fetch = realFetch
	vi.restoreAllMocks()
})

describe("fetchOnce (via makeSingleAttemptFetch) reject oracle", () => {
	test("abort maps to the timeout message", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new DOMException("aborted", "AbortError")
		}) as typeof fetch
		await expect(makeSingleAttemptFetch(1234)("http://host:1", {})).rejects.toThrowError(
			"Request to http://host:1 timed out after 1234ms",
		)
	})

	test("a non-abort network failure maps to the host-prefixed message", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new TypeError("fetch failed")
		}) as typeof fetch
		await expect(makeSingleAttemptFetch(1000)("http://host:1", {})).rejects.toThrowError(
			"Error fetching from host http://host:1: TypeError: fetch failed",
		)
	})

	test("4xx rejects with NoRetryError carrying the server message", async () => {
		globalThis.fetch = vi.fn(async () =>
			jsonResponse({ error: { message: "bad params" } }, { ok: false, status: 400, statusText: "Bad Request" }),
		) as typeof fetch
		const err = await makeSingleAttemptFetch(1000)("http://h", {}).catch((e) => e)
		expect(err).toBeInstanceOf(NoRetryError)
		expect(err.message).toBe("Error 400 from server http://h: bad params")
	})

	test("noRetry=true makes even a 5xx a NoRetryError", async () => {
		globalThis.fetch = vi.fn(async () => jsonResponse({ error: { message: "boom" } }, { ok: false, status: 500 })) as typeof fetch
		const err = await makeSingleAttemptFetch(1000)("http://h", {}, {}, true).catch((e) => e)
		expect(err).toBeInstanceOf(NoRetryError)
		expect(err.message).toBe("Error 500 from server http://h: boom")
	})

	test("5xx (retryable) rejects with a PLAIN Error, statusText fallback when no error body", async () => {
		globalThis.fetch = vi.fn(async () => jsonResponse({}, { ok: false, status: 503, statusText: "Unavailable" })) as typeof fetch
		const err = await makeSingleAttemptFetch(1000)("http://h", {}).catch((e) => e)
		expect(err).toBeInstanceOf(Error)
		expect(err).not.toBeInstanceOf(NoRetryError)
		expect(err.message).toBe("Error 503 from server http://h: Unavailable")
	})

	test("unparseable body on a NON-ok response surfaces the statusText", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				({
					ok: false,
					status: 500,
					statusText: "Bad Gateway-ish",
					headers: { get: () => null },
					json: async () => {
						throw new Error("nope")
					},
				}) as unknown as Response,
		) as typeof fetch
		await expect(makeSingleAttemptFetch(1000)("http://h", {})).rejects.toThrowError("Bad Gateway-ish")
	})

	test("unparseable body on an OK response is its own failure", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				({
					ok: true,
					status: 200,
					statusText: "OK",
					headers: { get: () => null },
					json: async () => {
						throw new Error("nope")
					},
				}) as unknown as Response,
		) as typeof fetch
		await expect(makeSingleAttemptFetch(1000)("http://h", {})).rejects.toThrowError("Failed to parse body as JSON")
	})

	test("success passes the parsed body + live headers through, and sends extraHeaders", async () => {
		const spy = vi.fn(async () => jsonResponse({ result: 7 }, { ok: true }))
		globalThis.fetch = spy as unknown as typeof fetch
		const out = await makeSingleAttemptFetch(1000)("http://h", { m: 1 }, { "x-extra": "1" })
		expect(out.response).toEqual({ result: 7 })
		expect(out.headers.get("x-pin")).toBe("yes")
		const init = spy.mock.calls[0]?.[1] as RequestInit
		expect((init.headers as Record<string, string>)["x-extra"]).toBe("1")
		expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json")
		expect(init.signal).toBeInstanceOf(AbortSignal)
	})
})
