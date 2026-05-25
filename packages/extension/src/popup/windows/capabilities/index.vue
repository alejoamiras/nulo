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
import { getCapabilityInfo } from "./capability-meta"

/** Services */
import { type ProfileInfo, ProfileServiceClient } from "@/wallet/services/profile/client"
import type { DappMetadata } from "@/wallet/services/dapp-session/client"
import { type CapabilityPayload, DappInteractionServiceClient } from "@/wallet/services/dapp-interaction/client"
import type { Capability } from "@nulo/wallet-bridge"

/** Composables */
import { useDappInteractionPayload } from "@/composables/useDappInteractionPayload"
import { useDappHostname } from "@/composables/useDappHostname"

type UIDappMetadata = DappMetadata & { loadingLogo?: boolean; logoBlobUrl?: string }
type UIAccount = { address: string; name: string; chainId: number }
type UICapability = {
	capability: Capability
	label: string
	description: string
	isNew: boolean
	selected: boolean
	risk: "low" | "medium" | "high"
	reRequested: boolean
}
type UIError = { title: string; tooltip: string; type: string }

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const router = useRouter()

const profile = ref<ProfileInfo>()
const capabilities = ref<UICapability[]>([])

const needsAccountSelection = ref(false)
const availableAccounts = ref<UIAccount[]>([])
const selectedAccounts = ref<UIAccount[]>([])
const accountAliases = ref<Record<string, string>>({})

const isLoading = ref(false)
const processingError = ref<UIError>()
const expandedCards = ref(new Set<number>())

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

const stripStatus = computed<"ready" | "loading" | "cancelled">(() => {
	if (isInteractionCancelled.value) return "cancelled"
	if (isLoading.value) return "loading"
	return "ready"
})

function setError(title: string, tooltip: string = title, type: string = "error") {
	processingError.value = { title, tooltip, type }
}
function clearError() {
	processingError.value = undefined
}

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
			} else {
				const { openToast } = useToast()
				openToast({ label: "No accounts available for this network. Create one first.", icon: "info" }, TOAST_DURATION.LONG)
			}
		}

		const items: UICapability[] = []
		const reRequestedTypes = new Set(payload.value.params.reRequested ?? [])
		const existingGrants = payload.value.params.existingGrants as Capability[]

		for (const cap of delta) {
			if (cap.type === "accounts") continue
			const info = getCapabilityInfo(cap.type)
			items.push({
				capability: cap,
				label: info.label,
				description: info.description,
				isNew: true,
				selected: true,
				risk: info.risk,
				reRequested: reRequestedTypes.has(cap.type),
			})
		}

		for (const cap of existingGrants) {
			const info = getCapabilityInfo(cap.type)
			items.push({
				capability: cap,
				label: info.label,
				description: info.description,
				isNew: false,
				selected: true,
				risk: info.risk,
				reRequested: false,
			})
		}

		capabilities.value = items
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

const onActiveProfileChanged = (_profile?: ProfileInfo) => {
	if (!_profile || _profile.id !== profile.value?.id) reject()
}

const approve = async () => {
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

const closeWindow = (interactionCompleted?: boolean) => {
	if (interactionCompleted) window.removeEventListener("beforeunload", reject)
	chrome.windows.getCurrent(undefined, (window) => {
		if (window.id) chrome.windows.remove(window.id)
	})
}

const profileService = new ProfileServiceClient()
profileService.onActiveProfileChanged.add(onActiveProfileChanged)

onMounted(async () => {
	profileService.connect()
	interactionService.connect()

	if (!appStore.isSessionChecked) {
		await new Promise<void>((resolve) => {
			const stop = watch(
				() => appStore.isSessionChecked,
				(checked) => {
					if (checked) {
						stop()
						resolve()
					}
				},
				{ immediate: true },
			)
		})
	}

	if (!appStore.isLogined) {
		appStore.pageAwaitingAuth = router.currentRoute.value.fullPath
		router.push({ path: "/popup/auth" })
		return
	}

	await init()
	window.addEventListener("beforeunload", reject)
})

onUnmounted(() => {
	profileService.disconnect()
	interactionService.disconnect()
	window.removeEventListener("beforeunload", reject)
})
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
				actionLabel="is requesting access to Nulo"
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
					<SectionLabel label="New capabilities requested" :count="capabilities.filter(c => c.isNew).length" />

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
					:disabled="processingError?.type === 'error' || !requestId"
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
