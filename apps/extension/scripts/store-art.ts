#!/usr/bin/env bun
// Renders the store art from `store/templates/` with Puppeteer: the 440×280 promo tile and one
// 1280×800 frame per popup capture in `store/captures/` (written by the opt-in
// `tests/e2e/store-captures.test.ts`). Local only; the PNGs are committed.
//
// Usage (from apps/extension): `bun scripts/store-art.ts`

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import puppeteer from "puppeteer"

const ROOT = resolve(__dirname, "..")
const STORE = resolve(ROOT, "store")
const FONT = resolve(ROOT, "../../packages/design/src/fonts/SpaceGrotesk-latin.woff2")

const dataUri = (path: string, type: string) => `data:${type};base64,${readFileSync(path).toString("base64")}`

const FRAMES = [
	{ capture: "home", title: "Your keys, your device.", caption: "A self-custody wallet for Aztec. No server, no account, no telemetry." },
	{
		capture: "send",
		title: "Private by default.",
		caption: "Transactions are proven in your browser, or by an optional local prover you install.",
	},
	{
		capture: "security",
		title: "You decide the locks.",
		caption: "Password or passkey profiles, strict session mode, auto-lock and backups on your terms.",
	},
] as const

function fill(template: string, values: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
		const value = values[key]
		if (value === undefined) throw new Error(`template placeholder without a value: ${key}`)
		return value
	})
}

async function render(html: string, width: number, height: number, out: string) {
	const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
	try {
		const page = await browser.newPage()
		await page.setViewport({ width, height, deviceScaleFactor: 1 })
		await page.setContent(html, { waitUntil: "load" })
		await page.evaluate(() => document.fonts.ready)
		await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } })
	} finally {
		await browser.close()
	}
	console.log(`[store-art] wrote ${out.slice(ROOT.length + 1)}`)
}

const font = dataUri(FONT, "font/woff2")
await render(fill(readFileSync(resolve(STORE, "templates/tile.html"), "utf8"), { font }), 440, 280, resolve(STORE, "promo-440x280.png"))

const frame = readFileSync(resolve(STORE, "templates/frame.html"), "utf8")
for (const [index, { capture, title, caption }] of FRAMES.entries()) {
	const png = resolve(STORE, "captures", `${capture}.png`)
	if (!existsSync(png)) {
		console.error(
			`[store-art] missing ${png.slice(ROOT.length + 1)} — run STORE_CAPTURES=1 … bun run test:e2e -- tests/e2e/store-captures.test.ts`,
		)
		process.exit(1)
	}
	const html = fill(frame, { font, title, caption, capture: dataUri(png, "image/png") })
	await render(html, 1280, 800, resolve(STORE, `screenshot-${index + 1}-1280x800.png`))
}
writeFileSync(resolve(STORE, "captures/.gitkeep"), "")
