<script setup>
const props = defineProps({
	title: {
		type: String,
		required: false,
	},
	description: {
		type: String,
		required: false,
	},
	/** Drop the bordered-surface shell; used by brutalist pages where
	 * the enclosing .section already provides structural separation. */
	flat: {
		type: Boolean,
		default: false,
	},
})
</script>

<template>
	<Flex direction="column" gap="12">
		<span v-if="title" :class="$style.title">{{ title }}</span>

		<Flex direction="column" :class="[$style.wrapper, flat && $style.wrapper_flat]">
			<slot />
		</Flex>

		<span v-if="description" :class="$style.description">{{ description }}</span>
	</Flex>
</template>

<style module>
.wrapper {
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
	overflow: hidden;
}

.wrapper_flat {
	background: transparent;
	border: none;
}

.title {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.description {
	font-family: var(--font-body);
	font-size: 12px;
	line-height: 1.5;
	color: var(--nulo-secondary);
}
</style>
