import { describe, expect, it, vi } from "vitest"
import { type DepositFlowStage, depositPublic } from "./flows"

const RECIPIENT = `0x${"3".padStart(64, "0")}` as const

describe("flows — depositPublic orchestration", () => {
	const makeL1 = () => ({
		pub: {
			waitForTransactionReceipt: vi.fn(async () => ({})),
			simulateContract: vi.fn(async () => ({ result: ["0xkey", 42n] })),
		},
		wallet: { writeContract: vi.fn(async () => "0xhash"), chain: { id: 31337 } },
		account: { address: "0xacc" },
	})

	it("runs mint→approve→deposit→claim, reports stages, returns the leaf index", async () => {
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

		expect(leafIndex).toBe(42n)
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
