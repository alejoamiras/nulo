<script setup>
/** The chevron link back to the welcome step; the two profile pages differ only in their testid. */
defineProps({
	testid: { type: String, required: true },
})
const router = useRouter()
</script>

<template>
	<button type="button" :class="$style.back" :data-testid="testid" @click="router.push('/onboarding/welcome')">
		<MaterialIcon name="chevron_left" :size="14" />
		<span>Back</span>
	</button>
</template>

<style module>
.back {
	align-self: flex-start;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	background: transparent;
	border: none;
	color: var(--txt-secondary);
	font-family: var(--font-mono);
	font-size: 11px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	cursor: pointer;
	padding: 4px 8px 4px 0;
	transition: color 0.15s var(--bezier);
}

.back:hover {
	color: var(--txt-primary);
}

.back:focus-visible {
	outline: 2px dotted var(--nulo-accent);
	outline-offset: 2px;
	color: var(--txt-primary);
}
</style>
