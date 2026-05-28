/**
 * Centralized accelerator-server connection config.
 *
 * Two consumers:
 *   1. `useAcceleratorStatus` (onboarding probe) — reads `ACCELERATOR_HEALTH_URL`.
 *   2. `offscreen/index.ts` — reads `ACCELERATOR_REQUIRED` / host / port and
 *      passes them into `ProductionPxeFactory`.
 *
 * `ACCELERATOR_REQUIRED` is the CI-only switch. It is OFF for every
 * production build. Only the network-e2e workflow sets
 * `VITE_NULO_ACCELERATOR_REQUIRED=1` at build time. When the flag is OFF
 * the wallet behaves exactly as before: `AcceleratorProver` constructed
 * with no `onPhase` callback and no eager preflight, so the SDK's silent
 * WASM fallback path is preserved for end users without Aztec Accelerator
 * (the desktop app) installed.
 *
 * Do not import this module from `@nulo/aztec-runtime`. That package is
 * deliberately decoupled from the extension's `@/` alias; thread these
 * values in as primitives via `PxeOffscreenDeps.factory` instead.
 */

export const ACCELERATOR_HOST = "127.0.0.1"
export const ACCELERATOR_PORT = 59833
export const ACCELERATOR_HEALTH_URL = `http://${ACCELERATOR_HOST}:${ACCELERATOR_PORT}/health` as const

export const ACCELERATOR_REQUIRED = (import.meta.env.VITE_NULO_ACCELERATOR_REQUIRED ?? "") === "1"

/**
 * Build-time marker. Present in the shipped bundle ONLY when this build
 * was stamped with `VITE_NULO_ACCELERATOR_REQUIRED=1`. The CI agent
 * (`packages/extension/scripts/e2e/agent.sh`) greps `dist/chrome` for
 * the literal string `NULO_ACCELERATOR_REQUIRED_BUILD_STAMP` as a
 * propagation assertion — if the env var didn't reach the wallet build,
 * Layer 2 enforcement (chain-runtime.ts onPhase throw) would silently
 * disappear and the suite could pass on WASM even when the server is up
 * but unhealthy mid-test. (Codex post-impl audit finding #3.)
 *
 * Pinned to a no-op runtime side effect in `offscreen/index.ts` so vite
 * cannot tree-shake the import + string.
 */
export const ACCELERATOR_REQUIRED_BUILD_STAMP: "NULO_ACCELERATOR_REQUIRED_BUILD_STAMP" | null = ACCELERATOR_REQUIRED
	? "NULO_ACCELERATOR_REQUIRED_BUILD_STAMP"
	: null
