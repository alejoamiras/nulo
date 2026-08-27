import { describe, expect, test } from "vitest"
import { LoggerServiceClient } from "./client"
import { LogLevel } from "@/wallet/logger"

/**
 * The popup, onboarding and offscreen contexts all log through this client — three of the four.
 * Their data crosses an RPC boundary that runs `jsonSanitize` on the way, which destroys every
 * shape `LoggerStore.trim()` knows how to collapse (an Error becomes a plain object carrying its
 * stack; a typed array becomes a numeric object). Redaction therefore has to happen HERE, before
 * the send, or it does not happen at all for those contexts.
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
	// This branch proves the SEAM — that `trim()` runs before the send. What `trim()` recognises
	// grows in the redactor branch above; those assertions live there, on the code that adds them.
	test("applies trim() before the RPC — a redacted key never reaches the wire", () => {
		const client = new LoggerServiceClient("popup")
		const sent = captureSentParams(client)

		client.log("ui", LogLevel.Error, { vk: SECRET })

		expect(JSON.stringify(sent)).not.toContain(SECRET)
		expect(JSON.stringify(sent)).toContain("[vk]")
	})

	test("redacts a NESTED value too, so the walk really runs", () => {
		const client = new LoggerServiceClient("popup")
		const sent = captureSentParams(client)

		client.log("ui", LogLevel.Error, { outer: { inner: { acir: SECRET } } })

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
