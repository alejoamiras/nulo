<script setup>
/**
 * Top identity strip for the discover + capabilities windows. Thin caller
 * over the shared `IdentityStrip` frame; owns only the no-account fallback
 * label. The status dot color is driven by `status`:
 * - `ready`   → green (idle)
 * - `loading` → orange (request in flight)
 * - `cancelled` → red (interaction cancelled by the dApp)
 */
import IdentityStrip from "./IdentityStrip.vue"

defineProps({
	accountName: { type: String, default: "" },
	networkName: { type: String, default: "" },
	status: { type: String, default: "ready" },
})
</script>

<template>
	<IdentityStrip :accountLabel="accountName || 'No account'" :networkLabel="networkName" :status="status" />
</template>
