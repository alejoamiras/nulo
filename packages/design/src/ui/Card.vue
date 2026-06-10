<script setup lang="ts">
</script>

<template>
	<section class="card">
		<slot />
	</section>
</template>

<style scoped>
.card {
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-outline);
	padding: 24px;
	display: flex;
	flex-direction: column;
	gap: 16px;
}
</style>
