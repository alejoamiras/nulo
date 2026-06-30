/**
 * CSP-safe replacement for the `function-bind` npm package.
 *
 * Why this exists:
 * - MV3 service workers reject `'unsafe-eval'`. Our CSP at
 *   `manifest/manifest.config.ts:35-37` only permits `'wasm-unsafe-eval'`.
 * - The upstream `function-bind` package (a transitive dep of `get-intrinsic`,
 *   `call-bind`, and many others — including in the @aztec/* graph) builds
 *   a bound function from a dynamically-constructed string to preserve
 *   `f.length`. That construction triggers CSP and breaks any code path
 *   that goes through it (RPC response handling, signing, anything).
 * - Native `Function.prototype.bind` does the same thing in modern engines
 *   without dynamic code construction.
 *
 * Wired in via `resolve.alias` in `vite.config.ts`. Both `function-bind`
 * AND `function-bind/implementation` are aliased; some upstream packages
 * import the implementation entry directly.
 *
 * The file is intentionally CommonJS (.cjs) because consumers of
 * `function-bind` rely on `module.exports = fn` — i.e. the module *itself*
 * is the bind function. ESM `export default` would resolve to
 * `{ default: fn }` under CJS interop and crash callers that do
 * `bind.apply(...)`.
 *
 * Pattern adapted from Grego's `extension-wallet`. See
 * `wallets-architecture-research/grego/extension-wallet-claude-analysis.md`
 * for the rationale and source.
 */

"use strict"

var nativeBind = Function.prototype.bind

function bind(...args) {
	return nativeBind.apply(this, args)
}

module.exports = bind
