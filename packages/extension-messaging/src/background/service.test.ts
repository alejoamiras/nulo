/**
 * Contract tests for the background (popup ↔ SW Port) Service.
 *
 * New coverage (no service-side suite existed before the unification work):
 *  - Envelope validation + routing (bad type / missing content / unknown method)
 *  - Success response shape (result, jsonSanitized)
 *  - Error response shape — WalletError emits structured `errorPayload`;
 *    plain Error does NOT (characterizes the bg side of the error divergence)
 *  - A6 send fallback: 3-tier (structured-clone fail → jsonStringify →
 *    error-response → log-and-drop)
 *  - Event emit fan-out to connected clients
 *  - ensureInitialized success + 30s timeout
 *
 * Drives the service via `connectServiceClient` (fires `onConnect` with a
 * fake client port and exposes its inbound/response channels).
 */

import { describe, expect, test, vi } from "vitest"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ServiceCollection } from "@nulo/wallet-core/base"
import { UserRejectedError } from "../errors"
import { MessageType } from "../messages"
import { wrapParams } from "../utils"
import { connectServiceClient, silentLogger } from "../testing/transport-harness"
import { Service } from "./service"

const SERVICE = "test-svc"

type Methods = {
	echo: (msg: string) => string
	walletFail: () => never
	plainFail: () => never
}
type Events = {
	ping: { n: number }
}

class TestService extends Service<Methods, Events> {
	public ping = new EventHandler<{ n: number }>()

	public constructor() {
		super(SERVICE, silentLogger)
	}

	public echo(msg: string): string {
		return `echo:${msg}`
	}

	public walletFail(): never {
		throw new UserRejectedError("user said no")
	}

	public plainFail(): never {
		throw new Error("plain boom")
	}

	public emitPing(n: number): void {
		this.emit("ping", { n })
	}

	public callEnsureInitialized(): Promise<void> {
		return this.ensureInitialized()
	}
}

async function flush() {
	await new Promise((r) => setTimeout(r, 0))
	await new Promise((r) => setTimeout(r, 0))
	await new Promise((r) => setTimeout(r, 0))
}

function request(requestId: number, method: keyof Methods, params: unknown[]) {
	return {
		type: MessageType.Request,
		content: { requestId, method, params: wrapParams(params) },
	}
}

/** The most recent message the service postMessaged back to the client. */
function lastResponse(handle: { captureResponse: () => { mock: { calls: unknown[][] } } }) {
	const calls = handle.captureResponse().mock.calls
	return calls.at(-1)?.[0] as {
		type: number
		content: { requestId: number; result?: unknown; error?: string; errorPayload?: unknown; resultIsJson?: boolean }
	}
}

// ── Envelope validation + routing ─────────────────────────────────────

describe("envelope validation", () => {
	test("ignores a non-request message type (no response)", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.sendToService({ type: MessageType.Response, content: { requestId: 1 } })
		await flush()
		expect(client.captureResponse()).not.toHaveBeenCalled()
	})

	test("ignores a request with missing content (no response)", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.sendToService({ type: MessageType.Request })
		await flush()
		expect(client.captureResponse()).not.toHaveBeenCalled()
	})

	test("ignores a request for an unknown method name (no response)", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.sendToService(request(1, "nonexistent" as keyof Methods, []))
		await flush()
		expect(client.captureResponse()).not.toHaveBeenCalled()
	})

	test("ignores a request with falsy requestId (no response)", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.sendToService(request(0, "echo", ["hi"]))
		await flush()
		expect(client.captureResponse()).not.toHaveBeenCalled()
	})

	test("only the service whose name matches accepts the connection", () => {
		new TestService()
		// A port named for a different service must not be adopted.
		const other = connectServiceClient("some-other-service")
		other.sendToService(request(1, "echo", ["hi"]))
		expect(other.captureResponse()).not.toHaveBeenCalled()
	})
})

// ── Success path ──────────────────────────────────────────────────────

describe("success path", () => {
	test("invokes the method and replies with the result", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.sendToService(request(7, "echo", ["hi"]))
		await flush()

		const resp = lastResponse(client)
		expect(resp.type).toBe(MessageType.Response)
		expect(resp.content.requestId).toBe(7)
		expect(resp.content.result).toBe("echo:hi")
		expect(resp.content.error).toBeUndefined()
	})
})

// ── Error path (bg emits structured errorPayload) ─────────────────────

describe("error path", () => {
	test("WalletError throw serializes a structured errorPayload", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.sendToService(request(1, "walletFail", []))
		await flush()

		const resp = lastResponse(client)
		expect(resp.content.error).toBe("user said no")
		expect(resp.content.errorPayload).toEqual({ code: "USER_REJECTED", message: "user said no", details: undefined })
	})

	test("plain Error throw carries NO errorPayload (flat string only)", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.sendToService(request(1, "plainFail", []))
		await flush()

		const resp = lastResponse(client)
		expect(resp.content.error).toBe("plain boom")
		expect(resp.content.errorPayload).toBeUndefined()
	})
})

