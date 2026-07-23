/** Vendor */
import { defineStore } from "pinia"

import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"
import { NodeStatus } from "@/wallet/services/network/client"
import type { ProfileInfo } from "@/wallet/services/profile/client"
import type { Tx } from "@/wallet/services/transaction/spec"
import type { BlockExplorerType } from "@/wallet/constants/explorers"
import { requireAccount, requireNetwork } from "@/utils/core"
import { getPrimaryCall } from "@/utils/tx-enrichment"
import { storageLocalGet, storageLocalSet } from "@/utils/storage"

import { useSyncedRef } from "@/composables/syncedRef.js"

type AwaitingTx = {
	/** Unique per submission so the rejection path removes exactly the placeholder
	 *  it created — never a by-destination/contract search that could hit a
	 *  same-recipient sibling or another account's row. */
	id: string
	account: string
	contract: string
	destination: string
}

export const useAppStore = defineStore("app", () => {
	const _isHomeScreenOpened = ref(false)

	const isLoading = ref(false)

	const displayOption = ref("total_account_value")

	// Onboarding state. True once the user has walked through the full
	// onboarding tab flow (Create/Import → Aztec primer → Accelerator → Done).
	// Persisted to chrome.storage.local so popup and onboarding tab agree on
	// whether to redirect / resume. Cleared on profile reset.
	const onboardingCompleted = ref<boolean>(false)
	const ONBOARDING_COMPLETED_KEY = "nulo:onboarding:completed"
	const loadOnboardingCompleted = async () => {
		const result = await storageLocalGet(ONBOARDING_COMPLETED_KEY)
		onboardingCompleted.value = result[ONBOARDING_COMPLETED_KEY] === true
	}
	const setOnboardingCompleted = async (value: boolean) => {
		onboardingCompleted.value = value
		await storageLocalSet({ [ONBOARDING_COMPLETED_KEY]: value })
	}

	const profile = ref<ProfileInfo>()
	const profiles = ref<ProfileInfo[]>([])

	const isRegistered = computed(() => !!profile.value)

	const account = ref<Account>()
	const accounts = ref<Account[]>([])
	const isLogined = ref<boolean>(false)
	const isSessionChecked = ref<boolean>(false)
	const pageAwaitingAuth = ref<string>("")

	const setupActiveAccount = async () => {
		const activeAccountResult = await storageLocalGet("nulo:ui:activeAccount")
		if ("nulo:ui:activeAccount" in activeAccountResult) {
			const activeAccountAddress = activeAccountResult["nulo:ui:activeAccount"]
			const activeAccount = accounts.value.find((a) => a.address === activeAccountAddress)
			if (activeAccount) {
				account.value = activeAccount
				return
			}
		}

		account.value = accounts.value[0]
		await storageLocalSet({
			"nulo:ui:activeAccount": account.value?.address,
		})
	}
	const selectAccount = async (acc: Account) => {
		account.value = acc
		await storageLocalSet({
			"nulo:ui:activeAccount": acc.address,
		})
	}
	const changeAccountVisibility = async (acc: Account, value: boolean) => {
		if (!profile.value || !network.value) return
		const accIdx = accounts.value.findIndex((a) => acc.address === a.address)

		await requireAccount().changeAccountVisibility(profile.value.id, network.value.chainId, acc.address, value)
		accounts.value[accIdx] = { ...acc, visible: value }

		if (!value) {
			if (accounts.value.length) {
				account.value = accounts.value.filter((a) => a.visible).sort((a, b) => a.index - b.index)[0]
				await storageLocalSet({
					"nulo:ui:activeAccount": account.value?.address,
				})
			}
		}
	}
	const updateAccount = async (address: string, name: string) => {
		if (!profile.value || !network.value) return
		const accIdx = accounts.value.findIndex((a) => address === a.address)

		await requireAccount().changeAccountName(profile.value.id, network.value.chainId, address, name)

		const updatedAccount = { ...accounts.value[accIdx], name: name }
		accounts.value[accIdx] = updatedAccount
		if (address === account.value?.address) {
			account.value = updatedAccount
		}
	}

	const network = ref<Network>()
	const networkStatus = ref<string>()
	const networks = ref<Network[]>([])

	const syncNetworkStatus = async () => {
		if (!network.value) return
		networkStatus.value = "sync"
		const oldNetworkId = network.value?.id
		const status = await requireNetwork().getNodeStatus(network.value.id)

		if (oldNetworkId !== network.value?.id) return

		networkStatus.value = NodeStatus[status]
	}
	const renameNetwork = async (id: string, name: string) => {
		await requireNetwork().renameNetwork(id, name)
		networks.value = await requireNetwork().getNetworks()
	}
	const removeNetwork = async (target: Network) => {
		await requireNetwork().deleteNetwork(target.id)
		networks.value = networks.value.filter((n) => n.id !== target.id)
	}

	const awaitingTransactions = ref<AwaitingTx[]>([])
	const transactions = ref<Tx[]>([])

	// Account-switch isolation (Layer-A containment). A monotonic token bumped
	// synchronously on every active-account change. Awaited feed fetches capture
	// it and discard their result if it moved while in flight (A→B, A→B→A). See
	// implementations-plan/account-switch-isolation.
	const activityGeneration = ref(0)

	// True only when the record's own scope (account + chain) equals the live
	// active scope. Chain is tolerated when the live network is unknown — Phase 1
	// filters on the fields it has and never falls back to "active-now".
	const isActiveTxScope = (tx: Pick<Tx, "account" | "chainId">) => {
		const activeAddress = account.value?.address
		if (!activeAddress || tx.account !== activeAddress) return false
		const activeChainId = network.value?.chainId
		return activeChainId === undefined || tx.chainId === activeChainId
	}

	// Clears ONLY what the active feed renders for the outgoing account — never
	// the durable tx store nor another account's in-flight work. `transactions`
	// is refetched by `syncTransactions`; awaiting placeholders are kept only if
	// they belong to the now-active account (drop-only containment — cross-account
	// retention is Layer B / Phase 2).
	const resetActiveFeedState = () => {
		transactions.value = []
		const activeAddress = account.value?.address
		awaitingTransactions.value = activeAddress ? awaitingTransactions.value.filter((t) => t.account === activeAddress) : []
	}

	// Single synchronous choke point for every switch path (AccountsPopup,
	// visibility-driven reassignment, bootstrap, network switch → setupActiveAccount
	// all funnel through `account.value`). `flush: 'sync'` closes the one-tick
	// window the async app.vue watcher would leave, where B could paint A's rows.
	// Keyed on address so a rename (same address) does not reset the feed.
	watch(
		() => account.value?.address,
		() => {
			activityGeneration.value++
			resetActiveFeedState()
		},
		{ flush: "sync" },
	)

	// Removes exactly the placeholder with `id` (unique per submission), so the
	// send-rejection path can never remove a same-recipient sibling or another
	// account's placeholder.
	const removeAwaitingTransaction = (id: string) => {
		const idx = awaitingTransactions.value.findIndex((t) => t.id === id)
		if (idx !== -1) awaitingTransactions.value.splice(idx, 1)
	}

	const onTxAdded = async (tx: Tx) => {
		// Containment: only surface the tx in the active view when its scope
		// matches the live scope. A tx settling for A while B is active must NOT
		// enter B's feed.
		if (isActiveTxScope(tx)) {
			transactions.value.unshift(tx)
		}

		// Placeholder cleanup keys on the tx's OWN account plus the placeholder's
		// captured scope (account + contract + destination) — never the live active
		// account, so a tx settling for a non-active account still clears that
		// account's placeholder. Use the shared primary-call picker so FEE_METHODS
		// (sponsor_unconditionally etc.) are filtered out before destination
		// resolution. Without this, a dApp + FPC tx whose calls[0] is the fee call
		// would compare the FPC's address against the awaiting placeholder's
		// intended destination — the awaiting card would never clear.
		const call = getPrimaryCall(tx.calls)
		const destination = (call?.transfers?.length ? call?.transfers[0].to : (call?.args?.[1] as string | undefined)) ?? ""
		const awaitingTxIdx = awaitingTransactions.value.findIndex(
			(t) => t.account === tx.account && t.contract === call?.contract && t.destination === destination,
		)
		if (awaitingTxIdx > -1) {
			awaitingTransactions.value.splice(awaitingTxIdx, 1)
		}
	}
	const onTxUpdated = (tx: Tx) => {
		// Require account AND hash. A hash-only match could rewrite a different
		// account's row; matching on account too means a foreign-scope event can
		// never mutate the active view.
		const ind = transactions.value.findIndex((x) => x.hash === tx.hash && x.account === tx.account)
		if (ind !== -1) {
			transactions.value.splice(ind, 1, tx)
		}
	}
	const syncTransactions = async () => {
		if (!account.value || !managers.transaction) return

		// Capture scope + generation BEFORE the await (mirrors syncNetworkStatus'
		// oldNetworkId guard): discard the result if a switch bumped the generation
		// while the fetch was in flight (A→B, A→B→A), then filter rows to the
		// captured account + chain as defense-in-depth.
		const capturedGeneration = activityGeneration.value
		const capturedAccount = account.value.address
		const capturedChainId = network.value?.chainId

		const rows = await managers.transaction.getTransactions(capturedAccount)

		if (capturedGeneration !== activityGeneration.value) return

		transactions.value = rows
			.filter((tx) => tx.account === capturedAccount && (capturedChainId === undefined || tx.chainId === capturedChainId))
			.sort((a, b) => b.updatedAt - a.updatedAt)
	}

	const dappSessions = ref([])

	const isPrivacyModeEnabled = ref(false)

	const defaultExplorer = ref<BlockExplorerType | null>("aztecscan")

	const loggerWindowId = useSyncedRef("loggerWindowId", null)

	return {
		_isHomeScreenOpened,
		isLoading,
		awaitingTransactions,
		displayOption,
		profile,
		profiles,
		isRegistered,
		account,
		isLogined,
		isSessionChecked,
		pageAwaitingAuth,
		accounts,
		setupActiveAccount,
		selectAccount,
		changeAccountVisibility,
		updateAccount,
		network,
		networkStatus,
		syncNetworkStatus,
		networks,
		dappSessions,
		renameNetwork,
		removeNetwork,
		transactions,
		activityGeneration,
		resetActiveFeedState,
		removeAwaitingTransaction,
		onTxAdded,
		onTxUpdated,
		syncTransactions,
		isPrivacyModeEnabled,
		defaultExplorer,
		loggerWindowId,
		onboardingCompleted,
		loadOnboardingCompleted,
		setOnboardingCompleted,
	}
})
