import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const addressRef = ref<string | null>(null)
const readContract = vi.fn(async () => 0n)
const writeContract = vi.fn(async () => "0xminttx")
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
	L1_USDC: "0xusdc",
	L1_PORTAL: "0xportal",
}))

async function freshModule() {
	vi.resetModules()
	return await import("./useL1Usdc")
}

const OWNER = "0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d"

describe("useL1Usdc", () => {
	beforeEach(() => {
		addressRef.value = null
		readContract.mockClear()
		writeContract.mockClear()
		waitForTransactionReceipt.mockClear()
		ensureWalletClient.mockClear()
		ensureWalletClient.mockReturnValue({ writeContract })
	})

	it("balance is null while disconnected and fetches once an address appears", async () => {
		const { useL1Usdc } = await freshModule()
		const usdc = useL1Usdc()
		expect(usdc.balance.value).toBeNull()
		readContract.mockResolvedValueOnce(123n)
		addressRef.value = OWNER
		await vi.waitFor(() => expect(usdc.balance.value).toBe(123n))
		expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "balanceOf", args: [OWNER] }))
	})

	it("refresh re-reads the balance on demand", async () => {
		const { useL1Usdc } = await freshModule()
		const usdc = useL1Usdc()
		addressRef.value = OWNER
		readContract.mockResolvedValueOnce(1n)
		await usdc.refresh()
		readContract.mockResolvedValueOnce(2n)
		await usdc.refresh()
		expect(usdc.balance.value).toBe(2n)
	})

	it("allowance reads (owner, portal) and returns 0n when disconnected", async () => {
		const { useL1Usdc } = await freshModule()
		const usdc = useL1Usdc()
		expect(await usdc.allowance()).toBe(0n)
		addressRef.value = OWNER
		readContract.mockResolvedValueOnce(55n)
		expect(await usdc.allowance()).toBe(55n)
		expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "allowance", args: [OWNER, "0xportal"] }))
	})

	it("mint writes the fixed amount to the connected account, awaits the receipt, refreshes", async () => {
		const { useL1Usdc, MINT_AMOUNT } = await freshModule()
		const usdc = useL1Usdc()
		addressRef.value = OWNER
		readContract.mockResolvedValue(777n)
		await usdc.mint()
		expect(writeContract).toHaveBeenCalledWith(
			expect.objectContaining({ functionName: "mint", args: [OWNER, MINT_AMOUNT], account: OWNER }),
		)
		expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xminttx" })
		expect(usdc.balance.value).toBe(777n)
		expect(usdc.minting.value).toBe(false)
	})

	it("mint without a wallet surfaces the connect error and never writes", async () => {
		const { useL1Usdc } = await freshModule()
		const usdc = useL1Usdc()
		ensureWalletClient.mockReturnValue(null as never)
		await usdc.mint()
		expect(writeContract).not.toHaveBeenCalled()
		expect(usdc.error.value).toMatch(/connect/i)
	})

	it("a failing mint sets error and clears the minting flag", async () => {
		const { useL1Usdc } = await freshModule()
		const usdc = useL1Usdc()
		addressRef.value = OWNER
		writeContract.mockRejectedValueOnce(new Error("user rejected"))
		await usdc.mint()
		expect(usdc.error.value).toMatch(/rejected/i)
		expect(usdc.minting.value).toBe(false)
	})
})
