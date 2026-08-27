<route lang="json">
{ "meta": { "isAuthRequired": true } }
</route>

<script setup>
/**
 * Received-transfer detail page (`/popup/received/:id`, D5). The receiver-side mirror of the
 * transaction-detail page (`tx/[id].vue`) — same layout system, reversed: an amount hero, a
 * From/To pair, an explorer link at the top, and a Details box. It states the receiver-honest kind
 * (real sender only for pub→pub; "From private" for priv→pub; redacted for note kinds — never the
 * MAGIC/zero sentinel raw) and, for PUBLIC receipts only, the network fee the sender paid.
 *
 * The fee is fetched LAZILY on open (never persisted): a mined tx's fee is immutable, so the
 * background service caches it in-memory and the row shimmers until it lands. The fee row is
 * public-event-only (the record carries the block hash the reorg-safe cache needs; the sender-paid fee
 * is a public-transfer concept).
 *
 * Privacy posture (deferred — see the "Privacy maxi" follow-up in
 * implementations-plan/incoming-public-transfers/lessons/phase-6.md): explorer links resolve for ALL
 * receipts (notes included), and the public-fee fetch is automatic on open. Both narrow an RPC/explorer's
 * view to a specific tx — a future opt-in "Privacy maxi" setting is where we'd strip explorer links on
 * private receipts and gate the fee fetch behind an explicit tap. Not done here by product decision.
 */

/** Components */
import SubPageHeader from "@/components/ui/SubPageHeader.vue"

/** Vendor */
import { DateTime } from "luxon"

/** Services */
import { IncomingTransferServiceClient } from "@/wallet/services/incoming-transfer/client"
import { TokenServiceClient } from "@/wallet/services/token/client"
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { PriceServiceClient } from "@/wallet/services/price/client"
import { NetworkServiceClient } from "@/wallet/services/network/client"

/** Composables */
import { useToast } from "@/composables/toast"
import { usePrices } from "@/composables/usePrices"

/** Utils */
import { balanceFormatted } from "@/utils/amount.js"
import { copyReceivedValue } from "./received-copy"
import { trimAddress } from "@/utils/string"
import { receivedLabel, resolveFromDisplay, resolveReceivedType } from "@/utils/received-display"
import { getTransactionExplorerUrl, BLOCK_EXPLORERS } from "@/wallet/constants/explorers"
import { formatFeeJuice, feeToUsd, feeJuicePricingFromUsd } from "@/utils/fee-estimation"

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
/** The RECORD's own chainId (resolved from its networkId) — NOT the active network's. Token
 *  decimals/symbol + the explorer URL must follow the record, so a deep-linked or off-network record
 *  (or a network switch after open) can't show the wrong chain's catalogue/explorer. */
const recordChainId = ref(null)

/** Lazy network-fee state (public receipts only). */
const feeJuiceRaw = ref(null)
const feeLoading = ref(false)

/** Service clients */
const incomingTransferService = new IncomingTransferServiceClient()
const tokenService = new TokenServiceClient()
const configService = new ConfigServiceClient()
const priceService = new PriceServiceClient()
const networkService = new NetworkServiceClient()
const prices = usePrices(priceService)

/** If a reorg/reconcile removes THIS receipt while the page is open, drop to the not-found state rather
 *  than keep showing an orphaned receipt. `deletedIds` tombstones the delete so one that races the initial
 *  load (fired while getIncomingTransferById is still awaiting, when `received` is still null) still wins —
 *  the post-load check in onMounted honors it. (A re-mine that only rewrites a surviving record's block/fee
 *  emits no event yet, so a stale fee on a still-valid record isn't caught here — see the reorg-staleness
 *  follow-up in lessons/phase-6.md.) */
const deletedIds = new Set()
const onReceiptDeleted = (rec) => {
	deletedIds.add(rec.id)
	if (received.value?.id === rec.id) received.value = null
}
incomingTransferService.onIncomingTransferDeleted.add(onReceiptDeleted)

/** Derived — token + amount */
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

/** Derived — sender / kind */
const kindLabel = computed(() => (received.value ? receivedLabel(resolveReceivedType(received.value)) : ""))
const fromDisplay = computed(() => (received.value ? resolveFromDisplay(received.value) : { kind: "redacted" }))
const fromClickable = computed(() => fromDisplay.value.kind === "address")
const isPublic = computed(() => received.value?.kind === "public-event")

