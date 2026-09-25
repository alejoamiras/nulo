<script setup lang="ts">
/** Vendor */
import { onMounted, onUnmounted } from "vue"

/** Components */
import DappStatusStrip from "@/components/composite/DappStatusStrip.vue"
import DappIdentityBlock from "@/components/composite/DappIdentityBlock.vue"
import DappCancelledOverlay from "@/components/composite/DappCancelledOverlay.vue"
import DappApprovalFooter from "@/components/composite/DappApprovalFooter.vue"
import CapabilityDisclosure from "@/components/composite/capabilities/CapabilityDisclosure.vue"
import DetailsTable from "@/components/composite/capabilities/DetailsTable.vue"
import AccountSelectRow from "./AccountSelectRow.vue"
import PermissionGroup from "./PermissionGroup.vue"

/** Utils */
import { getErrorData } from "@nulo/wallet-core/utils"
import { JobCancelledError } from "@nulo/extension-messaging/errors"
import { formatCaipAccount } from "@/wallet/utils/caip"
import { requireNetwork } from "@/utils/core"
import { copyWithToast } from "@/utils/clipboard"
import { buildCapabilityItems, buildGrant, type CapabilityWindowParams, currentLine, type WindowRow } from "./build-items"
import { resolveDappChain } from "./chain-mismatch"
import { buildDetailsTable } from "./details-table"
import { accountAddressRow, GROUP_LABELS, GROUP_ORDER, type PermissionRowEntry } from "./permission-rows"

/** Services */
import { type ProfileInfo, ProfileServiceClient } from "@/wallet/services/profile/client"
import type { DappMetadata } from "@/wallet/services/dapp-session/client"
import { type CapabilityPayload, DappInteractionServiceClient } from "@/wallet/services/dapp-interaction/client"
import { type Capability, effectiveGrants } from "@nulo/wallet-bridge"

/** Composables */
import { useToast } from "@/composables/toast"
import { useDappInteractionPayload } from "@/composables/useDappInteractionPayload"
import { useDappHostname } from "@/composables/useDappHostname"
import { useDappApprovalWindow } from "@/composables/useDappApprovalWindow"
import { useNetworkActivation } from "@/composables/useNetworkActivation"

type UIDappMetadata = DappMetadata & { loadingLogo?: boolean; logoBlobUrl?: string }
type UIAccount = { address: string; name: string; chainId: number }

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const { openToast } = useToast()

const router = useRouter()

const profile = ref<ProfileInfo>()
const rows = ref<WindowRow[]>([])

const needsAccountSelection = ref(false)
const availableAccounts = ref<UIAccount[]>([])

const selectedAccounts = ref<UIAccount[]>([])
const accountAliases = ref<Record<string, string>>({})

// Accounts the session already holds (lowercase hex): rendered locked and pre-selected, never
// toggled here, their aliases untouched. Wallet-derived, like `availableAccounts`.
const grantedAccountSet = ref<Set<string>>(new Set())
// The request adds membership only (same flags as the stored grant): approving with nothing new
// selected would be a no-op consent, so the gate asks for an account to add.
const accountsMembershipOnly = ref(false)

// True when the dApp asked for accounts but the wallet lists none on the session's chain: the
// wallet already tried to provision the chain's default account and declined (a user-added
// network, or a chain whose accounts are all hidden). Approving would grant a session with
// `accounts: []`, and every later op would fail with "No accounts authorized" — block here.
const noAccountsAvailable = ref(false)

// The dApp's chain, as the wallet sees it. A dApp connects on ONE chain and everything it does
// later happens there, whatever the wallet's home screen shows — so a mismatch with the active
// network is information, never a reason to block.
const dappChain = computed(() =>
	payload.value ? resolveDappChain(payload.value.session.chainId, appStore.networks, appStore.network?.chainId) : undefined,
)
const chainName = computed(() => dappChain.value?.name ?? "this network")
const isSwitching = ref(false)
// The chain the user switched to from THIS window. The done banner shows only while it is still
// the active one; a later switch elsewhere brings the invitation back.
const switchedTo = ref<number>()