// ── A6 send fallback (3-tier on the background side) ──────────────────

describe("A6 send fallback (background — 3-tier)", () => {
	test("tier 1: structured clone succeeds — single send, no resultIsJson", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.sendToService(request(1, "echo", ["hi"]))
		await flush()

		expect(client.captureResponse()).toHaveBeenCalledTimes(1)
		expect(lastResponse(client).content.resultIsJson).toBeUndefined()
	})

	test("tier 2: postMessage throws once → retries with jsonStringify + resultIsJson", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.captureResponse().mockImplementationOnce(() => {
			throw new Error("DataCloneError")
		})
		client.sendToService(request(1, "echo", ["hi"]))
		await flush()

		expect(client.captureResponse()).toHaveBeenCalledTimes(2)
		const fallback = lastResponse(client)
		expect(fallback.content.resultIsJson).toBe(true)
		expect(JSON.parse(fallback.content.result as string)).toBe("echo:hi")
	})

	test("tier 3: postMessage throws twice then succeeds → sends a clean error response", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client
			.captureResponse()
			.mockImplementationOnce(() => {
				throw new Error("send1")
			})
			.mockImplementationOnce(() => {
				throw new Error("send2")
			})
		client.sendToService(request(1, "echo", ["hi"]))
		await flush()

		expect(client.captureResponse()).toHaveBeenCalledTimes(3)
		const last = lastResponse(client)
		expect(last.content.result).toBeUndefined()
		expect(String(last.content.error)).toMatch(/Response not serializable/)
	})

	test("tier 3 (all throw): every postMessage throws → degrades to log-and-drop without escaping", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.captureResponse().mockImplementation(() => {
			throw new Error("disconnected")
		})
		// Must not throw out of the service's message handler.
		expect(() => client.sendToService(request(1, "echo", ["hi"]))).not.toThrow()
		await flush()

		// original + jsonStringify fallback + error-response attempt = 3 tries.
		expect(client.captureResponse()).toHaveBeenCalledTimes(3)
	})
})

// ── Fix (c): malformed params reply with a structured error (no hang) ──

describe("malformed params (fix c — no silent hang)", () => {
	test("null params for a valid method replies with a structured ValidationError", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.sendToService({ type: MessageType.Request, content: { requestId: 9, method: "echo", params: null } })
		await flush()

		const resp = lastResponse(client)
		expect(resp.content.requestId).toBe(9)
		expect(resp.content.error).toBe("Invalid request params")
		// Background emits the structured payload so the client can instanceof it.
		expect((resp.content.errorPayload as { code: string }).code).toBe("VALIDATION")
	})

	test("non-object params replies with a structured ValidationError", async () => {
		new TestService()
		const client = connectServiceClient(SERVICE)
		client.sendToService({ type: MessageType.Request, content: { requestId: 10, method: "echo", params: "oops" } })
		await flush()

		expect(lastResponse(client).content.error).toBe("Invalid request params")
	})
})

// ── Event emit ────────────────────────────────────────────────────────

describe("event emit", () => {
	test("fans the event out to every connected client", async () => {
		const svc = new TestService()
		const a = connectServiceClient(SERVICE)
		const b = connectServiceClient(SERVICE)

		svc.emitPing(42)
		await flush()

		for (const handle of [a, b]) {
			const msg = handle.captureResponse().mock.calls.at(-1)?.[0] as {
				type: number
				content: { event: string; payload: { n: number } }
			}
			expect(msg.type).toBe(MessageType.Event)
			expect(msg.content.event).toBe("ping")
			expect(msg.content.payload).toEqual({ n: 42 })
		}
	})

	test("also invokes the local event handler", () => {
		const svc = new TestService()
		const seen: Array<{ n: number }> = []
		svc.ping.add((p) => seen.push(p))
		svc.emitPing(7)
		expect(seen).toEqual([{ n: 7 }])
	})
})

// ── ensureInitialized ─────────────────────────────────────────────────

describe("ensureInitialized", () => {
	test("resolves immediately once started", async () => {
		const svc = new TestService()
		await svc.start({} as unknown as ServiceCollection)
		await expect(svc.callEnsureInitialized()).resolves.toBeUndefined()
	})

	test("throws after the 30s budget when never started", async () => {
		vi.useFakeTimers()
		try {
			const svc = new TestService()
			const p = svc.callEnsureInitialized().catch((e) => e)
			await vi.advanceTimersByTimeAsync(30_000)
			const err = await p
			expect(err).toBeInstanceOf(Error)
			expect((err as Error).message).toBe("Service not initialized")
		} finally {
			vi.useRealTimers()
		}
	})
})
