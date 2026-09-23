import { ValidationError } from "@nulo/extension-messaging/errors"
import { MessageType, type ResponseMessage } from "@nulo/extension-messaging/messages"
import { describe, expect, test } from "vitest"
import { capturePortMessage, emitPortMessage } from "../../../../tests/vitest.setup"
import { NetworkServiceClient } from "./client"
import { NETWORK_SERVICE_NAME } from "./spec"

const drain = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe("NetworkServiceClient — schema validation on both directions", () => {
	test("invalid params throw before any request leaves the client", async () => {
		const client = new NetworkServiceClient()
		client.connect()
		await drain()
		const sent = capturePortMessage(NETWORK_SERVICE_NAME)
		const before = sent.mock.calls.length
		await expect(client.getNetwork(123 as never)).rejects.toBeInstanceOf(ValidationError)
		expect(sent.mock.calls.length).toBe(before)
	})

	test("an invalid result rejects with ValidationError", async () => {
		const client = new NetworkServiceClient()
		const promise = client.getNetworks()
		await drain()
		const calls = capturePortMessage(NETWORK_SERVICE_NAME).mock.calls
		const requestId = (calls[calls.length - 1][0] as { content: { requestId: number } }).content.requestId
		emitPortMessage(NETWORK_SERVICE_NAME, {
			type: MessageType.Response,
			content: { requestId, result: { not: "an array" } },
		} as ResponseMessage<{ [k: string]: () => unknown }>)
		await expect(promise).rejects.toBeInstanceOf(ValidationError)
	})
})
