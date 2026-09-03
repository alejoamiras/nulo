<script setup lang="ts">
/** Utils */
import { computed, useTemplateRef } from "vue"
import type { SelectableToken } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"

/** Components */
import SpriteSheet from "./SpriteSheet.vue"
import TokenTile from "./TokenTile.vue"

const props = defineProps<{
	tokens: SelectableToken[]
	selected: SelectableToken | null
	/** Keyed by `logoKey` — an address alone would collide across chains. */
	balances?: Record<string, bigint>
	loading: boolean
	empty: boolean
}>()
const emit = defineEmits<{ select: [token: SelectableToken] }>()

const list = useTemplateRef<HTMLElement>("list")

// The listbox is ONE tab stop: the selected row carries it, and the first row when nothing is
// selected yet, so Tab never walks a list that can hold hundreds of tokens.
const rovingIndex = computed(() => {
	const key = props.selected?.logoKey
	const found = key === undefined ? -1 : props.tokens.findIndex((t) => t.logoKey === key)
	return found === -1 ? 0 : found
})

/** ↑/↓ move focus AND the selection together, the way the direction tablist does: a listbox whose
 *  focus and selection can drift apart reads one row to assistive tech while another is armed. */
function move(from: number, delta: number): void {
	const count = props.tokens.length
	if (count === 0) return
	const next = (from + delta + count) % count
	const token = props.tokens[next]
	if (!token) return
	emit("select", token)
	list.value?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus()
}
</script>

<template>
	<div class="wrap">
		<SpriteSheet />
		<p v-if="loading" class="note" aria-live="polite" :data-testid="TESTIDS.sendCatalogLoading">Loading tokens…</p>
		<div
			ref="list"
			class="list"
			role="listbox"
			aria-label="Tokens"
			:data-testid="TESTIDS.sendTokenList"
			:data-count="tokens.length"
		>
			<TokenTile
				v-for="(token, index) in tokens"
				:key="token.logoKey"
				:token="token"
				:selected="token.logoKey === selected?.logoKey"
				:balance="balances?.[token.logoKey]"
				:data-index="index"
				:tabindex="index === rovingIndex ? 0 : -1"
				@select="emit('select', token)"
				@keydown.down.prevent="move(index, 1)"
				@keydown.up.prevent="move(index, -1)"
			/>
		</div>
		<p v-if="empty && !loading" class="note" :data-testid="TESTIDS.sendCatalogEmpty">
			No token matches that. Paste its Ethereum address to add it.
		</p>
	</div>
</template>

<style scoped>
.wrap {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.list {
	display: flex;
	flex-direction: column;
	gap: 6px;
	max-height: 320px;
	overflow-y: auto;
}

.note {
	margin: 0;
	font: 500 12px/1.5 var(--font-mono);
	color: var(--txt-secondary);
}
</style>
