<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Components */

/** Utils */
import { AccountStateServiceClient } from "@/wallet/services/account-state/client"

/** Composables */
import { useToast } from "@/composables/toast.js"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const accountStateService = new AccountStateServiceClient()
const contracts = ref([])
const searchTerm = ref()
const filteredContracts = computed(() =>
	searchTerm.value ? contracts.value.filter((contract) => contract.includes(searchTerm.value?.toLowerCase())) : contracts.value,
)
const isFetchingContracts = ref(false)
const error = ref()
const isErrorOccurred = computed(() => !!error.value)
const fetchContracts = async (isRefetching) => {
	if (isRefetching) openToast({ label: "Fetching contracts again", icon: "zap" })
	isFetchingContracts.value = true

	try {
		contracts.value = await accountStateService.getContracts(appStore.network.id)
	} catch (err) {
		error.value = err
	} finally {
		isFetchingContracts.value = false
	}
}

watch(
	() => appStore.account,
	() => {
		fetchContracts()
	},
)

onMounted(async () => {
	if (appStore.network && appStore.isLogined) fetchContracts()
})

onBeforeUnmount(() => {
	accountStateService.disconnect()
})
</script>

<template>
	<SettingsPageShell title="Contracts" :backTo="'/popup/settings/advanced/account-state'" gap="16" v-if="appStore.isLogined">
		<AsyncListStatus v-if="isFetchingContracts || isErrorOccurred" :loading="isFetchingContracts" :error="error" label="FETCHING CONTRACTS" @retry="fetchContracts(true)" />

		<Flex v-else-if="contracts.length" direction="column" gap="8">
			<Input
				v-model="searchTerm"
				icon="search"
				placeholder="Search through contracts"
				clearable
				@clear="searchTerm = ''"
			/>

			<ListStatusMessage v-if="searchTerm && filteredContracts.length === 0" variant="no-results" />

			<Flex v-else v-for="contract in filteredContracts" justify="between" :class="$style.card">
				<Flex gap="10">
					<Icon name="zap" size="16" color="tertiary" />

					<Flex direction="column" gap="8">
						<Text size="14" weight="600" color="primary"> Contract </Text>
						<AddressDisplay size="13" weight="600" color="tertiary" :address="contract" :formatter="(addr) => trimAddress(addr, 6, 4)" />
					</Flex>
				</Flex>
			</Flex>
		</Flex>

		<ListStatusMessage v-else headline="NO CONTRACTS YET" sub="Contracts registered to your account will appear here." />
	</SettingsPageShell>
</template>

<style module>
.card {
	border-radius: 0;
	cursor: pointer;
	border: 1px solid var(--nulo-border);

	padding: 12px;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-low);
		border-color: var(--nulo-outline);

		& .icons {
			opacity: 1;
		}
	}

	&:active {
		background: var(--nulo-surface-high);
	}
}

</style>
