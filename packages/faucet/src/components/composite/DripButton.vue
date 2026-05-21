<script setup lang="ts">
import type { DripState } from "@/composables/useFaucetDrip"
import AppButton from "@/components/ui/AppButton.vue"

const props = withDefaults(
	defineProps<{
		state?: DripState
		label: string
		disabled?: boolean
	}>(),
	{ state: "idle", disabled: false },
)

const emit = defineEmits<{ click: [] }>()

function onClick() {
	emit("click")
}
</script>

<template>
	<AppButton
		variant="outline"
		:loading="state === 'dripping'"
		:disabled="disabled"
		:data-drip-state="state"
		@click="onClick"
	>
		<span v-if="state === 'idle'">{{ label }}</span>
		<span v-else-if="state === 'dripping'">Sending tx…</span>
		<span v-else-if="state === 'ok'">Sent</span>
		<span v-else>Failed — retry</span>
	</AppButton>
</template>
