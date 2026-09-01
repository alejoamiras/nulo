/**
 * Pre-extraction pins for the plan-2 decomposition (codex audit conditions):
 *  - contract cascade: a PXE miss under `pxeOnly` consults NEITHER the node
 *    NOR the known-bundle fallback (the branch the fallback extraction guards);
 *  - orphan sweep: a lifecycle that goes live while WRITE-barrier acquisition
 *    is PENDING is seen by the post-barrier re-check and the removal skipped.
 */
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest"

vi.mock("./known-artifacts", () => ({
	loadProductionKnownArtifacts: async () => ({ artifacts: new Map(), instances: new Map() }),
}))
vi.mock("./note-schemas", () => ({
	loadProductionNoteSchemas: async () => new Map<string, unknown>(),
}))
const removeProfileStoreDirs = vi.fn(async (_profileId: string) => {})
vi.mock("./opfs-store", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	listChainStoreDirs: async () => [{ profileId: "p1", chainId: 1 }],
	removeProfileStoreDirs: (profileId: string) => removeProfileStoreDirs(profileId),
}))

import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { PXE } from "@aztec/pxe/client/bundle"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ILogger } from "@nulo/wallet-core/logger"
import { ChainRuntime, type NetworkInfo, type PxeFactory } from "./chain-runtime"
import { PxeService, type IProfileReader } from "./service"

const noopLogger: ILogger = { log: () => {} }
const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32)))
const network: NetworkInfo = { profileId: "p1", chainId: 31337, rpcUrl: "http://localhost:8080" }
const address = "0x000000000000000000000000000000000000000000000000000000000000ab12" as unknown as AztecAddress

beforeEach(() => {
	removeProfileStoreDirs.mockClear()
	vi.stubGlobal("chrome", {
		runtime: { onMessage: { addListener: () => {}, removeListener: () => {} }, sendMessage: () => Promise.resolve() },
	})
})
afterEach(() => vi.unstubAllGlobals())

describe("getContractInstance pxeOnly pin", () => {
	test("a PXE miss with pxeOnly consults neither the node nor the known-bundle", async () => {
		let nodeCalls = 0
		let knownCalls = 0
		const factory: PxeFactory = {
			createChainRuntime: async (n: NetworkInfo) => {
				const pxe = { getContractInstance: async () => undefined } as unknown as PXE
				const node = {
					getContract: async () => {
						nodeCalls++
						return undefined
					},
				} as unknown as AztecNode
				return new ChainRuntime(n.chainId, node, pxe, n.rpcUrl)
			},
		}
		const service = new PxeService(
			{
				connect: async () => {},
				getProfiles: async () => [],
				onProfileDeleted: { add: () => {} },
				onActiveProfileChanged: { add: () => {} },
			} as IProfileReader,
			noopLogger,
			factory,
		)
		;(service as unknown as { initialized: boolean }).initialized = true
		;(service as unknown as { artifacts: { ensureKnown: () => Promise<void>; getKnownInstance: (a: string) => undefined } }).artifacts =
			{
				ensureKnown: async () => {
					knownCalls++
				},
				getKnownInstance: () => undefined,
			}

		const result = await service.getContractInstance(network, address, { pxeOnly: true })
		expect(result).toBeUndefined()
		expect(nodeCalls).toBe(0)
		expect(knownCalls).toBe(0)
	})
})

describe("orphan sweep barrier-pending pin", () => {
	test("a provision landing while enterWrite is PENDING is seen by the post-barrier re-check", async () => {
		vi.stubGlobal("indexedDB", { databases: async () => [] })
		let service: PxeService = null!
		const profiles: IProfileReader = {
			connect: async () => {},
			getProfiles: async () => [],
			onProfileDeleted: { add: () => {} },
			onActiveProfileChanged: { add: () => {} },
		}
		service = new PxeService(profiles, noopLogger, {
			createChainRuntime: async () => {
				throw new Error("unused")
			},
		})
		;(service as unknown as { initialized: boolean }).initialized = true

		// Hold a READ so the sweep's enterWrite queues; provision while it waits.
		const barrier = (
			service as unknown as { getProfileBarrier: (id: string) => { read: <T>(fn: () => Promise<T>) => Promise<T> } }
		).getProfileBarrier("p1")
		let releaseRead: () => void = () => {}
		const readHeld = barrier.read(
			() =>
				new Promise<void>((resolve) => {
					releaseRead = resolve
				}),
		)

		const run = (service as unknown as { sweepOrphanStores: () => Promise<void> }).sweepOrphanStores()
		// Let the sweep reach the barrier wait, then provision the successor.
		await new Promise((r) => setTimeout(r, 10))
		await service.provisionChainStoreKey("p1", KEY_B64, "gen-successor")
		releaseRead()
		await readHeld
		await run

		expect(removeProfileStoreDirs).not.toHaveBeenCalled()
	})
})
