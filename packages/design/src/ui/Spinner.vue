<script setup lang="ts">
withDefaults(defineProps<{ size?: number; label?: string }>(), {
	size: 16,
	label: "Loading",
})
</script>

<template>
	<span
		class="spinner"
		role="status"
		:aria-label="label"
		:style="{ width: `${size}px`, height: `${size}px` }"
	/>
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
	to { transform: rotate(360deg); }
}
</style>
