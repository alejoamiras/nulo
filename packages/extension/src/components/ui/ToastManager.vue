<script setup>
// Wrapper-backed (design-system round-2, D-SEAM): the bare <ToastManager> tag stays local and resolves
// here (NOT via the resolver) so the package can export the neutrally-named `ToastManagerBase` without
// a second root-level toast name colliding with the faucet's `Toast`. The base teleports to the
// app-provided `#toast` root by default; the shared `useToast` singleton drives it.
import { ToastManagerBase } from "@nulo/design"
</script>

<template>
	<ToastManagerBase />
</template>
