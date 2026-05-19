<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Components */
import SubPageHeader from "@/components/ui/SubPageHeader.vue"
import TxFeeRow from "@/popup/components/modules/tx/TxFeeRow.vue"
import TxDebugPanel from "@/popup/components/modules/tx/TxDebugPanel.vue"

/** Vendor */
import { DateTime } from "luxon"

/** Services */
import { TokenServiceClient } from "@/wallet/services/token/client"
import { OriginType } from "@/wallet/services/transaction/client"

/** Utils */
import { balanceFormatted } from "@/utils/amount.js"
import { trimAddress } from "@/utils/string"
import {
	getTxCategory,
	getTxTitle,
	getOriginLabel,
	getPrimaryCall,
	formatTransferType,
	humanizeMethodName,
	FEE_METHODS,
} from "@/utils/tx-enrichment"
import { formatFeeJuice, feeToUsd } from "@/utils/fee-estimation"
import { getTransactionExplorerUrl, BLOCK_EXPLORERS } from "@/wallet/constants/explorers"
import { buildGasBreakdown, computeFeeSavings, describeFeePaymentMethod } from "@/popup/components/modules/tx/tx-detail-helpers"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const route = useRoute()
const router = useRouter()

const tokenService = new TokenServiceClient()

const tx = computed(() => appStore.transactions.find((t) => t.hash === route.params.id))
const call = computed(() => (tx.value?.calls ? getPrimaryCall(tx.value.calls) : undefined))
const type = computed(() => (tx.value?.calls ? getTxCategory(tx.value.calls) : "tx"))

const popupTitle = computed(() => (tx.value?.calls ? getTxTitle(tx.value.calls) : "Transaction"))
const originLabel = computed(() => getOriginLabel(tx.value?.origin))

const transfer = computed(() => (call.value?.transfers ? call.value.transfers[0] : null))
const transferTypeLabel = computed(() => {
	if (!transfer.value || transfer.value.type === undefined || transfer.value.type === null) return null
	return formatTransferType(transfer.value.type)
})
const tokens = ref([])
const token = computed(() => tokens.value.find((t) => call.value?.contract === t.contract))

const transferAmount = computed(() => {
	if (transfer.value) {
		return balanceFormatted(transfer.value.amount || 0, token.value?.decimals || 0, 8).value
	}
	return 0
})

const mintAmount = computed(() => {
	if (type.value !== "mint" || !tx.value?.calls) return 0

	const decimals = tx.value?.origin?.type === OriginType.UI ? 8 : 0
	let amount = 0n
	for (const c of tx.value.calls) {
		const last = c.args?.at(-1)
		if (last !== undefined && last !== null) amount += BigInt(last)
	}
	return balanceFormatted(amount, decimals, 8).value
})

const showFeeBreakdown = ref(false)

const txTime = computed(() => {
	if (!tx.value?.updatedAt) return null
	return DateTime.fromMillis(tx.value.updatedAt).toFormat("MMM dd, yyyy 'at' HH:mm")
})

const handleCopy = (target) => {
	window.navigator.clipboard.writeText(target)
	openToast({ label: "Successfully copied", icon: "copy" })
}

const feePaymentLabel = computed(() => describeFeePaymentMethod(tx.value))

const formattedFee = computed(() => (tx.value?.fee ? formatFeeJuice(BigInt(tx.value.fee)) : null))
const formattedFeeUsd = computed(() => (tx.value?.fee ? feeToUsd(BigInt(tx.value.fee)) : null))
const formattedEstFee = computed(() => (tx.value?.estimatedFee ? formatFeeJuice(BigInt(tx.value.estimatedFee)) : null))
const formattedEstFeeUsd = computed(() => (tx.value?.estimatedFee ? feeToUsd(BigInt(tx.value.estimatedFee)) : null))

const gasBreakdown = computed(() => buildGasBreakdown(tx.value?.gasDetails))
const feeSavings = computed(() => computeFeeSavings(tx.value?.fee, tx.value?.estimatedFee))

const explorerUrl = computed(() => {
	if (!appStore.network?.chainId || !tx.value?.hash) return null
	return getTransactionExplorerUrl(appStore.network.chainId, appStore.defaultExplorer, tx.value.hash)
})
const explorerName = computed(() => BLOCK_EXPLORERS.find((e) => e.id === appStore.defaultExplorer)?.name ?? "explorer")

