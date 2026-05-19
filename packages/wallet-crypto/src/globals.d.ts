/**
 * Buffer ambient declaration for wallet-crypto.
 *
 * Rationale — don't `import { Buffer } from "buffer"` here:
 * vite's node-polyfill plugin rewrites that import to a shim path
 * that can't be resolved across workspace packages at build time.
 * Instead, the extension bundle enables
 * `nodePolyfills({ globals: { Buffer: true } })`, which makes naked
 * `Buffer` references auto-import the polyfill via rollup's inject
 * plugin. In jsdom tests (vitest + node env) Buffer is a real global
 * already.
 *
 * Type-only `import type` is fine — it's erased at build time and
 * doesn't trigger the polyfill plugin's runtime rewrite.
 */

import type { Buffer as NodeBuffer } from "node:buffer"

declare global {
	const Buffer: typeof NodeBuffer
}
