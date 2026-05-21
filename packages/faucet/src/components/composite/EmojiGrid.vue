<script setup lang="ts">
import { computed } from "vue"
import { toGrid } from "@/lib/emoji"
import { TESTIDS } from "@/lib/testids"

const props = defineProps<{ emojis: string }>()

const cells = computed(() => toGrid(props.emojis))
</script>

<template>
	<div class="emoji-grid" :data-testid="TESTIDS.emojiGrid" role="img" aria-label="Verification grid">
		<span
			v-for="(cell, i) in cells"
			:key="i"
			class="cell"
			:data-testid="TESTIDS.emojiCell(i)"
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
