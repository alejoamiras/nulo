<script setup>
/** Components */
import ActionButtonsView from "./ActionButtonsView.vue"
import GasBalanceCard from "./GasBalanceCard.vue"
import { Dropdown } from "@/components/ui/Dropdown"

/** Vendor */
import { DateTime } from "luxon"

/** Services */
import { ContentKind } from "@/wallet/services/task/spec"
import { TaskServiceClient } from "@/wallet/services/task/client"
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import { TokenServiceClient } from "@/wallet/services/token/client"
import { PriceServiceClient } from "@/wallet/services/price/client"
import { ConfigServiceClient } from "@/wallet/services/config/client"

/** Utils */
import { balanceFormatted } from "@/utils/amount.js"
import { storageLocalGet, storageLocalSet } from "@/utils/storage"

/** Composables */
import { usePrices } from "@/composables/usePrices"
import { useToast } from "@/composables/toast.js"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
import { useCacheStore } from "@/stores/cache.store"
const appStore = useAppStore()
const popupStore = usePopupStore()
const cacheStore = useCacheStore()

const router = useRouter()

const props = defineProps({
	tokenBalance: {
		type: Object,
		required: false,
		default: null,
	},
})

const tokenBalances = ref([])

const tokenToDisplay = computed(
	() => props.tokenBalance?.token || tokenBalances.value.find((tb) => tb.token.id === appStore.displayOption)?.token,
)
const tokenBalanceToDisplay = computed(() => {
	return props.tokenBalance || tokenBalances.value.find((tb) => tb.token.id === tokenToDisplay.value?.id)
})
const showFullBalance = ref(false)
const totalTokenBalance = computed(() => {
	if (!tokenBalanceToDisplay.value) return { value: 0 }

	// Sum raw base units in bigint domain — no float pivot, no precision loss
	// even at 18 decimals.
	const decimals = tokenBalanceToDisplay.value?.token?.decimals || 0
	const publicRaw = BigInt(tokenBalanceToDisplay.value?.publicBalance || 0)
	const privateRaw = BigInt(tokenBalanceToDisplay.value?.privateBalance || 0)
	const totalRaw = publicRaw + privateRaw

	return balanceFormatted(totalRaw, decimals, showFullBalance.value ? undefined : 20)
})

const privateBalanceFormatted = computed(() => {
	if (!tokenBalanceToDisplay.value) return "0"
	const decimals = tokenBalanceToDisplay.value?.token?.decimals || 0
	return balanceFormatted(tokenBalanceToDisplay.value?.privateBalance || 0, decimals, 10).value
})
const publicBalanceFormatted = computed(() => {
	if (!tokenBalanceToDisplay.value) return "0"
	const decimals = tokenBalanceToDisplay.value?.token?.decimals || 0
	return balanceFormatted(tokenBalanceToDisplay.value?.publicBalance || 0, decimals, 10).value
})

const BalanceDisplayOptionsMap = {
	total_account_value: "Account Value",
	total_private_balances: "Private Account Value",
	total_public_balances: "Public Account Value",
}

/** Live prices (A1). Parent owns the client lifecycle; the composable owns
 *  freshness. Every fiat element below renders ONLY with a usable quote —
 *  no price means no dollar figure, never a fake $0.00. */
const priceService = new PriceServiceClient()
const prices = usePrices(priceService)

/** Fiat kill-switch state — with it OFF the aggregate slot is HIDDEN entirely
 *  (the space is reclaimed), not rendered as a dash. */
const showFiatValues = ref(true)
const configService = new ConfigServiceClient()
configService.onUpdate.add(onConfigUpdate)
function onConfigUpdate(prop) {
	if (prop.key === "showFiatValues") showFiatValues.value = prop.value !== false
}
configService.getValue("showFiatValues").then((v) => {
	showFiatValues.value = v !== false
})

const displayedRawTotal = computed(() => {
	if (!tokenBalanceToDisplay.value) return 0n
	return BigInt(tokenBalanceToDisplay.value?.publicBalance || 0) + BigInt(tokenBalanceToDisplay.value?.privateBalance || 0)
})

/** A1 secondary line for a selected token: `≈ $x.xx`, or undefined (hidden). */
const displayedTokenFiat = computed(() => {
	if (!tokenToDisplay.value) return undefined
	return prices.tokenFiatLabel(tokenToDisplay.value, displayedRawTotal.value)
})

/** Which balance sides the active aggregate option sums. */
const aggregateSides = computed(() => ({
	private: appStore.displayOption !== "total_public_balances",
	public: appStore.displayOption !== "total_private_balances",
}))

/** Real fiat aggregate over priced HOLDINGS: Σ balance × price (micro-USD).
 *  A zero-balance row is worth exactly $0.00 whether priced or not, so it
 *  counts as neither a holding nor a pricing gap — a registered-but-empty
 *  token must not flag the aggregate as partial. */
