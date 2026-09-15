/**
 * Presto detection for a page. The client is injected (default: the page's shared
 * `getPrestoClient()`) and the parent calls `dispose()`. `PrestoClient` has no abort API, so
 * `dispose()` (and a newer `detect()`) can only drop a late result, never cancel the probe.
 */
import type { PrestoStatus } from "@alejoamiras/presto-core"
import { onMounted, ref } from "vue"
import { getPrestoClient, type PrestoStatusClient } from "@/presto/client"
import { type PrestoUiState, uiStateFromStatus } from "@/utils/presto-ui-state"

export function usePrestoStatus(options?: { client?: PrestoStatusClient; autoDetect?: boolean }) {
	const state = ref<PrestoUiState>({ kind: "idle" })
	/** The raw status for `<presto-banner>`'s `status` property; null until a probe answered. */
	const bannerStatus = ref<PrestoStatus | null>(null)
	const client = options?.client ?? getPrestoClient()
	let generation = 0
	let disposed = false

	async function detect(opts?: { forceRefresh?: boolean }): Promise<void> {
		const mine = ++generation
		state.value = { kind: "detecting" }
		let status: PrestoStatus
		try {
			status = await client.checkStatus({ forceRefresh: opts?.forceRefresh === true })
		} catch {
			// The client reports every transport outcome as a status; a throw is a bug
			// in the probe itself, which the page shows as Presto's error state.
			status = { available: false, reason: "error", protocol: "https" }
		}
		if (disposed || mine !== generation) return
		bannerStatus.value = status
		state.value = uiStateFromStatus(status)
	}

	function dispose(): void {
		disposed = true
	}

	if (options?.autoDetect !== false) {
		onMounted(() => detect())
	}

	return { state, bannerStatus, detect, dispose }
}
