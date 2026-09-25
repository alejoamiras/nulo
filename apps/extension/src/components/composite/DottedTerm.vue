<script setup lang="ts">
/** Vendor */
import type { PropType } from "vue"

/** Utils */
import { GLOSSARY, type GlossaryKey } from "@/utils/glossary"

const props = defineProps({
	term: {
		type: String as PropType<GlossaryKey>,
		required: true,
		validator: (key: string) => Object.hasOwn(GLOSSARY, key),
	},
	position: { type: String as PropType<"start" | "end" | "center">, default: "center" },
	testid: { type: String, default: undefined },
	/** A dotted button that does something, such as a rename link, instead of a term in a sentence. */
	action: { type: Boolean, default: false },
})

const emit = defineEmits<{ click: [event: MouseEvent] }>()

// The bubble mounts only while open and a description created after focus is not reliably announced,
// so the term points at a hidden copy that is always mounted.
const descriptionId = useId()
const definition = computed(() => GLOSSARY[props.term]?.definition ?? "")
</script>

<template>
	<Tooltip inline :position="position" textAlign="left" delay="300" :class="action && $style.action_host">
		<button
			v-if="action"
			type="button"
			:aria-describedby="descriptionId"
			:data-testid="testid"
			:class="$style.action"
			@click="(event: MouseEvent) => emit('click', event)"
		>
			<span :class="$style.action_label"><slot /></span>
		</button>
		<span v-else tabindex="0" :aria-describedby="descriptionId" :data-testid="testid" :class="$style.term"><slot /></span>
		<span :id="descriptionId" hidden>{{ definition }}</span>
		<template #content>
			<span :class="$style.definition">{{ definition }}</span>
		</template>
	</Tooltip>
</template>

<style module>
.term {
	text-decoration: underline dotted 1px;
	text-decoration-color: var(--nulo-outline);
	text-underline-offset: 3px;
	cursor: help;
}

.term:hover {
	text-decoration-color: var(--txt-primary);
}

.term:focus-visible {
	outline: 1px solid var(--txt-primary);
	outline-offset: 2px;
	text-decoration-color: var(--txt-primary);
}

/* Top of its line as drawn, and above a row's stretched target, as `RowAction` is. */
.action_host {
	align-self: flex-start;
	z-index: 1;
}

/* The padding makes the hit area 24px tall and the margin gives it back, so the label sits where
   the drawing puts the text. */
.action {
	display: block;

	padding: 7px 0;
	margin: -7px 0;
	border: 0;
	background: none;
	cursor: pointer;
	outline: none;

	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	line-height: normal;
	letter-spacing: 0.1em;
	text-align: left;
	text-transform: uppercase;
	color: var(--nulo-accent);
}

.action_label {
	display: block;

	text-decoration: underline dotted 1px;
	text-decoration-color: color-mix(in srgb, var(--nulo-accent), transparent 35%);
	text-underline-offset: 3px;
}

.action:hover .action_label {
	text-decoration-color: var(--nulo-accent);
}

.action:focus-visible .action_label {
	outline: 1px solid var(--txt-primary);
	outline-offset: 2px;
}

.definition {
	display: block;
	line-height: 1.2;
	color: var(--nulo-secondary);
}
</style>
