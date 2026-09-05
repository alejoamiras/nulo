<script setup lang="ts">
/** Vendor */
import { onMounted, onUnmounted } from "vue"

/** Components */
import DappStatusStrip from "@/components/composite/DappStatusStrip.vue"
import DappIdentityBlock from "@/components/composite/DappIdentityBlock.vue"
import DappCancelledOverlay from "@/components/composite/DappCancelledOverlay.vue"
import DappApprovalFooter from "@/components/composite/DappApprovalFooter.vue"
import CapabilityCard from "./CapabilityCard.vue"
import AccountSelectRow from "./AccountSelectRow.vue"

/** Utils */
import { getErrorData } from "@nulo/wallet-core/utils"
import { JobCancelledError } from "@nulo/extension-messaging/errors"
import { formatCaipAccount } from "@/wallet/utils/caip"
import { requireNetwork } from "@/utils/core"
import { buildCapabilityItems, buildGrantedAccountsCap, type UICapabilityItem } from "./build-items"
import { resolveDappChain } from "./chain-mismatch"

/** Services */
import { type ProfileInfo, ProfileServiceClient } from "@/wallet/services/profile/client"
import type { DappMetadata } from "@/wallet/services/dapp-session/client"
import { type CapabilityPayload, DappInteractionServiceClient } from "@/wallet/services/dapp-interaction/client"
import type { Capability } from "@nulo/wallet-bridge"

/** Composables */
import { useDappInteractionPayload } from "@/composables/useDappInteractionPayload"
import { useDappHostname } from "@/composables/useDappHostname"
import { useDappApprovalWindow } from "@/composables/useDappApprovalWindow"
import { useNetworkActivation } from "@/composables/useNetworkActivation"

type UIDappMetadata = DappMetadata & { loadingLogo?: boolean; logoBlobUrl?: string }
type UIAccount = { address: string; name: string; chainId: number }

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const router = useRouter()

const profile = ref<ProfileInfo>()
const capabilities = ref<UICapabilityItem[]>([])

const needsAccountSelection = ref(false)
const availableAccounts = ref<UIAccount[]>([])

const selectedAccounts = ref<UIAccount[]>([])
const accountAliases = ref<Record<string, string>>({})

// True when the dApp asked for accounts capability but the wallet resolved
// the session's chain to a network with zero accounts. The most common cause
// is a chain-info mismatch — e.g. a dApp sending Fr.ZERO/Fr.ZERO that
// resolves to the wallet's Local Network seed while the user's accounts
// live on testnet. Approving here would silently give the dApp a session
// with `accounts: []` and every subsequent op would fail with "No accounts
// authorized." Block the approve gate explicitly so the user gets a clear
// error instead of a confusing downstream failure.
const noAccountsAvailable = ref(false)

// The dApp's chain, as the wallet sees it. A dApp connects on ONE chain and everything it does
// later happens there, whatever the wallet's home screen shows — so a mismatch with the active
// network is information, never a reason to block.
const dappChain = computed(() => resolveDappChain(payload.value?.session.chainId ?? "", appStore.networks, appStore.network?.chainId))
const isSwitching = ref(false)
// The chain the user switched to from THIS window. The done banner shows only while it is still
// the active one; a later switch elsewhere brings the invitation back.
const switchedTo = ref<number>()
const chainBannerState = computed(() => {
	if (noAccountsAvailable.value) return undefined
	if (switchedTo.value !== undefined && switchedTo.value === appStore.network?.chainId) return "switched"
	return dappChain.value.mismatch ? "mismatch" : undefined
})

const isLoading = ref(false)
const expandedCards = ref(new Set<number>())

// initComplete flips after init() resolves the dApp interaction payload
// AND populates `capabilities.value`. Without it, the Approve button can be
// clicked while `payload.value` is still null / `capabilities.value` is still
// `[]`; approve() would silently no-op or approve an empty grant set. Codex
// audit-final-merge HIGH #1. Race-safety parallel to execute/index.vue's
// `initComplete` predicate.
const initComplete = ref(false)

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

const toggleExpand = (index: number) => {
	if (expandedCards.value.has(index)) expandedCards.value.delete(index)
	else expandedCards.value.add(index)
}

const init = async () => {
	try {
		profile.value = await profileService.getActiveProfile()
		await loadInteractionPayload()
		if (!payload.value) return

		const delta = payload.value.params.delta as Capability[]
		const hasAccountsInDelta = delta.some((cap) => cap.type === "accounts")
		if (hasAccountsInDelta) {
			if (payload.value.params.availableAccounts?.length) {
				needsAccountSelection.value = true
				availableAccounts.value = payload.value.params.availableAccounts
				// If exactly one account is available, pre-select it. The user
				// still sees the row and must Approve; this just removes the
				// extra click. `availableAccounts` is wallet-derived (not
				// dApp-supplied), so there's no path for a malicious dApp to
				// inject a phantom account here.
				if (availableAccounts.value.length === 1) {
					selectedAccounts.value = [...availableAccounts.value]
				}
			} else {
				// The wallet already tried to provision this chain's default account and declined
				// (a user-added network, or a chain whose only accounts are hidden or imported).
				// Approving would grant a session with no accounts, and every later op would fail
				// with a confusing "No accounts authorized" — block here with the remedy instead.
				noAccountsAvailable.value = true
				setError(
					"No accounts on this chain",
					`This app asked for accounts on ${dappChain.value.name}. Switch the wallet to ${dappChain.value.name} ` +
						"in Settings to set one up, or unhide one of its accounts, then try again from the app.",
					"error",
				)
			}
		}

		const reRequestedTypes = new Set(payload.value.params.reRequested ?? [])
		const existingGrants = payload.value.params.existingGrants as Capability[]

		capabilities.value = buildCapabilityItems(delta, existingGrants, reRequestedTypes)
		// Only flip after capabilities are committed to state. If init throws
		// or the popup is cancelled mid-flight, the approve gate stays closed.
		initComplete.value = true
	} catch (error) {
		console.error(getErrorData(error))
		setError("Something went wrong")
	}
}

