/// <reference types="node" />
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SPRITE_KEYS, SPRITE_SOURCE, adoptableSymbols, hasSprite } from "./token-sprite"

// Read from disk as well as through the bundler: the guard has to hold for the committed bytes even
// if a future pipeline step rewrites what the `?raw` import returns.
const here = dirname(fileURLToPath(import.meta.url)) // src/components/send
const spriteFile = readFileSync(join(here, "../../assets/token-sprite.svg"), "utf8")

const KEY_SHAPE = /^\d+:0x[0-9a-f]{40}$/

describe("token sprite", () => {
	it("carries no <script>", () => {
		expect(spriteFile).not.toMatch(/<script\b/i)
	})

	it("carries no on* event handler attribute", () => {
		expect(spriteFile).not.toMatch(/\son[a-z]+\s*=/i)
	})

	it("carries no <foreignObject>", () => {
		expect(spriteFile).not.toMatch(/<foreignObject\b/i)
	})

	it("every <symbol id> is a chain id and a lowercase erc20", () => {
		const ids = [...spriteFile.matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1] as string)
		expect(ids.length).toBeGreaterThan(0)
		expect(ids.filter((id) => !KEY_SHAPE.test(id))).toEqual([])
	})

	it("the derived key set matches the committed symbols", () => {
		const ids = [...spriteFile.matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1] as string)
		expect([...SPRITE_KEYS].sort()).toEqual(ids.sort())
	})

	it("the bundled source is the committed file", () => {
		expect(SPRITE_SOURCE.replace(/\s+/g, " ")).toBe(spriteFile.replace(/\s+/g, " "))
	})

	it("hasSprite answers membership, not substring", () => {
		expect(hasSprite("1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")).toBe(true)
		expect(hasSprite("1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb4")).toBe(false)
		expect(hasSprite("11155111:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")).toBe(false)
	})

	it("adoption keeps every committed mark, glyph included", () => {
		const symbols = adoptableSymbols(SPRITE_SOURCE)
		expect(symbols).toHaveLength(SPRITE_KEYS.size)
		expect(symbols.map((s) => s.getAttribute("id")).sort()).toEqual([...SPRITE_KEYS].sort())
		expect(symbols.some((s) => s.querySelector("text") !== null)).toBe(true)
	})

	it("adoption strips a hostile sheet down to its drawing elements", () => {
		const hostile = [
			'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
			'<symbol id="1:0xhostile" onload="steal()">',
			"<script>steal()</script>",
			'<circle cx="1" onclick="steal()" />',
			'<a href="https://evil.example"><path d="M0 0" /></a>',
			'<use xlink:href="#1:0xother" />',
			"</symbol>",
			'<foreignObject><symbol id="1:0xsmuggled"><circle /></symbol></foreignObject>',
			"</svg>",
		].join("")
		const symbols = adoptableSymbols(hostile)
		// The smuggled symbol is nested under a dropped element, so adoption never reaches it.
		expect(symbols.map((s) => s.getAttribute("id"))).toEqual(["1:0xhostile"])
		const markup = symbols[0]?.outerHTML ?? ""
		expect(markup).not.toMatch(/script|onload|onclick|href|<a\b|<use\b/i)
		expect(markup).toContain("<circle")
	})
})
