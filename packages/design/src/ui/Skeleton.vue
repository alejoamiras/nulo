<script setup lang="ts">
import { computed } from "vue"

/**
 * Placeholder block for a value that is known to exist but has not arrived. Decorative: the
 * surrounding region owns the accessible loading state, so the block itself is `aria-hidden`.
 */
const props = withDefaults(defineProps<{ width?: string | number; height?: string | number }>(), {
	width: 60,
	height: 12,
})

// A template attribute delivers a number as a string: numeric strings are px too, so `width="60"` works.
const toLength = (v: string | number) => (typeof v === "number" || /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v)

const styles = computed(() => ({ width: toLength(props.width), height: toLength(props.height) }))
</script>

<template>
	<span :class="$style.skeleton" :style="styles" aria-hidden="true" />
</template>

<style module>
.skeleton {
	display: inline-block;
	flex-shrink: 0;

	background: linear-gradient(
		90deg,
		var(--nulo-surface-high) 25%,
		var(--nulo-surface) 50%,
		var(--nulo-surface-high) 75%
	);
	background-size: 200% 100%;

	animation: nulo_skeleton 1.5s infinite;
}

@keyframes nulo_skeleton {
	0% {
		background-position: 200% 0;
	}
	100% {
		background-position: -200% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.skeleton {
		animation: none;
	}
}
</style>
