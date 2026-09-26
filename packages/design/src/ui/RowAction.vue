<script setup lang="ts">
/**
 * A control inside a row that is its own target: a 24×24 box above the row's stretched target,
 * whose click never reaches the row. A button, or an external link when `href` is set.
 */
defineProps({
	/** The accessible name; the box shows only a glyph. */
	label: { type: String, required: true },
	href: { type: String, default: undefined },
})
</script>

<template>
	<a v-if="href" :href :aria-label="label" target="_blank" rel="noopener noreferrer" :class="$style.action" @click.stop>
		<slot />
	</a>
	<button v-else type="button" :aria-label="label" :class="$style.action" @click.stop>
		<slot />
	</button>
</template>

<style module>
.action {
	position: relative;
	z-index: 1;

	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;

	width: 24px;
	height: 24px;
	padding: 0;
	margin: 0;

	background: transparent;
	border: 0;
	cursor: pointer;
	text-decoration: none;

	&:disabled {
		cursor: default;
	}

	&:focus-visible {
		outline: 2px solid var(--nulo-accent);
		outline-offset: -2px;
	}

	& :where(svg) {
		transition: fill 0.2s var(--bezier);
	}

	/* `:where` holds this at two classes' weight, so a caller's own hover fill (a danger red) wins. */
	&:where(:not(:disabled)):is(:hover, :focus-visible) :where(svg) {
		fill: var(--txt-primary);
	}
}
</style>
