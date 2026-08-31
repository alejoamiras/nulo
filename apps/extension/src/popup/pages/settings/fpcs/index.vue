<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Services */
import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"

/** Utils */
import { stringCompare } from "@/utils/string"
import { copyToClipboard } from "@/utils/clipboard"
import { UI_STORAGE_KEYS } from "@/popup/constants/storage-keys"
import { storageLocalGet, storageLocalSet } from "@/utils/storage"

/** Composables */
import { useToast } from "@/composables/toast"
import { useEntityCrud } from "@/composables/useEntityCrud"

/** Components */
import FpcRow from "@/popup/components/modules/settings/fpcs/FpcRow.vue"

/** Helpers */
import { fpcSortOrder, isSyntheticRow, prepareFpc, PUBLIC_FJ_ROW } from "@/popup/components/modules/settings/fpcs/fpc-helpers"

const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const FEE_METHOD_LS_KEY = UI_STORAGE_KEYS.FEE_PAYMENT_METHODS

/** Service clients */
const fpcService = new FpcServiceClient()

const {
	entities: rawFpcs,
	isLoading,
	error,
	refresh: refreshFpcs,
} = useEntityCrud({
	fetch: () => fpcService.getFpcs(appStore.network.chainId),
	added: fpcService.onFpcAdded,
	updated: fpcService.onFpcUpdated,
	deleted: fpcService.onFpcDeleted,
	// Events are global; the list is chain-scoped — a mid-switch add/update
	// for another chain must not render here.
	accept: (f) => f.chainId === appStore.network?.chainId,
})

const fpcs = computed(() =>
	rawFpcs.value
		?.map((f) => prepareFpc(f))
		.sort((a, b) => {
			const order = fpcSortOrder(a) - fpcSortOrder(b)
			return order || stringCompare(a.name, b.name)
		}),
)

/** Always render the synthetic Public Fee Juice anchor first; storage-backed
 * rows follow. The synthetic row never reaches handleEdit/handleDelete since
 * FpcRow gates emits behind the synthetic prop. */
const displayedRows = computed(() => [PUBLIC_FJ_ROW, ...(fpcs.value ?? [])])

/** Handlers */
const handleCopyAddress = (address) => {
	void copyToClipboard(address, openToast, {
		success: { label: "FPC's address is copied" },
		failure: { label: "Couldn't copy", icon: "warning", duration: 3_000 },
	})
}

const handleEdit = (fpc) => {
	cacheStore.fpcToEditIdx = fpc.id
	popupStore.open("edit_fpc")
}

const handleDelete = (fpc) => {
	cacheStore.confirm.confirm_text = "Yes, delete FPC"
	cacheStore.confirm.confirm_color = "red"
	cacheStore.confirm.title = "Delete this FPC?"
	cacheStore.confirm.description = "By confirming this action, the selected FPC will be permanently deleted from your wallet"
	cacheStore.confirm.callback = async () => {
		await fpcService.deleteFpc(fpc.id)

		const fpms = (await storageLocalGet(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}
		if (Object.keys(fpms).length) {
			for (const [account, data] of Object.entries(fpms)) {
				if (data.fpc?.id === fpc.id) {
					delete fpms[account]
				}
			}
			await storageLocalSet({ [FEE_METHOD_LS_KEY]: fpms })
		}

		openToast({ label: "FPC is deleted" })
	}
	popupStore.open("confirm")
}

watch(
	() => [appStore.network, appStore.account],
	() => {
		if (appStore.network && appStore.account) {
			refreshFpcs()
		}
	},
)

onBeforeUnmount(() => {
	fpcService.disconnect()
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="Manage FPCs" :backTo="'/popup/settings'" />

		<Flex direction="column" gap="20" :class="$style.content">
			<!-- The synthetic Public Fee Juice anchor is hardcoded + network-
				independent, so the list (anchor first) always renders. Loading /
				error apply only to the storage/protocol-backed rows and show
				below — without this, no PXE (smoke / offline) left the whole list,
				including the always-present anchor, hidden behind the spinner. -->
			<Flex direction="column" gap="16">
				<SectionLabel label="FPCs" :count="displayedRows.length" />

				<ItemsContainer>
					<FpcRow
						v-for="row in displayedRows"
						:key="row.id"
						:fpc="row"
						:synthetic="isSyntheticRow(row) ? 'public-fj' : undefined"
						:protectedRow="!!row.isProtocol"
						:nonEditable="row.isProtocol && row.type === FpcType.PrivateFpc"
						@copyAddress="handleCopyAddress"
						@edit="handleEdit"
						@delete="handleDelete"
					/>
				</ItemsContainer>

				<LoadingState v-if="isLoading" label="FETCHING FPCS" />

				<Tooltip v-else-if="error" wide>
					<Banner :action="{ name: 'Try again', callback: () => refreshFpcs() }" variant="error" wide>
						Something went wrong
					</Banner>
					<template #content>{{ error }}</template>
				</Tooltip>
			</Flex>

			<Button @click="popupStore.open('new_fpc')" wide variant="primary" size="large" data-testid="fpc-new-btn">
				Add FPC
			</Button>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	background: var(--app-bg);
	scrollbar-gutter: stable;
}

.content {
	padding: 16px 24px var(--nav-clearance) 24px;
}
</style>
