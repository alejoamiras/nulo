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
})

const handleCopyAddress = (address) => {
	copiedAddress.value = address

	window.navigator.clipboard.writeText(address)
	openToast({ label: "Sender's address is copied", icon: "copy" })

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
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="Senders" :backTo="'/popup/settings/advanced/account-state'" />

		<Flex direction="column" gap="16" :class="$style.content">
			<LoadingState v-if="isLoading" label="FETCHING SENDERS" />

			<Tooltip v-else-if="error" wide>
				<Banner :action="{ name: 'Try again', callback: () => fetchSenders() }" variant="error" wide>
					Something went wrong
				</Banner>

				<template #content>
					{{ error }}
				</template>
			</Tooltip>

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

			<div v-else :class="$style.empty">
				<span :class="$style.empty_headline">NO SENDERS YET</span>
				<span :class="$style.empty_sub">Most transfers are detected automatically. Add a sender only for transfers delivered with address-derived tagging.</span>
			</div>

			<Button @click="popupStore.open('new_sender')" wide variant="primary" size="large" data-testid="senders-add-btn">
				Add sender
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

.empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;

	padding: 32px 16px;
	border: 1px dashed var(--nulo-border);

	text-align: center;
}

.empty_headline {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.empty_sub {
	width: 100%;

	font-family: var(--font-mono);
	font-size: 11px;
	line-height: 1.4;
	color: var(--nulo-outline);
	overflow-wrap: break-word;
}
</style>
