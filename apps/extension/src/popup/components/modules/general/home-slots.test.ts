import { describe, expect, test } from "vitest"
import { capTokenRows, orderTokenRows } from "@/utils/token-order"
import { type SlotImportOp, homeSlots } from "./home-slots"

const CHAIN = 7
const seed = (symbol: string, chainId = CHAIN) => ({ chainId, contract: `0xSeed${symbol}`, symbol, displayName: `Test ${symbol}` })
const SEEDS = ["USDC", "USDT", "EURC", "GBPC"].map((symbol) => seed(symbol))
/** Lowercase on purpose: the seed list's contracts are mixed case. */
const op = (symbol: string, id = symbol, terminalAt: number | null = null): SlotImportOp => ({
	id,
	contractAddress: `0xseed${symbol.toLowerCase()}`,
	terminalAt,
})
const tokenRow = (symbol: string, id: number, updatedAt = 0) => ({
	id,
	token: { chainId: CHAIN, contract: `0xseed${symbol.toLowerCase()}`, name: `Test ${symbol}`, symbol, decimals: 6 },
	publicBalance: "0",
	privateBalance: "0",
	updatedAt,
})
type TokenRow = ReturnType<typeof tokenRow>
const slotsOf = (rows: TokenRow[], imports: SlotImportOp[], seeds = SEEDS) => homeSlots({ rows, imports, seeds, chainId: CHAIN })

describe("homeSlots", () => {
	test("every default on its way holds one slot under its compiled-in name; another chain's hold none", () => {
		const { slots, userImports } = slotsOf([], [], [...SEEDS, seed("XYZ", 99)])
		expect(slots.map((s) => [s.kind, s.key, s.token.name])).toEqual([
			["seed", "seed:0xseedusdc", "Test USDC"],
			["seed", "seed:0xseedusdt", "Test USDT"],
			["seed", "seed:0xseedeurc", "Test EURC"],
			["seed", "seed:0xseedgbpc", "Test GBPC"],
		])
		expect(userImports).toEqual([])
	})

	test("a default's import row takes its slot, a running attempt beats a failed one, its token row ends both", () => {
		const imports = [op("USDC", "failed", 5), op("USDC", "retry")]
		const importing = slotsOf([], imports).slots.find((s) => s.token.symbol === "USDC")
		expect(importing?.kind === "import" && importing.op.id).toBe("retry")

		const landed = slotsOf([tokenRow("USDC", 1)], imports)
		expect(landed.slots.filter((s) => s.token.symbol === "USDC").map((s) => s.kind)).toEqual(["token"])
		expect(landed.userImports).toEqual([])
	})

	test("an import of anything but a default stays outside the slots", () => {
		const own = [
			{ id: "other", contractAddress: "0xother", terminalAt: null },
			{ id: "blank", contractAddress: undefined, terminalAt: null },
		]
		const { slots, userImports } = slotsOf([], own)
		expect(userImports.map((o) => o.id)).toEqual(["other", "blank"])
		expect(slots.map((s) => s.kind)).toEqual(["seed", "seed", "seed", "seed"])
	})

	test("adding the four defaults never changes the three rows Home shows or the count", () => {
		const steps: [TokenRow[], SlotImportOp[]][] = [
			[[], []],
			[[], [op("USDC")]],
			[[tokenRow("USDC", 1)], [op("USDT"), op("EURC")]],
			[[tokenRow("USDC", 1, 1), tokenRow("USDT", 2), tokenRow("EURC", 3)], [op("GBPC")]],
			[["USDC", "USDT", "EURC", "GBPC"].map((symbol, i) => tokenRow(symbol, i + 1, 1)), []],
		]
		for (const [rows, imports] of steps) {
			const { slots } = slotsOf(rows, imports)
			const home = capTokenRows(orderTokenRows(slots, { pinnedContracts: new Set(), fiatOf: () => undefined }))
			expect(home.shown.map((s) => s.token.symbol)).toEqual(["EURC", "GBPC", "USDC"])
			expect(home.overflow).toBe(1)
			expect(slots).toHaveLength(4)
		}
	})
})
