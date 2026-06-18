#!/usr/bin/env bun
import { renderUtilitiesCss } from "../src/internal/render-css"
import { renderTokensModule } from "../src/internal/render-tokens"

/**
 * Writes the generated design artifacts from the token contract. Run via `bun run gen:tokens`.
 * Build-only — kept outside src/ (tsconfig include is src/**) so Bun globals don't reach vue-tsc.
 *   - src/tokens.ts      typed token reflection (byte-pinned by tokens.drift.test.ts)
 *   - src/utilities.css  relocated _text.scss/_flex.scss utility layer (byte-pinned by utilities.drift.test.ts)
 */
await Bun.write(new URL("../src/tokens.ts", import.meta.url), renderTokensModule())
await Bun.write(new URL("../src/utilities.css", import.meta.url), renderUtilitiesCss())
console.log("gen:tokens → src/tokens.ts + src/utilities.css")
