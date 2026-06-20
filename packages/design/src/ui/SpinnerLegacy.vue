<script setup lang="ts">
/**
 * TEMPORARY (design-system round-2, D-FAUCET-DEFER). The faucet rides this preserved copy of the
 * pre-round-2 package Spinner (0.75s single-rotate, currentColor) so its look stays FROZEN while the
 * canonical `Spinner` is reconciled to the extension's 4s superset. Deleted in P7 when the faucet
 * flips to the canonical Spinner. Do NOT build new consumers on this.
 */
withDefaults(defineProps<{ size?: number; label?: string }>(), {
	size: 16,
	label: "Loading",
})
</script>

<template>
	<span class="spinner" role="status" :aria-label="label" :style="{ width: `${size}px`, height: `${size}px` }" />
</template>

<style scoped>
.spinner {
	display: inline-block;
	border: 2px solid currentColor;
	border-bottom-color: transparent;
	border-radius: 50%;
	animation: spin 0.75s linear infinite;
	box-sizing: border-box;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
