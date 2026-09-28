<script setup>
import { UNVOUCHED_FEE_SENTENCE } from "@/components/composite/send/publish-facts"

const props = defineProps({
	estimate: { type: Object, default: null },
	isEstimating: { type: Boolean, default: false },
	/** Who pays an estimate. The parent decides: only it knows whether a sponsor is Nulo's own. */
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
			<span :class="$style.visually_hidden">{{ UNVOUCHED_FEE_SENTENCE }}</span>
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

.visually_hidden {
	composes: visually_hidden from "./fee-shared.module.css";
}

</style>
