<script setup>
/**
 * A default token that is not a token row yet. Inert on purpose: there is no token id to open,
 * so it is a `div` — never a link, never a picker option. Every string it shows is a compiled-in
 * literal from the seed list; chain data only ever reaches the real `TokenCard`.
 */

/** Components */
import { Skeleton } from "@nulo/design"

const props = defineProps({
	entry: {
		type: Object,
		required: true,
	},
})
const emit = defineEmits(["retry"])

const isWorking = computed(() => props.entry.status === "pending" || props.entry.status === "seeding")
const isFailed = computed(() => props.entry.status === "failed")
const reason = computed(() => (isFailed.value ? "Couldn't set up" : "Couldn't verify"))
</script>

<template>
	<div
		data-testid="token-seed-row"
		:data-status="entry.status"
		:data-symbol="entry.symbol"
		:aria-busy="isWorking || undefined"
		:class="$style.row"
	>
		<Flex direction="column" gap="2">
			<span :class="[$style.symbol, !isWorking && $style.dimmed]">{{ entry.symbol }}</span>
			<span v-if="isWorking" :class="$style.sub">{{ entry.displayName }}</span>
			<span v-else :class="$style.reason" data-testid="token-seed-reason">{{ reason }}</span>
		</Flex>

		<Flex v-if="isWorking" direction="column" align="end" justify="center" gap="5" :class="$style.loading_block">
			<Skeleton :width="64" :height="13" />
			<Skeleton :width="92" :height="9" />
		</Flex>
		<button v-else-if="isFailed" type="button" @click="emit('retry')" data-testid="token-seed-retry" :class="$style.retry">
			RETRY
		</button>
	</div>
</template>

<style module>
.row {
	display: flex;
	align-items: center;
	justify-content: space-between;

	padding: 8px 0;
}

.symbol {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	letter-spacing: -0.02em;
	color: var(--txt-primary);
}

.dimmed {
	opacity: 0.55;
}

.sub {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);
}

.reason {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--red);
}

.loading_block {
	min-height: 32px;
}

.retry {
	height: 28px;
	padding: 0 12px;
	background: transparent;
	box-shadow: inset 0 0 0 1px var(--nulo-outline);

	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	color: var(--nulo-accent);
	cursor: pointer;

	transition: box-shadow 0.2s var(--bezier);

	&:hover {
		box-shadow: inset 0 0 0 1px var(--nulo-accent);
	}

	&:focus-visible {
		outline: 2px solid var(--nulo-accent);
		outline-offset: 2px;
	}
}
</style>
