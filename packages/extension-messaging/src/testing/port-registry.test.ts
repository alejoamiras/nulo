import { describe, expect, test, vi } from "vitest"
import { MessageType } from "../messages"
import { wrapParams } from "../utils"
import { PortRegistry } from "./port-registry"

const NAME = "svc"
const request = (requestId: number) => ({ type: MessageType.Request, content: { requestId, method: "echo", params: wrapParams(["x"]) } })
const drain = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("PortRegistry — the guarantees port-client tests lean on", () => {
	test("ports under one name are independent, and closeAll closes only the ports live when called", () => {
		const registry = new PortRegistry()
		const a = registry.open(NAME)
		const b = registry.open(NAME)
		const onA = vi.fn()
		const onB = vi.fn()
		a.onDisconnect.addListener(onA)
		b.onDisconnect.addListener(onB)

		registry.remoteClose(a)
		registry.remoteClose(a)
		expect(onA).toHaveBeenCalledTimes(1)
		expect(onB).not.toHaveBeenCalled()
		expect([...(registry.live.get(NAME) ?? [])]).toEqual([b])

		// A client reconnects from inside its disconnect listener; that replacement must survive.
		b.onDisconnect.addListener(() => registry.open(NAME))
		registry.closeAll(NAME)

		expect(onB).toHaveBeenCalledTimes(1)
		expect(registry.opened.get(NAME)).toHaveLength(3)
		expect(registry.live.get(NAME)?.size).toBe(1)

		// Chrome never tells the end that closed the port.
		const [survivor] = [...(registry.live.get(NAME) ?? [])]
		const onSurvivor = vi.fn()
		survivor.onDisconnect.addListener(onSurvivor)
		survivor.disconnect()
		registry.remoteClose(survivor)
		expect(onSurvivor).not.toHaveBeenCalled()
	})

	test("a port closed after posting is never answered, and refuses further sends", async () => {
		const registry = new PortRegistry({ answer: "microtask" })
		const port = registry.open(NAME)
		const received = vi.fn()
		port.onMessage.addListener(received)

		port.postMessage(request(1))
		registry.remoteClose(port)
		await drain()

		expect(registry.posted).toHaveLength(1)
		expect(registry.answered).toHaveLength(0)
		expect(received).not.toHaveBeenCalled()
		expect(() => port.postMessage(request(2))).toThrow("disconnected port")
	})
})
