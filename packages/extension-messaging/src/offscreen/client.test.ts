/**
 * Contract tests for the offscreen (SW ↔ offscreen sendMessage) ServiceClient.
 *
 * Relocated from the extension package into the package that owns the code.
 * Uses the local `transport-harness` (`captureMessage` / `emitMessage`).
 *
 * As of the phase-4 flip the offscreen client rejects with TYPED errors (parity
 * with the Port transport): remote errors reconstruct the WalletError subclass
 * from `errorPayload`, timeouts → RpcTimeoutError, send failures →
 * RpcDisconnectedError, disconnect → Error("Client disconnected"). The
 * timer-cleanup tripwires at the bottom are the unified-correlator leak guards.
 */

import { describe, test, expect, vi, beforeEach } from "vitest"
import type { ILogger } from "@nulo/wallet-core/logger"
import { LogLevel } from "@nulo/wallet-core/logger"
import { captureMessage, emitMessage, makeSpyLogger, silentLogger } from "../testing/transport-harness"
import { RpcDisconnectedError, RpcTimeoutError, UserRejectedError, WalletError } from "../errors"
import { MessageType } from "../messages"
import { LoggingTelemetrySink, MemoryTelemetrySink, type RequestTelemetry, type TelemetrySink } from "./telemetry"
import { ServiceClient } from "./client"

type Methods = {
	echo(val: string): Promise<string>
	multiply(a: number, b: number): Promise<number>
}

class TestClient extends ServiceClient<Methods> {
	public readyHook = vi.fn().mockResolvedValue(undefined)

	public constructor(telemetry?: TelemetrySink, logger: ILogger = silentLogger) {
		super("test-service", logger, "test-client", telemetry)
	}

	protected async onReady(): Promise<void> {
		await this.readyHook()
	}

	public echo(val: string): Promise<string> {
		return this.request("echo", val)
	}

	public multiply(a: number, b: number): Promise<number> {
		return this.request("multiply", a, b)
	}
}

/** Capture the request envelope (requestId + from-uid) from the most recent
 *  chrome.runtime.sendMessage call so we can build a matching response. */
function getLastRequest(): { requestId: number; fromUid: string } {
	const sendMessageMock = captureMessage()
	const lastCall = sendMessageMock.mock.calls.at(-1)
	if (!lastCall) throw new Error("No sendMessage calls captured")
	const [request] = lastCall as [{ content: { requestId: number }; from: string }]
	return { requestId: request.content.requestId, fromUid: request.from }
}

async function flush() {
	await new Promise((r) => setTimeout(r, 0))
	await new Promise((r) => setTimeout(r, 0))
	await new Promise((r) => setTimeout(r, 0))
}

function makeResponse(requestId: number, clientUid: string, result: unknown) {
	return {
		type: MessageType.Response,
		from: "test-service",
		to: clientUid,
		content: { requestId, result },
	}
}

function makeError(requestId: number, clientUid: string, error: string) {
	return {
		type: MessageType.Response,
		from: "test-service",
		to: clientUid,
		content: { requestId, error },
	}
}

describe("ServiceClient.request (offscreen transport base)", () => {
	beforeEach(() => {
		// nothing to reset — fake-browser is reset globally + the harness
		// re-stubs chrome per test.
	})

	test("calls onReady hook before sending the request", async () => {
		const client = new TestClient()
		const sendMessageMock = captureMessage()

		const promise = client.echo("hi")
		await flush()

		expect(client.readyHook).toHaveBeenCalledTimes(1)
		expect(sendMessageMock).toHaveBeenCalledTimes(1)
		// onReady must resolve BEFORE sendMessage fires.
		const readyCall = client.readyHook.mock.invocationCallOrder[0]!
		const sendCall = sendMessageMock.mock.invocationCallOrder[0]!
		expect(readyCall).toBeLessThan(sendCall)

		const { requestId, fromUid } = getLastRequest()
		emitMessage(makeResponse(requestId, fromUid, "echo:hi"))
		await expect(promise).resolves.toBe("echo:hi")
	})

	test("null / malformed inbound messages are ignored without throwing (fix b)", () => {
		const client = new TestClient()
		client.connect()
		// onMessageListener previously deref'd `message.to` on a null message.
		expect(() => emitMessage(null)).not.toThrow()
		expect(() => emitMessage(undefined)).not.toThrow()
		expect(() => emitMessage({})).not.toThrow()
	})

	test("each request re-runs onReady (no memoization)", async () => {
		const client = new TestClient()
		const p1 = client.echo("a")
		await flush()
		const first = getLastRequest()
		emitMessage(makeResponse(first.requestId, first.fromUid, "ok1"))
		await p1

		const p2 = client.echo("b")
		await flush()
		const second = getLastRequest()
		emitMessage(makeResponse(second.requestId, second.fromUid, "ok2"))
		await p2

		expect(client.readyHook).toHaveBeenCalledTimes(2)
	})
})

