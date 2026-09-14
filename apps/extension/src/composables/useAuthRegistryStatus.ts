import { ref } from "vue"
import type { AuthRegistryServiceClient, AuthwitRegistryScope } from "@/wallet/services/auth-registry/client"

/**
 * The authwit-registry flag a popup shows for the active (chain, account): fetched on demand, kept live by
 * the service's enabled/disabled events (only those naming that exact scope — the same address on another
 * chain is a different registry), reset on hide. The parent owns the client's connection; `isLoading` and
 * `error` are the popup's own — its submit path writes them too.
 */
export function useAuthRegistryStatus(service: AuthRegistryServiceClient, scope: () => { chainId: number; account: string } | undefined) {
	const isRegistryEnabled = ref<boolean | undefined>(undefined)
	const isLoading = ref(false)
	const error = ref<unknown>()

	const matches = (s: AuthwitRegistryScope) => {
		const shown = scope()
		return !!shown && shown.chainId === s.chainId && shown.account === s.account
	}
	const onEnabled = (s: AuthwitRegistryScope) => {
		if (matches(s)) isRegistryEnabled.value = true
	}
	const onDisabled = (s: AuthwitRegistryScope) => {
		if (matches(s)) isRegistryEnabled.value = false
	}
	service.onRegistryEnabled.add(onEnabled)
	service.onRegistryDisabled.add(onDisabled)

	async function fetch(): Promise<void> {
		isLoading.value = true
		try {
			const shown = scope()
			if (!shown) return
			isRegistryEnabled.value = await service.getRegistryEnabled(shown.chainId, shown.account)
		} catch (err) {
			error.value = err
		} finally {
			isLoading.value = false
		}
	}

	function reset(): void {
		isRegistryEnabled.value = undefined
		isLoading.value = false
		error.value = null
	}

	function dispose(): void {
		service.onRegistryEnabled.remove(onEnabled)
		service.onRegistryDisabled.remove(onDisabled)
	}

	return { isRegistryEnabled, isLoading, error, fetch, reset, dispose }
}
