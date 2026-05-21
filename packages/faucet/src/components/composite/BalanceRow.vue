<script setup lang="ts">
import { computed } from "vue"
import { formatBigInt } from "@/lib/format"
import { TESTIDS } from "@/lib/testids"

const props = defineProps<{
	publicBalance: bigint | null
	privateBalance: bigint | null
	decimals: number
	loading?: boolean
}>()

const publicText = computed(() => render(props.publicBalance))
const privateText = computed(() => render(props.privateBalance))

function render(value: bigint | null): string {
	if (value === null) return props.loading ? "…" : "—"
	return formatBigInt(value, props.decimals)
}
</script>

<template>
	<div class="row">
		<div class="cell">
			<span class="label">balance · public</span>
			<span class="value" :data-testid="TESTIDS.balancePublic">{{ publicText }}</span>
		</div>
		<div class="cell">
			<span class="label">balance · private</span>
			<span class="value" :data-testid="TESTIDS.balancePrivate">{{ privateText }}</span>
		</div>
	</div>
</template>

<style scoped>
.row {
	display: flex;
	gap: 32px;
	padding: 12px 0;
	border-top: 1px solid var(--nulo-outline);
	border-bottom: 1px solid var(--nulo-outline);
}

.cell {
	display: flex;
	flex-direction: column;
	gap: 4px;
	flex: 1;
}

.label {
	color: var(--txt-secondary);
	font: 500 11px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
}

.value {
	color: var(--txt-primary);
	font: 500 18px/1.2 var(--font-mono);
}
</style>
