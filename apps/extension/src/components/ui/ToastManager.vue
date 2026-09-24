<script setup>
// The bare <ToastManager> tag stays local and resolves here (NOT via the resolver) so the package
// exports the neutrally-named `ToastManagerBase` beside its `Toast` item rather than a second
// root-level toast name. The base teleports to the
// app-provided `#toast` root by default; the shared `useToast` singleton drives it.
import { ToastManagerBase } from "@nulo/design"
</script>

<template>
	<ToastManagerBase />
</template>
