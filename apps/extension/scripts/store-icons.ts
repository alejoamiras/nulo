#!/usr/bin/env bun
// Renders the manifest icon set from the master logo, so every size is a derivative of one
// file and a stale set fails `--check` rather than shipping. All sizes are plain resizes of the
// square master: Chrome's guidance to draw the 128 icon as 96×96 art on a padded canvas is a
// recommendation, and `Bun.Image` cannot compose onto a larger canvas.
//
// Usage (from apps/extension): `bun scripts/store-icons.ts` writes the files;
// `bun scripts/store-icons.ts --check` renders in memory and exits 1 on any byte difference.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export const ICON_SIZES = [16, 32, 48, 96, 128] as const
export type IconSize = (typeof ICON_SIZES)[number]

export const MASTER_PATH = "src/assets/logo.png"
export const ICONS_DIR = "src/assets/icons"

export const iconPath = (size: IconSize) => `${ICONS_DIR}/${size}.png`

export async function renderIcons(master: Uint8Array): Promise<Map<IconSize, Uint8Array>> {
	const rendered = new Map<IconSize, Uint8Array>()
	for (const size of ICON_SIZES) {
		rendered.set(size, await new Bun.Image(master).resize(size, size).png().bytes())
	}
	return rendered
}

/** Sizes whose committed file is missing or differs from the render. */
export function staleIcons(rendered: Map<IconSize, Uint8Array>, committed: (size: IconSize) => Uint8Array | null): IconSize[] {
	return ICON_SIZES.filter((size) => {
		const current = committed(size)
		const fresh = rendered.get(size)
		return current === null || fresh === undefined || Buffer.compare(current, fresh) !== 0
	})
}

const ROOT = resolve(__dirname, "..")
const readCommitted = (size: IconSize) => {
	const path = resolve(ROOT, iconPath(size))
	return existsSync(path) ? new Uint8Array(readFileSync(path)) : null
}

async function main(check: boolean) {
	const rendered = await renderIcons(new Uint8Array(readFileSync(resolve(ROOT, MASTER_PATH))))
	const stale = staleIcons(rendered, readCommitted)
	if (check) {
		if (stale.length > 0) {
			console.error(`[store-icons] stale: ${stale.map(iconPath).join(", ")} — run \`bun scripts/store-icons.ts\``)
			process.exit(1)
		}
		console.log(`[store-icons] ${ICON_SIZES.length} icons match the master`)
		return
	}
	for (const size of stale) {
		const path = resolve(ROOT, iconPath(size))
		mkdirSync(dirname(path), { recursive: true })
		writeFileSync(path, rendered.get(size) as Uint8Array)
		console.log(`[store-icons] wrote ${iconPath(size)}`)
	}
	if (stale.length === 0) console.log("[store-icons] nothing to write")
}

if (import.meta.main) await main(process.argv.includes("--check"))
