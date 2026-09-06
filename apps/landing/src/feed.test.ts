import { describe, expect, it } from "vitest"
import { BAYER4, createField, quantize, RAMP, renderFrame, subjectAt } from "./feed"

const field = createField(7)
const base = { cols: 40, rows: 12, time: 1.5, gain: 1.15, subject: false }

describe("renderFrame", () => {
	it("returns exactly rows lines of cols glyphs, all from the ramp", () => {
		const lines = renderFrame(field, base).split("\n")
		expect(lines.at(-1)).toBe("")
		const rows = lines.slice(0, -1)
		expect(rows).toHaveLength(base.rows)
		for (const row of rows) {
			expect(row).toHaveLength(base.cols)
			for (const ch of row) expect(RAMP).toContain(ch)
		}
	})

	it("is deterministic for a seed and time, and changes with time", () => {
		const first = renderFrame(field, base)
		expect(renderFrame(createField(7), base)).toBe(first)
		expect(renderFrame(field, { ...base, time: base.time + 5 })).not.toBe(first)
	})

	it("renders only spaces at gain 0", () => {
		expect(renderFrame(field, { ...base, gain: 0 }).replace(/\n/g, "")).toMatch(/^ +$/)
	})

	it("brightens the cells around the subject", () => {
		const density = (frame: string, centre: { x: number; y: number }) => {
			const rows = frame.split("\n")
			let sum = 0
			let n = 0
			for (let y = centre.y - 2; y <= centre.y + 2; y++) {
				for (let x = centre.x - 4; x <= centre.x + 4; x++) {
					sum += RAMP.indexOf((rows[y] as string)[x] as (typeof RAMP)[number])
					n++
				}
			}
			return sum / n
		}
		const p = subjectAt(base.time)
		const centre = { x: Math.round(p.x * base.cols), y: Math.round(p.y * base.rows) }
		const plain = density(renderFrame(field, base), centre)
		const lit = density(renderFrame(field, { ...base, subject: true }), centre)
		// The 9×5 window is wider than the blob, so the mean rises by about half a ramp level.
		expect(lit).toBeGreaterThan(plain + 0.4)
	})
})

describe("quantize", () => {
	it("reproduces the Bayer threshold pattern for a constant mid-grey", () => {
		const pattern = [0, 1, 2, 3].map((y) => [0, 1, 2, 3].map((x) => quantize(0.5, x, y)).join(""))
		const expected = [0, 1, 2, 3].map((y) =>
			[0, 1, 2, 3]
				.map((x) => {
					const t = (BAYER4[y] as readonly number[])[x] as number
					return Math.min(4, Math.max(0, Math.floor(2.5 + ((t + 0.5) / 16 - 0.5) * 1.4)))
				})
				.join(""),
		)
		expect(pattern).toEqual(expected)
		expect(new Set(pattern.join("")).size).toBeGreaterThan(1)
	})
})
