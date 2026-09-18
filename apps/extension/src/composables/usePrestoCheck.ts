/**
 * Presto detection that does not probe unasked until the browser is known to allow it. A probe
 * can raise the browser's local-network prompt, so one runs on its own only once an earlier,
 * user-asked probe reached Presto from this browser (the `prestoReached` config flag); until then
 * the page rests in `idle` and probes from `check()`.
 *
 * The flag records a past answer, not the live permission: a browser that grants loopback access
 * for one visit only can prompt again on a later unasked probe.
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

	/** The only probe a user's click stands behind, so the only one allowed to set the flag. */
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
