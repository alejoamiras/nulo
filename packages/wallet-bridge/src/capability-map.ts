/**
 * Capability lookup for wallet-sdk method names.
 *
 * Thin facade over the `method-descriptors` registry (the single source of
 * truth). `getRequiredCapability` / `isCapabilityExempt` read the registry-derived
 * `METHOD_CAPABILITY_MAP` / `EXEMPT_METHODS`. Used by `enforceCapability()` in the
 * dispatcher to check whether a dApp has been granted the capability a method needs.
 *
 * The per-method facts (which methods are exempt, each method's required
 * capability, the F-003/F1 rationale) live as `MethodDescriptor` fields in
 * `./method-descriptors`. To add/reclassify a method, edit the registry row.
 */

import { METHOD_CAPABILITY_MAP, EXEMPT_METHODS, type CapabilityType } from "./method-descriptors"

// Re-exported to preserve the public `@nulo/wallet-bridge` path (index.ts:15).
export type { CapabilityType }

/**
 * Get the capability type required for a wallet-sdk method.
 * Returns `null` for exempt or unknown methods.
 */
export function getRequiredCapability(method: string): CapabilityType | null {
	return METHOD_CAPABILITY_MAP[method] ?? null
}

/**
 * Check if a method is exempt from capability enforcement.
 */
export function isCapabilityExempt(method: string): boolean {
	return EXEMPT_METHODS.has(method)
}
