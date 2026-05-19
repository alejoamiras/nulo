<script setup>
/**
 * Three-button priority selector ("Normal" / "Fast" / "Urgent") that
 * sits beneath the fee method readouts inside `FeeSettingsCard`.
 * Levels are static so the component owns the list (the parent only
 * needs the v-model'd selection).
 */
const PRIORITY_LEVELS = [
	{ value: "normal", label: "Normal" },
	{ value: "fast", label: "Fast" },
	{ value: "urgent", label: "Urgent" },
]

defineProps({
	modelValue: { type: String, default: "normal" },
})

const emit = defineEmits(["update:modelValue"])
</script>

<template>
	<Flex direction="column" gap="8" :class="$style.detail_row">
		<span :class="$style.fee_label">Priority</span>
		<div :class="$style.priority_grid">
			<button
				v-for="level in PRIORITY_LEVELS"
				:key="level.value"
				@click="emit('update:modelValue', level.value)"
				:data-testid="`send-fee-priority-${level.value}`"
				:class="[$style.priority_btn, modelValue === level.value && $style.priority_active]"
			>
				{{ level.label }}
			</button>
		</div>
	</Flex>
</template>

<style module>
.detail_row {
	background: transparent;
	overflow: hidden;
	border-top: 1px solid rgba(74, 70, 63, 0.2);

	padding: 10px 12px;
}

.fee_label {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--nulo-secondary);
}

.priority_grid {
	display: grid;
	grid-template-columns: 1fr 1fr 1fr;
	gap: 8px;
}

.priority_btn {
	padding: 6px 0;
	cursor: pointer;

	font-family: var(--font-mono);
	font-size: 9px;
	font-weight: 500;
	text-transform: uppercase;
	text-align: center;
	color: var(--nulo-secondary);

	background: transparent;
	border: 1px solid #231f1c;

	transition: all 0.15s ease;

	&:hover {
		border-color: var(--nulo-accent);
	}
}

.priority_active {
	border-color: var(--nulo-accent);
	color: var(--txt-primary);
}
</style>
