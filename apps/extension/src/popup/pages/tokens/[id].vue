<route lang="json">
{
	"meta": {
		"isAuthRequired": true,
		"showBottomNav": true
	}
}
</route>

<script setup>
/** Components */
import BalanceView from "../../components/modules/general/BalanceView.vue"
import RecentActivityView from "../../components/modules/general/RecentActivityView.vue"
import SubPageHeader from "@/components/ui/SubPageHeader.vue"
import { Dropdown } from "@/components/ui/Dropdown"

/** Vendor */
import { DateTime } from "luxon"

/** Services */
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import { TokenServiceClient } from "@/wallet/services/token/client"

/** Composables */
import { useToast } from "@/composables/toast.js"
const { openToast } = useToast()

/** Utils */
import { copyToClipboard } from "@/utils/clipboard"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const route = useRoute()
const router = useRouter()

const token = ref()
const tokenBalance = ref()
const isRefreshingBalance = ref(false)

const tokenService = new TokenServiceClient()
tokenService.onTokenDeleted.add(onTokenDeleted)
function onTokenDeleted(t) {
	if (t.id === token.value?.id) {
		router.push("/popup/general")
	}
}

const tokenBalanceService = new TokenBalanceServiceClient()
tokenBalanceService.onTokenBalanceUpdated.add(onBalanceUpdated)
function onBalanceUpdated(tb) {
	if (tb.id !== tokenBalance.value?.id) return
	tokenBalance.value = tb
}

/** Read the currently-cached balance for this (token, account). Fast path
 *  for first paint — the actual refresh is fired separately via `scheduleRefresh()`. */
async function readCurrentTokenBalance() {
	if (!token.value || !appStore.account?.address) return
	tokenBalance.value = (await tokenBalanceService.getTokenBalances(token.value.id, appStore.account.address))?.at(0)
}

/** Fire-and-forget refresh. `refreshTokenBalance` enqueues a balance job
 *  on the 1s-tick projector queue and returns immediately; the actual
 *  projection result arrives via `onTokenBalanceUpdated` (subscribed above).
 *  Don't await — awaiting only confirms enqueue, not freshness. */
function scheduleRefresh() {
	if (!tokenBalance.value?.id) return
	void tokenBalanceService.refreshTokenBalance(tokenBalance.value.id)
}

watch(
	() => token.value,
	async () => {
		if (token.value) {
			cacheStore.activeTokenIdx = token.value?.id
			await readCurrentTokenBalance()
			scheduleRefresh()
		}
	},
)

watch(
	() => appStore.account,
	async () => {
		await readCurrentTokenBalance()
		if (!tokenBalance.value) {
			cacheStore.activeTokenIdx = null
			router.push("/popup/general")
			return
		}
		scheduleRefresh()
	},
)

/** Trailing actions */
const handleRefreshBalance = () => scheduleRefresh()

const handleCopy = (value, label) => {
	void copyToClipboard(value, openToast, {
		success: { label: `${label} is copied` },
		failure: { label: "Couldn't copy", icon: "warning", duration: 3_000 },
	})
}

const handleDeleteToken = () => {
	cacheStore.confirm.description = "Removing a token only affects the display in the UI and it does not affect the token balance"
	cacheStore.confirm.callback = async () => {
		await tokenService.deleteToken(token.value.id)
		router.push("/popup/general")
		openToast({ label: "Token successfully deleted" })
	}
	popupStore.open("confirm")
}

onMounted(async () => {
	token.value = await tokenService.getToken(route.params.id)
	if (!token.value) {
		router.push("/popup/general")
		return
	}
	// Auto-fire balance refresh on entry. The page-mount fast path reads the
	// cached value above for instant render; this kicks the async projector
	// so the fresh balance arrives via onTokenBalanceUpdated (subscribed at
	// line 52) within ~1-3s under normal load — no manual Refresh click
	// needed. Removes the e2e helper waitForTokenDetailBalances workaround.
	await readCurrentTokenBalance()
	scheduleRefresh()
})

onBeforeUnmount(() => {
	tokenService.disconnect()
	tokenBalanceService.disconnect()
	cacheStore.activeTokenIdx = null
})
</script>

<template>
	<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper">
		<SubPageHeader
			:title="token?.symbol || ''"
			:backTo="'/popup/general'"
			leadingIcon="account_balance_wallet"
		>
			<template #trailing>
				<Tooltip position="end" :disabled="isRefreshingBalance || !tokenBalance?.updatedAt">
					<button
						@click="handleRefreshBalance"
						type="button"
						:disabled="isRefreshingBalance"
						:class="$style.icon_btn"
						aria-label="Refresh balance"
					>
						<MaterialIcon name="refresh" :size="18" color="secondary" />
					</button>

					<template #content>
						<Text color="secondary">Latest balance refresh - </Text>
						<Text>{{ DateTime.fromSeconds(tokenBalance?.updatedAt / 1_000).toRelative({ locale: "en" }) }}</Text>
					</template>
				</Tooltip>

				<Dropdown>
					<button type="button" :class="$style.icon_btn" aria-label="Token actions">
						<MaterialIcon name="more_vert" :size="18" color="secondary" />
					</button>

					<template #popup>
						<DropdownItem @click="handleCopy(token?.contract, 'Token address')">
							<Flex align="center" gap="8">
								<Icon name="copy" size="14" color="primary" />
								Copy address
							</Flex>
						</DropdownItem>
						<DropdownItem @click="popupStore.open('token_metadata')">
							<Flex align="center" gap="8">
								<Icon name="code-circle" size="14" color="primary" />
								Show metadata
							</Flex>
						</DropdownItem>
						<DropdownItem
							@click="router.push('/popup/settings/contacts')"
							data-testid="token-manage-contacts"
						>
							<Flex align="center" gap="8">
								<Icon name="user" size="14" color="primary" />
								Manage contacts
							</Flex>
						</DropdownItem>
						<DropdownDivider />
						<DropdownItem @click="handleDeleteToken" :class="$style.hover_red">
							<Flex align="center" gap="8">
								<Icon name="trash" size="14" color="primary" />
								<Text>Remove token</Text>
							</Flex>
						</DropdownItem>
					</template>
				</Dropdown>
			</template>
		</SubPageHeader>

		<BalanceView :tokenBalance />

		<Flex direction="column" justify="between" :class="$style.content">
			<Flex direction="column" gap="32">
				<Banner v-if="!token?.hasPublicTransfers && !token?.hasPrivateTransfers" variant="warning">
					Private and public transfers disabled
				</Banner>

				<RecentActivityView :token />
			</Flex>
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
	flex: 1;
	padding: 24px 24px var(--nav-clearance) 24px;
}

.icon_btn {
	display: flex;
	align-items: center;
	justify-content: center;

	width: 32px;
	height: 32px;

	background: transparent;
	border: none;
	cursor: pointer;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: color-mix(in srgb, var(--nulo-accent) 8%, transparent);
	}

	&:disabled {
		opacity: 0.5;
		pointer-events: none;
	}
}

.hover_red {
	& svg,
	& span {
		transition: all 0.2s var(--bezier);
	}

	&:hover {
		svg { fill: var(--red); }
		span { color: var(--red); }
	}
}
</style>
