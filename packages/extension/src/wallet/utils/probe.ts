/**
 * E2E diagnostic probes — wallet-side helper.
 *
 * Gated on `import.meta.env.VITE_E2E_PROBE === "1"` (compile-time
 * replacement by Vite). When unset, the branch is dead code; ESbuild's DCE
 * drops the call-site entirely so probe strings don't ship to production.
 *
 * Safety guarantee is enforced in CI via a bundle-grep step on `dist/chrome`,
 * not by this gate alone. See `implementations-plan/e2e-full-network-recovery/plan.md`
 * sections 4.2 + 13.1.
 *
 * Payload rules: method name, short hashed sessionId, timestamps, elapsed ms,
 * boundary marker. NEVER: addresses, balances, raw RPC args, ciphertext,
 * manifests, verification hashes. Probes are synchronous and side-effect-free.
 */

declare const __VERSION__: string

export const E2E_PROBE_ENABLED: boolean = import.meta.env.VITE_E2E_PROBE === "1"

/**
 * Emit a probe line. Synchronous. Side-effect-free aside from console output.
 *
 * Call as:
 *   if (E2E_PROBE_ENABLED) probe("BCH-RECV", { sessionIdH: hashSid(s), method })
 *
 * The `if` guard at the call site lets the compiler dead-code-eliminate
 * payload-construction (string interpolation, object literal) when probes
 * are off. Without it, the payload is built every call even though the
 * `probe()` body early-returns.
 */
export function probe(boundary: string, payload: Record<string, unknown> = {}): void {
	// Defensive: if a caller forgot the guard, still no-op when disabled.
	if (!E2E_PROBE_ENABLED) return
	const line = JSON.stringify({ b: boundary, t: Date.now(), ...payload })
	// Use plain console.log: probes run inside SW + popup + offscreen contexts;
	// the SW's logger queues, but probe output should arrive even if the queue
	// is stuck. SW console messages route to the SW devtools panel; popup ones
	// to the popup devtools panel; the test harness captures both via CDP.
	console.log(`[PROBE]${line}`)
}

/**
 * Hash a sessionId for probe logs. Don't leak full UUIDs in case probes ever
 * accidentally land in a prod bundle (the bundle-grep CI step is the actual
 * guard; this is belt + suspenders).
 */
export function hashSid(sessionId: string | undefined | null): string {
	if (!sessionId) return "none"
	// First 6 chars is enough to distinguish sessions in a single test run
	// without exposing the full ECDH-derived identifier.
	return sessionId.slice(0, 6)
}