/**
 * Contract suite for terminal-status telemetry + send-failure
 * synchronous cleanup. Mirrors the popup↔SW
 * `background/client.test.ts` suite, scoped to the offscreen transport.
 */
describe("ServiceClient telemetry + send-failure", () => {
	beforeEach(() => {
		captureMessage().mockReset()
		// Safety net: any prior test that leaked vi.useFakeTimers without
		// restoring would hang `await flush()` (which uses real setTimeout).
		vi.useRealTimers()
	})

	test("success terminal: telemetry captures method, status=success, valid timing", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)
		const promise = client.echo("hi")
		await flush()
		const { requestId, fromUid } = getLastRequest()
		emitMessage(makeResponse(requestId, fromUid, "echo:hi"))
		await expect(promise).resolves.toBe("echo:hi")

		expect(sink.records).toHaveLength(1)
		const r = sink.records[0]
		expect(r.method).toBe("echo")
		expect(r.requestId).toBe(requestId)
		expect(r.status).toBe("success")
		expect(r.startedAtMs).toBeLessThanOrEqual(r.endedAtMs)
		expect(r.detail).toBeUndefined()
	})

	test("rejected terminal: remote error path emits status=rejected", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)
		const promise = client.echo("hi").catch((e) => e)
		await flush()
		const { requestId, fromUid } = getLastRequest()
		emitMessage(makeError(requestId, fromUid, "remote_failed"))
		// FLIPPED (phase 4): a flat-error response (no errorPayload) rejects with
		// a plain Error instance, not the raw string.
		const err = await promise
		expect(err).toBeInstanceOf(Error)
		expect((err as Error).message).toBe("remote_failed")

		expect(sink.records).toHaveLength(1)
		expect(sink.records[0].status).toBe("rejected")
	})

	test("rejected terminal: errorPayload reconstructs the typed WalletError subclass", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)
		const promise = client.echo("hi").catch((e) => e)
		await flush()
		const { requestId, fromUid } = getLastRequest()
		emitMessage({
			type: MessageType.Response,
			from: "test-service",
			to: fromUid,
			content: { requestId, error: "user said no", errorPayload: { code: "USER_REJECTED", message: "user said no" } },
		})

		const err = await promise
		expect(err).toBeInstanceOf(UserRejectedError)
		expect(err).toBeInstanceOf(WalletError)
		expect((err as WalletError).code).toBe("USER_REJECTED")
		expect(sink.records[0].status).toBe("rejected")
	})

	test("send_failed terminal: chrome.runtime.sendMessage rejection cleans up SYNCHRONOUSLY", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)
		const sendMessageMock = captureMessage()
		// Make sendMessage reject — typical cause: offscreen document gone.
		sendMessageMock.mockRejectedValueOnce(new Error("offscreen closed before fully loading"))

		// FLIPPED (phase 4): rejects with a typed RpcDisconnectedError.
		const err = await client.echo("hi").catch((e) => e)
		expect(err).toBeInstanceOf(RpcDisconnectedError)
		expect((err as Error).message).toMatch(/Offscreen send failed: echo/)

		// Telemetry was emitted synchronously by the catch branch — no
		// 90s timeout wait needed.
		expect(sink.records).toHaveLength(1)
		expect(sink.records[0].status).toBe("send_failed")
		expect(sink.records[0].detail).toBe("sendMessage_threw")
	})

	test("disconnect terminal: pending requests reject + telemetry emitted once each", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)
		const p1 = client.echo("a").catch((e) => e)
		const p2 = client.multiply(3, 4).catch((e) => e)
		await flush()
		expect(sink.records).toHaveLength(0) // not yet terminal

		client.disconnect()
		// FLIPPED (phase 4): rejects pending requests with Error("Client disconnected").
		const [e1, e2] = await Promise.all([p1, p2])
		expect(e1).toBeInstanceOf(Error)
		expect((e1 as Error).message).toBe("Client disconnected")
		expect((e2 as Error).message).toBe("Client disconnected")

		expect(sink.records).toHaveLength(2)
		expect(sink.records.every((r) => r.status === "disconnected")).toBe(true)
		expect(sink.records.every((r) => r.detail === "client_disconnect")).toBe(true)
	})

	test("timeout terminal: fake timers fire 90s+ -> status=timeout once", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)
		vi.useFakeTimers()
		try {
			const promise = client.echo("hi").catch((e) => e)
			await vi.advanceTimersByTimeAsync(0) // flush onReady microtasks

			await vi.advanceTimersByTimeAsync(90_000 + 100)
			// FLIPPED (phase 4): rejects with a typed RpcTimeoutError.
			const err = await promise
			expect(err).toBeInstanceOf(RpcTimeoutError)
			expect((err as Error).message).toMatch(/Offscreen request timed out: echo/)

			expect(sink.records).toHaveLength(1)
			expect(sink.records[0].status).toBe("timeout")
			expect(sink.records[0].detail).toBe("timeout_fired")
		} finally {
			vi.useRealTimers()
		}
	})

	test("per-method timeout override: subclass uses custom timeout for selected method only", async () => {
		// Subclass overrides `multiply` to a much longer timeout than the
		// default, while `echo` continues to use the base 90s ceiling.
		// This mirrors PXE's pattern (proveTx gets 30min; everything else
		// stays at 90s).
		const CUSTOM_TIMEOUT_MS = 300_000
		class CustomTimeoutClient extends ServiceClient<Methods> {
			public constructor(telemetry?: TelemetrySink) {
				super("test-service", silentLogger, "test-client", telemetry)
			}
			protected override getRequestTimeoutMs(method: keyof Methods): number {
				if (method === "multiply") return CUSTOM_TIMEOUT_MS
				return super.getRequestTimeoutMs(method)
			}
			public echo(val: string): Promise<string> {
				return this.request("echo", val)
			}
			public multiply(a: number, b: number): Promise<number> {
				return this.request("multiply", a, b)
			}
		}

		const sink = new MemoryTelemetrySink()
		const client = new CustomTimeoutClient(sink)
		vi.useFakeTimers()
		try {
			// `multiply` should NOT fire at the default 90s — it's bumped.
			const longPromise = client.multiply(2, 3).catch((e) => e)
			await vi.advanceTimersByTimeAsync(0)
			await vi.advanceTimersByTimeAsync(90_000 + 100)
			expect(sink.records).toHaveLength(0)

			// Advance to the custom timeout — now it fires.
			await vi.advanceTimersByTimeAsync(CUSTOM_TIMEOUT_MS - 90_000)
			const longErr = await longPromise
			expect(longErr).toBeInstanceOf(RpcTimeoutError)
			expect((longErr as Error).message).toMatch(/Offscreen request timed out: multiply/)
			expect(sink.records).toHaveLength(1)
			expect(sink.records[0].status).toBe("timeout")

			// And `echo` (no override) still uses the default 90s.
			const echoPromise = client.echo("hi").catch((e) => e)
			await vi.advanceTimersByTimeAsync(0)
			await vi.advanceTimersByTimeAsync(90_000 + 100)
			const echoErr = await echoPromise
			expect(echoErr).toBeInstanceOf(RpcTimeoutError)
			expect((echoErr as Error).message).toMatch(/Offscreen request timed out: echo/)
			expect(sink.records).toHaveLength(2)
		} finally {
			vi.useRealTimers()
		}
	})

	test("late response after timeout: silently dropped, no double-telemetry", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)
		vi.useFakeTimers()
		try {
			const promise = client.echo("hi").catch((e) => e)
			await vi.advanceTimersByTimeAsync(0)
			const { requestId, fromUid } = getLastRequest()

			// Trigger timeout first.
			await vi.advanceTimersByTimeAsync(90_000 + 100)
			await promise

			// Now a late response arrives — must be silently dropped.
			emitMessage(makeResponse(requestId, fromUid, "late!"))
			// Use vi-aware flush since fake timers are still active.
			await vi.advanceTimersByTimeAsync(1)

			expect(sink.records).toHaveLength(1)
			expect(sink.records[0].status).toBe("timeout")
		} finally {
			vi.useRealTimers()
		}
	})

	test("out-of-order responses: each correlates to its requestId; telemetry per-request", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)

		const p1 = client.echo("a")
		await flush()
		const r1 = getLastRequest()
		const p2 = client.multiply(2, 3)
		await flush()
		const r2 = getLastRequest()

		// Reply to req2 first, then req1.
		emitMessage(makeResponse(r2.requestId, r2.fromUid, 6))
		emitMessage(makeResponse(r1.requestId, r1.fromUid, "echo:a"))

		await expect(p2).resolves.toBe(6)
		await expect(p1).resolves.toBe("echo:a")

		expect(sink.records).toHaveLength(2)
		expect(sink.records.every((r) => r.status === "success")).toBe(true)
		// Records are written in completion order (req2 first, req1 second).
		expect(sink.records[0].method).toBe("multiply")
		expect(sink.records[1].method).toBe("echo")
	})

	test("default sink (LoggingTelemetrySink): emits via logger when no explicit sink", async () => {
		// No telemetry sink param — production callers rely on this default.
		const { logger, calls } = makeSpyLogger()
		const client = new TestClient(undefined, logger)
		const promise = client.echo("hi")
		await flush()
		const { requestId, fromUid } = getLastRequest()
		emitMessage(makeResponse(requestId, fromUid, "echo:hi"))
		await expect(promise).resolves.toBe("echo:hi")

		// LoggingTelemetrySink should have logged the success terminal
		// at Debug level via the spy logger.
		const telemetryCall = calls.find(([src]) => src === "offscreen-telemetry")
		expect(telemetryCall).toBeDefined()
		expect(telemetryCall![1]).toBe(LogLevel.Debug) // success → Debug
		const sanitizedRecord = telemetryCall![2] as RequestTelemetry
		expect(sanitizedRecord.method).toBe("echo")
		expect(sanitizedRecord.status).toBe("success")
	})

	test("sanitizer drops untrusted detail strings", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)
		const sendMessageMock = captureMessage()
		sendMessageMock.mockRejectedValueOnce(new Error("attacker-controlled error message with ; rm -rf /"))

		await expect(client.echo("hi")).rejects.toBeDefined()

		// MemoryTelemetrySink stores SANITIZED records; the detail is
		// the static "sendMessage_threw" category, NOT the error.message
		// from the rejection.
		expect(sink.records).toHaveLength(1)
		expect(sink.records[0].detail).toBe("sendMessage_threw")
		expect(JSON.stringify(sink.records[0])).not.toContain("rm -rf")
	})

	test("LoggingTelemetrySink: Info for anomaly statuses, Debug for normal", () => {
		const { logger, calls } = makeSpyLogger()
		const sink = new LoggingTelemetrySink(logger)

		sink.recordTerminal({ method: "x", requestId: 1, startedAtMs: 0, endedAtMs: 1, status: "success" })
		sink.recordTerminal({ method: "x", requestId: 2, startedAtMs: 0, endedAtMs: 1, status: "rejected" })
		sink.recordTerminal({ method: "x", requestId: 3, startedAtMs: 0, endedAtMs: 1, status: "timeout", detail: "timeout_fired" })
		sink.recordTerminal({
			method: "x",
			requestId: 4,
			startedAtMs: 0,
			endedAtMs: 1,
			status: "disconnected",
			detail: "client_disconnect",
		})
		sink.recordTerminal({ method: "x", requestId: 5, startedAtMs: 0, endedAtMs: 1, status: "send_failed", detail: "sendMessage_threw" })

		expect(calls).toHaveLength(5)
		expect(calls[0][1]).toBe(LogLevel.Debug) // success
		expect(calls[1][1]).toBe(LogLevel.Debug) // rejected (remote-error path is normal flow)
		expect(calls[2][1]).toBe(LogLevel.Info) // timeout
		expect(calls[3][1]).toBe(LogLevel.Info) // disconnected
		expect(calls[4][1]).toBe(LogLevel.Info) // send_failed
	})
})

