<script setup lang="ts">
/** Vendor */
import { onMounted, onUnmounted } from "vue"

/** Components */
import DappStatusStrip from "@/components/composite/DappStatusStrip.vue"
import DappIdentityBlock from "@/components/composite/DappIdentityBlock.vue"
import DappCancelledOverlay from "@/components/composite/DappCancelledOverlay.vue"
import CapabilityCard from "./CapabilityCard.vue"
import AccountSelectRow from "./AccountSelectRow.vue"

/** Utils */
import { getErrorData } from "@nulo/wallet-core/utils"
import { formatCaipAccount } from "@/wallet/utils/caip"
import { buildCapabilityItems, type UICapabilityItem } from "./build-items"

/** Services */
import { type ProfileInfo, ProfileServiceClient } from "@/wallet/services/profile/client"
import type { DappMetadata } from "@/wallet/services/dapp-session/client"
import { type CapabilityPayload, DappInteractionServiceClient } from "@/wallet/services/dapp-interaction/client"
import type { Capability } from "@nulo/wallet-bridge"

/** Composables */
import { useDappInteractionPayload } from "@/composables/useDappInteractionPayload"
import { useDappHostname } from "@/composables/useDappHostname"
import { useDappApprovalWindow } from "@/composables/useDappApprovalWindow"

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
				// Accounts requested but none exist on this chain. Mark the
				// popup as blocked — approving here would silently grant the
				// dApp a session with no accounts and every later op would
				// fail with a confusing "No accounts authorized" error. The
				// surface-level cause is usually a chain-info mismatch
				// (dApp sending Fr.ZERO that resolves to the wallet's Local
				// Network seed). Surface an actionable error directly.
				noAccountsAvailable.value = true
				setError(
					"No accounts on this chain",
					"This dApp is asking for accounts on a chain where you have none. " +
						"Either switch the wallet's active network or ask the dApp to pin the right chain.",
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

const approve = async () => {
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
		const approvedNew = capabilities.value.filter((c) => c.isNew && c.selected).map((c) => c.capability)
		const existing = capabilities.value.filter((c) => !c.isNew).map((c) => c.capability)

		const granted: Capability[] = [...approvedNew, ...existing]
		if (needsAccountSelection.value && selectedAccounts.value.length > 0) {
			const delta = payload.value!.params.delta as Capability[]
			const accountsCap = delta.find((cap) => cap.type === "accounts")
			if (accountsCap) granted.push(accountsCap)
		}

		let resultSelectedAccounts: string[] | undefined
		let resultAliases: Record<string, string> | undefined
		if (needsAccountSelection.value && selectedAccounts.value.length > 0) {
			resultSelectedAccounts = selectedAccounts.value.map((acc) => formatCaipAccount(acc.chainId, acc.address))
			resultAliases = {}
			for (const acc of selectedAccounts.value) {
				const caip = formatCaipAccount(acc.chainId, acc.address)
				resultAliases[caip] = accountAliases.value[caip] || acc.name
			}
		}

		await interactionService.resolveInteraction(requestId.value!, {
			granted,
			selectedAccounts: resultSelectedAccounts,
			accountAliases: resultAliases,
		})
		closeWindow(true)
	} catch (error) {
		console.error(getErrorData(error))
		setError("Something went wrong")
	} finally {
		isLoading.value = false
	}
}

const reject = async () => {
	if (isInteractionCancelled.value) return
	rejectViaInteractionService("User rejected")
	closeWindow(true)
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
				actionLabel="is requesting permissions"
			/>

			<Flex direction="column" gap="20" :class="$style.sections">
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

		<Flex direction="column" gap="10" :class="$style.footer">
			<Tooltip v-if="processingError" side="top" position="start" wide :disabled="!processingError.tooltip">
				<Flex align="center" wide gap="6">
					<Icon name="info" size="14" :color="processingError.type === 'warning' ? 'orange' : 'red'" />
					<Text data-testid="error-text" role="alert" size="12" weight="600" color="secondary">{{ processingError.title }}</Text>
				</Flex>

				<template #content>
					<Text size="12" color="secondary">{{ processingError.tooltip }}</Text>
				</template>
			</Tooltip>

			<Flex align="center" justify="between" gap="12">
				<Button
					data-testid="cap-reject-btn"
					@click="reject"
					wide
					variant="primary_outline"
					size="medium"
					:disabled="isLoading || !requestId"
				>
					Reject
				</Button>

				<Button
					data-testid="cap-approve-btn"
					@click="approve"
					wide
					variant="primary"
					size="medium"
					:loading="isLoading"
					:disabled="processingError?.type === 'error' || !initComplete"
				>
					<Text size="13" color="inverse">Approve</Text>
				</Button>
			</Flex>
		</Flex>

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

.footer {
	flex-shrink: 0;

	padding: 16px;
	border-top: 1px solid var(--nulo-border);
	background: var(--nulo-surface);
}
</style>
