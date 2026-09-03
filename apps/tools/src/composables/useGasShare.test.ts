import { signedMinFuelOutput, type TokenState } from "@nulo/bridge-core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useGasShare } from "./useGasShare"

/** The generation's swap block; `undefined` stands in for a network with no venue. */
const h = vi.hoisted(() => ({ swap: { value: undefined as unknown } }))

vi.mock("@/contracts/bridge-generation", () => ({
	get SWAP() {
		return h.swap.value
	},
}))

const FJ_PER_TX = 100_000_000_000_000_000n
const FJ_REGISTER = 500_000_000_000_000_000n
const MIN_FUEL_FJ = 1_000_000_000_000_000_000n
const SLIPPAGE_BPS = 100

const SWAP_FIXTURE = {
	poolManager: "0x0000000000000000000000000000000000000001",
	quoter: "0x0000000000000000000000000000000000000002",
	multicall3: "0x0000000000000000000000000000000000000003",
	weth: "0x0000000000000000000000000000000000000004",
	feeJuice: "0x0000000000000000000000000000000000000005",
	tiers: [{ fee: 3000, tickSpacing: 60 }],
	ethFj: { fee: 3000, tickSpacing: 60 },
	slippageBps: SLIPPAGE_BPS,
	minFuelFj: MIN_FUEL_FJ.toString(),
	fjPerTx: FJ_PER_TX.toString(),
	fjRegister: FJ_REGISTER.toString(),
}

const REGISTRATION = {
	portal: "0x0000000000000000000000000000000000000009",
	decimals: 6,
	registerIndex: 1n,
	nameWord: `0x${"0".repeat(64)}`,
	symbolWord: `0x${"0".repeat(64)}`,
	registerKey: `0x${"0".repeat(64)}`,
} as const

const REGISTERED: TokenState = { kind: "registered", registration: REGISTRATION, l2Token: `0x${"1".repeat(64)}` }
const FIRST_TIME: TokenState = { kind: "first-time" }
const PORTAL_ONLY: TokenState = { kind: "portal-only", registration: REGISTRATION }

/** One whole token buys one whole Fee Juice — the arithmetic stays legible in the assertions. */
const RATE = { probeIn: 1_000_000n, probeOut: 1_000_000_000_000_000_000n }
const AMOUNT = 1_000_000_000n

describe("useGasShare", () => {
	beforeEach(() => {
		h.swap.value = SWAP_FIXTURE
	})

	it("sizes a registered token's slice to txTarget × fjPerTx", () => {
		const { txTarget, propose } = useGasShare()
		expect(txTarget.value).toBe(20)
		const result = propose({ amount: AMOUNT, decimals: 6, state: REGISTERED, rate: RATE })
		expect(result?.fuelFj).toBe(20n * FJ_PER_TX)
		expect(result?.capped).toBeNull()
	})

	it("adds fjRegister for a token the hub has not registered yet", () => {
		const { propose } = useGasShare()
		const registered = propose({ amount: AMOUNT, decimals: 6, state: REGISTERED, rate: RATE })
		const firstTime = propose({ amount: AMOUNT, decimals: 6, state: FIRST_TIME, rate: RATE })
		expect(firstTime?.fuelFj).toBe(20n * FJ_PER_TX + FJ_REGISTER)
		expect(firstTime?.fuelAmount).toBeGreaterThan(registered?.fuelAmount ?? 0n)
	})

	it("adds fjRegister for a portal-only token too — its first claim still registers", () => {
		const { propose } = useGasShare()
		expect(propose({ amount: AMOUNT, decimals: 6, state: PORTAL_ONLY, rate: RATE })?.fuelFj).toBe(20n * FJ_PER_TX + FJ_REGISTER)
	})

	it("buys at least the claim minimum when the tx target asks for less", () => {
		const { txTarget, propose } = useGasShare()
		txTarget.value = 1
		const result = propose({ amount: AMOUNT, decimals: 6, state: REGISTERED, rate: RATE })
		expect(result?.fuelFj).toBe(MIN_FUEL_FJ)
		expect(result?.capped).toBe("min")
	})

	it("never diverts more than half the deposit", () => {
		const { propose } = useGasShare()
		const result = propose({ amount: 10n, decimals: 6, state: REGISTERED, rate: RATE })
		expect(result?.fuelAmount).toBe(5n)
		expect(result?.capped).toBe("half")
	})

	it("sizes the input so the signed floor still reaches the Fee Juice target", () => {
		const { propose } = useGasShare()
		const result = propose({ amount: AMOUNT, decimals: 6, state: REGISTERED, rate: RATE })
		const quote = ((result?.fuelAmount ?? 0n) * RATE.probeOut) / RATE.probeIn
		expect(signedMinFuelOutput(quote, SLIPPAGE_BPS, MIN_FUEL_FJ)).toBeGreaterThanOrEqual(result?.fuelFj ?? 0n)
	})

	it("re-proposes a bigger slice when the tx target moves", () => {
		const { txTarget, propose } = useGasShare()
		const before = propose({ amount: AMOUNT, decimals: 6, state: REGISTERED, rate: RATE })
		txTarget.value = 40
		const after = propose({ amount: AMOUNT, decimals: 6, state: REGISTERED, rate: RATE })
		expect(after?.fuelFj).toBe(40n * FJ_PER_TX)
		expect(after?.fuelAmount).toBeGreaterThan(before?.fuelAmount ?? 0n)
	})

	it("floors a quote at quote × (1 − slippage)", () => {
		const { floorFor } = useGasShare()
		expect(floorFor(10n * MIN_FUEL_FJ)).toBe((10n * MIN_FUEL_FJ * 9900n) / 10_000n)
	})

	it("never floors below the claim minimum", () => {
		const { floorFor } = useGasShare()
		expect(floorFor(MIN_FUEL_FJ)).toBe(MIN_FUEL_FJ)
	})

	it("proposes nothing and refuses a floor when the network has no swap venue", () => {
		h.swap.value = undefined
		const { propose, floorFor } = useGasShare()
		expect(propose({ amount: AMOUNT, decimals: 6, state: REGISTERED, rate: RATE })).toBeNull()
		expect(() => floorFor(MIN_FUEL_FJ)).toThrow(/no swap venue/)
	})

	it("propagates bridge-core's input validation rather than inventing a slice", () => {
		const { propose, floorFor } = useGasShare()
		expect(() => propose({ amount: 0n, decimals: 6, state: REGISTERED, rate: RATE })).toThrow(/amount must be positive/)
		expect(() => propose({ amount: AMOUNT, decimals: 6, state: REGISTERED, rate: { probeIn: 1n, probeOut: 0n } })).toThrow(
			/probeOut must be positive/,
		)
		expect(() => floorFor(0n)).toThrow(/empty quote/)
	})

	it("dispose returns the tx target to its default", () => {
		const { txTarget, dispose } = useGasShare()
		txTarget.value = 99
		dispose()
		expect(txTarget.value).toBe(20)
	})
})