/** User-facing calls list — excludes fee/entrypoint infrastructure. */
const userCalls = computed(() => {
	if (!tx.value?.calls) return []
	return tx.value.calls.filter((c) => !FEE_METHODS.has(c.method))
})

onMounted(async () => {
	tokens.value = await tokenService.getTokens(appStore.profile.id, appStore.network.chainId)
})

onBeforeUnmount(() => {
	tokenService.disconnect()
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader :title="popupTitle" :backTo="'/popup/activity'" />

		<Flex v-if="tx" wide direction="column" gap="24" :class="$style.content">
			<Flex direction="column" align="center" gap="10">
				<Flex align="center" justify="center" gap="8" :class="$style.hero_meta">
					<span v-if="txTime" :class="$style.tx_time">{{ txTime }}</span>
					<span v-if="txTime && (explorerUrl || tx?.hash)" :class="$style.meta_sep">·</span>
					<a
						v-if="explorerUrl"
						:href="explorerUrl"
						target="_blank"
						rel="noopener noreferrer"
						@click.stop
						:class="$style.hero_link"
					>
						<span>View on {{ explorerName }}</span>
						<Icon name="external-link" size="10" color="tertiary" />
					</a>
					<span
						v-else-if="tx?.hash"
						@click="handleCopy(tx.hash)"
						:class="[$style.hero_link, 'copyable']"
					>
						<span>Copy hash</span>
						<Icon name="copy" size="10" color="tertiary" />
					</span>
				</Flex>
			</Flex>

			<Flex v-if="transferAmount" align="center" direction="column" gap="6">
				<span :class="$style.amount_value">
					{{ transferAmount }}
					<span :class="$style.amount_symbol">{{ transfer.token.symbol }}</span>
				</span>
				<span :class="$style.amount_caption">Transfer amount</span>
			</Flex>

			<Flex v-else-if="mintAmount" align="center" direction="column" gap="6">
				<span :class="$style.amount_value">
					{{ mintAmount }}
					<span v-if="token" :class="$style.amount_symbol">{{ token.symbol }}</span>
				</span>
				<span :class="$style.amount_caption">Mint amount</span>
			</Flex>

			<Banner
				v-if="transfer && !token"
				variant="warning"
				direction="vertical"
				:action="{ name: 'Copy token address', callback: () => handleCopy(call.contract) }"
				wide
			>
				<template #title> {{ transfer.token.symbol }} is missing </template>
				<template #description> This token not found in your token list </template>
			</Banner>

			<Flex v-if="transfer" wide direction="column" gap="10">
				<div v-if="transferTypeLabel" :class="$style.transfer_type_chip">
					{{ transferTypeLabel }}
				</div>

				<Flex wide gap="8">
					<Flex
						wide
						direction="column"
						gap="4"
						:class="$style.address_card"
						@click="handleCopy(transfer.from)"
					>
						<AddressDisplay
							static
							size="13"
							weight="600"
							:address="transfer.from"
							:formatter="(addr) => trimAddress(addr, 6, 4)"
						/>
						<span :class="$style.address_label">From</span>
					</Flex>

					<Flex
						wide
						direction="column"
						gap="4"
						:class="$style.address_card"
						@click="handleCopy(transfer.to)"
					>
						<AddressDisplay
							static
							size="13"
							weight="600"
							:address="transfer.to"
							:formatter="(addr) => trimAddress(addr, 6, 4)"
						/>
						<span :class="$style.address_label">To</span>
					</Flex>
				</Flex>
			</Flex>

			<Flex wide direction="column" gap="10">
				<SectionLabel label="Details" />

				<Flex wide direction="column" gap="10" :class="$style.details_box">
					<Flex v-if="originLabel" wide justify="between" align="center">
						<span :class="$style.detail_key">App</span>
						<span :class="$style.detail_value">{{ originLabel }}</span>
					</Flex>

					<Flex v-if="feePaymentLabel" wide justify="between" align="center">
						<span :class="$style.detail_key">Fee method</span>
						<span :class="$style.detail_value">{{ feePaymentLabel }}</span>
					</Flex>

					<TxFeeRow
						v-if="formattedFee"
						v-model="showFeeBreakdown"
						label="Fee paid"
						:feeAmount="formattedFee"
						:feeUsd="formattedFeeUsd"
						:gasBreakdown="gasBreakdown"
						:estimatedFee="formattedEstFee"
						:feeSavings="feeSavings"
					/>

					<TxFeeRow
						v-else-if="formattedEstFee"
						v-model="showFeeBreakdown"
						estimated
						label="Estimated fee"
						:feeAmount="formattedEstFee"
						:feeUsd="formattedEstFeeUsd"
						:gasBreakdown="gasBreakdown"
					/>

					<Flex v-if="tx?.block" wide justify="between" align="center">
						<span :class="$style.detail_key">Block</span>
						<Flex align="center" gap="6">
							<span :class="$style.detail_value_mono">#{{ tx.block.number }}</span>
							<span @click="handleCopy(tx.block.hash)" :class="[$style.detail_value_aux, 'copyable']">
								{{ trimAddress(tx.block.hash, 6, 4) }}
							</span>
						</Flex>
					</Flex>

					<Flex v-if="tx?.nonce" wide justify="between" align="center">
						<span :class="$style.detail_key">Nonce</span>
						<span @click="handleCopy(tx.nonce)" :class="[$style.detail_value_mono, 'copyable']">
							{{ trimAddress(tx.nonce, 6, 4) }}
						</span>
					</Flex>
				</Flex>
			</Flex>

			<Flex v-if="userCalls.length" wide direction="column" gap="10">
				<SectionLabel label="Calls" :count="userCalls.length" />

				<Flex wide direction="column" :class="$style.calls_box">
					<Flex
						v-for="(c, idx) in userCalls"
						:key="idx"
						direction="column"
						gap="4"
						:class="[$style.call_row, idx > 0 && $style.call_row_divider]"
					>
						<span :class="$style.call_method">{{ humanizeMethodName(c.method) || "Call" }}</span>
						<span @click="handleCopy(c.contract)" :class="[$style.call_contract, 'copyable']">
							{{ trimAddress(c.contract, 6, 4) }}
						</span>
					</Flex>
				</Flex>
			</Flex>

			<TxDebugPanel :tx="tx" @copy="handleCopy" />
		</Flex>

		<Flex v-else wide direction="column" align="center" gap="12" :class="$style.content">
			<span :class="$style.empty_headline">TRANSACTION NOT FOUND</span>
			<span :class="$style.empty_sub">This hash isn't in your current account history.</span>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	scrollbar-gutter: stable;
	background: var(--app-bg);
}

.content {
	padding: 4px 20px var(--nav-clearance) 20px;
}

.hero_meta {
	flex-wrap: wrap;
	row-gap: 4px;
}

.tx_time {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);
}

