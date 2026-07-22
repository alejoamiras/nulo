<route lang="json">
{ "meta": { "isAuthRequired": true } }
</route>

<script setup>
/**
 * Received-transfer detail page (`/popup/received/:id`, D5). Reached from an incoming-receive row
 * in the activity feed (was: a redirect to the token page). Shows the receiver-honest kind, an
 * honest "From" card (real address only for pub→pub; "From private" for priv→pub; redacted for both
 * note kinds — never the MAGIC/zero sentinel raw), the amount, and — where an explorer URL exists —
 * an always-on "View on {explorer}" link (copy-hash on the sandbox, which has no explorer base URL).
 */

/** Components */
import SubPageHeader from "@/components/ui/SubPageHeader.vue"

/** Services */
import { IncomingTransferServiceClient } from "@/wallet/services/incoming-transfer/client"
import { TokenServiceClient } from "@/wallet/services/token/client"
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { PriceServiceClient } from "@/wallet/services/price/client"

/** Composables */
import { useToast } from "@/composables/toast"
import { usePrices } from "@/composables/usePrices"

/** Utils */
import { balanceFormatted } from "@/utils/amount.js"
import { receivedLabel, resolveFromDisplay, resolveReceivedType } from "@/utils/received-display"
import { getTransactionExplorerUrl } from "@/wallet/constants/explorers"

/** Store */
import { useAppStore } from "@/stores/app.store"

const appStore = useAppStore()

/** Composables */
const { openToast } = useToast()

/** Router */
const route = useRoute()

/** Reactive state */
const received = ref(null)
const loaded = ref(false)
const tokens = ref([])
const explorerId = ref(null)

/** Service clients */
const incomingTransferService = new IncomingTransferServiceClient()
const tokenService = new TokenServiceClient()
const configService = new ConfigServiceClient()
const priceService = new PriceServiceClient()
const prices = usePrices(priceService)

/** Derived */
const token = computed(() => {
	const inc = received.value
	if (!inc) return undefined
	return tokens.value.find((t) => (inc.tokenId !== undefined && t.id === inc.tokenId) || t.contract === inc.contract)
})
const tokenSymbol = computed(() => token.value?.symbol || "Token")
const formattedAmount = computed(() => {
	const inc = received.value
	if (!inc) return null
	return balanceFormatted(inc.amountRaw, token.value?.decimals || 0, 8).value
})
const amountFiat = computed(() => {
	const inc = received.value
	if (!inc || !token.value) return null
	return prices.tokenFiatLabel(token.value, BigInt(inc.amountRaw || 0)) ?? null
})
const kindLabel = computed(() => (received.value ? receivedLabel(resolveReceivedType(received.value)) : ""))
const fromDisplay = computed(() => (received.value ? resolveFromDisplay(received.value) : { kind: "redacted" }))
const explorerUrl = computed(() => {
	const inc = received.value
	if (!inc) return null
	return getTransactionExplorerUrl(appStore.network?.chainId, explorerId.value, inc.txHash)
})

/** Handlers */
const copy = async (value, label) => {
	try {
		await navigator.clipboard.writeText(value)
		openToast({ label: `${label} copied`, icon: "copy" }, 2_000)
	} catch {
		openToast({ label: "Copy failed", icon: "alert" }, 2_000)
	}
}
const openExplorer = () => {
	if (explorerUrl.value) window.open(explorerUrl.value, "_blank", "noopener")
}

