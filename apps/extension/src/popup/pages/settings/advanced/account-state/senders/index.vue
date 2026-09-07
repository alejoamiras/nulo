<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Components */

/** Services */
import { AccountStateServiceClient } from "@/wallet/services/account-state/client"

/** Composables */
import { useToast } from "@/composables/toast"
import { useEntityCrud } from "@/composables/useEntityCrud"
const { openToast } = useToast()

/** Utils */
import { copyWithToast } from "@/utils/clipboard"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
import { useCacheStore } from "@/stores/cache.store"
const appStore = useAppStore()
const popupStore = usePopupStore()
const cacheStore = useCacheStore()

const copiedAddress = ref("")
const accountStateClientService = new AccountStateServiceClient()

// Senders are bare address strings, not entities with an id; identity is the
// value itself. Network is watched separately because senders are scoped per
// network — the composable exposes `refresh` for that.
const {
	entities: senders,
	isLoading,
	error,
	refresh: fetchSenders,
} = useEntityCrud({
	fetch: () => (appStore.network ? accountStateClientService.getSenders(appStore.network.id) : Promise.resolve([])),
	added: accountStateClientService.onSenderAdded,
	deleted: accountStateClientService.onSenderDeleted,
	identity: (s) => s,
	// The event payload is a bare address with no scope to filter on —
	// re-fetch the network-scoped list instead of splicing blind.
	mode: "resync",
})

// A profile/network switch emits no sender events and this route is not
// remounted — refetch explicitly; the composable's fetch sequence retires
// stale fetches.
watch(
	() => [appStore.profile?.id, appStore.network?.id],
	() => void fetchSenders({ clear: true }),
)

const handleCopyAddress = (address) => {
	copiedAddress.value = address

	void copyWithToast(address, openToast, "Sender's address is copied")

	setTimeout(() => {
		copiedAddress.value = ""
	}, 2_000)
}

const handleDelete = (sender) => {
	cacheStore.confirm.confirm_color = "red"
	cacheStore.confirm.confirm_text = "Yes, delete sender"
	cacheStore.confirm.title = "Delete this sender?"
	cacheStore.confirm.description =
		"Most transfers are detected automatically; removing a sender only affects transfers delivered with address-derived tagging"
	cacheStore.confirm.callback = async () => {
		await accountStateClientService.deleteSender(appStore.network.id, sender)

		openToast({ label: "Sender successfully deleted" })
	}

	popupStore.open("confirm")
}

watch(
	() => appStore.network,
	() => {
		if (appStore.network) fetchSenders()
	},
)
onBeforeUnmount(() => {
	accountStateClientService.disconnect()
})
</script>

<template>
	<SettingsPageShell title="Senders" :backTo="'/popup/settings/advanced/account-state'" gap="16">
		<AsyncListStatus v-if="isLoading || error" :loading="isLoading" :error="error" label="FETCHING SENDERS" @retry="fetchSenders()" />

		<Flex v-else-if="senders.length" direction="column" gap="8">
			<Flex v-for="sender in senders" justify="between" :class="$style.card" data-testid="sender-row" :data-sender-address="sender">
				<Flex align="center" gap="10">
					<Icon name="user" size="16" color="tertiary" />

					<AddressDisplay @onAddressClick="handleCopyAddress(sender)" size="14" weight="600" color="secondary" :address="sender" :formatter="(addr) => trimAddress(addr, 8, 8)" />
					<!-- <Text @click="handleCopyAddress(sender)" size="14" weight="600" color="secondary"> {{ trimAddress(sender, 8, 8) }} </Text> -->
				</Flex>

				<Flex align="center" gap="8">
					<Tooltip position="end" delay="350">
						<Icon
							v-if="copiedAddress !== sender"
							@click.stop="handleCopyAddress(sender)"
							name="copy"
							size="14"
							color="tertiary"
							:class="$style.icon_btn"
						/>
						<Icon
							v-else-if="copiedAddress === sender"
							name="check-circle"
							size="14"
							color="green"
							:style="{ transition: 'all 0.2s ease' }"
						/>

						<template #content> Copy address </template>
					</Tooltip>
					<Tooltip position="end" delay="350">
						<Icon
							@click.stop="handleDelete(sender)"
							name="close-circle"
							size="14"
							color="tertiary"
							:class="$style.icon_btn"
							data-testid="sender-delete"
						/>

						<template #content> Delete sender </template>
					</Tooltip>
				</Flex>
			</Flex>
		</Flex>

		<ListStatusMessage
			v-else
			headline="NO SENDERS YET"
			sub="Most transfers are detected automatically. Add a sender only for transfers delivered with address-derived tagging."
		/>

		<Button @click="popupStore.open('new_sender')" wide variant="primary" size="large" data-testid="senders-add-btn">
			Add sender
		</Button>
	</SettingsPageShell>
</template>

<style module>
.card {
	border-radius: 0;
	border: 1px solid var(--nulo-border);

	padding: 12px;

	transition: all 0.2s var(--bezier);

	&:hover {
		border-color: var(--nulo-outline);
		span {
			color: var(--txt-primary);
			cursor: pointer;
		}
	}
}

.icon_btn {
	cursor: pointer;

	transition: all 0.2s var(--bezier);

	&:hover {
		fill: var(--txt-primary);
	}
}

</style>
