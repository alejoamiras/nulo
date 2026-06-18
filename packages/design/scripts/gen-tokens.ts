#!/usr/bin/env bun
import { renderTokensModule } from "../src/internal/render-tokens"

/**
 * Writes src/tokens.ts from the token contract. Run via `bun run gen:tokens`.
 * Build-only — kept outside src/ (tsconfig include is src/**) so Bun globals don't reach vue-tsc.
 */
const out = new URL("../src/tokens.ts", import.meta.url)
await Bun.write(out, renderTokensModule())
console.log(`gen:tokens → ${out.pathname}`)
