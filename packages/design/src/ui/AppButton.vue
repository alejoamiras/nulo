<script setup lang="ts">
// Frozen on SpinnerLegacy through round-2 (D-FAUCET-DEFER): AppButton is faucet-only (faucet direct
// buttons + DripButton); keeping its spinner on the legacy 0.75s look avoids a faucet visual change
// before the P7 cutover. Flips to the canonical Spinner in P7.
import Spinner from "./SpinnerLegacy.vue"

type Variant = "primary" | "outline" | "ghost"

const props = withDefaults(
	defineProps<{
		variant?: Variant
		disabled?: boolean
		loading?: boolean
		type?: "button" | "submit"
	}>(),
	{
		variant: "primary",
		disabled: false,
		loading: false,
		type: "button",
	},
)

const emit = defineEmits<{ click: [evt: MouseEvent] }>()

function onClick(evt: MouseEvent) {
	if (props.disabled || props.loading) return
	emit("click", evt)
}
</script>

<template>
	<button
		:type="type"
		:class="['btn', `btn--${variant}`, { 'btn--loading': loading }]"
		:disabled="disabled || loading"
		:aria-busy="loading || undefined"
		@click="onClick"
	>
		<Spinner v-if="loading" class="btn__spinner" :size="14" />
		<span class="btn__label"><slot /></span>
	</button>
</template>

<style scoped>
.btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 12px 18px;
	font-family: var(--font-headline);
	font-weight: 600;
	font-size: 14px;
	letter-spacing: 0.02em;
	text-transform: uppercase;
	border: 1px solid transparent;
	transition: opacity 0.15s var(--bezier), background 0.15s var(--bezier), color 0.15s var(--bezier);
}

.btn:disabled {
	opacity: 0.5;
}

.btn--primary {
	background: var(--btn-primary-bg);
	color: var(--txt-inverse);
}

.btn--primary:hover:not(:disabled) {
	opacity: 0.9;
}

.btn--outline {
	background: transparent;
	color: var(--txt-primary);
	border-color: var(--nulo-outline);
}

.btn--outline:hover:not(:disabled) {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.btn--ghost {
	background: transparent;
	color: var(--txt-secondary);
}

.btn--ghost:hover:not(:disabled) {
	color: var(--txt-primary);
}

.btn__spinner {
	flex-shrink: 0;
}
</style>
