/**
 * Presto detection that never raises the browser's local-network prompt unasked. A probe runs on
 * its own only once an earlier, user-asked probe reached Presto from this browser (the
 * `prestoReached` config flag); until then the page rests in `idle` and probes from `check()`.
 *
 * The parent owns the config client's connection, calls `start()` once (it never throws), and
 * calls `dispose()`.
 */
import { computed, ref } from "vue"
import { type PrestoStatusClient, getPrestoClient } from "@/presto/client"
import { type PrestoUiState, hasReachedPresto } from "@/utils/presto-ui-state"
import type { ConfigServiceClient } from "@/wallet/services/config/client"
import { usePrestoStatus } from "./usePrestoStatus"

export type PrestoCheckConfig = Pick<ConfigServiceClient, "getValue" | "setValue">

export function usePrestoCheck(config: PrestoCheckConfig, options?: { client?: PrestoStatusClient }) {
	const presto = usePrestoStatus({ client: options?.client ?? getPrestoClient(), autoDetect: false })
	/** False until `start()` has read the flag, so a page never flashes the resting copy first. */
	const started = ref(false)

	const state = computed<PrestoUiState>(() =>
		started.value || presto.state.value.kind !== "idle" ? presto.state.value : { kind: "detecting" },
	)

	async function start(): Promise<void> {
		let reached = false
		try {
			reached = await config.getValue("prestoReached")
		} catch {
			// An unreadable flag is treated as unset: resting costs a click, a wrong probe costs a prompt.
		}
		started.value = true
		if (reached) await presto.detect()
	}

	/** The user asked: probe, and remember it if Presto answered. */
	async function check(): Promise<void> {
		started.value = true
		await presto.detect({ forceRefresh: true })
		if (!hasReachedPresto(presto.state.value)) return
		try {
			await config.setValue("prestoReached", true)
		} catch {
			// Not remembered: the next visit rests and asks again.
		}
	}

	return { state, start, check, dispose: presto.dispose }
}
