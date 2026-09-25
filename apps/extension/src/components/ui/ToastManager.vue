<script setup>
// The bare <ToastManager> tag resolves here, not through the design resolver: the inset comes from
// the route, which the package cannot read.
import { ToastManagerBase } from "@nulo/design"

const route = useRoute()

const bottomInset = computed(() => (route.meta.showBottomNav ? 76 : 12))
</script>

<template>
	<ToastManagerBase :bottomInset="bottomInset" />
</template>