/**
 * Leak guards for the unified correlator.
 *
 * The two transports used to track timers differently (background: a timer
 * handle inside the pending entry; offscreen: a separate `requestTimers`
 * sidecar). The shared core folds both into ONE pending entry whose timer is
 * cleared whenever the entry is settled. These guards pin the invariant the
 * unification depends on: every terminal path leaves the pending map empty AND
 * leaves no armed timer behind that could fire a second, false terminal later.
 * Probing `pendingCount` is intentional — a structural leak guard, not a
 * behavior assertion. (D7: the offscreen sidecar is removed here, in the same
 * change as these guards.)
 */
describe("leak guards for the unified correlator (single pending entry)", () => {
	// biome-ignore lint/suspicious/noExplicitAny: probing the correlator's pending count
	const pendingCount = (c: TestClient) => (c as any).pendingCount as number

	test("success leaves the pending map empty", async () => {
		const client = new TestClient(new MemoryTelemetrySink())
		const promise = client.echo("hi")
		await flush()
		const { requestId, fromUid } = getLastRequest()
		emitMessage(makeResponse(requestId, fromUid, "ok"))
		await promise
		expect(pendingCount(client)).toBe(0)
	})

	test("remote error leaves the pending map empty", async () => {
		const client = new TestClient(new MemoryTelemetrySink())
		const promise = client.echo("hi").catch(() => undefined)
		await flush()
		const { requestId, fromUid } = getLastRequest()
		emitMessage(makeError(requestId, fromUid, "boom"))
		await promise
		expect(pendingCount(client)).toBe(0)
	})

	test("send_failed evicts the entry synchronously", async () => {
		const client = new TestClient(new MemoryTelemetrySink())
		captureMessage().mockRejectedValueOnce(new Error("offscreen gone"))
		await expect(client.echo("hi")).rejects.toBeDefined()
		expect(pendingCount(client)).toBe(0)
	})

	test("send_failed leaves NO armed timer — no false timeout fires 90s later (D7)", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)
		vi.useFakeTimers()
		try {
			captureMessage().mockRejectedValueOnce(new Error("offscreen gone"))
			await client.echo("hi").catch(() => undefined)
			expect(sink.records).toHaveLength(1)
			expect(sink.records[0].status).toBe("send_failed")
			// A leaked timer would fire a SECOND terminal (timeout) here.
			await vi.advanceTimersByTimeAsync(90_000 + 100)
			expect(sink.records).toHaveLength(1)
			expect(pendingCount(client)).toBe(0)
		} finally {
			vi.useRealTimers()
		}
	})

	test("disconnect leaves NO armed timers — no false timeouts fire later (D7)", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)
		vi.useFakeTimers()
		try {
			const p1 = client.echo("a").catch(() => undefined)
			const p2 = client.multiply(1, 2).catch(() => undefined)
			await vi.advanceTimersByTimeAsync(0)
			client.disconnect()
			await Promise.all([p1, p2])
			expect(sink.records).toHaveLength(2)
			expect(sink.records.every((r) => r.status === "disconnected")).toBe(true)
			// Both timers must be cleared — advancing past the ceiling adds nothing.
			await vi.advanceTimersByTimeAsync(90_000 + 100)
			expect(sink.records).toHaveLength(2)
			expect(pendingCount(client)).toBe(0)
		} finally {
			vi.useRealTimers()
		}
	})

	test("timeout fire evicts the entry (no stale entry behind the fired timer)", async () => {
		const client = new TestClient(new MemoryTelemetrySink())
		vi.useFakeTimers()
		try {
			const promise = client.echo("hi").catch(() => undefined)
			await vi.advanceTimersByTimeAsync(0)
			await vi.advanceTimersByTimeAsync(90_000 + 100)
			await promise
			expect(pendingCount(client)).toBe(0)
		} finally {
			vi.useRealTimers()
		}
	})
})
