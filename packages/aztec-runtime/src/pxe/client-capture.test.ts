/**
 * The SW-side half of the #281 D4 fence: the client stamps each op's
 * NetworkInfo with the profile's CURRENT generation once per logical op, the
 * missing-key retry REUSES that capture (never re-derives), and the provision
 * it fires pairs the derived key with the provider's generation.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { ServiceClient } from "@nulo/extension-messaging/offscreen"
import type { ILogger } from "@nulo/wallet-core/logger"
import { PXE_STORE_KEY_MISSING, type NetworkInfo } from "./chain-runtime"
import { PxeServiceClientBase } from "./client"

const noopLogger: ILogger = { log: () => {} }
const net: NetworkInfo = { profileId: "p1", chainId: 31337, rpcUrl: "http://n/1" }
const KEY = new Uint8Array(32).fill(7)

describe("PxeServiceClientBase generation capture (#281 D4)", () => {
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
		// `super.request` inside PxeServiceClientBase resolves through
		// ServiceClient.prototype at call time, so a prototype spy intercepts it.
		vi.spyOn(ServiceClient.prototype as unknown as { request: (...a: unknown[]) => Promise<unknown> }, "request").mockImplementation(
			async function (this: unknown, method: unknown, ...args: unknown[]) {
				wire.push({ method: method as string, args })
				const behavior = behaviors.shift()
				if (behavior) return behavior(method as string, args)
				// getSenders zod-parses its result as an array; a benign default
				// keeps the wire assertions the focus of these tests.
				return []
			},
		)
	})

	function makeClient(gens: string[]): PxeServiceClientBase {
		const client = new PxeServiceClientBase(noopLogger)
		client.setStoreKeyProvider(async () => ({ key: KEY, generation: gens[gens.length - 1] }))
		client.setGenerationProvider(async () => gens.shift() ?? undefined)
		return client
	}

	test("ops get the generation stamped once; the caller's object is not mutated", async () => {
		const client = makeClient(["gen-A"])
		await client.getSenders(net)
		expect(wire).toHaveLength(1)
		expect(wire[0].args[0]).toMatchObject({ profileId: "p1", pxeGeneration: "gen-A" })
		expect(net.pxeGeneration).toBeUndefined()
	})

	test("the missing-key retry reuses the ORIGINAL capture and provisions with the provider's generation", async () => {
		// First send fails with the missing-key marker; provision + retry follow.
		behaviors.push(() => {
			throw new Error(`${PXE_STORE_KEY_MISSING}: no store key provisioned for profile p1`)
		})
		// generation provider would yield gen-B on a (wrong) second lookup —
		// the retry must NOT consult it again.
		const client = makeClient(["gen-A", "gen-B"])
		await client.getSenders(net)

		expect(wire.map((w) => w.method)).toEqual(["getSenders", "provisionChainStoreKey", "getSenders"])
		// The provision pairs key + the provider's CURRENT generation.
		expect(wire[1].args[0]).toBe("p1")
		expect(wire[1].args[2]).toBe("gen-B")
		// The retried op carries the ORIGINAL capture — not a re-derived one.
		expect(wire[2].args[0]).toMatchObject({ pxeGeneration: "gen-A" })
	})

	test("without a generation provider, ops go out uncaptured (fence degrades to provision-time only)", async () => {
		const client = new PxeServiceClientBase(noopLogger)
		await client.getSenders(net)
		expect(wire[0].args[0]).not.toHaveProperty("pxeGeneration")
	})
})
