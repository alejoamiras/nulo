/** Vendor */
import { defineStore } from "pinia"

import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"
import { NodeStatus } from "@/wallet/services/network/client"
import type { ProfileInfo } from "@/wallet/services/profile/client"
import type { Tx } from "@/wallet/services/transaction/spec"
import type { BlockExplorerType } from "@/wallet/constants/explorers"

import { useSyncedRef } from "@/composables/syncedRef.js"

type AwaitingTx = {
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
		const result = await chrome.storage.local.get(ONBOARDING_COMPLETED_KEY)
		onboardingCompleted.value = result[ONBOARDING_COMPLETED_KEY] === true
	}
	const setOnboardingCompleted = async (value: boolean) => {
		onboardingCompleted.value = value
		await chrome.storage.local.set({ [ONBOARDING_COMPLETED_KEY]: value })
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
		const activeAccountResult = await chrome.storage.local.get("nulo:ui:activeAccount")
		if ("nulo:ui:activeAccount" in activeAccountResult) {
			const activeAccountAddress = activeAccountResult["nulo:ui:activeAccount"]
			const activeAccount = accounts.value.find((a) => a.address === activeAccountAddress)
			if (activeAccount) {
				account.value = activeAccount
				return
			}
		}

		account.value = accounts.value[0]
		await chrome.storage.local.set({
			"nulo:ui:activeAccount": account.value?.address,
		})
	}
	const selectAccount = async (acc: Account) => {
		account.value = acc
		await chrome.storage.local.set({
			"nulo:ui:activeAccount": acc.address,
		})
	}
	const changeAccountVisibility = async (acc: Account, value: boolean) => {
		if (!profile.value || !network.value) return
		const accIdx = accounts.value.findIndex((a) => acc.address === a.address)

		await managers.account.changeAccountVisibility(profile.value.id, network.value.chainId, acc.address, value)
		accounts.value[accIdx] = { ...acc, visible: value }

		if (!value) {
			if (accounts.value.length) {
				account.value = accounts.value.filter((a) => a.visible).sort((a, b) => a.index - b.index)[0]
				await chrome.storage.local.set({
					"nulo:ui:activeAccount": account.value?.address,
				})
			}
		}
	}
	const updateAccount = async (address: string, name: string) => {
		if (!profile.value || !network.value) return
		const accIdx = accounts.value.findIndex((a) => address === a.address)

		await managers.account.changeAccountName(profile.value.id, network.value.chainId, address, name)

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
		const [status, health] = await Promise.all([
			managers.network.getNodeStatus(network.value.id),
			managers.network.getEndpointHealth(network.value.id),
		])

		if (oldNetworkId !== network.value?.id) return

		// Compound state: "degraded" amber dot when the node is alive but
		// the live route isn't on the user-preferred endpoint (failover or
		// post-promote pending snapback). Falls through to the standard
		// NodeStatus rendering when the route is on preferred.
		const preferredId = network.value.endpoints[0]?.id
		const isDegraded = status === NodeStatus.Active && preferredId !== undefined && health.activeEndpointId !== preferredId
		networkStatus.value = isDegraded ? "degraded" : NodeStatus[status]
	}
	const renameNetwork = async (id: string, name: string) => {
		await managers.network.renameNetwork(id, name)
		networks.value = await managers.network.getNetworks()
	}
	const removeNetwork = async (target: Network) => {
		await managers.network.deleteNetwork(target.id)
		networks.value = networks.value.filter((n) => n.id !== target.id)
	}

	const awaitingTransactions = ref<AwaitingTx[]>([])
	const transactions = ref<Tx[]>([])
	const onTxAdded = async (tx: Tx) => {
		transactions.value.unshift(tx)
		const call = tx.calls[0]
		const destination = (call?.transfers?.length ? call?.transfers[0].to : (call?.args?.[1] as string | undefined)) ?? ""
		const awaitingTxIdx = awaitingTransactions.value.findIndex(
			(t) => t.account === tx.account && t.contract === call?.contract && t.destination === destination,
		)
		if (awaitingTxIdx > -1) {
			awaitingTransactions.value.splice(awaitingTxIdx, 1)
		}
	}
	const onTxUpdated = (tx: Tx) => {
		const ind = transactions.value.findIndex((x) => x.hash === tx.hash)
		if (ind !== -1) {
			transactions.value.splice(ind, 1, tx)
		}
	}
	const syncTransactions = async () => {
		if (!account.value || !managers.transaction) return

		transactions.value = (await managers.transaction.getTransactions(account.value?.address)).sort((a, b) => b.updatedAt - a.updatedAt)
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
