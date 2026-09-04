import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import { TESTIDS } from "@/lib/testids"

const { MINTABLE, CANONICAL, CAPPED } = vi.hoisted(() => ({
	MINTABLE: "0x70e0ba845a1a0f2da3359c97e0285013525ffc49",
	CANONICAL: "0x4826533b4897376654bb4d4ad88b7fafd0c98528",
	CAPPED: "0x0e801d84fa97b50751dbf25036d067dcf18858bf",
}))

const writeContract = vi.fn(async () => "0xmint")
const receiptStatus = { value: "success" as "success" | "reverted" }
const isConnected = ref(true)

vi.mock("@nulo/bridge-core", () => ({ awaitL1Receipt: async () => ({ status: receiptStatus.value }) }))
vi.mock("@/contracts/bridge-generation", () => ({
	MANIFEST_TOKENS: [
		{ erc20: MINTABLE, decimals: 6, displaySymbol: "USDC", source: "permissionless-mint", maxWholePerTx: 1000 },
		{ erc20: CANONICAL, decimals: 18, displaySymbol: "REAL", source: "canonical" },
		{ erc20: CAPPED, decimals: 18, displaySymbol: "CAP", source: "permissionless-mint", maxWholePerTx: 5 },
	],
}))
vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({
		isConnected,
		address: ref("0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d"),
		publicClient: {},
		ensureWalletClient: () => ({ writeContract }),
	}),
}))

import MintTestToken from "./MintTestToken.vue"

const sel = (t: string) => `[data-testid="${t}"]`

beforeEach(() => {
	writeContract.mockClear()
	writeContract.mockResolvedValue("0xmint")
	receiptStatus.value = "success"
	isConnected.value = true
})

describe("MintTestToken", () => {
	it("renders nothing without a token, or for one the manifest does not list", () => {
		expect(mount(MintTestToken).find(sel(TESTIDS.mintL1Card)).exists()).toBe(false)
		const unknown = mount(MintTestToken, { props: { erc20: "0x1111111111111111111111111111111111111111" } })
		expect(unknown.find(sel(TESTIDS.mintL1Card)).exists()).toBe(false)
	})

	it("renders nothing for a canonical token — only a permissionless-mint one has mint()", () => {
		expect(
			mount(MintTestToken, { props: { erc20: CANONICAL } })
				.find(sel(TESTIDS.mintL1Card))
				.exists(),
		).toBe(false)
	})

	it("offers 100 whole units of a permissionless token, matched case-insensitively", () => {
		const w = mount(MintTestToken, { props: { erc20: MINTABLE.toUpperCase().replace("0X", "0x") } })
		expect(w.find(sel(TESTIDS.mintL1Card)).exists()).toBe(true)
		expect(w.get(sel(TESTIDS.mintL1)).text()).toBe("MINT 100 USDC")
	})

	it("never offers more than the token's per-transaction cap", () => {
		const w = mount(MintTestToken, { props: { erc20: CAPPED } })
		expect(w.get(sel(TESTIDS.mintL1)).text()).toBe("MINT 5 CAP")
	})

	it("asks to connect instead of minting while the L1 wallet is away", () => {
		isConnected.value = false
		const w = mount(MintTestToken, { props: { erc20: MINTABLE } })
		expect(w.get(sel(TESTIDS.mintL1)).text()).toBe("CONNECT YOUR ETHEREUM WALLET")
	})

	it("mints at the token's own decimals and reports the mint upward", async () => {
		const w = mount(MintTestToken, { props: { erc20: MINTABLE } })
		await w.get(sel(TESTIDS.mintL1)).trigger("click")
		await flushPromises()
		expect(writeContract).toHaveBeenCalledTimes(1)
		const args = (writeContract.mock.calls[0] as unknown as [{ args: [string, bigint]; address: string }])[0]
		expect(args.address).toBe(MINTABLE)
		expect(args.args[1]).toBe(100n * 10n ** 6n)
		expect(w.emitted("minted")).toHaveLength(1)
	})

	it("surfaces a mined revert as an error and emits nothing", async () => {
		receiptStatus.value = "reverted"
		const w = mount(MintTestToken, { props: { erc20: MINTABLE } })
		await w.get(sel(TESTIDS.mintL1)).trigger("click")
		await flushPromises()
		expect(w.get(sel(TESTIDS.mintL1Status)).text()).toMatch(/reverted on-chain/)
		expect(w.emitted("minted")).toBeUndefined()
	})

	it("surfaces a rejected wallet prompt without throwing", async () => {
		writeContract.mockRejectedValueOnce(new Error("User rejected the request."))
		const w = mount(MintTestToken, { props: { erc20: MINTABLE } })
		await w.get(sel(TESTIDS.mintL1)).trigger("click")
		await flushPromises()
		expect(w.get(sel(TESTIDS.mintL1Status)).text()).toMatch(/User rejected/)
		expect(w.emitted("minted")).toBeUndefined()
	})
})