/** Lifecycle */
onMounted(async () => {
	try {
		received.value = (await incomingTransferService.getIncomingTransferById(route.params.id)) ?? null
		if (appStore.profile?.id && appStore.network?.chainId !== undefined) {
			tokens.value = await tokenService.getTokens(appStore.profile.id, appStore.network.chainId)
		}
		explorerId.value = await configService.getValue("defaultExplorer")
	} finally {
		loaded.value = true
	}
})
onBeforeUnmount(() => {
	incomingTransferService.disconnect()
	tokenService.disconnect()
	configService.disconnect()
	prices.dispose()
	priceService.disconnect()
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper" data-testid="received-detail-page">
		<SubPageHeader title="Received" backTo="/popup/activity" />

		<Flex v-if="received" wide direction="column" gap="24" :class="$style.content">
			<!-- Amount hero + kind chip -->
			<Flex direction="column" align="center" gap="6">
				<Flex align="center" gap="8">
					<span :class="$style.amount_value">+{{ formattedAmount }}</span>
					<span :class="$style.amount_symbol">{{ tokenSymbol }}</span>
				</Flex>
				<span v-if="amountFiat" :class="$style.amount_fiat">{{ amountFiat }}</span>
				<span v-else :class="$style.amount_fiat">Price unavailable</span>
				<span :class="$style.kind_chip" data-testid="tx-incoming-kind-chip">{{ kindLabel }}</span>
			</Flex>

			<!-- From card — always shown, states the truth -->
			<Flex wide direction="column" gap="10">
				<SectionLabel label="From" />
				<Flex wide direction="column" gap="6" :class="$style.from_card" data-testid="received-from-card">
					<AddressDisplay v-if="fromDisplay.kind === 'address'" :address="fromDisplay.address" />
					<span v-else-if="fromDisplay.kind === 'private'" :class="$style.from_pill" data-testid="from-private">From private</span>
					<span v-else-if="fromDisplay.kind === 'mint'" :class="$style.from_pill" data-testid="from-mint">Minted — no sender</span>
					<span v-else :class="$style.from_redacted" data-testid="from-redacted">Sender not disclosed</span>
				</Flex>
			</Flex>

			<!-- Details -->
			<Flex wide direction="column" gap="10">
				<SectionLabel label="Details" />
				<Flex wide direction="column" gap="10" :class="$style.details_box">
					<Flex wide justify="between" align="center" gap="12">
						<span :class="$style.detail_key">Tx hash</span>
						<a
							v-if="explorerUrl"
							:class="$style.detail_link"
							data-testid="tx-explorer-link"
							href="#"
							@click.prevent="openExplorer"
							>View on Aztecscan</a
						>
						<span
							v-else
							:class="[$style.detail_value_mono, 'copyable']"
							data-testid="tx-hash-copy"
							@click="copy(received.txHash, 'Tx hash')"
							>{{ received.txHash.slice(0, 6) }}…{{ received.txHash.slice(-4) }}</span
						>
					</Flex>
					<Flex wide justify="between" align="center" gap="12">
						<span :class="$style.detail_key">Block</span>
						<span :class="$style.detail_value">{{ received.l2BlockNumber }}</span>
					</Flex>
					<Flex v-if="received.kind === 'public-event'" wide justify="between" align="center" gap="12">
						<span :class="$style.detail_key">Block hash</span>
						<span :class="[$style.detail_value_mono, 'copyable']" @click="copy(received.blockHash, 'Block hash')"
							>{{ received.blockHash.slice(0, 6) }}…{{ received.blockHash.slice(-4) }}</span
						>
					</Flex>
				</Flex>
			</Flex>
		</Flex>

		<Flex v-else-if="loaded" wide direction="column" align="center" gap="12" :class="$style.content">
			<span :class="$style.empty_headline">RECEIPT NOT FOUND</span>
			<span :class="$style.empty_sub">This receipt isn't in your current account history.</span>
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
.amount_value {
	font-family: var(--font-headline);
	font-size: 32px;
	font-weight: 700;
	color: var(--green, var(--nulo-accent));
}
.amount_symbol {
	font-family: var(--font-headline);
	font-size: 16px;
	color: var(--nulo-secondary);
}
.amount_fiat {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);
}
.kind_chip {
	margin-top: 4px;
	font-family: var(--font-mono);
	font-size: 9px;
	text-transform: uppercase;
	color: var(--green, var(--nulo-accent));
	background: var(--nulo-surface-low);
	border: 1px solid rgba(74, 70, 63, 0.2);
	padding: 2px 6px;
}
.from_card,
.details_box {
	padding: 12px 14px;
	background: var(--nulo-surface-low);
	border: 1px solid var(--nulo-border);
}
.from_pill {
	font-family: var(--font-mono);
	font-size: 11px;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}
.from_redacted {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);
	font-style: italic;
}
.detail_key {
	font-family: var(--font-headline);
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--nulo-secondary);
}
.detail_value {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--txt-primary);
}
.detail_value_mono {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--txt-primary);
	cursor: pointer;
}
.detail_link {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--green, var(--nulo-accent));
	text-decoration: none;
	cursor: pointer;
}
.empty_headline {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.08em;
	color: var(--txt-primary);
}
.empty_sub {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);
	text-align: center;
}
</style>
