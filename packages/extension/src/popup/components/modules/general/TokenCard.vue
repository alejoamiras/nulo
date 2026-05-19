<script setup>
/** Vendor */
import { DateTime } from "luxon"

/** Utils */
import { balanceFormatted } from "@/utils/amount.js"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const emit = defineEmits(["onRefreshBalance"])
const props = defineProps({
	tokenBalance: {
		type: Object,
		required: false,
	},
	newToken: {
		type: Object,
		required: false,
	},
})

const token = computed(() => props.tokenBalance.token)
const decimals = computed(() => token.value?.decimals || 0)
const publicRaw = computed(() => BigInt(props.tokenBalance?.publicBalance || 0))
const privateRaw = computed(() => BigInt(props.tokenBalance?.privateBalance || 0))
const totalBalance = computed(() => balanceFormatted(privateRaw.value + publicRaw.value, decimals.value, 10).value)
const privateFormatted = computed(() => balanceFormatted(privateRaw.value, decimals.value, 6).value)
const publicFormatted = computed(() => balanceFormatted(publicRaw.value, decimals.value, 6).value)
const hasPrivate = computed(() => privateRaw.value !== 0n)
const hasPublic = computed(() => publicRaw.value !== 0n)
// Treat updatedAt===0 as "balance has never synced" — the projector hasn't run yet
// so the "0" placeholder in the row would be misleading. Render a spinner instead.
const isInitialSync = computed(() => !!props.tokenBalance && props.tokenBalance.updatedAt === 0)
const description = computed(() => {
	if (props.tokenBalance?.isMinting) return "Minting more tokens..."
	if (isInitialSync.value) return "Loading balance…"
	if (props.tokenBalance?.isUpdating) return "Refreshing balance..."
	if (props.newToken) return "Minting in progress..."

	return token.value?.name || "unknown"
})

const isHovered = ref(false)

const handleRefreshBalance = async () => {
	if (!props.tokenBalance) return

	emit("onRefreshBalance")
}
</script>

<template>
	<RouterLink
		v-if="tokenBalance"
		:to="`/popup/tokens/${token?.id}`"
		data-testid="tokens-card"
		:class="$style.row"
		@pointerenter="isHovered = true"
		@pointerleave="isHovered = false"
	>
		<Flex direction="column" gap="2">
			<span :class="$style.symbol" data-testid="token-symbol" :data-symbol="token.symbol">
				{{ token.symbol }}
			</span>
			<span :class="$style.type_label">PRIVATE / PUBLIC</span>
		</Flex>

		<Flex
			v-if="isInitialSync"
			align="center"
			gap="6"
			data-testid="token-balance-loading"
			:class="$style.loading_block"
		>
			<Spinner size="12" color="--txt-tertiary" />
			<span :class="$style.loading_text">{{ description }}</span>
		</Flex>
		<Flex v-else direction="column" align="end" gap="2">
			<span :class="$style.amount">{{ totalBalance || 0 }}</span>
			<span :class="$style.detail">{{ privateFormatted }} / {{ publicFormatted }}</span>
		</Flex>
	</RouterLink>

	<Flex v-if="newToken" align="center" justify="between" :class="[$style.row, $style.minting]">
		<Flex direction="column" gap="2">
			<span :class="$style.symbol">{{ newToken.symbol }}</span>
			<span :class="$style.type_label">MINTING...</span>
		</Flex>
		<Spinner size="14" color="--txt-tertiary" />
	</Flex>
</template>

<style module>
.row {
	display: flex;
	align-items: center;
	justify-content: space-between;

	padding: 16px 0;
	cursor: pointer;
	text-decoration: none;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: rgba(29, 27, 26, 0.5);
	}
}

.minting {
	opacity: 0.5;
	pointer-events: none;
}

.symbol {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	letter-spacing: -0.02em;
	color: var(--txt-primary);
}

.type_label {
	font-family: var(--font-mono);
	font-size: 10px;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.amount {
	font-family: var(--font-mono);
	font-size: 14px;
	font-weight: 500;
	color: var(--txt-primary);
}

.detail {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-outline);
}

.loading_block {
	min-height: 32px;
}

.loading_text {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);
}
</style>
