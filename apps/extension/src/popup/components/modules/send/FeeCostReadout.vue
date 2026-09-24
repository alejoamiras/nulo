<script setup>
/**
 * "You pay" readout used inside `FeeSettingsCard`. Three states:
 * - `isEstimating === true && no estimate` → stacked label + skeleton in the value slot
 * - `estimate` present                     → stacked label + what the account pays
 * - otherwise                              → "Fee estimated after simulation" hint
 *
 * `payer` says who pays an estimate: the account (`self`), Nulo's own sponsor (`sponsor`: "Nothing",
 * the waived fee struck through), or a fee contract added by hand (`unvouched`: a dash, since Nulo
 * cannot tell what such a contract charges).
 */
const props = defineProps({
	estimate: { type: Object, default: null },
	isEstimating: { type: Boolean, default: false },
	payer: { type: String, default: "self", validator: (v) => ["self", "sponsor", "unvouched"].includes(v) },
})

/** Screen readers skip a strikethrough, so the sponsored row is spoken as this sentence alone. */
const sponsoredSentence = computed(() => {
	const usd = props.estimate?.usd
	if (!usd) return `You pay nothing. The sponsor covers about ${props.estimate?.amount} FJ.`
	if (usd.startsWith("<")) return `You pay nothing. The sponsor covers less than ${usd.slice(1)}.`
	return `You pay nothing. The sponsor covers about ${usd}.`
})
</script>

<template>
	<!-- Estimating and estimated share ONE geometry: the stacked label+value
	     layout is reserved from the first frame and the skeleton simply
	     occupies the value's slot — the row never moves or grows when the
	     number lands. -->
	<Flex v-if="isEstimating && !estimate" direction="column" gap="4" :class="$style.detail_row">
		<span :class="$style.fee_label">You pay</span>
		<span :class="$style.fee_value"><span :class="$style.skeleton" /></span>
	</Flex>
	<Flex v-else-if="estimate" direction="column" gap="4" :class="$style.detail_row">
		<span :class="$style.fee_label" :aria-hidden="payer === 'sponsor' ? 'true' : undefined">You pay</span>
		<span v-if="payer === 'sponsor'" :class="$style.fee_value">
			<span aria-hidden="true">
				<span :class="$style.nothing">Nothing</span> <s :class="$style.fee_usd">~{{ estimate.amount }} FJ<span v-if="estimate.usd" title="At today's AZTEC price" data-testid="fee-estimate-usd"> ({{ estimate.usd }})</span></s>
			</span>
			<span :class="$style.visually_hidden">{{ sponsoredSentence }}</span>
		</span>
		<span v-else-if="payer === 'unvouched'" :class="$style.fee_value">
			<span aria-hidden="true">—</span>
			<span :class="$style.visually_hidden">Nulo can't tell what this fee contract charges you.</span>
		</span>
		<span v-else :class="$style.fee_value">
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
	composes: detail_row from "./fee-shared.module.css";
}

.fee_label {
	composes: fee_label from "./fee-shared.module.css";
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

.nothing {
	font-weight: 600;
}

.skeleton {
	composes: skeleton from "./fee-shared.module.css";
}

/* Read by screen readers, never drawn. */
.visually_hidden {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	padding: 0;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
	border: 0;
}

</style>
