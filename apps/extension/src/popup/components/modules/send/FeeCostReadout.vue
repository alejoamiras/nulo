<script setup>
/**
 * "Estimated Network Fee" readout used inside `FeeSettingsCard`. Three
 * states:
 * - `isEstimating === true && no estimate` → stacked label + skeleton in the value slot
 * - `estimate` present                     → stacked label + amount (same geometry)
 * - otherwise                              → "Fee estimated after simulation" hint
 */
defineProps({
	estimate: { type: Object, default: null },
	isEstimating: { type: Boolean, default: false },
})
</script>

<template>
	<!-- Estimating and estimated share ONE geometry: the stacked label+value
	     layout is reserved from the first frame and the skeleton simply
	     occupies the value's slot — the row never moves or grows when the
	     number lands. -->
	<Flex v-if="isEstimating && !estimate" direction="column" gap="4" :class="$style.detail_row">
		<span :class="$style.fee_label">Estimated Network Fee</span>
		<span :class="$style.fee_value"><span :class="$style.skeleton" /></span>
	</Flex>
	<Flex v-else-if="estimate" direction="column" gap="4" :class="$style.detail_row">
		<span :class="$style.fee_label">Estimated Network Fee</span>
		<span :class="$style.fee_value">
			~{{ estimate.amount }} FJ<template v-if="estimate.usd">
				<span :class="$style.fee_usd" title="At today's AZTEC price" data-testid="fee-estimate-usd"> ({{ estimate.usd }})</span>
			</template>
		</span>
	</Flex>
	<Flex v-else align="center" gap="4" :class="$style.detail_row">
		<Icon name="info" size="12" color="tertiary" />
		<Text size="11" weight="500" color="tertiary">Fee estimated after simulation</Text>
	</Flex>
</template>

<style module>
.detail_row {
	background: transparent;
	overflow: hidden;
	border-top: 1px solid rgba(74, 70, 63, 0.2);

	padding: 10px 12px;
}

.fee_label {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--nulo-secondary);
}

.fee_value {
	font-family: var(--font-mono);
	font-size: 12px;
	color: var(--txt-primary);
}

.fee_usd {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);
}

.skeleton {
	display: inline-block;
	width: 60px;
	height: 12px;
	background: linear-gradient(
		90deg,
		var(--nulo-surface-high) 25%,
		var(--nulo-surface) 50%,
		var(--nulo-surface-high) 75%
	);
	background-size: 200% 100%;
	animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
	0% {
		background-position: 200% 0;
	}
	100% {
		background-position: -200% 0;
	}
}
</style>
