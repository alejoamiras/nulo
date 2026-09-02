import { describe, expect, it } from "vitest"
import { assertDripCandidateShape, assertZeroSeed } from "./promotion"

const ADDR32 = `0x${"ab".repeat(32)}`
const token = (authContract?: string) => ({ constructorArgs: { authContract } })

describe("assertDripCandidateShape", () => {
	it("accepts a post-5.0.1 candidate", () => {
		expect(() => assertDripCandidateShape({ tokens: [token(ADDR32)], dripper: {} })).not.toThrow()
	})
	it("rejects a malformed authContract (not a 32-byte aztec address)", () => {
		expect(() => assertDripCandidateShape({ tokens: [token("0xjunk")], dripper: {} })).toThrow(/not a 32-byte aztec address/)
		expect(() => assertDripCandidateShape({ tokens: [token("0x123")], dripper: {} })).toThrow(/not a 32-byte aztec address/)
	})
	it("rejects an empty or dripper-less candidate", () => {
		expect(() => assertDripCandidateShape({ tokens: [], dripper: {} })).toThrow(/shape invalid/)
		expect(() => assertDripCandidateShape({ tokens: [token(ADDR32)] })).toThrow(/shape invalid/)
	})
	it("rejects any pre-5.0.1 token record (missing authContract)", () => {
		expect(() => assertDripCandidateShape({ tokens: [token(ADDR32), token(undefined)], dripper: {} })).toThrow(/pre-5\.0\.1 shape/)
	})
})

describe("assertZeroSeed", () => {
	const fuel = { router: "0xr", weth: "0xw", pools: { a: 1 } }
	it("accepts byte-carried fuel and absent-in-both", () => {
		expect(() => assertZeroSeed(structuredClone(fuel), fuel)).not.toThrow()
		expect(() => assertZeroSeed(undefined, undefined)).not.toThrow()
	})
	it("rejects new, removed, or changed fuel sections", () => {
		expect(() => assertZeroSeed(fuel, undefined)).toThrow(/zero-seed violated/)
		expect(() => assertZeroSeed(undefined, fuel)).toThrow(/zero-seed violated/)
		expect(() => assertZeroSeed({ ...fuel, router: "0xother" }, fuel)).toThrow(/zero-seed violated/)
	})

	// The token cutover retires the token-keyed swap stack: core byte-carried + swap DROPPED whole,
	// allowed ONLY under the explicit operator flag — a changed core or altered swap still rejects.
	describe("allowSwapDrop (token cutover)", () => {
		const core = { router: "0xr", permit2: "0xp", swapTarget: "0xs", feeJuicePortal: "0xf" }
		const live = { core, swap: { quoter: "0xq", pools: { a: 1 } } }
		it("accepts core-carried + swap-dropped under the flag", () => {
			expect(() => assertZeroSeed({ core: structuredClone(core) }, live, { allowSwapDrop: true })).not.toThrow()
		})
		it("rejects the same shape WITHOUT the flag", () => {
			expect(() => assertZeroSeed({ core: structuredClone(core) }, live)).toThrow(/zero-seed violated/)
		})
		it("rejects a CHANGED core even under the flag", () => {
			expect(() => assertZeroSeed({ core: { ...core, router: "0xother" } }, live, { allowSwapDrop: true })).toThrow(
				/zero-seed violated/,
			)
		})
		// The core compare is STRICT byte-equality — even a metadata-only enrichment (the conductor
		// adding swapTargetContract) rejects, which is why the LIVE manifest carries the field
		// (backfilled) BEFORE a cutover. Codex r4 reproduced the failure; this pins the strictness.
		it("rejects a candidate core that ADDS a field the live core lacks (metadata enrichment)", () => {
			expect(() =>
				assertZeroSeed({ core: { ...core, swapTargetContract: "UniswapFuelSwap" } }, live, { allowSwapDrop: true }),
			).toThrow(/zero-seed violated/)
		})
		it("accepts identical cores that BOTH carry swapTargetContract (the backfilled live shape)", () => {
			const c = { ...core, swapTargetContract: "UniswapFuelSwap" }
			expect(() => assertZeroSeed({ core: structuredClone(c) }, { core: c, swap: live.swap }, { allowSwapDrop: true })).not.toThrow()
		})
		it("allowSwapAdd: accepts core-carried + a whole NEW swap under --restore-swap only", () => {
			const newSwap = { quoter: "0xq2", pools: { tokenWeth: { fee: 3000, tickSpacing: 60 } } }
			expect(() => assertZeroSeed({ core: structuredClone(core), swap: newSwap }, { core }, { allowSwapAdd: true })).not.toThrow()
			expect(() => assertZeroSeed({ core: structuredClone(core), swap: newSwap }, { core })).toThrow(/zero-seed violated/)
			// never a silent REPLACE of an existing swap through this door
			expect(() => assertZeroSeed({ core: structuredClone(core), swap: newSwap }, live, { allowSwapAdd: true })).toThrow(
				/zero-seed violated/,
			)
		})
		it("compares CANONICALLY — key order differences (zod vs raw JSON) do not reject", () => {
			const reordered = {
				feeJuicePortal: core.feeJuicePortal,
				swapTarget: core.swapTarget,
				permit2: core.permit2,
				router: core.router,
			}
			expect(() => assertZeroSeed({ core: reordered }, live, { allowSwapDrop: true })).not.toThrow()
		})
		it("rejects an ALTERED (not dropped) swap even under the flag", () => {
			expect(() =>
				assertZeroSeed({ core: structuredClone(core), swap: { quoter: "0xother" } }, live, { allowSwapDrop: true }),
			).toThrow(/zero-seed violated/)
		})
	})
})
