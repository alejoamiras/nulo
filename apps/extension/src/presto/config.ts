/**
 * Presto connection config. `offscreen/index.ts` threads these into `ProductionPxeFactory` as
 * primitives (`@nulo/aztec-runtime` never imports this module); pages reach Presto through
 * `getPrestoClient()`.
 *
 * `PRESTO_REQUIRED` is the CI-only switch: OFF for every production build, set by the network-e2e
 * workflow via `VITE_NULO_PRESTO_REQUIRED=1` at build time. Off, the SDK's silent WASM fallback is
 * preserved for users without Presto installed.
 */

export const PRESTO_HOST = "127.0.0.1"
export const PRESTO_PORT = 59833
export const PRESTO_HTTPS_PORT = 59834
/** Presto's download site: the pitch card's link and the settings "Get Presto" row. */
export const PRESTO_SITE_URL = "https://presto.build"

export const PRESTO_REQUIRED = (import.meta.env.VITE_NULO_PRESTO_REQUIRED ?? "") === "1"

/**
 * Build-time marker, present in the shipped bundle ONLY when the build was stamped with
 * `VITE_NULO_PRESTO_REQUIRED=1`. The CI agent greps `dist/chrome` for the literal as a propagation
 * assertion (without it, the required-mode `onPhase` throw would silently disappear and the suite
 * could pass on WASM); the production build guard greps for its absence. Pinned to a no-op runtime
 * side effect in `offscreen/index.ts` so vite cannot tree-shake it.
 */
export const PRESTO_REQUIRED_BUILD_STAMP: "NULO_PRESTO_REQUIRED_BUILD_STAMP" | null = PRESTO_REQUIRED
	? "NULO_PRESTO_REQUIRED_BUILD_STAMP"
	: null
