<script setup>
/**
 * The profile-name input with its shake wrapper and alert line, rendered as two roots so each shell
 * keeps its own container and label. `focus()` is exposed for the name validation's focus return.
 */
defineProps({
	modelValue: { type: String, default: "" },
	error: { type: String, default: "" },
	shake: { type: Boolean, default: false },
	testid: { type: String, required: true },
})
const emit = defineEmits(["update:modelValue", "input"])
const inputRef = ref(null)
defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<template>
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
			:data-testid="testid"
			@update:modelValue="(value) => emit('update:modelValue', value)"
			@input="(event) => emit('input', event)"
		/>
	</div>
	<Text v-if="error" size="12" color="red" height="150" role="alert">
		{{ error }}
	</Text>
</template>

<style module>
.shake {
	composes: shake_name from "./shake.module.css";
}
</style>
