/**
 * Pre-extraction pins for the missing-key recovery tail the plan-2
 * decomposition moves (codex audit condition): the retry runs EXACTLY once —
 * a second missing-key rejection is terminal — and the provisioned key bytes
 * are zeroized on that exit path too.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ServiceClient } from "@nulo/extension-messaging/offscreen"
import type { ILogger } from "@nulo/wallet-core/logger"
import { PXE_STORE_KEY_MISSING, type NetworkInfo } from "./chain-runtime"
import { PxeServiceClientBase } from "./client"

const noopLogger: ILogger = { log: () => {} }
const net: NetworkInfo = { profileId: "p1", chainId: 31337, rpcUrl: "http://n/1" }

describe("missing-key recovery terminal-retry pin", () => {
	// biome-ignore lint/suspicious/noExplicitAny: transport stub records raw wire calls
	let wire: Array<{ method: string; args: any[] }>
	// biome-ignore lint/suspicious/noExplicitAny: per-call behavior queue
	let behaviors: Array<(method: string, args: any[]) => unknown>

	beforeEach(() => {
		vi.stubGlobal("self", globalThis)
		vi.stubGlobal("chrome", {
			runtime: {
				onMessage: { addListener: () => {} },
				connect: () => ({ onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} }, postMessage: () => {} }),
			},
		})
		wire = []
		behaviors = []
		const impl = async function (this: unknown, method: unknown, ...args: unknown[]) {
			wire.push({ method: method as string, args })
			const behavior = behaviors.shift()
			if (behavior) return behavior(method as string, args)
			return []
		}
		vi.spyOn(ServiceClient.prototype as unknown as { request: (...a: unknown[]) => Promise<unknown> }, "request").mockImplementation(
			impl,
		)
		vi.spyOn(
			Object.getPrototypeOf(ServiceClient.prototype) as { request: (...a: unknown[]) => Promise<unknown> },
			"request",
		).mockImplementation(impl)
	})

	test("a second missing-key rejection on the retry is terminal, and the key is zeroized", async () => {
		const key = new Uint8Array(32).fill(7)
		// 1: original send → marker. 2: provision → ok. 3: retry → marker AGAIN.
		behaviors.push(() => {
			throw new Error(`${PXE_STORE_KEY_MISSING}: no store key provisioned for profile p1`)
		})
		behaviors.push(() => undefined)
		behaviors.push(() => {
			throw new Error(`${PXE_STORE_KEY_MISSING}: still missing`)
		})
		const client = new PxeServiceClientBase(noopLogger)
		client.setGenerationProvider(async () => "gen-A")
		client.setStoreKeyProvider(async () => ({ key, generation: "gen-A" }))

		await expect(client.getSenders(net)).rejects.toThrowError(`${PXE_STORE_KEY_MISSING}: still missing`)
		// Exactly three wire calls: send, provision, single retry — never a second recovery.
		expect(wire.map((w) => w.method)).toEqual(["getSenders", "provisionChainStoreKey", "getSenders"])
		expect([...key]).toEqual(new Array(32).fill(0))
	})
})
