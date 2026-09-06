<route lang="json">
{
	"meta": {
		"isAuthRequired": true,
		"showBottomNav": true
	}
}
</route>

<script setup lang="ts">
/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()
</script>

<template>
	<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper" data-testid="holdings-page">
		<Flex direction="column" gap="16" :class="$style.content">
			<SectionLabel label="Holdings" />
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	background: var(--app-bg);
	scrollbar-gutter: stable;
}

.content {
	padding: 16px 24px var(--nav-clearance) 24px;
}
</style>
