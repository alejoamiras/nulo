/**
 * The #281 D4 incarnation-fence matrix: a deleted profile's PXE can never be
 * resurrected in the same offscreen incarnation. The fence is the per-profile
 * lifecycle (unseen → live(gen) → deleting(gen) → deleted(gen)) gating
 * `provisionChainStoreKey`, `clearProfileState`, and generation-carrying ops.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("./known-artifacts", () => ({
	loadProductionKnownArtifacts: async () => ({ artifacts: new Map(), instances: new Map() }),
}))
vi.mock("./note-schemas", () => ({
	loadProductionNoteSchemas: async () => new Map<string, unknown>(),
}))

import type { PXE } from "@aztec/pxe/client/bundle"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { ILogger } from "@nulo/wallet-core/logger"
import { ChainRuntime, type NetworkInfo, type PxeFactory } from "./chain-runtime"
import { PxeService, type IProfileReader } from "./service"

const noopLogger: ILogger = { log: () => {} }
const noopProfiles: IProfileReader = {
	connect: async () => {},
	getProfiles: async () => [],
	onProfileDeleted: { add: () => {} },
	onActiveProfileChanged: { add: () => {} },
}

const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32)))
const GEN_1 = "11111111111111111111111111111111"
const GEN_2 = "22222222222222222222222222222222"

const net = (pxeGeneration?: string): NetworkInfo => ({ profileId: "p1", chainId: 31337, rpcUrl: "http://n/1", pxeGeneration })

function makeService(): { service: PxeService; disposeShouldFail: (v: boolean) => void } {
	let failDispose = false
	const factory: PxeFactory = {
		createChainRuntime: async (n) => {
			const pxe = { getNotes: async () => [] } as unknown as PXE
			const node = {} as unknown as AztecNode
			const store = {
				close: async () => {
					if (failDispose) throw new Error("close failed")
				},
			} as never
			return new ChainRuntime(n.chainId, node, pxe, n.rpcUrl, store)
		},
	}
	const service = new PxeService(noopProfiles, noopLogger, factory)
	;(service as unknown as { initialized: boolean }).initialized = true
	return { service, disposeShouldFail: (v) => (failDispose = v) }
}

describe("incarnation fence (#281 D4)", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", { runtime: { onMessage: { addListener: () => {} } } })
		vi.stubGlobal("indexedDB", {
			databases: async () => [],
			deleteDatabase: () => {
				const req = { onsuccess: undefined as (() => void) | undefined } as never as IDBOpenDBRequest
				queueMicrotask(() => (req as unknown as { onsuccess?: () => void }).onsuccess?.())
				return req
			},
		})
	})
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test("provision requires a generation", async () => {
		const { service } = makeService()
		await expect(service.provisionChainStoreKey("p1", KEY_B64, "")).rejects.toThrow(/missing pxe generation/)
	})

	test("provision installs from unseen, is idempotent same-gen, rejects a different gen while live", async () => {
		const { service } = makeService()
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_1)
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_1) // idempotent
		await expect(service.provisionChainStoreKey("p1", KEY_B64, GEN_2)).rejects.toThrow(/different generation/)
	})

	test("successful clear → same-gen provision replay is rejected forever; a fresh gen goes live over it", async () => {
		const { service } = makeService()
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_1)
		await service.clearProfileState("p1", GEN_1)

		// The resurrection scenario: a key provider that captured the master
		// before deletion finishes HKDF after the purge and re-provisions.
		await expect(service.provisionChainStoreKey("p1", KEY_B64, GEN_1)).rejects.toThrow(/stale provision rejected/)

		// A same-id re-import minted a FRESH generation — that successor may live.
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_2)
	})

	test("failed clear retains the deleting fence: provisions rejected until a same-gen retry succeeds", async () => {
		const { service, disposeShouldFail } = makeService()
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_1)
		// Boot a runtime so disposeProfile has something to fail on.
		await (service as unknown as { withPxeRead: (l: string, n: NetworkInfo, fn: () => Promise<void>) => Promise<void> }).withPxeRead(
			"test",
			net(GEN_1),
			async () => {},
		)

		disposeShouldFail(true)
		await expect(service.clearProfileState("p1", GEN_1)).rejects.toBeInstanceOf(AggregateError)
		await expect(service.provisionChainStoreKey("p1", KEY_B64, GEN_1)).rejects.toThrow(/being deleted/)

		// Same-gen retry is idempotent and completes the erase.
		disposeShouldFail(false)
		await service.clearProfileState("p1", GEN_1)
		await expect(service.provisionChainStoreKey("p1", KEY_B64, GEN_1)).rejects.toThrow(/stale provision rejected/)
	})

	test("a late old-gen clear can never erase a live successor", async () => {
		const { service } = makeService()
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_1)
		await service.clearProfileState("p1", GEN_1)
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_2) // successor live

		await expect(service.clearProfileState("p1", GEN_1)).rejects.toThrow(/refusing to erase/)
		// The successor's key survives untouched: an op under GEN_2 still passes the fence.
		await (service as unknown as { withPxeRead: (l: string, n: NetworkInfo, fn: () => Promise<void>) => Promise<void> }).withPxeRead(
			"test",
			net(GEN_2),
			async () => {},
		)
	})

	test("same-gen clear after success is an idempotent no-op", async () => {
		const { service } = makeService()
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_1)
		await service.clearProfileState("p1", GEN_1)
		await service.clearProfileState("p1", GEN_1)
	})

	test("clear requires a generation", async () => {
		const { service } = makeService()
		await expect(service.clearProfileState("p1", "")).rejects.toThrow(/missing pxe generation/)
	})

	test("ops: a stale-generation capture is rejected inside the barrier; current and absent captures pass", async () => {
		const { service } = makeService()
		const read = (service as unknown as { withPxeRead: (l: string, n: NetworkInfo, fn: () => Promise<string>) => Promise<string> })
			.withPxeRead
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_1)

		// Current capture passes.
		expect(await read.call(service, "t", net(GEN_1), async () => "ok")).toBe("ok")
		// Absent capture passes (test fakes / legacy path).
		expect(await read.call(service, "t", net(undefined), async () => "ok")).toBe("ok")
		// A capture from a superseded incarnation is rejected — and NOT with the
		// missing-key marker, so the client won't provision-and-retry it.
		await service.clearProfileState("p1", GEN_1)
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_2)
		await expect(read.call(service, "t", net(GEN_1), async () => "ok")).rejects.toThrow(/stale/)
		await expect(read.call(service, "t", net(GEN_1), async () => "ok")).rejects.not.toThrow(/PXE_STORE_KEY_MISSING/)
	})
})
