import { connectStub, PortRegistry } from "@nulo/extension-messaging/testing"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { _resetDocumentLoggerForTests, documentLogger } from "./client"
import { type ILogger, LogLevel } from "@/wallet/logger"

vi.unmock("@/wallet/services/logger/client")

/**
 * The popup, onboarding and offscreen contexts all log through this client — three of the four.
 * Their data crosses an RPC boundary that runs `jsonSanitize` on the way, which destroys every
 * shape `LoggerStore.trim()` knows how to collapse: an Error becomes a plain object still carrying
 * its stack, a typed array becomes a numeric object, Map/Set become arrays. Redaction therefore has
 * to happen HERE, before the send, or it does not happen at all for those contexts.
 */

const SECRET = "correct-horse-battery-staple"

let registry: PortRegistry

beforeEach(() => {
	_resetDocumentLoggerForTests()
	registry = new PortRegistry({ answer: "microtask" })
	;(chrome.runtime.connect as ReturnType<typeof vi.fn>).mockImplementation(connectStub(registry))
})
afterEach(async () => {
	// Every line is answered on a microtask; wait for it so no request keeps a timer.
	await new Promise((resolve) => setTimeout(resolve, 0))
})

/**
 * What reaches the wire — `[method, context, source, level, ...data]` as posted after
 * `jsonSanitize`. The logger client is private to its module, so the transport is observed at
 * `chrome.runtime.connect`.
 */
function captureWire(context: "popup" | "offscreen"): { logger: ILogger; sent: () => unknown[] } {
	return { logger: documentLogger(context), sent: () => registry.posted.flatMap((p) => [p.method, ...p.params]) }
}

describe("documentLogger — redaction before the wire", () => {
	test("blanks a secret key before it crosses the RPC", () => {
		const { logger, sent } = captureWire("popup")

		logger.log("ui", LogLevel.Error, { password: SECRET })

		expect(JSON.stringify(sent())).not.toContain(SECRET)
	})

	test("projects an Error before jsonSanitize can flatten it into a stack-carrying object", () => {
		const { logger, sent } = captureWire("popup")

		logger.log("ui", LogLevel.Error, new Error(`failed for https://rpc.example.com/v2/${SECRET}`))

		expect(sent()[4]).toEqual({ name: "Error", message: "failed for https://rpc.example.com" })
		expect(sent()[4]).not.toBeInstanceOf(Error)
	})

	test("summarises a typed array instead of shipping its bytes", () => {
		const { logger, sent } = captureWire("popup")

		logger.log("ui", LogLevel.Error, { key: new Uint8Array([1, 2, 3, 4]) })

		const wire = JSON.stringify(sent())
		expect(wire).toContain("Uint8Array(4)")
		// The generic walk would have serialized it as {"0":1,"1":2,…}.
		expect(wire).not.toContain('"0":1')
	})

	test("collapses a real Note shape before it leaves the popup", () => {
		const { logger, sent } = captureWire("popup")

		// A COMPLETE Note — the collapse requires contract/txHash/storageSlot/rawContent, so a
		// partial fixture would prove nothing about the real type.
		logger.log("ui", LogLevel.Warn, {
			contract: "0xc",
			storageSlot: "0x1",
			txHash: "0xtx",
			rawContent: [SECRET],
			type: "UintNote",
			content: { amount: SECRET },
		})

		expect(JSON.stringify(sent())).not.toContain(SECRET)
		expect(sent()[4]).toMatchObject({ note: "UintNote", rawContentLen: 1, contentKeys: 1 })
	})

	test("still forwards the routing arguments unchanged", () => {
		const { logger, sent } = captureWire("offscreen")

		logger.log("pxe", LogLevel.Warn, "plain message")

		expect(sent()[0]).toBe("log")
		expect(sent()[1]).toBe("offscreen")
		expect(sent()[2]).toBe("pxe")
		expect(sent()[3]).toBe(LogLevel.Warn)
		expect(sent()[4]).toBe("plain message")
	})
})
