import { useToast } from "@/composables/toast"
import { useAppStore } from "@/stores/app.store"
import { activateNetworkGuarded, type NetworkActivationResult } from "@/utils/guarded-network-activation"
import type { Network } from "@/wallet/services/network/client"

export interface UseNetworkActivationOptions {
	/** Persist the durable active-network pointer (the network service's `setActiveNetwork`). */
	persist: (networkId: string) => Promise<unknown>
	/** Read the authoritative pointer back after a failed persist (`getActiveNetwork`). */
	read: () => Promise<Network | null | undefined>
}

/**
 * Switch the active network from a view: the in-flight-send refusal, the guarded activation, and
 * the toasts for the outcomes the user must hear about. Success feedback is the caller's.
 */
export function useNetworkActivation(options: UseNetworkActivationOptions) {
	const appStore = useAppStore()
	const { openToast } = useToast()

	const activate = async (target: Network): Promise<NetworkActivationResult> => {
		// The network is part of the scope a send builds against, and switching it reloads accounts
		// and reselects one — so it moves the signing scope just like an account switch.
		if (appStore.hasInFlightSend) {
			openToast({ kind: "error", label: "Finish or cancel your pending transaction first" })
			return "blocked"
		}
		const result = await activateNetworkGuarded(appStore, options.persist, options.read, target)
		if (result === "blocked") {
			openToast({ kind: "error", label: "Finish or cancel your pending transaction first" })
		} else if (result === "unconfirmed") {
			openToast({ kind: "error", label: "Couldn't confirm the network switch — reopen the popup to verify" })
		}
		// "stale" — the profile changed while this activation waited; the view that asked is gone.
		return result
	}

	return { activate }
}
