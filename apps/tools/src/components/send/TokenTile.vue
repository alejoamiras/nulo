<script setup lang="ts">
/** Utils */
import { computed } from "vue"
import { formatBigInt, trimAddress } from "@/lib/format"
import type { SelectableToken } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"
import { checksumAddress, safeDisplay } from "@/lib/token-display"
import { hasSprite } from "./token-sprite"

const props = defineProps<{
	token: SelectableToken
	selected: boolean
	balance?: bigint
	/** Overrides the token's own decimals when the balance is read in a different unit. */
	decimals?: number
}>()
const emit = defineEmits<{ select: [] }>()

const sprite = computed(() => hasSprite(props.token.logoKey))

// Every string on this row can come from a remote list or a pasted contract; none of it reaches the
// DOM unsanitized, and none of it may grow long enough to push the address out of view.
const symbol = computed(() => safeDisplay(props.token.symbol))
const name = computed(() => safeDisplay(props.token.name))

/** The identity the symbol only claims to be. Shown for every row the app does not publish itself —
 *  a list can label any address "USDC", and the address is the part that cannot lie. */
const address = computed(() => (props.token.source === "manifest" ? null : trimAddress(checksumAddress(props.token.address), 8, 6)))

const initials = computed(() => symbol.value.slice(0, 2).toUpperCase() || "??")

// A token with no committed mark still needs a STABLE identity: the hue is derived from the
// chain-qualified key, never from the symbol, so two tokens claiming one ticker never look alike.
const hue = computed(() => {
	let hash = 0
	for (const char of props.token.logoKey) hash = (hash * 31 + char.charCodeAt(0)) % 360
	return hash
})

const monogramStyle = computed(() => ({
	background: `repeating-linear-gradient(135deg, hsl(${hue.value} 55% 42%) 0 6px, hsl(${hue.value} 55% 32%) 6px 12px)`,
}))

// A pasted token carries `decimals: -1` until the selection step reads them; formatting against that
// sentinel would render a nonsense balance, so the row simply shows none.
const balanceText = computed(() => {
	const decimals = props.decimals ?? props.token.decimals
	if (props.balance === undefined || decimals < 0) return null
	return formatBigInt(props.balance, decimals)
})
</script>

<template>
	<button
		type="button"
		role="option"
		class="tile"
		:data-testid="TESTIDS.sendTokenTile"
		:data-key="token.logoKey"
		:data-selected="selected || undefined"
		:aria-selected="selected"
		@click="emit('select')"
	>
		<svg v-if="sprite" class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false" :data-testid="TESTIDS.sendTokenLogo">
			<use :href="`#${token.logoKey}`" />
		</svg>
		<span v-else class="mark monogram" aria-hidden="true" :style="monogramStyle" :data-testid="TESTIDS.sendTokenMonogram" :data-hue="hue">
			{{ initials }}
		</span>
		<span class="ident">
			<span class="symbol">{{ symbol }}</span>
			<span v-if="address" class="address" :data-testid="TESTIDS.sendTokenAddress" :title="checksumAddress(token.address)">
				{{ address }}
			</span>
			<span class="name">{{ name }}</span>
		</span>
		<span class="trail">
			<span v-if="balanceText !== null" class="balance">{{ balanceText }}</span>
			<span class="source" :data-testid="TESTIDS.sendTokenSource" :data-source="token.source">{{ token.source }}</span>
		</span>
	</button>
</template>

<style scoped>
.tile {
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	padding: 10px 12px;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-primary);
	text-align: left;
	cursor: pointer;
}

.tile:hover,
.tile:focus-visible {
	border-color: var(--nulo-accent);
}

.tile[data-selected] {
	border-color: var(--nulo-accent);
	background: var(--nulo-surface-low);
}

.mark {
	flex: none;
	width: 28px;
	height: 28px;
}

.monogram {
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--txt-white);
	font: 700 11px/1 var(--font-mono);
	letter-spacing: 0.04em;
}

.ident {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.symbol {
	font: 600 13px/1.2 var(--font-mono);
	color: var(--txt-primary);
}

.address {
	font: 500 10px/1.2 var(--font-mono);
	color: var(--txt-tertiary);
	letter-spacing: 0.02em;
}

.name {
	font: 500 11px/1.2 var(--font-mono);
	color: var(--txt-secondary);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.trail {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-left: auto;
}

.balance {
	font: 500 12px/1 var(--font-mono);
	color: var(--txt-primary);
}

.source {
	font: 600 10px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--txt-tertiary);
	border: 1px solid var(--nulo-border);
	padding: 3px 5px;
}
</style>