const isLoading = ref(false)

// Flips once init() has the payload AND the rows: before that, Connect would grant an empty set.
const initComplete = ref(false)

// The banner's "as is" is only offered where the footer's button can act: not before init lands
// (no chain known yet), not on a hard error. The footer's own holds (a running switch, a submit)
// are momentary.
const chainBannerState = computed(() => {
	if (!initComplete.value || !dappChain.value || processingError.value?.type === "error") return undefined
	if (switchedTo.value !== undefined && switchedTo.value === appStore.network?.chainId) return "switched"
	return dappChain.value.mismatch ? "mismatch" : undefined
})

const interactionService = new DappInteractionServiceClient()

const {
	requestId,
	payload,
	dapp,
	isCancelled: isInteractionCancelled,
	load: loadInteractionPayload,
	reject: rejectViaInteractionService,
} = useDappInteractionPayload<CapabilityPayload>({
	interactionService,
	getRequestId: () => router.currentRoute.value.query.requestId?.toString(),
	dappOf: (p) => p.session.dappMetadata as UIDappMetadata,
})

const { hostname: dappHostname, isSuspicious: hostnameHasNonAscii } = useDappHostname(dapp)

// init/reject/services are referenced lazily (thunks): they are declared below
// and only invoked by start()/dispose()/the guard at runtime.
const {
	start: startWindow,
	dispose: disposeWindow,
	closeWindow,
	onActiveProfileChanged,
	stripStatus,
	processingError,
	setError,
	clearError,
} = useDappApprovalWindow({
	profile,
	isInteractionCancelled,
	isLoading,
	connectServices: () => {
		profileService.connect()
		interactionService.connect()
	},
	disconnectServices: () => {
		profileService.disconnect()
		interactionService.disconnect()
	},
	init: () => init(),
	reject: () => reject(),
})

const init = async () => {
	try {
		profile.value = await profileService.getActiveProfile()
		await loadInteractionPayload()
		if (!payload.value) return

		const delta = payload.value.params.delta as Capability[]
		const hasAccountsInDelta = delta.some((cap) => cap.type === "accounts")
		if (hasAccountsInDelta) {
			if (payload.value.params.availableAccounts?.length) {
				initAccountPicker(payload.value.params)
			} else {
				const chain = dappChain.value?.name ?? "this chain"
				noAccountsAvailable.value = true
				setError(
					"No accounts on this chain",
					`This app asked for accounts on ${chain}. Switch the wallet to ${chain} in Settings to set one up, ` +
						"or unhide one of its accounts, then try again from the app.",
					"error",
				)
			}
		}

		rows.value = buildCapabilityItems(windowParams(payload.value.params))
		// Only flip after the rows are committed to state. If init throws
		// or the popup is cancelled mid-flight, the approve gate stays closed.
		initComplete.value = true
	} catch (error) {
		console.error(getErrorData(error))
		setError("Something went wrong")
	}
}

/** Everything the rows start from is the dispatch snapshot in `params`, never `payload.session`,
 *  which is re-read after the snapshot and may already hold a later Settings write. */
const windowParams = (params: CapabilityPayload["params"]): CapabilityWindowParams => {
	const existingGrants = params.existingGrants as Capability[]
	return {
		delta: params.delta as Capability[],
		existingGrants,
		heldGrants: (params.heldGrants ?? existingGrants) as Capability[],
		reRequested: new Set(params.reRequested ?? []),
		accountsMembershipOnly: params.accountsMembershipOnly === true,
		consent: params.authorizationsWithoutAsking,
		networkName: chainName.value,
		heldAccounts: params.heldAccounts ?? [],
	}
}

/** A new address row names the selection, not the session: it follows each click. */
const shownEntry = (row: WindowRow): PermissionRowEntry =>
	row.isNew && row.entry.key === "account-address" ? accountAddressRow(selectedAccounts.value) : row.entry

