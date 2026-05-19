import { describe, test, expect, vi, beforeEach } from "vitest"
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@nulo/wallet-core/logger"
import { captureMessage, emitMessage } from "@/../tests/vitest.setup"
import { MessageType } from "@nulo/extension-messaging/messages"
import {
	LoggingTelemetrySink,
	MemoryTelemetrySink,
	ServiceClient,
	type RequestTelemetry,
	type TelemetrySink,
} from "@nulo/extension-messaging/offscreen"

const silentLogger: ILogger = {
	log: async () => {},
} as unknown as ILogger

/** Spy logger that records every log call. Used to verify that the
 *  default `LoggingTelemetrySink` actually fires through the wallet's
 *  `ILogger` rather than discarding events. */
function makeSpyLogger(): { logger: ILogger; calls: Array<[string, LogLevel, ...unknown[]]> } {
	const calls: Array<[string, LogLevel, ...unknown[]]> = []
	const logger: ILogger = {
		log: (source: string, level: LogLevel, ...data: unknown[]): void => {
			calls.push([source, level, ...data])
		},
	}
	return { logger, calls }
}

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
		// nothing to reset — fake-browser is reset globally in tests/vitest.setup
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
		await expect(promise).resolves.toBe("remote_failed")

		expect(sink.records).toHaveLength(1)
		expect(sink.records[0].status).toBe("rejected")
	})

	test("send_failed terminal: chrome.runtime.sendMessage rejection cleans up SYNCHRONOUSLY", async () => {
		const sink = new MemoryTelemetrySink()
		const client = new TestClient(sink)
		const sendMessageMock = captureMessage()
		// Make sendMessage reject — typical cause: offscreen document gone.
		sendMessageMock.mockRejectedValueOnce(new Error("offscreen closed before fully loading"))

		await expect(client.echo("hi")).rejects.toMatch(/Offscreen send failed: echo/)

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
		await expect(p1).resolves.toBe("Client disconnected")
		await expect(p2).resolves.toBe("Client disconnected")

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
			await expect(promise).resolves.toMatch(/Offscreen request timed out: echo/)

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
			await expect(longPromise).resolves.toMatch(/Offscreen request timed out: multiply/)
			expect(sink.records).toHaveLength(1)
			expect(sink.records[0].status).toBe("timeout")

			// And `echo` (no override) still uses the default 90s.
			const echoPromise = client.echo("hi").catch((e) => e)
			await vi.advanceTimersByTimeAsync(0)
			await vi.advanceTimersByTimeAsync(90_000 + 100)
			await expect(echoPromise).resolves.toMatch(/Offscreen request timed out: echo/)
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

	test("default sink (LoggingTelemetrySink, M4.4-followup): emits via logger when no explicit sink", async () => {
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
