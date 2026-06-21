/**
 * Contract tests for the background (popup ↔ SW Port) ServiceClient.
 *
 * Exercises:
 *  - Response correlation (resolve / reject by requestId)
 *  - Hard-timeout path with typed RpcTimeoutError
 *  - Structured-error deserialization (WalletError subclass preservation)
 *  - Flat-string error wrapping (upgraded to Error instance)
 *  - Disconnect cleanup (pending requests reject, timers clear)
 *
 * Relocated from the extension package into the package that owns the code.
 * Uses the local `transport-harness` — `capturePortMessage` grabs what the
 * client just sent, `emitPortMessage` simulates a server response without
 * booting a real port broker.
 */

import { describe, expect, test, vi } from "vitest"
import type { ILogger } from "@nulo/wallet-core/logger"
import { RpcDisconnectedError, RpcTimeoutError, UserRejectedError, ValidationError, WalletError } from "../errors"
import { MessageType, type ResponseMessage } from "../messages"
import { capturePortMessage, emitPortDisconnect, emitPortMessage, silentLogger } from "../testing/transport-harness"
import { ServiceClient, DEFAULT_RPC_TIMEOUT_MS } from "./client"

const SERVICE = "test-svc"

type TestMethods = {
	echo: (msg: string) => string
	fail: () => never
}

class TestClient extends ServiceClient<TestMethods> {
	public constructor(logger: ILogger, timeoutMs?: number) {
		super(SERVICE, logger, undefined, timeoutMs ? { requestTimeoutMs: timeoutMs } : undefined)
	}

	public echo(msg: string): Promise<string> {
		return this.request("echo", msg)
	}

	public fail(): Promise<never> {
		return this.request("fail")
	}
}

function newClient(timeoutMs?: number): TestClient {
	return new TestClient(silentLogger, timeoutMs)
}

function responseMessage(requestId: number, result?: unknown, error?: string, errorPayload?: unknown): ResponseMessage<TestMethods> {
	return {
		type: MessageType.Response,
		content: {
			requestId,
			...(result !== undefined ? { result } : {}),
			...(error !== undefined ? { error } : {}),
			...(errorPayload !== undefined ? { errorPayload } : {}),
		},
	} as ResponseMessage<TestMethods>
}

/** Grab the requestId of the most recent request sent on SERVICE. */
function lastRequestId(): number {
	const calls = capturePortMessage(SERVICE).mock.calls
	expect(calls.length).toBeGreaterThan(0)
	const msg = calls[calls.length - 1][0] as { content: { requestId: number } }
	return msg.content.requestId
}

// ── Response correlation ──────────────────────────────────────────────

describe("response correlation", () => {
	test("resolves the pending request when the server replies with a result", async () => {
		const client = newClient()
		await client.connect()
		const promise = client.echo("hi")
		const id = lastRequestId()

		emitPortMessage(SERVICE, responseMessage(id, "hi back"))
		await expect(promise).resolves.toBe("hi back")
	})

	test("out-of-order responses correlate by requestId", async () => {
		const client = newClient()
		await client.connect()

		const p1 = client.echo("one")
		const p2 = client.echo("two")
		const calls = capturePortMessage(SERVICE).mock.calls
		const id1 = (calls[0][0] as { content: { requestId: number } }).content.requestId
		const id2 = (calls[1][0] as { content: { requestId: number } }).content.requestId

		// Respond to #2 first, then #1.
		emitPortMessage(SERVICE, responseMessage(id2, "TWO"))
		emitPortMessage(SERVICE, responseMessage(id1, "ONE"))

		await expect(p1).resolves.toBe("ONE")
		await expect(p2).resolves.toBe("TWO")
	})

	test("late response for an unknown requestId is ignored (no throw)", async () => {
		const client = newClient()
		await client.connect()
		// No in-flight requests. Spurious response should not crash.
		expect(() => emitPortMessage(SERVICE, responseMessage(999, "stale"))).not.toThrow()
	})

	test("null / malformed inbound messages are ignored without throwing (fix b)", async () => {
		const client = newClient()
		await client.connect()
		// Previously `message.type` (non-optional) deref'd null and threw.
		expect(() => emitPortMessage(SERVICE, null)).not.toThrow()
		expect(() => emitPortMessage(SERVICE, undefined)).not.toThrow()
		expect(() => emitPortMessage(SERVICE, {})).not.toThrow()
		expect(() => emitPortMessage(SERVICE, { type: MessageType.Response })).not.toThrow()
	})
})

