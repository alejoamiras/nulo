<script setup>
/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()
</script>

<template>
	<Banner v-if="appStore.profile?.recoveryMode" variant="warning" direction="vertical" data-testid="recovery-mode-banner">
		<template #title> Wallet keys need recovery </template>
		<template #description>
			<Text color="secondary" height="140">
				This profile unlocked without its imported-keys key, so chain data, dApp sessions and imported
				accounts are unavailable. Export a backup (or the recovery phrase) and restore it to repair.
			</Text>
		</template>
	</Banner>
</template>
