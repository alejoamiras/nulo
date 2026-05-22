<script setup lang="ts">
import AppButton from "@/components/ui/AppButton.vue"

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
	<AppButton
		variant="outline"
		:loading="loading"
		:disabled="disabled"
		:data-loading="loading"
		:aria-label="ariaLabel || label"
		@click="onClick"
	>
		{{ label }}
	</AppButton>
</template>
