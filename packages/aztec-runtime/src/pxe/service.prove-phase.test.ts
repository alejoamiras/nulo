// @vitest-environment node
/**
 * `PxeService.proveTx` prove-phase correlation: the attempt id is set on the
 * locked runtime for exactly the duration of `pxe.proveTx` (also on throw), and
 * every event the sink carries leaves the offscreen as an `onProvePhase` event.
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
import { TxExecutionRequest } from "@aztec/stdlib/tx"
import { jsonStringify } from "@aztec/foundation/json-rpc"
import type { ILogger } from "@nulo/wallet-core/logger"
import { ChainRuntime, type ActiveProve, type NetworkInfo, type PxeFactory } from "./chain-runtime"
import { createProvePhaseSink } from "./prove-phase-sink"
import { PxeService, type IProfileReader } from "./service"

const noopLogger: ILogger = { log: () => {} }
const noopProfiles: IProfileReader = {
	connect: async () => {},
	getProfiles: async () => [],
	onProfileDeleted: { add: () => {} },
	onActiveProfileChanged: { add: () => {} },
}
const network: NetworkInfo = { profileId: "p1", chainId: 31337, rpcUrl: "http://localhost:8080" }
const scope = "0x000000000000000000000000000000000000000000000000000000000000ab12"
const PROVE_ID = "11111111-2222-4333-8444-555555555555"

function harness(opts: { throws?: boolean } = {}) {
	let runtime: ChainRuntime | undefined
	const duringProve: Array<ActiveProve | undefined> = []
	const pxe = {
		proveTx: vi.fn(async () => {
			duringProve.push(runtime?.activeProve ? { ...runtime.activeProve } : undefined)
			if (opts.throws) throw new Error("prove failed")
			return { marker: "proved" }
		}),
	} as unknown as PXE
	const factory: PxeFactory = {
		createChainRuntime: async (n) => {
			runtime = new ChainRuntime(n.chainId, {} as AztecNode, pxe, n.rpcUrl)
			return runtime
		},
	}
	const sink = createProvePhaseSink()
	const service = new PxeService(noopProfiles, noopLogger, factory, sink)
	;(service as unknown as { initialized: boolean }).initialized = true
	return { service, sink, duringProve, runtime: () => runtime }
}

describe("PxeService prove-phase correlation", () => {
	const sendMessage = vi.fn(() => Promise.resolve())
	beforeEach(() => {
		vi.stubGlobal("chrome", {
			runtime: { onMessage: { addListener: () => {}, removeListener: () => {} }, sendMessage },
		})
		sendMessage.mockClear()
	})
	afterEach(() => vi.unstubAllGlobals())

	test("a sink event leaves the offscreen as an `onProvePhase` event from the pxe service", () => {
		const { sink } = harness()
		const payload = { proveId: PROVE_ID, seq: 1, phase: "transmit" as const, backend: "presto" as const }
		sink.emit(payload)
		expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ from: "pxe", content: { event: "onProvePhase", payload } }),
		)
	})

	test("activeProve = { proveId, seq: 0 } exactly while pxe.proveTx runs; cleared after success, throw, and when no id was given", async () => {
		// The wire form, as the transport delivers it.
		const txRequest = JSON.parse(jsonStringify(await TxExecutionRequest.random()))
		const ok = harness()
		await ok.service.proveTx(network, txRequest, [scope] as never, PROVE_ID)
		expect(ok.duringProve).toEqual([{ proveId: PROVE_ID, seq: 0 }])
		expect(ok.runtime()?.activeProve).toBeUndefined()

		const failing = harness({ throws: true })
		await expect(failing.service.proveTx(network, txRequest, [scope] as never, PROVE_ID)).rejects.toThrow("prove failed")
		expect(failing.runtime()?.activeProve).toBeUndefined()

		const anonymous = harness()
		// A JSON round-trip of an omitted trailing argument arrives as null.
		await anonymous.service.proveTx(network, txRequest, [scope] as never, null as unknown as undefined)
		expect(anonymous.duringProve).toEqual([undefined])
	})
})
