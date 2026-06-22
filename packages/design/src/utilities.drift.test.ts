/// <reference types="node" />
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { renderUtilitiesCss } from "./internal/render-css"

/**
 * Byte-pin: the committed src/utilities.css must equal the generator's output. Fails CI if someone
 * hand-edits the generated file or changes the contract scales without `bun run gen:tokens`.
 * Read via node:fs because vitest stubs `.css` imports to empty (so `?raw` can't see the content);
 * `process.cwd()` is the package dir (tests run via `bun run --cwd packages/design test`).
 */
describe("utilities.css drift guard", () => {
	test("src/utilities.css is byte-identical to the contract-derived output", () => {
		const committed = readFileSync(join(process.cwd(), "src/utilities.css"), "utf8")
		expect(committed).toBe(renderUtilitiesCss())
	})
})
