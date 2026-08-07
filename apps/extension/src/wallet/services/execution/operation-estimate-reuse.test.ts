import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { GasFees } from "@aztec/stdlib/gas"
import type { Action } from "@nulo/wallet-bridge"
import { ESTIMATE_REUSE_TTL_MS } from "./transfer-estimate-reuse"
import { OperationEstimateReuse, type OperationEstimateReuseDeps, type OperationEstimateReuseEntry } from "./operation-estimate-reuse"
import { fingerprintOperation, type OperationFingerprintInput } from "./operation-fingerprint"

vi.mock("@nulo/bridge-core/fee-juice", async (importOriginal) => {
	const original = await importOriginal<Record<string, unknown>>()
	return { ...original, predictedWorstMinFees: vi.fn(async () => new GasFees(2n, 3n)) }
})

const CALL: Action = { kind: "call", contract: "0xtoken", method: "transfer", args: ["0xme", "0xyou", 5] }

function makeInput(overrides: Partial<OperationFingerprintInput> = {}): OperationFingerprintInput {
	return {
		networkId: "net-1",
		accountAddress: "0xacc",
		executionMode: "standard",
		from: "0xacc",
		actions: [CALL],
		fee: undefined,
		feeSettings: { paymentMethod: { kind: "fpc", fpcId: "fpc-1" } } as never,
		...overrides,
	}
}

const FPC_SNAPSHOT = { id: "fpc-1", type: 2, address: "0xfpc", chainId: 7, isProtocol: true } as const

function makeEntry(overrides: Partial<OperationEstimateReuseEntry> = {}): OperationEstimateReuseEntry {
	return {
		fingerprint: fingerprintOperation(makeInput())!,
		accountAddress: "0xacc",
		networkId: "net-1",
		feeSettings: makeInput().feeSettings,
		profileId: "p1",
		// predictedWorst(2,3) × default multiplier 2 → "4:6".
		baseFeeFingerprint: "4:6",
		primaryEndpointId: "e1",
		primaryEndpointUrl: "http://primary",
		pendingHashes: ["0xpending"],
		chainIdentity: { l1ChainId: 1, rollupVersion: 4 },
		fpcIdentity: { ...FPC_SNAPSHOT, type: FPC_SNAPSHOT.type as never },
		txRequest: { marker: "txRequest" } as never,
		nonce: { toString: () => "42" },
		feePaymentMethod: 1 as never,
		txCalls: [{ contract: "0xc", method: "m", args: [] }] as never,
		pendingPublicAuthwits: [{ account: "0xacc", hash: "0xh", content: { kind: "message_hash", messageHash: "0xm" } }] as never,
		builtAt: Date.now(),
		...overrides,
	}
}

function makeReuse(depOverrides: Partial<OperationEstimateReuseDeps> = {}) {
	const deps: OperationEstimateReuseDeps = {
		getActiveProfile: vi.fn(async () => ({ id: "p1" })),
		getNetwork: vi.fn(
			async () =>
				({
					chainId: 7,
					primaryEndpointId: "e1",
					endpoints: [{ id: "e1", rpcUrl: "http://primary" }],
				}) as never,
		),
		getNode: vi.fn(async () => ({ marker: "node" }) as never),
		getLiveChainIdentity: vi.fn(async () => ({ l1ChainId: 1, rollupVersion: 4 })),
		getFpcInfo: vi.fn(async () => ({ ...FPC_SNAPSHOT }) as never),
		getPendingForAccount: vi.fn(() => [{ hash: "0xpending" }]),
		logDebug: vi.fn(),
		...depOverrides,
	}
	return { deps, reuse: new OperationEstimateReuse(deps) }
}

beforeEach(() => {
	vi.clearAllMocks()
})
afterEach(() => {
	vi.useRealTimers()
})

