<script setup lang="ts">
import { computed } from "vue"

/**
 * Canonical Spinner (design-system round-2 superset). Visual semantics from the extension's Spinner
 * (4s "material" multi-rotate, color-driven border) + the package's `role="status"`/`aria-label`
 * a11y. Default `color` is `currentColor` (the pre-round-2 package default) so a color-less caller
 * inherits its parent's text color rather than a fixed token.
 */
const props = withDefaults(defineProps<{ size?: string | number; color?: string; label?: string }>(), {
	size: "16",
	color: "currentColor",
	label: "Loading",
})

// A `--`-prefixed color is a CSS var name → wrap in var(); anything else (currentColor, a named
// color, a hex) is used verbatim.
const colorValue = computed(() => (props.color.startsWith("--") ? `var(${props.color})` : props.color))

const calcStyles = computed(() => {
	const px = `${props.size || 16}px`
	return {
		width: px,
		height: px,
		minWidth: px,
		minHeight: px,
		borderColor: `color-mix(in srgb, ${colorValue.value} 10%, transparent)`,
		borderTopColor: colorValue.value,
	}
})
</script>

<template>
	<div :class="$style.wrapper" :style="calcStyles" role="status" :aria-label="label" />
</template>

<style module>
.wrapper {
	border-radius: 100px;
	border: 2px solid;
	border-top: 2px solid;
	animation: material-spinner 4s infinite;
}

@keyframes material-spinner {
	0% {
		transform: rotate(0deg);
	}
	25% {
		transform: rotate(360deg);
	}
	50% {
		transform: rotate(720deg);
	}
	75% {
		transform: rotate(1080deg);
	}
	100% {
		transform: rotate(1440deg);
	}
}
</style>
