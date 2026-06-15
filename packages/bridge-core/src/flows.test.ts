import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { encodeAbiParameters, keccak256, numberToHex, toHex } from "viem"
import { describe, expect, it, vi } from "vitest"
import { type DepositFlowStage, depositPublic, runSwapBridge } from "./flows"
import { PRIVATE_FPC_ADDRESS, deriveBridgeSecret, privateFuelSecretHash } from "./private-fuel"
import { SWAP_BRIDGE_ROUTER_ABI } from "./router-abi"

const RECIPIENT = `0x${"3".padStart(64, "0")}` as const

// A hand-built Inbox MessageSent log (leaf index 42) so parseEventLogs decodes it
// from the deposit receipt — exercising the receipt-based (non-racy) index path.
// (The @aztec/viem fork has no encodeEventLog, so we assemble topics+data directly.)
const depositLog = {
	address: "0x0000000000000000000000000000000000000002",
	topics: [
		keccak256(toHex("MessageSent(uint256,uint256,bytes32,bytes16)")),
		numberToHex(1n, { size: 32 }), // checkpointNumber (indexed)
		`0x${"0".repeat(64)}`, // hash (indexed)
	],
	data: encodeAbiParameters([{ type: "uint256" }, { type: "bytes16" }], [42n, `0x${"0".repeat(32)}`]),
	blockNumber: 1n,
	blockHash: `0x${"0".repeat(64)}`,
	logIndex: 0,
	transactionHash: `0x${"0".repeat(64)}`,
	transactionIndex: 0,
	removed: false,
}

describe("flows — depositPublic orchestration", () => {
	const makeL1 = () => ({
		pub: { waitForTransactionReceipt: vi.fn(async () => ({ logs: [depositLog] })) },
		wallet: { writeContract: vi.fn(async () => "0xhash"), chain: { id: 31337 } },
		account: { address: "0xacc" },
	})

	it("runs mint→approve→deposit→claim, reports stages, returns the receipt leaf index", async () => {
		const stages: DepositFlowStage[] = []
		const claimPublic = vi.fn(() => ({ send: vi.fn(async () => ({ receipt: {} })) }))
		const bridge = { methods: { claim_public: claimPublic } }
		const l1 = makeL1()

		const leafIndex = await depositPublic(
			l1 as never,
			bridge as never,
			{ usdc: "0x1", portal: "0x2", usdcAbi: [], portalAbi: [], recipient: RECIPIENT, amount: 100n },
			{},
			(s) => stages.push(s),
		)

		expect(leafIndex).toBe(42n) // from the Inbox MessageSent event, not a simulate
		expect(stages).toEqual(["approving", "depositing", "syncing", "done"])
		expect(l1.wallet.writeContract).toHaveBeenCalledTimes(3) // mint, approve, deposit
		expect(claimPublic).toHaveBeenCalledOnce()
	})

	it("throws if the claim never succeeds (message not synced) — bounded retries", async () => {
		const claimPublic = vi.fn(() => ({
			send: vi.fn(async () => {
				throw new Error("not synced")
			}),
		}))
		const bridge = { methods: { claim_public: claimPublic } }
		const l1 = makeL1()
		// Stub the retry delay so the bounded loop resolves fast.
		vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
			fn()
			return 0 as unknown as ReturnType<typeof setTimeout>
		}) as typeof setTimeout)

		await expect(
			depositPublic(
				l1 as never,
				bridge as never,
				{ usdc: "0x1", portal: "0x2", usdcAbi: [], portalAbi: [], recipient: RECIPIENT, amount: 1n },
				{},
			),
		).rejects.toThrow(/never succeeded/)
		vi.restoreAllMocks()
	})
})

const AZTEC_RECIPIENT = `0x${"a".padStart(64, "0")}` as const
const ADDR = "0x1111111111111111111111111111111111111111" as const

