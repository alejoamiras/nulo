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
import type { ActivityScope } from "@nulo/wallet-core/activity"
import { type AwaitingTx, txBelongsToScope, txScope, useActivityStore } from "@/stores/activity.store"
import { hasInFlightSend as inFlightHasSend } from "@/utils/in-flight-send"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import { OperationJournalServiceClient } from "@/wallet/services/operation-journal/client"

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

	const activity = useActivityStore()

	/**
	 * The scope the feed is showing. Requires all three parts: a half-resolved
	 * scope during bootstrap would otherwise key a slice that no record can ever
	 * match, so the view stays empty until the scope is whole.
	 */
	/**
	 * True only when the wallet is KNOWN to hold exactly one profile.
	 *
	 * Gates attribution of unscoped legacy rows. Deliberately not `<= 1`: the
	 * list is empty before it loads, and reading that as "sole profile" would
	 * fail open and attribute another profile's row to whoever is looking.
	 */
	/**
	 * Whether the viewed account has a send in flight.
	 *
	 * Owned by the store, not by each component: a per-component client can mount
	 * before the profile exists, read an empty journal, call itself ready, and
	 * then never look again — which fails OPEN exactly when a send is running.
	 * One subscription, refreshed whenever the profile changes or the service
	 * reconnects, and closed until it has an answer.
	 */
	const inFlightOps = ref<OperationRecord[]>([])
	const inFlightReady = ref(false)
	/** One client for the whole app; components read `hasInFlightSend`. */
	const inFlightJournal = new OperationJournalServiceClient()
	let inFlightConnected = false

	const hasInFlightSend = computed(
		() =>
			!inFlightReady.value ||
			inFlightHasSend(inFlightOps.value, {
				profileId: profile.value?.id,
				accountAddress: account.value?.address,
				networkId: network.value?.id,
			}),
	)

	const upsertInFlight = (op: OperationRecord) => {
		const idx = inFlightOps.value.findIndex((row) => row.id === op.id)
		if (idx === -1) inFlightOps.value.push(op)
		else inFlightOps.value.splice(idx, 1, op)
	}
	const dropInFlight = (op: OperationRecord) => {
		inFlightOps.value = inFlightOps.value.filter((row) => row.id !== op.id)
	}

	const refreshInFlight = async () => {
		const profileId = profile.value?.id
		if (!profileId) {
			inFlightOps.value = []
			// No profile means nothing can be in flight for one, so this IS an answer.
			inFlightReady.value = true
			return
		}
		if (!inFlightConnected) {
			inFlightConnected = true
			inFlightJournal.onOperationAdded.add(upsertInFlight)
			inFlightJournal.onOperationUpdated.add(upsertInFlight)
			inFlightJournal.onOperationDeleted.add(dropInFlight)
			// A reconnect can drop events, so re-read rather than trusting the cache.
			inFlightJournal.onConnected?.add(() => void refreshInFlight())
			await inFlightJournal.connect()
		}
		inFlightOps.value = await inFlightJournal.getOperations({ profileId })
		inFlightReady.value = true
	}

	// The answer belongs to a profile, so it is invalid the moment that changes.
	watch(
		() => profile.value?.id,
		() => {
			inFlightReady.value = false
			void refreshInFlight()
		},
		{ immediate: true },
	)

	/**
	 * Run a scope change only if nothing is in flight.
	 *
	 * Re-checked immediately before the change is applied: a send can start
	 * during any await the caller performed first, and the stale answer would
	 * wave it through.
	 */
	const withScopeChangeAllowed = async (apply: () => Promise<void> | void): Promise<boolean> => {
		if (hasInFlightSend.value) return false
		await refreshInFlight()
		if (hasInFlightSend.value) return false
		await apply()
		return true
	}

	const soleProfile = computed(() => profiles.value.length === 1)

	const activeScope = computed<ActivityScope | null>(() => {
		const profileId = profile.value?.id
		const networkId = network.value?.id
		const chainId = network.value?.chainId
		const accountAddress = account.value?.address
		// Every part must be usable. A partially-resolved scope during bootstrap
		// would key a slice no record can match, and an empty identifier is not a
		// valid key at all.
		if (!profileId || !networkId || !accountAddress) return null
		if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId < 0) return null
		return { profileId, networkId, chainId, accountAddress }
	})

	// `flush: 'sync'` so the swap happens in the same tick as the scope change —
	// an async watcher leaves a frame in which the outgoing scope's rows are
	// still on screen under the incoming one.
	watch(activeScope, (scope) => activity.activateScope(scope), { flush: "sync", immediate: true })

	const transactions = computed(() => activity.transactions)
	const awaitingTransactions = computed(() => activity.awaitingTransactions)

	const addAwaitingTransaction = (row: AwaitingTx) => {
		if (activeScope.value) activity.addAwaiting(activeScope.value, row)
	}

	/** Removes exactly the placeholder with `id` (unique per submission), so the
	 *  send-rejection path can never remove a same-recipient sibling or another
	 *  account's placeholder. */
	const removeAwaitingTransaction = (id: string) => activity.removeAwaiting(id)

	/** Wipe every cached scope — used by the local-reset flow. */
	const clearActivity = () => activity.clearAll()

	const onTxAdded = async (tx: Tx) => {
		// Routed by the transaction's OWN scope: one settling for another account
		// lands in that account's slice, never in whatever is on screen.
		activity.ingestTransaction(tx, activeScope.value, { soleProfile: soleProfile.value })

		// Placeholder cleanup keys on the tx's own account plus the placeholder's
		// captured scope (account + contract + destination). Use the shared
		// primary-call picker so FEE_METHODS (sponsor_unconditionally etc.) are
		// filtered out before destination resolution. Without this, a dApp + FPC tx
		// whose calls[0] is the fee call would compare the FPC's address against the
		// awaiting placeholder's intended destination — the card would never clear.
		const scope = txScope(tx, activeScope.value, { soleProfile: soleProfile.value })
		if (!scope) return
		const call = getPrimaryCall(tx.calls)
		const destination = (call?.transfers?.length ? call?.transfers[0].to : (call?.args?.[1] as string | undefined)) ?? ""
		activity.settleAwaiting(scope, (t) => t.account === tx.account && t.contract === call?.contract && t.destination === destination)
	}

	const onTxUpdated = (tx: Tx) => {
		activity.ingestTransaction(tx, activeScope.value, { soleProfile: soleProfile.value })
	}

	const syncTransactions = async () => {
		if (!managers.transaction) return
		// Capture the scope BEFORE the await: the result belongs to the scope it
		// was fetched for, even if the user has switched away by the time it lands.
		const captured = activeScope.value
		if (!captured) return

		// Captured with the scope: an event landing while this fetch is in flight
		// makes its result stale, and installing it would erase that event.
		const capturedVersion = activity.mutationVersionFor(captured)

		const rows = await managers.transaction.getTransactions(captured.accountAddress)

		// The fetch is by ADDRESS alone, so it returns every profile's rows for a
		// shared address. Keep only those whose own scope IS the captured one —
		// "has a scope" would admit all of them.
		const scoped = rows.filter((tx) => txBelongsToScope(tx, captured, { soleProfile: soleProfile.value }))
		if (activity.setTransactions(captured, scoped, capturedVersion)) return

		// An event landed mid-fetch, so this result is stale. Re-read once rather
		// than leaving a cold scope without its history until some unrelated
		// refresh happens to come along.
		const retryVersion = activity.mutationVersionFor(captured)
		const fresh = await managers.transaction.getTransactions(captured.accountAddress)
		activity.setTransactions(
			captured,
			fresh.filter((tx) => txBelongsToScope(tx, captured, { soleProfile: soleProfile.value })),
			retryVersion,
		)
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
		activeScope,
		hasInFlightSend,
		refreshInFlight,
		withScopeChangeAllowed,
		addAwaitingTransaction,
		removeAwaitingTransaction,
		clearActivity,
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
