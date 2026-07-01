/**
 * Shared profile-activation bootstrap. Replaces the `initNetworks` + `initAccount`
 * + transaction-service + isLogined-flip chain that previously lived inline in
 * `popup/app.vue`. Both the popup and the onboarding tab call this so the same
 * orchestration runs in both shells.
 *
 * Scope is deliberately narrow: this composable owns the "profile is now active"
 * sequence and nothing else. Routing decisions, reconnect watchers, manager
 * teardown on unmount — all stay in the calling shell. Trying to encompass the
 * entire popup bootstrap here produces a leaky abstraction (Codex v2 critique).
 */

import { managers, initTransactionService } from "@/utils/core"
import { AccountServiceClient, AccountType } from "@/wallet/services/account/client"
import { NetworkServiceClient } from "@/wallet/services/network/client"
import type { ProfileInfo } from "@/wallet/services/profile/client"
import { useAppStore } from "@/stores/app.store"

export function useProfileBootstrap() {
	const appStore = useAppStore()

	/** Replaces the inline `initNetworks` in popup/app.vue. */
	const initNetworks = async () => {
		appStore.networks = []
		appStore.network = undefined

		managers.network?.disconnect()
		managers.network = new NetworkServiceClient()

		appStore.networks = await managers.network.getOrInitNetworks()

		const active = await managers.network.getActiveNetwork()
		if (active) {
			appStore.network = active
		} else {
			appStore.network = appStore.networks.find((n) => n.kind === "testnet") ?? appStore.networks[0]
			if (appStore.network) {
				await managers.network.setActiveNetwork(appStore.network.id)
			}
		}

		if (appStore.network) {
			await managers.network.setActiveNetwork(appStore.network.id)
		}
		appStore.syncNetworkStatus()
	}

	/** Replaces the inline `initAccount` in popup/app.vue. */
	const initAccount = async () => {
		if (!appStore.profile || !appStore.network) return
		managers.account?.disconnect()
		managers.account = new AccountServiceClient()
		await managers.account.ensureDefaultAccount(appStore.profile.id, appStore.network.chainId, AccountType.Nulo_v1, "Account")
		appStore.accounts = await managers.account.getAccounts(appStore.profile.id, appStore.network.chainId, true)
		await appStore.setupActiveAccount()
	}

	/**
	 * Bootstrap a freshly-activated profile. Mirrors the truthy branch of
	 * popup/app.vue's `onActiveProfileChanged(profile)` — minus the routing
	 * decisions and `popupStore.closeAll()` which stay in the calling shell.
	 */
	const bootstrapActiveProfile = async (profile: ProfileInfo): Promise<boolean> => {
		appStore.profile = profile
		// Refresh the in-memory list so the profile switcher + any other
		// consumer sees adds (backup-import activates a restored profile)
		// and updates (rename).
		appStore.profiles = await managers.profile.getProfiles()

		await initNetworks()
		await initAccount()

		initTransactionService(appStore.onTxAdded, appStore.onTxUpdated)
		await appStore.syncTransactions()

		// The lock must win: if the active session was cleared or switched while
		// this bootstrap awaited (e.g. a lock fired right after a password change),
		// do NOT flip isLogined back on. getActiveProfile() runs under the same
		// profile-service runExclusive mutex as lockActiveProfile(), so this re-read
		// observes the completed lock rather than the stale pre-lock session.
		const stillActive = (await managers.profile.getActiveProfile())?.id === profile.id
		if (stillActive) {
			appStore.isLogined = true
		}
		return stillActive
	}

	/**
	 * Initial load of an already-active profile. Mirrors the
	 * `getActiveProfile()` branch of `loadProfile()` in popup/app.vue.
	 * Returns the active profile if one exists (and was bootstrapped),
	 * or null if there's no active profile to hydrate.
	 */
	const hydrateKnownProfile = async (): Promise<ProfileInfo | null> => {
		const activeProfile = await managers.profile.getActiveProfile()
		if (!activeProfile) return null

		appStore.profile = activeProfile
		await initNetworks()
		await initAccount()

		initTransactionService(appStore.onTxAdded, appStore.onTxUpdated)
		await appStore.syncTransactions()

		// Same lock-wins guard as bootstrapActiveProfile: don't flip isLogined if the
		// session was cleared/switched mid-hydrate. isSessionChecked is set either way
		// (the session WAS checked); a stale isLogined=true is the only harmful write.
		if ((await managers.profile.getActiveProfile())?.id === activeProfile.id) {
			appStore.isLogined = true
		}
		appStore.isSessionChecked = true

		return activeProfile
	}

	return { bootstrapActiveProfile, hydrateKnownProfile, initNetworks, initAccount }
}
