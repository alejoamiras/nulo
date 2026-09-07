<script setup>
/**
 * Per-method "Available" detail row shown under the method dropdown
 * in `FeeSettingsCard`. Renders one of two variants based on the
 * selected method's `type`:
 *
 * - `fj`           — single Available row reading from gas balances
 * - `private_fpc`  — Available row reading from gas balances (private),
 *                    or a "Not available" hint when no PrivateFPC is
 *                    registered
 *
 * Sponsored FPC rows render nothing extra. The Token-FPC visibility
 * (Public/Private) toggle was removed alongside the deprecated type.
 */
defineProps({
	method: { type: Object, default: null },
	isLoading: { type: Boolean, default: false },
	/** Null = balance unknown (read failed/timed out) — rendered as an em
	 *  dash, never as a fabricated zero. */
	feeJuiceBalanceFormatted: { type: String, default: null },
	privateFeeJuiceFormatted: { type: String, default: null },
})
</script>

<template>
	<!-- Fee Juice details -->
	<Flex v-if="method?.type === 'fj'" align="center" justify="between" :class="$style.detail_row">
		<Text size="12" weight="600" color="secondary">Available</Text>
		<span v-if="isLoading" :class="$style.skeleton" />
		<Text v-else size="12" weight="600" color="primary">
			{{ feeJuiceBalanceFormatted ?? '—' }} Fee Juice
		</Text>
	</Flex>

	<!-- Private Fee Juice (PrivateFPC) details -->
	<Flex v-else-if="method?.type === 'private_fpc'" align="center" justify="between" :class="$style.detail_row">
		<Text size="12" weight="600" color="secondary">Available</Text>
		<span v-if="isLoading" :class="$style.skeleton" />
		<template v-else-if="method.fpc">
			<Text size="12" weight="600" color="primary">
				{{ privateFeeJuiceFormatted ?? '—' }} FJ
			</Text>
		</template>
		<template v-else>
			<Text size="12" weight="600" color="secondary">Not available</Text>
		</template>
	</Flex>
</template>

<style module>
.detail_row {
	composes: detail_row from "./fee-shared.module.css";
}

.skeleton {
	composes: skeleton from "./fee-shared.module.css";
}

</style>
