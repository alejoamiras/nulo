<script setup lang="ts">
/** Vendor */
import { ref, computed, type PropType } from "vue"
import type { FlexAlign, FlexDirection, FlexGap, FlexJustify, FlexWrap } from "../layout-names"

const wrapper = ref(null)
defineExpose({ wrapper })

const props = defineProps({
	tag: {
		default: "div",
	},
	to: {
		type: String,
		required: false,
	},
	align: {
		type: String as PropType<FlexAlign>,
		validator(value) {
			return ["center", "between", "around", "evenly", "start", "end"].includes(value as string)
		},
	},
	justify: {
		type: String as PropType<FlexJustify>,
		validator(value) {
			return ["center", "between", "around", "evenly", "start", "end"].includes(value as string)
		},
	},
	wrap: {
		type: String as PropType<FlexWrap>,
		validator(value) {
			return ["nowrap", "wrap", "wrapReverse"].includes(value as string)
		},
	},
	direction: {
		type: String as PropType<FlexDirection>,
		validator(value) {
			return ["column", "columnReversed", "row", "rowReversed"].includes(value as string)
		},
	},
	// Static Vue attrs arrive as strings (`gap="10"`); accept the token and its stringified form.
	gap: {
		type: String as PropType<FlexGap | `${FlexGap}`>,
	},
	wide: {
		type: Boolean,
		default: false,
	},
})

const classes = computed(() => {
	const flexClasses = ["flex"]

	if (props.align) {
		flexClasses.push(`items-${props.align}`)
	}
	if (props.justify) {
		flexClasses.push(`justify-${props.justify}`)
	}
	if (props.wrap) {
		flexClasses.push(`wrap-${props.wrap}`)
	}
	if (props.direction) {
		flexClasses.push(`flex-direction-${props.direction}`)
	}
	if (props.gap) {
		flexClasses.push(`gap--${props.gap}`)
	}
	if (props.wide) {
		flexClasses.push("flex-wide")
	}

	return flexClasses
})
</script>

<template>
	<component :is="tag" v-bind="{ to: to ? to : null }" ref="wrapper" :class="classes">
		<slot />
	</component>
</template>
