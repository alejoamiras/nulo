/**
 * Network-switch orchestration, extracted from the popup shell's watcher so
 * the identity fence is unit-testable (app.vue has no test harness — an
 * unpinned inline fence is silently revertible). The factory owns ALL the
 * glue: the per-component fence, entry invalidation, scope capture, and the
 * compound run guard.
 *
 * The hazard this closes: the watcher's RPCs enjoy pre-registration
 * immunity (a request parked before the transport registers it survives
 * `disconnect()`), so a superseded run used to land a cross-chain account
 * list after the user had already switched again. Every await boundary now
 * re-checks BOTH the generation (a newer run started) AND the live scope (a
 * profile/network drift the watcher hasn't re-fired for yet), and results
 * are committed only after the check — never in the same statement as the
 * await.
 */
import { createRunFence } from "@/composables/runFence"
import { AccountType } from "@/wallet/services/account/client"

export interface NetworkSwitchScope {
	profileId: string
	chainId: number
}

export interface NetworkSwitchAccountClient {
	getAccounts(profileId: string, chainId: number, includeHidden: boolean): Promise<unknown[]>
	ensureDefaultAccount(profileId: string, chainId: number, type: AccountType, name: string): Promise<unknown>
}

export interface NetworkSwitchDeps {
	/** Captured ONCE per run; undefined = not ready (no network/profile yet). */
	getScope: () => NetworkSwitchScope | undefined
	/** Live compare — a drift the watcher hasn't re-fired for must stop the run. */
	liveScopeMatches: (scope: NetworkSwitchScope) => boolean
	syncNetworkStatus: () => void
	/** Disconnect the old client, install + return the new one. The run holds
	 *  the RETURNED reference locally — the shared slot is mutable. */
	replaceAccountClient: () => NetworkSwitchAccountClient
	setAccounts: (accounts: unknown[]) => void
	setupActiveAccount: () => Promise<void>
	syncTransactions: () => Promise<void>
}

export function createNetworkSwitchHandler(deps: NetworkSwitchDeps): () => Promise<void> {
	const fence = createRunFence()
	return async () => {
		// begin() BEFORE the not-ready return: bootstrap's transitional
		// `network = undefined` write must supersede an in-flight run even
		// though this invocation itself does nothing.
		const isCurrent = fence.begin()
		const scope = deps.getScope()
		if (!scope) return
		const guard = () => isCurrent() && deps.liveScopeMatches(scope)

		deps.syncNetworkStatus()

		// Re-fetch accounts for the new chain, and auto-create a default if
		// the chain has NO accounts yet. Auto-create otherwise lives ONLY in
		// `initAccount()` (duplicate-account race during initial profile
		// load); the empty-list guard preserves that property — when
		// `initAccount()` already created the default for this chain,
		// `getAccounts()` returns non-empty and the second
		// `ensureDefaultAccount` is skipped. Without the auto-create, a
		// freshly-switched chain strands the popup with `account = undefined`
		// and every reader of `appStore.account.address` silently fails.
		const client = deps.replaceAccountClient()
		let accounts = await client.getAccounts(scope.profileId, scope.chainId, true)
		if (!guard()) return
		deps.setAccounts(accounts)
		if (accounts.length === 0) {
			await client.ensureDefaultAccount(scope.profileId, scope.chainId, AccountType.Nulo_v1, "Account")
			if (!guard()) return
			accounts = await client.getAccounts(scope.profileId, scope.chainId, true)
			if (!guard()) return
			deps.setAccounts(accounts)
		}
		await deps.setupActiveAccount()
		// Belt before the tail — syncTransactions is internally scope-fenced
		// (compare-and-commit in the store), but a superseded run should not
		// even start it.
		if (!guard()) return
		await deps.syncTransactions()
	}
}