// ── Hard timeout ──────────────────────────────────────────────────────

describe("request timeout", () => {
	test("rejects with RpcTimeoutError after the configured timeout", async () => {
		vi.useFakeTimers()
		try {
			const client = newClient(500)
			await client.connect()
			const promise = client.echo("never answered")
			// Capture rejection synchronously so the unhandled-rejection hook
			// doesn't fire when the timer callback rejects the underlying promise.
			const rejection = promise.catch((err: unknown) => err)

			vi.advanceTimersByTime(499)
			await Promise.resolve()
			vi.advanceTimersByTime(1)

			const err = await rejection
			expect(err).toBeInstanceOf(RpcTimeoutError)
			expect((err as Error).message).toMatch(/timed out after 500ms/)
		} finally {
			vi.useRealTimers()
		}
	})

	test("timeout error carries the method name and request id in details", async () => {
		vi.useFakeTimers()
		try {
			const client = newClient(100)
			await client.connect()
			const promise = client.echo("x")
			const id = lastRequestId()
			const rejection = promise.catch((err: unknown) => err)

			vi.advanceTimersByTime(100)

			const err = await rejection
			expect(err).toBeInstanceOf(RpcTimeoutError)
			const details = (err as RpcTimeoutError).details as { requestId: number; methodName: string }
			expect(details.methodName).toBe("echo")
			expect(details.requestId).toBe(id)
		} finally {
			vi.useRealTimers()
		}
	})

	test("default timeout is DEFAULT_RPC_TIMEOUT_MS when none supplied", async () => {
		vi.useFakeTimers()
		try {
			const client = newClient()
			await client.connect()
			const promise = client.echo("x")
			const rejection = promise.catch((err: unknown) => err)

			// Track whether the promise has settled via a side-effect flag.
			let settled = false
			promise.catch(() => {
				settled = true
			})

			vi.advanceTimersByTime(DEFAULT_RPC_TIMEOUT_MS - 1)
			await Promise.resolve()
			expect(settled).toBe(false)

			vi.advanceTimersByTime(1)
			const err = await rejection
			expect(err).toBeInstanceOf(RpcTimeoutError)
		} finally {
			vi.useRealTimers()
		}
	})

	test("timer clears when the server responds before timeout fires", async () => {
		vi.useFakeTimers()
		try {
			const client = newClient(1_000_000)
			await client.connect()
			const promise = client.echo("fast")
			const id = lastRequestId()

			emitPortMessage(SERVICE, responseMessage(id, "ok"))
			const result = await promise
			expect(result).toBe("ok")

			// Advance far past the timeout window; no stray rejection / log.
			vi.advanceTimersByTime(2_000_000)
			await Promise.resolve()
		} finally {
			vi.useRealTimers()
		}
	})
})

// ── Structured error deserialization ──────────────────────────────────

describe("error deserialization", () => {
	test("response with errorPayload rejects with the matching WalletError subclass", async () => {
		const client = newClient()
		await client.connect()
		const promise = client.fail()
		const id = lastRequestId()

		emitPortMessage(SERVICE, responseMessage(id, undefined, "user said no", { code: "USER_REJECTED", message: "user said no" }))

		await expect(promise).rejects.toBeInstanceOf(UserRejectedError)
		await expect(promise).rejects.toBeInstanceOf(WalletError)
		await expect(promise).rejects.toMatchObject({ message: "user said no", code: "USER_REJECTED" })
	})

	test("errorPayload with details round-trips", async () => {
		const client = newClient()
		await client.connect()
		const promise = client.fail()
		const id = lastRequestId()

		emitPortMessage(
			SERVICE,
			responseMessage(id, undefined, "bad input", { code: "VALIDATION", message: "bad input", details: { field: "amount" } }),
		)

		try {
			await promise
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError)
			expect((err as ValidationError).details).toEqual({ field: "amount" })
		}
	})

	test("unknown errorPayload code falls back to WalletError base", async () => {
		const client = newClient()
		await client.connect()
		const promise = client.fail()
		const id = lastRequestId()

		emitPortMessage(SERVICE, responseMessage(id, undefined, "new kind", { code: "FUTURE_CODE_X", message: "new kind" }))

		try {
			await promise
		} catch (err) {
			expect(err).toBeInstanceOf(WalletError)
			expect(err).not.toBeInstanceOf(UserRejectedError)
			expect((err as WalletError).code).toBe("FUTURE_CODE_X")
		}
	})

	test("response with plain error string rejects with an Error instance (not a raw string)", async () => {
		const client = newClient()
		await client.connect()
		const promise = client.fail()
		const id = lastRequestId()

		emitPortMessage(SERVICE, responseMessage(id, undefined, "boom"))

		await expect(promise).rejects.toBeInstanceOf(Error)
		await expect(promise).rejects.toThrow("boom")
	})

	test("rejection with plain-error string is NOT a WalletError", async () => {
		const client = newClient()
		await client.connect()
		const promise = client.fail()
		const id = lastRequestId()

		emitPortMessage(SERVICE, responseMessage(id, undefined, "something"))

		try {
			await promise
		} catch (err) {
			expect(err).toBeInstanceOf(Error)
			expect(err).not.toBeInstanceOf(WalletError)
		}
	})
})

