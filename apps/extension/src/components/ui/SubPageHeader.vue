<script setup>
// Wrapper-backed (design-system round-2, D-SEAM): the bare <SubPageHeader> tag + the 3 explicit page
// importers (journal/tx/tokens [id].vue) resolve HERE (NOT via the resolver). The router-free base
// lives in @nulo/design; this wrapper owns the router + history policy and the /popup/general fallback.
import { SubPageHeaderBase } from "@nulo/design"

const props = defineProps({
	title: {
		type: String,
		required: false,
		default: "",
	},
	backTo: {
		type: String,
		required: false,
	},
	showBack: {
		type: Boolean,
		default: true,
	},
	leadingIcon: {
		type: String,
		required: false,
	},
	leadingIconColor: {
		type: String,
		default: "secondary",
	},
})

const router = useRouter()

function handleBack() {
	// Prefer actual browser-history back — matches what users expect from a "back" arrow after having
	// navigated forward. `backTo` is the structural fallback for cold-open / deep-link cases where no
	// history exists.
	if (window.history.length > 1) {
		router.back()
	} else if (props.backTo) {
		router.push(props.backTo)
	} else {
		router.push("/popup/general")
	}
}
</script>

<template>
	<SubPageHeaderBase
		:title="title"
		:show-back="showBack"
		:leading-icon="leadingIcon"
		:leading-icon-color="leadingIconColor"
		@back="handleBack"
	>
		<!-- Forward slots only when provided so the base's title default (icon + title prop) still fires. -->
		<template v-if="$slots.title" #title><slot name="title" /></template>
		<template v-if="$slots.trailing" #trailing><slot name="trailing" /></template>
	</SubPageHeaderBase>
</template>
