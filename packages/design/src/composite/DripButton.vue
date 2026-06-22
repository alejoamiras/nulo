<script setup lang="ts">
import Button from "../ui/Button.vue"

const props = withDefaults(
	defineProps<{
		label: string
		ariaLabel?: string
		loading?: boolean
		disabled?: boolean
	}>(),
	{ loading: false, disabled: false },
)

const emit = defineEmits<{ click: [] }>()

function onClick() {
	emit("click")
}
</script>

<template>
	<!-- `Button` does NOT disable-on-loading, so disable explicitly on `disabled || loading` to keep a
	     drip button from re-firing mid-request. `data-loading` is the e2e probe. -->
	<Button
		variant="primary_outline"
		:loading="loading"
		:disabled="disabled || loading"
		:data-loading="loading"
		:aria-label="ariaLabel || label"
		@click="onClick"
	>
		{{ label }}
	</Button>
</template>
