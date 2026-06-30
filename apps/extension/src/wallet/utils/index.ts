/**
 * Barrel for `@/wallet/utils`.
 *
 * Pure utilities live in `@nulo/wallet-core/utils`; this barrel
 * re-exports them so extension call sites can import everything from
 * one place. Aztec-dependent helpers that are safe to load at module
 * init are also re-exported. Chrome-bound helpers (e.g. `offscreen.ts`,
 * which resolves `chrome.runtime.getURL` at module-load time) stay
 * behind their submodule paths — import them via
 * `@/wallet/utils/offscreen` directly. PXE Zod schemas live in
 * `@nulo/aztec-runtime/pxe`.
 */
export * from "@nulo/wallet-core/utils"

export * from "./auth-registry"
export * from "./caip"
export * from "./fee-juice"
