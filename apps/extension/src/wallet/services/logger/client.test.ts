import { describe, expect, test } from "vitest"
import { LoggerServiceClient } from "./client"
import { LogLevel } from "@/wallet/logger"

/**
 * The popup, onboarding and offscreen contexts all log through this client — three of the four.
 * Their data crosses an RPC boundary that runs `jsonSanitize` on the way, which destroys every
 * shape `LoggerStore.trim()` knows how to collapse: an Error becomes a plain object still carrying
 * its stack, a typed array becomes a numeric object, Map/Set become arrays. Redaction therefore has
 * to happen HERE, before the send, or it does not happen at all for those contexts.
 */

const SECRET = "correct-horse-battery-staple"

/** Capture what `log()` hands to the transport, without standing up a Port. */
function captureSentParams(client: LoggerServiceClient): unknown[] {
	const sent: unknown[] = []
	// biome-ignore lint/suspicious/noExplicitAny: reaching into the protected transport seam
	;(client as any).request = (...args: unknown[]) => {
		sent.push(...args)
		return Promise.resolve()
	}
	return sent
}

describe("LoggerServiceClient.log — redaction before the wire", () => {
	test("blanks a secret key before it crosses the RPC", () => {
		const client = new LoggerServiceClient("popup")
		const sent = captureSentParams(client)

		client.log("ui", LogLevel.Error, { password: SECRET })

		expect(JSON.stringify(sent)).not.toContain(SECRET)
	})

	test("projects an Error before jsonSanitize can flatten it into a stack-carrying object", () => {
		const client = new LoggerServiceClient("popup")
		const sent = captureSentParams(client)

		client.log("ui", LogLevel.Error, new Error(`failed for https://rpc.example.com/v2/${SECRET}`))

		const wire = JSON.stringify(sent)
		expect(wire).not.toContain(SECRET)
		expect(wire).not.toContain("stack")
	})

	test("summarises a typed array instead of shipping its bytes", () => {
		const client = new LoggerServiceClient("popup")
		const sent = captureSentParams(client)

		client.log("ui", LogLevel.Error, { key: new Uint8Array([1, 2, 3, 4]) })

		const wire = JSON.stringify(sent)
		expect(wire).toContain("Uint8Array(4)")
		// The generic walk would have serialized it as {"0":1,"1":2,…}.
		expect(wire).not.toContain('"0":1')
	})

	test("collapses a Note before it leaves the popup", () => {
		const client = new LoggerServiceClient("popup")
		const sent = captureSentParams(client)

		client.log("ui", LogLevel.Warn, {
			contract: "0xc",
			storageSlot: "0x1",
			rawContent: [SECRET],
			content: { amount: SECRET },
		})

		expect(JSON.stringify(sent)).not.toContain(SECRET)
	})

	test("still forwards the routing arguments unchanged", () => {
		const client = new LoggerServiceClient("offscreen")
		const sent = captureSentParams(client)

		client.log("pxe", LogLevel.Warn, "plain message")

		expect(sent[0]).toBe("log")
		expect(sent[1]).toBe("offscreen")
		expect(sent[2]).toBe("pxe")
		expect(sent[3]).toBe(LogLevel.Warn)
		expect(sent[4]).toBe("plain message")
	})
})
