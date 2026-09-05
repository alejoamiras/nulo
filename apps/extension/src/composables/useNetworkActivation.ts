import { TOAST_DURATION, useToast } from "@/composables/toast"
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
 * Switch the active network from a view with the guard every caller must share: a refusal while a
 * send is in flight, and the admit-before-persist ordering of `activateNetworkGuarded`. Owns the
 * feedback for the outcomes the user must hear about; a caller decides what success looks like.
 * Receives the service callbacks from its parent and holds no subscription, so there is nothing to
 * dispose.
 */
export function useNetworkActivation(options: UseNetworkActivationOptions) {
	const appStore = useAppStore()
	const { openToast } = useToast()

	const activate = async (target: Network): Promise<NetworkActivationResult> => {
		// The network is part of the scope a send builds against, and switching it reloads accounts
		// and reselects one — so it moves the signing scope just like an account switch.
		if (appStore.hasInFlightSend) {
			openToast({ label: "Finish or cancel your pending transaction first", icon: "info" }, 3_000)
			return "blocked"
		}
		const result = await activateNetworkGuarded(appStore, options.persist, options.read, target)
		if (result === "blocked") {
			openToast({ label: "Finish or cancel your pending transaction first", icon: "info" }, 3_000)
		} else if (result === "unconfirmed") {
			openToast(
				{ label: "Couldn't confirm the network switch — reopen the popup to verify", icon: "warning", color: "red" },
				TOAST_DURATION.LONG,
			)
		}
		// "stale" — the profile changed while this activation waited; the view that asked is gone.
		return result
	}

	return { activate }
}
