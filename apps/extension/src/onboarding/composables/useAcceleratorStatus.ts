/**
 * Detect Presto for the onboarding "Speed" step through the shared page-side client — HTTPS-first,
 * exactly like the offscreen prover, so the page cannot report "active" over a transport proofs
 * will not use.
 *
 *   - "idle"          — before detection runs
 *   - "detecting"     — probe in flight
 *   - "active"        — Presto is reachable and has the prover for this Aztec version
 *   - "no-bb"         — Presto is reachable but must still fetch the prover
 *   - "not-detected"  — every other status (offline, blocked, encrypted connection unavailable,
 *                       version mismatch, error)
 */

import type { PrestoStatus } from "@alejoamiras/presto-core"
import { onMounted, ref } from "vue"
import { getPrestoClient, type PrestoStatusClient } from "@/presto/client"

export type AcceleratorStatus = "idle" | "detecting" | "not-detected" | "no-bb" | "active"

interface AcceleratorInfo {
	version?: string
	aztec_version?: string
	bb_available?: boolean
}

export function useAcceleratorStatus(options?: { autoDetect?: boolean; client?: PrestoStatusClient }) {
	const status = ref<AcceleratorStatus>("idle")
	const info = ref<AcceleratorInfo | null>(null)
	const client = options?.client ?? getPrestoClient()

	async function detect(opts?: { forceRefresh?: boolean }): Promise<void> {
		status.value = "detecting"
		let result: PrestoStatus
		try {
			result = await client.checkStatus({ forceRefresh: opts?.forceRefresh === true })
		} catch {
			info.value = null
			status.value = "not-detected"
			return
		}
		if (!result.available) {
			info.value = null
			status.value = "not-detected"
			return
		}
		info.value = {
			version: result.appVersion,
			aztec_version: result.nativeAztecVersion,
			bb_available: !result.needsDownload,
		}
		status.value = result.needsDownload ? "no-bb" : "active"
	}

	if (options?.autoDetect !== false) {
		onMounted(() => detect())
	}

	return { status, info, detect }
}
