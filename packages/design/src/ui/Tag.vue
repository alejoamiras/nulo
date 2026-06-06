<script setup lang="ts">
type Tone = "neutral" | "test" | "warn"

withDefaults(defineProps<{ tone?: Tone }>(), { tone: "neutral" })
</script>

<template>
	<span :class="['tag', `tag--${tone}`]">
		<slot />
	</span>
</template>

<style scoped>
.tag {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 4px 8px;
	border: 1px solid var(--nulo-outline);
	font-family: var(--font-mono);
	font-size: 11px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--txt-secondary);
	background: var(--nulo-surface-low);
}

.tag--test {
	color: var(--sand);
	border-color: var(--sand);
}

.tag--warn {
	color: var(--yellow);
	border-color: var(--yellow);
}
</style>
