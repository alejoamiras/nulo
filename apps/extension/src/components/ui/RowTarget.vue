<script setup lang="ts">
/**
 * A row's one focusable element: a link when `to` is set, otherwise a button with no handler
 * whose click bubbles to the row root's listener. It is stretched over the row so the controls
 * inside the row stay siblings above it, never descendants of a link or button. The ring is the
 * row's, drawn on `:has(> [data-row-target]:focus-visible)`.
 */
import { ref } from "vue"
import { RouterLink } from "vue-router"

defineProps({
	to: { type: String, default: undefined },
	/** The id of the element that names the row. */
	labelledby: { type: String, required: true },
})

const el = ref<HTMLElement | null>(null)

type Navigate = (e?: MouseEvent) => unknown

/** Space presses the link: `navigate` reads only the modifier flags, `defaultPrevented` and
 *  `button` (absent on a key), so a keydown passes its guard; no `.prevent` here, since the guard
 *  refuses an already-prevented event and prevents it itself when it navigates. */
const pressSpace = (navigate: Navigate, event: KeyboardEvent) => navigate(event as unknown as MouseEvent)

defineExpose({ activate: () => el.value?.click() })
</script>

<template>
	<RouterLink v-if="to" :to custom v-slot="{ href, navigate }">
		<a
			ref="el"
			:href
			:aria-labelledby="labelledby"
			data-row-target
			:class="$style.target"
			@click="navigate"
			@keydown.space="pressSpace(navigate, $event)"
		/>
	</RouterLink>
	<button v-else ref="el" type="button" :aria-labelledby="labelledby" data-row-target :class="$style.target" />
</template>

<style module>
.target {
	position: absolute;
	inset: 0;

	padding: 0;
	margin: 0;

	background: transparent;
	border: 0;
	cursor: pointer;
	outline: none;
}
</style>
