<script setup>
/**
 * Reveal-on-click card for sensitive plaintext (recovery phrases,
 * account exports). Wraps the existing `<Input>` primitive with
 * show/hide + copy chip-style action buttons.
 *
 * Used by `pages/settings/security/export/seed.vue` and the
 * account-export popup. NOT suitable for `full.vue` — that page is a
 * backup pipeline (encryption + download), not a reveal+copy widget,
 * per decisions.md decision 4.
 *
 * Auto-close logic stays at the consumer level (each picks its own
 * lifetime). The card is purely the "show me / copy me" widget.
 */

defineProps({
	/** The secret text to display. The card never mutates this — it
	 *  only forwards through to Input as readOnly model. */
	value: { type: String, default: "" },
	/** Field label rendered above the input by Input itself. */
	label: { type: String, required: true },
	/** Test id for the card's wrapper (used by e2e to scope assertions). */
	testId: { type: String, default: undefined },
	/** Whether the copy chip should briefly flash a checkmark + "Copied"
	 *  label. Driven by the parent (the parent owns the clipboard write
	 *  + toast and toggles this flag). */
	isCopied: { type: Boolean, default: false },
})

const emit = defineEmits(["copy"])

const isVisible = ref(false)
const fieldType = computed(() => (isVisible.value ? "text" : "password"))
const toggleVisibility = () => {
	isVisible.value = !isVisible.value
}
</script>

<template>
	<div :class="$style.wrapper" :data-testid="testId">
		<Input
			:modelValue="value"
			:type="fieldType"
			:label="label"
			:placeholder="label"
		/>
		<Flex justify="end" gap="8">
			<button @click="toggleVisibility" type="button" :class="$style.action_chip">
				<Icon :name="isVisible ? 'eye-off' : 'eye'" size="14" color="secondary" />
				{{ isVisible ? "Hide" : "Show" }}
			</button>
			<button @click="emit('copy')" type="button" :class="$style.action_chip">
				<Icon :name="isCopied ? 'check' : 'copy'" size="14" :color="isCopied ? 'green' : 'secondary'" />
				{{ isCopied ? "Copied" : "Copy" }}
			</button>
		</Flex>
	</div>
</template>

<style module>
.wrapper {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.action_chip {
	display: inline-flex;
	align-items: center;
	gap: 6px;

	background: transparent;
	border: 1px solid var(--nulo-border);
	cursor: pointer;
	padding: 6px 10px;

	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--nulo-secondary);

	transition: all 0.15s var(--bezier);

	&:hover {
		border-color: var(--nulo-outline);
		color: var(--txt-primary);
	}
}
</style>
