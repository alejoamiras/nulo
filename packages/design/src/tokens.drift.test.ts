import { describe, expect, test } from "vitest"
import committedTokens from "./tokens.ts?raw"
import { renderTokensModule } from "./internal/render-tokens"

/**
 * Byte-pin: the committed src/tokens.ts must equal the generator's output. Fails CI if someone
 * hand-edits the generated file or changes token-contract.ts without running `bun run gen:tokens`.
 * Modeled on the repo's other committed-artifact pins (KDF key vectors).
 */
describe("tokens drift guard", () => {
	test("src/tokens.ts is byte-identical to the contract-derived output", () => {
		expect(committedTokens).toBe(renderTokensModule())
	})
})