/** Derived — meta / explorer */
const receivedTime = computed(() => {
	const inc = received.value
	if (!inc) return null
	if (inc.blockTimestamp) return DateTime.fromSeconds(inc.blockTimestamp).toFormat("MMM dd, yyyy 'at' HH:mm")
	if (inc.discoveredAt) return DateTime.fromMillis(inc.discoveredAt).toFormat("MMM dd, yyyy 'at' HH:mm")
	return null
})
const explorerUrl = computed(() => {
	const inc = received.value
	if (!inc) return null
	return getTransactionExplorerUrl(recordChainId.value ?? undefined, explorerId.value, inc.txHash)
})
const explorerName = computed(() => BLOCK_EXPLORERS.find((e) => e.id === explorerId.value)?.name ?? "explorer")

/** Derived — fee at today's rate (mirrors tx/[id].vue's fee valuation). */
const feeJuicePricing = computed(() => feeJuicePricingFromUsd(prices.feeJuiceQuote.value?.usd))
const formattedFee = computed(() => (feeJuiceRaw.value ? formatFeeJuice(BigInt(feeJuiceRaw.value)) : null))
const formattedFeeUsd = computed(() => (feeJuiceRaw.value ? feeToUsd(BigInt(feeJuiceRaw.value), feeJuicePricing.value) : null))

/** Handlers */
const copy = async (value, label) => {
	await copyReceivedValue(value, label, openToast)
}

