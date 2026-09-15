/**
 * `proveTx`'s trailing `proveId` rides the positional RPC codec unchanged: it
 * is the fourth wire argument, survives a JSON round-trip, and is absent (not
 * a placeholder) when the caller omits it.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { ServiceClient } from "@nulo/extension-messaging/offscreen"
import type { ILogger } from "@nulo/wallet-core/logger"
import type { NetworkInfo } from "./chain-runtime"
import { PxeServiceClientBase } from "./client"

const noopLogger: ILogger = { log: () => {} }
const net: NetworkInfo = { profileId: "p1", chainId: 31337, rpcUrl: "http://n/1" }
const PROVE_ID = "11111111-2222-4333-8444-555555555555"
const SENTINEL = "wire captured"

describe("PxeServiceClientBase.proveTx proveId codec", () => {
	let wire: unknown[][]

	beforeEach(() => {
		vi.stubGlobal("self", globalThis)
		vi.stubGlobal("chrome", {
			runtime: {
				onMessage: { addListener: () => {} },
				connect: () => ({ onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} }, postMessage: () => {} }),
			},
		})
		wire = []
		const impl = async (_method: unknown, ...args: unknown[]) => {
			wire.push(args)
			// Stop before the result parse: the arguments are the subject.
			throw new Error(SENTINEL)
		}
		vi.spyOn(ServiceClient.prototype as unknown as { request: (...a: unknown[]) => Promise<unknown> }, "request").mockImplementation(
			impl,
		)
		vi.spyOn(
			Object.getPrototypeOf(ServiceClient.prototype) as { request: (...a: unknown[]) => Promise<unknown> },
			"request",
		).mockImplementation(impl)
	})

	function makeClient(): PxeServiceClientBase {
		const client = new PxeServiceClientBase(noopLogger)
		client.setStoreKeyProvider(async () => undefined)
		client.setGenerationProvider(async () => "gen")
		return client
	}

	test("the id is the fourth positional argument and survives JSON", async () => {
		const txRequest = { marker: "req" } as never
		await expect(makeClient().proveTx(net, txRequest, [], PROVE_ID)).rejects.toThrow(SENTINEL)
		expect(wire).toHaveLength(1)
		expect(wire[0][3]).toBe(PROVE_ID)
		expect(JSON.parse(JSON.stringify(wire[0]))[3]).toBe(PROVE_ID)
	})

	test("omitted → the fourth argument is undefined on the wire (null after JSON), never a fabricated id", async () => {
		await expect(makeClient().proveTx(net, { marker: "req" } as never, [])).rejects.toThrow(SENTINEL)
		expect(wire[0][3]).toBeUndefined()
		expect(JSON.parse(JSON.stringify(wire[0]))[3]).toBeNull()
	})
})
