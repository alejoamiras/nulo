<script setup>
const props = defineProps({
	size: { type: String, default: "16" },
	color: { type: String, default: "--txt-inverse" },
})

// Resolve the color prop: a string starting with `--` is treated as a
// CSS variable name and wrapped in var(); anything else (including
// "currentColor", named colors, hex) is used as-is. This lets callers
// inherit their parent's text color via color="currentColor" instead
// of guessing which CSS var matches the parent's context.
const colorValue = computed(() => {
	const c = props.color
	return c.startsWith("--") ? `var(${c})` : c
})

const calcStyles = computed(() => {
	return {
		height: `${props.size || 16}px`,
		minHeight: `${props.size || 16}px`,
		width: `${props.size || 16}px`,
		minWidth: `${props.size || 16}px`,
		borderColor: `color-mix(in srgb, ${colorValue.value} 10%, transparent)`,
		borderTopColor: colorValue.value,
	}
})
</script>

<template>
	<div :class="$style.wrapper" :style="calcStyles" />
</template>

<style module>
.wrapper {
	border-radius: 100px;
	/* border: 2px var(--nulo-surface-highest) solid; */
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
