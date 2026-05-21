import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock the SDK boundary so the composable can be exercised end-to-end
// without a live wallet. We mock the Dripper contract proxy + the
// SponsoredFPC address resolver.

const mockDripperMethods = {
	drip_to_public: vi.fn(),
	drip_to_private: vi.fn(),
}
const mockDripper = { methods: mockDripperMethods }

vi.mock("@aztec/aztec.js/contracts", () => ({
	Contract: { at: vi.fn(async () => mockDripper) },
}))

vi.mock("@defi-wonderland/aztec-standards/dist/src/artifacts/Dripper.js", () => ({
	DripperContractArtifact: { name: "Dripper" },
}))

vi.mock("@/contracts/sponsored-fpc", () => ({
	getSponsoredFpcInstance: async () => ({
		address: { toString: () => "0xfpc" },
	}),
}))

vi.mock("@/contracts/deployments", () => ({
	DRIPPER: { toString: () => "0xdripper" },
}))

import { AztecAddress } from "@aztec/aztec.js/addresses"
import { __resetFaucetDripForTests, useFaucetDrip } from "./useFaucetDrip"

const USDC_ADDR = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000002")
const ETH_ADDR = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000003")
const ACCOUNT = AztecAddress.fromString("0x000000000000000000000000000000000000000000000000000000000000000a")

const USDC = { symbol: "USDC", decimals: 6, displayAmount: "1,000", onchainAmount: 1_000_000_000n } as const
const ETH = { symbol: "ETH", decimals: 18, displayAmount: "1", onchainAmount: 1_000_000_000_000_000_000n } as const

function makeWallet() {
	const calls: { exec: unknown; opts: unknown }[] = []
	return {
		_calls: calls,
		sendTx: vi.fn(async (exec: unknown, opts: unknown) => {
			calls.push({ exec, opts })
			return { txHash: "0xdeadbeef0001" }
		}),
	}
}

beforeEach(() => {
	__resetFaucetDripForTests()
	mockDripperMethods.drip_to_public.mockReset()
	mockDripperMethods.drip_to_private.mockReset()
	mockDripperMethods.drip_to_public.mockImplementation(() => ({
		request: async () => ({ calls: [{ target: "public" }] }),
	}))
	mockDripperMethods.drip_to_private.mockImplementation(() => ({
		request: async () => ({ calls: [{ target: "private" }] }),
	}))
})

afterEach(() => {
	vi.clearAllMocks()
})

describe("useFaucetDrip", () => {
	it("drip-public uses the drip_to_public method with the USDC onchain amount", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		await drip.drip(USDC, USDC_ADDR, "public")
		expect(mockDripperMethods.drip_to_public).toHaveBeenCalledWith(USDC_ADDR, 1_000_000_000n)
		expect(mockDripperMethods.drip_to_private).not.toHaveBeenCalled()
	})

	it("drip-private uses the drip_to_private method", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		await drip.drip(USDC, USDC_ADDR, "private")
		expect(mockDripperMethods.drip_to_private).toHaveBeenCalledWith(USDC_ADDR, 1_000_000_000n)
	})

	it("ETH drips use the 1e18 onchain amount", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		await drip.drip(ETH, ETH_ADDR, "public")
		expect(mockDripperMethods.drip_to_public).toHaveBeenCalledWith(ETH_ADDR, 1_000_000_000_000_000_000n)
	})

	it("attaches the SponsoredFPC address as feePayer in the exec payload", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		await drip.drip(USDC, USDC_ADDR, "public")
		expect(w.sendTx).toHaveBeenCalledTimes(1)
		const [exec, opts] = w.sendTx.mock.calls[0]
		expect((exec as { feePayer?: { toString: () => string } }).feePayer?.toString()).toBe("0xfpc")
		expect((opts as { from: AztecAddress }).from).toBe(ACCOUNT)
	})

	it("on success, stores the tx hash under '<symbol>:<target>' in `last`", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		const result = await drip.drip(USDC, USDC_ADDR, "public")
		expect(result.kind).toBe("txHash")
		expect(result.value).toBe("0xdeadbeef0001")
		expect(drip.last["USDC:public"]).toEqual({ kind: "txHash", value: "0xdeadbeef0001" })
	})

	it("on wallet error, normalizes the error and stores it in `last`", async () => {
		const w = {
			sendTx: vi.fn(async () => {
				throw new Error("Transaction reverted on-chain")
			}),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		const result = await drip.drip(USDC, USDC_ADDR, "private")
		expect(result.kind).toBe("error")
		expect(result.category).toBe("tx-reverted")
		expect(drip.last["USDC:private"]?.kind).toBe("error")
	})

	it("clears `inflight` after a successful drip (returns to null)", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		expect(drip.inflight.value).toBeNull()
		await drip.drip(USDC, USDC_ADDR, "public")
		expect(drip.inflight.value).toBeNull()
	})

	it("clears `inflight` even after a wallet error", async () => {
		const w = {
			sendTx: vi.fn(async () => {
				throw new Error("Capability denied by user")
			}),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		await drip.drip(USDC, USDC_ADDR, "public")
		expect(drip.inflight.value).toBeNull()
	})

	it("global in-flight gate: a concurrent drip while one is active returns an error", async () => {
		let resolveSend: (v: { txHash: string }) => void = () => {}
		const w = {
			sendTx: vi.fn(
				() =>
					new Promise<{ txHash: string }>((r) => {
						resolveSend = r
					}),
			),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		const p1 = drip.drip(USDC, USDC_ADDR, "public")
		// While the first is in flight, the second is gated.
		await new Promise((r) => setTimeout(r, 0))
		const second = await drip.drip(ETH, ETH_ADDR, "public")
		expect(second.kind).toBe("error")
		expect(second.value).toMatch(/another drip is in flight/i)
		resolveSend({ txHash: "0x1" })
		await p1
	})

	it("isActive() reports the currently-running (token, target) pair", async () => {
		let resolveSend: (v: { txHash: string }) => void = () => {}
		const w = {
			sendTx: vi.fn(
				() =>
					new Promise<{ txHash: string }>((r) => {
						resolveSend = r
					}),
			),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		const p = drip.drip(USDC, USDC_ADDR, "private")
		await new Promise((r) => setTimeout(r, 0))
		expect(drip.isActive("USDC", "private")).toBe(true)
		expect(drip.isActive("ETH", "public")).toBe(false)
		resolveSend({ txHash: "0x1" })
		await p
		expect(drip.isActive("USDC", "private")).toBe(false)
	})
})
