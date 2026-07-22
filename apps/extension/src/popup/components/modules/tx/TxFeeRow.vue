<script setup>
/**
 * Fee row inside the tx-detail "Details" box. Renders a chevron-toggle
 * header with the fee value + USD aux, and an optional gas-breakdown
 * grid below. Used twice in tx/[id].vue: once for "Fee paid" (after
 * the receipt lands) and once for "Estimated fee" (pre-confirmation
 * snapshot). The two callers differ only in label + estimated styling
 * + the savings line.
 */
defineProps({
	label: { type: String, required: true },
	feeAmount: { type: String, default: null },
	feeUsd: { type: String, default: null },
	estimated: { type: Boolean, default: false },
	gasBreakdown: { type: Object, default: null },
	estimatedFee: { type: String, default: null },
	/** USD of the estimate at today's rate — mirrors the paid row's unit
	 *  grammar so FJ compares to FJ and $ to $ across adjacent rows. */
	estimatedFeeUsd: { type: String, default: null },
	feeSavings: { type: String, default: null },
})

const expanded = defineModel({ type: Boolean, default: false })
</script>

<template>
	<Flex wide direction="column" gap="8">
		<button
			type="button"
			:class="[$style.fee_row_toggle, !gasBreakdown && $style.fee_row_static]"
			:disabled="!gasBreakdown"
			@click="gasBreakdown && (expanded = !expanded)"
		>
			<Flex align="center" gap="4">
				<span :class="$style.detail_key">{{ label }}</span>
				<Icon
					v-if="gasBreakdown"
					name="chevron"
					size="10"
					color="tertiary"
					:style="{
						transform: `rotate(${expanded ? '180' : '0'}deg)`,
						transition: 'transform 0.2s ease',
					}"
				/>
			</Flex>
			<Flex align="center" gap="6">
				<span :class="[$style.detail_value_mono, estimated && $style.detail_value_est]">
					{{ estimated ? `~${feeAmount}` : feeAmount }} FJ
				</span>
				<span v-if="feeUsd" :class="$style.detail_value_aux" title="At today's AZTEC price" data-testid="tx-fee-usd">{{
					feeUsd
				}}</span>
			</Flex>
		</button>

		<Flex v-if="expanded && gasBreakdown" wide direction="column" gap="6" :class="$style.fee_breakdown">
			<div :class="$style.fee_grid">
				<span :class="$style.fee_grid_key">L2 gas</span>
				<span :class="[$style.fee_grid_num, $style.fee_grid_aux]">{{ gasBreakdown.l2Gas }}</span>
				<span :class="[$style.fee_grid_num, $style.fee_grid_val]">{{ gasBreakdown.l2Cost }} FJ</span>

				<span :class="$style.fee_grid_key">DA gas</span>
				<span :class="[$style.fee_grid_num, $style.fee_grid_aux]">{{ gasBreakdown.daGas }}</span>
				<span :class="[$style.fee_grid_num, $style.fee_grid_val]">{{ gasBreakdown.daCost }} FJ</span>

				<template v-if="gasBreakdown.hasTeardown">
					<span :class="$style.fee_grid_key">Teardown</span>
					<span :class="[$style.fee_grid_num, $style.fee_grid_aux]">
						{{ gasBreakdown.teardownL2Gas }} + {{ gasBreakdown.teardownDaGas }}
					</span>
					<span :class="[$style.fee_grid_num, $style.fee_grid_val]">{{ gasBreakdown.teardownCost }} FJ</span>
				</template>
			</div>
			<Flex v-if="estimatedFee" wide justify="between" align="center" :class="$style.fee_breakdown_divider">
				<span :class="$style.fee_grid_key">Estimated</span>
				<!-- fee_grid_num carries the mono face — without it this row
				     renders in the default font and clashes with FEE PAID. -->
				<span :class="[$style.fee_grid_num, $style.fee_grid_val]"
					>{{ estimatedFee }} FJ<template v-if="estimatedFeeUsd">
						<span :class="$style.fee_grid_aux" title="At today's AZTEC price" data-testid="tx-estimate-usd"> ({{ estimatedFeeUsd }})</span>
					</template></span
				>
			</Flex>
			<Flex v-if="feeSavings" wide justify="end">
				<span :class="$style.fee_savings">{{ feeSavings }}</span>
			</Flex>
		</Flex>
	</Flex>
</template>

<style module>
.detail_key {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.detail_value_mono {
	font-family: var(--font-mono);
	font-size: 12px;
	font-weight: 600;
	color: var(--txt-primary);
}

.detail_value_est {
	color: var(--nulo-secondary);
}

.detail_value_aux {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-outline);
}

.fee_row_toggle {
	display: flex;
	align-items: center;
	justify-content: space-between;
	width: 100%;

	padding: 0;
	background: transparent;
	border: none;
	cursor: pointer;

	color: inherit;
	text-align: inherit;

	transition: opacity 0.2s ease;

	&:hover {
		opacity: 0.8;
	}
}

.fee_row_static {
	cursor: default;

	&:hover {
		opacity: 1;
	}
}

.fee_breakdown {
	padding-top: 8px;
	border-top: 1px solid var(--nulo-border);
}

.fee_grid {
	display: grid;
	grid-template-columns: auto 1fr auto;
	gap: 4px 10px;
	align-items: center;
}

.fee_grid_key {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.fee_grid_num {
	font-family: var(--font-mono);
	font-size: 11px;
	text-align: right;
}

.fee_grid_aux {
	color: var(--nulo-outline);
}

.fee_grid_val {
	color: var(--txt-primary);
	font-weight: 600;
}

.fee_breakdown_divider {
	padding-top: 6px;
	border-top: 1px solid var(--nulo-border);
}

.fee_savings {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--green);
}
</style>
