<script setup>
// Wrapper-backed (design-system round-2, D-SEAM): the bare <Button> tag stays local and resolves HERE
// (NOT via the resolver). The router-free base lives in @nulo/design; this wrapper preserves the
// legacy `link` prop's RouterLink (SPA) navigation by rendering RouterLink in `custom` mode and feeding
// its href + navigate into the base's anchor mode (`tag="a"`). Non-link buttons render the base
// directly. The package never takes a vue-router dependency.
import { Button as ButtonBase } from "@nulo/design"
import { RouterLink } from "vue-router"

// inheritAttrs:false + explicit v-bind="$attrs" on the base in BOTH branches. In the `link` branch the
// rendered root is RouterLink in `custom` mode (slot-only, no element), so automatic fallthrough would
// drop undeclared attrs (data-testid, @click, :style) onto a fragment root — Vue warns and discards
// them. Forwarding $attrs straight to the base (whose <component> root is the real <button>/<a>) lands
// them on the element in both branches, matching the pre-round-2 single-root <component :is> contract.
defineOptions({ inheritAttrs: false })

defineEmits(["onKeybind"])
defineProps({
	size: { type: String, default: "medium" },
	variant: { type: String, default: "primary" },
	wide: { type: Boolean, default: false },
	disabled: { type: Boolean },
	loading: { type: Boolean },
	link: { type: String, required: false },
	target: { type: String, required: false },
	leftIcon: { type: String, required: false },
	leftIconColor: { type: String, required: false },
	rightIcon: { type: String, required: false },
	rightIconColor: { type: String, required: false },
})
</script>

<template>
	<RouterLink v-if="link" :to="link" custom v-slot="{ href, navigate }">
		<ButtonBase
			v-bind="$attrs"
			tag="a"
			:href="href"
			:target="target"
			:size="size"
			:variant="variant"
			:wide="wide"
			:disabled="disabled"
			:loading="loading"
			:left-icon="leftIcon"
			:left-icon-color="leftIconColor"
			:right-icon="rightIcon"
			:right-icon-color="rightIconColor"
			@click="navigate"
		>
			<slot />
		</ButtonBase>
	</RouterLink>
	<ButtonBase
		v-else
		v-bind="$attrs"
		:size="size"
		:variant="variant"
		:wide="wide"
		:disabled="disabled"
		:loading="loading"
		:left-icon="leftIcon"
		:left-icon-color="leftIconColor"
		:right-icon="rightIcon"
		:right-icon-color="rightIconColor"
	>
		<slot />
	</ButtonBase>
</template>
