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
import { TokenServiceClient } from "@/wallet/services/token/client"

/** Utils */
import { stringCompare } from "@/utils/string"

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

const tokenService = new TokenServiceClient()
const { entities: tokens, refresh: refreshTokens } = useEntityCrud({
	fetch: () => tokenService.getTokens(appStore.profile.id, appStore.network.chainId),
	added: tokenService.onTokenAdded,
	deleted: tokenService.onTokenDeleted,
	// TokenInfo carries no profileId (it crosses the dApp boundary), so no
	// accept predicate can anchor an event to this list's profile+chain scope —
	// resync re-reads through the scoped fetch instead, which is always correct
	// (the senders list set the precedent for payloads without scope fields).
	mode: "resync",
})

// A profile/network switch emits no token events and this route is not
// remounted — refetch under the new scope explicitly; the composable's fetch
// sequence makes any in-flight stale fetch stand down instead of installing.
watch(
	() => [appStore.profile?.id, appStore.network?.chainId],
	() => void refreshTokens({ clear: true }),
)

const handleDelete = (target) => {
	cacheStore.confirm.confirm_color = "red"
	cacheStore.confirm.confirm_text = "Yes, delete token"
	cacheStore.confirm.title = "Remove this token?"
	cacheStore.confirm.description = "Removing a token only affects the display in the interface and it does not affect the token balance"
	cacheStore.confirm.callback = async () => {
		await tokenService.deleteToken(target.id)
		openToast({ label: "Token successfully deleted" })
	}

	popupStore.open("confirm")
}

watch(
	() => tokens.value.length,
	() => {
		tokens.value = [...tokens.value].sort((a, b) => stringCompare(a.name, b.name))
	},
)

onBeforeUnmount(() => {
	tokenService.disconnect()
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="Manage Tokens" :backTo="'/popup/settings'" />

		<Flex direction="column" gap="16" :class="$style.content">
			<SectionLabel label="Tokens" :count="tokens.length" />

			<ItemsContainer v-if="tokens.length">
				<SettingItem
					v-for="token in tokens"
					:title="token.symbol"
					:description="token.name"
					icon="banknote"
					raw
					data-testid="token-row"
				>
					<template #right>
						<Flex align="center" gap="8">
							<Tooltip position="end" delay="350">
								<Icon
									v-if="appStore.networks.length > 1"
									@click.stop="handleDelete(token)"
									name="close-circle"
									size="14"
									color="tertiary"
									data-testid="token-delete"
									:class="$style.icon_btn"
								/>

								<template #content> Delete token </template>
							</Tooltip>
						</Flex>
					</template>
				</SettingItem>
			</ItemsContainer>

			<ListStatusMessage v-else headline="NO TOKENS YET" sub="Import tokens to track balances and send or receive." />

			<Button @click="popupStore.open('new_token')" wide variant="primary" size="large" data-testid="token-import-btn">
				Import token
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

.icon_btn {
	cursor: pointer;

	transition: all 0.2s var(--bezier);

	&:hover {
		fill: var(--txt-primary);
	}
}



</style>
