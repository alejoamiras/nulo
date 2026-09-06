/**
 * Character-rendered "camera feed": value noise, an optional bright subject, ordered dithering
 * into a five-glyph ramp. Pure and DOM-free so it can be unit-tested and drawn anywhere a
 * monospace string fits.
 */

/** Darkest to brightest. Index 0 is a space so quiet areas render as nothing. */
export const RAMP = [" ", ".", ":", "+", "%"] as const

/** Bayer 4×4 threshold matrix; a stable pattern that does not shimmer between frames. */
export const BAYER4 = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
] as const

const LATTICE = 64

export type Field = {
	readonly a: Float32Array
	readonly b: Float32Array
}

export type FrameOptions = {
	cols: number
	rows: number
	/** Seconds; drives the blend between the two lattices and the drift. */
	time: number
	/** Extra scroll offset in cells; lets a cursor or scroll pan the field. */
	offsetX?: number
	offsetY?: number
	/** Brightness multiplier before quantisation; 0 renders an all-space frame. */
	gain: number
	/** Draw the brighter tracked subject. */
	subject: boolean
}

export type Point = { x: number; y: number }

/** mulberry32: tiny, deterministic, good enough for texture. */
function prng(seed: number): () => number {
	let s = seed >>> 0
	return () => {
		s = (s + 0x6d2b79f5) >>> 0
		let t = s
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function lattice(rand: () => number): Float32Array {
	const out = new Float32Array(LATTICE * LATTICE)
	for (let i = 0; i < out.length; i++) out[i] = rand()
	return out
}

export function createField(seed: number): Field {
	const rand = prng(seed)
	return { a: lattice(rand), b: lattice(rand) }
}

function at(l: Float32Array, x: number, y: number): number {
	const xi = ((x % LATTICE) + LATTICE) % LATTICE
	const yi = ((y % LATTICE) + LATTICE) % LATTICE
	return l[yi * LATTICE + xi] as number
}

/** Bilinear sample with smoothstep weights, so the noise reads as film grain rather than blocks. */
function smooth(l: Float32Array, x: number, y: number): number {
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const fx = x - x0
	const fy = y - y0
	const u = fx * fx * (3 - 2 * fx)
	const v = fy * fy * (3 - 2 * fy)
	const p = at(l, x0, y0)
	const q = at(l, x0 + 1, y0)
	const r = at(l, x0, y0 + 1)
	const s = at(l, x0 + 1, y0 + 1)
	return p + (q - p) * u + (r - p) * v + (p - q - r + s) * u * v
}

/** Where the tracked subject sits, as a fraction of the grid, for a given time. */
export function subjectAt(time: number): Point {
	return { x: 0.76 + 0.1 * Math.sin(time * 0.23), y: 0.5 + 0.22 * Math.cos(time * 0.17) }
}

/** Added brightness from the subject at cell (x, y): a soft disc, zero outside it. */
function subjectLight(x: number, y: number, centre: Point, cols: number, rows: number): number {
	const dx = (x - centre.x * cols) / (cols * 0.085)
	const dy = (y - centre.y * rows) / (rows * 0.16)
	const d = dx * dx + dy * dy
	return d < 1 ? (1 - d) * 0.55 : 0
}

/** Ordered-dither a brightness in [0, 1] at cell (x, y) to a ramp index. */
export function quantize(value: number, x: number, y: number): number {
	const threshold = ((BAYER4[y & 3] as readonly number[])[x & 3] as number) + 0.5
	const level = Math.floor(value * RAMP.length + (threshold / 16 - 0.5) * 1.4)
	return Math.min(RAMP.length - 1, Math.max(0, level))
}

function brightness(field: Field, x: number, y: number, o: FrameOptions, blend: number): number {
	const nx = (x + (o.offsetX ?? 0)) / 9
	const ny = (y + (o.offsetY ?? 0)) / 4.5
	const base = smooth(field.a, nx, ny) * (1 - blend) + smooth(field.b, nx, ny) * blend
	const detail = smooth(field.a, nx * 2.1 + 7, ny * 2.1 + 3)
	return base * 0.55 + detail * 0.25
}

/** One frame as `rows` newline-terminated lines of exactly `cols` glyphs. */
export function renderFrame(field: Field, o: FrameOptions): string {
	const blend = (Math.sin(o.time * 0.4) + 1) / 2
	const centre = subjectAt(o.time)
	let out = ""
	for (let y = 0; y < o.rows; y++) {
		let line = ""
		for (let x = 0; x < o.cols; x++) {
			let v = brightness(field, x, y, o, blend)
			if (o.subject) v += subjectLight(x, y, centre, o.cols, o.rows)
			v = Math.min(1, v * o.gain) ** 0.85
			line += RAMP[quantize(v, x, y)]
		}
		out += `${line}\n`
	}
	return out
}
