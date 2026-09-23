<script setup>
/**
 * Terminal status block for list surfaces: the dashed "nothing here yet" card
 * (`empty`) or the flat search-miss line (`no-results`). Presentation only —
 * the page owns the conditions that pick which (if either) renders.
 */
defineProps({
	variant: { type: String, default: "empty" },
	/** Uppercase card headline; required for the `empty` variant. */
	headline: { type: String, default: "" },
	/** Optional supporting line under the headline. */
	sub: { type: String, default: "" },
	/** Forwarded as data-testid; omitted from the DOM when empty. */
	testid: { type: String, default: undefined },
})
</script>

<template>
	<div v-if="variant === 'empty'" :class="$style.empty" :data-testid="testid">
		<span :class="$style.empty_headline">{{ headline }}</span>
		<span v-if="sub" :class="$style.empty_sub">{{ sub }}</span>
	</div>
	<div v-else :class="$style.no_results" :data-testid="testid">
		<slot>NO MATCHES · TRY A DIFFERENT TERM</slot>
	</div>
</template>

<style module>
.empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;

	padding: 32px 16px;
	border: 1px dashed var(--nulo-border);

	text-align: center;
}

.empty_headline {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.empty_sub {
	width: 100%;
	font-family: var(--font-mono);
	font-size: 11px;
	line-height: 1.4;
	color: var(--nulo-outline);
	overflow-wrap: break-word;
}

.no_results {
	padding: 24px 16px;
	text-align: center;
	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.1em;
	color: var(--nulo-outline);
}
</style>
