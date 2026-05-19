<script setup>
/**
 * "Estimated Network Fee" readout used inside `FeeSettingsCard`. Three
 * states:
 * - `isEstimating === true && no estimate` → label + skeleton bar
 * - `estimate` present                     → label + amount
 * - otherwise                              → "Fee estimated after simulation" hint
 */
defineProps({
	estimate: { type: Object, default: null },
	isEstimating: { type: Boolean, default: false },
})
</script>

<template>
	<Flex v-if="isEstimating && !estimate" align="center" justify="between" :class="$style.detail_row">
		<span :class="$style.fee_label">Estimated Network Fee</span>
		<span :class="$style.skeleton" />
	</Flex>
	<Flex v-else-if="estimate" align="center" justify="between" :class="$style.detail_row">
		<span :class="$style.fee_label">Estimated Network Fee</span>
		<span :class="$style.fee_value">~{{ estimate.amount }} FJ</span>
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
