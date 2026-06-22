import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const addressRef = ref<string | null>(null)
const readContract = vi.fn(async (_a?: { functionName?: string }): Promise<unknown> => 0n)
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
	FUEL_ASSET_HANDLER: "0xfjhandler",
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

	it("verifyPortalAsset passes when the portal's UNDERLYING() matches the fee asset, then caches", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		readContract.mockResolvedValueOnce("0xfjasset" as never)
		await expect(fa.verifyPortalAsset()).resolves.toBeUndefined()
		expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: "0xfjportal", functionName: "UNDERLYING" }))
		const reads = readContract.mock.calls.length
		await fa.verifyPortalAsset() // verified — served from the session cache, no second read
		expect(readContract.mock.calls.length).toBe(reads)
	})

	it("verifyPortalAsset REFUSES (throws) when UNDERLYING() doesn't match the configured fee asset", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		readContract.mockResolvedValueOnce("0xWRONGASSET" as never)
		await expect(fa.verifyPortalAsset()).rejects.toThrow(/mismatch/i)
	})

	it("mint calls FeeAssetHandler.mint(owner) after the FEE_ASSET cross-check, awaits the receipt, refreshes", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		readContract.mockImplementation(async (a) => (a?.functionName === "FEE_ASSET" ? "0xfjasset" : 0n))
		addressRef.value = OWNER
		await fa.mint()
		expect(writeContract).toHaveBeenCalledWith(
			expect.objectContaining({ address: "0xfjhandler", functionName: "mint", args: [OWNER], account: OWNER }),
		)
		expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xapprovetx" })
		expect(fa.mintError.value).toBeNull()
		expect(fa.minting.value).toBe(false)
	})

	it("mint REFUSES (no write) when the handler's FEE_ASSET() doesn't match the configured asset", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		readContract.mockImplementation(async (a) => (a?.functionName === "FEE_ASSET" ? "0xWRONG" : 0n))
		addressRef.value = OWNER
		await fa.mint()
		expect(writeContract).not.toHaveBeenCalled()
		expect(fa.mintError.value).toMatch(/mismatch/i)
	})

	it("mint without a wallet sets mintError (NOT the shared error) and never writes", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		ensureWalletClient.mockReturnValue(null as never)
		await fa.mint()
		expect(writeContract).not.toHaveBeenCalled()
		expect(fa.mintError.value).toMatch(/connect/i)
		expect(fa.error.value).toBeNull()
	})

	it("a failing mint sets mintError and clears the minting flag", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		readContract.mockImplementation(async (a) => (a?.functionName === "FEE_ASSET" ? "0xfjasset" : 0n))
		addressRef.value = OWNER
		writeContract.mockRejectedValueOnce(new Error("user rejected"))
		await fa.mint()
		expect(fa.mintError.value).toMatch(/rejected/i)
		expect(fa.minting.value).toBe(false)
	})

	it("mint surfaces an on-chain revert (mined receipt status != success) as mintError, not a false success", async () => {
		const { useL1FeeAsset } = await freshModule()
		const fa = useL1FeeAsset()
		readContract.mockImplementation(async (a) => (a?.functionName === "FEE_ASSET" ? "0xfjasset" : 0n))
		addressRef.value = OWNER
		waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" } as never)
		await fa.mint()
		expect(fa.mintError.value).toMatch(/reverted/i)
		expect(fa.minting.value).toBe(false)
	})
})