/** Lifecycle */
onMounted(async () => {
	// Resolve the record FIRST; `loaded` gates the not-found state, so flip it as soon as we know.
	received.value = (await incomingTransferService.getIncomingTransferById(route.params.id).catch(() => null)) ?? null
	// A delete that fired WHILE this load was in flight tombstoned the id — honor it so the just-loaded
	// (now stale) record can't paint over a deletion that already happened.
	if (received.value && deletedIds.has(received.value.id)) received.value = null
	loaded.value = true
	const inc = received.value
	if (!inc) return

	// The record's own chain drives the token catalogue + explorer URL (NOT the active network).
	const net = await networkService.getNetwork(inc.networkId).catch(() => null)
	recordChainId.value = net?.chainId ?? null

	// Aux data loads INDEPENDENTLY (allSettled): a token/config failure must not skip the fee fetch, and
	// none of these may escape the async mounted hook as an unhandled rejection. The fee is PUBLIC-only
	// (the service also gates on kind server-side) and fails soft to the dash.
	const tasks = []
	// Use the RECORD's profileId (it was already verified == active at load), not the mutable
	// appStore.profile.id, so a concurrent profile switch can't point the token lookup at another profile.
	if (recordChainId.value !== null) {
		tasks.push(tokenService.getTokens(inc.profileId, recordChainId.value).then((t) => (tokens.value = t)))
	}
	tasks.push(configService.getValue("defaultExplorer").then((v) => (explorerId.value = v)))
	if (inc.kind === "public-event") {
		feeLoading.value = true
		tasks.push(
			incomingTransferService
				.getReceiptFee(inc.id)
				.then((res) => {
					if (res) feeJuiceRaw.value = res.feeJuice
				})
				.finally(() => (feeLoading.value = false)),
		)
	}
	await Promise.allSettled(tasks)
})
onBeforeUnmount(() => {
	incomingTransferService.onIncomingTransferDeleted.remove(onReceiptDeleted)
	incomingTransferService.disconnect()
	tokenService.disconnect()
	configService.disconnect()
	networkService.disconnect()
	prices.dispose()
	priceService.disconnect()
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper" data-testid="received-detail-page">
		<SubPageHeader title="Received" backTo="/popup/activity" />

		<Flex v-if="received" wide direction="column" gap="24" :class="$style.content">
			<Flex direction="column" align="center" gap="10">
				<Flex align="center" justify="center" gap="8" :class="$style.hero_meta">
					<span v-if="receivedTime" :class="$style.tx_time">{{ receivedTime }}</span>
					<span v-if="receivedTime && received.txHash" :class="$style.meta_sep">·</span>
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
						v-else-if="received.txHash"
						@click="copy(received.txHash, 'Tx hash')"
						:class="[$style.hero_link, 'copyable']"
					>
						<span>Copy hash</span>
						<Icon name="copy" size="10" color="tertiary" />
					</span>
				</Flex>
			</Flex>

			<Flex align="center" direction="column" gap="6">
				<span :class="$style.amount_value">
					+{{ formattedAmount }}
					<span :class="$style.amount_symbol">{{ tokenSymbol }}</span>
				</span>
				<span v-if="amountFiat" title="At today's price" :class="$style.amount_fiat">{{ amountFiat }}</span>
			</Flex>

			<div :class="$style.transfer_type_chip" data-testid="tx-incoming-kind-chip">{{ kindLabel }}</div>

			<Flex wide gap="8">
				<Flex
					wide
					direction="column"
					gap="4"
					:class="[$style.address_card, !fromClickable && $style.card_static]"
					data-testid="received-from-card"
					@click="fromClickable && copy(fromDisplay.address, 'From address')"
				>
					<AddressDisplay
						v-if="fromDisplay.kind === 'address'"
						static
						size="13"
						weight="600"
						:address="fromDisplay.address"
						:formatter="(addr) => trimAddress(addr, 6, 4)"
					/>
					<!-- Non-address senders render through the SAME <Text> primitive (size/weight/color) that
					     AddressDisplay uses for the "To" account, so both cards' values look identical. -->
					<Text v-else-if="fromDisplay.kind === 'private'" size="13" weight="600" color="primary" data-testid="from-private">Private</Text>
					<Text v-else-if="fromDisplay.kind === 'mint'" size="13" weight="600" color="primary" data-testid="from-mint">Mint</Text>
					<Text v-else size="13" weight="600" color="primary" data-testid="from-redacted">Private</Text>
					<span :class="$style.address_label">From</span>
				</Flex>

				<Flex
					wide
					direction="column"
					gap="4"
					:class="$style.address_card"
					@click="copy(received.accountAddress, 'Account address')"
				>
					<AddressDisplay
						static
						size="13"
						weight="600"
						:address="received.accountAddress"
						:formatter="(addr) => trimAddress(addr, 6, 4)"
					/>
					<span :class="$style.address_label">To</span>
				</Flex>
			</Flex>

			<Flex wide direction="column" gap="10">
				<SectionLabel label="Details" />

				<Flex wide direction="column" gap="10" :class="$style.details_box">
					<Flex wide justify="between" align="center" gap="12">
						<span :class="$style.detail_key">Tx hash</span>
						<a
							v-if="explorerUrl"
							:href="explorerUrl"
							target="_blank"
							rel="noopener noreferrer"
							data-testid="tx-explorer-link"
							:class="[$style.detail_value_mono, $style.detail_link]"
							>{{ trimAddress(received.txHash, 6, 4) }}</a
						>
						<span
							v-else
							@click="copy(received.txHash, 'Tx hash')"
							:class="[$style.detail_value_mono, 'copyable']"
							data-testid="tx-hash-copy"
							>{{ trimAddress(received.txHash, 6, 4) }}</span
						>
					</Flex>

					<Flex v-if="isPublic" wide justify="between" align="center" gap="12">
						<Flex direction="column" gap="2">
							<span :class="$style.detail_key">Network fee</span>
							<span :class="$style.detail_key_note">Paid by sender</span>
						</Flex>
						<Flex align="center" gap="6">
							<span v-if="feeLoading" :class="$style.fee_shimmer" data-testid="received-fee-loading" />
							<template v-else-if="formattedFee">
								<span :class="$style.detail_value_mono">{{ formattedFee }} FJ</span>
								<span v-if="formattedFeeUsd" :class="$style.detail_value_aux" title="At today's AZTEC price">{{
									formattedFeeUsd
								}}</span>
							</template>
							<span v-else :class="$style.detail_value_aux">—</span>
						</Flex>
					</Flex>

					<Flex v-if="received.l2BlockNumber" wide justify="between" align="center">
						<span :class="$style.detail_key">Block</span>
						<Flex align="center" gap="6">
							<span :class="$style.detail_value_mono">#{{ received.l2BlockNumber }}</span>
							<span
								v-if="isPublic"
								@click="copy(received.blockHash, 'Block hash')"
								:class="[$style.detail_value_aux, 'copyable']"
							>
								{{ trimAddress(received.blockHash, 6, 4) }}
							</span>
						</Flex>
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
	color: var(--txt-secondary);
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

.amount_fiat {
	font-family: var(--font-mono);
	font-size: 11px;
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

.card_static {
	cursor: default;

	&:hover {
		background: transparent;
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

.detail_key_note {
	font-family: var(--font-mono);
	font-size: 9px;
	color: var(--nulo-outline);
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

.detail_link {
	text-decoration: none;
	cursor: pointer;
	transition: color 0.2s var(--bezier);

	&:hover {
		color: var(--nulo-accent);
	}
}

.fee_shimmer {
	width: 64px;
	height: 12px;

	background: linear-gradient(
		90deg,
		var(--nulo-surface-low) 25%,
		var(--nulo-surface-high) 50%,
		var(--nulo-surface-low) 75%
	);
	background-size: 200% 100%;

	animation: fee_shimmer_slide 1.4s var(--bezier) infinite;
}

@keyframes fee_shimmer_slide {
	0% {
		background-position: 200% 0;
	}
	100% {
		background-position: -200% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.fee_shimmer {
		animation: none;
	}
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
