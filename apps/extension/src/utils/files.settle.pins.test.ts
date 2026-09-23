/**
 * Pre-extraction settlement pins for `pickFile` (codex conditions for the mechanical split): the
 * hidden input is removed BEFORE the promise settles; a plain file, a capped file and a
 * no-decompress pick all settle after EXACTLY the same number of microtasks as today (the plain path
 * resolves synchronously inside `onchange`; `pickFile`'s async wrapper adopts that in 3 ticks) — a
 * `.then(resolve, reject)` relay would add to it; the byte cap rejects with the exact `FileTooLargeError`
 * carrying the cap; a decompression failure resolves the ORIGINAL file object (warn-and-fallback).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { FileTooLargeError, pickFile } from "./files"

/** Mount pickFile's hidden input, plant `file`; `fire` triggers onchange. */
function pick(file: File, maxBytes?: number, autoDecompress = true) {
	const picked = pickFile(undefined, false, autoDecompress, maxBytes)
	const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')
	if (!input?.onchange) throw new Error("pickFile input not mounted")
	Object.defineProperty(input, "files", { value: [file] })
	return { picked, input, fire: () => input.onchange?.(new Event("change")) }
}

/** Microtasks until `p` settles (either way), counted from now. */
async function ticksUntilSettled(p: Promise<unknown>): Promise<number> {
	let settled = false
	p.then(
		() => {
			settled = true
		},
		() => {
			settled = true
		},
	)
	for (let i = 1; i <= 10; i++) {
		await Promise.resolve()
		if (settled) return i
	}
	return -1
}

const SETTLE_TICKS = 3

afterEach(() => {
	document.body.innerHTML = ""
	vi.restoreAllMocks()
})

describe("pickFile — settlement order", () => {
	test("the hidden input is removed from the DOM before the pick settles", async () => {
		const { picked, input, fire } = pick(new File(["{}"], "a.json"))
		fire()
		expect(input.isConnected).toBe(false)
		await picked
	})

	test("a plain file settles after exactly the historical tick count", async () => {
		const { picked, fire } = pick(new File(["{}"], "a.json"))
		fire()
		expect(await ticksUntilSettled(picked)).toBe(SETTLE_TICKS)
	})

	test("the byte cap rejects after the same tick count, with a FileTooLargeError carrying the cap", async () => {
		const { picked, fire } = pick(new File(["x".repeat(64)], "big.json"), 16)
		fire()
		const rejected = picked.catch((e) => e)
		expect(await ticksUntilSettled(picked)).toBe(SETTLE_TICKS)
		const err = await rejected
		expect(err).toBeInstanceOf(FileTooLargeError)
		expect((err as FileTooLargeError).limitBytes).toBe(16)
	})

	test("autoDecompress off resolves a compressed-named file as-is, after the same tick count", async () => {
		const file = new File(["raw"], "keep.json.gz")
		const { picked, fire } = pick(file, undefined, false)
		fire()
		expect(await ticksUntilSettled(picked)).toBe(SETTLE_TICKS)
		expect(await picked).toBe(file)
	})

	test("a `.gz`-named file that fails to inflate resolves the ORIGINAL file object after a warning", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const file = new File(["definitely not gzip"], "broken.json.gz")
		const { picked, fire } = pick(file)
		fire()
		expect(await picked).toBe(file)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to decompress broken.json.gz"), expect.anything())
	})
})