const groupsOf = (list: WindowRow[]) =>
	GROUP_ORDER.map((group) => ({
		group,
		rows: list
			.filter((row) => row.entry.group === group)
			.map((row) => ({
				entry: shownEntry(row),
				capId: row.capId,
				line: currentLine(row),
				badge: row.reRequested ? "previously denied" : undefined,
				selected: row.selected,
			})),
	})).filter((entry) => entry.rows.length > 0)

const newGroups = computed(() => groupsOf(rows.value.filter((row) => row.isNew)))
const heldGroups = computed(() => groupsOf(rows.value.filter((row) => !row.isNew)))
const heldCount = computed(() => rows.value.filter((row) => !row.isNew).length)

/** An app that already holds a row asks for more: "Allow" what's new, not "Connect". */
const asksForMore = computed(() => heldCount.value > 0)
const confirmWord = computed(() => (asksForMore.value ? "Allow" : "Connect"))

const setSwitch = (key: string, on: boolean) => {
	const row = rows.value.find((candidate) => candidate.isNew && candidate.entry.key === key)
	if (row) row.selected = on
}

/** Names come only from the wallet's list in the snapshot; the request never names a contract.
 *  Grants that reach no contract show no Details: its table would list nothing. */
const detailsTable = computed(() => {
	if (!payload.value) return undefined
	const params = windowParams(payload.value.params)
	const table = buildDetailsTable(effectiveGrants(params.heldGrants, params.delta), payload.value.params.knownContracts ?? [])
	return table.known.length > 0 || table.unknown.length > 0 || table.anyContract ? table : undefined
})

const recognizesNoContract = computed(() => detailsTable.value?.known.length === 0 && detailsTable.value.unknown.length > 0)

const copyAddress = (address: string) => void copyWithToast(address, openToast, "Address is copied", { sanitize: true })

/** `availableAccounts` and `grantedAccounts` are both wallet-derived (never dApp-supplied), so
 *  there is no path for a malicious dApp to inject a phantom account or a phantom lock here. */
const initAccountPicker = (params: CapabilityPayload["params"]) => {
	needsAccountSelection.value = true
	availableAccounts.value = params.availableAccounts ?? []
	grantedAccountSet.value = new Set((params.grantedAccounts ?? []).map((address) => address.toLowerCase()))
	accountsMembershipOnly.value = params.accountsMembershipOnly === true
	const held = availableAccounts.value.filter(isAccountGranted)
	// Held rows are pre-selected and locked. Otherwise, exactly one available account is
	// pre-selected: the user still sees the row and must Approve; this only removes a click.
	if (held.length > 0) selectedAccounts.value = held
	else if (availableAccounts.value.length === 1) selectedAccounts.value = [...availableAccounts.value]
}

const isAccountGranted = (account: UIAccount) => grantedAccountSet.value.has(account.address.toLowerCase())

const selectAccount = (account: UIAccount) => {
	if (isAccountGranted(account)) return
	if (processingError.value?.type === "warning") clearError()
	const idx = selectedAccounts.value.findIndex((acc) => acc.address === account.address)
	if (idx < 0) selectedAccounts.value.push(account)
	else selectedAccounts.value.splice(idx, 1)
}

const isAccountSelected = (account: UIAccount) => selectedAccounts.value.some((acc) => acc.address === account.address)

const decideGrant = () => {
	const params = windowParams(payload.value!.params)
	return buildGrant({
		rows: rows.value,
		delta: params.delta,
		existingGrants: params.existingGrants,
		heldGrants: params.heldGrants,
		accountsSelected: needsAccountSelection.value && selectedAccounts.value.length > 0,
	})
}

