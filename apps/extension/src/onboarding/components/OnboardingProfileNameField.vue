<script setup>
import ProfileNameField from "@/components/composite/ProfileNameField.vue"

/** `focus()` is exposed so the page's name validation can return focus to the field on failure. */
defineProps({
	modelValue: { type: String, default: "" },
	error: { type: String, default: "" },
	shake: { type: Boolean, default: false },
})
const emit = defineEmits(["update:modelValue", "input"])
const fieldRef = ref(null)
defineExpose({ focus: () => fieldRef.value?.focus() })
</script>

<template>
	<Flex direction="column" gap="8">
		<Text size="11" weight="700" color="secondary" :class="$style.section_label">Profile name</Text>
		<ProfileNameField
			ref="fieldRef"
			:modelValue="modelValue"
			:error="error"
			:shake="shake"
			testid="onboarding-name-input"
			@update:modelValue="(value) => emit('update:modelValue', value)"
			@input="(event) => emit('input', event)"
		/>
	</Flex>
</template>

<style module>
.section_label {
	text-transform: uppercase;
	letter-spacing: 0.18em;
	font-family: var(--font-headline);
}
</style>
