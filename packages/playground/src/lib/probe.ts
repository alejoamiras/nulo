/// <reference types="vite/client" />
/**
 * E2E diagnostic probes — playground side.
 *
 * Same contract as the wallet-side helper at
 * `packages/extension/src/wallet/utils/probe.ts`. Gated on
 * `import.meta.env.VITE_E2E_PROBE === "1"` (Vite compile-time replacement).
 *
 * Payload rules: method name, timestamps, status. NEVER: addresses, balances,
 * raw RPC args, manifests.
 */

export const E2E_PROBE_ENABLED: boolean = import.meta.env.VITE_E2E_PROBE === "1"

export function probe(boundary: string, payload: Record<string, unknown> = {}): void {
	if (!E2E_PROBE_ENABLED) return
	const line = JSON.stringify({ b: boundary, t: Date.now(), ...payload })
	console.log(`[PROBE]${line}`)
}
