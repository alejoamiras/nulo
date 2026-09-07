<script setup>
/** A list page's fetch states: the loading line, else the error banner with its retry, else nothing. */
defineProps({
	loading: { type: Boolean, default: false },
	error: { default: null },
	label: { type: String, required: true },
})
const emit = defineEmits(["retry"])
</script>

<template>
	<LoadingState v-if="loading" :label="label" />

	<Tooltip v-else-if="error" wide>
		<Banner :action="{ name: 'Try again', callback: () => emit('retry') }" variant="error" wide>
			Something went wrong
		</Banner>
		<template #content>{{ error }}</template>
	</Tooltip>
</template>
