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
		// ServiceClient.prototype at call time, so a prototype spy intercepts
		// it. `requestAlreadyReady`'s own `super.request` resolves one level
		// deeper (BaseServiceClient.prototype — its home object is the
		// offscreen class), so the SAME impl is spied there too.
		const impl = async function (this: unknown, method: unknown, ...args: unknown[]) {
			wire.push({ method: method as string, args })
			const behavior = behaviors.shift()
			if (behavior) return behavior(method as string, args)
			// getSenders zod-parses its result as an array; a benign default
			// keeps the wire assertions the focus of these tests.
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

	test("the missing-key retry: matching generations provision + retry with the ORIGINAL capture", async () => {
		// First send fails with the missing-key marker; provision + retry follow.
		behaviors.push(() => {
			throw new Error(`${PXE_STORE_KEY_MISSING}: no store key provisioned for profile p1`)
		})
		const key = new Uint8Array(32).fill(7)
		const client = new PxeServiceClientBase(noopLogger)
		client.setGenerationProvider(async () => "gen-A")
		client.setStoreKeyProvider(async () => ({ key, generation: "gen-A" }))
		await client.getSenders(net)

		expect(wire.map((w) => w.method)).toEqual(["getSenders", "provisionChainStoreKey", "getSenders"])
		expect(wire[1].args[0]).toBe("p1")
		expect(wire[1].args[2]).toBe("gen-A")
		// The retried op carries the ORIGINAL capture — not a re-derived one.
		expect(wire[2].args[0]).toMatchObject({ pxeGeneration: "gen-A" })
		// Key hygiene: the caller-owned bytes are zeroized after the sequence.
		expect(key.every((b) => b === 0)).toBe(true)
	})

	test("capture-equality guard: a provider generation differing from the AUTO-STAMPED capture aborts — no provision, no re-send, original error", async () => {
		// The op auto-stamps gen-A; a concurrent delete + re-import moved the
		// durable row to gen-B by retry time. A doomed op's error path must not
		// side-effect-install the newer key, and unrelated provisioning can
		// never rescue a stale capture.
		const marker = new Error(`${PXE_STORE_KEY_MISSING}: no store key provisioned for profile p1`)
		behaviors.push(() => {
			throw marker
		})
		const key = new Uint8Array(32).fill(7)
		const client = new PxeServiceClientBase(noopLogger)
		client.setGenerationProvider(async () => "gen-A")
		client.setStoreKeyProvider(async () => ({ key, generation: "gen-B" }))
		await expect(client.getSenders(net)).rejects.toBe(marker)

		expect(wire.map((w) => w.method)).toEqual(["getSenders"])
		// The derived key is zeroized on the abort path too.
		expect(key.every((b) => b === 0)).toBe(true)
	})

	test("UNCAPTURED op + missing-key error: the documented provision-then-retry contract is preserved", async () => {
		// No generation provider registered — the op goes out uncaptured (test
		// fakes / legacy path); the equality guard is capture-conditional and
		// must not apply.
		behaviors.push(() => {
			throw new Error(`${PXE_STORE_KEY_MISSING}: no store key provisioned for profile p1`)
		})
		const client = new PxeServiceClientBase(noopLogger)
		client.setStoreKeyProvider(async () => ({ key: new Uint8Array(32).fill(7), generation: "gen-B" }))
		await client.getSenders(net)

		expect(wire.map((w) => w.method)).toEqual(["getSenders", "provisionChainStoreKey", "getSenders"])
		expect(wire[2].args[0]).not.toHaveProperty("pxeGeneration")
	})

	test("recovery ordering: readiness runs ONCE, before the authority read; provision + retry sends never re-enter it", async () => {
		// The D4-hardening boundary: `onReady` (which can recreate the offscreen
		// document and reset its lifecycle map) must run exactly once in the
		// recovery sequence, BEFORE the provider's authority read — never
		// between the read and the wire sends.
		behaviors.push(() => {
			throw new Error(`${PXE_STORE_KEY_MISSING}: no store key provisioned for profile p1`)
		})
		const events: string[] = []
		class ProbeClient extends PxeServiceClientBase {
			protected override async onReady(): Promise<void> {
				events.push("ready")
			}
		}
		const client = new ProbeClient(noopLogger)
		client.setGenerationProvider(async () => "gen-A")
		client.setStoreKeyProvider(async () => {
			events.push("provider")
			return { key: new Uint8Array(32).fill(7), generation: "gen-A" }
		})
		// The prototype spy replaces `request` wholesale, so the mocked sends
		// never invoke ensureTransportReady — every "ready" here comes from the
		// recovery sequence's explicit call. Record the sends interleaved.
		const origPush = wire.push.bind(wire)
		wire.push = (entry) => {
			events.push(`wire:${entry.method}`)
			return origPush(entry)
		}
		await client.getSenders(net)
		expect(events).toEqual(["wire:getSenders", "ready", "provider", "wire:provisionChainStoreKey", "wire:getSenders"])
	})

	test("a provision send failure propagates AS ITSELF, and the key is still zeroized", async () => {
		behaviors.push(() => {
			throw new Error(`${PXE_STORE_KEY_MISSING}: no store key provisioned for profile p1`)
		})
		const transportDown = new Error("provision transport down")
		behaviors.push(() => {
			throw transportDown
		})
		const key = new Uint8Array(32).fill(7)
		const client = new PxeServiceClientBase(noopLogger)
		client.setGenerationProvider(async () => "gen-A")
		client.setStoreKeyProvider(async () => ({ key, generation: "gen-A" }))
		// More diagnostic than re-throwing the original marker error.
		await expect(client.getSenders(net)).rejects.toBe(transportDown)
		expect(wire.map((w) => w.method)).toEqual(["getSenders", "provisionChainStoreKey"])
		expect(key.every((b) => b === 0)).toBe(true)
	})

	test("without a generation provider, ops go out uncaptured (fence degrades to provision-time only)", async () => {
		const client = new PxeServiceClientBase(noopLogger)
		await client.getSenders(net)
		expect(wire[0].args[0]).not.toHaveProperty("pxeGeneration")
	})
})
