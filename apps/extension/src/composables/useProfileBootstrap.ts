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
import { AccountServiceClient, AccountType, DEFAULT_ACCOUNT_NAME } from "@/wallet/services/account/client"
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
 * original threw and mis-routed to "needs unlock". A same-profile caller whose
 * run is still the current generation joins it instead of starting its own.
 */
const inFlightBootstraps = new Map<string, { gen: number; promise: Promise<void> }>()

/**
 * B-27 (generation fence): per-id single-flight covers same-profile recovery,
 * but a DIFFERENT profile activating mid-bootstrap (a rapid switch) would still
 * run its own init and stomp the shared clients while the older run continues.
 * Every new bootstrap bumps this counter, and `initNetworks`/`initAccount` fence
 * EACH shared-state mutation on it — a superseded run stops before disconnecting/
 * replacing the winner's dynamically-referenced `managers.*` client or writing
 * stale network/account state. Joining also requires the in-flight run to still
 * be the current generation, so a re-activation of a superseded profile starts
 * fresh rather than adopting an aborted run.
 */
let bootstrapGeneration = 0

export function useProfileBootstrap() {
	const appStore = useAppStore()

	/** Replaces the inline `initNetworks` in popup/app.vue. `isCurrent` (B-27) is
	 *  checked after every await and before every shared-state mutation so a
	 *  superseded bootstrap stops instead of replacing the winner's `managers.network`
	 *  (read dynamically here) or writing stale networks. Standalone callers omit it. */
	const initNetworks = async (isCurrent: () => boolean = () => true) => {
		if (!isCurrent()) return
		appStore.networks = []
		appStore.network = undefined

		managers.network?.disconnect()
		const network = new NetworkServiceClient()
		managers.network = network

		const nets = await network.getOrInitNetworks()
		if (!isCurrent()) return // a newer activation took over — don't write stale networks
		appStore.networks = nets

		// The helper fences internally, but the await boundary itself yields a
		// microtask — a new activation can bump the generation between the
		// helper's last check and this resumption, so re-fence before writing.
		const resolved = await resolveActiveNetwork(network, isCurrent)
		if (resolved === "superseded" || !isCurrent()) return
		appStore.network = resolved

		// Persist the resolved active network (covers both the restored-active and fallback branches).
		if (appStore.network) {
			await network.setActiveNetwork(appStore.network.id)
			if (!isCurrent()) return
		}
		appStore.syncNetworkStatus()
	}

	/** The stored active network if present, else the profile's PRIMARY network (else the
	 *  first known one). "superseded" means a newer activation took over mid-await — the
	 *  caller must stop without writing; it is distinct from undefined (no networks). */
	const resolveActiveNetwork = async (network: NetworkServiceClient, isCurrent: () => boolean) => {
		const active = await network.getActiveNetwork()
		if (!isCurrent()) return "superseded" as const
		if (active) return active
		// No active pointer (e.g. a freshly IMPORTED profile — its active-network selection isn't
		// restored yet; that's item 1b). Fall back to the profile's PRIMARY network from the
		// service — single-sourced from the `isPrimaryActive` seed (Alpha in prod, Testnet under
		// the e2e flag), so it can't diverge from a fresh profile's default or break e2e the way a
		// hardcoded `kind === "testnet"` did (#305 flipped the default to Alpha but left this).
		const primary = await network.getPrimaryNetwork()
		if (!isCurrent()) return "superseded" as const
		return primary ?? appStore.networks[0]
	}

	/** Replaces the inline `initAccount` in popup/app.vue. Fenced per B-27 (see initNetworks). */
	const initAccount = async (isCurrent: () => boolean = () => true) => {
		if (!isCurrent() || !appStore.profile || !appStore.network) return
		const profileId = appStore.profile.id
		const chainId = appStore.network.chainId
		managers.account?.disconnect()
		const account = new AccountServiceClient()
		managers.account = account
		await account.ensureDefaultAccount(profileId, chainId, AccountType.Nulo_v1, DEFAULT_ACCOUNT_NAME)
		if (!isCurrent()) return
		const accounts = await account.getAccounts(profileId, chainId, true)
		if (!isCurrent()) return
		appStore.accounts = accounts
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
		// Join only a STILL-CURRENT same-profile run (same-profile recovery). A run
		// that a newer activation already superseded is aborting, so re-activating
		// this profile must start fresh rather than adopt it.
		if (existing && existing.gen === bootstrapGeneration) return existing.promise
		// A new bootstrap supersedes any older in-flight one (of ANY profile).
		const myGeneration = ++bootstrapGeneration
		const isCurrent = () => bootstrapGeneration === myGeneration
		const promise = (async () => {
			await initNetworks(isCurrent)
			if (!isCurrent()) return
			await initAccount(isCurrent)
			if (!isCurrent()) return
			initTransactionService(appStore.onTxAdded, appStore.onTxUpdated)
			await appStore.syncTransactions()
		})().finally(() => {
			// Identity-guard: only clear the slot if it still holds THIS run.
			if (inFlightBootstraps.get(profileId)?.promise === promise) inFlightBootstraps.delete(profileId)
		})
		inFlightBootstraps.set(profileId, { gen: myGeneration, promise })
		return promise
	}

	/**
	 * Bootstrap a freshly-activated profile. Mirrors the truthy branch of
	 * popup/app.vue's `onActiveProfileChanged(profile)` — minus the routing
	 * decisions and `popupStore.closeAll()` which stay in the calling shell.
	 */
	const bootstrapActiveProfile = async (profile: ProfileInfo): Promise<boolean> => {
		appStore.profile = profile
		// B-27 (supersede at entry): kick off / join the core SYNCHRONOUSLY, before
		// the getProfiles await, so this activation's generation is bumped up front
		// — an older bootstrap is fenced immediately, not only once control reaches
		// runBootstrapCore after the await. (No await between the profile assignment
		// and this call, so no other activation can interleave in that window.)
		const core = runBootstrapCore(profile.id)

		// Refresh the in-memory list so the profile switcher + any other
		// consumer sees adds (backup-import activates a restored profile)
		// and updates (rename).
		appStore.profiles = await managers.profile.getProfiles()

		await core

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
