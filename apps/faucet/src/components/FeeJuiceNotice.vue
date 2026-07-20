<script setup lang="ts">
/** Utils */
import { TESTIDS } from "@/lib/testids"
</script>

<template>
	<aside class="fj-notice" :data-testid="TESTIDS.feeJuiceNotice">
		<span class="t">⚠ ONE-WAY GAS</span>
		<span class="d">
			Fee Juice cannot be withdrawn or transferred once bridged. Bridge small amounts — top up again whenever you run low.
		</span>
	</aside>
</template>

<style scoped>
.fj-notice {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px;
	border-left: 3px solid var(--orange);
	background: color-mix(in srgb, var(--orange) 6%, transparent);
}

.t {
	font: 600 11px/1 var(--font-mono);
	letter-spacing: 0.08em;
	color: var(--orange);
}

.d {
	font: 500 12px/1.5 var(--font-mono);
	color: var(--txt-secondary);
}
</style>