const toggleCapability = (index: number) => {
	const cap = capabilities.value[index]
	if (cap.isNew) cap.selected = !cap.selected
}

const selectAccount = (account: UIAccount) => {
	if (processingError.value?.type === "warning") clearError()
	const idx = selectedAccounts.value.findIndex((acc) => acc.address === account.address)
	if (idx < 0) selectedAccounts.value.push(account)
	else selectedAccounts.value.splice(idx, 1)
}

const isAccountSelected = (account: UIAccount) => selectedAccounts.value.some((acc) => acc.address === account.address)

/** Riders are excluded here: the authwit rider's `capability` IS the accounts
 *  cap, which is pushed separately below — including riders would grant
 *  accounts twice (and bypass the account picker's own selected-accounts gate). */
const buildGrantedCaps = (): Capability[] => {
	const approvedNew = capabilities.value.filter((c) => c.isNew && c.selected && !c.authwitRider).map((c) => c.capability)
	const existing = capabilities.value.filter((c) => !c.isNew).map((c) => c.capability)

	const granted: Capability[] = [...approvedNew, ...existing]
	if (needsAccountSelection.value && selectedAccounts.value.length > 0) {
		const delta = payload.value!.params.delta as Capability[]
		const accountsCap = delta.find((cap) => cap.type === "accounts")
		if (accountsCap) granted.push(buildGrantedAccountsCap(accountsCap, capabilities.value))
	}
	return granted
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
	// Defense in depth: template's `:disabled="!initComplete"` should already
	// block this, but if Enter / programmatic click slips through during init,
	// throw loudly instead of silently no-opping (which was the 19-iteration
	// failure mode in the discover popup). Codex audit-final-merge HIGH #1.
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
	try {
		isLoading.value = true
		const granted = buildGrantedCaps()
		const selection = buildAccountSelectionResult()

		await interactionService.resolveInteraction(requestId.value!, {
			granted,
			selectedAccounts: selection.selectedAccounts,
			accountAliases: selection.accountAliases,
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
	const target = dappChain.value.network
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
				:actionLabel="`is requesting permissions on ${dappChain.name}`"
			/>

			<Flex direction="column" gap="20" :class="$style.sections">
				<Banner
					v-if="chainBannerState"
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
						Your wallet is on {{ appStore.network?.name }}. Approve as is, or switch to see {{ dappChain.name }} balances.
					</template>
				</Banner>

				<Flex v-if="needsAccountSelection" direction="column" gap="10" wide>
					<SectionLabel label="Select accounts to share" :count="availableAccounts.length" />

					<ItemsContainer>
						<AccountSelectRow
							v-for="acc in availableAccounts"
							:key="acc.address"
							:account="acc"
							:selected="isAccountSelected(acc)"
							:alias="accountAliases[formatCaipAccount(acc.chainId, acc.address)]"
							:disabled="isLoading || processingError?.type === 'error'"
							@toggle="selectAccount(acc)"
							@updateAlias="(caip: string, val: string) => (accountAliases[caip] = val)"
						/>
					</ItemsContainer>
				</Flex>

				<Flex v-if="capabilities.filter(c => c.isNew).length" direction="column" gap="10" wide>
					<SectionLabel label="New permissions requested" :count="capabilities.filter(c => c.isNew).length" />

					<Flex direction="column" gap="6" wide>
						<CapabilityCard
							v-for="(cap, i) in capabilities"
							v-show="cap.isNew"
							:key="`new-${i}`"
							:capability="cap.capability"
							:label="cap.label"
							:description="cap.description"
							:risk="cap.risk"
							:selected="cap.selected"
							:granted="false"
							:expanded="expandedCards.has(i)"
							:reRequested="cap.reRequested"
							:isUnknown="cap.isUnknown"
							:disabled="isLoading || processingError?.type === 'error'"
							@toggleExpanded="toggleExpand(i)"
							@toggleSelected="toggleCapability(i)"
						/>
					</Flex>
				</Flex>

				<Flex v-if="capabilities.filter(c => !c.isNew).length" direction="column" gap="10" wide>
					<SectionLabel label="Already granted" :count="capabilities.filter(c => !c.isNew).length" />

					<Flex direction="column" gap="6" wide>
						<CapabilityCard
							v-for="(cap, i) in capabilities"
							v-show="!cap.isNew"
							:key="`existing-${i}`"
							:capability="cap.capability"
							:label="cap.label"
							:description="cap.description"
							:risk="cap.risk"
							:selected="cap.selected"
							granted
							:expanded="expandedCards.has(i)"
							:isUnknown="cap.isUnknown"
							@toggleExpanded="toggleExpand(i)"
						/>
					</Flex>
				</Flex>
			</Flex>
		</Flex>

		<DappApprovalFooter
			:processing-error="processingError"
			wide-tooltip
			reject-testid="cap-reject-btn"
			reject-label="Reject"
			:reject-disabled="isLoading || isSwitching || !requestId"
			confirm-testid="cap-approve-btn"
			confirm-label="Approve"
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
	overflow: hidden;
	flex: 1;

	display: flex;
	flex-direction: column;

	background: var(--app-bg);
	border-top: 2px solid var(--nulo-accent);
}

.scroll_area {
	flex: 1;
	min-height: 0;
	overflow: auto;
	scrollbar-gutter: stable;
}

.sections {
	padding: 16px;
}

</style>
