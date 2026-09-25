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
})

// The bubble mounts only while open and a description created after focus is not reliably announced,
// so the term points at a hidden copy that is always mounted.
const descriptionId = useId()
const definition = computed(() => GLOSSARY[props.term]?.definition ?? "")
</script>

<template>
	<Tooltip inline :position="position" textAlign="left" delay="300">
		<span tabindex="0" :aria-describedby="descriptionId" :data-testid="testid" :class="$style.term"><slot /></span>
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

.definition {
	display: block;
	line-height: 1.2;
	color: var(--nulo-secondary);
}
</style>
