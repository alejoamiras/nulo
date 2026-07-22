<script setup>
/** Services */
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import { PriceServiceClient } from "@/wallet/services/price/client"
import { ConfigServiceClient } from "@/wallet/services/config/client"

/** Composables */
import { usePrices } from "@/composables/usePrices"

/** Store */
import { useAppStore } from "@/stores/app.store.ts"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.select_balance_type?.order
})

const defaultDisplayOptions = [
	{
		ref: "total_account_value",
		title: "Total account value",
		description: "Amount of all tokens in USD",
		icon: "dollar",
	},
	{
		ref: "total_private_balances",
		title: "Total private balances",
		description: "All private balances in USD",
		icon: "dollar",
	},
	{
		ref: "total_public_balances",
		title: "Total public balances",
		description: "All public balances in USD",
		icon: "dollar",
	},
]

const displayOptions = ref()
const selectedOptionRef = computed(() => appStore.displayOption)

const tokenBalances = ref([])
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
	const idx = tokenBalances.value.findIndex((_tb) => _tb.id === tb.id)
	if (idx !== -1) {
		tokenBalances.value.splice(idx, 1)
	}
}

const handleSelectOption = (option) => {
	appStore.displayOption = option.ref

	emit("onClose")
}

/** Real fiat aggregates for the three summary options — `—` when nothing is
 *  priced (never a fake $0.00). Mirrors BalanceView's aggregate math. */
const priceService = new PriceServiceClient()
const prices = usePrices(priceService)

/** With fiat display OFF the three aggregate options are fiat-shaped noise —
 *  hidden entirely; token options remain. */
const showFiatValues = ref(true)
const configService = new ConfigServiceClient()
configService.getValue("showFiatValues").then((v) => {
	showFiatValues.value = v !== false
})

const aggregateFiat = (sides) => {
	let micro = 0n
	let priced = 0
	let holdings = 0
	for (const tb of tokenBalances.value) {
		let raw = 0n
		if (sides.private) raw += BigInt(tb.privateBalance || 0)
		if (sides.public) raw += BigInt(tb.publicBalance || 0)
		// Zero-balance rows are worth $0.00 whether priced or not (mirrors
		// BalanceView's aggregate matrix).
		if (raw === 0n) continue
		holdings += 1
		const value = prices.tokenFiatMicro(tb.token, raw)
		if (value === undefined) continue
		micro += value
		priced += 1
	}
	if (priced > 0) return prices.formatUsdMicro(micro)
	return holdings === 0 ? prices.formatUsdMicro(0n) : "—"
}

const aggregatePreview = (optionRef) => {
	if (optionRef === "total_private_balances") return aggregateFiat({ private: true, public: false })
	if (optionRef === "total_public_balances") return aggregateFiat({ private: false, public: true })
	return aggregateFiat({ private: true, public: true })
}

const amountToPreview = ref("—")
const onHover = (str) => {
	amountToPreview.value = str
}

onBeforeUnmount(() => {
	prices.dispose()
	priceService.disconnect()
	configService.disconnect()
})

watch(
	() => props.show,
	async () => {
		if (props.show) {
			// Re-read per open — the kill-switch can flip mid-session and this
			// popup instance outlives the settings change.
			showFiatValues.value = (await configService.getValue("showFiatValues")) !== false
			displayOptions.value = showFiatValues.value ? [...defaultDisplayOptions] : []
			tokenBalances.value = await tokenBalanceService.getTokenBalances(undefined, appStore.account?.address)
			for (const tb of tokenBalances.value) {
				displayOptions.value.push({
					ref: tb.token.id,
					title: tb.token.name,
					description: "Use token balance",
					icon: "banknote",
					token: {
						...tb.token,
						balance: (Number.parseFloat(tb.privateBalance) + Number.parseFloat(tb.publicBalance)) / 10 ** tb.token.decimals,
					},
				})
			}

			if (!displayOptions.value.map((opt) => opt.ref).includes(appStore.displayOption?.ref)) {
				amountToPreview.value = aggregatePreview("total_account_value")
			}
		} else {
			tokenBalanceService.disconnect()
		}
	},
)
</script>

<template>
	<Popup :show @onClose="emit('onClose')" :displaceIdx="popupStore.popups.select_balance_type?.order">
		<PopupCard :displaceIdx>
			<Flex wide direction="column" gap="24" :class="$style.wrapper">
				<Flex direction="column" gap="6">
					<Text size="14" weight="600" color="primary"> Configure the balance display </Text>
					<Text size="13" weight="500" color="tertiary" height="140">
						Select what you want to see on the main page
					</Text>
				</Flex>

				<Flex direction="column" align="center" gap="12" :class="$style.preview_card">
					<Text size="20" weight="500" color="primary">{{ amountToPreview }}</Text>
					<Flex align="center" gap="6">
						<Icon name="zap" size="12" color="tertiary" />
						<Text size="12" weight="600" color="tertiary">Balance Display Preview</Text>
					</Flex>
				</Flex>

				<Flex direction="column" gap="8">
					<Flex
						v-for="option in displayOptions"
						@click="handleSelectOption(option)"
						@pointerenter="
							onHover(option.token ? `${comma(option.token?.balance)} ${option.token.symbol}` : aggregatePreview(option.ref))
						"
						align="center"
						justify="between"
						gap="16"
						:class="$style.card"
					>
						<Flex gap="10" :class="$style.left">
							<Icon
								:name="option.ref === selectedOptionRef ? 'check-circle' : 'circle'"
								size="16"
								:color="option.ref === selectedOptionRef ? 'green' : 'tertiary'"
							/>

							<Flex direction="column" gap="8" :class="$style.labels">
								<Text size="14" weight="600" color="primary" noWrap> {{ option.title }} </Text>
								<Text size="13" weight="600" color="tertiary"> {{ option.description }} </Text>
							</Flex>
						</Flex>

						<Flex v-if="option.token" align="center" :class="$style.amount_badge">
							<Text size="12" weight="600" color="primary" noWrap>
								{{ comma(option.token?.balance) }}
								<Text color="tertiary">{{ option.token.symbol }}</Text>
							</Text>
						</Flex>
						<Flex v-else align="center" :class="$style.amount_badge">
							<Text size="12" weight="600" color="primary" data-testid="balance-type-aggregate">
								{{ aggregatePreview(option.ref) }}
							</Text>
						</Flex>
					</Flex>
				</Flex>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	padding: 0 20px 24px 20px;
}

.preview_card {
	border-radius: 0;
	background: var(--nulo-surface-low);

	padding: 12px 0;
}

.card {
	border-radius: 0;
	cursor: pointer;
	border: 1px solid var(--nulo-border);

	padding: 12px 16px 12px 12px;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-low);
		border: 1px solid var(--nulo-outline);
	}

	&:active {
		background: var(--nulo-surface-high);
	}
}

.left {
	min-width: 0;
	width: 100%;
	overflow: hidden;
}

.labels {
	min-width: 0;
	width: 100%;
	overflow: hidden;

	& span {
		text-overflow: ellipsis;
		overflow: hidden;
	}
}

.amount_badge {
	background: var(--nulo-surface-high);
	border-radius: 6px;

	padding: 4px 6px;
}
</style>
