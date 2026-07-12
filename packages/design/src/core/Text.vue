<script setup lang="ts">
import { computed, type PropType } from "vue"
import type { TextColorName } from "../color-names"
import type { TextAlign } from "../layout-names"
import type { FontSize, FontWeight } from "../tokens"

const props = defineProps({
	// Static Vue attrs arrive as strings (`size="13"`), dynamic binds as numbers (`:size="13"`) —
	// accept both the token and its stringified form.
	size: {
		type: String as PropType<FontSize | `${FontSize}`>,
	},
	weight: {
		type: String as PropType<FontWeight | `${FontWeight}`>,
	},
	// Line-height is an open scale (no token union); the class is `lh--${height}`.
	height: {
		type: String,
		default: "100",
	},
	align: {
		type: String as PropType<TextAlign>,
	},
	color: {
		type: String as PropType<TextColorName>,
	},
	noWrap: {
		type: Boolean,
	},
	mono: {
		type: Boolean,
		default: false,
	},
	tabular: {
		type: Boolean,
		default: false,
	},
	selectable: {
		type: Boolean,
		default: false,
	},
})

const classes = computed(() => {
	const flexClasses = []

	if (props.size) {
		flexClasses.push(`fz--${props.size}`)
	}
	if (props.weight) {
		flexClasses.push(`fw--${props.weight}`)
	}
	if (props.height) {
		flexClasses.push(`lh--${props.height}`)
	}
	if (props.align) {
		flexClasses.push(`ta--${props.align}`)
	}
	if (props.color) {
		flexClasses.push(`color--${props.color}`)
	}
	if (props.noWrap) {
		flexClasses.push("no-wrap")
	}
	if (props.mono) {
		flexClasses.push("mono")
	}
	if (props.tabular) {
		flexClasses.push("tabular")
	}
	if (props.selectable) {
		flexClasses.push("selectable")
	}

	return flexClasses
})
</script>

<template>
	<span :class="[classes]">
		<slot />
	</span>
</template>
