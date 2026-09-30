<script setup lang="ts">
/** The connect window's two steps, Connect then the emoji check, as a bar under the header. It holds
 *  no text and is hidden from assistive tech: the window's content already says which step it is. */
defineProps<{ step: 1 | 2 }>()
</script>

<template>
	<div :class="$style.bar" aria-hidden="true" data-testid="connect-step-bar" :data-step="step">
		<span v-for="n in 2" :key="n" :class="[$style.segment, n <= step && $style.filled]" :data-filled="n <= step" />
	</div>
</template>

<style module>
.bar {
	display: flex;
	flex-shrink: 0;
	gap: 4px;

	padding: 8px 16px 0;
}

.segment {
	flex: 1;
	height: 2px;
	background: var(--nulo-border);
}

.filled {
	background: var(--nulo-accent);
}
</style>