/** CAIP-formatted account selection + alias map; both undefined when no picker ran. */
const buildAccountSelectionResult = (): { selectedAccounts?: string[]; accountAliases?: Record<string, string> } => {
	if (!needsAccountSelection.value || selectedAccounts.value.length === 0) return {}
	const selected = selectedAccounts.value.map((acc) => formatCaipAccount(acc.chainId, acc.address))
	const aliases: Record<string, string> = {}
	for (const acc of selectedAccounts.value) {
		const caip = formatCaipAccount(acc.chainId, acc.address)
		aliases[caip] = accountAliases.value[caip] || acc.name
	}
	return { selectedAccounts: selected, accountAliases: aliases }
}

const approve = async () => {
	// Full-lifetime submit latch: `loading` alone only sets pointer-events CSS,
	// so a keyboard-focused Approve can still emit a click mid-grant — the
	// handler must self-guard like execute/discover already do.
	if (isLoading.value || isSwitching.value) return
	// The footer's `!initComplete` gate should already block this; an Enter or programmatic click
	// that slips through throws instead of silently granting an empty set.
	if (!initComplete.value) {
		throw new Error("capabilities approve() called before init() completed — :disabled gate must include !initComplete")
	}
	if (noAccountsAvailable.value) {
		// init() already populated the error block; refuse approval explicitly
		// so the user can't bypass via Enter / keyboard.
		return
	}
	if (needsAccountSelection.value && selectedAccounts.value.length === 0) {
		setError("Select at least one account", "You must select at least one account to share with the dApp", "warning")
		return
	}
	if (needsAccountSelection.value && accountsMembershipOnly.value && !selectedAccounts.value.some((acc) => !isAccountGranted(acc))) {
		setError("Select an account to add", "This app already has the accounts marked SHARED. Pick one to add, or reject.", "warning")
		return
	}
	try {
		isLoading.value = true
		const { granted, authorizationsWithoutAsking } = decideGrant()
		const selection = buildAccountSelectionResult()

		await interactionService.resolveInteraction(requestId.value!, {
			granted,
			selectedAccounts: selection.selectedAccounts,
			accountAliases: selection.accountAliases,
			...(authorizationsWithoutAsking !== undefined ? { authorizationsWithoutAsking } : {}),
		})
		closeWindow(true)
	} catch (error) {
		if (error instanceof JobCancelledError) {
			// A raced approve refused service-side (the dApp cancelled first):
			// the refusal IS the cancelled state — overlay, not an error banner.
			isInteractionCancelled.value = true
		} else {
			console.error(getErrorData(error))
			setError("Something went wrong")
		}
	} finally {
		isLoading.value = false
	}
}

// `reject` stays unconditional: the approval-window shell also fires it on `beforeunload` and on a
// lock or profile change, and a lock landing mid-switch must still reject the pending request.
// Only the footer's buttons are held while a switch runs.
const reject = async () => {
	if (isInteractionCancelled.value) return
	rejectViaInteractionService("User rejected")
	closeWindow(true)
}

const { activate: activateNetwork } = useNetworkActivation({
	persist: (id) => requireNetwork().setActiveNetwork(id),
	read: () => requireNetwork().getActiveNetwork(),
})

const switchToDappNetwork = async () => {
	const target = dappChain.value?.network
	if (!target || isSwitching.value || isLoading.value) return
	isSwitching.value = true
	try {
		if ((await activateNetwork(target)) === "activated") switchedTo.value = target.chainId
	} finally {
		isSwitching.value = false
	}
}

const profileService = new ProfileServiceClient()
profileService.onActiveProfileChanged.add(onActiveProfileChanged)

onMounted(startWindow)

onUnmounted(disposeWindow)
</script>

