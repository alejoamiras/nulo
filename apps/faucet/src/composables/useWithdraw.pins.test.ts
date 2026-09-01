/**
 * Pre-extraction pins for the withdraw-side journal deps wired by `useWithdrawFlow()`
 * (`wireWithdrawDeps`): the consume tail's exact order (exit receipt poll → `onProgress(targetBlock)`
 * → proven wait, with the proven-block poll interval cleared on the throw path too → witness →
 * simulate → ONE L1 write), `waitConsumeReceipt`'s status mapping, and `verifyConsumeIdentity`
 * failing CLOSED on anything unverifiable. Only `buildWithdrawSendOpts` had unit coverage before.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const h = vi.hoisted(() => {
	const trace: Array<[string, unknown]> = []
	return {
		trace,
		t: (name: string, detail?: unknown) => void trace.push([name, detail]),
		// biome-ignore lint/suspicious/noExplicitAny: the captured journal-dep surface is exercised untyped on purpose.
		deps: undefined as undefined | Record<string, (...args: any[]) => any>,
		receipts: [] as Array<{ blockNumber?: bigint } | undefined>,
		provenThrows: false,
		receiptStatus: "success" as string,
		receiptThrows: false,
		txThrows: false,
		tx: { to: "0x00000000000000000000000000000000000000bb", input: "0xdeadbeef" } as { to?: string; input: string },
		decoded: { functionName: "withdraw", args: [] as unknown[] },
		L1_PORTAL: "0x00000000000000000000000000000000000000bb",
		FROM: "0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d",
		// A small field element: TxHash.fromString rejects values at or above the field modulus.
		EXIT_TX: `0x${"00".repeat(31)}ab`,
	}
})

vi.mock("@/contracts/bridge-deployments", () => ({
	BRIDGE: { toString: () => "0x2018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d" },
	BRIDGE_PROXY: "0x3018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d",
	BRIDGE_TOKEN: "0x4018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d",
	L1_PORTAL: h.L1_PORTAL,
}))
vi.mock("@aztec/l1-artifacts", () => ({ TokenPortalAbi: [] }))
vi.mock("@nulo/bridge-core/artifacts", () => ({ tokenBridgeArtifact: {} }))
vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js", () => ({ TokenContractArtifact: {} }))
vi.mock("@aztec/aztec.js/authorization", () => ({ SetPublicAuthwitContractInteraction: class {} }))
vi.mock("@aztec/aztec.js/contracts", () => ({
	Contract: class {},
	waitForProven: async () => {
		h.t("waitForProven")
		if (h.provenThrows) throw new Error("proven timeout")
	},
}))
vi.mock("@aztec/stdlib/messaging", () => ({
	computeL2ToL1MembershipWitness: async () => {
		h.t("computeWitness")
		return { epochNumber: 5, numCheckpointsInEpoch: 1, leafIndex: 9n, siblingPath: { toBufferArray: () => [] } }
	},
}))
vi.mock("@aztec/ethereum/contracts", () => ({
	OutboxContract: class {
		constructor() {
			h.t("outbox.new")
		}
	},
}))
vi.mock("@aztec/aztec.js/node", () => ({
	createAztecNodeClient: () => ({
		getTxReceipt: async () => {
			h.t("node.getTxReceipt")
			return h.receipts.shift()
		},
		getBlockNumber: async () => 7n,
		getTxEffect: async () => {
			h.t("node.getTxEffect")
			return { data: { l2ToL1Msgs: [{ msg: 1 }] } }
		},
		getNodeInfo: async () => {
			h.t("node.getNodeInfo")
			return { l1ContractAddresses: { outboxAddress: "0xoutbox" } }
		},
	}),
}))
vi.mock("viem", async (importOriginal) => ({
	...((await importOriginal()) as Record<string, unknown>),
	decodeFunctionData: () => h.decoded,
}))
vi.mock("@nulo/bridge-core", async (importOriginal) => ({
	...((await importOriginal()) as Record<string, unknown>),
	awaitL1Receipt: async (_client: unknown, hash: string) => {
		h.t("l1.awaitReceipt", hash)
		if (h.receiptThrows) throw new Error("receipt lost")
		return { status: h.receiptStatus }
	},
}))
vi.mock("./useBridgeJournal", () => ({
	// biome-ignore lint/suspicious/noExplicitAny: see `h.deps`.
	connectJournalDeps: (deps: Record<string, (...args: any[]) => any>) => {
		h.deps = deps
	},
	runOnLane: (_lane: string, fn: () => Promise<unknown>) => fn(),
	addRecord: () => {},
	discard: () => {},
	flagRecordError: () => {},
	markSessionLive: () => {},
	rekeyJournalRecord: () => {},
	resumeSessionWork: () => {},
	runWithdrawConsume: async () => {},
	setRecordStep: () => {},
	useBridgeJournal: () => ({ records: { value: [] } }),
}))
vi.mock("./useBridgeWallet", () => ({ useBridgeWallet: () => ({ wallet: { value: {} }, selectedAccount: { value: "0x1" } }) }))
vi.mock("./useOpsInFlight", () => ({ withOperation: (fn: () => Promise<unknown>) => fn() }))
vi.mock("./useL1Wallet", () => {
	const publicClient = {
		simulateContract: async (a: { functionName: string; args: unknown[]; address: string; account: string }) => {
			h.t("l1.simulateContract", { fn: a.functionName, to: a.address, args: a.args, account: a.account })
			return { request: { simulated: true } }
		},
		getTransaction: async () => {
			h.t("l1.getTransaction")
			if (h.txThrows) throw new Error("rpc down")
			return h.tx
		},
	}
	const walletClient = {
		writeContract: async (a: Record<string, unknown>) => {
			h.t("l1.writeContract", a)
			return "0xconsumetx"
		},
	}
	return {
		useL1Wallet: () => ({
			address: { value: h.FROM },
			isConnected: { value: true },
			publicClient,
			ensureWalletClient: () => walletClient,
		}),
	}
})

import { useWithdrawFlow } from "./useWithdraw"

const names = () => h.trace.map(([n]) => n)
const rec = { id: "w1", direction: "withdraw", schema: 1, exitTxHash: h.EXIT_TX, recipientL1: h.FROM, amount: "1000" } as never

beforeEach(() => {
	h.trace.length = 0
	h.receipts = [{ blockNumber: 12n }]
	h.provenThrows = false
	h.receiptStatus = "success"
	h.receiptThrows = false
	h.txThrows = false
	h.tx = { to: h.L1_PORTAL, input: "0xdeadbeef" }
	h.decoded = { functionName: "withdraw", args: [h.FROM, 1000n, false, 5n, 1n, 9n, []] }
	useWithdrawFlow()
})
afterEach(() => {
	vi.restoreAllMocks()
})

describe("withdraw journal deps — consume", () => {
	test("exact order: receipt poll → onProgress(target) → proven wait (interval armed then cleared) → witness → simulate → one write", async () => {
		const setSpy = vi.spyOn(globalThis, "setInterval")
		const clearSpy = vi.spyOn(globalThis, "clearInterval")
		const progress: unknown[] = []
		const out = await h.deps?.consume(rec, (p: unknown) => void progress.push(p))
		expect(out).toEqual({ consumeTxHash: "0xconsumetx" })
		expect(names()).toEqual([
			"node.getTxReceipt",
			"waitForProven",
			"node.getTxEffect",
			"node.getNodeInfo",
			"outbox.new",
			"computeWitness",
			"l1.simulateContract",
			"l1.writeContract",
		])
		expect(progress).toEqual([{ targetBlock: 12 }])
		expect(setSpy).toHaveBeenCalledTimes(1)
		expect(clearSpy).toHaveBeenCalledTimes(1)
		const sim = h.trace.find(([n]) => n === "l1.simulateContract")?.[1] as { fn: string; to: string; args: unknown[]; account: string }
		expect(sim).toEqual({ fn: "withdraw", to: h.L1_PORTAL, args: [h.FROM, 1000n, false, 5n, 1n, 9n, []], account: h.FROM })
		const write = h.trace.find(([n]) => n === "l1.writeContract")?.[1] as Record<string, unknown>
		expect(write).toMatchObject({ simulated: true, account: h.FROM })
	})

	test("the proven-block poll interval is cleared when the proven wait throws; nothing downstream runs", async () => {
		const clearSpy = vi.spyOn(globalThis, "clearInterval")
		h.provenThrows = true
		await expect(h.deps?.consume(rec, () => {})).rejects.toThrow("proven timeout")
		expect(clearSpy).toHaveBeenCalledTimes(1)
		expect(names()).toEqual(["node.getTxReceipt", "waitForProven"])
	})
})

describe("withdraw journal deps — receipt + identity", () => {
	test("waitConsumeReceipt maps a success receipt to true, a revert to false, and a lost receipt to false", async () => {
		expect(await h.deps?.waitConsumeReceipt("0xconsumetx")).toBe(true)
		h.receiptStatus = "reverted"
		expect(await h.deps?.waitConsumeReceipt("0xconsumetx")).toBe(false)
		h.receiptThrows = true
		expect(await h.deps?.waitConsumeReceipt("0xconsumetx")).toBe(false)
	})

	test("verifyConsumeIdentity is true only when portal, selector, recipient, amount AND the recomputed witness (epoch, leaf) all match", async () => {
		expect(await h.deps?.verifyConsumeIdentity(rec, "0xconsumetx")).toBe(true)
		expect(names().filter((n) => n === "computeWitness")).toHaveLength(1)

		h.tx = { to: "0x0000000000000000000000000000000000000001", input: "0x" }
		expect(await h.deps?.verifyConsumeIdentity(rec, "0xconsumetx")).toBe(false)
		h.tx = { to: h.L1_PORTAL, input: "0x" }
		h.decoded = { functionName: "withdraw", args: [h.FROM, 999n, false, 5n, 1n, 9n, []] }
		expect(await h.deps?.verifyConsumeIdentity(rec, "0xconsumetx")).toBe(false)
		h.decoded = { functionName: "withdraw", args: [h.FROM, 1000n, false, 6n, 1n, 9n, []] }
		expect(await h.deps?.verifyConsumeIdentity(rec, "0xconsumetx")).toBe(false)
		h.decoded = { functionName: "transfer", args: [] }
		expect(await h.deps?.verifyConsumeIdentity(rec, "0xconsumetx")).toBe(false)
		h.txThrows = true
		expect(await h.deps?.verifyConsumeIdentity(rec, "0xconsumetx")).toBe(false)
	})
})
