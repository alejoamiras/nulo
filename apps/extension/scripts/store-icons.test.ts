import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import manifest from "../manifest/manifest.config"
import { ICON_SIZES, type IconSize, MASTER_PATH, iconPath, renderIcons, staleIcons } from "./store-icons"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => new Uint8Array(readFileSync(resolve(ROOT, rel)))

// PNG IHDR: width and height are the big-endian u32s at offsets 16 and 20.
const pngSize = (png: Uint8Array) => {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
	return [view.getUint32(16), view.getUint32(20)]
}

describe("store icons", () => {
	const rendered = renderIcons(read(MASTER_PATH))

	test("renders every manifest size as a square PNG of that size", async () => {
		for (const size of ICON_SIZES) {
			expect(pngSize((await rendered).get(size) as Uint8Array)).toEqual([size, size])
		}
	})

	// The drift check the script's `--check` runs: the committed files are exactly the render.
	test("the committed icons match the master", async () => {
		expect(staleIcons(await rendered, (size) => read(iconPath(size)))).toEqual([])
	})

	test("a missing or altered file is reported as stale", async () => {
		const icons = await rendered
		const altered = (size: IconSize) => (size === 48 ? null : size === 128 ? (icons.get(16) ?? null) : (icons.get(size) ?? null))
		expect(staleIcons(icons, altered)).toEqual([48, 128])
	})

	test("the manifest maps each size to its own generated file", () => {
		const icons = (manifest as unknown as { icons: Record<string, string> }).icons
		expect(
			Object.keys(icons)
				.map(Number)
				.sort((a, b) => a - b),
		).toEqual([...ICON_SIZES])
		for (const size of ICON_SIZES) expect(icons[String(size)]).toBe(iconPath(size))
	})
})