const aggregate = computed(() => {
	let micro = 0n
	let priced = 0
	let holdings = 0
	for (const tb of tokenBalances.value) {
		let raw = 0n
		if (aggregateSides.value.private) raw += BigInt(tb.privateBalance || 0)
		if (aggregateSides.value.public) raw += BigInt(tb.publicBalance || 0)
		if (raw === 0n) continue
		holdings += 1
		const value = prices.tokenFiatMicro(tb.token, raw)
		if (value === undefined) continue
		micro += value
		priced += 1
	}
	return { micro, priced, holdings }
})

/** Always a dollar figure — holdings that lack a price count as $0.00 and
 *  the "priced assets only" caption owns the honesty, never an em-dash. */
const aggregateFiatDisplay = computed(() => prices.formatUsdMicro(aggregate.value.micro))
const isAggregatePartial = computed(() => aggregate.value.priced < aggregate.value.holdings)

const isCopied = ref(false)
const handleCopy = (value, label) => {
	isCopied.value = true
	window.navigator.clipboard.writeText(value)
	openToast({ label: `${label} is copied`, icon: "copy" })
	setTimeout(() => {
		isCopied.value = false
	}, 2500)
}
const handleRefreshBalance = () => {
	tokenBalanceService.refreshTokenBalance(tokenBalanceToDisplay.value?.id)
}
const isRefreshingBalance = ref(false)

const handleTokenBalanceClick = async () => {
	let balance = totalTokenBalance.value?.value
	if (totalTokenBalance.value?.slashed || showFullBalance.value) {
		showFullBalance.value = !showFullBalance.value
		await nextTick()
		balance = totalTokenBalance.value?.value
	}

	handleCopy(balance, "Balance")
}

const taskService = new TaskServiceClient()
taskService.onTaskCreated.add(onTaskCreated)
taskService.onTaskUpdated.add(onTaskUpdated)
taskService.onTaskDeleted.add(onTaskDeleted)
function onTaskCreated(task) {
	switch (task.content.kind) {
		case ContentKind.BalanceUpdate:
			if (tokenBalanceToDisplay.value?.id !== task.content.tbId) return

			isRefreshingBalance.value = true

			break

		default:
			break
	}
}
function onTaskUpdated(task) {
	switch (task.content.kind) {
		case ContentKind.BalanceUpdate:
			if (!task.finishedAt) return
			if (tokenBalanceToDisplay.value?.id !== task.content.tbId) return

			isRefreshingBalance.value = false

			break

		default:
			break
	}
}
function onTaskDeleted(task) {
	switch (task.content.kind) {
		case ContentKind.BalanceUpdate:
			if (tokenBalanceToDisplay.value?.id !== task.content.tbId) return

			isRefreshingBalance.value = false

			break

		default:
			break
	}
}

const tokenBalanceService = new TokenBalanceServiceClient()
tokenBalanceService.onTokenBalanceAdded.add(onBalanceAdded)
tokenBalanceService.onTokenBalanceUpdated.add(onBalanceUpdated)
tokenBalanceService.onTokenBalanceDeleted.add(onBalanceDeleted)
function onBalanceAdded(tb) {
	if (tb.account !== appStore.account.address) return

	tokenBalances.value.push(tb)
}
function onBalanceUpdated(tb) {
	const idx = tokenBalances.value.findIndex((_tb) => _tb.id === tb.id)
	if (idx !== -1) {
		tokenBalances.value[idx] = tb
	}
}
function onBalanceDeleted(tb) {
	// tokenToDisplay is computed from tokenBalances, so the selected-token check
	// must read the pre-delete list — capture it BEFORE filtering, otherwise the
	// recompute returns undefined and the displayOption reset never fires
	// (deleting the displayed balance would leave the home view stuck on a stale
	// selection). Maintaining the list here also stops the deleted row lingering
	// until the next full fetch.
	const wasDisplayed = !props.tokenBalance && tokenToDisplay.value?.id === tb.token.id
	tokenBalances.value = tokenBalances.value.filter((_tb) => _tb.id !== tb.id)
	if (wasDisplayed) {
		appStore.displayOption = "total_account_value"
	}
}

const tokenService = new TokenServiceClient()
tokenService.onTokenDeleted.add(onTokenDeleted)
function onTokenDeleted(token) {
	if (!props.tokenBalance && tokenToDisplay.value?.id === token.id) {
		appStore.displayOption = "total_account_value"
	}
}

async function fetchTokenBalances() {
	tokenBalances.value = await tokenBalanceService.getTokenBalances(undefined, appStore.account?.address)
	isRefreshingBalance.value = (await taskService.getTasks()).some(
		(t) =>
			!t.finishedAt &&
			t.content.kind === ContentKind.BalanceUpdate &&
			t.content.account === appStore.account.address &&
			t.content.tbId === tokenBalanceToDisplay.value?.id,
	)
}

