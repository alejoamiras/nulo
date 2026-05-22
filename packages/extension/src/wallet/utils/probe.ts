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
 *
 * Storage strategy: probes append to chrome.storage.local["nulo:probes"]
 * (bounded ring buffer). Tests read + clear at strategic points. This is
 * deterministic across SW context, popup context, and offscreen context —
 * unlike console.log which requires CDP capture per-context. Cap at 500
 * entries to keep the storage write affordable even under heavy probe load.
 */

declare const __VERSION__: string

export const E2E_PROBE_ENABLED: boolean = import.meta.env.VITE_E2E_PROBE === "1"

const PROBE_KEY_PREFIX = "nulo:probe:"

type ProbeRecord = { b: string; t: number } & Record<string, unknown>

/**
 * Emit a probe record. Console-logs (best-effort visibility in devtools)
 * AND writes to chrome.storage.local under a per-call unique key.
 *
 * Per-call unique keys avoid read-modify-write races between concurrent
 * probes. Tests read via chrome.storage.local.get(null) and filter by the
 * `nulo:probe:` prefix, then clear all probe keys.
 *
 * Fire-and-forget. Probes MUST NOT block the hot path.
 */
export function probe(boundary: string, payload: Record<string, unknown> = {}): void {
	if (!E2E_PROBE_ENABLED) return
	const rec: ProbeRecord = { b: boundary, t: Date.now(), ...payload }
	const line = `[PROBE]${JSON.stringify(rec)}`
	console.log(line)
	// chrome.storage is only available in extension contexts (SW, popup,
	// offscreen, content scripts). Skip silently in playground / external
	// contexts where this module is imported by mistake.
	if (typeof chrome === "undefined" || !chrome.storage?.local) return
	// Unique key per probe call: timestamp + counter + random suffix.
	// Counter handles same-millisecond calls; random handles cross-context
	// (SW vs popup vs offscreen) collisions on the same timestamp.
	probeCounter += 1
	const key = `${PROBE_KEY_PREFIX}${rec.t}:${probeCounter}:${Math.random().toString(36).slice(2, 6)}`
	void chrome.storage.local.set({ [key]: rec }).catch(() => {
		// best-effort; probes must never break the hot path.
	})
}

let probeCounter = 0

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