.meta_sep {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);
}

.hero_link {
	display: inline-flex;
	align-items: center;
	gap: 6px;

	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-outline);
	text-decoration: none;
	cursor: pointer;

	transition: color 0.2s var(--bezier);

	& svg {
		transition: fill 0.2s var(--bezier);
	}

	&:hover {
		color: var(--nulo-accent);
		& svg {
			fill: var(--nulo-accent);
		}
	}
}

.amount_value {
	font-family: var(--font-mono);
	font-size: 24px;
	font-weight: 500;
	color: var(--txt-primary);
}

.amount_symbol {
	color: var(--nulo-secondary);
}

.amount_caption {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.transfer_type_chip {
	align-self: center;

	padding: 5px 12px;
	border: 1px solid var(--nulo-border);
	background: transparent;

	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.15em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.address_card {
	width: 100%;

	padding: 12px;
	border: 1px solid var(--nulo-border);
	background: transparent;

	cursor: pointer;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-low);
	}
}

.address_label {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.details_box {
	padding: 12px;
	border: 1px solid var(--nulo-border);
	background: transparent;
}

.detail_key {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.detail_value {
	font-family: var(--font-body);
	font-size: 12px;
	font-weight: 600;
	color: var(--txt-primary);

	text-align: right;
	word-break: break-word;
}

.detail_value_mono {
	font-family: var(--font-mono);
	font-size: 12px;
	font-weight: 600;
	color: var(--txt-primary);
}

.detail_value_aux {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-outline);
}

.calls_box {
	width: 100%;

	border: 1px solid var(--nulo-border);
	background: transparent;
}

.call_row {
	width: 100%;

	padding: 10px 12px;
}

.call_row_divider {
	border-top: 1px solid var(--nulo-border);
}

.call_method {
	font-family: var(--font-headline);
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.01em;
	color: var(--txt-primary);

	word-break: break-word;
}

.call_contract {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);
}

.empty_headline {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
	margin-top: 48px;
}

.empty_sub {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);
	text-align: center;
}
</style>
