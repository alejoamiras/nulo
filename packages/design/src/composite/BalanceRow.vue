<script setup lang="ts">
/**
 * Presentational balance row. Receives already-formatted strings + the
 * data-testids to emit; the parent owns the bigint formatting + loading state.
 */
defineProps<{
	publicText: string
	privateText: string
	publicTestId?: string
	privateTestId?: string
}>()
</script>

<template>
	<div class="row">
		<!-- Order matches the wallet popup convention: private first, public second. -->
		<div class="cell">
			<span class="label">balance · private</span>
			<span class="value" :data-testid="privateTestId">{{ privateText }}</span>
		</div>
		<div class="cell">
			<span class="label">balance · public</span>
			<span class="value" :data-testid="publicTestId">{{ publicText }}</span>
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