// Hand-built BridgeWithFuel log (tokenIndex 3, fuelIndex 7, fuelAmount 5000): 1 indexed
// (aztecRecipient) + 9 non-indexed in data, mirroring the depositLog technique above.
const bridgeWithFuelLog = {
	address: ADDR,
	topics: [
		keccak256(toHex("BridgeWithFuel(bytes32,bytes32,uint256,uint256,bytes32,bytes32,uint256,uint256,bytes32,bool)")),
		AZTEC_RECIPIENT,
	],
	data: encodeAbiParameters(
		[
			{ type: "bytes32" }, // tokenKey
			{ type: "uint256" }, // tokenIndex
			{ type: "uint256" }, // tokenAmount
			{ type: "bytes32" }, // tokenSecretHash
			{ type: "bytes32" }, // fuelKey
			{ type: "uint256" }, // fuelIndex
			{ type: "uint256" }, // fuelAmount
			{ type: "bytes32" }, // fuelSecretHash
			{ type: "bool" }, // isPrivate
		],
		[`0x${"0".repeat(64)}`, 3n, 100n, `0x${"0".repeat(64)}`, `0x${"0".repeat(64)}`, 7n, 5000n, `0x${"0".repeat(64)}`, true],
	),
	blockNumber: 1n,
	blockHash: `0x${"0".repeat(64)}`,
	logIndex: 0,
	transactionHash: `0x${"0".repeat(64)}`,
	transactionIndex: 0,
	removed: false,
}

describe("flows — runSwapBridge injectable fuel secret (L3)", () => {
	const makeL1 = () => ({
		pub: { waitForTransactionReceipt: vi.fn(async () => ({ logs: [bridgeWithFuelLog] })) },
		wallet: { signTypedData: vi.fn(async () => "0xsig"), writeContract: vi.fn(async () => "0xhash"), chain: { id: 31337 } },
		account: { address: ADDR },
	})
	const baseParams = {
		router: ADDR,
		routerAbi: SWAP_BRIDGE_ROUTER_ABI,
		permit2: ADDR,
		tokenPortal: ADDR,
		bridgeToken: ADDR,
		totalAmount: 1000n,
		fuelAmount: 100n,
		aztecRecipient: AZTEC_RECIPIENT,
		fuelRecipient: PRIVATE_FPC_ADDRESS as `0x${string}`,
		minFuelOutput: 1n,
		path: [],
		zeroForOnes: [],
		isPrivate: true,
		nonce: 0n,
		deadline: 9_999_999_999n,
		chainId: 31337,
	}

	it("threads an injected derived secret into the on-chain witness + the result", async () => {
		const salt = Fr.zero()
		const claimer = AztecAddress.fromString(AZTEC_RECIPIENT)
		const injected = deriveBridgeSecret(salt, claimer)
		const l1 = makeL1()

		const res = await runSwapBridge(l1 as never, { ...baseParams, fuelSecret: injected } as never)

		expect(res.fuelSecretHex).toBe(injected.toString())
		expect(res.fuelLeafIndex).toBe(7n)
		expect(res.fuelReceived).toBe(5000n)
		// The value actually sent on-chain binds the injected secret — not a random one.
		const writeArg = (l1.wallet.writeContract.mock.calls[0] as unknown[])[0] as {
			functionName: string
			args: [{ fuelSecretHash: string }]
		}
		expect(writeArg.functionName).toBe("bridgeWithFuel")
		expect(writeArg.args[0].fuelSecretHash).toBe((await privateFuelSecretHash(salt, claimer)).toString())
	})

	it("falls back to a random secret when none is injected (PUBLIC path unchanged)", async () => {
		const l1 = makeL1()
		const res = await runSwapBridge(l1 as never, { ...baseParams, isPrivate: false } as never)
		expect(res.fuelSecretHex).toMatch(/^0x[0-9a-f]{64}$/)
		expect(res.tokenSecretHex).not.toBe(res.fuelSecretHex) // token still random, distinct from fuel
	})

	it("F-005: private fuel with no injected secret is rejected BEFORE signing", async () => {
		const l1 = makeL1()
		// isPrivate (baseParams) + no fuelSecret: the silent Fr.random() fallback would strand the FJ.
		await expect(runSwapBridge(l1 as never, { ...baseParams } as never)).rejects.toThrow(/private fuel requires an injected fuelSecret/)
		expect(l1.wallet.signTypedData).not.toHaveBeenCalled()
	})

	it("F-005: private fuel to a non-FPC recipient is rejected BEFORE signing", async () => {
		const l1 = makeL1()
		const injected = deriveBridgeSecret(Fr.zero(), AztecAddress.fromString(AZTEC_RECIPIENT))
		const evil = `0x${"de".repeat(32)}` as `0x${string}`
		await expect(runSwapBridge(l1 as never, { ...baseParams, fuelSecret: injected, fuelRecipient: evil } as never)).rejects.toThrow(
			/must target the PrivateFPC/,
		)
		expect(l1.wallet.signTypedData).not.toHaveBeenCalled()
	})
})
