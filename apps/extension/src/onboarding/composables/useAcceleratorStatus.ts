/**
 * Detect the Aztec Accelerator native app via its localhost /health endpoint.
 *
 * Status semantics:
 *   - "idle"          — initial state before detection runs
 *   - "detecting"     — fetch in flight
 *   - "active"        — accelerator responded AND bb_available === true
 *   - "no-bb"         — accelerator responded AND bb_available === false
 *                       (user installed the app but proving binary not yet
 *                        downloaded; user must open menu-bar app & wait)
 *   - "not-detected"  — fetch failed (timeout, refused, non-200, malformed)
 *
 * CORS: the accelerator emits Access-Control-Allow-Origin: * so an extension
 * page can fetch /health freely. We also added http://127.0.0.1/* to
 * host_permissions in the manifest for belt-and-suspenders authorization.
 */

import { onMounted, ref } from "vue"
import { ACCELERATOR_HEALTH_URL } from "@/accelerator/config"

export type AcceleratorStatus = "idle" | "detecting" | "not-detected" | "no-bb" | "active"

interface AcceleratorInfo {
	version?: string
	aztec_version?: string
	bb_available?: boolean
}

const TIMEOUT_MS = 2000

export function useAcceleratorStatus(options?: { autoDetect?: boolean }) {
	const status = ref<AcceleratorStatus>("idle")
	const info = ref<AcceleratorInfo | null>(null)

	async function detect(): Promise<void> {
		status.value = "detecting"
		try {
			const r = await fetch(ACCELERATOR_HEALTH_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) })
			if (!r.ok) throw new Error(`HTTP ${r.status}`)
			const data = (await r.json()) as {
				status?: string
				version?: string
				aztec_version?: string
				bb_available?: boolean
			}
			info.value = {
				version: data.version,
				aztec_version: data.aztec_version,
				bb_available: data.bb_available,
			}
			status.value = data.bb_available ? "active" : "no-bb"
		} catch {
			info.value = null
			status.value = "not-detected"
		}
	}

	if (options?.autoDetect !== false) {
		onMounted(detect)
	}

	return { status, info, detect }
}
