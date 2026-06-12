import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/*
 * Mock the SDK boundary so the composable can be exercised end-to-end
 * without a live wallet. The contract proxy's `.request({ fee })`
 * receives the SponsoredFeePaymentMethod and returns an ExecutionPayload
 * that already has feePayer + the sponsor call merged - that's what
 * aztec.js does in real usage. We mimic the shape here.
 *
 * SponsoredFeePaymentMethod is also mocked so the test doesn't try to
 * construct the real class (which needs Aztec internals).
 */

const mockDripperMethods = {
	drip_to_public: vi.fn(),
	drip_to_private: vi.fn(),
}
const mockDripper = { methods: mockDripperMethods }

vi.mock("@aztec/aztec.js/contracts", () => ({
	Contract: { at: vi.fn(async () => mockDripper) },
}))

vi.mock("@aztec/aztec.js/fee", () => ({
	SponsoredFeePaymentMethod: class {
		readonly _kind = "sponsored"
		constructor(public readonly address: { toString: () => string }) {}
	},
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

const NULO_ADDR = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000002")
const OLUN_ADDR = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000003")
const ACCOUNT = AztecAddress.fromString("0x000000000000000000000000000000000000000000000000000000000000000a")

const NULO = { symbol: "NULO", decimals: 6, displayAmount: "1,000", onchainAmount: 1_000_000_000n } as const
const OLUN = { symbol: "OLUN", decimals: 18, displayAmount: "1", onchainAmount: 1_000_000_000_000_000_000n } as const

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

/**
 * Build an interaction whose `.request({ fee })` mimics aztec.js's
 * actual behavior: merges the sponsor call + feePayer into the payload
 * so the test can assert the dApp passes the merged exec to sendTx.
 */
function makeInteraction(target: "public" | "private") {
	return {
		request: vi.fn(async (opts?: { fee?: { paymentMethod: { address?: { toString: () => string } } } }) => {
			const sponsorAddr = opts?.fee?.paymentMethod?.address
			return {
				calls: [{ target }, ...(sponsorAddr ? [{ kind: "sponsor_unconditionally", on: sponsorAddr.toString() }] : [])],
				feePayer: sponsorAddr,
			}
		}),
	}
}

beforeEach(() => {
	__resetFaucetDripForTests()
	mockDripperMethods.drip_to_public.mockReset()
	mockDripperMethods.drip_to_private.mockReset()
	mockDripperMethods.drip_to_public.mockImplementation(() => makeInteraction("public"))
	mockDripperMethods.drip_to_private.mockImplementation(() => makeInteraction("private"))
})

afterEach(() => {
	vi.clearAllMocks()
})

describe("useFaucetDrip", () => {
	it("drip-public uses the drip_to_public method with the NULO onchain amount", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		await drip.drip(NULO, NULO_ADDR, "public")
		expect(mockDripperMethods.drip_to_public).toHaveBeenCalledWith(NULO_ADDR, 1_000_000_000n)
		expect(mockDripperMethods.drip_to_private).not.toHaveBeenCalled()
	})

	it("drip-private uses the drip_to_private method", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		await drip.drip(NULO, NULO_ADDR, "private")
		expect(mockDripperMethods.drip_to_private).toHaveBeenCalledWith(NULO_ADDR, 1_000_000_000n)
	})

	it("OLUN drips use the 1e18 onchain amount", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		await drip.drip(OLUN, OLUN_ADDR, "public")
		expect(mockDripperMethods.drip_to_public).toHaveBeenCalledWith(OLUN_ADDR, 1_000_000_000_000_000_000n)
	})

	it("passes a SponsoredFeePaymentMethod to interaction.request({fee}) so the sponsor call is embedded", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		await drip.drip(NULO, NULO_ADDR, "public")
		const interactionInstance = mockDripperMethods.drip_to_public.mock.results[0]?.value as ReturnType<typeof makeInteraction>
		expect(interactionInstance.request).toHaveBeenCalledWith({
			fee: { paymentMethod: expect.objectContaining({ _kind: "sponsored" }) },
		})
	})

	it("sendTx receives the merged exec (sponsor call + feePayer) and the selected account", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		await drip.drip(NULO, NULO_ADDR, "public")
		expect(w.sendTx).toHaveBeenCalledTimes(1)
		const [exec, opts] = w.sendTx.mock.calls[0]
		const execObj = exec as {
			feePayer?: { toString: () => string }
			calls: Array<{ kind?: string; target?: string }>
		}
		expect(execObj.feePayer?.toString()).toBe("0xfpc")
		// Both the dripper call and the sponsor_unconditionally call land in exec.calls.
		expect(execObj.calls.some((c) => c.target === "public")).toBe(true)
		expect(execObj.calls.some((c) => c.kind === "sponsor_unconditionally")).toBe(true)
		expect((opts as { from: AztecAddress }).from).toBe(ACCOUNT)
	})

	it("on success, stores the tx hash under '<symbol>:<target>' in `last`", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		const result = await drip.drip(NULO, NULO_ADDR, "public")
		expect(result.kind).toBe("txHash")
		expect(result.value).toBe("0xdeadbeef0001")
		expect(drip.last["NULO:public"]).toEqual({ kind: "txHash", value: "0xdeadbeef0001" })
	})

	it("on wallet error, normalizes the error and stores it in `last`", async () => {
		const w = {
			sendTx: vi.fn(async () => {
				throw new Error("Transaction reverted on-chain")
			}),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		const result = await drip.drip(NULO, NULO_ADDR, "private")
		expect(result.kind).toBe("error")
		expect(result.category).toBe("tx-reverted")
		expect(drip.last["NULO:private"]?.kind).toBe("error")
	})

	it("clears `inflight` after a successful drip (returns to null)", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const drip = useFaucetDrip(w as any, ACCOUNT)
		expect(drip.inflight.value).toBeNull()
		await drip.drip(NULO, NULO_ADDR, "public")
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
		await drip.drip(NULO, NULO_ADDR, "public")
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
		const p1 = drip.drip(NULO, NULO_ADDR, "public")
		await new Promise((r) => setTimeout(r, 0))
		const second = await drip.drip(OLUN, OLUN_ADDR, "public")
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
		const p = drip.drip(NULO, NULO_ADDR, "private")
		await new Promise((r) => setTimeout(r, 0))
		expect(drip.isActive("NULO", "private")).toBe(true)
		expect(drip.isActive("OLUN", "public")).toBe(false)
		resolveSend({ txHash: "0x1" })
		await p
		expect(drip.isActive("NULO", "private")).toBe(false)
	})
})
