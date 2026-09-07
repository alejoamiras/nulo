<script setup>
defineProps({
	title: { type: String, required: true },
	backTo: { type: String, required: true },
	/** Forwarded to the content column; absent means no gap class. */
	gap: { type: [String, Number], default: undefined },
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader :title="title" :backTo="backTo">
			<template v-if="$slots.trailing" #trailing><slot name="trailing" /></template>
		</SubPageHeader>

		<Flex direction="column" :gap="gap" :class="$style.content">
			<slot />
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	composes: wrapper from "./settings-page.module.css";
}

.content {
	composes: content from "./settings-page.module.css";
}
</style>
