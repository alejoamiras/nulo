<script setup>
// The bare <ToastManager> tag resolves here, not through the design resolver: the inset comes from
// the route, the page's footers and the open sheets, which the package cannot read.
import { ToastManagerBase } from "@nulo/design"

/** Composables */
import { SNACK_GAP, useSnackInset } from "@/composables/snackInset"

const NAV_HEIGHT = 64
// The dApp windows centre the 360px column in a wider window; these two fill theirs.
const FULL_WIDTH_WINDOWS = new Set(["windows-json", "windows-logger"])

const route = useRoute()
const bottomInset = useSnackInset(() => (route.meta.showBottomNav ? NAV_HEIGHT + SNACK_GAP : SNACK_GAP))
const inColumn = computed(() => {
	const name = typeof route.name === "string" ? route.name : ""
	return name.startsWith("windows-") && !FULL_WIDTH_WINDOWS.has(name)
})
</script>

<template>
	<ToastManagerBase :bottomInset="bottomInset" :inColumn="inColumn" />
</template>
