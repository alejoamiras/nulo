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

/**
 * B-27: single-flight the activation core per profile id, module-level so it
 * coordinates across composable instances AND across the two entry points
 * (`bootstrapActiveProfile` from the `onActiveProfileChanged` event, and
 * `hydrateKnownProfile` from import-timeout recovery). Both `initNetworks` and
 * `initAccount` disconnect + REPLACE the shared `managers.network`/`.account`
 * clients; two concurrent runs for the same profile stomped each other — the
 * recovery bootstrap replaced a client the original was mid-use of, so the
 * original threw and mis-routed to "needs unlock". A same-profile caller now
 * joins the in-flight run instead of starting its own.
 */
const inFlightBootstraps = new Map<string, Promise<void>>()

/**
 * B-27 (generation fence): per-id single-flight covers same-profile recovery,
 * but a DIFFERENT profile activating mid-bootstrap (a rapid switch) would still
 * run its own init and stomp the shared clients while the older run continues.
 * Every new bootstrap bumps this counter; a run whose captured generation is no
 * longer current stops before its next shared-state mutation, so the LATEST
 * activation wins and a superseded one can't disconnect/replace the winner's
 * clients or run `initAccount` with cross-profile network state.
 */
let bootstrapGeneration = 0

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
			// No active pointer (e.g. a freshly IMPORTED profile — its active-network selection isn't
			// restored yet; that's item 1b). Fall back to the profile's PRIMARY network from the
			// service — single-sourced from the `isPrimaryActive` seed (Alpha in prod, Testnet under
			// the e2e flag), so it can't diverge from a fresh profile's default or break e2e the way a
			// hardcoded `kind === "testnet"` did (#305 flipped the default to Alpha but left this).
			const primary = await managers.network.getPrimaryNetwork()
			appStore.network = primary ?? appStore.networks[0]
		}

		// Persist the resolved active network (covers both the restored-active and fallback branches).
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
	 * The shared activation core (network + account + tx-service + sync). B-27:
	 * single-flighted per profile id, so a concurrent caller for the same profile
	 * (recovery vs. the original event bootstrap) joins the in-flight run rather
	 * than kicking off a second one that replaces the shared managers mid-use.
	 */
	const runBootstrapCore = (profileId: string): Promise<void> => {
		const existing = inFlightBootstraps.get(profileId)
		if (existing) return existing
		// A new bootstrap supersedes any older in-flight one (of ANY profile).
		const myGeneration = ++bootstrapGeneration
		const superseded = () => bootstrapGeneration !== myGeneration
		const run = (async () => {
			await initNetworks()
			// A newer activation started mid-init — stop before touching more shared
			// state so we can't disconnect/replace the winner's clients or run
			// initAccount with this (now-stale) profile's network.
			if (superseded()) return
			await initAccount()
			if (superseded()) return
			initTransactionService(appStore.onTxAdded, appStore.onTxUpdated)
			await appStore.syncTransactions()
		})().finally(() => {
			// Identity-guard: only clear the slot if it still holds THIS run.
			if (inFlightBootstraps.get(profileId) === run) inFlightBootstraps.delete(profileId)
		})
		inFlightBootstraps.set(profileId, run)
		return run
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

		await runBootstrapCore(profile.id)

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
		// B-27: join the in-flight event-driven bootstrap for this profile instead
		// of racing a second network/account init that replaces its clients.
		await runBootstrapCore(activeProfile.id)

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
