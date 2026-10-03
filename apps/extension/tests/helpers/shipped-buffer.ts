/**
 * The `Buffer` the extension ships. The build rewrites every bare `Buffer` identifier into an
 * import of this module (`vite.config.ts`, `nodePolyfills({ globals: { Buffer: true } })`), while
 * vitest runs without that plugin and so sees Bun's native `Buffer`. Tests that pin a byte
 * contract run once per binding: `withBuffer(binding)` installs one for the current test.
 */
import { vi } from "vitest"
// @ts-expect-error the shim ships no declarations; it is the `buffer` package's API.
import { Buffer as Shim } from "vite-plugin-node-polyfills/shims/buffer"

export const ShippedBuffer = Shim as typeof Buffer
export const NativeBuffer = globalThis.Buffer

export const BUFFER_BINDINGS = [
	["native", NativeBuffer],
	["shipped", ShippedBuffer],
] as const

/** Installs `binding` as the global `Buffer`; the caller's `afterEach(vi.unstubAllGlobals)` restores it. */
export function withBuffer(binding: typeof Buffer): void {
	if (binding !== NativeBuffer) vi.stubGlobal("Buffer", binding)
}
