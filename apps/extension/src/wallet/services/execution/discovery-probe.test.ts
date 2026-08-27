/**
 * Unit tests for `CollectingDiscoveryProbe`. Real hash paths run Barretenberg
 * WASM and are e2e-only (same discipline as authwit-discoverer.test.ts); the
 * crypto seam is injected so the logic — laziness, first-sim-only, dedup,
 * chain-assert ordering — is testable in isolation.
 */

import { describe, expect, test, vi } from "vitest"
import { CollectingDiscoveryProbe, type DiscoveryProbeCrypto } from "./discovery-probe"

const NETWORK = { chainId: 0 } as never // chainId 0 = local → assertLiveChainIdentity noop

function fakeSim(effects: { contractAddress: unknown; data: unknown[] }[]) {
	return {
		privateExecutionResult: {
			entrypoint: {
				offchainEffects: effects,
				nestedExecutionResults: [],
				publicInputs: { callContext: { contractAddress: { toString: () => "0xentry" } } },
			},
		},
	}
}

function fakeCrypto(hashByEffect: (data: unknown[]) => string | Error): DiscoveryProbeCrypto {
	return {
		fromFields: async (data) => {
			const h = hashByEffect(data as unknown[])
			if (h instanceof Error) throw h
			return { innerHash: h as never }
		},
		computeMessageHash: async (intent) => ({ toString: () => `mh:${intent.innerHash}` }) as never,
	}
}

function fakeNode() {
	const getNodeInfo = vi.fn(async () => ({ l1ChainId: 31337, rollupVersion: 1 }))
	return { node: { getNodeInfo } as never, getNodeInfo }
}

const effect = (tag: string) => ({ contractAddress: { toString: () => "0xtoken" }, data: [tag] })

describe("CollectingDiscoveryProbe", () => {
	test("no effects: returns [] without fetching node info (lazy chain fetch)", async () => {
		const probe = new CollectingDiscoveryProbe(
			new Set(),
			fakeCrypto(() => "h"),
		)
		const { node, getNodeInfo } = fakeNode()

		const out = await probe.extractEffects(fakeSim([]), { node, network: NETWORK })

		expect(out).toEqual([])
		expect(probe.collected).toEqual([])
		expect(getNodeInfo).not.toHaveBeenCalled()
	})

	test("effects map to message_hash actions; identical hashes dedup to one", async () => {
		const probe = new CollectingDiscoveryProbe(
			new Set(),
			fakeCrypto((d) => String(d[0])),
		)
		const { node } = fakeNode()

		const out = await probe.extractEffects(fakeSim([effect("a"), effect("a"), effect("b")]), { node, network: NETWORK })

		expect(out).toEqual([
			{ kind: "add_private_authwit", content: { kind: "message_hash", messageHash: "mh:a" } },
			{ kind: "add_private_authwit", content: { kind: "message_hash", messageHash: "mh:b" } },
		])
		expect(probe.collected).toEqual(out)
	})

	test("hashes already covered by pre-attached actions are dropped", async () => {
		const probe = new CollectingDiscoveryProbe(
			new Set(["mh:a"]),
			fakeCrypto((d) => String(d[0])),
		)
		const { node } = fakeNode()

		const out = await probe.extractEffects(fakeSim([effect("a"), effect("b")]), { node, network: NETWORK })

		expect(out).toEqual([{ kind: "add_private_authwit", content: { kind: "message_hash", messageHash: "mh:b" } }])
	})

	test("first-sim-only: the second extraction is inert and leaves collected untouched", async () => {
		const probe = new CollectingDiscoveryProbe(
			new Set(),
			fakeCrypto((d) => String(d[0])),
		)
		const { node, getNodeInfo } = fakeNode()

		const first = await probe.extractEffects(fakeSim([effect("a")]), { node, network: NETWORK })
		const second = await probe.extractEffects(fakeSim([effect("b")]), { node, network: NETWORK })

		expect(first).toHaveLength(1)
		expect(second).toEqual([])
		expect(probe.collected).toEqual(first)
		expect(getNodeInfo).toHaveBeenCalledTimes(1)
	})

	test("non-CallAuthorizationRequest effects are skipped, others still collected", async () => {
		const probe = new CollectingDiscoveryProbe(
			new Set(),
			fakeCrypto((d) => (d[0] === "bad" ? new Error("not an auth request") : String(d[0]))),
		)
		const { node } = fakeNode()

		const out = await probe.extractEffects(fakeSim([effect("bad"), effect("ok")]), { node, network: NETWORK })

		expect(out).toEqual([{ kind: "add_private_authwit", content: { kind: "message_hash", messageHash: "mh:ok" } }])
	})

	test("chain-identity drift fails the extraction loudly (no silent hash derivation)", async () => {
		const probe = new CollectingDiscoveryProbe(
			new Set(),
			fakeCrypto(() => "h"),
		)
		const getNodeInfo = vi.fn(async () => ({ l1ChainId: 999, rollupVersion: 1 }))
		// A real (non-local) stored chain identity that the live node contradicts.
		const network = { chainId: 31337 } as never

		await expect(probe.extractEffects(fakeSim([effect("a")]), { node: { getNodeInfo } as never, network })).rejects.toThrow()
		expect(probe.collected).toEqual([])
	})
})
