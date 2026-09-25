<script setup>
// The bare <ToastManager> tag resolves here, not through the design resolver: the inset comes from
// the route, the page's footers and the open sheets, which the package cannot read.
import { ToastManagerBase } from "@nulo/design"

/** Composables */
import { SNACK_GAP, useSnackInset } from "@/composables/snackInset"

const NAV_HEIGHT = 64

const route = useRoute()
const bottomInset = useSnackInset(() => (route.meta.showBottomNav ? NAV_HEIGHT + SNACK_GAP : SNACK_GAP))
</script>

<template>
	<ToastManagerBase :bottomInset="bottomInset" />
</template>
