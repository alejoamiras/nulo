/// <reference types="node" />
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"

// base.css is HAND-AUTHORED — a verbatim flatten of the extension's _base.scss + _flex.scss +
// _text.scss. Unlike tokens.ts and utilities.css (generated + drift-pinned), nothing else pins
// it, yet it carries the look-same risk: token values, the [theme] blocks, @font-face, resets,
// keyframes, .material-symbols-outlined. A dropped or edited rule changes rendering with no test
// failure. This pin makes every edit deliberate: a real change updates the hash in the same
// commit, where the diff gets re-verified against the pixel-identical constraint.
test("base.css content is pinned (edits must be deliberate + visually re-verified)", () => {
	const css = readFileSync(join(process.cwd(), "src/base.css"), "utf8")
	const hash = createHash("sha256").update(css).digest("hex")
	// 2026-08-13 (home-refresh): .copyable cursor: copy → pointer. Deliberate; visually re-verified
	// in the Phase-5 manual pass (the copy cursor is a drag-and-drop signal, wrong for click-to-copy).
	// 2026-09-20 (firefox): `* { scrollbar-width: none }` beside the `::-webkit-scrollbar` rule Firefox
	// ignores, and `-moz-osx-font-smoothing` on the icon font. Deliberate; re-verified by screenshotting
	// 16 popup routes in both browsers — Chrome unchanged, Firefox matching it.
	// 2026-09-23 (attribution): an Apache-2.0 §4(b) header comment on line 1. No rule changed.
	expect(hash).toBe("329bfd99da60aaae47b9600c98a983822fad7abb5e19adc1470ee9a91e5fd4a8")
})
