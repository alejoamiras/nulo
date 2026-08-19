<script setup>
/**
 * Password-gate section for the recovery-phrase export page. Hosts the
 * "Unlock" label, the password input, and the inline "Wrong password"
 * indicator. The page owns the password state + unlock attempt; this
 * composite is the visual treatment.
 *
 * `v-model` ↔ password ref; `error` ↔ `isWrongPassword`. Resetting the
 * error on click/input matches the page's prior inline pattern.
 */
defineProps({
	modelValue: { type: String, default: undefined },
	error: { type: Boolean, default: false },
})

const emit = defineEmits(["update:modelValue", "clearError"])

const onInput = (val) => {
	emit("update:modelValue", val)
	if (val !== undefined) emit("clearError")
}
const onClick = () => emit("clearError")
</script>

<template>
	<div class="export_section_last">
		<span class="export_section_label">Unlock</span>
		<div :class="[error && $style.shake]">
			<Input
				:modelValue="modelValue"
				@update:modelValue="onInput"
				:error="error"
				:ariaInvalid="error"
				@click="onClick"
				type="password"
				label="Password"
				placeholder="Enter password"
				autofocus
				data-testid="unlock-password-input"
			/>
		</div>
		<Transition name="fade">
			<span
				v-if="error"
				:class="$style.error_text"
				role="alert"
				data-testid="unlock-error-text"
			>
				Wrong password
			</span>
		</Transition>
	</div>
</template>

<style module>
.error_text {
	font-family: var(--font-body);
	font-size: 12px;
	color: var(--red);
	margin-top: 4px;
	display: block;
}

@keyframes shakeInput {
	0% { transform: translateX(0); }
	20% { transform: translateX(-4px); }
	40% { transform: translateX(4px); }
	60% { transform: translateX(-3px); }
	80% { transform: translateX(2px); }
	100% { transform: translateX(0); }
}

.shake { animation: shakeInput 0.3s ease; }
</style>
