/**
 * Retry orchestration only: these pin how many times the op and `sync()` run and which error
 * leaves the helper. Whether a resync repairs chain state is the real-PXE test's question
 * (`stale-anchor.real.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// The service's artifact catalog resolves a vite alias the package runner does not define.
vi.mock("./known-artifacts", () => ({
	loadProductionKnownArtifacts: async () => ({ artifacts: new Map(), instances: new Map() }),
}))
vi.mock("./note-schemas", () => ({
	loadProductionNoteSchemas: async () => new Map<string, unknown>(),
}))

import type { PXE } from "@aztec/pxe/client/bundle"
import { Fr } from "@aztec/foundation/curves/bn254"
import { jsonStringify } from "@aztec/foundation/json-rpc"
import { FunctionCall, FunctionSelector, FunctionType } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { PxeStaleAnchorError, PxeStoreKeyMissingError } from "@nulo/extension-messaging/errors"
import type { ILogger } from "@nulo/wallet-core/logger"
import { ChainRuntime, type NetworkInfo, type PxeFactory } from "./chain-runtime"
import { PxeService, type IProfileReader } from "./service"
import { isStaleAnchorMessage, withStaleAnchorRetry } from "./stale-anchor"

const REORG_TEXT =
	"Block hash 0x12dc not found when resolving query. If the node API has been queried with anchor block hash possibly a reorg has occurred."
const AGGREGATE_TEXT = `2 of 6 concurrent operations failed: ${REORG_TEXT}; ${REORG_TEXT}`
const CONTRACT_QUERY_TEXT =
	'Reference block "0x03c9" not found when querying contract 0x2be3. If the node API has been queried with an anchor block hash, possibly a reorg has occurred.'

function harness(behaviors: Array<() => Promise<string>>, syncBehavior: () => Promise<void> = async () => {}) {
	const sync = vi.fn(syncBehavior)
	const op = vi.fn(() => {
		const next = behaviors.shift()
		if (!next) throw new Error("harness: no behavior left")
		return next()
	})
	const lines: string[] = []
	const run = () => withStaleAnchorRetry("executeUtility", { sync } as unknown as Pick<PXE, "sync">, op, (line) => lines.push(line))
	return { sync, op, lines, run }
}

const stale =
	(text = REORG_TEXT) =>
	async () => {
		throw new Error(text)
	}
const ok = async () => "result"

describe("isStaleAnchorMessage", () => {
	test("matches the three upstream diagnostics and nothing looser", () => {
		expect(isStaleAnchorMessage(REORG_TEXT)).toBe(true)
		expect(isStaleAnchorMessage(CONTRACT_QUERY_TEXT)).toBe(true)
		expect(isStaleAnchorMessage("Trying to get block header with a not-yet-synchronized PXE - this should never happen")).toBe(true)
		expect(isStaleAnchorMessage("Assertion failed: RewindableRegister write originates behind the current version")).toBe(true)
		// The generic first half alone is a by-number miss the node classifies as transient, not a reorg.
		expect(isStaleAnchorMessage("Block not found for 12 when resolving query.")).toBe(false)
		expect(isStaleAnchorMessage("Sender for tags is not set")).toBe(false)
	})
})

describe("withStaleAnchorRetry", () => {
	test("(a) an unrelated error propagates: no sync, op once", async () => {
		const h = harness([async () => Promise.reject(new Error("Sender for tags is not set"))])
		await expect(h.run()).rejects.toThrow("Sender for tags is not set")
		expect(h.sync).not.toHaveBeenCalled()
		expect(h.op).toHaveBeenCalledTimes(1)
		expect(h.lines).toEqual([])
	})

	test("(b) stale then ok: sync once, op twice, the result returned, one info line", async () => {
		const h = harness([stale(), ok])
		await expect(h.run()).resolves.toBe("result")
		expect(h.sync).toHaveBeenCalledTimes(1)
		expect(h.op).toHaveBeenCalledTimes(2)
		expect(h.lines).toEqual(["executeUtility: stale anchor on first attempt — resynced, retrying once"])
	})

	test("(c) stale twice: sync once, op twice, PxeStaleAnchorError with the constant message and the node text in details", async () => {
		const h = harness([stale(), stale()])
		const err = await h.run().catch((e: unknown) => e)
		expect(err).toBeInstanceOf(PxeStaleAnchorError)
		expect((err as PxeStaleAnchorError).message).toBe("executeUtility: stale chain anchor persisted after a resync")
		expect((err as PxeStaleAnchorError).details).toEqual({ op: "executeUtility", phase: "op", cause: REORG_TEXT })
		expect(h.sync).toHaveBeenCalledTimes(1)
		expect(h.op).toHaveBeenCalledTimes(2)
	})

	test("(d) stale then unrelated: the unrelated error propagates as itself, even when its text carries the store-key marker", async () => {
		const h = harness([stale(), async () => Promise.reject(new Error("PXE_STORE_KEY_MISSING: planted by the node"))])
		const err = await h.run().catch((e: unknown) => e)
		expect(err).toBeInstanceOf(Error)
		expect(err).not.toBeInstanceOf(PxeStaleAnchorError)
		expect(err).not.toBeInstanceOf(PxeStoreKeyMissingError)
		expect((err as Error).message).toBe("PXE_STORE_KEY_MISSING: planted by the node")
		expect(h.op).toHaveBeenCalledTimes(2)
	})

	test("(e) the AggregateError shape the offscreen actually emits matches", async () => {
		const h = harness([stale(AGGREGATE_TEXT), ok])
		await expect(h.run()).resolves.toBe("result")
		expect(h.sync).toHaveBeenCalledTimes(1)
	})

	test("(f1) sync() rejecting with stale text becomes PxeStaleAnchorError phase=sync; op once", async () => {
		const h = harness([stale()], async () => {
			throw new Error("Trying to get block header with a not-yet-synchronized PXE - this should never happen")
		})
		const err = await h.run().catch((e: unknown) => e)
		expect(err).toBeInstanceOf(PxeStaleAnchorError)
		expect((err as PxeStaleAnchorError).details).toMatchObject({ op: "executeUtility", phase: "sync" })
		expect(h.op).toHaveBeenCalledTimes(1)
		expect(h.lines).toEqual([])
	})

	test("(f2) sync() rejecting with an unrelated error propagates that error; op once", async () => {
		const h = harness([stale()], async () => {
			throw new Error("store commit failed")
		})
		await expect(h.run()).rejects.toThrow("store commit failed")
		expect(h.op).toHaveBeenCalledTimes(1)
	})
})

describe("PxeService.executeUtility runs through the helper", () => {
	const noopLogger: ILogger = { log: () => {} }
	const noopProfiles: IProfileReader = {
		connect: async () => {},
		getProfiles: async () => [],
		onProfileDeleted: { add: () => {} },
		onActiveProfileChanged: { add: () => {} },
	}
	const network: NetworkInfo = { profileId: "p1", chainId: 31337, rpcUrl: "http://localhost:8080" }

	beforeEach(() => {
		vi.stubGlobal("chrome", { runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} } })
	})
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	function wireCall() {
		const call = new FunctionCall(
			"f",
			AztecAddress.fromBigIntUnsafe(0xab12n),
			FunctionSelector.fromField(new Fr(1)),
			FunctionType.UTILITY,
			false,
			false,
			[],
			[],
		)
		return JSON.parse(jsonStringify(call)) as FunctionCall
	}

	test("a stale first attempt is resynced and retried once under the write guard; the second result is returned", async () => {
		const executeUtility = vi.fn().mockRejectedValueOnce(new Error(REORG_TEXT)).mockResolvedValueOnce({ marker: "utility-result" })
		const sync = vi.fn(async () => {})
		const factory: PxeFactory = {
			createChainRuntime: async (n) => new ChainRuntime(n.chainId, {} as never, { executeUtility, sync } as unknown as PXE, n.rpcUrl),
		}
		const service = new PxeService(noopProfiles, noopLogger, factory)
		;(service as unknown as { initialized: boolean }).initialized = true

		await expect(service.executeUtility(network, wireCall(), { scopes: [] })).resolves.toEqual({ marker: "utility-result" })
		expect(executeUtility).toHaveBeenCalledTimes(2)
		expect(sync).toHaveBeenCalledTimes(1)
	})
})
