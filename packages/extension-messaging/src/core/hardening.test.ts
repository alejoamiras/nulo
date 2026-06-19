/**
 * Security hardening sweep over the unified RPC seam (phase 5).
 *
 * Adversarial inputs from a (hypothetically) compromised first-party context:
 * malformed envelopes, hostile event names, replayed responses, and
 * prototype-pollution-flavored method/requestId values. The invariant: the seam
 * drops them safely — no crash, no unintended invocation, no double-settle.
 */

import { describe, expect, test } from "vitest"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceClient } from "../background/client"
import { Service } from "../background/service"
import { MessageType, type ResponseMessage } from "../messages"
import { wrapParams } from "../utils"
import { capturePortMessage, connectServiceClient, emitPortMessage, silentLogger } from "../testing/transport-harness"
import { defineRpcMethods } from "./rpc-methods"

const SERVICE = "harden-svc"

type Methods = { echo: (s: string) => string }
type Events = { onPing: { n: number } }

class HClient extends ServiceClient<Methods, Events> {
	public onPing = new EventHandler<{ n: number }>()
	public constructor() {
		super(SERVICE, silentLogger)
	}
	public echo(s: string): Promise<string> {
		return this.request("echo", s)
	}
}

class HService extends Service<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()("echo")
	public onPing = new EventHandler<{ n: number }>()
	public constructor() {
		super(SERVICE, silentLogger)
	}
	public echo(s: string): string {
		return `echo:${s}`
	}
}

async function flush() {
	await new Promise((r) => setTimeout(r, 0))
	await new Promise((r) => setTimeout(r, 0))
}

function lastRequestId(): number {
	const calls = capturePortMessage(SERVICE).mock.calls
	return (calls.at(-1)?.[0] as { content: { requestId: number } }).content.requestId
}

// ── Client: hostile inbound ───────────────────────────────────────────

describe("client — hostile inbound messages", () => {
	test("a valid event invokes the matching handler", async () => {
		const c = new HClient()
		await c.connect()
		const seen: Array<{ n: number }> = []
		c.onPing.add((p) => seen.push(p))
		emitPortMessage(SERVICE, { type: MessageType.Event, content: { event: "onPing", payload: { n: 1 } } })
		expect(seen).toEqual([{ n: 1 }])
	})

	test.each([
		"toString",
		"constructor",
		"__proto__",
		"connect",
		"disconnect",
		"nonexistent",
	])("hostile event name %s is dropped (no throw, no invoke)", async (event) => {
		const c = new HClient()
		await c.connect()
		const seen: unknown[] = []
		c.onPing.add((p) => seen.push(p))
		expect(() => emitPortMessage(SERVICE, { type: MessageType.Event, content: { event, payload: { n: 9 } } })).not.toThrow()
		expect(seen).toHaveLength(0)
	})

	test("a replayed response for a settled id is dropped (idempotent, no double-settle)", async () => {
		const c = new HClient()
		await c.connect()
		const promise = c.echo("hi")
		const id = lastRequestId()
		emitPortMessage(SERVICE, { type: MessageType.Response, content: { requestId: id, result: "first" } } as ResponseMessage<Methods>)
		await expect(promise).resolves.toBe("first")
		// Replay the same id with a different result — must be silently dropped.
		expect(() =>
			emitPortMessage(SERVICE, {
				type: MessageType.Response,
				content: { requestId: id, result: "second" },
			} as ResponseMessage<Methods>),
		).not.toThrow()
	})

	test.each([
		null,
		undefined,
		42,
		"str",
		{},
		{ type: MessageType.Response },
		{ type: 999, content: {} },
	])("malformed inbound %s is dropped without throwing", async (msg) => {
		const c = new HClient()
		await c.connect()
		expect(() => emitPortMessage(SERVICE, msg)).not.toThrow()
	})
})

// ── Service: hostile requests ─────────────────────────────────────────

describe("service — hostile requests", () => {
	test.each([0, -1, 1.5 * 0 - 5, "1", null, undefined, {}, [], true])("hostile requestId %s → no response", async (requestId) => {
		new HService()
		const client = connectServiceClient(SERVICE)
		client.sendToService({ type: MessageType.Request, content: { requestId, method: "echo", params: wrapParams(["x"]) } })
		await flush()
		expect(client.captureResponse()).not.toHaveBeenCalled()
	})

	test.each([
		"__proto__",
		"constructor",
		"prototype",
		"hasOwnProperty",
		"valueOf",
		"start",
		"emit",
		"echo ",
	])("hostile / non-registered method %s → no response, not invoked", async (method) => {
		new HService()
		const client = connectServiceClient(SERVICE)
		client.sendToService({ type: MessageType.Request, content: { requestId: 1, method, params: wrapParams([]) } })
		await flush()
		expect(client.captureResponse()).not.toHaveBeenCalled()
	})

	test("a registered method with hostile params (array-shaped object) still replies, never crashes", async () => {
		new HService()
		const client = connectServiceClient(SERVICE)
		// well-formed wrap of one arg
		client.sendToService({ type: MessageType.Request, content: { requestId: 1, method: "echo", params: wrapParams(["ok"]) } })
		await flush()
		const resp = client.captureResponse().mock.calls.at(-1)?.[0] as { content: { result?: unknown } }
		expect(resp.content.result).toBe("echo:ok")
	})
})
