<script setup>
/** `focus()` is exposed so the page's name validation can return focus to the field on failure. */
defineProps({
	modelValue: { type: String, default: "" },
	error: { type: String, default: "" },
	shake: { type: Boolean, default: false },
})
const emit = defineEmits(["update:modelValue", "input"])
const inputRef = ref(null)
defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<template>
	<Flex direction="column" gap="8">
		<Text size="11" weight="700" color="secondary" :class="$style.section_label">Profile name</Text>
		<div :class="[shake && $style.shake]">
			<!-- `Input` emits no `input` of its own; the listener rides the native event bubbling through its root. -->
			<Input
				ref="inputRef"
				:modelValue="modelValue"
				type="text"
				placeholder="My Profile"
				:maxLength="32"
				:error="!!error"
				:ariaInvalid="!!error"
				sanitize
				data-testid="onboarding-name-input"
				@update:modelValue="(value) => emit('update:modelValue', value)"
				@input="(event) => emit('input', event)"
			/>
		</div>
		<Text v-if="error" size="12" color="red" height="150" role="alert">
			{{ error }}
		</Text>
	</Flex>
</template>

<style module>
.section_label {
	text-transform: uppercase;
	letter-spacing: 0.18em;
	font-family: var(--font-headline);
}

@keyframes shakeInput {
	0% { transform: translateX(0); }
	20% { transform: translateX(-4px); }
	40% { transform: translateX(4px); }
	60% { transform: translateX(-3px); }
	80% { transform: translateX(2px); }
	100% { transform: translateX(0); }
}

.shake {
	animation: shakeInput 0.4s ease;
}
</style>
