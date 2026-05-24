/// <reference types="vite/client" />
/**
 * E2E diagnostic probes — wallet-side helper (TEMPORARY for network-followups
 * slow-test investigation).
 *
 * Gated on `import.meta.env.VITE_E2E_PROBE === "1"` (compile-time replacement
 * by Vite). Bundle-grep CI step in `_network-e2e.yml` is the actual leak
 * guarantee; the gate here is design intent.
 *
 * Pattern documented in
 * `implementations-plan/e2e-full-network-recovery/lessons/probe-infrastructure.md`.
 * STRIPPED before merge per Phase C.3 of plan.md.
 *
 * Payload rules: method name, timestamps, elapsed ms, boundary marker, short
 * hashed sessionId or traceId. NEVER: addresses, balances, raw RPC args,
 * ciphertext, manifests, verification hashes. Synchronous, side-effect-free.
 */

export const E2E_PROBE_ENABLED: boolean = import.meta.env.VITE_E2E_PROBE === "1"

const PROBE_KEY_PREFIX = "nulo:probe:"
let probeCounter = 0

type ProbeRecord = { b: string; t: number } & Record<string, unknown>

/**
 * Emit a probe record. Console-logs (devtools visibility) AND writes to
 * chrome.storage.local under a per-call unique key (deterministic test-side
 * capture via `dumpProbes` helper). Both writes fire-and-forget.
 */
export function probe(boundary: string, payload: Record<string, unknown> = {}): void {
	if (!E2E_PROBE_ENABLED) return
	const rec: ProbeRecord = { b: boundary, t: Date.now(), ...payload }
	console.log(`[PROBE]${JSON.stringify(rec)}`)
	if (typeof chrome === "undefined" || !chrome.storage?.local) return
	probeCounter += 1
	const key = `${PROBE_KEY_PREFIX}${rec.t}:${probeCounter}:${Math.random().toString(36).slice(2, 6)}`
	void chrome.storage.local.set({ [key]: rec }).catch(() => {
		// best-effort; probes must never break the hot path.
	})
}

export function hashSid(sessionId: string | undefined | null): string {
	if (!sessionId) return "none"
	return sessionId.slice(0, 6)
}
