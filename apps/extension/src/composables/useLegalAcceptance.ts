import { computed, ref } from "vue"
import type { LegalAcceptanceServiceClient, LegalStatus } from "@/wallet/services/legal/client"

export type LegalViewStatus = LegalStatus | "loading"

/**
 * The Terms-acceptance status a shell shows. The parent owns the client's connection and calls
 * `dispose()`. `loading` is its own state, never folded into `missing`: a sheet that flashes before
 * the first read lands would ask an accepted user to accept again.
 */
export function useLegalAcceptance(service: LegalAcceptanceServiceClient) {
	const status = ref<LegalViewStatus>("loading")
	const error = ref<unknown>()
	const isCurrent = computed(() => status.value === "current")
	/** Orders everything that can set `status`: a read that returns after a newer event or read is dropped. */
	let seq = 0

	const onChanged = (next: LegalStatus) => {
		seq++
		status.value = next
	}
	const onConnected = () => void refresh()
	// Subscribed BEFORE the first read, so a change landing mid-read is never lost to it.
	service.onAcceptanceChanged.add(onChanged)
	service.onConnected.add(onConnected)

	async function refresh(): Promise<void> {
		const mine = ++seq
		try {
			const next = await service.getStatus()
			if (mine === seq) status.value = next
		} catch (err) {
			if (mine !== seq) return
			error.value = err
			status.value = "missing"
		}
	}

	/** Resolves only once the background has stored the record. */
	async function accept(surface: "onboarding" | "popup"): Promise<void> {
		error.value = undefined
		try {
			await service.accept(surface)
			onChanged("current")
		} catch (err) {
			error.value = err
			throw err
		}
	}

	function dispose(): void {
		seq++
		service.onAcceptanceChanged.remove(onChanged)
		service.onConnected.remove(onConnected)
	}

	return { status, isCurrent, error, refresh, accept, dispose }
}