async function loadBalanceDisplayOption(profileId, networkId) {
	const key = `nulo:ui:balanceDisplayOption@${profileId}`

	const result = await storageLocalGet(key)
	const optionsMap = result[key] || {}

	let option = optionsMap[networkId]

	if (!option) {
		option = "total_account_value"
		optionsMap[networkId] = option
		await storageLocalSet({ [key]: optionsMap })
	}

	appStore.displayOption = option
}
async function saveBalanceDisplayOption(profileId, networkId, option) {
	const key = `nulo:ui:balanceDisplayOption@${profileId}`

	const result = await storageLocalGet(key)
	const optionsMap = result[key] || {}

	if (optionsMap[networkId] !== option) {
		optionsMap[networkId] = option
		await storageLocalSet({ [key]: optionsMap })
	}
}

watch(
	() => appStore.network,
	async () => {
		await loadBalanceDisplayOption(appStore.profile.id, appStore.network.id)
	},
)
watch(
	() => appStore.account,
	async () => {
		await fetchTokenBalances()
		if (!tokenToDisplay.value) {
			appStore.displayOption = "total_account_value"
		}
	},
)
watch(
	() => appStore.displayOption,
	async () => {
		await saveBalanceDisplayOption(appStore.profile.id, appStore.network.id, appStore.displayOption)
	},
)
onMounted(async () => {
	await fetchTokenBalances()

	await loadBalanceDisplayOption(appStore.profile.id, appStore.network.id)
})
onBeforeUnmount(() => {
	taskService.disconnect()
	tokenBalanceService.disconnect()
	tokenService.disconnect()
	prices.dispose()
	priceService.disconnect()
	configService.disconnect()
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<!-- Balance section -->
		<section :class="$style.balance_section">
			<div
				v-if="tokenToDisplay || showFiatValues"
				@click="handleTokenBalanceClick"
				data-testid="balance-amount"
				:class="[$style.balance_amount, isRefreshingBalance && $style.refreshing]"
			>
				<template v-if="tokenToDisplay">
					{{ totalTokenBalance.value }}
					<span :class="$style.balance_symbol">{{ tokenToDisplay?.symbol }}</span>
				</template>
				<template v-else>{{ aggregateFiatDisplay }}</template>
			</div>

			<div v-if="tokenToDisplay && displayedTokenFiat" data-testid="balance-fiat" :class="$style.fiat_line">
				{{ displayedTokenFiat }}
			</div>
			<div v-if="!tokenToDisplay && isAggregatePartial" data-testid="balance-fiat-partial" :class="$style.fiat_partial">
				priced assets only
			</div>

			<Flex v-if="tokenToDisplay" align="center" justify="center" gap="12" :class="$style.breakdown">
				<span :class="$style.breakdown_item">
					<span :class="$style.breakdown_private"><Icon name="lock" size="10" /></span> PRIVATE:
					<span data-testid="private-balance-value">{{ privateBalanceFormatted }}</span>
				</span>
				<span :class="$style.breakdown_divider">|</span>
				<span :class="$style.breakdown_item">
					<span :class="$style.breakdown_public"><Icon name="globe" size="10" /></span> PUBLIC:
					<span data-testid="public-balance-value">{{ publicBalanceFormatted }}</span>
				</span>
			</Flex>
		</section>

		<!-- Gas juice (home page only, not token detail) -->
		<GasBalanceCard v-if="!tokenBalance" />

		<!-- Action buttons -->
		<Flex :class="$style.actions">
			<ActionButtonsView :token="tokenBalance?.token" />
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	padding: 0 24px 24px 24px;
}

.balance_section {
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;

	margin-top: 32px;
	margin-bottom: 16px;
}

.balance_amount {
	font-family: var(--font-headline);
	font-size: 48px;
	font-weight: 700;
	letter-spacing: -0.04em;
	color: var(--txt-primary);
	cursor: pointer;

	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 100%;
}

.balance_symbol {
	font-size: 24px;
	color: var(--txt-tertiary);
}

@keyframes blink {
	0% { opacity: 1; }
	50% { opacity: 0.3; }
	100% { opacity: 1; }
}

.refreshing {
	animation: blink 2s linear infinite;
}

.fiat_line {
	font-family: var(--font-mono);
	font-size: 13px;
	color: var(--nulo-secondary);
	margin-top: 4px;
}

.fiat_partial {
	font-family: var(--font-mono);
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--nulo-outline);
	margin-top: 4px;
}

.breakdown {
	margin-top: 8px;
}

.breakdown_item {
	display: flex;
	align-items: center;
	gap: 6px;

	font-family: var(--font-mono);
	font-size: 11px;
	letter-spacing: 0.02em;
	color: var(--nulo-secondary);
}

/* Same private/public vocabulary as TokenCard's split: bone lock = private, grey globe = public. */
.breakdown_private {
	display: inline-flex;
	color: var(--nulo-accent);
}

.breakdown_public {
	display: inline-flex;
	color: var(--nulo-secondary);
}

.breakdown_divider {
	color: var(--nulo-outline);
}

.actions {
	width: 100%;
	margin-top: 16px;
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