describe("OperationEstimateReuse.tryConsume — the drift ladder", () => {
	test("happy path: every step passes, the entry comes back once", async () => {
		const { reuse } = makeReuse()
		const entry = makeEntry()
		reuse.stash("id-1", entry)
		expect(await reuse.tryConsume("id-1", makeInput())).toBe(entry)
		// SINGLE-SHOT: a second consume of the same id misses.
		expect(await reuse.tryConsume("id-1", makeInput())).toBeUndefined()
	})

	test("unknown id misses", async () => {
		const { reuse } = makeReuse()
		expect(await reuse.tryConsume("nope", makeInput())).toBeUndefined()
	})

	test("TTL: an expired entry misses", async () => {
		const { reuse } = makeReuse()
		reuse.stash("id-1", makeEntry({ builtAt: Date.now() - ESTIMATE_REUSE_TTL_MS - 1 }))
		expect(await reuse.tryConsume("id-1", makeInput())).toBeUndefined()
	})

	test("fingerprint drift: any input change misses (amount-style arg drift)", async () => {
		const { reuse } = makeReuse()
		reuse.stash("id-1", makeEntry())
		const drifted = makeInput({ actions: [{ ...CALL, args: ["0xme", "0xyou", 6] } as Action] })
		expect(await reuse.tryConsume("id-1", drifted)).toBeUndefined()
	})

	test("non-fingerprintable consume input misses (never a false hit)", async () => {
		const { reuse } = makeReuse()
		reuse.stash("id-1", makeEntry())
		const exotic = makeInput({ actions: [{ kind: "call", contract: "0xc", method: "m", args: [() => 1] } as unknown as Action] })
		expect(await reuse.tryConsume("id-1", exotic)).toBeUndefined()
	})

	test("profile drift misses", async () => {
		const { reuse } = makeReuse({ getActiveProfile: vi.fn(async () => ({ id: "OTHER" })) })
		reuse.stash("id-1", makeEntry())
		expect(await reuse.tryConsume("id-1", makeInput())).toBeUndefined()
	})

	test("endpoint drift misses (id or url)", async () => {
		const { reuse } = makeReuse({
			getNetwork: vi.fn(
				async () => ({ chainId: 7, primaryEndpointId: "e1", endpoints: [{ id: "e1", rpcUrl: "http://OTHER" }] }) as never,
			),
		})
		reuse.stash("id-1", makeEntry())
		expect(await reuse.tryConsume("id-1", makeInput())).toBeUndefined()
	})

	test("SAME-BATCH pending drift: op #1 broadcasting between estimate and confirm of op #2 misses", async () => {
		const { reuse } = makeReuse({
			// Op #1's fresh hash joined the pending set after op #2's estimate.
			getPendingForAccount: vi.fn(() => [{ hash: "0xpending" }, { hash: "0xop1-just-broadcast" }]),
		})
		reuse.stash("id-2", makeEntry())
		expect(await reuse.tryConsume("id-2", makeInput())).toBeUndefined()
	})

	test("CHAIN-IDENTITY drift: the composite assert throwing fails closed to a miss", async () => {
		const { reuse } = makeReuse({
			getLiveChainIdentity: vi.fn(async () => {
				throw new Error("Chain identity mismatch")
			}),
		})
		reuse.stash("id-1", makeEntry())
		expect(await reuse.tryConsume("id-1", makeInput())).toBeUndefined()
	})

	test("CHAIN-IDENTITY drift: an XOR-composite collision misses on the exact pair", async () => {
		// (1,4) and (2,7) share the composite 1^4 === 2^7 === 5 — the stored
		// network chainId cannot tell them apart; the entry's raw pair must.
		const { reuse } = makeReuse({
			getLiveChainIdentity: vi.fn(async () => ({ l1ChainId: 2, rollupVersion: 7 })),
		})
		reuse.stash("id-1", makeEntry({ chainIdentity: { l1ChainId: 1, rollupVersion: 4 } }))
		expect(await reuse.tryConsume("id-1", makeInput())).toBeUndefined()
	})

	test("FPC-IDENTITY drift: an in-place row address edit misses", async () => {
		const { reuse } = makeReuse({
			getFpcInfo: vi.fn(async () => ({ ...FPC_SNAPSHOT, address: "0xEVIL" }) as never),
		})
		reuse.stash("id-1", makeEntry())
		expect(await reuse.tryConsume("id-1", makeInput())).toBeUndefined()
	})

	test("FPC row unavailable (deleted) misses instead of throwing", async () => {
		const { reuse } = makeReuse({
			getFpcInfo: vi.fn(async () => {
				throw new Error("row gone")
			}),
		})
		reuse.stash("id-1", makeEntry())
		expect(await reuse.tryConsume("id-1", makeInput())).toBeUndefined()
	})

	test("fj entries carry no fpcIdentity and skip the FPC step", async () => {
		const { reuse, deps } = makeReuse()
		const fjInput = makeInput({ feeSettings: { paymentMethod: { kind: "fj" } } as never })
		reuse.stash(
			"id-1",
			makeEntry({ fpcIdentity: undefined, fingerprint: fingerprintOperation(fjInput)!, feeSettings: fjInput.feeSettings }),
		)
		expect(await reuse.tryConsume("id-1", fjInput)).toBeDefined()
		expect(deps.getFpcInfo).not.toHaveBeenCalled()
	})

	test("base-fee drift misses (predicted-worst product changed)", async () => {
		const { reuse } = makeReuse()
		reuse.stash("id-1", makeEntry({ baseFeeFingerprint: "999:999" }))
		expect(await reuse.tryConsume("id-1", makeInput())).toBeUndefined()
	})

	test("evict drops a stashed entry", async () => {
		const { reuse } = makeReuse()
		reuse.stash("id-1", makeEntry())
		reuse.evict("id-1")
		expect(await reuse.tryConsume("id-1", makeInput())).toBeUndefined()
	})
})