<template>
	<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper">
		<DappStatusStrip
			:accountName="appStore.account?.name"
			:networkName="appStore.network?.name"
			:status="stripStatus"
		/>

		<Flex direction="column" :class="$style.scroll_area">
			<DappIdentityBlock
				:dapp="dapp"
				:hostname="dappHostname"
				:hostnameSuspicious="hostnameHasNonAscii"
				:actionLabel="asksForMore ? `wants more permissions on ${chainName}` : `wants to connect on ${chainName}`"
			/>

			<Flex direction="column" gap="20" :class="$style.sections">
				<Banner
					v-if="chainBannerState && dappChain"
					data-testid="cap-chain-banner"
					:data-state="chainBannerState"
					:variant="chainBannerState === 'switched' ? 'done' : 'info'"
					direction="vertical"
					wide
					:action="
						chainBannerState === 'mismatch' && dappChain.network
							? { name: `Switch wallet to ${dappChain.name}`, callback: switchToDappNetwork, testId: 'cap-switch-network-btn' }
							: undefined
					"
				>
					<template v-if="chainBannerState === 'switched'" #title>Wallet switched to {{ dappChain.name }}</template>
					<template v-else #title>Connecting on {{ dappChain.name }}</template>
					<template v-if="chainBannerState === 'switched'" #description>Balances and activity now follow {{ dappChain.name }}.</template>
					<template v-else #description>
						Your wallet is on {{ appStore.network?.name }}. {{ confirmWord }} as is, or switch to see {{ dappChain.name }} balances.
					</template>
				</Banner>

				<Flex v-if="needsAccountSelection" direction="column" gap="10" wide>
					<SectionLabel
						:label="availableAccounts.length === 1 ? 'Account to share' : 'Accounts to share'"
						:count="availableAccounts.length"
					/>

					<ItemsContainer>
						<AccountSelectRow
							v-for="acc in availableAccounts"
							:key="acc.address"
							:account="acc"
							:selected="isAccountSelected(acc)"
							:locked="isAccountGranted(acc)"
							:alias="accountAliases[formatCaipAccount(acc.chainId, acc.address)]"
							:disabled="isLoading || processingError?.type === 'error'"
							@toggle="selectAccount(acc)"
							@updateAlias="(caip: string, val: string) => (accountAliases[caip] = val)"
						/>
					</ItemsContainer>
				</Flex>

				<PermissionGroup
					v-for="{ group, rows: groupRows } in newGroups"
					:key="group"
					:data-cap-group="group"
					:label="GROUP_LABELS[group]"
					:rows="groupRows"
					@toggle="setSwitch"
				/>

				<CapabilityDisclosure v-if="asksForMore" label="Already allowed" :tag="String(heldCount)" testid="cap-already-allowed">
					<PermissionGroup
						v-for="{ group, rows: groupRows } in heldGroups"
						:key="group"
						:data-cap-group="group"
						:label="GROUP_LABELS[group]"
						:rows="groupRows"
						granted
					/>
				</CapabilityDisclosure>

				<div v-if="recognizesNoContract" data-testid="cap-unknown-contracts-note" :class="$style.note">
					Nulo doesn't recognize any of its contracts.
				</div>

				<DetailsTable v-if="detailsTable" v-bind="detailsTable" @copy="copyAddress" />
			</Flex>
		</Flex>

		<DappApprovalFooter
			:processing-error="processingError"
			wide-tooltip
			reject-testid="cap-reject-btn"
			reject-label="Reject"
			:reject-disabled="isLoading || isSwitching || !requestId"
			confirm-testid="cap-approve-btn"
			:confirm-label="confirmWord"
			:confirm-loading="isLoading"
			:confirm-disabled="isLoading || isSwitching || processingError?.type === 'error' || !initComplete"
			@reject="reject"
			@approve="approve"
		/>

		<DappCancelledOverlay
			v-if="isInteractionCancelled"
			message="Capability request was cancelled"
			@dismiss="closeWindow()"
		/>
	</Flex>
</template>

<style module>
.wrapper {
	composes: approval_wrapper from "../window-shell.module.css";
}

.scroll_area {
	composes: scroll_area from "../window-shell.module.css";
}

.sections {
	padding: 16px;
}

.note {
	padding: 10px 12px;
	border: 1px solid var(--nulo-border);
	background: var(--nulo-surface-low);

	font-size: 11.5px;
	line-height: 1.45;
	color: var(--nulo-secondary);
}

</style>