// ── resultIsJson fallback (AUDIT A6) ──────────────────────────────────

describe("resultIsJson fallback (AUDIT A6)", () => {
	test("client JSON.parses the result when resultIsJson is true", async () => {
		const client = newClient()
		await client.connect()
		const promise = client.echo("hello")
		const id = lastRequestId()

		const stringified = JSON.stringify({ wrapped: "value", n: 42 })
		emitPortMessage(SERVICE, {
			type: MessageType.Response,
			content: { requestId: id, result: stringified, resultIsJson: true },
		} as ResponseMessage<TestMethods>)

		await expect(promise).resolves.toEqual({ wrapped: "value", n: 42 })
	})

	test("client passes result through unchanged when resultIsJson is absent", async () => {
		const client = newClient()
		await client.connect()
		const promise = client.echo("hello")
		const id = lastRequestId()

		// Even though `result` looks like JSON, without resultIsJson we MUST
		// pass it through unchanged — otherwise we'd corrupt callers who
		// legitimately want a string-shaped result back.
		emitPortMessage(SERVICE, responseMessage(id, '{"raw":"string"}'))

		await expect(promise).resolves.toBe('{"raw":"string"}')
	})

	test("resultIsJson is ignored when result is not a string", async () => {
		const client = newClient()
		await client.connect()
		const promise = client.echo("hello")
		const id = lastRequestId()

		// Defensive: if result isn't a string but resultIsJson is set, pass
		// the value through — JSON.parse on a non-string would throw and
		// reject the request for no good reason. Cast through unknown
		// because TestMethods.echo declares result: string but this test
		// deliberately exercises a non-string fallback branch.
		emitPortMessage(SERVICE, {
			type: MessageType.Response,
			content: { requestId: id, result: { obj: true } as unknown as string, resultIsJson: true },
		} as unknown as ResponseMessage<TestMethods>)

		await expect(promise).resolves.toEqual({ obj: true })
	})
})

describe("port disconnect race (AUDIT A5)", () => {
	test("rejects with RpcDisconnectedError when postMessage throws synchronously", async () => {
		const client = newClient()
		await client.connect()

		// Simulate the realistic A5 race: connect-loop exits with state=Connected,
		// but the underlying port was torn down before postMessage runs.
		// Chrome surfaces this by throwing on postMessage.
		const postMessageMock = capturePortMessage(SERVICE)
		postMessageMock.mockImplementationOnce(() => {
			throw new Error("Attempting to use a disconnected port object")
		})

		await expect(client.echo("ping")).rejects.toBeInstanceOf(RpcDisconnectedError)
	})

	test("RpcDisconnectedError carries methodName, requestId, and the underlying cause", async () => {
		const client = newClient()
		await client.connect()

		const postMessageMock = capturePortMessage(SERVICE)
		postMessageMock.mockImplementationOnce(() => {
			throw new Error("port already torn down")
		})

		try {
			await client.echo("ping")
			expect.fail("expected RpcDisconnectedError")
		} catch (err) {
			expect(err).toBeInstanceOf(RpcDisconnectedError)
			const details = (err as RpcDisconnectedError).details as {
				requestId: number
				methodName: string
				cause?: string
			}
			expect(details.methodName).toBe("echo")
			expect(typeof details.requestId).toBe("number")
			expect(details.cause).toMatch(/port already torn down/)
		}
	})

	test("rejects with RpcDisconnectedError when the captured port reference is undefined", async () => {
		const client = newClient()
		await client.connect()

		// Force the AUDIT A5 path where the port reference was cleared
		// between the connect-loop exit and the local capture. We can't
		// reproduce the microtask race deterministically, so we poke the
		// internal `port` field directly to assert the defensive null-check.
		// biome-ignore lint/suspicious/noExplicitAny: probing private state to test defensive null-check
		;(client as any).port = undefined

		await expect(client.echo("ping")).rejects.toBeInstanceOf(RpcDisconnectedError)
	})

	test("disconnected error clears the request from the pending map (no leak)", async () => {
		const client = newClient()
		await client.connect()

		const postMessageMock = capturePortMessage(SERVICE)
		postMessageMock.mockImplementationOnce(() => {
			throw new Error("disconnected")
		})

		await expect(client.echo("ping")).rejects.toBeInstanceOf(RpcDisconnectedError)
		// The request must be evicted; otherwise a future timeout fire would
		// double-reject or a late response would resolve a stale promise.
		// biome-ignore lint/suspicious/noExplicitAny: probing the correlator's pending count
		expect((client as any).pendingCount).toBe(0)
	})
})

