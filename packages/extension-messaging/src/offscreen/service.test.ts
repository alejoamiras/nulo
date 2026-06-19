/**
 * Contract tests for the offscreen (SW ↔ offscreen sendMessage) Service.
 *
 * New coverage (no offscreen service-side suite existed before). The point of
 * this suite is to pin the CURRENT behavior — including the two divergences
 * from the background service that the unification work will resolve:
 *
 *  1. Error responses carry a flat `error` string ONLY — never the structured
 *     `errorPayload`, even when a WalletError subclass is thrown. (Background
 *     emits errorPayload; offscreen does not — fixed additively in a later phase.)
 *  2. The A6 send fallback is 2-tier then SWALLOW (success → jsonStringify →
 *     give up), where the background side has a 3rd error-response tier.
 *
 * Drives the service by feeding `chrome.runtime.onMessage` via `emitMessage`
 * and reading responses via `captureMessage`.
 */

import { describe, expect, test, vi } from "vitest"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ServiceCollection } from "@nulo/wallet-core/base"
import { UserRejectedError } from "../errors"
import { MessageType } from "../messages"
import { wrapParams } from "../utils"
import { captureMessage, emitMessage, silentLogger } from "../testing/transport-harness"
import { Service } from "./service"

const SERVICE = "offscreen-svc"
const CLIENT = "client-uid"

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
		from: CLIENT,
		to: SERVICE,
		content: { requestId, method, params: wrapParams(params) },
	}
}

type WireResponse = {
	type: number
	from?: string
	to?: string
	content: { requestId: number; result?: unknown; error?: string; errorPayload?: unknown; resultIsJson?: boolean }
}

/** All Response-typed messages the service sent (ignores keepalive strings + events). */
function responses(): WireResponse[] {
	return captureMessage()
		.mock.calls.map((c) => c[0] as WireResponse)
		.filter((m) => typeof m === "object" && m !== null && m.type === MessageType.Response)
}

// ── Envelope validation + routing ─────────────────────────────────────

describe("envelope validation", () => {
	test("ignores a message not addressed to this service (no response)", async () => {
		new TestService()
		emitMessage({ ...request(1, "echo", ["hi"]), to: "another-service" })
		await flush()
		expect(responses()).toHaveLength(0)
	})

	test("ignores a request with no `from` (no response)", async () => {
		new TestService()
		emitMessage({ type: MessageType.Request, to: SERVICE, content: { requestId: 1, method: "echo", params: wrapParams(["hi"]) } })
		await flush()
		expect(responses()).toHaveLength(0)
	})

	test("ignores a request for an unknown method name (no response)", async () => {
		new TestService()
		emitMessage(request(1, "nonexistent" as keyof Methods, []))
		await flush()
		expect(responses()).toHaveLength(0)
	})
})

// ── Success path ──────────────────────────────────────────────────────

describe("success path", () => {
	test("invokes the method and replies with the result, addressed back to the caller", async () => {
		new TestService()
		emitMessage(request(7, "echo", ["hi"]))
		await flush()

		const all = responses()
		expect(all).toHaveLength(1)
		expect(all[0].content.requestId).toBe(7)
		expect(all[0].content.result).toBe("echo:hi")
		expect(all[0].from).toBe(SERVICE)
		expect(all[0].to).toBe(CLIENT)
	})
})

// ── Error path (offscreen emits NO errorPayload — divergence) ─────────

describe("error path (no structured payload — pinned divergence)", () => {
	test("WalletError throw still serializes ONLY a flat error string (no errorPayload)", async () => {
		new TestService()
		emitMessage(request(1, "walletFail", []))
		await flush()

		const resp = responses().at(-1)!
		expect(resp.content.error).toBe("user said no")
		// PINNED divergence: unlike the background service, offscreen does not
		// attach errorPayload even for a WalletError subclass.
		expect(resp.content.errorPayload).toBeUndefined()
	})

	test("plain Error throw replies with the flat error string", async () => {
		new TestService()
		emitMessage(request(1, "plainFail", []))
		await flush()

		const resp = responses().at(-1)!
		expect(resp.content.error).toBe("plain boom")
		expect(resp.content.errorPayload).toBeUndefined()
	})
})

// ── A6 send fallback (offscreen — 2-tier then SWALLOW) ────────────────

describe("A6 send fallback (offscreen — 2-tier then swallow)", () => {
	test("tier 1: sendMessage succeeds — single response, no resultIsJson", async () => {
		new TestService()
		emitMessage(request(1, "echo", ["hi"]))
		await flush()

		const all = responses()
		expect(all).toHaveLength(1)
		expect(all[0].content.resultIsJson).toBeUndefined()
	})

	test("tier 2: first send rejects → retries with jsonStringify + resultIsJson", async () => {
		new TestService()
		captureMessage().mockRejectedValueOnce(new Error("DataCloneError"))
		emitMessage(request(1, "echo", ["hi"]))
		await flush()

		const all = responses()
		expect(all).toHaveLength(2)
		const fallback = all.at(-1)!
		expect(fallback.content.resultIsJson).toBe(true)
		expect(JSON.parse(fallback.content.result as string)).toBe("echo:hi")
	})

	test("tier 3 (swallow): every send rejects → gives up with NO error response", async () => {
		new TestService()
		captureMessage().mockRejectedValue(new Error("SW dead"))
		emitMessage(request(1, "echo", ["hi"]))
		await flush()

		// Exactly two attempts (original + jsonStringify fallback), then
		// swallow — the background side would send a 3rd error response here.
		expect(captureMessage()).toHaveBeenCalledTimes(2)
	})
})

// ── Event emit ────────────────────────────────────────────────────────

describe("event emit", () => {
	test("broadcasts the event over sendMessage and invokes the local handler", async () => {
		const svc = new TestService()
		const seen: Array<{ n: number }> = []
		svc.ping.add((p) => seen.push(p))

		svc.emitPing(42)
		await flush()

		const event = captureMessage()
			.mock.calls.map((c) => c[0] as { type: number; from?: string; content: { event: string; payload: { n: number } } })
			.find((m) => typeof m === "object" && m !== null && m.type === MessageType.Event)
		expect(event).toBeDefined()
		expect(event!.from).toBe(SERVICE)
		expect(event!.content.event).toBe("ping")
		expect(event!.content.payload).toEqual({ n: 42 })
		expect(seen).toEqual([{ n: 42 }])
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
