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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline (245 lines) — split when touched, never grow
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
	/** Identity-keyed record of a DEFINITIVE bootstrap failure. The unlock
	 *  flow's activation wait joins on it so a failed bootstrap releases the
	 *  waiter immediately instead of burning the full timeout; cleared at the
	 *  start of every unlock attempt and on any successful bootstrap. */
	const bootstrapFailure = ref<{ profileId: string; message: string } | null>(null)

	/**
	 * Point at the remembered account, or the first one.
	 *
	 * Reached during bootstrap AND from the network watcher, which runs after
	 * several awaits — so this is a scope change like any other and commits
	 * through the guard. During bootstrap there is nothing in flight to protect
	 * (the journal read comes back empty), so it proceeds normally; mid-send it
	 * refuses rather than moving the account out from under the send.
	 *
	 * Stale-activation fence: a monotonic activation epoch plus the (profile,
	 * network) scope captured at entry, re-checked before EVERY account
	 * assignment and the durable pointer write. A run superseded mid-await
	 * (rapid profile switch, network flip) refuses instead of landing the
	 * loser's account after the winner's — and instead of poisoning the global
	 * `nulo:ui:activeAccount` key, which survives into the next bootstrap.
	 * The epoch is the load-bearing half: scope IDs alone are ABA-unsafe (an
	 * A→B→A flip makes the parked run's capture match again — codex audit); any
	 * LATER entry into this action supersedes every parked one. The id checks
	 * still catch a flip whose own activation hasn't re-entered this action yet.
	 * `commitScopeChange` cannot express either: it guards in-flight SENDS,
	 * not superseded activations.
	 */
	let activationEpoch = 0
	/** Point `account` at `target` through the scope-change guard.
	 *  "already-active" is the fast path — re-pointing at the account already
	 *  active is not a scope change, so it commits synchronously with no guard.
	 *  The fence re-check lives INSIDE the synchronous commit (the widest
	 *  await is commitScopeChange's own refreshInFlight); `landed` keeps
	 *  the outcome honest when the commit refuses as stale. */
	const commitAccountTarget = async (
		target: Account | undefined,
		superseded: () => boolean,
	): Promise<"already-active" | "landed" | "refused"> => {
		if (account.value?.address === target?.address) {
			account.value = target
			return "already-active"
		}
		let landed = false
		const admitted = await commitScopeChange(() => {
			if (superseded()) return
			account.value = target
			landed = true
		})
		return admitted && landed ? "landed" : "refused"
	}
	const setupActiveAccount = async (): Promise<boolean> => {
		const myEpoch = ++activationEpoch
		const scopeProfileId = profile.value?.id
		const scopeNetworkId = network.value?.id
		const superseded = () => activationEpoch !== myEpoch || profile.value?.id !== scopeProfileId || network.value?.id !== scopeNetworkId

		const activeAccountResult = await storageLocalGet("nulo:ui:activeAccount")
		// INVARIANT: no await between this check and commitAccountTarget's
		// synchronous fast-path assignment (an async call runs synchronously up
		// to its first await) — that synchronous span is what lets the fast path
		// skip its own superseded() re-check. Inserting an await in it (here or
		// before the helper's fast-path check) reopens the race.
		if (superseded()) return false
		if ("nulo:ui:activeAccount" in activeAccountResult) {
			const activeAccountAddress = activeAccountResult["nulo:ui:activeAccount"]
			const remembered = accounts.value.find((a) => a.address === activeAccountAddress)
			if (remembered) return (await commitAccountTarget(remembered, superseded)) !== "refused"
		}

		const first = accounts.value[0]
		const outcome = await commitAccountTarget(first, superseded)
		// The fast path returns without stamping the durable pointer — nothing moved.
		if (outcome === "already-active") return true
		if (outcome === "refused") return false
		// Re-check across the await boundary between the commit and the durable
		// write: a supersede landing in that gap must not let the loser stamp the
		// global pointer (it outlives this run — the next bootstrap reads it).
		if (superseded()) return false
		await storageLocalSet({
			"nulo:ui:activeAccount": account.value?.address,
		})
		return true
	}
	const selectAccount = async (acc: Account) => {
		account.value = acc
		await storageLocalSet({
			"nulo:ui:activeAccount": acc.address,
		})
	}
	const changeAccountVisibility = async (acc: Account, value: boolean): Promise<boolean> => {
		if (!profile.value || !network.value) return false
		const accIdx = accounts.value.findIndex((a) => acc.address === a.address)

		await requireAccount().changeAccountVisibility(profile.value.id, network.value.chainId, acc.address, value)
		accounts.value[accIdx] = { ...acc, visible: value }

		if (!value && accounts.value.length) {
			// Hiding reassigns the active account, which moves the signing scope —
			// and the RPC above is exactly the window a send can start in. The
			// reassignment therefore commits through the guard rather than being
			// checked by the caller beforehand; the visibility change itself is
			// already persisted and is harmless to keep.
			const next = accounts.value.filter((a) => a.visible).sort((a, b) => a.index - b.index)[0]
			const moved = await commitScopeChange(() => {
				account.value = next
			})
			if (!moved) return false
			await storageLocalSet({
				"nulo:ui:activeAccount": account.value?.address,
			})
		}
		return true
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
			try {
				await inFlightJournal.connect()
			} catch {
				inFlightOps.value = []
				inFlightReady.value = true
				return
			}
		}
		let rows: OperationRecord[]
		try {
			rows = await inFlightJournal.getOperations({ profileId })
		} catch {
			// A journal read can fail transiently (service worker restarting). Not
			// being able to ask must not make every scope change throw — the caller
			// would surface that as an outright failure to switch. Treat it as "no
			// sends known", which is what the pre-guard behavior was; the executor
			// still binds its own account explicitly.
			inFlightOps.value = []
			inFlightReady.value = true
			return
		}
		// Discard a response for a profile that is no longer current: a slow read
		// for the previous one landing late would replace the live profile's
		// operations and let a switch through mid-send.
		if (profile.value?.id !== profileId) return
		inFlightOps.value = rows
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
	 * Commit a scope change, or refuse it.
	 *
	 * `commit` MUST be synchronous. That is the whole point: the guarantee is
	 * "no scope change while a send is in flight", and any await between the
	 * check and the assignment reopens the window the check just closed — a send
	 * can start inside it and the assignment still lands. Checking at call sites
	 * cannot express this; only a check with no suspension point before the
	 * write can.
	 *
	 * Callers do their async preparation FIRST (RPCs, service calls), then hand
	 * over a function that only assigns.
	 *
	 * `true` means the guard ADMITTED the commit and ran it — not that the
	 * callback changed anything. A conditional commit (one that can refuse
	 * internally, e.g. a staleness fence) must track its own `landed` flag and
	 * combine it with this return; see `setupActiveAccount`.
	 */
	const commitScopeChange = async (commit: () => void): Promise<boolean> => {
		if (hasInFlightSend.value) return false
		// One read immediately before the commit, so the decision is made on the
		// freshest answer available rather than on cached event state.
		await refreshInFlight()
		if (hasInFlightSend.value) return false
		commit()
		return true
	}

	/** @deprecated Prefer `commitScopeChange`; an async apply reopens the race. */
	const withScopeChangeAllowed = commitScopeChange

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
		const install = (result: Tx[], version: number) =>
			activity.setTransactions(
				captured,
				result.filter((tx) => txBelongsToScope(tx, captured, { soleProfile: soleProfile.value })),
				version,
			)
		if (install(rows, capturedVersion)) return

		// An event landed mid-fetch, so this result predates it. Re-read until one
		// completes without interruption: a single retry can lose the race again,
		// which would leave a cold scope holding only those events and none of its
		// history. Backoff keeps a busy scope from spinning.
		for (let attempt = 0; attempt < 4; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt))
			if (activeScope.value === null) return
			const retryVersion = activity.mutationVersionFor(captured)
			if (install(await managers.transaction.getTransactions(captured.accountAddress), retryVersion)) return
		}
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
		bootstrapFailure,
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
		commitScopeChange,
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