describe("disconnect", () => {
	test("pending requests reject with 'Client disconnected' on disconnect", async () => {
		const client = newClient()
		await client.connect()
		const promise = client.echo("pending")

		client.disconnect()

		await expect(promise).rejects.toThrow("Client disconnected")
	})

	test("disconnect rejection is an Error instance", async () => {
		const client = newClient()
		await client.connect()
		const promise = client.echo("pending")

		client.disconnect()

		try {
			await promise
		} catch (err) {
			expect(err).toBeInstanceOf(Error)
		}
	})

	test("disconnect clears timeout handles (no stray log after disconnect)", async () => {
		vi.useFakeTimers()
		try {
			const client = newClient(500)
			await client.connect()
			const promise = client.echo("pending")
			const rejection = promise.catch(() => undefined) // swallow

			client.disconnect()
			await rejection

			// Advance past the timeout — no unhandled rejection or timer fire.
			vi.advanceTimersByTime(1000)
			await Promise.resolve()
		} finally {
			vi.useRealTimers()
		}
	})
})

// ── Live reconnect (SW dies while the popup is open) ───────────────────
//
// The port's onDisconnect handler (`this.disconnect(); this.connect()`) is the
// production path when the MV3 service worker is recycled mid-session. e2e
// only covers fresh-connect-after-death (a new popup); the live-reconnect
// handler had no direct coverage. These pin: in-flight requests reject, the
// client transparently reconnects, and a fresh request round-trips on the new
// port.

describe("port onDisconnect → reconnect", () => {
	test("rejects in-flight requests, reconnects, and serves new requests on the fresh port", async () => {
		const client = newClient()
		await client.connect()

		// Listener added AFTER the initial connect, so it only catches the reconnect.
		const reconnected = vi.fn()
		client.onConnected.add(reconnected)
		const disconnected = vi.fn()
		client.onDisconnected.add(disconnected)

		const inflight = client.echo("inflight").catch((e: unknown) => e)

		// SW dies: the Port fires onDisconnect → disconnect() rejects pending →
		// connect() re-establishes against a fresh port.
		emitPortDisconnect(SERVICE)

		const err = await inflight
		expect(err).toBeInstanceOf(Error)
		expect((err as Error).message).toBe("Client disconnected")
		expect(disconnected).toHaveBeenCalledTimes(1)
		expect(reconnected).toHaveBeenCalledTimes(1)
		// biome-ignore lint/suspicious/noExplicitAny: probing the correlator's pending count
		expect((client as any).pendingCount).toBe(0)

		// A request issued after the reconnect goes out on the NEW port and resolves.
		const afterReconnect = client.echo("after")
		const id = lastRequestId()
		emitPortMessage(SERVICE, responseMessage(id, "ok-again"))
		await expect(afterReconnect).resolves.toBe("ok-again")
	})

	test("repeated disconnect/reconnect cycles keep working (no leaked port state)", async () => {
		const client = newClient()
		await client.connect()

		for (let cycle = 0; cycle < 3; cycle++) {
			emitPortDisconnect(SERVICE)
			const p = client.echo(`cycle-${cycle}`)
			const id = lastRequestId()
			emitPortMessage(SERVICE, responseMessage(id, `r-${cycle}`))
			await expect(p).resolves.toBe(`r-${cycle}`)
		}
		// biome-ignore lint/suspicious/noExplicitAny: probing the correlator's pending count
		expect((client as any).pendingCount).toBe(0)
	})
})
