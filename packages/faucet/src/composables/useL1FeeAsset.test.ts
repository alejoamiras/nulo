import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const addressRef = ref<string | null>(null)
const readContract = vi.fn(async () => 0n)
const writeContract = vi.fn(async () => "0xapprovetx")
const waitForTransactionReceipt = vi.fn(async () => ({ status: "success" }))
const ensureWalletClient = vi.fn(() => ({ writeContract }))

vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({
		address: addressRef,
		publicClient: { readContract, waitForTransactionReceipt },
		ensureWalletClient,
	}),
}))
vi.mock("@/contracts/bridge-deployments", () => ({
	BRIDGE_TOKEN_DECIMALS: 6,
	L1_USDC: "0xusdc",
	L1_PORTAL: "0xportal",
	FUEL_ASSET: "0xfjasset",
	FUEL_PORTAL: "0xfjportal",
}))

async function freshModule() {
	vi.resetModules()
	return await import("./useL1FeeAsset")
}

const OWNER = "0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d"

describe("useL1FeeAsset", () => {
	beforeEach(() => {
		addressRef.value = null
		readContract.mockClear()
		writeContract.mockClear()
		waitForTransactionReceipt.mockClear()
		ensureWalletClient.mockClear()
		ensureWalletClient.mockReturnValue({ writeContract })
	})

	it("balance is null while disconnected and fetches the fee asset once an address appears", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		expect(fa.balance.value).toBeNull()
		readContract.mockResolvedValueOnce(123n)
		addressRef.value = OWNER
		await vi.waitFor(() => expect(fa.balance.value).toBe(123n))
		expect(readContract).toHaveBeenCalledWith(
			expect.objectContaining({ address: "0xfjasset", functionName: "balanceOf", args: [OWNER] }),
		)
	})

	it("refresh re-reads the balance on demand", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		addressRef.value = OWNER
		readContract.mockResolvedValueOnce(1n)
		await fa.refresh()
		readContract.mockResolvedValueOnce(2n)
		await fa.refresh()
		expect(fa.balance.value).toBe(2n)
	})

	it("allowance reads (owner, FeeJuicePortal) and returns 0n when disconnected", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		expect(await fa.allowance()).toBe(0n)
		addressRef.value = OWNER
		readContract.mockResolvedValueOnce(55n)
		expect(await fa.allowance()).toBe(55n)
		expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "allowance", args: [OWNER, "0xfjportal"] }))
	})

	it("approve writes approve(FeeJuicePortal, amount), awaits the receipt, clears the flag", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		addressRef.value = OWNER
		await fa.approve(1000n)
		expect(writeContract).toHaveBeenCalledWith(
			expect.objectContaining({ address: "0xfjasset", functionName: "approve", args: ["0xfjportal", 1000n], account: OWNER }),
		)
		expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xapprovetx" })
		expect(fa.approving.value).toBe(false)
	})

	it("approve without a wallet surfaces the connect error and never writes", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		ensureWalletClient.mockReturnValue(null as never)
		await fa.approve(1000n)
		expect(writeContract).not.toHaveBeenCalled()
		expect(fa.error.value).toMatch(/connect/i)
	})

	it("a failing approve sets error and clears the approving flag", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		addressRef.value = OWNER
		writeContract.mockRejectedValueOnce(new Error("user rejected"))
		await fa.approve(1000n)
		expect(fa.error.value).toMatch(/rejected/i)
		expect(fa.approving.value).toBe(false)
	})
})
