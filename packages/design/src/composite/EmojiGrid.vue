<script setup lang="ts">
/**
 * Presentational verification grid. The parent splits the emoji string into
 * `cells` (e.g. via the app's `toGrid`) and supplies the data-testids to emit.
 * This component owns no app utilities or testid registry.
 */
defineProps<{
	cells: string[]
	testId?: string
	cellTestId?: (i: number) => string
}>()
</script>

<template>
	<div class="emoji-grid" :data-testid="testId" role="img" aria-label="Verification grid">
		<span
			v-for="(cell, i) in cells"
			:key="i"
			class="cell"
			:data-testid="cellTestId ? cellTestId(i) : undefined"
		>{{ cell }}</span>
	</div>
</template>

<style scoped>
.emoji-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 8px;
	padding: 16px;
	background: var(--nulo-surface-low);
	border: 1px solid var(--nulo-outline);
	width: fit-content;
}

.cell {
	width: 56px;
	height: 56px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 28px;
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-outline);
}
</style>
