import { ref } from "vue"
import type { AuthRegistryServiceClient } from "@/wallet/services/auth-registry/client"

/**
 * The authwit-registry flag a popup shows for the active account: fetched on demand, kept live by the
 * service's enabled/disabled events (only those naming that account), reset on hide. The parent owns the
 * client's connection; `isLoading` and `error` are the popup's own — its submit path writes them too.
 */
export function useAuthRegistryStatus(service: AuthRegistryServiceClient, account: () => string | undefined) {
	const isRegistryEnabled = ref<boolean | undefined>(undefined)
	const isLoading = ref(false)
	const error = ref<unknown>()

	const onEnabled = (address: string) => {
		if (account() === address) isRegistryEnabled.value = true
	}
	const onDisabled = (address: string) => {
		if (account() === address) isRegistryEnabled.value = false
	}
	service.onRegistryEnabled.add(onEnabled)
	service.onRegistryDisabled.add(onDisabled)

	async function fetch(): Promise<void> {
		isLoading.value = true
		try {
			isRegistryEnabled.value = await service.getRegistryEnabled(account() as string)
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
