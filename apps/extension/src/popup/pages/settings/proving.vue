<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Services */
import { ExecutionServiceClient } from "@/wallet/services/execution/client"

/** Composables */
import { usePrestoStatus } from "@/composables/usePrestoStatus"

/** Utils */
import { PRESTO_SITE_URL } from "@/presto/config"
import { copyFor, detailRowsFor } from "@/utils/presto-ui-state"

const { state, detect, dispose } = usePrestoStatus()

const lastProve = ref(null)
const copy = computed(() => copyFor(state.value, lastProve.value, "settings"))
const rows = computed(() => detailRowsFor(state.value))
const diagnosis = computed(() => (state.value.kind === "secure-connection-unavailable" ? state.value.diagnosis : undefined))

const executionService = new ExecutionServiceClient()

function retry() {
	void detect({ forceRefresh: true })
}

onBeforeMount(async () => {
	try {
		lastProve.value = await executionService.getLastProveOutcome()
	} catch {
		// Health alone still renders; only the denied overlay needs the SW's memory.
		lastProve.value = null
	}
})

onBeforeUnmount(() => {
	executionService.disconnect()
	dispose()
})
</script>

<template>
	<SettingsPageShell title="Proving" backTo="/popup/settings" gap="24">
		<PrestoStatusCard
			compact
			:copy="copy"
			:status="state.kind"
			:diagnosis="diagnosis"
			testid="settings-proving-status"
			retryTestid="settings-proving-retry"
			@retry="retry"
		/>

		<ItemsContainer v-if="state.kind === 'offline'" title="Presto">
			<SettingItem
				:to="PRESTO_SITE_URL"
				title="Get Presto"
				description="presto.build · free, open source"
				materialIcon="download"
				external
				data-testid="settings-proving-get"
			/>
		</ItemsContainer>
		<ItemsContainer v-else title="Details">
			<SettingItem v-for="row in rows" :key="row.title" :title="row.title" :description="row.description" :materialIcon="row.icon" raw>
				<template #right>
					<Text size="13" weight="600" color="primary">{{ row.value }}</Text>
				</template>
			</SettingItem>
		</ItemsContainer>

		<Text size="12" weight="500" color="support" height="150">
			Proofs are always generated on your machine. Presto runs them natively; without it, Nulo proves inside the
			browser, which is slower.
		</Text>
	</SettingsPageShell>
</template>
